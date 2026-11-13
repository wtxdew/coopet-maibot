# Coopet

Coo 风格的桌宠客户端，大脑是 [MaiBot](https://github.com/Mai-with-u/MaiBot)：桌宠住在你的桌面上，你在桌宠里说的话交给 MaiBot，
麦麦的回复、思考状态和表情在桌宠的气泡里显示。

- **桌宠**：基于 [Coopanion](https://github.com/Pal-AI-Lab/Coopanion) 的桌宠 World（形象、换装、互动、音效）。
- **设置窗**：Coopanion 的设置界面，开始（连接 MaiBot）、习惯、装扮、对话、World 扩展、运行诊断。
- **World 扩展**：可以加载 [Cortico](https://github.com/Pal-AI-Lab/Cortico) 格式的 World 扩展。内置
  [Coding Agent 通知](https://github.com/ThermalEng/coopanion-agent-notify-world)：Claude Code、Codex 等跑完一轮任务后，桌宠告诉你。
- **MaiBot 插件**：[`plugins/coopet-adapter`](plugins/coopet-adapter/README.md)，部署在 MaiBot 那边，桌宠通过它连上来。

设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，进度见 [docs/ROADMAP.md](docs/ROADMAP.md)。

## 安装

### 1. 在 MaiBot 上装插件

照 [`plugins/coopet-adapter/README.md`](plugins/coopet-adapter/README.md) 做：拷贝插件目录、（Docker 部署时）映射端口、
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

Windows 上把路径换成安装目录里的 `Coopet.exe`。扩展的代码在 Coopet 的核心进程里运行，权限和 Coopet 一样，只装你信任的扩展。
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

macOS 上打出 `.dmg` 和 `.zip`（`PACK_ARCH=x64` 可以打 Intel 版）；Windows 安装包要在 Windows 上运行 `pack`。

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
