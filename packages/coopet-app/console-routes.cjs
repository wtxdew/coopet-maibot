// @ts-check
/**
 * 设置窗请求的路由判断（纯函数，不碰 Electron，方便测试）。照 Coopanion app/main.cjs 的 serveWindow。
 *
 * 设置窗打开 `http://127.0.0.1:<核心端口>/coopet/`，它所在会话的每个 http 请求都先到这里：
 * - 核心地址下的 `/coopet/…`：外壳自己从 build/console 提供文件（file）。
 * - 核心地址下的其他请求：只有设置窗自己发的（referrer 是核心地址）才转发给核心（forward），其余拒绝。
 * - 桌宠页面服务（7797）的请求：设置窗或桌宠页面自己发的才转发；形象包的沙箱框架读文件时没有 referrer，
 *   只放行 GET/HEAD 读 `/figure-frame`、`/web/…`、`/packs/…`，Origin 填 `null`，让桌宠服务按它的规则处理。
 * - 其他一律拒绝（refuse，403）。
 *
 * Chromium 不把 Origin 头交给这里，所以转发时用 referrer 的来源当 Origin：核心（Cortico WebApp）据此拒绝跨站写请求。
 * WebSocket 不经过这里，直接连核心，由核心自己检查 Origin。
 */
const { extname, resolve, sep } = require('node:path');

const WINDOW_PREFIX = '/coopet/';
const WINDOW_TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
});
/** 设置窗自己的文件只运行核心地址上的脚本（扩展面板的脚本也在那里） */
const WINDOW_CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/**
 * @typedef {{ kind: 'file' } | { kind: 'forward'; origin: string | null } | { kind: 'refuse' }} Decision
 */

/**
 * @param {{ url: string, referrer: string, method: string }} req
 * @param {{ coreOrigin: string | null, petOrigin: string | null }} origins
 * @returns {Decision}
 */
function decide(req, origins) {
  const url = new URL(req.url);
  const from = req.referrer ? new URL(req.referrer).origin : null;
  const { coreOrigin, petOrigin } = origins;
  if (coreOrigin && url.origin === coreOrigin) {
    if (url.pathname.startsWith(WINDOW_PREFIX)) return { kind: 'file' };
    return from === coreOrigin ? { kind: 'forward', origin: from } : { kind: 'refuse' };
  }
  if (!petOrigin || url.origin !== petOrigin) return { kind: 'refuse' };
  if (from === coreOrigin || from === petOrigin) return { kind: 'forward', origin: from };
  const frameFile = url.pathname === '/figure-frame' || /^\/(web|packs)\//.test(url.pathname);
  return !from && frameFile && (req.method === 'GET' || req.method === 'HEAD') ? { kind: 'forward', origin: 'null' } : { kind: 'refuse' };
}

/**
 * `/coopet/…` 对应的文件；越出目录、坏的转义返回 null。
 * @param {string} dir build/console 的绝对路径
 * @param {string} pathname
 */
function windowFilePath(dir, pathname) {
  try {
    const rel = decodeURIComponent(pathname.slice(WINDOW_PREFIX.length)) || 'index.html';
    const file = resolve(dir, rel);
    return file.startsWith(dir + sep) ? file : null;
  } catch {
    return null;
  }
}

/** @param {string} file */
const contentType = (file) => WINDOW_TYPES[extname(file)] ?? 'application/octet-stream';

/** 只许连本机：设置窗会话里的请求（包括 WebSocket）不出这台机器 */
/** @param {string} url */
const isLocal = (url) => /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(url);

/** 标题栏查新版本用的地址（console/coopet/release.ts）：设置窗会话里唯一许出这台机器的请求 */
const RELEASE_CHECK = 'https://api.github.com/repos/wtxdew/coopet-maibot/releases/latest';

/** 设置窗会话里的请求许不许发：本机，或查新版本 */
/** @param {string} url */
const mayRequest = (url) => isLocal(url) || url === RELEASE_CHECK;

module.exports = { decide, windowFilePath, contentType, isLocal, mayRequest, RELEASE_CHECK, WINDOW_PREFIX, WINDOW_CSP };
