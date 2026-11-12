# Coopet 桌宠适配器（MaiBot 插件）

让 [Coopet](../../README.md) 桌宠客户端连上 MaiBot。插件在 MaiBot 里自起一个 WebSocket 服务，
桌宠连上来后，你在桌宠里说的话作为"主人在 coopet 平台的私聊"交给 MaiBot，麦麦的回复和思考状态推回桌宠。
协议见 [docs/PROTOCOL.md](../../docs/PROTOCOL.md)。

> 状态：开发中（阶段 2）。功能已写完、单元测试通过，还没在真实的 MaiBot 上验证过。

## 要求

- MaiBot ≥ 1.4.3，插件 SDK ≥ 2.22.0
- 同一时间只接一台桌宠设备

## 安装

1. 把整个 `coopet-adapter` 目录拷到 MaiBot 的插件目录（`<MaiBot>/plugins/coopet-adapter/`）。
2. **Docker 部署才需要**：在 docker-compose 的 MaiBot 服务里映射插件端口（默认 18100），然后重建容器
   （`docker compose up -d <服务名>`；只 `docker restart` 不会让新的端口映射生效）：
   ```yaml
   ports:
     - "18100:18100"
   ```
   Windows / macOS 直接部署不用做这一步。
3. 在 MaiBot WebUI 的插件页打开本插件设置：
   - 「连接」：填一个 token（桌宠客户端要填同一个）；端口按需修改；
   - 「身份」：主人的 user_id 和称呼；
   - 「插件」：打开启用。

只在局域网或 Tailscale 这类私有网络里使用，不要把端口暴露到公网（v0 协议不加密）。

## 开发

```bash
cd plugins/coopet-adapter
uv sync --python 3.13
uv run pytest
```

`pyproject.toml` 只用于本地开发和测试，MaiBot 装插件时只读 `_manifest.json`。

## 许可证

AGPL-3.0-or-later，见 [LICENSE](LICENSE)。
