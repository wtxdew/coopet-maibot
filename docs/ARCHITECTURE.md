# Coopet 架构方案（v0.2，2026-11-12）

> 目标：做一个"我的 Coopanion"——Mac / Windows 桌面上的 Coo 式桌宠客户端，有自己的配置界面；
> 聊天大脑是 NAS 上的 MaiBot，同时客户端本身也是一个能调 LLM、能用电脑工具的本地 Agent。
> `Coopet` 是暂用名。

## 1. 约束（已定）

| # | 约束 |
|---|---|
| 1 | 不让两个 LLM 互相对话（双倍 token）。日常聊天只走 MaiBot |
| 2 | 不用 Coopanion 本体做客户端（不稳定、麻烦）；自建客户端 |
| 3 | 不依赖 MaiBot 官方桌宠远端协议（内部协议，随时破坏） |
| 4 | 采用 Coopanion 仓库内的桌宠 World（0.2.x，AGPL-3.0-or-later）；本项目随之 AGPL |
| 5 | 表情动作复刻 Coo 的做法，先用零 token 的方式 |
| 6 | Mac 与 Windows 共用一个 MaiBot 大脑与记忆 |
| 7 | World 机制只为自己以后开发方便，**不需要兼容现有社区扩展** |
| 8 | 客户端要能作为本地 Agent 调 LLM、调用电脑工具、控制电脑；Agent 只在有任务时运行 |

**部署（2026-11-12 实测）**：NAS = <NAS_IP>，OrbStack Docker，容器 `maim-bot-core`（镜像 `maibot-local:latest`），
**MaiBot 1.4.3、maibot-plugin-sdk 2.22.1、maim-message 0.6.8**；WebUI 映射 `18001:8001`；同机另有 NapCat、AstrBot。
`maisaka.replyer.before_request` Hook 在该版本存在（`src/chat/replyer/maisaka_generator_base.py`）。
Bot ID `<BOT_ID>`（麦麦）。现有适配器（SnowLuma、Discord、Beeper）**全是适配器插件**；
原型用的旧版 WS 已打通（2026-11-12）：`maim_message.auth_token` 已配置，`bot.platforms = ["coopet:coopet-maibot"]`。

## 2. 关键事实（读源码得出）

### 2.1 桌宠 World（`Coopanion/packages/cortico-world-desktop-pet`，0.2.0+）

- 三块：`host/electron-main.cjs`（透明置顶、点击穿透的 Electron 窗）、`web/`（身体、气泡、选项、装扮页、形象包）、
  `src/world.ts`（在 `127.0.0.1:7797` 起页面服务 + WS）。
- **可嵌入**：`DesktopPetWorld` 的构造参数 `DesktopPetWorldOptions` 都是注入式的（`cfg`、`persist`、`botName()`、`language()`、`packRoots()`…）。
- 对 WorldHost 用得很少：`pushEvent`、`store`、`promotePending`、`withdrawPending`、`blob`、`modelFacts`、`log`，
  外加 `onRunPhase`（驱动"思考中"）、`onTurnEnded`、`onEventsSettled`、`outputTap`（不外化任何东西）。
- 大脑接口 = **工具**：`pet_say(script)`、`pet_ask`、`pet_move_to`、`pet_act`、`pet_set`…，
  以及 **电脑操作（CUA）工具**（截图、鼠标、键盘、窗口；人一碰鼠标键盘就让出控制权），由 `cfg.cua.enabled` 开关；
  **事件**：`desktop-pet.speech`（语音）、`.message`（打字）、`.answer`（选项回答）、`.touch`（戳、摸、甩）。

### 2.2 表情动作的两层

1. **本地自主**（页面 JS，不需要大脑）：眨眼、说话时小走动、拖拽/甩出后的物理与转晕、被戳的反应、空闲行为。
2. **语义表情**（Coo 由 LLM 驱动）：`pet_say` 脚本里的标记——`【开心】` 先做动作再开新气泡，`<点头>` 打字到此处时做；
   词表见 `src/script.ts` 的 `VOCAB`；`pet_act` 只做动作不说话。

### 2.3 MaiBot 的接入点

| 接入点 | 性质 |
|---|---|
| **maim_message 旧版 WS**：宿主 `/maim/{bot_id}/ws`（走 18001，不需要新端口），header `platform` + token | 所有外部适配器共用的公共协议，最稳；**每个 `platform` 只保留一条连接**（同名新连接顶掉旧连接） |
| **插件消息网关**：`maibot_sdk.MessageGateway`，`plugin_type: "adapter"` | 官方 Telegram / 微信 / QQ 官方适配器都用它；manifest 锁 host/SDK 版本区间 |
| 插件 `@Tool(platforms="coopet")` | 工具只出现在该平台的聊天里；只能静态声明 |
| 插件 Hook `maisaka.replyer.before_request` | 精确的"开始生成回复"信号 |
| 插件 `ctx.llm.generate / generate_with_tools / transcribe_audio` | **借用 MaiBot 已配置的模型**（按模型任务名或模型名），支持消息列表和工具定义 |
| 官方桌宠远端协议 v1 | ✗ 不用（内部协议、Cookie 登录、每个 Bot 只允许一个连接） |

插件不能把路由挂到 MaiBot 的 Web 端口上，要自己起一个端口（docker-compose 里映射）。

**旧版 WS 客户端的三个前提**（1.4.3 实测，插件不需要后两项）：

1. **token**：`maim_message.auth_token` 不能为空；握手头 `Authorization` 放 token 原文。token 只在启动时读取，改完要重启。
2. **入站消息顶层带 `account_id`**（字符串，Bot 在该平台的账号）和 `scope`（私聊为 `null`）。缺少时 MaiBot 走旧版归属解析并告警，
   回复时找不到发送身份（`get_bot_account`）。这两个字段是 MaiBot 的扩展，不属于 maim_message 的 `MessageBase`。
3. **`bot.platforms` 登记 `平台:账号`**，账号与第 2 条一致。MaiBot 出站统一走 Platform IO：适配器插件自己注册精确路由；
   旧版连接只能用 legacy 后备驱动，而后备驱动只为 `qq_account` 和 `bot.platforms` 里的平台创建（`_sync_legacy_send_drivers`）。
   这一项热重载生效。

## 3. 选型

### 3.1 MaiBot 侧通道

| | **T1：直接说 maim_message** | **T2：自写适配器插件（coopet-adapter）** |
|---|---|---|
| NAS 侧改动 | 只配一个 token | 装插件 + 映射一个端口 |
| 协议控制权 | MaiBot 的公共协议 | 客户端↔插件协议自己定；插件↔MaiBot 走公开 SDK |
| 多设备同时在线 | ✗ 同平台名互踢；换平台名则上下文分裂 | ✓ 多条连接，同一用户 ID → 同一聊天流 |
| "思考中"信号 | ✗ 只能客户端猜 | ✓ replyer Hook |
| 桌宠专属工具 / Agent 委派 | ✗ | ✓ `platforms` 限定 |
| 借 MaiBot 的模型给本地 Agent 用 | ✗ | ✓ `ctx.llm` |
| 工作量 | 小 | 中 |

**结论**：目标是 T2；T1 只用于第一个原型。原型过后 T1 实现保留为备选（不想装插件时也能聊天）。

### 3.2 客户端

自建 Electron 应用，嵌入桌宠 World（C1"Coopanion 本体 + 扩展"已否决）。

### 3.3 桌宠的运行方式：方向 B（2026-11-12 定）

| | A：跑 Cortico Core | **B：Cortico 当库，自己托管 World（选定）** |
|---|---|---|
| 桌宠怎么动 | 只能由"模型"调用 `pet_say`（Persona 不能绕过模型直接调 World 工具） | Conductor 直接调 `pet_say` 等工具的 handler |
| 零 token 聊天 | 要写假 provider，把每次"模型调用"换成问 MaiBot | 天然零 token |
| MaiBot 多条回复、不回、主动发言 | 和 Core 一问一答的模型对不上 | 收到就显示 |
| 桌宠 World 适配 | 零适配 | `runtime/` 提供 WorldContext/WorldHost 的替身（见 §7 耦合点） |
| 多余负担 | 会话、上下文交接、token 计数、记忆，对聊天都没用；多一层子进程通信 | 无 |

- 仍然依赖 Cortico 的代码：桌宠 World 的 `cortico/*` 导入由 `vendor/cortico` 子模块提供；去掉的只是 Core 的主循环。
- 本地 Agent（阶段 4）恰好是"LLM + 工具循环"，届时专门评估是否直接用 Cortico Core 跑。

## 4. 目标形态

```
┌────────────── Mac / Windows：Coopet 客户端 ──────────────┐            ┌──── NAS：MaiBot 1.4.3（Docker） ────┐
│ Electron 主进程（app）                                     │            │                                       │
│  · 托盘、配置窗、单实例、自启动、更新                      │            │ coopet-adapter 插件（Python）         │
│  · 用 CORTICO_DESKTOP_PET_HOST 接管桌宠窗口                │            │  · MessageGateway platform="coopet"   │
│        │ IPC                                               │            │  · 自起 WS 服务 + 令牌，多连接        │
│ Node 子进程（core）                                        │   WS       │  · replyer Hook → thinking            │
│  ┌ Conductor：聊天调度（不调 LLM）  ◀───────────────────────┼───────────▶│  · @Tool coopet_agent_task           │
│  │   用户事件→MaiBot；MaiBot 消息→表情映射→pet_say          │  自定协议  │      (platforms 可配)                 │
│  ├ Agent：有任务时才跑的 LLM 工具循环                       │            │  · LLM 代理：ctx.llm.generate_with_   │
│  │   模型：经插件借 MaiBot 的模型 / 或直连自己的 API        │            │      tools                            │
│  ├ World 运行时（自己的简化契约）                           │            │        │                              │
│  │   ├ desktop-pet（桌宠 + CUA）                            │            │ MaiBot 聊天流 / 记忆 / 人格           │
│  │   └ 以后自己写的 World（文件、终端、浏览器、日历…）      │            └───────────────────────────────────────┘
│  └ Link：与插件的连接（原型期为 maim_message）              │
└────────────────────────────────────────────────────────────┘
```

进程划分照搬 Coopanion 的做法：Electron 主进程负责窗口和界面，World、Conductor、Agent 跑在 Node 子进程里；
桌宠 World 自己会启动 Electron 窗口，嵌入时用 `CORTICO_DESKTOP_PET_HOST` 改由我们的主进程打开。

### 4.1 两条路径：聊天和干活

| | 聊天（常驻） | 干活（按需） |
|---|---|---|
| 谁思考 | MaiBot | 本地 Agent |
| token | 只有 MaiBot 原本的消耗 | 只在有任务时 |
| 触发 | 对桌宠说话、打字、戳 | ① MaiBot 在 coopet 会话里调用 `coopet_agent_task(goal)` 把事交出去；② 用户在桌宠上直接下任务（菜单或前缀，例如"帮我…"） |
| 结果去向 | 气泡 | Agent 把进度和结果作为消息回报给 MaiBot 的同一聊天流，由麦麦用自己的口吻告诉你；需要你确认时用 `pet_ask` 在气泡里问 |

要点：

- **`coopet_agent_task` 是异步的**：工具立刻回执"已交给电脑上的我"，Agent 在客户端执行；完成或失败后，插件把一条带标记的内部消息送进该聊天流，唤醒麦麦去汇报。
  这样 MaiBot 的工具调用不会卡在长任务上（插件工具有超时）。
- **人格只有一个**：Agent 的系统提示词写明"你是麦麦在电脑上的手"，只干活、只报事实，不跟用户闲聊；对用户说话的永远是 MaiBot。
- **模型来源二选一（配置项）**：
  - 经插件调 `ctx.llm.generate_with_tools`：不用在客户端放 API Key，沿用 NAS 上配好的模型（DeepSeek、百炼 VLM 等）；
  - 直连：客户端自己配 OpenAI 兼容或 Anthropic 端点，适合需要更强视觉模型做电脑操作的时候。
    已 vendored 的 `cortico-provider-coo` 就是一个多家模型的客户端（DeepSeek、通义、Kimi、GLM、OpenAI、Anthropic、Gemini…，
    覆盖 Responses、Chat Completions、Messages API），可以考虑复用。
- **安全**：电脑操作默认关闭；开启后每个任务第一次动鼠标键盘前在气泡里确认；人一碰鼠标键盘就让出（桌宠 World 的 CUA 已经实现）；
  危险操作（删文件、付款、发消息）列入需要确认的清单；Agent 每步记日志，配置窗可查看。

### 4.1.1 以后：做成 MaiBot 的外接 sub-agent（ACP）

`coopet_agent_task` 在功能上已经是一个 sub-agent，只是走的是我们自己的插件协议。MaiBot 本身另有一套正式的外接 Agent 机制
（`docs/agent-connections.md`）：「独立 Agent」和实验性的「外接 Planner」用 **ACP v1**（stdio 上的 JSON-RPC：`session/new`、
`session/prompt`、`session/update`，可选 `session/resume`）启动外部 Agent，MaiBot 再以 **HTTP MCP** 把自己的工具（如 `agent_talk`）
提供给它；远程主机通过 SSH 的标准输入输出加反向端口转发连接。

让本地 Agent 实现 ACP 后，MaiBot 可以把它当作原生的外接 Agent 调用，执行记录也显示在 MaiBot 的 WebUI 里。代价：

- 要实现 ACP 服务端和 MCP 客户端；
- 连接方向是 NAS 主动 SSH 到客户端机器（Mac 可以；Windows 要开 OpenSSH 服务），笔记本换网络、休眠时会断；
- 外接 Agent 的会话与工作目录绑定在一台主机上，两台设备要分开配置。

所以先用插件里的 `coopet_agent_task`，ACP 作为 roadmap 后期的可选项。Agent 内部的循环、工具和 World 两边共用，切换时只换入口。

### 4.2 客户端模块

| 模块 | 职责 |
|---|---|
| `pet/` | vendored 桌宠 World（AGPL，记录上游 commit，按 CHANGELOG 合并），尽量不改 |
| `runtime/` | 自己的 World 契约与宿主：`tools()`、`start(host)`、`stop()`、`host.pushEvent`、配置段；对桌宠 World 额外提供它用到的那几个 WorldHost 成员 |
| `conductor/` | 聊天调度：World 事件 → Link；Link 消息 → 表情映射 → 直接调用 `pet_say` / `pet_act` 的 handler；合成 `onRunPhase` 驱动思考动画 |
| `agent/` | LLM 工具循环：收任务 → 组提示词与工具表（来自已启用的 World）→ 调模型 → 执行工具 → 回报；可中断、限步数、限时 |
| `link/` | 与 MaiBot 的连接，接口统一：原型用 maim_message，正式用插件协议 |
| `expr/` | 表情映射（见 §6） |
| `app/` | Electron 主进程：托盘、配置窗、自启动、单实例、日志、打包 |

### 4.3 插件（coopet-adapter）

插件在单独的仓库：[wtxdew/maibot-coopet-adapter](https://github.com/wtxdew/maibot-coopet-adapter)（2026-11-13 从本仓库拆出，为了上 MaiBot 插件市场）。

- manifest：`plugin_type: "adapter"`，`host_application.min_version: "1.4.3"`，`sdk.min_version: "2.22.0"`（以后按需放宽）。
- 出站：`@MessageGateway(name="coopet_gateway", route_type="duplex", platform="coopet")`，消息段转成客户端协议，广播给所有在线连接。
- 入站：客户端消息 → `ctx.gateway.route_message(...)`，固定主人 `user_id`、私聊。
- 思考：`@HookHandler("maisaka.replyer.before_request")`，命中 coopet 会话时推 `thinking`。
- Agent 委派：`@Tool("coopet_agent_task", platforms=[...])`，适用平台可配（默认只有 coopet）。
- LLM 代理：客户端发 `llm.request{messages, tools, task}` → 插件调 `ctx.llm.generate_with_tools` → 回 `llm.result`。
- 安全：令牌鉴权；只在局域网或 Tailscale 开放，不暴露公网。

### 4.4 客户端 ↔ 插件协议（v0 草案，阶段 2 定稿，现在在插件仓库的 [PROTOCOL.md](https://github.com/wtxdew/maibot-coopet-adapter/blob/master/PROTOCOL.md)）

JSON over WebSocket，`{type, id?, ...}`：

- 握手：`hello{version, device_id, token}` → `welcome{version, session}`
- 聊天：上行 `chat{text, images?}`、`touch{kind,count}`、`answer{...}`；下行 `reply{parts}`、`thinking{on}`、`notice{text}`
- Agent：下行 `agent.task{task_id, goal, from}`；上行 `agent.progress{task_id, text}`、`agent.result{task_id, ok, text}`
- LLM 代理：上行 `llm.request{id, messages, tools, task}`；下行 `llm.result{id, ...}`
- 通用：`ack{id, error?}`、`ping/pong`；双方各自声明兼容的协议版本区间

## 5. World 机制（只为自己开发方便）

- 契约参照 Cortico 的 World 但做减法：一个 World = 一组工具 + 可选的事件 + 一段给 Agent 的环境说明 + 一个配置段。
  不做投递档位、事件库、自描述导出、WebUI 面板契约这些。
- 桌宠 World 是唯一的"外来户"，由 `runtime/` 额外提供它需要的 WorldHost 子集；其余 World 都按自己的契约写。
- World 的工具**只给本地 Agent 用**，不直接暴露给 MaiBot：MaiBot 只看到一个 `coopet_agent_task`，
  所以加多少 World 都不会增加 MaiBot 聊天的 token。
- World 的事件可以配置去向：交给 Conductor 转给 MaiBot（例如"下载完成了"），或者只给 Agent。

## 6. 表情方案

都落到 `pet_say` 的脚本标记加 `pet_act`，桌宠不用改；区别只在"标记从哪来"：

| 阶段 | 标记来源 | token |
|---|---|---|
| E1（原型起） | 客户端规则：MaiBot 回复里的 emoji、颜文字、关键词、标点 → `VOCAB`，句首插 `【…】`，句中插 `<…>` | 0 |
| E2 | 情绪延续；互动先做本地反应再等回复 | 0 |
| E3（可选） | 只在 coopet 会话里让麦麦自己写标记（插件工具或按平台的提示词），客户端校验并剥掉未知词 | 少量 |

规则表放在配置文件里，可以在配置窗里调。

## 7. 风险与待核实

| 项 | 处理 |
|---|---|
| **嵌入桌宠 World 的耦合点**（见下表） | 阶段 1 第一步逐项验证 |
| ~~maim_message 旧版报文格式要用 TS 重写~~ | 已完成：`scripts/maim-ping.ts`，对照 0.6.8 的 `message_base.py`，实测通过 |
| 第三方插件 `TommyAAKK.maibot-I-deepseek` 的 companion-gap 把 coopet 会话当 QQ 会话去补抓历史，报错 | 阶段 2 前只读检查它对非 QQ 平台还做了什么（是否调 LLM），再决定处理方式 |
| MaiBot 回复形态：多条、不回、主动发言、图片和表情包 | Conductor 按"消息流"设计，不按一问一答；图片先显示占位 |
| `ctx.llm.generate_with_tools` 能否带图片（电脑操作需要看截图） | 阶段 5 前验证；不行就让 Agent 直连自己的视觉模型 |
| 插件 WS 端口要在 docker-compose 映射 | 阶段 2 修改 `<MaiBot 部署目录>/docker-compose.yml` |
| 上游桌宠 World 有破坏性改动（如 `pet_walk_to` → `pet_move_to`） | vendored + 记录 commit，按 CHANGELOG 合并 |
| 许可证：客户端 AGPL-3.0-or-later；插件跑在 MaiBot（GPL-3.0）里，用 GPL-3.0-or-later 或 AGPL | 建仓时写清 |

### 嵌入桌宠 World 的耦合点

桌宠 World 是为了跑在 Cortico 里写的，有些依赖写在代码里但文档没说清，要我们在 Cortico 之外补上：

| 耦合点 | 具体情况 | 打算怎么处理 |
|---|---|---|
| `cortico/*` 模块导入 | 约 60 处导入：`core/language.ts`（29 处）、`core/types.ts`、`core/util.ts`、`world.ts`、`core/config-schema.ts`、`core/template.ts`、`paths.ts`、`extensions/runtime.ts`、`web/shared/client-panel.ts`、`protocol/open-responses`。在 Cortico 里由模块钩子解析 | 用 `vendor/cortico` 子模块（钉在 0.2.14），tsconfig 路径 `cortico/*` → `vendor/cortico/src/*`，用 tsx 运行 |
| `cortico-provider-coo` 导入 | 只有语音转写服务地址用到它（`src/asr/transcription-api.ts`） | 一起装上，或者打补丁去掉 |
| `WorldContext` 提供的东西 | `persist()` 写回配置、`secret()`/`storeSecret()` 存密钥、`dataDir` 下的 `figures/` 形象包目录、`runtimesRoot()`/`modelsRoot()` 语音模型目录 | `runtime/` 自己实现：配置文件、系统钥匙串或加密文件、应用数据目录 |
| Electron 窗口进程 | World 自己按顺序找 Electron 来启动窗口，嵌入方可以用 `CORTICO_DESKTOP_PET_HOST` 接管 | 由我们的 Electron 主进程打开窗口 |
| 主循环回调 | "思考中"状态和活动记录依赖 Core 调 `onRunPhase`、`onTurnEnded`、`onEventsSettled` | Conductor 按 MaiBot 的消息节奏合成这些调用 |
| 配置面板 | 桌宠的设置面板（语音、装扮等）是 Cortico WebUI 的面板契约，还引用 Coopanion 根目录的 `shared/ui/` | 已把 `shared/ui` 一并 vendored，类型检查通过；配置窗自己做，装扮页是独立页面 `/dress`，可以直接复用 |
| 电脑操作子进程 | CUA 引擎用 `childExecArgv()` 起子进程，依赖 Cortico 的运行时参数 | 阶段 5 验证 |
