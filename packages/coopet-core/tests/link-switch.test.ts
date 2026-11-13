import { describe, expect, it, vi } from 'vitest';
import { LinkSwitch } from '../src/link/switch.ts';
import type { IncomingMessage, Link, LinkState } from '../src/link/types.ts';

/** 假连接：记下调用，可以手动发事件。 */
function fake(withThinking: boolean) {
  const msg: Array<(m: IncomingMessage) => void> = [];
  const st: Array<(s: LinkState, r?: string) => void> = [];
  const th: Array<(on: boolean) => void> = [];
  let state: LinkState = 'closed';
  const link: Link & { emitMessage(t: string): void; emitState(s: LinkState, r?: string): void; emitThinking(on: boolean): void; started: number; stopped: number } = {
    started: 0,
    stopped: 0,
    start() { link.started++; },
    async stop() { link.stopped++; state = 'closed'; for (const cb of st) cb('closed', 'stopped'); },
    state: () => state,
    send: vi.fn(async () => ({ id: 'x' })),
    onMessage: (cb) => { msg.push(cb); },
    onState: (cb) => { st.push(cb); },
    ...(withThinking ? { onThinking: (cb: (on: boolean) => void) => { th.push(cb); } } : {}),
    botName: () => (withThinking ? '麦麦' : undefined),
    emitMessage: (t) => { for (const cb of msg) cb({ parts: [{ kind: 'text', text: t }], receivedAt: 0 }); },
    emitState: (s, r) => { state = s; for (const cb of st) cb(s, r); },
    emitThinking: (on) => { for (const cb of th) cb(on); },
  };
  return link;
}

describe('LinkSwitch', () => {
  it('forwards calls and events of the current link', async () => {
    const a = fake(true);
    const sw = new LinkSwitch(a);
    const got: string[] = [];
    sw.onMessage((m) => got.push(`msg:${(m.parts[0] as { text: string }).text}`));
    sw.onState((s) => got.push(`state:${s}`));
    sw.onThinking((on) => got.push(`thinking:${on}`));
    sw.start();
    expect(a.started).toBe(1);
    a.emitState('open');
    a.emitThinking(true);
    a.emitMessage('hi');
    await sw.send({ text: 'yo' });
    expect(a.send).toHaveBeenCalledWith({ text: 'yo' });
    expect(got).toEqual(['state:open', 'thinking:true', 'msg:hi']);
    expect(sw.state()).toBe('open');
    expect(sw.botName()).toBe('麦麦');
    expect(sw.hasThinking()).toBe(true);
  });

  it('replaces the link: stops the old one, reports one closed, starts the new one', async () => {
    const a = fake(true);
    const b = fake(false);
    const sw = new LinkSwitch(a);
    const states: string[] = [];
    const msgs: string[] = [];
    sw.onState((s, r) => states.push(`${s}${r ? `:${r}` : ''}`));
    sw.onMessage((m) => msgs.push((m.parts[0] as { text: string }).text));
    sw.start();
    await sw.replace(b);
    expect(a.stopped).toBe(1);
    expect(b.started).toBe(1);
    expect(states).toEqual(['closed:switching']);
    // 旧连接之后的事件不再传出
    a.emitMessage('old');
    a.emitState('open');
    b.emitMessage('new');
    expect(msgs).toEqual(['new']);
    expect(states).toEqual(['closed:switching']);
    expect(sw.inner()).toBe(b);
    expect(sw.hasThinking()).toBe(false);
  });

  it('does not start the new link before start', async () => {
    const b = fake(false);
    const sw = new LinkSwitch(fake(false));
    await sw.replace(b);
    expect(b.started).toBe(0);
  });
});
