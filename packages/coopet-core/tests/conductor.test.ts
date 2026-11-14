import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EventEnvelope, RunPhase } from 'cortico/core/types.ts';
import { Conductor } from '../src/conductor/conductor.ts';
import { LinkSwitch } from '../src/link/switch.ts';
import type { IncomingMessage, LinkState, OutgoingChat, OutgoingNotice } from '../src/link/types.ts';
import { consoleLogger } from '../src/runtime/log.ts';

type Call =
  | { k: 'say'; script: string }
  | { k: 'phase'; state: RunPhase['state'] }
  | { k: 'turnEnded' }
  | { k: 'settled'; cursors: number[]; outcome: string };

function setup(state: LinkState = 'open', opts: { decorate?: (t: string) => string; sendFails?: boolean; realThinking?: boolean; noticeGapMs?: number; notices?: 'ok' | 'fail'; maibotNoticeGapMs?: number } = {}) {
  const calls: Call[] = [];
  const sent: OutgoingChat[] = [];
  const noticed: OutgoingNotice[] = [];
  let onMessage: (m: IncomingMessage) => void = () => {};
  let onState: (s: LinkState) => void = () => {};
  let onThinking: (on: boolean) => void = () => {};
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
    ...(opts.realThinking ? { onThinking: (cb: (on: boolean) => void) => { onThinking = cb; } } : {}),
    ...(opts.notices ? {
      supportsNotice: () => linkState === 'open',
      notice: async (n: OutgoingNotice) => { if (opts.notices === 'fail') throw new Error('rejected：MaiBot 没有收下'); noticed.push(n); return { id: 'n' }; },
    } : {}),
  };
  const conductor = new Conductor({
    pet, link, log: consoleLogger('test', 'error'), botName: () => '麦麦',
    thinkingTimeoutMs: 1000, noticeGapMs: opts.noticeGapMs ?? 0, maibotNoticeGapMs: opts.maibotNoticeGapMs ?? 0,
    worldLabel: (id) => (id === 'ntfy' ? 'ntfy 通知' : undefined),
    ...(opts.decorate ? { decorate: opts.decorate } : {}),
  });
  return {
    conductor, calls, sent, noticed,
    incoming: (parts: IncomingMessage['parts']) => onMessage({ parts, receivedAt: Date.now() }),
    setLink: (s: LinkState) => { linkState = s; onState(s); },
    think: (on: boolean) => onThinking(on),
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

  describe('with real thinking from the link', () => {
    it('marks a message delivered on ack without guessing thinking', async () => {
      const t = setup('open', { realThinking: true });
      t.conductor.handle(said(1, '你好'));
      await tick();
      expect(t.sent).toEqual([{ text: '你好' }]);
      expect(t.calls).toEqual([{ k: 'settled', cursors: [1], outcome: 'delivered' }]);
    });

    it('shows thinking from the signal and ends it with the reply', async () => {
      const t = setup('open', { realThinking: true });
      t.think(true);
      t.incoming([{ kind: 'text', text: '在呢' }]);
      await tick();
      t.think(false); // 回复之后插件才发 off：不应再重复结束
      expect(t.calls).toEqual([
        { k: 'phase', state: 'model' },
        { k: 'phase', state: 'tools' },
        { k: 'say', script: '在呢' },
        { k: 'phase', state: 'idle' },
        { k: 'turnEnded' },
      ]);
    });

    it('ends thinking when the signal turns off without a reply', () => {
      const t = setup('open', { realThinking: true });
      t.think(true);
      t.think(true);
      t.think(false);
      expect(t.calls).toEqual([{ k: 'phase', state: 'model' }, { k: 'phase', state: 'idle' }, { k: 'turnEnded' }]);
    });

    it('ends thinking when the link closes', () => {
      const t = setup('open', { realThinking: true });
      t.think(true);
      t.setLink('closed');
      expect(t.calls.at(-1)).toEqual({ k: 'turnEnded' });
    });
  });
});

describe('reply escaping', () => {
  it('escapes markers in the reply before the expression rules add their own', async () => {
    const t = setup('open', { decorate: (text) => `<happy>${text}` });
    t.incoming([{ kind: 'text', text: '【开心】好呀<笑>' }]);
    await tick();
    expect(t.calls.find((c) => c.k === 'say')).toEqual({ k: 'say', script: '<happy>〖开心〗好呀‹笑>' });
  });
});

describe('extension world events', () => {
  it('lets the pet say what routing renders, and ignores what it skips', async () => {
    const t = setup('open');
    const notice = { cursor: 9, type: 'coding-agent.completed', source: 'coding-agent-notify', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text: '……\n最终结论：\n全部完成。', meta: { agent: 'claude', workspace: '/w/coopet' } } as EventEnvelope;
    t.conductor.worldEvent('coding-agent-notify', { event: notice });
    t.conductor.worldEvent('rss', { event: { ...notice, type: 'rss.new_items' } });
    await tick();
    expect(t.calls).toEqual([{ k: 'say', script: 'Claude Code 完成了 · coopet：全部完成。' }]);
    expect(t.sent).toEqual([]);
    expect(t.conductor.stats().turns).toBe(0);
  });
});

describe('notice pacing', () => {
  const notice = (cursor: number, text: string, meta: { topic: string }) => ({ event: { cursor, type: 'ntfy.message', source: 'ntfy', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text, meta: { ...meta, label: meta.topic, message: text } } as EventEnvelope });

  it('spaces notices apart and merges ones from the same source still waiting', async () => {
    vi.useFakeTimers();
    try {
      const t = setup('open', { noticeGapMs: 1000 });
      const routes = { ntfy: { mode: 'pet' as const, unknown: 'pet' as const, maxChars: 80 } };
      (t.conductor as unknown as { opts: { routeOf: (id: string) => unknown } }).opts.routeOf = (id) => routes[id as 'ntfy'];
      t.conductor.worldEvent('ntfy', notice(1, '构建完成', { topic: 'build' }));
      t.conductor.worldEvent('ntfy', notice(2, '测试一', { topic: 'test' }));
      t.conductor.worldEvent('ntfy', notice(3, '测试二', { topic: 'test' }));
      t.conductor.worldEvent('ntfy', notice(4, '测试三', { topic: 'test' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.calls).toEqual([{ k: 'say', script: 'build：构建完成' }]);
      await vi.advanceTimersByTimeAsync(999);
      expect(t.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(t.calls[1]).toEqual({ k: 'say', script: 'test：测试三（还有 2 条）' });
      t.conductor.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('notices to MaiBot', () => {
  const notice = (cursor: number, text: string, topic = 'build') => ({ event: { cursor, type: 'ntfy.message', source: 'ntfy', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text, meta: { topic, label: topic, message: text } } as EventEnvelope });
  const toMaibot = (t: ReturnType<typeof setup>) => {
    (t.conductor as unknown as { opts: { routeOf: () => unknown } }).opts.routeOf = () => ({ mode: 'maibot', unknown: 'record', maxChars: 80 });
  };

  it('hands the notice to MaiBot when the plugin takes notices', async () => {
    const t = setup('open', { notices: 'ok' });
    toMaibot(t);
    t.conductor.worldEvent('ntfy', notice(1, '构建 **完成**'));
    await tick(); await tick();
    expect(t.noticed).toEqual([{ source: 'ntfy 通知', text: 'build：构建 完成' }]);
    expect(t.calls).toEqual([]);
    expect(t.sent).toEqual([]);
  });

  it('lets the pet say it when the plugin is older or not connected', async () => {
    const older = setup('open');
    toMaibot(older);
    older.conductor.worldEvent('ntfy', notice(1, '构建完成'));
    await tick();
    expect(older.calls).toEqual([{ k: 'say', script: 'build：构建完成' }]);
    const offline = setup('closed', { notices: 'ok' });
    toMaibot(offline);
    offline.conductor.worldEvent('ntfy', notice(1, '构建完成'));
    await tick();
    expect(offline.noticed).toEqual([]);
    expect(offline.calls).toEqual([{ k: 'say', script: 'build：构建完成' }]);
  });

  it('lets the pet say it when MaiBot does not take it', async () => {
    const t = setup('open', { notices: 'fail' });
    toMaibot(t);
    t.conductor.worldEvent('ntfy', notice(1, '构建完成'));
    await tick(); await tick(); await tick();
    expect(t.calls).toEqual([{ k: 'say', script: 'build：构建完成' }]);
  });

  it('spaces notices to MaiBot apart and merges ones from the same source', async () => {
    vi.useFakeTimers();
    try {
      const t = setup('open', { notices: 'ok', maibotNoticeGapMs: 1000 });
      toMaibot(t);
      t.conductor.worldEvent('ntfy', notice(1, '构建完成'));
      t.conductor.worldEvent('ntfy', notice(2, '测试一', 'test'));
      t.conductor.worldEvent('ntfy', notice(3, '测试二', 'test'));
      await vi.advanceTimersByTimeAsync(0);
      expect(t.noticed.map((n) => n.text)).toEqual(['build：构建完成']);
      await vi.advanceTimersByTimeAsync(1000);
      expect(t.noticed.map((n) => n.text)).toEqual(['build：构建完成', 'test：测试二（还有 1 条）']);
      expect(t.calls).toEqual([]);
      t.conductor.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('conversation stats', () => {
  it('counts turns and records how each ended', async () => {
    const t = setup('open', { realThinking: true });
    t.conductor.handle(said(1, '你好'));
    await tick();
    t.think(true);
    t.incoming([{ kind: 'text', text: '在呢' }]);
    await tick();
    const first = t.conductor.stats();
    expect(first.turns).toBe(1);
    expect(first.last).toMatchObject({ cursor: 1, via: 'typed', outcome: 'replied' });
    expect(first.last!.steps.map((x) => x.step)).toEqual(['acked', 'thinking', 'reply', 'bubble']);
    expect(first.recent.replied).toBe(1);

    t.setLink('closed');
    t.conductor.handle(said(2, '在吗', 'desktop-pet.speech'));
    await tick();
    expect(t.conductor.stats()).toMatchObject({ turns: 2, last: { cursor: 2, via: 'voice', outcome: 'not-sent' } });
    t.conductor.stop();
  });
});

describe('with a switchable link', () => {
  /** 最小的内部连接：一直是 open，发出的消息记下来 */
  const inner = (withThinking: boolean) => {
    const listeners: Array<(on: boolean) => void> = [];
    return {
      start() {}, async stop() {}, state: () => 'open' as LinkState,
      send: async () => ({ id: 'x' }), onMessage() {}, onState() {},
      ...(withThinking ? { onThinking: (cb: (on: boolean) => void) => { listeners.push(cb); } } : {}),
      think: (on: boolean) => { for (const cb of listeners) cb(on); },
    };
  };

  it('asks each turn whether the current link has real thinking', async () => {
    const plugin = inner(true);
    const sw = new LinkSwitch(plugin);
    const calls: Call[] = [];
    const pet = {
      call: vi.fn(async () => 'ok'),
      phase: (p: Omit<RunPhase, 'enteredAt'>) => { calls.push({ k: 'phase', state: p.state }); },
      turnEnded: () => {},
      settled: (events: readonly EventEnvelope[], outcome: string) => { calls.push({ k: 'settled', cursors: events.map((e) => e.cursor), outcome }); },
    };
    const conductor = new Conductor({ pet, link: sw, log: consoleLogger('test', 'error'), botName: () => '麦麦', thinkingTimeoutMs: 1000 });
    sw.start();

    conductor.handle(said(1, '你好'));
    await tick();
    // 插件：ack 即送达，不自己估计思考
    expect(calls).toEqual([{ k: 'settled', cursors: [1], outcome: 'delivered' }]);
    plugin.think(true);
    expect(calls.at(-1)).toEqual({ k: 'phase', state: 'model' });

    calls.length = 0;
    await sw.replace(inner(false));
    calls.length = 0;
    conductor.handle(said(2, '在吗'));
    await tick();
    // maim_message：发出就显示思考中（估计）
    expect(calls).toEqual([{ k: 'phase', state: 'model' }]);
    conductor.stop();
  });
});
