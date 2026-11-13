// @ts-check
/**
 * 设置窗（Coopanion 的前端，scripts/build-console.mjs 构建到 build/console）。照 Coopanion app/main.cjs 的做法：
 *
 * - 窗口用单独的会话分区（CONSOLE_PARTITION），这个会话的每个 http 请求都由 serve 处理（路由见 console-routes.cjs）：
 *   设置窗的文件由外壳提供，网址却在核心地址下（`http://127.0.0.1:<核心端口>/coopet/`），
 *   这样页面和核心接口同源，核心的同源检查照常起作用。
 * - 转发用 Node 的 http，原样带上方法、头和正文，回复边到边传；重定向原样返回，不跟随。
 * - 会话里所有请求（包括 WebSocket）只许连本机（keepLocal）。
 * - 窗口只停留在核心地址上；别的链接用系统浏览器打开；框架（桌宠页面）只许本机、且不许是核心地址。
 * - 窗口外观和大小见 console-chrome.cjs。preload（console-preload.cjs）经下面三个 IPC 通道向这里要东西，
 *   只接受这个窗口自己发来的：
 *   `console:language`（同步，界面语言）、`console:theme`（页面配色，窗口底色跟着换）、
 *   `console:login-item`（同步；不带参数是读开机自启，带布尔值是设置；不能设置时返回 null）。
 */
const { BrowserWindow, ipcMain, screen, session, shell } = require('electron');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { Readable } = require('node:stream');
const { decide, windowFilePath, contentType, isLocal, WINDOW_PREFIX, WINDOW_CSP } = require('./console-routes.cjs');
const { applyTheme, chromeOptions, readSize, saveSize } = require('./console-chrome.cjs');

const CONSOLE_PARTITION = 'persist:coopet-console';
const WINDOW_DIR = join(__dirname, 'build', 'console');

/**
 * @param {{
 *   corePort: () => number | null,
 *   petOrigin: () => string | null,
 *   language: () => string,
 *   loginItem: { available: () => boolean, get: () => boolean, set: (on: boolean) => void },
 *   sizeFile: string,
 *   log: (msg: string) => void,
 * }} deps
 */
function createConsoleWindow(deps) {
  /** @type {BrowserWindow | null} */
  let win = null;
  let sessionReady = false;
  const coreOrigin = () => {
    const port = deps.corePort();
    return port ? `http://127.0.0.1:${port}` : null;
  };

  const fromWindow = (/** @type {Electron.IpcMainEvent} */ e) => win !== null && e.sender === win.webContents;
  ipcMain.on('console:language', (e) => { e.returnValue = fromWindow(e) ? deps.language() : 'zh'; });
  ipcMain.on('console:theme', (e, theme) => { if (fromWindow(e) && win) applyTheme(win, theme, process.platform); });
  ipcMain.on('console:login-item', (e, on) => {
    if (!fromWindow(e) || !deps.loginItem.available()) { e.returnValue = null; return; }
    if (typeof on === 'boolean') { deps.loginItem.set(on); e.returnValue = deps.loginItem.get(); return; }
    e.returnValue = deps.loginItem.get();
  });

  /** @param {GlobalRequest} request */
  async function serve(request) {
    const url = new URL(request.url);
    const d = decide({ url: request.url, referrer: request.referrer, method: request.method }, { coreOrigin: coreOrigin(), petOrigin: deps.petOrigin() });
    if (d.kind === 'refuse') return new Response(null, { status: 403 });
    if (d.kind === 'forward') return forward(request, url, d.origin);
    const file = windowFilePath(WINDOW_DIR, url.pathname);
    if (!file) return new Response(null, { status: 404 });
    try {
      return new Response(readFileSync(file), { headers: { 'content-type': contentType(file), 'cache-control': 'no-store', 'content-security-policy': WINDOW_CSP } });
    } catch {
      // 不存在、是目录（没构建时 index.html 也不在）
      return new Response(null, { status: 404 });
    }
  }

  /** @param {Electron.Session} ses */
  function setupSession(ses) {
    if (sessionReady) return;
    sessionReady = true;
    ses.protocol.handle('http', serve);
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, answer) => {
      answer({ cancel: !isLocal(details.url) });
    });
  }

  /** @param {Electron.WebContents} contents */
  function keepOnConsole(contents) {
    const ours = (/** @type {string} */ url) => { const o = coreOrigin(); return !!o && url.startsWith(`${o}/`); };
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url) && !ours(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    contents.on('will-navigate', (e, url) => {
      if (ours(url)) return;
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    });
    // 框架（桌宠页面、形象包在里面加载的东西）只许本机，且不许是核心地址：那里的页面有核心接口的全部权限
    contents.on('will-frame-navigate', (e) => {
      if (e.isMainFrame || /^about:(blank|srcdoc)$/.test(e.url)) return;
      const o = coreOrigin();
      if (isLocal(e.url) && !(o && e.url.startsWith(`${o}/`))) return;
      e.preventDefault();
    });
  }

  return {
    /** 打开设置窗；route 是页面的 hash 路由，例如 `#/dress` */
    open(route = '') {
      const origin = coreOrigin();
      if (!origin) { deps.log('核心还没就绪，设置窗打不开'); return; }
      const target = `${origin}${WINDOW_PREFIX}${route}`;
      if (win) {
        if (route || !win.webContents.getURL().startsWith(origin)) void win.loadURL(target);
        win.show();
        win.focus();
        return;
      }
      const ses = session.fromPartition(CONSOLE_PARTITION);
      setupSession(ses);
      win = new BrowserWindow({
        ...readSize(deps.sizeFile, screen.getPrimaryDisplay().workAreaSize),
        ...chromeOptions(process.platform),
        title: 'Coopet', autoHideMenuBar: true, show: false, backgroundColor: '#f4f5f4',
        webPreferences: { session: ses, preload: join(__dirname, 'console-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
      });
      keepOnConsole(win.webContents);
      const w = win;
      w.once('ready-to-show', () => w.show());
      w.on('page-title-updated', (e) => e.preventDefault());
      w.on('close', () => {
        try { saveSize(deps.sizeFile, w.getNormalBounds()); } catch (err) { deps.log(`设置窗大小没能保存：${String(err)}`); }
      });
      w.on('closed', () => { win = null; });
      void win.loadURL(target);
    },
    /** 界面语言改了：重新加载，页面按新语言显示（语言在页面加载时读） */
    reload() {
      if (win && !win.isDestroyed()) win.webContents.reload();
    },
    /** 核心重启后端口变了：已开的设置窗换到新地址 */
    coreRestarted() {
      const origin = coreOrigin();
      if (win && origin) void win.loadURL(`${origin}${WINDOW_PREFIX}${new URL(win.webContents.getURL()).hash}`);
    },
  };
}

/**
 * @param {GlobalRequest} request
 * @param {URL} url
 * @param {string | null} origin
 * @returns {Promise<Response>}
 */
function forward(request, url, origin) {
  /** @type {Record<string, string>} */
  const headers = {};
  request.headers.forEach((value, key) => { headers[key] = value; });
  headers.host = url.host;
  if (origin) headers.origin = origin;
  return new Promise((done) => {
    const out = http.request({ host: url.hostname, port: url.port || 80, method: request.method, path: url.pathname + url.search, headers }, (res) => {
      const back = new Headers();
      for (const [key, value] of Object.entries(res.headers)) {
        if (Array.isArray(value)) for (const v of value) back.append(key, v);
        else if (value !== undefined) back.set(key, value);
      }
      const empty = request.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304;
      done(new Response(empty ? null : /** @type {any} */ (Readable.toWeb(res)), { status: res.statusCode, statusText: res.statusMessage, headers: back }));
    });
    out.on('error', () => done(new Response(null, { status: 502 })));
    if (!request.body) { out.end(); return; }
    // 正文中途断了就不当成完整的发出去
    const body = Readable.fromWeb(/** @type {any} */ (request.body));
    body.on('error', (err) => out.destroy(err));
    body.pipe(out);
  });
}

module.exports = { createConsoleWindow };
