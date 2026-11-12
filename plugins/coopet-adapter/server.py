"""协议 v0 的 WebSocket 服务（aiohttp）。不依赖 SDK：和 MaiBot 打交道的部分由 plugin.py 通过回调注入。

一条连接的流程（docs/PROTOCOL.md §3–§5）：
1. 等第一帧，必须是 hello（超时、二进制帧、不是 hello → 4000）；
2. 比对协议版本（→ 4002）和 token（→ 4001）；
3. 顶替已有的设备（旧连接收到 error replaced 后以 4003 关闭）；
4. 回 welcome，之后逐帧处理：chat → on_chat 回调 → ack；不认识的 type 忽略。
"""

from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

from aiohttp import WSMsgType, web

from . import protocol as p

# chat 的处理结果：None 表示 MaiBot 收下了；否则是 (错误码, 说明)
ChatResult = Optional[Tuple[str, str]]
OnChat = Callable[[p.Chat], Awaitable[ChatResult]]
# 返回 protocol.welcome() 的关键字参数：bot_name、bot_account_id、user_id、user_nickname
WelcomeInfo = Callable[[], Awaitable[Dict[str, str]]]

HEARTBEAT_SEC = 30.0


class CoopetServer:
    def __init__(
        self,
        *,
        host: str,
        port: int,
        token: str,
        on_chat: OnChat,
        welcome_info: WelcomeInfo,
        logger: logging.Logger,
        hello_timeout: float = p.HELLO_TIMEOUT_SEC,
        max_frame_bytes: int = p.MAX_FRAME_BYTES,
    ) -> None:
        if not token:
            raise ValueError("token 不能为空")
        self._host = host
        self._port = port
        self._token = token
        self._on_chat = on_chat
        self._welcome_info = welcome_info
        self._log = logger
        self._hello_timeout = hello_timeout
        self._max_frame_bytes = max_frame_bytes
        self._runner: Optional[web.AppRunner] = None
        self._current: Optional[web.WebSocketResponse] = None
        self._current_device = ""

    # ---------- 生命周期 ----------

    def make_app(self) -> web.Application:
        app = web.Application()
        app.router.add_get("/ws", self._handle)
        return app

    async def start(self) -> None:
        self._runner = web.AppRunner(self.make_app())
        await self._runner.setup()
        site = web.TCPSite(self._runner, self._host, self._port)
        await site.start()
        self._log.info("Coopet 服务已启动：ws://%s:%s/ws", self._host, self._port)

    async def stop(self) -> None:
        current, self._current = self._current, None
        if current is not None and not current.closed:
            await current.close(code=p.CLOSE_NORMAL, message=b"server stopping")
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None
        self._log.info("Coopet 服务已停止")

    # ---------- 发送 ----------

    @property
    def connected(self) -> bool:
        return self._current is not None and not self._current.closed

    async def send(self, frame: Dict[str, Any]) -> bool:
        """发给当前设备；没有设备连着时返回 False。"""
        ws = self._current
        if ws is None or ws.closed:
            return False
        try:
            await ws.send_str(p.encode(frame))
            return True
        except (ConnectionResetError, RuntimeError) as exc:
            self._log.warning("发给桌宠失败：%s", exc)
            return False

    # ---------- 一条连接 ----------

    async def _handle(self, request: web.Request) -> web.StreamResponse:
        ws = web.WebSocketResponse(heartbeat=HEARTBEAT_SEC, max_msg_size=self._max_frame_bytes)
        await ws.prepare(request)
        peer = request.remote or "?"

        hello = await self._handshake(ws, peer)
        if hello is None:
            return ws

        previous = self._current
        self._current = ws
        self._current_device = hello.device_name
        if previous is not None and not previous.closed:
            self._log.info("新设备 %s 顶替了旧连接", hello.device_name)
            await self._fail(previous, p.ERR_REPLACED, "已被新设备顶替", p.CLOSE_REPLACED)

        await ws.send_str(p.encode(p.welcome(**await self._welcome_info())))
        self._log.info("桌宠已连上：%s（%s，%s %s）", hello.device_name, peer, hello.client_name, hello.client_version)

        try:
            await self._serve(ws)
        finally:
            if self._current is ws:
                self._current = None
                self._log.info("桌宠已断开：%s（关闭码 %s）", hello.device_name, ws.close_code)
        return ws

    async def _handshake(self, ws: web.WebSocketResponse, peer: str) -> Optional[p.Hello]:
        try:
            msg = await asyncio.wait_for(ws.receive(), timeout=self._hello_timeout)
        except asyncio.TimeoutError:
            await self._fail(ws, p.ERR_HANDSHAKE, "没有在规定时间内收到 hello", p.CLOSE_HANDSHAKE)
            return None
        if msg.type != WSMsgType.TEXT:
            if msg.type == WSMsgType.BINARY:
                await self._fail(ws, p.ERR_HANDSHAKE, "第一帧必须是 hello", p.CLOSE_HANDSHAKE)
            return None
        try:
            hello = p.parse_hello(p.parse_frame(msg.data))
        except p.ProtocolError as exc:
            await self._fail(ws, p.ERR_HANDSHAKE, exc.message, p.CLOSE_HANDSHAKE)
            return None
        if hello.protocol != p.PROTOCOL_VERSION:
            await self._fail(ws, p.ERR_PROTOCOL_UNSUPPORTED, f"只支持协议 {p.PROTOCOL_VERSION}", p.CLOSE_PROTOCOL_UNSUPPORTED)
            return None
        if not hmac.compare_digest(hello.token.encode(), self._token.encode()):
            self._log.warning("拒绝了 token 不对的连接（%s）", peer)
            await self._fail(ws, p.ERR_UNAUTHORIZED, "token 不对", p.CLOSE_UNAUTHORIZED)
            return None
        return hello

    async def _serve(self, ws: web.WebSocketResponse) -> None:
        async for msg in ws:
            if msg.type == WSMsgType.TEXT:
                await self._on_text(ws, msg.data)
            elif msg.type == WSMsgType.BINARY:
                await ws.close(code=p.CLOSE_UNSUPPORTED_DATA, message=b"binary frames are not used")
                return
            elif msg.type == WSMsgType.ERROR:
                self._log.warning("连接出错：%s", ws.exception())
                return

    async def _on_text(self, ws: web.WebSocketResponse, raw: str) -> None:
        try:
            obj = p.parse_frame(raw)
            kind = obj["type"]
            if kind == "chat":
                chat = p.parse_chat(obj)
                result = await self._on_chat(chat)
                frame = p.ack_ok(chat.id) if result is None else p.ack_error(chat.id, *result)
                await ws.send_str(p.encode(frame))
            else:
                self._log.debug("忽略不认识的消息类型：%s", kind)
        except p.ProtocolError as exc:
            frame = p.ack_error(exc.ack_id, exc.code, exc.message) if exc.ack_id else p.error(exc.code, exc.message)
            await ws.send_str(p.encode(frame))

    async def _fail(self, ws: web.WebSocketResponse, code: str, message: str, close_code: int) -> None:
        """先发 error 帧，再以 close_code 关闭。"""
        try:
            await ws.send_str(p.encode(p.error(code, message)))
        except (ConnectionResetError, RuntimeError):
            pass
        await ws.close(code=close_code, message=code.encode())
