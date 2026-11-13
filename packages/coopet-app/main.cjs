// @ts-check
/**
 * Coopet 外壳主进程。同一个 Electron 程序有两种模式：
 *
 * - `--pet-host --pet-url=… --parent-pid=…`：桌宠的透明窗口。由核心里的桌宠 World 经
 *   CORTICO_DESKTOP_PET_HOST 启动；调用桌宠包自带的 runPetHost，关掉它自带的菜单栏图标（托盘由 app 模式负责）。
 * - 其他：app 模式。只运行一个实例（再打开时让桌宠重新显示）；macOS 上不占 Dock；
 *   启动核心子进程（core-host.cjs），建托盘（tray.cjs）；退出时先停核心，再退出。
 */
const { app, shell } = require('electron');
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
  const { createConsoleWindow } = require('./console-window.cjs');
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

  /** @type {import('./tray-menu.cjs').TrayState & { webPort: number | null }} */
  const state = {
    core: 'stopped',
    link: null,
    onDesktop: false,
    petOrigin: null,
    /** 设置窗后端（核心里的 Cortico WebApp）的端口，核心 ready 时报上来 */
    webPort: null,
    /** 界面语言，核心 ready 时报上来、改了时再报 */
    language: 'zh',
    loginItem: false,
    loginItemAvailable: app.isPackaged,
  };
  /** @type {{ refresh: () => void } | null} */
  let tray = null;
  /** @type {ReturnType<typeof createConsoleWindow> | null} */
  let settings = null;
  const refresh = () => { tray?.refresh(); };
  const setLoginItem = (/** @type {boolean} */ on) => {
    if (!state.loginItemAvailable) return state.loginItem;
    app.setLoginItemSettings({ openAtLogin: on });
    state.loginItem = app.getLoginItemSettings().openAtLogin;
    refresh();
    return state.loginItem;
  };
  const openLogs = () => {
    mkdirSync(LOGS_DIR, { recursive: true });
    void shell.openPath(LOGS_DIR);
  };
  /** 装扮：打开设置窗的装扮页（和 Coopanion 一样，不单独开窗口） */
  const openDress = () => settings?.open('#/dress');


  core.on('state', (/** @type {import('./tray-menu.cjs').TrayState['core']} */ s) => {
    state.core = s;
    if (s !== 'running') state.onDesktop = false;
    log(`核心：${s}`);
    refresh();
  });
  core.on('message', (/** @type {any} */ m) => {
    if (m?.type === 'ready') {
      const restarted = state.webPort !== null && state.webPort !== m.webPort;
      state.petOrigin = m.petOrigin;
      state.webPort = typeof m.webPort === 'number' ? m.webPort : null;
      if (typeof m.language === 'string') state.language = m.language;
      if (restarted) settings?.coreRestarted();
    }
    else if (m?.type === 'language' && typeof m.language === 'string') {
      // 托盘菜单下次打开时用新语言；设置窗重新加载
      state.language = m.language;
      settings?.reload();
    }
    else if (m?.type === 'link') state.link = { kind: m.kind, state: m.state, reason: m.reason, botName: m.botName };
    else if (m?.type === 'pet') state.onDesktop = !!m.onDesktop;
    else if (m?.type === 'quit') { app.quit(); return; }
    else if (m?.type === 'open-settings') { settings?.open(typeof m.route === 'string' && m.route.startsWith('#/') ? m.route : ''); return; }
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
    settings = createConsoleWindow({
      corePort: () => state.webPort,
      petOrigin: () => state.petOrigin,
      language: () => state.language,
      loginItem: { available: () => state.loginItemAvailable, get: () => state.loginItem, set: (on) => { setLoginItem(on); } },
      sizeFile: join(ELECTRON_DATA_DIR, 'console-size.json'),
      log,
    });
    tray = createTray(() => state, {
      openSettings: () => settings?.open(),
      // 由核心按桌宠的实时状态决定显示还是隐藏：托盘记的状态可能落后（例如从桌宠自己的菜单隐藏过）
      togglePet: () => core.send({ type: 'toggle-pet' }),
      openDress,
      setLoginItem: (on) => { setLoginItem(on); },
      openLogs,
      restartCore: () => core.start(),
      quit: () => app.quit(),
    });
    core.start();
  });
}
