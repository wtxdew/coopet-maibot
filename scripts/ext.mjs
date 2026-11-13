/**
 * 开发时安装、卸载、列出 World 扩展：`corepack pnpm run ext list|add|remove …`。
 * 做法和打包后应用的 `--ext` 一样（packages/coopet-app/ext-cli.cjs），这里用 corepack 的 pnpm。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runExt } = require('../packages/coopet-app/ext-cli.cjs');
const { defaultDataRoot } = require('../packages/coopet-app/paths.cjs');
const { packageManager } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

process.exit(runExt(process.argv.slice(2), {
  dataRoot: defaultDataRoot(),
  packageManager,
  pnpm: (args, cwd) => {
    const r = spawnSync('corepack', ['pnpm', ...args], { cwd, stdio: 'inherit' });
    if (r.error) { console.error(`没能运行 corepack pnpm：${r.error.message}`); return 1; }
    return r.status ?? 1;
  },
}));
