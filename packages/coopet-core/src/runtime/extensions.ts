/**
 * World 扩展：用 Cortico 自己的加载器（loadExtensions）从 `~/.config/coopet/extensions/` 加载。
 *
 * 目录结构和 Cortico 一样：`package.json` 的 dependencies 列着装了哪些扩展，包在 `node_modules/` 里
 * （用 pnpm 安装，见 scripts/ext.mjs）。加载器负责检查清单（cortico.kind、接口版本）、导入、把扩展里的
 * `cortico/…` 导入指到我们钉住的 Cortico，并找出面板脚本。
 *
 * Coopet 只用 World 扩展；模型供应商和 bot 类扩展装了也不用，记一条日志。
 * `desktop-pet` 这个 id 留给内置的桌宠。
 *
 * 另有**内置扩展**（BUNDLED）：作为 npm 依赖随 Coopet 一起安装（开发时在仓库的 node_modules，打包后在应用里），
 * 不用另外装，默认启用。第三方的钉死版本；为 Coopet 写的（ntfy）跟着 0.1.x 的修复版。用户扩展目录里如果也装了同一个 id 的扩展，以内置的为准（那份报"id 已被占用"）。
 * 内置扩展原样使用，来源和许可见 UPSTREAM.md。
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extensionPackageFile, isWorldDefinition, loadExtensions, resolveExtensionEntry, type ExtensionRecord } from 'cortico/extensions.ts';
import { parseExtensionManifest, type ExtensionPackageJson } from 'cortico/extensions/manifest.ts';
import { registerFrameworkResolver } from 'cortico/extensions/runtime.ts';
import { pageIdFor } from 'cortico/web/shared/webui-protocol.ts';
import type { Logger } from 'cortico/core/types.ts';
import type { ExtensionWebUiAsset } from 'cortico/extensions/manifest.ts';
import type { WorldDefinition, WorldSection } from 'cortico/world.ts';
import type { CoopetDirs } from './config.ts';

export interface LoadedExtensions {
  /** 扩展目录 */
  dir: string;
  worlds: WorldDefinition<WorldSection>[];
  /** 每个已安装包的加载结果（没装上的带原因） */
  records: ExtensionRecord[];
  /** 扩展带的面板脚本 */
  webUiAssets: ExtensionWebUiAsset[];
}

/** 内置扩展：包名和默认是否启用 */
export const BUNDLED: ReadonlyArray<{ name: string; enabledByDefault: boolean }> = [
  // ThermalEng 的 Coding Agent 完成通知（Claude Code、Codex 等的原生 hook → 桌宠说一句）
  { name: 'cortico-world-coding-agent-notify', enabledByDefault: true },
  // 为 Coopet 写的 ntfy 通知（wtxdew/cortico-world-ntfy）：订阅 ntfy 话题，脚本、CI、另一台电脑上的 Agent 发的通知桌宠说出来。
  // 没加话题时不连 ntfy
  { name: 'cortico-world-ntfy', enabledByDefault: true },
];

export async function loadWorldExtensions(dirs: CoopetDirs, log: Logger, bundled = BUNDLED): Promise<LoadedExtensions> {
  const own = await loadBundled(bundled, log);
  const set = await loadExtensions(dirs.root, { reserved: ['desktop-pet', ...own.worlds.map((w) => w.id)], log });
  for (const r of set.records) {
    if (r.kind && r.kind !== 'world') log.warn(`扩展 ${r.name} 是 ${r.kind} 类，Coopet 只用 World 扩展，没有加载`);
    else if (r.loaded) log.info(`已加载 World 扩展：${r.name}${r.version ? ` ${r.version}` : ''}（${r.worldId}）`);
    else log.warn(`World 扩展没能加载：${r.name}——${r.reason?.('zh') ?? '原因不明'}`);
  }
  return {
    dir: set.dir,
    worlds: [...own.worlds, ...set.worlds],
    records: [...own.records, ...set.records],
    webUiAssets: [...own.webUiAssets, ...set.webUiAssets],
  };
}

/**
 * 加载内置扩展：按包名找到包（随 Coopet 安装），和 Cortico 的加载器一样检查清单、导入、找面板脚本。
 * 默认启用的，把定义的 defaults() 里的 enabled 改成 true（用户关掉后写进 config.json，以用户的为准）。
 */
async function loadBundled(bundled: typeof BUNDLED, log: Logger): Promise<Omit<LoadedExtensions, 'dir'>> {
  registerFrameworkResolver();
  const require = createRequire(import.meta.url);
  const out: Omit<LoadedExtensions, 'dir'> = { worlds: [], records: [], webUiAssets: [] };
  for (const { name, enabledByDefault } of bundled) {
    const record: ExtensionRecord = { name, spec: 'bundled', version: null, webUiClient: false, loaded: false };
    out.records.push(record);
    try {
      // 包的 exports 不一定开放 package.json：从入口往上找
      let dir = dirname(require.resolve(name));
      while (packageName(`${dir}/package.json`) !== name && dirname(dir) !== dir) dir = dirname(dir);
      const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as ExtensionPackageJson & { version?: string };
      record.version = pkg.version ?? null;
      const parsed = parseExtensionManifest(pkg);
      if (!parsed.ok || parsed.manifest.kind !== 'world') throw new Error(parsed.ok ? '不是 World 扩展' : parsed.reasons.join(' '));
      const def: unknown = ((await import(pathToFileURL(resolveExtensionEntry(dir, pkg)).href)) as { default?: unknown }).default;
      if (!isWorldDefinition(def)) throw new Error('默认导出不是 World 定义');
      const world = enabledByDefault ? enabledByDefaultOf(def) : def;
      out.worlds.push(world);
      Object.assign(record, { kind: 'world', loaded: true, worldId: def.id, label: def.label, api: parsed.manifest.api });
      const js = parsed.manifest.webUiClient === undefined ? null : extensionPackageFile(dir, parsed.manifest.webUiClient);
      record.webUiClient = parsed.manifest.webUiClient !== undefined;
      record.webUi = parsed.manifest.webUiClient === undefined ? 'none' : js ? 'served' : 'missing';
      if (js) {
        const css = parsed.manifest.webUiStyle === undefined ? null : extensionPackageFile(dir, parsed.manifest.webUiStyle);
        out.webUiAssets.push({
          pageId: pageIdFor('world', def.id), packageName: name, version: pkg.version ?? '0', jsFile: js, jsBytes: readFileSync(js),
          ...(css ? { cssFile: css, cssBytes: readFileSync(css) } : {}),
        });
      }
      log.info(`已加载内置扩展：${name} ${pkg.version ?? ''}（${def.id}）`);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      record.reason = () => why;
      log.error(`内置扩展没能加载：${name}——${why}`);
    }
  }
  return out;
}

/** 同一个定义，只是 defaults() 里 enabled 为 true；名字照样每次现取（有的扩展按语言给名字） */
function enabledByDefaultOf(def: WorldDefinition<WorldSection>): WorldDefinition<WorldSection> {
  return Object.create(def, {
    defaults: { value: () => ({ ...def.defaults(), enabled: true }) },
  }) as WorldDefinition<WorldSection>;
}

function packageName(file: string): string | null {
  try { return (JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name ?? null; } catch { return null; }
}
