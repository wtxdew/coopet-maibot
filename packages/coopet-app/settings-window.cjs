// @ts-check
/**
 * 设置窗：外壳开一个窗口加载本地页面 settings/index.html，preload 只暴露 window.coopet 的几个方法。
 * 页面的配置请求经 IPC 到这里，检查方法名后转给核心（core.request）；外壳自己的操作在这里处理；
 * 对话流按 streamId 在页面和核心之间转发。窗口关掉时关闭它开的对话流。
 */
const { BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');

const CORE_METHODS = new Set(['settings.get', 'settings.save', 'settings.saveToken', 'settings.testConnection']);

/**
 * @param {{
 *   core: import('./core-host.cjs').CoreHost,
 *   getStatus: () => unknown,
 *   shellActions: Record<string, (arg: unknown) => unknown>,
 * }} deps
 */
function createSettingsWindow(deps) {
  /** @type {BrowserWindow | null} */
  let win = null;
  let nextStream = 1;
  /** streamId → 打开它的页面 */
  /** @type {Map<number, Electron.WebContents>} */
  const streams = new Map();

  /** @param {Electron.IpcMainInvokeEvent | Electron.IpcMainEvent} e */
  const fromSettings = (e) => win !== null && e.sender === win.webContents;

  ipcMain.handle('coopet:request', (e, method, params) => {
    if (!fromSettings(e)) throw new Error('只接受设置窗的请求');
    if (typeof method !== 'string' || !CORE_METHODS.has(method)) throw new Error(`不认识的请求：${String(method)}`);
    return deps.core.request(method, params);
  });
  ipcMain.handle('coopet:shell', (e, action, arg) => {
    if (!fromSettings(e)) throw new Error('只接受设置窗的请求');
    const fn = typeof action === 'string' ? deps.shellActions[action] : undefined;
    if (!fn) throw new Error(`不认识的操作：${String(action)}`);
    return fn(arg);
  });
  ipcMain.handle('coopet:chat-open', (e) => {
    if (!fromSettings(e)) throw new Error('只接受设置窗的请求');
    const id = nextStream++;
    streams.set(id, e.sender);
    deps.core.send({ type: 'chat-open', streamId: id });
    return id;
  });
  ipcMain.on('coopet:chat-send', (e, id, text) => {
    if (streams.get(id) === e.sender && typeof text === 'string') deps.core.send({ type: 'chat-message', streamId: id, text });
  });
  ipcMain.on('coopet:chat-close', (e, id) => {
    if (streams.get(id) !== e.sender) return;
    streams.delete(id);
    deps.core.send({ type: 'chat-close', streamId: id });
  });

  /** 核心发来的对话数据转给对应的页面；data 为 null 表示流关了 */
  /** @param {any} m */
  const onCoreMessage = (m) => {
    if (m?.type !== 'chat-data' && m?.type !== 'chat-closed') return;
    const target = streams.get(m.streamId);
    if (!target || target.isDestroyed()) return;
    if (m.type === 'chat-closed') streams.delete(m.streamId);
    target.send('coopet:chat-data', m.streamId, m.type === 'chat-data' ? m.data : null);
  };
  deps.core.on('message', onCoreMessage);
  // 核心重启后旧的对话流都没了：告诉页面，由页面重新打开
  deps.core.on('state', (/** @type {string} */ s) => {
    if (s === 'running') return;
    for (const [id, target] of streams) if (!target.isDestroyed()) target.send('coopet:chat-data', id, null);
    streams.clear();
  });

  const closeStreamsOf = (/** @type {Electron.WebContents} */ wc) => {
    for (const [id, target] of streams) {
      if (target !== wc) continue;
      streams.delete(id);
      deps.core.send({ type: 'chat-close', streamId: id });
    }
  };

  return {
    open() {
      if (win) { win.show(); win.focus(); return; }
      win = new BrowserWindow({
        width: 820, height: 680, minWidth: 640, minHeight: 480,
        title: 'Coopet 设置', autoHideMenuBar: true, show: false,
        webPreferences: { preload: join(__dirname, 'settings', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      const wc = win.webContents;
      // 设置页是本地文件：不许它跳到别的网址，也不许开新窗口
      wc.on('will-navigate', (ev) => ev.preventDefault());
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.once('ready-to-show', () => win?.show());
      win.on('closed', () => { closeStreamsOf(wc); win = null; });
      void win.loadFile(join(__dirname, 'settings', 'index.html'));
    },
    /** 状态变了：推给设置页 */
    pushStatus() {
      if (win && !win.isDestroyed()) win.webContents.send('coopet:status', deps.getStatus());
    },
  };
}

module.exports = { createSettingsWindow, CORE_METHODS };
