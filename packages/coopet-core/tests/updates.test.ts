import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseStep, sayUpdates } from '../src/runtime/updates.ts';
import type { PetHandle } from '../src/runtime/pet.ts';

type Answer = { index: number } | { unavailable: true } | { closed: true };

/** 假桌宠：记下每次问的话，答案由测试给 */
function fakePet() {
  const asked: Array<{ text: string; labels: string[]; answer: (a: Answer) => void; closed: boolean }> = [];
  let connected = true;
  const pet = {
    connected: () => connected,
    dialog: (d: { text: string; input?: { options?: Array<{ label: string }> } }) => {
      let answer!: (a: Answer) => void;
      const entry = { text: d.text, labels: (d.input?.options ?? []).map((o) => o.label), answer: (a: Answer) => answer(a), closed: false };
      asked.push(entry);
      return { answer: new Promise<Answer>((r) => { answer = r; }), update: () => {}, close: () => { entry.closed = true; } };
    },
  };
  return { pet: pet as unknown as Pick<PetHandle, 'dialog' | 'connected'>, asked, setConnected: (on: boolean) => { connected = on; } };
}

const tick = () => vi.advanceTimersByTimeAsync(10);

describe('update bubbles', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reads steps from the shell and refuses others', () => {
    expect(parseStep(null)).toBeNull();
    expect(parseStep({ phase: 'ready', version: '0.1.2' })).toEqual({ phase: 'ready', version: '0.1.2' });
    expect(parseStep({ phase: 'failed', version: '0.1.2', reason: 'net' })).toEqual({ phase: 'failed', version: '0.1.2', reason: 'net' });
    expect(parseStep({ phase: 'boom', version: '0.1.2' })).toBeUndefined();
    expect(parseStep('ready')).toBeUndefined();
  });

  it('says each step once while the pet page is connected, and passes the buttons on', async () => {
    vi.useFakeTimers();
    const { pet, asked, setConnected } = fakePet();
    const install = vi.fn();
    const releases = vi.fn();
    const u = sayUpdates({ pet: () => pet, language: () => 'zh', install, releases, everyMs: 5 });

    setConnected(false);
    u.take({ phase: 'downloading', version: '0.1.2' });
    await tick();
    expect(asked).toHaveLength(0);
    setConnected(true);
    await tick();
    expect(asked).toHaveLength(1);
    expect(asked[0]!.text).toContain('0.1.2');
    // 同一步不说第二次
    u.take({ phase: 'downloading', version: '0.1.2' });
    await tick();
    expect(asked).toHaveLength(1);
    asked[0]!.answer({ index: 1 });
    await tick();
    expect(releases).toHaveBeenCalledOnce();

    u.take({ phase: 'ready', version: '0.1.2' });
    await tick();
    expect(asked[1]!.labels).toEqual(['现在重启更新', '下次再说']);
    asked[1]!.answer({ index: 0 });
    await tick();
    expect(install).toHaveBeenCalledOnce();
    u.stop();
  });

  it('says a step again when the pet page was away, and clears on null', async () => {
    vi.useFakeTimers();
    const { pet, asked } = fakePet();
    const u = sayUpdates({ pet: () => pet, language: () => 'en', install: () => {}, releases: () => {}, everyMs: 5 });
    u.take({ phase: 'failed', version: '0.1.2', reason: 'offline' });
    await tick();
    expect(asked[0]!.text).toContain('offline');
    asked[0]!.answer({ unavailable: true });
    await tick();
    expect(asked).toHaveLength(2);
    u.take(null);
    expect(asked[1]!.closed).toBe(true);
    // 清掉之后同一步可以再说
    u.take({ phase: 'failed', version: '0.1.2', reason: 'offline' });
    await tick();
    expect(asked).toHaveLength(3);
    u.stop();
  });
});
