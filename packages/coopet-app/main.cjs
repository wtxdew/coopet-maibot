// @ts-check
/**
 * Coopet 外壳主进程。同一个 Electron 程序有两种模式：
 *
 * - `--pet-host --pet-url=… --parent-pid=…`：桌宠的透明窗口。由核心里的桌宠 World 经
 *   CORTICO_DESKTOP_PET_HOST 启动；调用桌宠包自带的 runPetHost，关掉它自带的菜单栏图标（托盘由 app 模式负责）。
 * - 其他：app 模式。只运行一个实例（再打开时让桌宠重新显示）；macOS 上不占 Dock；
 *   启动核心子进程（core-host.cjs），建托盘（tray.cjs）；退出时先停核心，再退出。
 *
 * 自动更新（updater.cjs，照 Coopanion）：只有能自己装更新的版本（Windows 安装版）运行更新器。
 * 核心告诉开关（auto-update，存在 config.json），更新器的每一步告诉核心（桌宠气泡）和设置窗（标题栏）；
 * 气泡里点了「现在重启更新」（update-install）就退出并静默安装、装完重新打开；没点的话退出时安装、不重新打开。
 */
const { app, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { APP_ROOT, CORE_ENTRY, CORE_ROOT, CORTICO_RESOLVER, ELECTRON_DATA_DIR, LOGS_DIR } = require('./paths.cjs');

const PET_HOST = process.argv.includes('--pet-host');
/** `Coopet --ext list|add|remove …`：装扩展的命令行入口（ext-cli.cjs），做完就退出，不启动应用 */
const EXT = process.argv.indexOf('--ext');

/**
 * 取 `--name=value` 形式的参数值
 * @param {string} name
 */
function arg(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

if (EXT >= 0) {
  runExtCli(process.argv.slice(EXT + 1));
} else if (PET_HOST) {
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
  const { RELEASES_URL, canUpdate, startUpdater } = require('./updater.cjs');
  /** 这个版本能不能自己装更新（Windows 安装版） */
  const SELF_UPDATE = canUpdate();
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
    preload: [CORTICO_RESOLVER],
    env: { ...process.env, CORTICO_DESKTOP_PET_HOST: JSON.stringify(petHost), COOPET_SELF_UPDATE: SELF_UPDATE ? '1' : '0' },
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
  /** @type {{ setEnabled: (on: boolean) => void, hasUpdate: () => boolean, installOnQuit: (runAfter?: boolean) => boolean } | null} */
  let updater = null;
  /** 更新器的上一步；核心重启后再告诉它一次 */
  /** @type {{ phase: string, version: string, reason?: string } | null} */
  let updateStep = null;
  /** 设置窗标题栏显示的部分 */
  const updateLine = () => updateStep && { phase: updateStep.phase, version: updateStep.version };
  /** 气泡里点了「现在重启更新」：装完重新打开 */
  let restartAfterUpdate = false;
  /** @param {boolean} enabled */
  const setAutoUpdate = (enabled) => {
    if (!SELF_UPDATE) return;
    if (updater) { updater.setEnabled(enabled); return; }
    updater = startUpdater({
      logDir: LOGS_DIR,
      enabled,
      tell: (/** @type {any} */ step) => {
        updateStep = step;
        if (step) log(`更新：${step.phase} ${step.version}`);
        core.send({ type: 'update', step });
        settings?.updateStep(updateLine());
      },
    });
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
      if (updateStep) core.send({ type: 'update', step: updateStep });
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
    else if (m?.type === 'auto-update') { setAutoUpdate(m.enabled === true); return; }
    // 先退出（停核心、收托盘图标）再装：安装程序会结束还在运行的 Coopet
    else if (m?.type === 'update-install') { if (updater?.hasUpdate()) { restartAfterUpdate = true; app.quit(); } return; }
    else if (m?.type === 'releases') { void shell.openExternal(RELEASES_URL); return; }
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
    void core.stop().finally(() => {
      // 下载好的更新现在装（静默）；安装程序接手后这里不再等，10 秒后兜底退出
      if (updater?.installOnQuit(restartAfterUpdate)) setTimeout(() => app.exit(0), 10_000);
      else app.exit(0);
    });
  });

  void app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();
    if (state.loginItemAvailable) state.loginItem = app.getLoginItemSettings().openAtLogin;
    settings = createConsoleWindow({
      corePort: () => state.webPort,
      petOrigin: () => state.petOrigin,
      language: () => state.language,
      loginItem: { available: () => state.loginItemAvailable, get: () => state.loginItem, set: (on) => { setLoginItem(on); } },
      update: { auto: () => SELF_UPDATE, step: updateLine },
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

/**
 * `--ext`：用应用里带的 pnpm（打包时装进 node_modules/pnpm）在数据目录的 extensions/ 里装卸扩展。
 * pnpm 用 Electron 自己的程序以 Node 模式运行。开发时没有带 pnpm，提示改用 corepack pnpm run ext。
 * @param {string[]} args
 */
function runExtCli(args) {
  const { spawnSync } = require('node:child_process');
  const { readFileSync } = require('node:fs');
  const { runExt } = require('./ext-cli.cjs');
  const { DATA_DIR } = require('./paths.cjs');
  const { dirname, join } = require('node:path');
  // pnpm 包只开放 package.json（exports 的 "."），入口按它的 bin 字段找
  let pkgFile;
  try {
    pkgFile = require.resolve('pnpm');
  } catch {
    console.error('这个 Coopet 没有带 pnpm（开发时请用 corepack pnpm run ext）');
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  const version = pkg.version;
  const pnpmCjs = join(dirname(pkgFile), typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.pnpm);
  const code = runExt(args, {
    dataRoot: DATA_DIR,
    packageManager: `pnpm@${version}`,
    pnpm: (pnpmArgs, cwd) => spawnSync(process.execPath, [pnpmCjs, ...pnpmArgs], {
      cwd, stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).status ?? 1,
  });
  process.exit(code);
}
