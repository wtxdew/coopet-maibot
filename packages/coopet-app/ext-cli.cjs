// @ts-check
/**
 * 安装、卸载、列出 World 扩展（命令行）。开发时由 scripts/ext.mjs 调用（corepack pnpm），
 * 打包后由应用本身的 `--ext` 参数调用（应用里带的 pnpm）：
 *
 *   Coopet --ext list
 *   Coopet --ext add cortico-world-xxx          # npm 上的包
 *   Coopet --ext add link:/path/to/my-world     # 本地文件夹
 *   Coopet --ext remove cortico-world-xxx
 *
 * 扩展目录是数据目录下的 `extensions/`，结构和 Cortico 一样（package.json 的 dependencies + node_modules）。
 * 装完、卸完要重启 Coopet，核心启动时才加载。包是否是合格的 World 扩展，由核心加载时检查并报告。
 * 内置的扩展（例如 Coding Agent 通知）不用装。
 */
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

/**
 * @param {string[]} args 例如 ['add', 'cortico-world-xxx']
 * @param {{
 *   dataRoot: string,
 *   packageManager: string,
 *   pnpm: (pnpmArgs: string[], cwd: string) => number,
 *   log?: (msg: string) => void,
 *   error?: (msg: string) => void,
 * }} deps
 * @returns {number} 退出码
 */
function runExt(args, deps) {
  const log = deps.log ?? ((m) => console.log(m));
  const error = deps.error ?? ((m) => console.error(m));
  const dir = join(deps.dataRoot, 'extensions');
  const file = join(dir, 'package.json');
  const [cmd, ...rest] = args;

  /** 建目录；写上和 Coopet 一样的 pnpm 版本（扩展目录在仓库外，不写的话 corepack 会去拿最新版） */
  const ensureDir = () => {
    mkdirSync(dir, { recursive: true });
    const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { name: 'coopet-extensions', private: true, dependencies: {} };
    if (pkg.packageManager !== deps.packageManager) {
      pkg.packageManager = deps.packageManager;
      writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  };
  const installed = () => {
    try {
      return Object.entries(JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {});
    } catch {
      return [];
    }
  };

  switch (cmd) {
    case 'list': {
      const list = installed();
      log(list.length ? list.map(([name, spec]) => `${name}  ${spec}`).join('\n') : `还没有装扩展（${dir}）`);
      return 0;
    }
    case 'add': {
      if (!rest.length) { error('用法：ext add <包名或 link:路径>'); return 2; }
      ensureDir();
      const code = deps.pnpm(['add', ...rest], dir);
      if (code === 0) log('\n装好了。重启 Coopet 后加载；在设置窗的「World 扩展」里启用。');
      return code;
    }
    case 'remove': {
      if (!rest.length) { error('用法：ext remove <包名>'); return 2; }
      if (!existsSync(file)) { error(`还没有装扩展（${dir}）`); return 1; }
      ensureDir();
      const code = deps.pnpm(['remove', ...rest], dir);
      if (code === 0) log('\n卸好了。重启 Coopet 后生效；它在 config.json 里的设置保留。');
      return code;
    }
    default:
      error('用法：ext list | ext add <包名或 link:路径> | ext remove <包名>');
      return 2;
  }
}

module.exports = { runExt };
