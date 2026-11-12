import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_package():
    """按 MaiBot 的方式把插件目录当作一个包加载（目录名带连字符，不能直接 import）。"""
    name = "coopet_adapter_under_test"
    spec = importlib.util.spec_from_file_location(name, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
    pkg = importlib.util.module_from_spec(spec)
    sys.modules[name] = pkg
    spec.loader.exec_module(pkg)
    return importlib.import_module(f"{name}.plugin")


def test_create_plugin():
    plugin_mod = load_package()
    plugin = plugin_mod.create_plugin()
    assert type(plugin).__name__ == "CoopetAdapterPlugin"
    assert plugin_mod.PLATFORM == "coopet"
