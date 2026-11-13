/**
 * 设置窗 World 页里桌宠面板的脚本（桌宠包 `build:pet` 构建的 dist/webui.js、dist/webui.css）。
 *
 * WebApp 从 webDistDir 读 `asset-manifest.json`，按页找到脚本的网址，再把 webDistDir 挂在 `/assets/` 下提供文件。
 * Coopanion 是把它登记成"扩展产物"，但那样 WebApp 会认为扩展市场可用；我们没有扩展，所以改成
 * 在数据目录里放一份这样的目录：启动时把两个文件拷进 `<data>/webui/desktop-pet/`，再写清单。
 *
 * 文件不存在（没跑过 build:pet）不算错：清单里没有这一页的脚本，World 页会显示"面板没有构建"。
 */

import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';
import { WEBUI_PROTOCOL_VERSION, assetKeyForPage, pageIdFor, type WebUiAssetEntry } from 'cortico/web/shared/webui-protocol.ts';
import { PET_WORLD_ID } from './surface.ts';

/**
 * 桌宠包的目录（按包名解析，不写死相对路径）。包的 exports 没有开放 package.json，
 * 所以解析包的入口（src/index.ts），再往上一层。
 */
export function petPackageDir(): string {
  return dirname(dirname(createRequire(import.meta.url).resolve('cortico-world-desktop-pet')));
}

/** 准备 webDistDir，返回它的路径。 */
export function prepareWebAssets(dataDir: string, log: Logger, petDir = petPackageDir()): string {
  const out = join(dataDir, 'webui');
  rmSync(out, { recursive: true, force: true });
  const target = join(out, PET_WORLD_ID);
  mkdirSync(target, { recursive: true });

  const providers: Record<string, WebUiAssetEntry> = {};
  const js = join(petDir, 'dist', 'webui.js');
  if (existsSync(js)) {
    copyFileSync(js, join(target, 'webui.js'));
    const entry: WebUiAssetEntry = { js: `/assets/${PET_WORLD_ID}/webui.js` };
    const css = join(petDir, 'dist', 'webui.css');
    if (existsSync(css)) {
      copyFileSync(css, join(target, 'webui.css'));
      entry.css = `/assets/${PET_WORLD_ID}/webui.css`;
    }
    providers[assetKeyForPage(pageIdFor('world', PET_WORLD_ID))] = entry;
  } else {
    log.warn(`桌宠面板脚本没有构建（${js}），设置窗的 World 页用不了；先运行 corepack pnpm run build:pet`);
  }
  writeFileSync(join(out, 'asset-manifest.json'), JSON.stringify({ protocolVersion: WEBUI_PROTOCOL_VERSION, core: null, providers }, null, 2));
  return out;
}
