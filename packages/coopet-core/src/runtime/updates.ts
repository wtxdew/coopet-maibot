/**
 * 在桌宠气泡里说更新器（外壳的 updater.cjs）的每一步，照 Coopanion 的 core/companion.ts 的 sayUpdates：
 * 每一步只说一次；桌宠页面连着时才说，还没说的旧一步被新一步替换。
 *
 * - 正在下载：「好」，第二个按钮悬停时显示"前往 GitHub 手动下载"；
 * - 已下载：「现在重启更新」→ 告诉外壳安装（静默安装后重新打开）；「下次再说」→ 退出时自动装；
 * - 下载失败：「前往 GitHub 下载」→ 外壳打开 Release 页面。
 */

import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { PetHandle } from './pet.ts';

export interface UpdateStep { phase: 'downloading' | 'ready' | 'failed'; version: string; reason?: string }

const TEXT = {
  zh: {
    downloading: (v: string) => `发现新版本 ${v}，正在后台下载，下好了我再告诉你。`,
    ready: (v: string) => `新版本 ${v} 下载好了。现在重启更新吗？不急的话，下次退出 Coopet 时会自动装上。`,
    failed: (v: string, why: string) => `新版本 ${v} 没能下载下来：${why}。可以去 GitHub 手动下载安装。`,
    ok: '好', github: '前往 GitHub 下载', install: '现在重启更新', later: '下次再说', gotIt: '知道了',
    trouble: '遇到问题？', githubByHand: '前往 GitHub 手动下载',
  },
  en: {
    downloading: (v: string) => `Version ${v} is out and downloading in the background; I'll tell you when it's ready.`,
    ready: (v: string) => `Version ${v} is downloaded. Restart to update now? Otherwise it installs the next time you quit Coopet.`,
    failed: (v: string, why: string) => `Version ${v} did not download: ${why}. You can get it from GitHub yourself.`,
    ok: 'OK', github: 'Download from GitHub', install: 'Restart and update', later: 'Later', gotIt: 'OK',
    trouble: 'Having trouble?', githubByHand: 'Download from GitHub by hand',
  },
} as const;

/** 收到的消息是不是一步（或 null：更新被取消，清掉提示） */
export function parseStep(raw: unknown): UpdateStep | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object') return undefined;
  const s = raw as Partial<UpdateStep>;
  if (typeof s.version !== 'string' || !(s.phase === 'downloading' || s.phase === 'ready' || s.phase === 'failed')) return undefined;
  return { phase: s.phase, version: s.version, ...(typeof s.reason === 'string' ? { reason: s.reason } : {}) };
}

/**
 * 返回"收到一步"的函数。`install`：用户点了现在重启更新；`releases`：要打开 Release 页面。
 * `everyMs` 是检查桌宠能不能说的间隔（测试时调小）。
 */
export function sayUpdates(opts: {
  pet: () => Pick<PetHandle, 'dialog' | 'connected'> | null;
  language: () => Language;
  install: () => void;
  releases: () => void;
  everyMs?: number;
}): { take(step: UpdateStep | null): void; stop(): void } {
  let pending: UpdateStep | null = null;
  let dialog: ReturnType<PetHandle['dialog']> | null = null;
  const said = new Set<string>();

  const timer = setInterval(() => {
    const p = opts.pet();
    if (!pending || !p?.connected()) return;
    const step = pending;
    pending = null;
    const s = TEXT[baseLanguage(opts.language())];
    const [text, options] = step.phase === 'downloading'
      ? [s.downloading(step.version), [{ label: s.ok, primary: true }, { label: s.trouble, hover: s.githubByHand }]]
      : step.phase === 'ready'
        ? [s.ready(step.version), [{ label: s.install, primary: true }, { label: s.later }]]
        : [s.failed(step.version, step.reason ?? '?'), [{ label: s.github, primary: true }, { label: s.gotIt }]];
    dialog?.close();
    const shown = p.dialog({ text, actions: [step.phase === 'failed' ? 'sad' : 'happy'], closable: true, input: { kind: 'buttons', options } });
    dialog = shown;
    void shown.answer.then((a) => {
      if (dialog !== shown) return;
      dialog = null;
      // 桌宠页面这时不在：等它回来再说
      if ('unavailable' in a) { pending ??= step; return; }
      if (!('index' in a)) return;
      if ((step.phase === 'downloading' && a.index === 1) || (step.phase === 'failed' && a.index === 0)) opts.releases();
      if (step.phase === 'ready' && a.index === 0) opts.install();
    });
  }, opts.everyMs ?? 2000);
  timer.unref();

  return {
    take(step) {
      if (!step) {
        pending = null;
        said.clear();
        dialog?.close();
        dialog = null;
        return;
      }
      const key = `${step.phase}:${step.version}`;
      if (said.has(key)) return;
      said.add(key);
      pending = step;
    },
    stop() {
      clearInterval(timer);
      dialog?.close();
    },
  };
}
