# 按 MaiBot 的方式把插件目录注册成一个包（目录名带连字符，不能直接 import），
# 测试里用 `from coopet_adapter import protocol` 这样导入；插件内部用相对导入。
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE = "coopet_adapter"

if PACKAGE not in sys.modules:
    spec = importlib.util.spec_from_file_location(PACKAGE, ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
