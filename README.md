# Coopet

让 [MaiBot](https://github.com/Mai-with-u/MaiBot)（麦麦）住到你的电脑桌面上。Mac / Windows 的桌宠客户端。

Coopet 基于 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion)（Pal-AI-Lab 的 AI 桌宠）：把 Coopanion 的桌宠形象、换装、
互动、音效和设置界面单独拆出来，去掉它自带的模型，改成连 MaiBot，**由麦麦当桌宠的大脑**。你在桌宠里说的话交给麦麦，
麦麦的回复、思考状态和表情在桌宠的气泡和动作里显示。

- **麦麦还是那个麦麦**：名字、人设、记忆、回复风格都按 MaiBot 自己的设置。桌宠只是麦麦在桌面上的一个新"平台"，
  经 MaiBot 插件 [maibot-coopet-adapter](https://github.com/wtxdew/maibot-coopet-adapter)（单独的仓库）连上来。
- **桌宠有自己的身体**：Coopanion 的桌宠 World（形象、换装、形象包导入、互动、音效）。麦麦思考时桌宠做思考动作，
  回复按语气配上表情；戳、摸、甩桌宠在本地直接反应。
- **设置窗**：Coopanion 的设置界面：开始（连接 MaiBot）、习惯、装扮、对话、World 扩展、运行诊断。界面跟系统语言（11 种）。
- **可以扩展**：加载 [Cortico](https://github.com/Pal-AI-Lab/Cortico) 格式的 **World 扩展**，给桌宠接上新的本地能力。
  World 扩展就是一个 npm 包，按 Cortico 的契约声明工具、事件和设置面板，Coopet 负责加载、托管、在设置窗里显示面板，
  并把扩展推出的事件交给桌宠说出来。内置 [Coding Agent 通知](https://github.com/ThermalEng/coopanion-agent-notify-world)
  （ThermalEng）：Claude Code、Codex 等跑完一轮任务后，桌宠告诉你。也可以自己写，见下面的「World 扩展」。
- **以后**：本地 Agent（对麦麦说"帮我打开某某"，由电脑上的 Agent 执行）、外部通知、电脑操作等。

```
┌──────────────── 你的电脑 ────────────────┐                ┌──────── MaiBot 所在主机 ────────┐
│  Coopet                                   │   WebSocket    │                                  │
│  桌宠窗口 ← 核心（Conductor）→ World 扩展 │ ◀───────────▶ │  maibot-coopet-adapter ⇄ MaiBot  │
│            设置窗                         │  局域网 / VPN  │                                  │
└───────────────────────────────────────────┘                └──────────────────────────────────┘
```

设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，进度见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 安装

### 1. 在 MaiBot 上装插件

照 [maibot-coopet-adapter 的 README](https://github.com/wtxdew/maibot-coopet-adapter#安装) 做：在 MaiBot 的插件市场安装（或克隆到插件目录）、（Docker 部署时）映射端口、
在 MaiBot WebUI 的插件页填 token 并启用。

### 2. 装桌宠客户端

从 Releases 下载对应的安装包（或者按下面「从源码构建」自己打包）：

- **macOS（Apple 芯片）**：打开 `Coopet-<版本>-mac-arm64.dmg`，把 Coopet 拖进「应用程序」。
  Coopet 没有 Apple 开发者签名，第一次打开会被拦下：到「系统设置 → 隐私与安全性」，在下面找到 Coopet，点「仍要打开」。
  之后正常打开就行。Coopet 不在 Dock 里，只在菜单栏有图标。
- **Windows（x64）**：运行 `Coopet-Setup-<版本>.exe`，可以选安装位置，不需要管理员权限。
  安装包没有签名，SmartScreen 可能会拦一下：点「更多信息 → 仍要运行」。

### 3. 连上 MaiBot

打开后在菜单栏（Windows 是托盘）的 Coopet 图标里选「设置…」，在「开始」页的「连接 MaiBot」里填插件地址
（形如 `ws://<MaiBot 主机>:18100/ws`）和插件设置里的 token，点「保存并连接」。

### 更新

- **Windows**：自动更新（「习惯」页可以关掉）。有新版本时在后台下载，桌宠会告诉你；点「现在重启更新」，
  或者等下次退出 Coopet，都会静默装上，不会再出现安装向导。
- **macOS**：没有开发者签名，装不了自动更新。有新版本时，设置窗标题栏的版本号旁边会显示「vX 可更新」，
  点开下载新的 dmg，拖进「应用程序」覆盖旧版。

### 数据放在哪

- macOS：`~/Library/Application Support/Coopet`
- Windows：`%APPDATA%\Coopet`

里面有配置、token（权限 600）、日志、事件记录、形象包和扩展。用过开发版的话，第一次启动会把 `~/.config/coopet` 拷贝过来，
旧目录原样保留。

## World 扩展

内置的 Coding Agent 通知默认启用：在设置窗「World 扩展 → Agent 通知」里给 Claude Code 等点「安装 hook」，
它会往那个 Agent 的配置里加一条完成时的 hook（不会改其他设置）。

装别的 Cortico World 扩展（装完重启 Coopet，再在「World 扩展」里启用）：

```bash
# macOS
/Applications/Coopet.app/Contents/MacOS/Coopet --ext add <npm 包名>
/Applications/Coopet.app/Contents/MacOS/Coopet --ext list
```

Windows 上把路径换成安装目录里的 `Coopet.exe`。

自己写扩展：照 Cortico 的 World 契约写一个包（`WorldDefinition`：describe、配置说明、可选的设置面板），开发时用
`--ext add link:/你的扩展目录` 装本地文件夹，改完重启 Coopet 生效。扩展推出的事件按「Coopet 怎么处理它的通知」的设置路由；
认得的事件类型（如 `coding-agent.completed`）有专门的说法，见 `packages/coopet-core/src/conductor/routing.ts`。扩展的代码在 Coopet 的核心进程里运行，权限和 Coopet 一样，只装你信任的扩展。
Cortico 的扩展是为大模型写的，Coopet 没有自己的模型：扩展的通知按「Coopet 怎么处理它的通知」的设置让桌宠说出来，扩展的工具暂时用不上。

## 从源码构建

要求：Node.js 22+，corepack（`corepack enable`）。

```bash
git clone --recurse-submodules <本仓库>
cd coopet-maibot
corepack pnpm install
corepack pnpm app            # 开发运行
corepack pnpm run pack       # 打包到 dist/
```

macOS 上打出 `.dmg` 和 `.zip`（`PACK_ARCH=x64` 可以打 Intel 版）；Windows 上打出 `Coopet-Setup-<版本>.exe`
（也可以在 macOS 上用 `PACK_PLATFORM=win32` 交叉构建）。

发布：两个平台各自打包，传到同一个 GitHub Release，**连同 `latest.yml`（Windows）、`latest-mac.yml` 和 `.blockmap`**，
自动更新靠它们找新版本。Release 要发成正式的（不勾 pre-release）：更新器和标题栏都不认 pre-release。

测试和类型检查：

```bash
corepack pnpm run test:core
corepack pnpm run test:app
corepack pnpm run typecheck:core
```

## 来源与许可

Coopet 以 AGPL-3.0-or-later 发布（见 [LICENSE](LICENSE)）。它使用了这些项目的代码，来源、版本和本地修改记在 [UPSTREAM.md](UPSTREAM.md)：

- [Coopanion](https://github.com/Pal-AI-Lab/Coopanion)（Pal-AI-Lab，AGPL-3.0-or-later）：桌宠 World、设置窗前端、共享界面组件；
- [Cortico](https://github.com/Pal-AI-Lab/Cortico)（Pal-AI-Lab，MIT）：World 契约、扩展加载、WebUI 服务；
- [coopanion-agent-notify-world](https://github.com/ThermalEng/coopanion-agent-notify-world)（ThermalEng，AGPL-3.0-or-later）：
  内置的 Coding Agent 通知扩展，作为 npm 依赖原样使用。
