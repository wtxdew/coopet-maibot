/**
 * 构建设置窗（照 Coopanion scripts/stage.ts 里设置窗那一段）：
 *
 * 1. esbuild：`console/coopet/index.ts` → `packages/coopet-app/build/console/index.js`（一个 ES 模块；
 *    它 import 的 CSS 变成 index.css）。`cortico/*` 指向钉住的子模块；设置窗只在运行时用到其中的
 *    `core/language.ts`，其余是类型，编译时擦掉。
 * 2. 拷贝 `console/index.html`。
 * 3. Tailwind：把设置窗的样式和各页 CSS 合成 `styles.css`；类名从 console/ 和桌宠面板源码里找。
 *
 * 运行：`corepack pnpm run build:console`。每次先清空输出目录。
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const WINDOW = join(ROOT, 'console');
const OUT = join(ROOT, 'packages', 'coopet-app', 'build', 'console');
const PET = join(ROOT, 'packages', 'cortico-world-desktop-pet');
const t0 = Date.now();

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await esbuild.build({
  entryPoints: [join(WINDOW, 'coopet', 'index.ts')],
  outdir: OUT,
  entryNames: 'index',
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  jsx: 'automatic',
  alias: { cortico: join(ROOT, 'vendor', 'cortico', 'src') },
  define: {
    // app-version.ts 要这两个值；Coopet 的标题栏只显示版本号，不检查更新（console/coopet/brand.ts）
    COOPANION_VERSION: JSON.stringify(version),
    COOPANION_CHANNEL: '"github"',
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'warning',
});
// 页面用 Coopet 自己的 index.html（标题不同），其余与 Coopanion 的一样
cpSync(join(WINDOW, 'coopet', 'index.html'), join(OUT, 'index.html'));

// Tailwind 找类名时会跳过 git 忽略的目录（build/ 被忽略），所以来源要写明
const slash = (path) => relative(OUT, path).split(sep).join('/');
const entry = join(OUT, 'tailwind.entry.css');
writeFileSync(entry, [
  ...['styles.css', 'features/home/home.css', 'features/chat/chat.css', 'companion.css', 'coopet/coopet.css'].map((f) => `@import "${slash(join(WINDOW, f))}";`),
  `@source "${slash(WINDOW)}";`,
  `@source "${slash(join(PET, 'src', 'webui'))}";`,
  '',
].join('\n'));
const cli = join(ROOT, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');
const css = spawnSync(process.execPath, [cli, '-i', entry, '-o', join(OUT, 'styles.css'), '--minify'], { cwd: OUT, stdio: 'inherit' });
rmSync(entry);
if (css.status !== 0) process.exit(css.status ?? 1);

console.log(`console built in ${((Date.now() - t0) / 1000).toFixed(1)} s → ${relative(ROOT, OUT)}`);
