// @ts-check
/**
 * Coopet 外壳主进程。同一个 Electron 程序有两种模式：
 *
 * - `--pet-host --pet-url=… --parent-pid=…`：桌宠的透明窗口。由核心里的桌宠 World 经
 *   CORTICO_DESKTOP_PET_HOST 启动；调用桌宠包自带的 runPetHost，关掉它自带的菜单栏图标（托盘由 app 模式负责）。
 * - 其他：app 模式（后续提交里加上托盘、单实例、核心子进程）。
 */
const { app } = require('electron');
const { join } = require('node:path');
const { ELECTRON_DATA_DIR } = require('./paths.cjs');

const PET_HOST = process.argv.includes('--pet-host');

/**
 * 取 `--name=value` 形式的参数值
 * @param {string} name
 */
function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

if (PET_HOST) {
  // 窗口进程用自己的 Chromium 配置目录，不和 app 模式抢单实例锁
  app.setPath('userData', join(ELECTRON_DATA_DIR, 'pet-window'));
  if (process.platform === 'darwin') app.dock?.hide();
  const { runPetHost } = require(require.resolve('cortico-world-desktop-pet/host/electron-main.cjs'));
  runPetHost({ url: arg('pet-url'), parentPid: Number(arg('parent-pid')) || 0, tray: false });
} else {
  app.setPath('userData', ELECTRON_DATA_DIR);
  app.whenReady().then(() => {
    console.log('Coopet 外壳：app 模式还没实现');
    app.quit();
  });
}
