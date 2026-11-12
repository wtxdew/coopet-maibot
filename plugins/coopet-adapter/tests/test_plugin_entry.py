from coopet_adapter import plugin as plugin_mod


def test_create_plugin():
    plugin = plugin_mod.create_plugin()
    assert type(plugin).__name__ == "CoopetAdapterPlugin"
    assert plugin_mod.PLATFORM == "coopet"
