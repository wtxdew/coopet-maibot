/**
 * 更新后第一次启动时，桌宠在气泡里说一句「Coopet 更新到 vX 了」，带「看看改了什么」（打开这个版本的 Release 页面）和「好」。
 *
 * 上次运行的版本记在数据目录的 `data/last-version.json`（`{"version":"0.2.0"}`），每次启动都写成这次的版本：
 * - 没有这个文件、也没有 config.json：全新安装，不说；
 * - 没有这个文件、但有 config.json：从还没有这个功能的版本（0.1.x）升上来，说；
 * - 文件里的版本比这次旧：说；一样或更新（降级）：不说；
 * - 文件坏了（不是 JSON、没有版本号）：不说，改写成这次的版本。
 *
 * 气泡等桌宠页面连上再说，和更新器的气泡（updates.ts）一样每隔一会儿看一次；只说一次。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { Logger } from 'cortico/core/types.ts';
import type { PetHandle } from './pet.ts';

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** a 比 b 新（三段数字的版本号；认不得的当作不新） */
export function newerVersion(a: string, b: string): boolean {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return false;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d > 0;
  }
  return false;
}

/**
 * 读上次运行的版本、写成这次的，返回要不要说「更新到 current 了」。
 * `hadConfig`：这次启动之前数据目录里就有 config.json（用来分辨全新安装和从旧版本升上来）。
 * 写不了文件不算错：返回值照样算，下次启动再试。
 */
export function checkUpdated(file: string, current: string, hadConfig: boolean): boolean {
  let raw: string | null = null;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    raw = null;
  }
  let updated: boolean;
  if (raw === null) {
    updated = hadConfig;
  } else {
    let last: unknown;
    try {
      last = (JSON.parse(raw) as { version?: unknown }).version;
    } catch {
      last = undefined;
    }
    updated = typeof last === 'string' && newerVersion(current, last);
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ version: current })}\n`);
  } catch {
    // 下次启动再写
  }
  return updated;
}

const TEXT = {
  zh: { said: (v: string) => `Coopet 更新到 v${v} 了。`, notes: '看看改了什么', ok: '好' },
  en: { said: (v: string) => `Coopet is now v${v}.`, notes: "See what's new", ok: 'OK' },
} as const;

/**
 * 等桌宠页面连上，说一次「更新到 version 了」；点「看看改了什么」调 `releases(version)`。
 * `everyMs` 是检查桌宠能不能说的间隔（测试时调小）。
 */
export function sayUpdated(opts: {
  version: string;
  pet: () => Pick<PetHandle, 'dialog' | 'connected'> | null;
  language: () => Language;
  releases: (version: string) => void;
  log?: Pick<Logger, 'info'>;
  everyMs?: number;
}): { stop(): void } {
  let pending = true;
  let dialog: ReturnType<PetHandle['dialog']> | null = null;
  const timer = setInterval(() => {
    const p = opts.pet();
    if (!pending || !p?.connected()) return;
    pending = false;
    const s = TEXT[baseLanguage(opts.language())];
    const shown = p.dialog({
      text: s.said(opts.version),
      actions: ['happy'],
      closable: true,
      input: { kind: 'buttons', options: [{ label: s.notes, primary: true }, { label: s.ok }] },
    });
    dialog = shown;
    opts.log?.info(`更新后的气泡：v${opts.version}`);
    void shown.answer.then((a) => {
      if (dialog !== shown) return;
      dialog = null;
      // 桌宠页面这时不在：等它回来再说
      if ('unavailable' in a) { pending = true; return; }
      opts.log?.info(`更新后的气泡的回答：${JSON.stringify(a)}`);
      if ('index' in a && a.index === 0) opts.releases(opts.version);
      clearInterval(timer);
    });
  }, opts.everyMs ?? 2000);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      dialog?.close();
    },
  };
}
