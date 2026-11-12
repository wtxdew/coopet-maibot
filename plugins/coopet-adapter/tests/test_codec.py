import base64

import pytest

from coopet_adapter import codec
from coopet_adapter.protocol import Chat


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


PNG = b64(b"\x89PNG\r\n\x1a\n" + b"\0" * 20)
JPEG = b64(b"\xff\xd8\xff\xe0" + b"\0" * 20)
GIF = b64(b"GIF89a" + b"\0" * 20)
WEBP = b64(b"RIFF\0\0\0\0WEBPVP8 " + b"\0" * 12)


def test_chat_to_inbound_has_the_fields_maibot_requires():
    m = codec.chat_to_inbound(Chat(id="c1", text="你好"), account_id="coopet-maibot", user_id="owner", user_nickname="主人", now=1731400000.5)
    assert m["platform"] == "coopet"
    assert m["account_id"] == "coopet-maibot" and m["scope"] is None
    assert m["message_id"] == "c1"
    assert m["timestamp"] == "1731400000.5"
    assert m["message_info"]["user_info"] == {"user_id": "owner", "user_nickname": "主人"}
    assert "group_info" not in m["message_info"]
    assert m["raw_message"] == [{"type": "text", "data": "你好"}]
    assert all(m[k] is False for k in ("is_at", "is_mentioned", "is_picture", "is_emoji", "is_command"))


def test_outbound_to_reply_maps_segments():
    msg = {
        "message_id": "send_api_1",
        "raw_message": [
            {"type": "text", "data": "辛苦啦"},
            {"type": "emoji", "data": "开心", "hash": "h", "binary_data_base64": PNG},
            {"type": "image", "data": "图", "hash": "h"},
            {"type": "voice", "data": "", "binary_data_base64": "AAAA"},
            "garbage",
        ],
    }
    assert codec.outbound_to_reply(msg) == {
        "type": "reply", "id": "send_api_1",
        "parts": [
            {"kind": "text", "text": "辛苦啦"},
            {"kind": "emoji", "base64": PNG, "mime": "image/png"},
            {"kind": "other", "type": "image"},
            {"kind": "other", "type": "voice"},
        ],
    }


def test_outbound_without_id_or_list():
    assert codec.outbound_to_reply({"raw_message": []})["id"] == ""
    with pytest.raises(ValueError):
        codec.outbound_to_reply({"raw_message": "text"})


@pytest.mark.parametrize("data,mime", [(PNG, "image/png"), (JPEG, "image/jpeg"), (GIF, "image/gif"), (WEBP, "image/webp"), (b64(b"hello world, plain"), None), ("!!!", None)])
def test_sniff_image_mime(data, mime):
    assert codec.sniff_image_mime(data) == mime


def test_outbound_target_user():
    assert codec.outbound_target_user({"message_info": {"additional_config": {"platform_io_target_user_id": "owner"}}}) == "owner"
    assert codec.outbound_target_user({"message_info": {}}) is None
    assert codec.outbound_target_user({}) is None
