// @ts-check
/**
 * 菜单栏（macOS）/ 通知区域（Windows）图标。菜单内容见 tray-menu.cjs。
 * 图标在代码里画：一个圆环加两只眼睛；macOS 用黑色模板图，由系统按菜单栏颜色着色。
 */
const { Menu, Tray, nativeImage } = require('electron');
const { trayTemplate, trayTooltip } = require('./tray-menu.cjs');

/** 32×32 像素（2 倍图，显示为 16×16 点）的 BGRA 位图 */
function trayIcon() {
  const mac = process.platform === 'darwin';
  const n = 32;
  const buf = Buffer.alloc(n * n * 4);
  /** @type {(px: number, py: number, cx: number, cy: number, r: number, w: number) => boolean} */
  const ring = (px, py, cx, cy, r, w) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= w / 2;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;
      const body = ring(px, py, 16, 16, 12, 3.2);
      const eye = Math.hypot(px - 12, py - 14) <= 2 || Math.hypot(px - 20, py - 14) <= 2;
      const on = body || eye;
      // macOS：黑色加透明度，交给系统着色；其他系统：白色
      const c = mac ? 0 : 255;
      buf[i] = buf[i + 1] = buf[i + 2] = c;
      buf[i + 3] = on ? 255 : 0;
    }
  }
  const image = nativeImage.createFromBitmap(buf, { width: n, height: n, scaleFactor: 2 });
  if (mac) image.setTemplateImage(true);
  return image;
}

/**
 * @param {() => import('./tray-menu.cjs').TrayState} getState
 * @param {import('./tray-menu.cjs').TrayActions} actions
 */
function createTray(getState, actions) {
  const tray = new Tray(trayIcon());
  const refresh = () => {
    tray.setToolTip(trayTooltip(getState()));
    const template = /** @type {Electron.MenuItemConstructorOptions[]} */ (trayTemplate(getState(), actions));
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };
  refresh();
  return { refresh, destroy: () => tray.destroy() };
}

module.exports = { createTray };
