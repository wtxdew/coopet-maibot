// @ts-nocheck
/**
 * 自动更新：从 GitHub Releases 更新（electron-updater）。照抄 Coopanion 的 app/updater.cjs
 * （Pal-AI-Lab/Coopanion@9b814fd，AGPL-3.0-or-later），只把 Release 地址换成 Coopet 的，见 UPSTREAM.md。
 *
 * 能自己装更新的只有 Windows 安装版（和 Linux AppImage）。macOS 版是临时签名，Squirrel.Mac 不肯装；
 * 那里由设置窗标题栏的版本号查新版本，链接到 Release 页面（console/coopet/release.ts）。
 *
 * 打开自动更新时，有新版本就在后台下载。每一步告诉核心（`tell`，核心在桌宠气泡里说）和设置窗的标题栏：
 * 正在下载、已下载（现在重启，或者退出时安装）、下载失败。只有下载失败才直接指向 Release 页面。
 * 安装是静默的（quitAndInstall 的 isSilent），不出现安装向导，装完按需重新打开。
 * 更新器做了什么写在日志目录的 `updater.log`。关掉自动更新会取消下载、清掉提示，退出时也不安装。
 *
 * 以下代码与上游一致（英文注释保留原样）。
 */
const { createWriteStream, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const RELEASES_URL = 'https://github.com/wtxdew/coopet-maibot/releases/latest';
/** Releases come out at most a few times a day; a run left open for days still hears of them the same day. */
const CHECK_EVERY_MS = 6 * 3600_000;

/** Whether this build can install an update by itself. */
function canUpdate() {
  const { app } = require('electron');
  return app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE));
}

/**
 * Starts with the saved preference. `tell(step)` reports downloading, ready or failed; `tell(null)`
 * clears a cancelled update. `setEnabled(false)` cancels downloads and prevents installation on quit.
 */
function startUpdater({ logDir, tell, enabled }) {
  const { autoUpdater } = require('electron-updater');
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(join(logDir, 'updater.log'), { flags: 'a' });
  const line = (level) => (...args) => log.write(`${new Date().toISOString()} ${level} ${args.map(String).join(' ')}\n`);
  autoUpdater.logger = { info: line('info'), warn: line('warn'), error: line('error'), debug: line('debug') };
  // electron-updater emits `error` for failed checks, downloads and installer launches; without a listener the emit throws
  autoUpdater.on('error', line('error'));
  // the installer takes the directory registered for the app, or its default one when none is: an update goes
  // into the directory of the program that is running, so data beside it stays with it
  if (process.platform === 'win32') autoUpdater.installDirectory = dirname(process.execPath);

  return manageUpdates(autoUpdater, { tell, enabled });
}

/**
 * Serializes checks and downloads; a disabled generation cannot publish or install an update.
 * `installOnQuit(runAfter)` installs a ready update once; `runAfter` starts the updated app afterwards.
 */
function manageUpdates(autoUpdater, { tell, enabled: initial }) {
  // downloads start here, after the check, so that turning updates off can cancel them
  autoUpdater.autoDownload = false;
  // the app's own quit stops the Core first and then exits, which skips the quit event the updater waits for: installOnQuit does it
  autoUpdater.autoInstallOnAppQuit = false;
  let enabled = false;
  let generation = 0;
  let running = false;
  let requested = false;
  let timer = null;
  let cancellation = null;
  let ready = null;

  const check = async () => {
    if (!enabled) return;
    requested = true;
    if (running) return;
    running = true;
    try {
      while (requested && enabled) {
        requested = false;
        const current = generation;
        let downloading = null;
        try {
          const result = await autoUpdater.checkForUpdates();
          if (!enabled || current !== generation || !result?.isUpdateAvailable || ready === result.updateInfo.version) continue;
          cancellation = result.cancellationToken;
          downloading = result.updateInfo.version;
          tell({ phase: 'downloading', version: downloading });
          await autoUpdater.downloadUpdate(cancellation);
          if (!enabled || current !== generation) continue;
          ready = downloading;
          tell({ phase: 'ready', version: ready });
        } catch (err) {
          // a failed check (no network, GitHub out of reach) is only logged; a download that was under way is told
          if (enabled && current === generation && downloading) {
            tell({ phase: 'failed', version: downloading, reason: String(err?.message ?? err).split('\n')[0].slice(0, 200) });
          }
        } finally {
          cancellation = null;
        }
      }
    } finally {
      running = false;
    }
  };

  const setEnabled = (next) => {
    if (next === enabled) return;
    enabled = next;
    generation += 1;
    if (enabled) {
      void check();
      timer = setInterval(check, CHECK_EVERY_MS);
      timer.unref();
    } else {
      clearInterval(timer);
      timer = null;
      requested = false;
      cancellation?.cancel();
      ready = null;
      tell(null);
    }
  };
  setEnabled(initial);

  return {
    setEnabled,
    hasUpdate: () => !!ready,
    installOnQuit(runAfter = false) {
      if (!ready) return false;
      ready = null;
      autoUpdater.quitAndInstall(true, runAfter);
      return true;
    },
  };
}

module.exports = { canUpdate, startUpdater, manageUpdates, CHECK_EVERY_MS, RELEASES_URL };
