// @ts-check
/**
 * 外壳用到的路径。数据目录和核心一致（coopet-core/src/runtime/config.ts 的 defaultDataRoot，两处写法要一样；
 * tests/paths.test.ts 核对）：设了 COOPET_DATA_DIR 就用它，否则按各系统的惯例位置。
 */
const { homedir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

/** 本包所在目录（开发时 Electron 以它为应用目录启动） */
const APP_ROOT = __dirname;
/** 核心包目录：核心子进程以它为工作目录，tsx 才会读到它的 tsconfig（cortico/* 路径映射） */
const CORE_ROOT = join(APP_ROOT, '..', 'coopet-core');
/**
 * @param {NodeJS.Platform} platform
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 */
function defaultDataRoot(platform = process.platform, env = process.env, home = homedir()) {
  if (env.COOPET_DATA_DIR) return env.COOPET_DATA_DIR;
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Coopet');
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Coopet');
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'coopet');
}
const DATA_DIR = defaultDataRoot();

module.exports = {
  defaultDataRoot,
  APP_ROOT,
  CORE_ROOT,
  CORE_ENTRY: join(CORE_ROOT, 'src', 'main.ts'),
  /**
   * Cortico 的解析钩子（vendor/cortico/src/extensions/runtime.ts）：把任何文件里的 `cortico/…` 导入指到 Cortico 源码。
   * 核心自己的文件靠 tsconfig 的 paths 就行，但打包后桌宠包和扩展在 node_modules 里，tsx 不对那里套用 paths，
   * 所以核心启动时 `--import` 它（Cortico 给引擎子进程也是这么做的）。
   */
  CORTICO_RESOLVER: pathToFileURL(join(APP_ROOT, '..', '..', 'vendor', 'cortico', 'src', 'extensions', 'runtime.ts')).href,
  DATA_DIR,
  LOGS_DIR: join(DATA_DIR, 'logs'),
  /** Electron 自己的数据（Chromium 配置、单实例锁），与桌宠窗口进程分开 */
  ELECTRON_DATA_DIR: join(DATA_DIR, 'electron'),
};
