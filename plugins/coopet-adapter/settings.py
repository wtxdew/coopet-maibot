"""插件配置模型；在 MaiBot WebUI 的插件设置页修改。"""

from typing import ClassVar

from maibot_sdk import Field, PluginConfigBase


class PluginSettings(PluginConfigBase):
    __ui_label__: ClassVar[str] = "插件"
    __ui_order__: ClassVar[int] = 0

    enabled: bool = Field(default=False, description="启用 Coopet 桌宠连接")
    config_version: str = Field(default="0.1.0", description="配置版本")


class ServerSettings(PluginConfigBase):
    __ui_label__: ClassVar[str] = "连接"
    __ui_order__: ClassVar[int] = 1

    host: str = Field(default="0.0.0.0", description="监听地址；0.0.0.0 表示所有网卡")
    port: int = Field(
        default=18100, ge=1024, le=65535,
        description="监听端口；Docker 部署要在 docker-compose 里映射这个端口",
    )
    token: str = Field(
        default="",
        repr=False,
        description="桌宠客户端连接时用的 token；留空时不启动服务",
        json_schema_extra={"x-widget": "password"},
    )


class IdentitySettings(PluginConfigBase):
    __ui_label__: ClassVar[str] = "身份"
    __ui_order__: ClassVar[int] = 2

    bot_account_id: str = Field(default="coopet-maibot", description="麦麦在 coopet 平台上的账号")
    owner_user_id: str = Field(default="owner", description="主人在 coopet 平台上的 user_id")
    owner_nickname: str = Field(default="主人", description="麦麦怎么称呼主人")


class AdapterSettings(PluginConfigBase):
    plugin: PluginSettings = Field(default_factory=PluginSettings)
    server: ServerSettings = Field(default_factory=ServerSettings)
    identity: IdentitySettings = Field(default_factory=IdentitySettings)
