import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkUpdated, newerVersion, sayUpdated } from '../src/runtime/after-update.ts';
import type { PetHandle } from '../src/runtime/pet.ts';

type Answer = { index: number } | { unavailable: true } | { closed: true };

const fileIn = () => join(mkdtempSync(join(tmpdir(), 'coopet-after-update-')), 'data', 'last-version.json');
const saved = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { version: string };

describe('checkUpdated', () => {
  it('compares three-part versions', () => {
    expect(newerVersion('0.2.0', '0.1.4')).toBe(true);
    expect(newerVersion('0.1.10', '0.1.9')).toBe(true);
    expect(newerVersion('1.0.0', '0.99.99')).toBe(true);
    expect(newerVersion('0.1.4', '0.1.4')).toBe(false);
    expect(newerVersion('0.1.3', '0.1.4')).toBe(false);
    expect(newerVersion('0.2.0', 'garbage')).toBe(false);
  });

  it('stays quiet on a new install and remembers the version', () => {
    const file = fileIn();
    expect(checkUpdated(file, '0.2.0', false)).toBe(false);
    expect(saved(file).version).toBe('0.2.0');
  });

  it('speaks after an update from a version without this file (0.1.x)', () => {
    const file = fileIn();
    expect(checkUpdated(file, '0.2.0', true)).toBe(true);
    expect(saved(file).version).toBe('0.2.0');
    // the next start of the same version stays quiet
    expect(checkUpdated(file, '0.2.0', true)).toBe(false);
  });

  it('speaks after an update, not on the same version or a downgrade', () => {
    const file = fileIn();
    checkUpdated(file, '0.2.0', false);
    expect(checkUpdated(file, '0.2.1', true)).toBe(true);
    expect(checkUpdated(file, '0.2.1', true)).toBe(false);
    expect(checkUpdated(file, '0.2.0', true)).toBe(false);
    expect(saved(file).version).toBe('0.2.0');
  });

  it('stays quiet on a broken file and rewrites it', () => {
    for (const broken of ['not json', '{}', '{"version": 3}']) {
      const file = fileIn();
      checkUpdated(file, '0.1.0', false);
      writeFileSync(file, broken);
      expect(checkUpdated(file, '0.2.0', true)).toBe(false);
      expect(saved(file).version).toBe('0.2.0');
    }
  });
});

/** 假桌宠：记下每次问的话，答案由测试给 */
function fakePet() {
  const asked: Array<{ text: string; labels: string[]; answer: (a: Answer) => void }> = [];
  let connected = false;
  const pet = {
    connected: () => connected,
    dialog: (d: { text: string; input?: { options?: Array<{ label: string }> } }) => {
      let answer!: (a: Answer) => void;
      asked.push({ text: d.text, labels: (d.input?.options ?? []).map((o) => o.label), answer: (a: Answer) => answer(a) });
      return { answer: new Promise<Answer>((r) => { answer = r; }), update: () => {}, close: () => {} };
    },
  };
  return { pet: pet as unknown as Pick<PetHandle, 'dialog' | 'connected'>, asked, setConnected: (on: boolean) => { connected = on; } };
}

const tick = () => vi.advanceTimersByTimeAsync(10);

describe('sayUpdated', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('waits for the pet page, says it once, and opens the release page on the first button', async () => {
    vi.useFakeTimers();
    const { pet, asked, setConnected } = fakePet();
    const releases = vi.fn();
    const s = sayUpdated({ version: '0.2.0', pet: () => pet, language: () => 'zh', releases, everyMs: 5 });
    await tick();
    expect(asked).toHaveLength(0);
    setConnected(true);
    await tick();
    expect(asked.map((a) => [a.text, a.labels])).toEqual([['Coopet 更新到 v0.2.0 了。', ['看看改了什么', '好']]]);
    asked[0]!.answer({ index: 0 });
    await tick();
    expect(releases).toHaveBeenCalledWith('0.2.0');
    await tick();
    expect(asked).toHaveLength(1);
    s.stop();
  });

  it('says it again when the pet page was gone, and does nothing on 好', async () => {
    vi.useFakeTimers();
    const { pet, asked, setConnected } = fakePet();
    setConnected(true);
    const releases = vi.fn();
    const s = sayUpdated({ version: '0.2.0', pet: () => pet, language: () => 'en', releases, everyMs: 5 });
    await tick();
    asked[0]!.answer({ unavailable: true });
    await tick();
    expect(asked).toHaveLength(2);
    expect(asked[1]!.labels).toEqual(["See what's new", 'OK']);
    asked[1]!.answer({ index: 1 });
    await tick();
    expect(releases).not.toHaveBeenCalled();
    await tick();
    expect(asked).toHaveLength(2);
    s.stop();
  });
});
