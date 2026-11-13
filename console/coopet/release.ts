/**
 * 标题栏的版本号和更新状态，照 Coopanion 的 console/features/release.ts（原文件不动），换成 Coopet 的仓库和文字：
 *
 * - 版本号是到 Coopet 仓库的链接。
 * - 能自己更新的版本（Windows 安装版，外壳的 updater.cjs）：preload 给 `window.coopanionUpdate`，
 *   版本号旁边显示更新器的每一步（正在下载、已就绪、下载失败；失败时链接到 Release 页面）。
 * - 其他版本（macOS）：查 GitHub 上最新的 Release（不含 pre-release），比当前新就显示"vX 可更新"，链接到 Release 页面。
 *   设置窗会话只许这一个地址出这台机器（外壳的 console-routes.cjs 的 RELEASE_CHECK）。
 */

import { APP_VERSION } from '../app-version.ts';
import { pick } from '../base/language.ts';

const REPO_URL = 'https://github.com/wtxdew/coopet-maibot';
const RELEASES_URL = `${REPO_URL}/releases/latest`;
const RELEASE_API = 'https://api.github.com/repos/wtxdew/coopet-maibot/releases/latest';
const RELEASE_TIMEOUT_MS = 15_000;

/** 更新器的一步（外壳的 updater.cjs） */
export interface UpdateStep { phase: 'downloading' | 'ready' | 'failed'; version: string }
declare global {
  interface Window {
    coopanionUpdate?: { step(): UpdateStep | null; onStep(listener: (step: UpdateStep | null) => void): () => void };
  }
}

const S = pick({
  zh: {
    repoHint: '在 GitHub 上打开 Coopet 项目',
    updateShort: (v: string) => `v${v} 可更新`,
    update: (v: string) => `Coopet ${v} 已发布，点击打开下载页面`,
    downloadingShort: (v: string) => `正在下载 v${v}`,
    downloading: (v: string) => `Coopet ${v} 正在后台下载`,
    readyShort: (v: string) => `v${v} 已就绪`,
    ready: (v: string) => `Coopet ${v} 已下载，退出时自动安装`,
    failedShort: (v: string) => `下载 v${v}`,
    failed: (v: string) => `Coopet ${v} 没能自动下载，点击手动下载`,
  },
  en: {
    repoHint: 'Open the Coopet project on GitHub',
    updateShort: (v: string) => `v${v} available`,
    update: (v: string) => `Coopet ${v} is out; click to open the download page`,
    downloadingShort: (v: string) => `Downloading v${v}`,
    downloading: (v: string) => `Coopet ${v} is downloading in the background`,
    readyShort: (v: string) => `v${v} ready`,
    ready: (v: string) => `Coopet ${v} is downloaded and installs when the app quits`,
    failedShort: (v: string) => `Download v${v}`,
    failed: (v: string) => `Coopet ${v} did not download; click to download it by hand`,
  },
});

function versionParts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

export function isNewer(latest: string, current: string): boolean {
  const left = versionParts(latest);
  const right = versionParts(current);
  if (!left || !right) return false;
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i]! > right[i]!;
  }
  return false;
}

/** 同一次页面加载只查一次 */
let pending: Promise<{ version: string; url: string } | null> | null = null;
function checkRelease(): Promise<{ version: string; url: string } | null> {
  pending ??= fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS) })
    .then((res) => (res.ok ? res.json() as Promise<{ tag_name?: unknown; html_url?: unknown }> : null))
    .then((release) => {
      if (typeof release?.tag_name !== 'string' || typeof release.html_url !== 'string') return null;
      const url = new URL(release.html_url);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com') return null;
      return isNewer(release.tag_name, APP_VERSION) ? { version: release.tag_name.replace(/^v/, ''), url: url.href } : null;
    })
    .catch(() => null);
  return pending;
}

function link(doc: Document, className: string, text: string, href: string): HTMLAnchorElement {
  const a = doc.createElement('a');
  a.className = className;
  a.textContent = text;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

/** 短的状态文字；完整的一句放在悬停提示里 */
function hint(doc: Document, text: string, detail: string, href?: string): HTMLElement {
  const el = href ? link(doc, 'release-hint', text, href) : Object.assign(doc.createElement('span'), { className: 'release-hint', textContent: text });
  el.title = detail;
  return el;
}

function stepHint(doc: Document, { phase, version }: UpdateStep): HTMLElement {
  if (phase === 'failed') return hint(doc, S.failedShort(version), S.failed(version), RELEASES_URL);
  return phase === 'downloading'
    ? hint(doc, S.downloadingShort(version), S.downloading(version))
    : hint(doc, S.readyShort(version), S.ready(version));
}

export function mountRelease(doc: Document, container: Element, signal: AbortSignal): void {
  const repo = link(doc, 'companion-version', `Coopet v${APP_VERSION}`, REPO_URL);
  repo.title = S.repoHint;
  container.appendChild(repo);
  const status = doc.createElement('div');
  status.className = 'companion-update';
  status.setAttribute('role', 'status');
  container.append(status);
  const updater = doc.defaultView?.coopanionUpdate;
  if (updater) {
    const show = (step: UpdateStep | null) => { status.replaceChildren(...(step ? [stepHint(doc, step)] : [])); };
    show(updater.step());
    const stop = updater.onStep(show);
    signal.addEventListener('abort', stop, { once: true });
    return;
  }
  void checkRelease().then((update) => {
    if (signal.aborted || !update) return;
    status.append(hint(doc, S.updateShort(update.version), S.update(update.version), update.url));
  });
}
