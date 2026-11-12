"""用假的 MaiBot 上下文测试插件的接线：真实启动 WS 服务，用真实的 WS 客户端连。"""

import asyncio
import json
import logging
import socket
from types import SimpleNamespace

import aiohttp
import pytest

from coopet_adapter import plugin as plugin_mod
from coopet_adapter import protocol as p

TOKEN = "secret"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class FakeGateway:
    def __init__(self, ready_ok=True, route_result=True):
        self.ready_ok = ready_ok
        self.route_result = route_result
        self.states = []
        self.routed = []

    async def update_state(self, gateway_name, *, ready, platform="", account_id="", scope="", metadata=None):
        self.states.append((gateway_name, ready, platform, account_id))
        return self.ready_ok

    async def route_message(self, gateway_name, message, *, route_metadata=None, external_message_id="", dedupe_key=""):
        self.routed.append((gateway_name, message, external_message_id, dedupe_key))
        if isinstance(self.route_result, Exception):
            raise self.route_result
        return self.route_result


class FakeChat:
    def __init__(self, streams):
        self.streams = streams
        self.calls = 0

    async def get_all_streams(self, platform="qq"):
        self.calls += 1
        return [s for s in self.streams if s["platform"] == platform]


class FakeConfig:
    def __init__(self, nickname):
        self.nickname = nickname

    async def get(self, key, default=None):
        return self.nickname if key == "bot.nickname" else default


OWNER_STREAM = {"session_id": "s-owner", "platform": "coopet", "account_id": "coopet-maibot", "user_id": "owner", "is_group_session": False, "scope": None}


def make_plugin(*, enabled=True, token=TOKEN, gateway=None, streams=(OWNER_STREAM,), nickname="麦麦"):
    plugin = plugin_mod.create_plugin()
    ctx = SimpleNamespace(
        logger=logging.getLogger("coopet-test"),
        gateway=gateway or FakeGateway(),
        chat=FakeChat(list(streams)),
        config=FakeConfig(nickname),
    )
    plugin._set_context(ctx)
    port = free_port()
    plugin.set_plugin_config({"plugin": {"enabled": enabled, "config_version": "0.1.0"}, "server": {"host": "127.0.0.1", "port": port, "token": token}})
    return plugin, ctx, port


class Client:
    def __init__(self, port):
        self.port = port

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        self.ws = await self.session.ws_connect(f"http://127.0.0.1:{self.port}/ws")
        await self.ws.send_str(json.dumps({"type": "hello", "protocol": 0, "token": TOKEN, "device_id": "d", "device_name": "Mac"}))
        self.welcome = await self.recv()
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()
        await self.session.close()

    async def recv(self):
        msg = await asyncio.wait_for(self.ws.receive(), timeout=2)
        assert msg.type == aiohttp.WSMsgType.TEXT, msg
        return json.loads(msg.data)

    async def chat(self, chat_id, text):
        await self.ws.send_str(json.dumps({"type": "chat", "id": chat_id, "text": text}))
        return await self.recv()


def outbound(text="辛苦啦", target="owner"):
    return {
        "platform": "coopet", "account_id": "coopet-maibot", "message_id": "send_api_1",
        "message_info": {"additional_config": {"platform_io_target_user_id": target}},
        "raw_message": [{"type": "text", "data": text}],
    }


async def test_load_reports_ready_and_welcome_carries_bot_name():
    plugin, ctx, port = make_plugin()
    await plugin.on_load()
    try:
        assert ctx.gateway.states == [("coopet_gateway", True, "coopet", "coopet-maibot")]
        async with Client(port) as c:
            assert c.welcome == p.welcome(bot_name="麦麦", bot_account_id="coopet-maibot", user_id="owner", user_nickname="主人")
    finally:
        await plugin.on_unload()
    assert ctx.gateway.states[-1] == ("coopet_gateway", False, "coopet", "coopet-maibot")


async def test_bot_name_falls_back():
    plugin, _, port = make_plugin(nickname="")
    await plugin.on_load()
    try:
        async with Client(port) as c:
            assert c.welcome["bot"]["name"] == "MaiBot"
    finally:
        await plugin.on_unload()


async def test_chat_is_routed_as_owner_private_message():
    plugin, ctx, port = make_plugin()
    await plugin.on_load()
    try:
        async with Client(port) as c:
            assert await c.chat("c1", "你好") == p.ack_ok("c1")
        name, message, ext_id, dedupe = ctx.gateway.routed[0]
        assert (name, ext_id, dedupe) == ("coopet_gateway", "c1", "c1")
        assert message["message_info"]["user_info"] == {"user_id": "owner", "user_nickname": "主人"}
        assert message["raw_message"] == [{"type": "text", "data": "你好"}]
    finally:
        await plugin.on_unload()


@pytest.mark.parametrize("gateway,code", [
    (FakeGateway(route_result=False), p.ERR_REJECTED),
    (FakeGateway(route_result=RuntimeError("宿主拒绝")), p.ERR_REJECTED),
    (FakeGateway(ready_ok=False), p.ERR_NOT_READY),
])
async def test_chat_failures_are_acked(gateway, code):
    plugin, _, port = make_plugin(gateway=gateway)
    await plugin.on_load()
    try:
        async with Client(port) as c:
            ack = await c.chat("c1", "hi")
            assert ack["ok"] is False and ack["error"]["code"] == code
    finally:
        await plugin.on_unload()


async def test_reply_flows_to_the_pet_and_ends_thinking():
    plugin, _, port = make_plugin()
    await plugin.on_load()
    try:
        async with Client(port) as c:
            assert await plugin.on_reply_start(session_id="s-owner") == plugin_mod.CONTINUE
            assert await c.recv() == p.thinking(True)
            assert await plugin.send_to_coopet(outbound()) == {"success": True}
            assert await c.recv() == p.reply("send_api_1", [{"kind": "text", "text": "辛苦啦"}])
            assert await c.recv() == p.thinking(False)
    finally:
        await plugin.on_unload()


async def test_thinking_ignores_other_sessions_and_caches_owner():
    plugin, ctx, port = make_plugin()
    await plugin.on_load()
    try:
        async with Client(port) as c:
            await plugin.on_reply_start(session_id="s-other")
            await plugin.on_reply_start(session_id="s-owner")
            assert await c.recv() == p.thinking(True)  # s-other 没有推送
            await plugin.on_reply_start(session_id="s-owner")
            assert ctx.chat.calls == 1
    finally:
        await plugin.on_unload()


async def test_empty_response_ends_thinking(monkeypatch):
    plugin, _, port = make_plugin()
    await plugin.on_load()
    try:
        async with Client(port) as c:
            await plugin.on_reply_start(session_id="s-owner")
            await c.recv()
            await plugin.on_reply_done(session_id="s-owner", response="有内容")  # 有正文：等回复到了再结束
            await plugin.on_reply_done(session_id="s-owner", response="  ")
            assert await c.recv() == p.thinking(False)
    finally:
        await plugin.on_unload()


async def test_thinking_times_out(monkeypatch):
    monkeypatch.setattr(p, "THINKING_TIMEOUT_SEC", 0.05)
    plugin, _, port = make_plugin()
    await plugin.on_load()
    try:
        async with Client(port) as c:
            await plugin.on_reply_start(session_id="s-owner")
            assert await c.recv() == p.thinking(True)
            assert await c.recv() == p.thinking(False)
    finally:
        await plugin.on_unload()


async def test_gateway_refuses_wrong_identity_or_no_pet():
    plugin, _, _ = make_plugin()
    await plugin.on_load()
    try:
        assert (await plugin.send_to_coopet({**outbound(), "account_id": "other"}))["success"] is False
        assert (await plugin.send_to_coopet(outbound(target="stranger")))["success"] is False
        assert (await plugin.send_to_coopet({**outbound(), "raw_message": "x"}))["success"] is False
        result = await plugin.send_to_coopet(outbound())
        assert result == {"success": False, "error": "桌宠没有连上"}
    finally:
        await plugin.on_unload()


async def test_disabled_or_no_token_starts_nothing():
    for kwargs in ({"enabled": False}, {"token": ""}):
        plugin, ctx, port = make_plugin(**kwargs)
        await plugin.on_load()
        assert ctx.gateway.states == []
        with pytest.raises(aiohttp.ClientError):
            async with aiohttp.ClientSession() as s:
                await s.ws_connect(f"http://127.0.0.1:{port}/ws")
        await plugin.on_unload()


async def test_config_update_restarts_the_server():
    plugin, ctx, port = make_plugin()
    await plugin.on_load()
    new_port = free_port()
    await plugin.on_config_update("self", {"plugin": {"enabled": True, "config_version": "0.1.0"}, "server": {"host": "127.0.0.1", "port": new_port, "token": TOKEN}}, "1")
    try:
        async with Client(new_port) as c:
            assert c.welcome["type"] == "welcome"
        assert [s[1] for s in ctx.gateway.states] == [True, False, True]
    finally:
        await plugin.on_unload()
