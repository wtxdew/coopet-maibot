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

先只做单台设备的适配；多设备见文末「以后再说 → 多设备」。

- [x] 定稿协议 v0（2026-11-12；现在在插件仓库的 `PROTOCOL.md`）
- [x] 插件骨架（当时在 `plugins/coopet-adapter/`，现在是单独的仓库 wtxdew/maibot-coopet-adapter）：manifest、配置（端口、令牌、主人 user_id，在 MaiBot WebUI 的插件页修改）、
  自起 WS 服务、`MessageGateway` 双向收发（2026-11-12 在 NAS 上验证往返）
- [x] replyer Hook → `thinking`（2026-11-12 真实聊天可用）
- [x] Bot 名字改为取 MaiBot 的设置（`bot.nickname`）：插件在握手时下发，客户端本地的 `botName` 只作连不上时的后备
- [x] docker-compose 映射端口，部署到 NAS（2026-11-12）
- [x] 客户端 `link/` 换成插件协议；maim_message 实现保留为备选（`link.kind` 切换；2026-11-12 在 NAS 上验证往返）

- [x] 客户端日志：毫秒时间、每轮对话的时间线（输入、收下、思考、回复、气泡）、连接事件、按天的日志文件（保留 7 天）、`log.level`
- [ ] 评估聊天体验：在 Mac 上和麦麦正常聊十分钟，记下回复节奏、延迟、表情映射的问题（设置窗「运行诊断」有每轮时间线和回复延迟的中位数）
- [ ] 不再需要旧版 WS 时，删掉 `bot.platforms` 里的 `coopet:coopet-maibot`

**完成标准**：经插件聊天正常；思考动画准确；聊天体验可接受。

## 阶段 3：客户端产品化（1–2 周）

- [x] Electron 外壳（`packages/coopet-app`，`corepack pnpm app`）：主进程 + core 子进程 + 桌宠窗口进程、单实例、托盘、
  开机自启（打包后可用）、崩溃重启；外壳被强杀时核心自动退出（2026-11-12 冒烟测试通过，托盘已实际确认）
- [x] 配置窗（托盘「设置…」或桌宠菜单）：连接（方式、地址、token、测试连接）、World（桌宠设置按它自带的配置说明书生成，
  即时项马上生效）、对话（互动记录，只显示）、日志与通用；事件记录写进文件，重启后对话页仍有历史
  （2026-11-13，界面待你确认）。语音、表情规则以后再加
- 配置窗换成 Coopanion 的前端（`console/`，原样拷入；核心用 Cortico 的 WebApp 提供接口，外壳照 Coopanion 拦截转发）：
  - [x] 第一期：开始（我的桌宠、配色）、习惯、装扮、对话、World 页（2026-11-13，在真实外壳里逐页截图检查，界面待你确认）
  - [x] 第二期：开始页的「连接 MaiBot」卡（保存后不重启就换连接）；界面语言（11 种，默认跟系统，托盘和桌宠菜单跟着换）；
    精简习惯页和用不到的按钮；Coopet 字标；窗口外观照 Coopanion（隐藏系统标题栏、记住大小、开机自启）；
    托盘和桌宠菜单的装扮、对话、World 打开设置窗对应页面；删掉旧的手写设置页和 IPC 设置通道（2026-11-13，在真实外壳里检查过，界面待你确认）
  - [x] 第三期：运行诊断页（运行状态卡、对话统计、事件流、运行日志、日志设置、导出诊断包）；每次运行一份结构化日志
    （Cortico 格式，保留 7 天），文本日志照旧；日志级别马上生效（2026-11-13，在真实外壳里检查过）
- [x] World 扩展（从阶段 4 提前，先于本地 Agent）：加载 Cortico 格式的 World 扩展；第一个用第三方的
  `cortico-world-coding-agent-notify`（ThermalEng，Claude Code 等 Coding Agent 完成后通知）；
  Conductor 按来源路由事件（桌宠直接说 / 交给麦麦 / 不处理）。原定的本地 WebHook 不做：笔电收不到外部请求。
  2026-11-13：扩展目录 `~/.config/coopet/extensions`、`ext add/remove/list` 命令、设置窗里的启用开关和面板、
  「桌宠直接说」的路由都已完成，Claude Code 完成通知实测可用
- [ ] World 扩展第二步：通知交给麦麦（协议加 `notice`、插件更新，或借 MaiBot 的回复生成器转述，先查清接口）；
  扩展名字和图标跟着界面语言和扩展自带的图标
- [x] 复用桌宠自带的装扮页和形象包导入（托盘「装扮…」打开 `/dress`）
- [x] 打包 macOS arm64（2026-11-13，v0.1.0：`corepack pnpm run pack`；临时签名；数据目录换成各系统惯例位置并从
  `~/.config/coopet` 拷贝；内置 Coding Agent 通知扩展；`Coopet --ext` 装扩展；在本机用全新 HOME 和真实数据各验证一次）
- [x] 打包 Windows x64（2026-11-13：在 Windows 上原生 `pack` 并实测；也可以在 macOS 上 `PACK_PLATFORM=win32` 交叉构建；
  NSIS 按用户安装）
- [x] 断线重连、离线提示；没确认的消息不自动重发（阶段 1、2 的 link 与 Conductor 已实现；托盘显示连接状态）
- [x] 插件拆成单独的仓库 [wtxdew/maibot-coopet-adapter](https://github.com/wtxdew/maibot-coopet-adapter)（2026-11-13，
  `git subtree split` 保留历史；协议文档一起移过去；发布 v0.1.0）
- [ ] 插件上 MaiBot 官方插件市场（Mai-with-u/plugin-repo：开「Add Plugin」Issue，等校验和审核）
- [x] 外部通知：ntfy World 扩展（2026-11-14，[wtxdew/cortico-world-ntfy](https://github.com/wtxdew/cortico-world-ntfy)，npm 0.1.0，
  内置、默认启用）：一条长连接订阅所有话题，不轮询；断线按消息 id 补拉，离线时收到的只记录不念；话题是「片段_随机码」，
  每个话题有去向。经 ntfy.sh 实测：curl → 桌宠说出来
- [x] 通知路由改成每个扩展三项（处理方式：桌宠 / 麦麦 / 规则 / 关闭；认不得的通知；最多念多少字），通知排队、同一来源合并（2026-11-14）
- [ ] 自动更新（2026-11-14 代码完成，照 Coopanion 的 updater）：Windows 后台下载、静默安装；macOS 标题栏提示新版本。
  实测待做：要有两个正式 Release（0.1.2 手动装上后，等下一个版本）

**完成标准**：在一台干净的机器上安装、填好地址就能用。

## 阶段 4：World 运行时与本地 Agent

- [x] `runtime/`：World 契约直接用 Cortico 的（WorldDefinition / World / WorldHost），`runtime/worlds.ts` 托管扩展 World（2026-11-13，随 World 扩展完成）
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
- [x] MaiBot 回复文字的转义（2026-11-13，expr/escape.ts，按桌宠脚本的规则只换会被吃掉的写法）：桌宠脚本没有转义机制，回复里的 `【…】` 和短的 `<…>`、`＜…＞` 会被当成动作标记吃掉；
  显示前换成不会被解析的相似字符（如 `〖〗`、`‹`、`﹤`）

## 阶段 7（可选）：作为 MaiBot 的外接 sub-agent（ACP）

见 ARCHITECTURE.md §4.1.1。

- [ ] Agent 增加 ACP v1 stdio 入口（`initialize`、`session/new`、`session/prompt`、`session/update` 流式输出，之后再做 `session/resume`）
- [ ] MCP 客户端：连接 MaiBot 提供的工具服务（`agent_talk` 等）
- [ ] 在 Mac 上用 MaiBot 的 `connection = "custom"` + SSH 跑通；评估 Windows（OpenSSH 服务）
- [ ] 决定与 `coopet_agent_task` 并存还是替代

**完成标准**：MaiBot 的独立 Agent 页面能看到本地 Agent 的执行记录，任务结果经 `agent_talk` 回到聊天。

## 以后再说

### 多设备（小众需求，先放下）

插件现在只留一台设备在线：新设备连上时顶替旧的（旧的收到 `replaced`、以 4003 关闭，不再重连）。这是有意的设计。

- 被顶替后待机、交互时抢回连接：被顶替的设备不重连，托盘显示「在另一台设备上」；在这台发文字（或会发给 MaiBot 的互动）时
  先重连、顶掉另一台，连上后再发。纯本地的动作（拖动、换装）不触发。只改客户端
- 设备间转发通知：例如用 Remote Control 在 Windows 上操作 Mac 的 Claude Code 会话，hook 在 Mac 上执行，通知只到 Mac 的桌宠。
  轻量做法：不在线的设备开一个只发通知、不顶替的临时连接，插件把通知转给在线的那台；要改协议和插件。
  ntfy 扩展做好后可以直接解决（Mac 上的 hook 发到 ntfy，在线的那台订阅）
- 多设备同时在线（Mac 和 Win 共享同一聊天流；一台说的话同步显示到另一台）。上下文由 MaiBot 自己记录；
  这等于把 MaiBot 当平台用，和它的逻辑相反，有明确需求再考虑

### 其他

- 部署说明分三种：Docker（插件端口要在 docker-compose 映射）、Windows 和 macOS 直接部署（不用额外设置）；
  目前文档只写了 Docker 的情况
- 改过或自己写的 World 扩展拆成单独的仓库，并标明来源和许可（例如 fork agent-notify 时注明来自 ThermalEng）；不放进客户端仓库
- 不同平台的同一个人合并成一个身份（MaiBot 本体没有这个功能，需要另写 MaiBot 插件）；
  目前 coopet 上的"主人"（`owner`）和 QQ 上的账号在 MaiBot 看来是两个人，记忆和印象不共享
- 更多自己的 World（终端、浏览器、日历…）
- 手机端
- 跟进上游桌宠 World 的新功能
