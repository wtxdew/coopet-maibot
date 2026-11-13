/**
 * 生成应用图标 `packages/coopet-app/icons/icon.png`（1024×1024）：Coopet 字标里的"C + 两只眼睛"
 * （和设置窗侧边栏折叠后的小标志同一个图形，console/base/ui/icons.ts 的 WORDMARK_MARK），
 * 白色的 C、薄荷绿的眼睛，放在深色圆角方块上（桌宠在桌面上默认是深色主题）。方块按 macOS 图标网格留边。
 * electron-builder 从这张 PNG 生成 macOS 的 .icns 和 Windows 的 .ico。
 *
 * 运行：`corepack pnpm run build:icon`（electron scripts/make-icon.cjs）。用 Chromium 栅格化，所以要在 Electron 里跑。
 * 想换图标：改下面的 MARK（或换成别的 SVG），再运行一次。
 */
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', 'packages', 'coopet-app', 'icons', 'icon.png');
const SIZE = 1024;
/** macOS 图标网格：824 的方块居中，圆角约 22.5% */
const TILE = 824;
const TILE_BG = '#11161c', INK = '#ffffff', EYE = '#2fd59b';
const MARK = `<svg viewBox="29 29 198 198" width="${TILE * 0.66}" height="${TILE * 0.66}" fill="none" stroke-linecap="round">`
  + `<path d="M182 63.66A84 84 0 1 0 182 192.34" stroke="${INK}" stroke-width="30"/>`
  + `<circle cx="113" cy="117" r="16" stroke="${EYE}" stroke-width="11"/>`
  + `<circle cx="163" cy="117" r="16" stroke="${EYE}" stroke-width="11"/></svg>`;
const HTML = `<!doctype html><style>html,body{margin:0;background:transparent}</style>`
  + `<div style="width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center">`
  + `<div style="width:${TILE}px;height:${TILE}px;border-radius:${TILE * 0.225}px;background:${TILE_BG};display:grid;place-items:center;`
  + `box-shadow:0 10px 24px rgba(0,0,0,.28)">${MARK}</div></div>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, transparent: true, backgroundColor: '#00000000', useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = (await win.webContents.capturePage()).resize({ width: SIZE, height: SIZE });
  mkdirSync(join(OUT, '..'), { recursive: true });
  writeFileSync(OUT, image.toPNG());
  console.log(`icon → ${OUT}`);
  app.quit();
});
