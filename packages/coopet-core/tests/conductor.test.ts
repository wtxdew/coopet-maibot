import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, RunPhase } from 'cortico/core/types.ts';
import { Conductor } from '../src/conductor/conductor.ts';
import type { IncomingMessage, LinkState, OutgoingChat } from '../src/link/types.ts';
import { consoleLogger } from '../src/runtime/log.ts';

type Call =
  | { k: 'say'; script: string }
  | { k: 'phase'; state: RunPhase['state'] }
  | { k: 'turnEnded' }
  | { k: 'settled'; cursors: number[]; outcome: string };

function setup(state: LinkState = 'open', opts: { decorate?: (t: string) => string; sendFails?: boolean } = {}) {
  const calls: Call[] = [];
  const sent: OutgoingChat[] = [];
  let onMessage: (m: IncomingMessage) => void = () => {};
  let onState: (s: LinkState) => void = () => {};
  let linkState = state;
  const pet = {
    call: vi.fn(async (_tool: string, args: Record<string, unknown>) => { calls.push({ k: 'say', script: String(args.script) }); return 'ok'; }),
    phase: (p: Omit<RunPhase, 'enteredAt'>) => { calls.push({ k: 'phase', state: p.state }); },
    turnEnded: () => { calls.push({ k: 'turnEnded' }); },
    settled: (events: readonly EventEnvelope[], outcome: string) => { calls.push({ k: 'settled', cursors: events.map((e) => e.cursor), outcome }); },
  };
  const link = {
    state: () => linkState,
    send: async (m: OutgoingChat) => { if (opts.sendFails) throw new Error('socket gone'); sent.push(m); return { id: 'x' }; },
    onMessage: (cb: (m: IncomingMessage) => void) => { onMessage = cb; },
    onState: (cb: (s: LinkState) => void) => { onState = cb; },
  };
  const conductor = new Conductor({
    pet, link, log: consoleLogger('test', 'error'), botName: () => '麦麦',
    thinkingTimeoutMs: 1000, ...(opts.decorate ? { decorate: opts.decorate } : {}),
  });
  return {
    conductor, calls, sent,
    incoming: (parts: IncomingMessage['parts']) => onMessage({ parts, receivedAt: Date.now() }),
    setLink: (s: LinkState) => { linkState = s; onState(s); },
  };
}

function said(cursor: number, text: string, type = 'desktop-pet.message'): { event: EventEnvelope } {
  return { event: { cursor, type, source: 'desktop-pet', origin: 'external', ts: '2026-11-12T10:00:00+08:00', text: `[10:00] 主人说：${text}`, meta: { text } } };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
afterEach(() => { vi.useRealTimers(); });

describe('Conductor', () => {
  it('sends what the user typed or said and shows thinking', async () => {
    const t = setup();
    t.conductor.handle(said(1, '你好'));
    t.conductor.handle(said(2, '在吗', 'desktop-pet.speech'));
    await tick();
    expect(t.sent).toEqual([{ text: '你好' }, { text: '在吗' }]);
    expect(t.calls).toEqual([{ k: 'phase', state: 'model' }, { k: 'phase', state: 'model' }]);
  });

  it('shows a reply, then settles the waiting events as delivered', async () => {
    const t = setup('open', { decorate: (s) => `【开心】${s}` });
    t.conductor.handle(said(1, '你好'));
    await tick();
    t.calls.length = 0;
    t.incoming([{ kind: 'text', text: '在呢' }, { kind: 'emoji', base64: 'AA' }]);
    await tick();
    expect(t.calls).toEqual([
      { k: 'phase', state: 'tools' },
      { k: 'say', script: '【开心】在呢[表情]' },
      { k: 'phase', state: 'idle' },
      { k: 'turnEnded' },
      { k: 'settled', cursors: [1], outcome: 'delivered' },
    ]);
  });

  it('shows a proactive message without settling anything', async () => {
    const t = setup();
    t.incoming([{ kind: 'text', text: '主人，该休息了' }]);
    await tick();
    expect(t.calls.map((c) => c.k)).toEqual(['phase', 'say', 'phase', 'turnEnded']);
  });

  it('ends thinking quietly when MaiBot does not reply in time', async () => {
    vi.useFakeTimers();
    const t = setup();
    t.conductor.handle(said(1, '你好'));
    await vi.advanceTimersByTimeAsync(0);
    t.calls.length = 0;
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.calls).toEqual([
      { k: 'phase', state: 'idle' },
      { k: 'turnEnded' },
      { k: 'settled', cursors: [1], outcome: 'delivered' },
    ]);
  });

  it('says it is not connected and discards the message', async () => {
    const t = setup('closed');
    t.conductor.handle(said(1, '你好'));
    await tick();
    expect(t.sent).toEqual([]);
    expect(t.calls).toEqual([{ k: 'say', script: '还没连上麦麦' }, { k: 'settled', cursors: [1], outcome: 'discarded' }]);
  });

  it('treats a failed send like not connected', async () => {
    const t = setup('open', { sendFails: true });
    t.conductor.handle(said(1, '你好'));
    await tick();
    expect(t.calls.at(-1)).toEqual({ k: 'settled', cursors: [1], outcome: 'discarded' });
  });

  it('discards waiting events when the link closes', async () => {
    const t = setup();
    t.conductor.handle(said(1, '你好'));
    await tick();
    t.calls.length = 0;
    t.setLink('closed');
    expect(t.calls.at(-1)).toEqual({ k: 'settled', cursors: [1], outcome: 'discarded' });
  });

  it('ignores touches and empty text', async () => {
    const t = setup();
    t.conductor.handle({ event: { ...said(1, '').event, type: 'desktop-pet.touch', meta: { touch: { kind: 'poke' } } } });
    t.conductor.handle(said(2, '   '));
    await tick();
    expect(t.sent).toEqual([]);
    expect(t.calls).toEqual([]);
  });
});
