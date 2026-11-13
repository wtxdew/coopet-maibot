// @ts-check
/**
 * 设置窗的窗口外观和大小，照 Coopanion 的 app/settings-chrome.cjs 和 app/settings-size.cjs。
 *
 * - 隐藏系统标题栏：页面自己有 36px 高的标题栏（后退、前进、折叠侧边栏、配色）；
 *   macOS 的红绿灯放进这条标题栏里，Windows 的窗口按钮叠在右上角、颜色跟着配色走。
 * - 窗口大小存在 `<electron 数据目录>/console-size.json`，下次按它打开；超出屏幕时缩到屏幕内。
 */
const { renameSync, readFileSync, writeFileSync } = require('node:fs');

const TITLEBAR_HEIGHT = 36;
const DEFAULT_SIZE = { width: 1200, height: 820 };
const MIN_SIZE = { width: 880, height: 600 };

/** @param {NodeJS.Platform} platform */
function chromeOptions(platform) {
  return {
    titleBarStyle: /** @type {const} */ ('hidden'),
    ...(platform === 'darwin'
      ? { trafficLightPosition: { x: 14, y: 11 }, titleBarOverlay: { height: TITLEBAR_HEIGHT } }
      : { titleBarOverlay: { height: TITLEBAR_HEIGHT, color: '#ecedec', symbolColor: '#5c5c60' } }),
  };
}

/**
 * 页面换了配色：窗口底色和 Windows 的窗口按钮跟着换。两个颜色都是 `#rrggbb`，不是的不理。
 * @param {Pick<Electron.BrowserWindow, 'setBackgroundColor' | 'setTitleBarOverlay'>} win
 * @param {unknown} theme
 * @param {NodeJS.Platform} platform
 */
function applyTheme(win, theme, platform) {
  const t = /** @type {{ color?: unknown, symbolColor?: unknown } | null} */ (theme);
  const hex = (/** @type {unknown} */ v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
  if (!t || !hex(t.color) || !hex(t.symbolColor)) return;
  win.setBackgroundColor(/** @type {string} */ (t.color));
  if (platform !== 'darwin') win.setTitleBarOverlay({ color: /** @type {string} */ (t.color), symbolColor: /** @type {string} */ (t.symbolColor) });
}

/**
 * 读保存的大小；文件没有或坏了用默认值。结果不超过屏幕工作区。
 * @param {string} file
 * @param {{ width: number, height: number }} area
 */
function readSize(file, area) {
  let size = DEFAULT_SIZE;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (Number.isInteger(saved?.width) && Number.isInteger(saved?.height)) size = saved;
  } catch { /* 用默认值 */ }
  const minWidth = Math.min(area.width, MIN_SIZE.width);
  const minHeight = Math.min(area.height, MIN_SIZE.height);
  return {
    minWidth, minHeight,
    width: Math.min(area.width, Math.max(minWidth, size.width)),
    height: Math.min(area.height, Math.max(minHeight, size.height)),
  };
}

/**
 * @param {string} file
 * @param {{ width: number, height: number }} size
 */
function saveSize(file, { width, height }) {
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ width, height })}\n`);
  renameSync(`${file}.tmp`, file);
}

module.exports = { chromeOptions, applyTheme, readSize, saveSize, DEFAULT_SIZE, MIN_SIZE };
