import { describe, expect, it } from 'vitest';
import type { Logger } from 'cortico/core/types.ts';
import { Conductor } from '../src/conductor/conductor.ts';
import type { IncomingMessage, LinkState } from '../src/link/types.ts';

function recordingLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  const log = {
    lines,
    trace() {}, debug() {}, error() {},
    info: (m: string) => { lines.push(`I ${m}`); },
    warn: (m: string) => { lines.push(`W ${m}`); },
    emit() {},
    child: () => log,
  };
  return log;
}

function setup(state: LinkState, opts: { realThinking?: boolean; sendFails?: boolean } = {}) {
  let clock = 1000;
  let onMessage: (m: IncomingMessage) => void = () => {};
  let onThinking: (on: boolean) => void = () => {};
  const log = recordingLog();
  const conductor = new Conductor({
    pet: { call: async () => 'ok', phase: () => {}, turnEnded: () => {}, settled: () => {} },
    link: {
      state: () => state,
      send: async () => { clock += 40; if (opts.sendFails) throw new Error('10 秒内没收到确认'); return { id: 'x' }; },
      onMessage: (cb) => { onMessage = cb; },
      onState: () => {},
      ...(opts.realThinking ? { onThinking: (cb: (on: boolean) => void) => { onThinking = cb; } } : {}),
    },
    log, botName: () => '麦麦', now: () => clock, thinkingTimeoutMs: 60_000,
  });
  const say = (cursor: number, text: string) => conductor.handle({ event: { cursor, type: 'desktop-pet.message', source: 'desktop-pet', origin: 'external', ts: '', text: '', meta: { text } } });
  return {
    log, say,
    advance: (ms: number) => { clock += ms; },
    reply: (text: string) => onMessage({ parts: [{ kind: 'text', text }], receivedAt: clock }),
    think: (on: boolean) => onThinking(on),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Conductor timeline', () => {
  it('logs every step of a turn with time since the input', async () => {
    const t = setup('open', { realThinking: true });
    t.say(12, '今天好累');
    await tick();
    t.advance(1220);
    t.think(true);
    t.advance(4850);
    t.reply('辛苦啦，早点休息');
    await tick();
    t.think(false);
    expect(t.log.lines).toEqual([
      'I [对话 #12] 输入（打字）：今天好累',
      'I [对话 #12] MaiBot 收下（ack） +40ms',
      'I [对话 #12] 思考开始 +1.26s',
      'I [对话 #12] 回复到达（8 字）：辛苦啦，早点休息 +6.11s',
      'I [对话 #12] 气泡显示 +6.11s',
    ]);
  });

  it('marks failures as warnings', async () => {
    const t = setup('open', { sendFails: true });
    t.say(3, 'hi');
    await tick();
    expect(t.log.lines.at(-1)).toBe('W [对话 #3] 发送失败：10 秒内没收到确认 +40ms');
    const closed = setup('closed');
    closed.say(4, 'hi');
    await tick();
    expect(closed.log.lines.at(-1)).toBe('W [对话 #4] 没连上，未发送 +0ms');
  });

  it('calls a reply long after the last input proactive and truncates long text', async () => {
    const t = setup('open');
    t.reply('老板好');
    await tick();
    t.say(5, '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多出来的字');
    await tick();
    t.advance(121_000);
    t.reply('该休息了');
    await tick();
    expect(t.log.lines[0]).toBe('I [主动] 回复到达（3 字）：老板好');
    expect(t.log.lines).toContain('I [对话 #5] 输入（打字）：一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十…');
    expect(t.log.lines).toContain('I [主动] 回复到达（4 字）：该休息了');
  });
});
