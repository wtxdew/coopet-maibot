/**
 * World 扩展：用 Cortico 自己的加载器（loadExtensions）从 `~/.config/coopet/extensions/` 加载。
 *
 * 目录结构和 Cortico 一样：`package.json` 的 dependencies 列着装了哪些扩展，包在 `node_modules/` 里
 * （用 pnpm 安装，见 scripts/ext.mjs）。加载器负责检查清单（cortico.kind、接口版本）、导入、把扩展里的
 * `cortico/…` 导入指到我们钉住的 Cortico，并找出面板脚本。
 *
 * Coopet 只用 World 扩展；模型供应商和 bot 类扩展装了也不用，记一条日志。
 * `desktop-pet` 这个 id 留给内置的桌宠。
 */

import { loadExtensions, type ExtensionRecord } from 'cortico/extensions.ts';
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

export async function loadWorldExtensions(dirs: CoopetDirs, log: Logger): Promise<LoadedExtensions> {
  const set = await loadExtensions(dirs.root, { reserved: ['desktop-pet'], log });
  for (const r of set.records) {
    if (r.kind && r.kind !== 'world') log.warn(`扩展 ${r.name} 是 ${r.kind} 类，Coopet 只用 World 扩展，没有加载`);
    else if (r.loaded) log.info(`已加载 World 扩展：${r.name}${r.version ? ` ${r.version}` : ''}（${r.worldId}）`);
    else log.warn(`World 扩展没能加载：${r.name}——${r.reason?.('zh') ?? '原因不明'}`);
  }
  return { dir: set.dir, worlds: set.worlds, records: set.records, webUiAssets: set.webUiAssets };
}
