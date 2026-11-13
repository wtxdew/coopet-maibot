/**
 * 打包：拼出 `build/app/`（electron-builder 要打包的应用目录），再运行 electron-builder。照 Coopanion 的 scripts/pack.ts。
 *
 * 工作区的 pnpm 结构（符号链接）不适合装到别人电脑上，所以应用目录是平铺的：
 * - 和仓库一样的相对位置：packages/coopet-app（外壳）、packages/coopet-core（核心）、vendor/cortico/src（Cortico 源码）。
 *   核心的 tsconfig 把 `cortico/*` 映射到 ../../vendor/cortico/src，位置不变就不用改；核心照旧用 tsx 运行源码。
 * - 设置窗（packages/coopet-app/build/console）和桌宠的面板脚本先构建好再拷进来，不带 .map 和测试。
 * - package.json 只列运行时依赖，用 npm 按目标平台和架构安装（原生包 koffi、sherpa-onnx、esbuild 要对上）；
 *   工作区的包（桌宠、cortico-provider-coo）拷成真目录放进 node_modules。
 * 打包后检查目标架构的原生包在不在，缺了就失败。
 *
 * 运行：`corepack pnpm run pack`。输出在 dist/：macOS 是 Coopet-<版本>-mac-<架构>.dmg 和 .zip，Windows 是 Coopet-Setup-<版本>.exe。
 * Windows 版要在 Windows 上运行这个脚本。`PACK_ARCH`（x64 或 arm64）可以给 macOS 构建另一种架构。
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'build', 'app');
const ARCH = process.env.PACK_ARCH || process.arch;
const WIN = process.platform === 'win32';
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: WIN });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const WORKSPACE = ['cortico-world-desktop-pet', 'cortico-provider-coo'];
/**
 * 运行时依赖：核心和它加载的 Cortico 代码（express、ws、undici、fflate、tar-stream）、TypeScript 加载器 tsx、
 * 装扩展用的 pnpm（--ext）、内置的 World 扩展，以及工作区各包自己的依赖。
 */
const DEPS = {
  express: rootPkg.dependencies.express,
  ws: rootPkg.dependencies.ws,
  undici: rootPkg.dependencies.undici,
  tsx: rootPkg.dependencies.tsx,
  fflate: rootPkg.devDependencies.fflate,
  'tar-stream': rootPkg.devDependencies['tar-stream'],
  pnpm: rootPkg.packageManager.replace(/^pnpm@/, ''),
  'cortico-world-coding-agent-notify': rootPkg.dependencies['cortico-world-coding-agent-notify'],
};
for (const name of WORKSPACE) {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', name, 'package.json'), 'utf8'));
  for (const [dep, version] of Object.entries(pkg.dependencies ?? {})) if (!WORKSPACE.includes(dep)) DEPS[dep] = version;
}

// 先构建桌宠的面板脚本、换装页和设置窗
run('corepack', ['pnpm', 'run', 'build:pet'], ROOT);
run('corepack', ['pnpm', 'run', 'build:console'], ROOT);

/** 不拷：node_modules、.git、测试、source map */
const keep = (base) => (src) => {
  const rel = relative(base, src).split(sep);
  if (src.endsWith('.map')) return false;
  return !rel.some((p) => ['node_modules', '.git', 'tests', 'test', 'coverage'].includes(p));
};
const copy = (rel, filter = keep(join(ROOT, rel))) => cpSync(join(ROOT, rel), join(OUT, rel), { recursive: true, filter });

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copy('packages/coopet-app');
copy('packages/coopet-core');
copy('vendor/cortico/src', (src) => keep(join(ROOT, 'vendor/cortico/src'))(src) && !/\.test\.ts$/.test(src));
cpSync(join(ROOT, 'vendor', 'cortico', 'package.json'), join(OUT, 'vendor', 'cortico', 'package.json'));
for (const f of ['LICENSE', 'UPSTREAM.md']) cpSync(join(ROOT, f), join(OUT, f));

writeFileSync(join(OUT, 'package.json'), JSON.stringify({
  name: rootPkg.name, productName: 'Coopet', version: rootPkg.version, description: rootPkg.description,
  license: rootPkg.license, author: 'Coopet contributors', main: 'packages/coopet-app/main.cjs', dependencies: DEPS,
}, null, 2));
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error', `--os=${process.platform}`, `--cpu=${ARCH}`], OUT);

const manifest = JSON.parse(readFileSync(join(OUT, 'package.json'), 'utf8'));
for (const name of WORKSPACE) {
  const from = join(ROOT, 'packages', name);
  cpSync(from, join(OUT, 'node_modules', name), { recursive: true, filter: keep(from) });
  // 现在才列上：npm 不能去下载它们，但 electron-builder 只带列出的依赖
  manifest.dependencies[name] = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8')).version;
}
writeFileSync(join(OUT, 'package.json'), JSON.stringify(manifest, null, 2));
console.log(`应用目录拼好了：${relative(ROOT, OUT)}`);

const target = process.platform === 'darwin' ? '--mac' : WIN ? '--win' : '--linux';
run(join(ROOT, 'node_modules', '.bin', WIN ? 'electron-builder.cmd' : 'electron-builder'),
  [target, `--${ARCH}`, '--publish', 'never', '--projectDir', OUT, '--config', join(ROOT, 'electron-builder.yml'), ...process.argv.slice(2)], ROOT);

/** 核心要加载的原生包，按目标平台和架构：esbuild（tsx）、koffi（电脑操作）、sherpa-onnx（语音识别） */
const NATIVE = [`@esbuild/${process.platform}-${ARCH}`, `@koromix/koffi-${process.platform}-${ARCH}`, `sherpa-onnx-${WIN ? 'win' : process.platform}-${ARCH}`];
const packed = process.platform === 'darwin'
  ? join(ROOT, 'dist', ARCH === 'x64' ? 'mac' : `mac-${ARCH}`, 'Coopet.app', 'Contents', 'Resources', 'app')
  : join(ROOT, 'dist', `${WIN ? 'win' : 'linux'}${ARCH === 'x64' ? '' : `-${ARCH}`}-unpacked`, 'resources', 'app');
const missing = NATIVE.filter((name) => !existsSync(join(packed, 'node_modules', name, 'package.json')));
if (missing.length) {
  console.error(`打包出的应用缺少 ${process.platform}-${ARCH} 的原生包：${missing.join('、')}（${relative(ROOT, packed)}）`);
  process.exit(1);
}
console.log(`原生包都在：${NATIVE.join('、')}`);
