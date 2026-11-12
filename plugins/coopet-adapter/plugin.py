"""Coopet 桌宠适配器：把 WS 服务（server.py）接到 MaiBot。

- 启停：插件启用且填了 token 时启动 WS 服务，并向 MaiBot 报告网关就绪；
  就绪后 MaiBot 会把 coopet 平台的回复交给本插件的网关，不再需要 bot.platforms 登记。
- 入站：桌宠的 chat → 主人在 coopet 平台的私聊 → `ctx.gateway.route_message`，结果作为 ack 回给桌宠。
- 出站：MaiBot 发给 coopet 的消息 → `send_to_coopet` 网关 → reply 帧，然后结束思考状态。
- 思考：主人会话的 replyer 开始生成 → thinking on；回复发出、生成结果为空、或 120 秒兜底 → off。
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, ClassVar, Dict, List, Optional, Type

from maibot_sdk import HookHandler, MaiBotPlugin, MessageGateway, PluginConfigBase
from maibot_sdk.types import HookMode

from . import protocol as p
from .codec import PLATFORM, chat_to_inbound, outbound_target_user, outbound_to_reply
from .server import ChatResult, CoopetServer
from .settings import AdapterSettings

GATEWAY_NAME = "coopet_gateway"
GATEWAY_PROTOCOL = "coopet_ws_v0"
DEFAULT_BOT_NAME = "MaiBot"
CONTINUE: Dict[str, Any] = {"action": "continue"}


class CoopetAdapterPlugin(MaiBotPlugin):
    config_model: ClassVar[Optional[Type[PluginConfigBase]]] = AdapterSettings

    def __init__(self) -> None:
        super().__init__()
        self._server: Optional[CoopetServer] = None
        self._ready = False
        self._lifecycle_lock = asyncio.Lock()
        self._owner_session: Optional[str] = None
        self._thinking_timer: Optional[asyncio.TimerHandle] = None

    # ---------- 生命周期 ----------

    async def on_load(self) -> None:
        async with self._lifecycle_lock:
            if self.config.plugin.enabled:
                await self._start()
            else:
                self.ctx.logger.info("Coopet 适配器未启用")

    async def on_unload(self) -> None:
        async with self._lifecycle_lock:
            await self._stop()

    async def on_config_update(self, scope: str, config_data: Dict[str, Any], version: str) -> None:
        del version
        if scope != "self":
            return
        async with self._lifecycle_lock:
            await self._stop()
            self.set_plugin_config(config_data)
            if self.config.plugin.enabled:
                await self._start()

    async def _start(self) -> None:
        server_cfg = self.config.server
        if not server_cfg.token.strip():
            self.ctx.logger.error("Coopet 适配器没有填 token，不启动服务；请在插件设置的「连接」里填写")
            return
        server = CoopetServer(
            host=server_cfg.host,
            port=server_cfg.port,
            token=server_cfg.token,
            on_chat=self._on_chat,
            welcome_info=self._welcome_info,
            logger=self.ctx.logger,
        )
        try:
            await server.start()
        except OSError as exc:
            self.ctx.logger.error("Coopet 服务启动失败（端口 %s）：%s", server_cfg.port, exc)
            return
        self._server = server
        try:
            await self._set_ready(True)
        except Exception as exc:
            self.ctx.logger.error("向 MaiBot 报告网关就绪失败，停止 Coopet 服务：%s", exc)
            self._server = None
            await server.stop()

    async def _stop(self) -> None:
        self._cancel_thinking_timer()
        if self._ready:
            await self._set_ready(False)
        server, self._server = self._server, None
        if server is not None:
            await server.stop()
        self._owner_session = None

    async def _set_ready(self, ready: bool) -> None:
        accepted = await self.ctx.gateway.update_state(
            gateway_name=GATEWAY_NAME,
            ready=ready,
            platform=PLATFORM,
            account_id=self.config.identity.bot_account_id,
            # 宿主要求 metadata.protocol 是字符串，与网关声明的 protocol 一致
            metadata={"connection": "coopet_ws", "protocol": GATEWAY_PROTOCOL},
        )
        self._ready = ready and bool(accepted)
        if ready and not accepted:
            self.ctx.logger.error("MaiBot 没有接受 Coopet 网关的就绪状态，消息不会被路由")

    # ---------- 入站：桌宠 → MaiBot ----------

    async def _on_chat(self, chat: p.Chat) -> ChatResult:
        if not self._ready:
            return (p.ERR_NOT_READY, "插件的消息网关还没就绪")
        identity = self.config.identity
        message = chat_to_inbound(
            chat,
            account_id=identity.bot_account_id,
            user_id=identity.owner_user_id,
            user_nickname=identity.owner_nickname,
            now=time.time(),
        )
        try:
            accepted = await self.ctx.gateway.route_message(
                GATEWAY_NAME, message, external_message_id=chat.id, dedupe_key=chat.id,
            )
        except Exception as exc:  # 宿主拒绝时 SDK 会抛错，原样作为说明回给桌宠
            self.ctx.logger.warning("Coopet 消息没能交给 MaiBot：%s", exc)
            return (p.ERR_REJECTED, str(exc))
        return None if accepted else (p.ERR_REJECTED, "MaiBot 没有收下这条消息")

    async def _welcome_info(self) -> Dict[str, str]:
        identity = self.config.identity
        return {
            "bot_name": await self._bot_name(),
            "bot_account_id": identity.bot_account_id,
            "user_id": identity.owner_user_id,
            "user_nickname": identity.owner_nickname,
        }

    async def _bot_name(self) -> str:
        """MaiBot 设置里的 bot.nickname；读不到时用 MaiBot。"""
        try:
            value = await self.ctx.config.get("bot.nickname", DEFAULT_BOT_NAME)
        except Exception as exc:
            self.ctx.logger.warning("读不到 MaiBot 的 bot.nickname：%s", exc)
            return DEFAULT_BOT_NAME
        if isinstance(value, dict):  # 宿主信封没被解包时：{"success": ..., "value": ...}
            value = value.get("value")
        return value if isinstance(value, str) and value.strip() else DEFAULT_BOT_NAME

    # ---------- 出站：MaiBot → 桌宠 ----------

    @MessageGateway(
        route_type="duplex",
        name=GATEWAY_NAME,
        platform=PLATFORM,
        protocol=GATEWAY_PROTOCOL,
        description="Coopet 桌宠的文字、图片、表情包双向消息网关",
        timeout_ms=30000,
    )
    async def send_to_coopet(
        self,
        message: Dict[str, Any],
        route: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        del route, metadata, kwargs
        identity = self.config.identity
        if message.get("platform") != PLATFORM or message.get("account_id") != identity.bot_account_id:
            return {"success": False, "error": "出站消息的路由身份与 Coopet 网关不一致"}
        target = outbound_target_user(message)
        if target is not None and target != identity.owner_user_id:
            return {"success": False, "error": f"Coopet 只接主人一个用户，不能发给 {target}"}
        try:
            frame = outbound_to_reply(message)
        except ValueError as exc:
            return {"success": False, "error": str(exc)}
        server = self._server
        if server is None or not await server.send(frame):
            return {"success": False, "error": "桌宠没有连上"}
        await self._set_thinking(False)
        return {"success": True}

    # ---------- 思考状态 ----------

    @HookHandler(
        "maisaka.replyer.before_request",
        name="coopet_thinking_on",
        description="主人的 coopet 会话开始生成回复时，让桌宠显示思考中",
        mode=HookMode.OBSERVE,
        timeout_ms=3000,
    )
    async def on_reply_start(self, session_id: str = "", **kwargs: Any) -> Dict[str, Any]:
        del kwargs
        if await self._is_owner_session(session_id):
            await self._set_thinking(True)
        return CONTINUE

    @HookHandler(
        "maisaka.replyer.after_response",
        name="coopet_thinking_empty",
        description="生成结果为空时，结束桌宠的思考状态",
        mode=HookMode.OBSERVE,
        timeout_ms=3000,
    )
    async def on_reply_done(self, session_id: str = "", response: str = "", **kwargs: Any) -> Dict[str, Any]:
        del kwargs
        # 有正文时不在这里结束：MaiBot 还要模拟打字后才发出，等回复真正到达桌宠再结束
        if not str(response or "").strip() and await self._is_owner_session(session_id):
            await self._set_thinking(False)
        return CONTINUE

    async def _is_owner_session(self, session_id: str) -> bool:
        """这个会话是不是主人在 coopet 平台的私聊；找到后记住它的 session_id。"""
        if not session_id or self._server is None:
            return False
        if self._owner_session is not None:
            return session_id == self._owner_session
        try:
            streams = await self.ctx.chat.get_all_streams(platform=PLATFORM)
        except Exception as exc:
            self.ctx.logger.warning("查询 coopet 聊天流失败：%s", exc)
            return False
        if isinstance(streams, dict):  # 宿主信封没被解包时：{"success": ..., "streams": [...]}
            streams = streams.get("streams")
        identity = self.config.identity
        for stream in streams if isinstance(streams, list) else []:
            if (
                isinstance(stream, dict)
                and stream.get("platform") == PLATFORM
                and stream.get("account_id") == identity.bot_account_id
                and stream.get("user_id") == identity.owner_user_id
                and not stream.get("is_group_session")
                and not stream.get("scope")
            ):
                self._owner_session = str(stream.get("session_id"))
                break
        return session_id == self._owner_session

    async def _set_thinking(self, on: bool) -> None:
        self._cancel_thinking_timer()
        if on:
            loop = asyncio.get_running_loop()
            self._thinking_timer = loop.call_later(
                p.THINKING_TIMEOUT_SEC, lambda: loop.create_task(self._set_thinking(False)),
            )
        if self._server is not None:
            await self._server.send(p.thinking(on))

    def _cancel_thinking_timer(self) -> None:
        if self._thinking_timer is not None:
            self._thinking_timer.cancel()
            self._thinking_timer = None


def create_plugin() -> CoopetAdapterPlugin:
    return CoopetAdapterPlugin()


__all__: List[str] = ["CoopetAdapterPlugin", "create_plugin", "GATEWAY_NAME"]
