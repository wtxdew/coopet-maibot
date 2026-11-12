// @ts-check
/**
 * Coopet 外壳主进程。同一个 Electron 程序有两种模式：
 *
 * - `--pet-host --pet-url=… --parent-pid=…`：桌宠的透明窗口。由核心里的桌宠 World 经
 *   CORTICO_DESKTOP_PET_HOST 启动；调用桌宠包自带的 runPetHost，关掉它自带的菜单栏图标（托盘由 app 模式负责）。
 * - 其他：app 模式。只运行一个实例（再打开时让桌宠重新显示）；macOS 上不占 Dock；
 *   启动核心子进程（core-host.cjs），建托盘（tray.cjs）；退出时先停核心，再退出。
 */
const { app, BrowserWindow, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { APP_ROOT, CORE_ENTRY, CORE_ROOT, ELECTRON_DATA_DIR, LOGS_DIR } = require('./paths.cjs');

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
  app.setName('Coopet');
  app.setPath('userData', ELECTRON_DATA_DIR);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    runApp();
  }
}

function runApp() {
  const { CoreHost } = require('./core-host.cjs');
  const { createTray } = require('./tray.cjs');
  /** @param {string} msg */
  const log = (msg) => console.log(`[app] ${msg}`);

  /** 桌宠窗口的启动命令：同一个程序加 --pet-host；开发时还要带上应用目录 */
  const petHost = [process.execPath, ...(app.isPackaged ? [] : [APP_ROOT]), '--pet-host'];
  const core = new CoreHost({
    entry: CORE_ENTRY,
    cwd: CORE_ROOT,
    execPath: process.execPath,
    env: { ...process.env, CORTICO_DESKTOP_PET_HOST: JSON.stringify(petHost) },
    log: (msg) => console.log(`[core-host] ${msg}`),
  });

  /** @type {import('./tray-menu.cjs').TrayState} */
  const state = {
    core: 'stopped',
    link: null,
    onDesktop: false,
    petOrigin: null,
    loginItem: false,
    loginItemAvailable: app.isPackaged,
  };
  /** @type {{ refresh: () => void } | null} */
  let tray = null;
  const refresh = () => tray?.refresh();

  /** @type {BrowserWindow | null} */
  let dressWindow = null;
  const openDress = () => {
    if (!state.petOrigin) return;
    if (dressWindow) { dressWindow.show(); dressWindow.focus(); return; }
    dressWindow = new BrowserWindow({ width: 980, height: 720, title: 'Coopet 装扮', autoHideMenuBar: true, webPreferences: { contextIsolation: true, sandbox: true } });
    dressWindow.on('closed', () => { dressWindow = null; });
    void dressWindow.loadURL(`${state.petOrigin}/dress`);
  };

  core.on('state', (/** @type {import('./tray-menu.cjs').TrayState['core']} */ s) => {
    state.core = s;
    if (s !== 'running') state.onDesktop = false;
    log(`核心：${s}`);
    refresh();
  });
  core.on('message', (/** @type {any} */ m) => {
    if (m?.type === 'ready') state.petOrigin = m.petOrigin;
    else if (m?.type === 'link') state.link = { kind: m.kind, state: m.state, reason: m.reason, botName: m.botName };
    else if (m?.type === 'pet') state.onDesktop = !!m.onDesktop;
    else if (m?.type === 'quit') { app.quit(); return; }
    refresh();
  });

  // 再次打开应用：不启动第二个，让已有的桌宠显示出来
  app.on('second-instance', () => core.send({ type: 'show-pet' }));
  // 只剩托盘时（例如关掉了装扮窗口）不退出
  app.on('window-all-closed', () => {});

  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    log('正在退出：先停核心');
    void core.stop().finally(() => app.exit(0));
  });

  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();
    if (state.loginItemAvailable) state.loginItem = app.getLoginItemSettings().openAtLogin;
    tray = createTray(() => state, {
      togglePet: () => core.send({ type: state.onDesktop ? 'hide-pet' : 'show-pet' }),
      openDress,
      setLoginItem: (on) => {
        app.setLoginItemSettings({ openAtLogin: on });
        state.loginItem = app.getLoginItemSettings().openAtLogin;
        refresh();
      },
      openLogs: () => {
        mkdirSync(LOGS_DIR, { recursive: true });
        void shell.openPath(LOGS_DIR);
      },
      restartCore: () => core.start(),
      quit: () => app.quit(),
    });
    core.start();
  });
}
