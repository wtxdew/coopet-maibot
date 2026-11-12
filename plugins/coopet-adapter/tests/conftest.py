# 测试把插件目录当作模块根，直接 import settings、protocol 等；plugin.py 用相对导入，要按包加载时再处理。
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
