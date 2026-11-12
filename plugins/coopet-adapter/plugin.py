"""Coopet 桌宠适配器（骨架）：目前只加载配置、记日志；WS 服务和消息网关在后续提交里加。"""

from typing import ClassVar, Optional, Type

from maibot_sdk import MaiBotPlugin, PluginConfigBase

from .settings import AdapterSettings

PLATFORM = "coopet"


class CoopetAdapterPlugin(MaiBotPlugin):
    config_model: ClassVar[Optional[Type[PluginConfigBase]]] = AdapterSettings

    async def on_load(self) -> None:
        if not self.config.plugin.enabled:
            self.ctx.logger.info("Coopet 适配器未启用")
            return
        self.ctx.logger.info("Coopet 适配器已加载（骨架，尚未提供服务）")

    async def on_unload(self) -> None:
        self.ctx.logger.info("Coopet 适配器已卸载")


def create_plugin() -> CoopetAdapterPlugin:
    return CoopetAdapterPlugin()
