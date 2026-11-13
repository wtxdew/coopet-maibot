/**
 * 安装、卸载、列出 World 扩展。扩展目录是 `~/.config/coopet/extensions/`（设了 COOPET_DATA_DIR 时用它下面的
 * extensions/），结构和 Cortico 一样：package.json 的 dependencies 加 node_modules，由 pnpm 管理。
 * 装完、卸完要重启 Coopet，核心启动时才加载（runtime/extensions.ts）。
 *
 *   corepack pnpm run ext list
 *   corepack pnpm run ext add cortico-world-coding-agent-notify      # npm 上的包
 *   corepack pnpm run ext add link:/path/to/my-world                  # 本地文件夹
 *   corepack pnpm run ext remove cortico-world-coding-agent-notify
 *
 * 只做这几件事：建目录、调 pnpm、把结果原样打出来。包是否是合格的 World 扩展，由核心加载时检查并报告。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const root = process.env.COOPET_DATA_DIR || join(homedir(), '.config', 'coopet');
const dir = join(root, 'extensions');
const [cmd, ...args] = process.argv.slice(2);

/** 和本仓库用同一个 pnpm 版本：扩展目录在仓库外，不写 packageManager 的话 corepack 会去拿最新版 */
const PACKAGE_MANAGER = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).packageManager;

function ensureDir() {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'package.json');
  const pkg = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { name: 'coopet-extensions', private: true, dependencies: {} };
  if (pkg.packageManager !== PACKAGE_MANAGER) {
    pkg.packageManager = PACKAGE_MANAGER;
    writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

function pnpm(pnpmArgs) {
  const r = spawnSync('corepack', ['pnpm', ...pnpmArgs], { cwd: dir, stdio: 'inherit' });
  if (r.error) { console.error(`没能运行 corepack pnpm：${r.error.message}`); process.exit(1); }
  return r.status ?? 1;
}

function installed() {
  try {
    return Object.entries(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dependencies ?? {});
  } catch {
    return [];
  }
}

switch (cmd) {
  case 'list': {
    const list = installed();
    console.log(list.length ? list.map(([name, spec]) => `${name}  ${spec}`).join('\n') : `还没有装扩展（${dir}）`);
    break;
  }
  case 'add': {
    if (!args.length) { console.error('用法：ext add <包名或 link:路径>'); process.exit(2); }
    ensureDir();
    const code = pnpm(['add', ...args]);
    if (code === 0) console.log('\n装好了。重启 Coopet 后加载；在设置窗的「World 扩展」里启用。');
    process.exit(code);
    break;
  }
  case 'remove': {
    if (!args.length) { console.error('用法：ext remove <包名>'); process.exit(2); }
    if (!existsSync(join(dir, 'package.json'))) { console.error(`还没有装扩展（${dir}）`); process.exit(1); }
    ensureDir();
    const code = pnpm(['remove', ...args]);
    if (code === 0) console.log('\n卸好了。重启 Coopet 后生效；它在 config.json 里的设置保留。');
    process.exit(code);
    break;
  }
  default:
    console.error('用法：ext list | ext add <包名或 link:路径> | ext remove <包名>');
    process.exit(2);
}
