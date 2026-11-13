// @ts-check
/**
 * 设置窗的 preload，照 Coopanion 的 app/settings-preload.cjs：
 *
 * - 界面语言：页面加载时从 localStorage（`cortico.console.language`）读（console/base/language.ts），
 *   这里在每次加载前向外壳要当前语言写进去。改语言后外壳重新加载窗口。
 * - window.coopanionWindow（console/titlebar.ts 读）：平台（标题栏按它给红绿灯留位置）、
 *   配色同步（窗口底色跟着页面配色）、开机自启（只在能设置时提供，「习惯」页据此显示那一行）。
 * - window.coopanionUpdate（console/coopet/release.ts 读）：只在能自己更新的版本里有，
 *   给更新器的上一步和之后的每一步，标题栏的版本号旁边显示（正在下载、已就绪、下载失败）。
 *
 * IPC 通道在 console-window.cjs。
 */
const { contextBridge, ipcRenderer } = require('electron');

const loginItemAvailable = ipcRenderer.sendSync('console:login-item') !== null;
contextBridge.exposeInMainWorld('coopanionWindow', {
  platform: process.platform,
  setTheme: (/** @type {unknown} */ theme) => ipcRenderer.send('console:theme', theme),
  ...(loginItemAvailable ? {
    loginItem: {
      get: () => ipcRenderer.sendSync('console:login-item') === true,
      set: (/** @type {unknown} */ on) => ipcRenderer.sendSync('console:login-item', on === true),
    },
  } : {}),
});

if (ipcRenderer.sendSync('console:update').auto) {
  contextBridge.exposeInMainWorld('coopanionUpdate', {
    step: () => ipcRenderer.sendSync('console:update').step,
    onStep: (/** @type {(step: unknown) => void} */ listener) => {
      const handler = (/** @type {unknown} */ _e, /** @type {unknown} */ step) => listener(step);
      ipcRenderer.on('console:update', handler);
      return () => ipcRenderer.removeListener('console:update', handler);
    },
  });
}

try {
  localStorage.setItem('cortico.console.language', ipcRenderer.sendSync('console:language'));
} catch { /* 没有存储的页面 */ }
