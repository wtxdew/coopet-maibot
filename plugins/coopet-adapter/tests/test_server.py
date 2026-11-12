import asyncio
import json
import logging

import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer

from coopet_adapter import protocol as p
from coopet_adapter.server import CoopetServer

TOKEN = "secret"
WELCOME = {"bot_name": "麦麦", "bot_account_id": "coopet-maibot", "user_id": "owner", "user_nickname": "主人"}


def hello(**over):
    base = {"type": "hello", "protocol": 0, "token": TOKEN, "device_id": "d1", "device_name": "Mac", "client": {"name": "coopet", "version": "0"}}
    base.update(over)
    return base


class Harness:
    def __init__(self, result=None, **server_kw):
        self.chats = []
        self.result = result

        async def on_chat(chat):
            self.chats.append(chat)
            return self.result

        async def welcome_info():
            return WELCOME

        self.server = CoopetServer(host="127.0.0.1", port=0, token=TOKEN, on_chat=on_chat,
                                   welcome_info=welcome_info, logger=logging.getLogger("test"), **server_kw)
        self.client = TestClient(TestServer(self.server.make_app()))

    async def __aenter__(self):
        await self.client.start_server()
        return self

    async def __aexit__(self, *exc):
        await self.client.close()

    async def connect(self, first=None):
        ws = await self.client.ws_connect("/ws")
        if first is not None:
            await ws.send_str(json.dumps(first))
        return ws


async def recv_json(ws):
    msg = await asyncio.wait_for(ws.receive(), timeout=2)
    assert msg.type == WSMsgType.TEXT, msg
    return json.loads(msg.data)


async def expect_close(ws, code):
    msg = await asyncio.wait_for(ws.receive(), timeout=2)
    assert msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING), msg
    assert ws.close_code == code


async def test_handshake_sends_welcome():
    async with Harness() as h:
        ws = await h.connect(hello())
        assert await recv_json(ws) == p.welcome(**WELCOME)
        assert h.server.connected


@pytest.mark.parametrize("first,code,err", [
    (hello(token="wrong"), p.CLOSE_UNAUTHORIZED, p.ERR_UNAUTHORIZED),
    (hello(protocol=1), p.CLOSE_PROTOCOL_UNSUPPORTED, p.ERR_PROTOCOL_UNSUPPORTED),
    ({"type": "chat", "id": "a", "text": "hi"}, p.CLOSE_HANDSHAKE, p.ERR_HANDSHAKE),
    (hello(device_id=None), p.CLOSE_HANDSHAKE, p.ERR_HANDSHAKE),
])
async def test_handshake_failures(first, code, err):
    async with Harness() as h:
        ws = await h.connect(first)
        assert (await recv_json(ws))["code"] == err
        await expect_close(ws, code)
        assert not h.server.connected


async def test_handshake_timeout():
    async with Harness(hello_timeout=0.1) as h:
        ws = await h.connect()
        assert (await recv_json(ws))["code"] == p.ERR_HANDSHAKE
        await expect_close(ws, p.CLOSE_HANDSHAKE)


async def test_chat_is_acked_when_accepted():
    async with Harness() as h:
        ws = await h.connect(hello())
        await recv_json(ws)
        await ws.send_str(json.dumps({"type": "chat", "id": "c1", "text": " 你好 "}))
        assert await recv_json(ws) == p.ack_ok("c1")
        assert h.chats == [p.Chat(id="c1", text="你好")]


async def test_chat_is_acked_with_error_when_rejected():
    async with Harness(result=(p.ERR_REJECTED, "MaiBot 没收下")) as h:
        ws = await h.connect(hello())
        await recv_json(ws)
        await ws.send_str(json.dumps({"type": "chat", "id": "c1", "text": "hi"}))
        assert await recv_json(ws) == p.ack_error("c1", p.ERR_REJECTED, "MaiBot 没收下")


async def test_bad_frames_get_errors_and_keep_the_connection():
    async with Harness() as h:
        ws = await h.connect(hello())
        await recv_json(ws)
        await ws.send_str(json.dumps({"type": "chat", "id": "c1", "text": "  "}))
        ack = await recv_json(ws)
        assert ack["id"] == "c1" and ack["ok"] is False and ack["error"]["code"] == p.ERR_INVALID
        await ws.send_str(json.dumps({"type": "chat", "text": "no id"}))
        assert (await recv_json(ws))["code"] == p.ERR_INVALID
        await ws.send_str("not json")
        assert (await recv_json(ws))["code"] == p.ERR_INVALID
        await ws.send_str(json.dumps({"type": "agent.task", "goal": "x"}))  # 预留类型：忽略
        await ws.send_str(json.dumps({"type": "chat", "id": "c2", "text": "still here"}))
        assert await recv_json(ws) == p.ack_ok("c2")
        assert [c.id for c in h.chats] == ["c2"]


async def test_new_device_replaces_the_old_one():
    async with Harness() as h:
        old = await h.connect(hello(device_name="Old"))
        await recv_json(old)
        new = await h.connect(hello(device_name="New"))
        assert (await recv_json(old))["code"] == p.ERR_REPLACED
        await expect_close(old, p.CLOSE_REPLACED)
        assert (await recv_json(new))["type"] == "welcome"
        assert await h.server.send(p.thinking(True))
        assert await recv_json(new) == p.thinking(True)


async def test_send_without_device_returns_false():
    async with Harness() as h:
        assert await h.server.send(p.thinking(True)) is False


async def test_binary_frame_closes_1003():
    async with Harness() as h:
        ws = await h.connect(hello())
        await recv_json(ws)
        await ws.send_bytes(b"\x00\x01")
        await expect_close(ws, p.CLOSE_UNSUPPORTED_DATA)


async def test_oversized_frame_closes_1009():
    async with Harness(max_frame_bytes=1024) as h:
        ws = await h.connect(hello())
        await recv_json(ws)
        await ws.send_str(json.dumps({"type": "chat", "id": "c1", "text": "x" * 4096}))
        await expect_close(ws, p.CLOSE_TOO_BIG)


def test_empty_token_is_refused():
    async def noop(_):
        return None

    async def info():
        return WELCOME

    with pytest.raises(ValueError):
        CoopetServer(host="127.0.0.1", port=0, token="", on_chat=noop, welcome_info=info, logger=logging.getLogger("t"))
