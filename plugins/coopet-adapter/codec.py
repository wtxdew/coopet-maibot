"""客户端消息与 MaiBot 网关消息之间的格式转换。纯函数，不依赖网络和 SDK。

- 入站：协议的 `chat` → `ctx.gateway.route_message` 要的消息字典
  （必填字段见 MaiBot src/plugin_runtime/host/message_utils.py `_build_session_message_from_dict`）。
- 出站：网关交给插件的消息字典（`raw_message` 是段的列表）→ 协议的 `reply`。
  图片、表情包段的字节在 `binary_data_base64`，`data` 是描述文字。
"""

from __future__ import annotations

import base64
import binascii
from typing import Any, Dict, List, Mapping, Optional

from .protocol import Chat, reply

PLATFORM = "coopet"


def chat_to_inbound(chat: Chat, *, account_id: str, user_id: str, user_nickname: str, now: float) -> Dict[str, Any]:
    """主人在 coopet 平台的一条私聊文字消息。message_id 用客户端给的 chat.id。"""
    return {
        "platform": PLATFORM,
        "account_id": account_id,
        "scope": None,
        "message_id": chat.id,
        "timestamp": str(now),
        "message_info": {
            "user_info": {"user_id": user_id, "user_nickname": user_nickname},
            "additional_config": {},
        },
        "raw_message": [{"type": "text", "data": chat.text}],
        "is_at": False,
        "is_mentioned": False,
        "is_picture": False,
        "is_emoji": False,
        "is_command": False,
    }


def outbound_to_reply(message: Mapping[str, Any]) -> Dict[str, Any]:
    """网关出站消息 → reply 帧。raw_message 不是列表时抛 ValueError。"""
    segments = message.get("raw_message")
    if not isinstance(segments, list):
        raise ValueError("出站消息的 raw_message 必须是列表")
    message_id = message.get("message_id")
    return reply(message_id if isinstance(message_id, str) else "", segments_to_parts(segments))


def segments_to_parts(segments: List[Any]) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    for seg in segments:
        if not isinstance(seg, Mapping):
            continue
        kind = seg.get("type")
        if kind == "text" and isinstance(seg.get("data"), str):
            parts.append({"kind": "text", "text": seg["data"]})
        elif kind in ("image", "emoji") and isinstance(seg.get("binary_data_base64"), str) and seg["binary_data_base64"]:
            part: Dict[str, Any] = {"kind": kind, "base64": seg["binary_data_base64"]}
            mime = sniff_image_mime(seg["binary_data_base64"])
            if mime:
                part["mime"] = mime
            parts.append(part)
        else:
            parts.append({"kind": "other", "type": str(kind)})
    return parts


def outbound_target_user(message: Mapping[str, Any]) -> Optional[str]:
    """私聊出站消息的目标用户（MaiBot 写在 additional_config.platform_io_target_user_id）。"""
    info = message.get("message_info")
    config = info.get("additional_config") if isinstance(info, Mapping) else None
    target = config.get("platform_io_target_user_id") if isinstance(config, Mapping) else None
    return str(target) if target is not None else None


_SIGNATURES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


def sniff_image_mime(b64: str) -> Optional[str]:
    """按文件头猜图片类型；认不出时返回 None。只解码开头一小段。"""
    try:
        head = base64.b64decode(b64[:24] + "=" * (-len(b64[:24]) % 4), validate=False)
    except (binascii.Error, ValueError):
        return None
    for sig, mime in _SIGNATURES:
        if head.startswith(sig):
            return mime
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None
