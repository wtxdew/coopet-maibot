# Coopet Roadmap（v0.2，2026-11-12）

架构见 [ARCHITECTURE.md](ARCHITECTURE.md)。每个阶段都有完成标准，达到后再进下一阶段。

## 阶段 0：准备（半天）

- [x] 核对 NAS：MaiBot 1.4.3、SDK 2.22.1、maim-message 0.6.8、WebUI 映射 18001、replyer Hook 存在（2026-11-12）
- [x] Bot ID：`<BOT_ID>`（麦麦）
- [ ] 在 MaiBot 配置 maim_message 的 token，给原型用（现状：`auth_token` 为空，所以旧版 WS 目前拒绝所有连接；现有适配器全是插件，不受影响；改 token 预计要重启 Bot）
- [x] 本机环境：Node 24.5、corepack pnpm 11.28.6、Electron 44.4.4
- [x] 建仓：pnpm workspace；`packages/cortico-world-desktop-pet`、`packages/cortico-provider-coo`、`shared/ui` 从 Coopanion vendored，
  `vendor/cortico` 为子模块（钉在 Coopanion 用的 0.2.14），来源记录在 `UPSTREAM.md`；LICENSE 为 AGPL-3.0
- [x] 桌宠包单独通过：`pnpm run test:pet`（27 个文件，317 通过、1 跳过）、`pnpm run typecheck:pet`

**完成标准**：`pet/` 能单独 `pnpm test` 通过；用 token 能连上 `/maim/{bot_id}/ws`。

## 阶段 1：原型（2–4 天）——自建客户端简化版 + maim_message

- [ ] 逐项验证嵌入耦合点（`cortico` 包、`WorldContext` 替身、窗口进程）
- [ ] 让 `DesktopPetWorld` 脱离 Cortico 启动（CUA 关、配置走 JSON 文件），代码里直接调 `pet_say` 能冒气泡、做表情
- [ ] TS 版 maim_message 旧协议客户端：收发文本
- [ ] Conductor：打字或语音 → MaiBot；MaiBot 回复 → `pet_say`；客户端猜测的思考动画
- [ ] 表情 E1：规则映射
- [ ] 戳、摸、甩只做本地反应

**完成标准**：在 Mac 上和麦麦正常聊十分钟，体验可接受；记下回复节奏、延迟、表情映射的问题。

## 阶段 2：适配器插件（3–5 天）

- [ ] 定稿协议 v0（`docs/PROTOCOL.md`）
- [ ] 插件骨架：manifest、配置（端口、令牌、主人 user_id）、自起 WS 服务、`MessageGateway` 双向收发
- [ ] 多连接：Mac 和 Win 同时在线，共享同一聊天流
- [ ] replyer Hook → `thinking`
- [ ] docker-compose 映射端口，部署到 NAS
- [ ] 客户端 `link/` 换成插件协议；maim_message 实现保留为备选

**完成标准**：两台设备同时在线，任意一台说话，两边都能看到回复；思考动画准确。

## 阶段 3：客户端产品化（1–2 周）

- [ ] Electron 外壳：主进程 + core 子进程、单实例、托盘、开机自启、日志、崩溃重启
- [ ] 配置窗：连接（地址、令牌、测试连接）、桌宠（名字、形象、大小）、语音（识别引擎、热键）、表情规则
- [ ] 复用桌宠自带的装扮页和形象包导入
- [ ] 打包 macOS arm64、Windows x64
- [ ] 断线重连、离线提示；没确认的消息不自动重发

**完成标准**：在一台干净的机器上安装、填好地址就能用。

## 阶段 4：World 运行时与本地 Agent

- [ ] `runtime/`：自己的 World 契约（工具 + 事件 + 环境说明 + 配置段）
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
- [ ] （可选）E3：让麦麦自己写标记
- [ ] 主动发言、提醒的展示

## 阶段 7（可选）：作为 MaiBot 的外接 sub-agent（ACP）

见 ARCHITECTURE.md §4.1.1。

- [ ] Agent 增加 ACP v1 stdio 入口（`initialize`、`session/new`、`session/prompt`、`session/update` 流式输出，之后再做 `session/resume`）
- [ ] MCP 客户端：连接 MaiBot 提供的工具服务（`agent_talk` 等）
- [ ] 在 Mac 上用 MaiBot 的 `connection = "custom"` + SSH 跑通；评估 Windows（OpenSSH 服务）
- [ ] 决定与 `coopet_agent_task` 并存还是替代

**完成标准**：MaiBot 的独立 Agent 页面能看到本地 Agent 的执行记录，任务结果经 `agent_talk` 回到聊天。

## 以后再说

- 更多自己的 World（终端、浏览器、日历…）
- 手机端
- 跟进上游桌宠 World 的新功能
