# Coopet Roadmap（v0.2，2026-11-12）

架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。每个阶段都有完成标准，达到后再进下一阶段。

## 阶段 0：准备（半天）

- [x] 核对 NAS：MaiBot 1.4.3、SDK 2.22.1、maim-message 0.6.8、WebUI 映射 18001、replyer Hook 存在（2026-11-12）
- [x] Bot ID：`<BOT_ID>`（麦麦）
- [x] 在 MaiBot 配置 maim_message 的 token，给原型用（token 只在启动时读取，改完要重启 Bot；另需 `bot.platforms` 登记
  `coopet:coopet-maibot`，热重载生效。见 ARCHITECTURE.md §2.3）
- [x] 连通性测试：`scripts/maim-ping.ts` 发 `/list chat`，收到 MaiBot 的无权限提示（不经 LLM）（2026-11-12）
- [x] 本机环境：Node 24.5、corepack pnpm 11.28.6、Electron 44.4.4
- [x] 建仓：pnpm workspace；`packages/cortico-world-desktop-pet`、`packages/cortico-provider-coo`、`shared/ui` 从 Coopanion vendored，
  `vendor/cortico` 为子模块（钉在 Coopanion 用的 0.2.14），来源记录在 `UPSTREAM.md`；LICENSE 为 AGPL-3.0
- [x] 桌宠包单独通过：`pnpm run test:pet`（27 个文件，317 通过、1 跳过）、`pnpm run typecheck:pet`

**完成标准**：`pet/` 能单独 `pnpm test` 通过；用 token 能连上 `/maim/{bot_id}/ws`。

## 阶段 1：客户端核心（2–4 天）——桌宠跑起来 + maim_message 临时连接

目的是把客户端核心建起来、让桌宠在 Mac 上跑起来；maim_message 只是一根临时测试线，用来验证 `link/` 接口，
不追求这个阶段的聊天体验。运行方式按方向 B（ARCHITECTURE.md §3.3）：脱离 Cortico Core 的主循环，Cortico 只作为代码库使用。

- [x] 逐项验证嵌入耦合点（`cortico/*` 导入、`WorldContext` 替身、窗口进程）：绕过 `definition.ts` 后只需 WorldHost 的 7 个成员加 3 个回调
- [x] `runtime/` 托管 `DesktopPetWorld`（CUA 关、配置走 JSON 文件），代码里直接调 `pet_say` 能冒气泡、做表情
- [x] 桌宠网页产物在 `dev` 前自动构建（`build:pet`），换装页可用
- [x] Conductor 骨架：World 事件 → Link；Link 消息 → `pet_say`
- [x] 戳、摸、甩只做本地反应（桌宠页面自带，不需要写代码）
- [x] 表情 E1：规则映射（只输出英文 `<id>` 标记）
- [x] `link/` 接口 + maim_message 旧版实现（从 `scripts/maim-ping.ts` 抽出类型、组包、握手）

**完成标准**：桌宠在 Mac 上显示；输入一句话，经 WS 到达 MaiBot，回复出现在气泡里。✅ 2026-11-12 达成

## 阶段 2：适配器插件（3–5 天）

先只做单台设备的适配；多设备同时在线放到后面。

- [x] 定稿协议 v0（`docs/PROTOCOL.md`，2026-11-12）
- [x] 插件骨架（`plugins/coopet-adapter/`）：manifest、配置（端口、令牌、主人 user_id，在 MaiBot WebUI 的插件页修改）、
  自起 WS 服务、`MessageGateway` 双向收发（2026-11-12 在 NAS 上验证往返）
- [x] replyer Hook → `thinking`（2026-11-12 真实聊天可用）
- [x] Bot 名字改为取 MaiBot 的设置（`bot.nickname`）：插件在握手时下发，客户端本地的 `botName` 只作连不上时的后备
- [x] docker-compose 映射端口，部署到 NAS（2026-11-12）
- [x] 客户端 `link/` 换成插件协议；maim_message 实现保留为备选（`link.kind` 切换；2026-11-12 在 NAS 上验证往返）

- [x] 客户端日志：毫秒时间、每轮对话的时间线（输入、收下、思考、回复、气泡）、连接事件、按天的日志文件（保留 7 天）、`log.level`
- [ ] 评估聊天体验：在 Mac 上和麦麦正常聊十分钟，记下回复节奏、延迟、表情映射的问题（日志文件可用来定位延迟）
- [ ] 不再需要旧版 WS 时，删掉 `bot.platforms` 里的 `coopet:coopet-maibot`

**完成标准**：经插件聊天正常；思考动画准确；聊天体验可接受。

## 阶段 3：客户端产品化（1–2 周）

- [x] Electron 外壳（`packages/coopet-app`，`corepack pnpm app`）：主进程 + core 子进程 + 桌宠窗口进程、单实例、托盘、
  开机自启（打包后可用）、崩溃重启；外壳被强杀时核心自动退出（2026-11-12 冒烟测试通过，托盘已实际确认）
- [ ] 配置窗：连接（地址、令牌、测试连接）、桌宠（名字、形象、大小）、语音（识别引擎、热键）、表情规则
- [x] 复用桌宠自带的装扮页和形象包导入（托盘「装扮…」打开 `/dress`）
- [ ] 打包 macOS arm64、Windows x64
- [x] 断线重连、离线提示；没确认的消息不自动重发（阶段 1、2 的 link 与 Conductor 已实现；托盘显示连接状态）

**完成标准**：在一台干净的机器上安装、填好地址就能用。

## 阶段 4：World 运行时与本地 Agent

- [ ] `runtime/`：自己的 World 契约（工具 + 事件 + 环境说明 + 配置段）
- [ ] 评估 Agent 是否直接用 Cortico Core 跑（它本来就是 LLM + 工具循环），还是自己写循环；和你讨论后定
- [ ] `agent/`：LLM 工具循环（中断、步数上限、超时、日志）
- [ ] 模型来源：插件 LLM 代理（`ctx.llm.generate_with_tools`）和直连 API 两种
- [ ] 插件 `coopet_agent_task`（异步回执，结果作为内部消息送回聊天流）
- [ ] 桌宠上直接下任务的入口
- [ ] 先写一两个自己的 World 验证契约（比如"打开应用 / 查文件"这类低风险的）

**完成标准**：对麦麦说"帮我打开某某"，麦麦交给电脑上的 Agent 执行，结果由麦麦汇报。

## 阶段 5：电脑操作

- [ ] 验证 `ctx.llm.generate_with_tools` 能不能带图片；不行就用直连的视觉模型
- [ ] 开启桌宠 World 的 CUA 工具给 Agent 用，验证 CUA 子进程在嵌入环境下能跑
- [ ] 安全：默认关闭、首次操作确认、需要确认的操作清单、人一碰鼠标键盘就让出、操作日志在配置窗可查

**完成标准**：一个多步的电脑操作任务（例如"在浏览器里查某某并把结果告诉我"）能稳定完成，中途碰鼠标会停下。

## 阶段 6：表情与互动进阶

- [ ] E2：情绪延续，互动先做本地反应
- [ ] 图片、表情包在气泡里显示
- [ ] 扩充 E1 规则表：目前能反应、效果可以，但触发率不高
- [ ] （可选）E3：让麦麦自己写标记。做法：插件在 `maisaka.replyer.before_request` Hook 里按 `session_id` 判断是 coopet 会话，
  才往 `extra_prompt` 追加标签说明和可用词表；只有 coopet 会话每次回复多一百来个 token
- [ ] 主动发言、提醒的展示
- [ ] 戳、摸、甩的信息传给 MaiBot：参考 Coopanion，但不要那么频繁（比如合并、限频、只传有意义的互动），先讨论方案
- [ ] MaiBot 回复文字的转义：桌宠脚本没有转义机制，回复里的 `【…】` 和短的 `<…>`、`＜…＞` 会被当成动作标记吃掉；
  显示前换成不会被解析的相似字符（如 `〖〗`、`‹`、`﹤`）

## 阶段 7（可选）：作为 MaiBot 的外接 sub-agent（ACP）

见 ARCHITECTURE.md §4.1.1。

- [ ] Agent 增加 ACP v1 stdio 入口（`initialize`、`session/new`、`session/prompt`、`session/update` 流式输出，之后再做 `session/resume`）
- [ ] MCP 客户端：连接 MaiBot 提供的工具服务（`agent_talk` 等）
- [ ] 在 Mac 上用 MaiBot 的 `connection = "custom"` + SSH 跑通；评估 Windows（OpenSSH 服务）
- [ ] 决定与 `coopet_agent_task` 并存还是替代

**完成标准**：MaiBot 的独立 Agent 页面能看到本地 Agent 的执行记录，任务结果经 `agent_talk` 回到聊天。

## 以后再说

- 部署说明分三种：Docker（插件端口要在 docker-compose 映射）、Windows 和 macOS 直接部署（不用额外设置）；
  目前文档只写了 Docker 的情况
- 多设备同时在线（Mac 和 Win 共享同一聊天流；一台说的话同步显示到另一台）。上下文由 MaiBot 自己记录
- 插件要上 MaiBot 官方插件市场时，拆成独立仓库（市场安装是克隆整个仓库，插件必须在仓库根目录），可用 `git subtree split` 保留历史

- 不同平台的同一个人合并成一个身份（MaiBot 本体没有这个功能，需要另写 MaiBot 插件）；
  目前 coopet 上的"主人"（`owner`）和 QQ 上的账号在 MaiBot 看来是两个人，记忆和印象不共享
- 更多自己的 World（终端、浏览器、日历…）
- 手机端
- 跟进上游桌宠 World 的新功能
