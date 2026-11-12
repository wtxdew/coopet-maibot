# Coopet 协议 v0（2026-11-12 定稿）

桌宠客户端（`packages/coopet-core` 的 `link/coopet-plugin.ts`）与 MaiBot 适配器插件（`plugins/coopet-adapter/`）之间的协议。
架构见 [ARCHITECTURE.md](ARCHITECTURE.md) §4.3、§4.4。

v0 只覆盖**单台设备的聊天**：握手、发消息、收回复、思考状态。多设备、本地 Agent（`agent.*`）、LLM 代理（`llm.*`）以后再加。

## 1. 传输

- WebSocket，地址 `ws://<MaiBot 所在主机>:<插件端口>/ws`，插件端口默认 `18100`（在 MaiBot WebUI 的插件设置页修改）。
  Docker 部署要在 docker-compose 里映射这个端口。
- 每个**文本帧**是一个 UTF-8 编码的 JSON 对象，形如 `{"type": "...", ...}`。二进制帧不使用，收到就关闭连接（1003）。
- 单帧最大 16 MB（与 MaiBot 插件网关的帧上限一致），超过就关闭连接（1009）。
- 心跳用 WebSocket 自带的 ping/pong：双方都可以发 ping，对方自动回 pong。协议里没有应用层心跳。
- v0 不加密（`ws://`），只在局域网或 Tailscale 这类私有网络里用，不要暴露到公网。

## 2. 通用规则

- `type` 是必填的字符串。**收到不认识的 `type` 时忽略并记日志，不断开**，这样以后加新消息类型不会让旧版本断线。
- 字段多出来的忽略；必填字段缺失或类型不对，按第 6 节的 `invalid` 处理。
- 所有 `id` 都是字符串。客户端生成的 id 用 UUID。
- 文中的"客户端"指桌宠，"服务端"指插件。

## 3. 握手

连接建立后，客户端**第一帧必须是 `hello`**。服务端在 10 秒内没收到 `hello`，或第一帧不是 `hello`，就以 4000 关闭。

### `hello`（客户端 → 服务端）

```json
{
  "type": "hello",
  "protocol": 0,
  "token": "…",
  "device_id": "1b4e28ba-…",
  "device_name": "MacBook",
  "client": { "name": "coopet", "version": "0.0.0" }
}
```

| 字段 | 说明 |
|---|---|
| `protocol` | 客户端说的协议版本，v0 为 `0` |
| `token` | 插件配置里的 token |
| `device_id` | 设备的固定 id（首次启动生成后保存在本地） |
| `device_name` | 给人看的设备名，只用于日志 |
| `client` | 客户端名称和版本，只用于日志 |

### `welcome`（服务端 → 客户端）

```json
{
  "type": "welcome",
  "protocol": 0,
  "bot": { "name": "麦麦", "account_id": "coopet-maibot" },
  "user": { "id": "owner", "nickname": "主人" }
}
```

| 字段 | 说明 |
|---|---|
| `bot.name` | MaiBot 设置里的 `bot.nickname`，客户端用它显示名字 |
| `bot.account_id` | 麦麦在 coopet 平台上的账号（插件配置） |
| `user` | 客户端在 MaiBot 里的身份（插件配置）。身份由插件决定，客户端不用自己配 |

收到 `welcome` 才算连上，之后才能发 `chat`。

### 握手失败

服务端先发一帧 `error`（见第 6 节），再关闭连接：

| 情况 | `error.code` | 关闭码 |
|---|---|---|
| 超时或第一帧不是 `hello` | `handshake` | 4000 |
| token 不对 | `unauthorized` | 4001 |
| 协议版本不支持 | `protocol_unsupported` | 4002 |

### 单设备

v0 同一时间只接一台设备。有新设备握手成功时，服务端以 **4003** 关闭旧连接（`error.code` 为 `replaced`）。

## 4. 聊天

### `chat`（客户端 → 服务端）：你说的话

```json
{ "type": "chat", "id": "6f9619ff-…", "text": "今天好累" }
```

`text` 是去掉首尾空白后非空的字符串。服务端把它当作主人（`welcome.user`）在 coopet 平台的私聊消息交给 MaiBot。

### `ack`（服务端 → 客户端）：MaiBot 收没收下

每条 `chat` 对应一条 `ack`，`id` 与 `chat.id` 相同。

```json
{ "type": "ack", "id": "6f9619ff-…", "ok": true }
{ "type": "ack", "id": "6f9619ff-…", "ok": false, "error": { "code": "rejected", "message": "…" } }
```

`ok: true` 表示 MaiBot 已经收下这条消息（插件调用 `route_message` 返回成功），**不表示一定会回复**：
MaiBot 的 planner 可能决定不回。失败时的 `error.code` 见第 6 节（`not_ready`、`rejected`、`invalid`）。

客户端发出 `chat` 后 10 秒没收到 `ack`，按失败处理。

### `reply`（服务端 → 客户端）：麦麦说的话

```json
{
  "type": "reply",
  "id": "send_api_1731400000123",
  "parts": [
    { "kind": "text", "text": "辛苦啦" },
    { "kind": "emoji", "mime": "image/png", "base64": "iVBORw0…" }
  ]
}
```

| `parts[].kind` | 字段 | 说明 |
|---|---|---|
| `text` | `text` | 文字 |
| `image` | `base64`，可选 `mime` | 图片 |
| `emoji` | `base64`，可选 `mime` | 表情包 |
| `other` | `type` | 客户端暂不显示的内容，`type` 为 MaiBot 的段类型（voice、file、at、reply、forward 等） |

- `id` 是 MaiBot 给这条消息的 id，可能为空字符串。
- MaiBot 一次回复可能分成好几条 `reply` 发来，也可能在你没说话时主动发来。客户端逐条显示，不要假设一问一答。

### `thinking`（服务端 → 客户端）：麦麦在想

```json
{ "type": "thinking", "on": true }
```

- `on: true`：MaiBot 开始为主人的 coopet 会话生成回复（插件收到 `maisaka.replyer.before_request` Hook）。
- `on: false`：回复已经发出，或生成结束（`maisaka.replyer.after_response` Hook），或服务端 120 秒内没等到回复。
- planner 决定不回复时 replyer 不会启动，所以**不会**收到 `on: true`。

## 5. 关闭

| 关闭码 | 谁发 | 含义 | 客户端是否自动重连 |
|---|---|---|---|
| 1000 | 双方 | 正常关闭 | 客户端主动关闭时不重连；服务端关闭（如插件停用）时重连 |
| 1003 | 服务端 | 收到二进制帧 | 重连 |
| 1009 | 服务端 | 帧超过 16 MB | 重连 |
| 4000 | 服务端 | 握手超时或第一帧不是 `hello` | 重连 |
| 4001 | 服务端 | token 不对 | **不重连**，提示检查 token |
| 4002 | 服务端 | 协议版本不支持 | **不重连**，提示升级 |
| 4003 | 服务端 | 被新设备顶替 | **不重连**，避免两台设备互相顶 |
| 其他 / 网络断开 | — | — | 重连 |

重连的等待时间：1 秒起，每次翻倍，最长 30 秒，连上后重置。

## 6. 错误

```json
{ "type": "error", "code": "unauthorized", "message": "token 不对" }
```

`message` 只给人看，程序按 `code` 判断。

| `code` | 出现在 | 含义 |
|---|---|---|
| `handshake` | `error` | 握手超时或第一帧不是 `hello` |
| `unauthorized` | `error` | token 不对 |
| `protocol_unsupported` | `error` | 协议版本不支持 |
| `replaced` | `error` | 被新设备顶替 |
| `invalid` | `error` 或 `ack.error` | 消息格式不对（`chat` 格式不对时回 `ack`，其他情况回 `error`，不断开） |
| `not_ready` | `ack.error` | 插件的消息网关还没就绪 |
| `rejected` | `ack.error` | MaiBot 没有收下这条消息 |

## 7. 预留

以下 `type` 前缀留给以后，v0 的两端都不发送，收到按"不认识的 type"忽略：

- `agent.*`：本地 Agent 的任务派发与回报（阶段 4）
- `llm.*`：经插件借用 MaiBot 的模型（阶段 4）

## 8. 一次完整的对话

```
客户端                                   服务端（插件）                 MaiBot
  │── hello{protocol:0, token, …} ───────▶│
  │◀─ welcome{bot, user} ──────────────────│
  │── chat{id:A, text:"今天好累"} ────────▶│── route_message ───────────▶│
  │◀─ ack{id:A, ok:true} ──────────────────│◀─ 收下 ─────────────────────│
  │                                        │◀─ replyer.before_request ───│
  │◀─ thinking{on:true} ───────────────────│
  │                                        │◀─ 网关出站：辛苦啦 ─────────│
  │◀─ reply{parts:[text "辛苦啦"]} ─────────│
  │◀─ thinking{on:false} ──────────────────│
```
