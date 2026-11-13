import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { CoreHost, RESTART_DELAY_MS, STOP_TIMEOUT_MS } = require('../core-host.cjs');

/** 假的子进程：可以手动让它发消息、退出。 */
class FakeChild extends EventEmitter {
  connected = true;
  sent: unknown[] = [];
  kills: string[] = [];
  exitOnTerm = true;
  send(m: unknown) { this.sent.push(m); }
  kill(sig: string) {
    this.kills.push(sig);
    if (sig === 'SIGKILL' || this.exitOnTerm) queueMicrotask(() => this.emit('exit', null, sig));
    return true;
  }
}

function harness() {
  const children: FakeChild[] = [];
  const forks: Array<{ entry: string; opts: any }> = [];
  let clock = 0;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const host = new CoreHost({
    entry: '/core/src/main.ts', cwd: '/core', execPath: '/Electron', env: { A: '1' },
    fork: (entry: string, _args: string[], opts: any) => { const c = new FakeChild(); children.push(c); forks.push({ entry, opts }); return c; },
    setTimeout: (fn: () => void, ms: number) => { const t = { at: clock + ms, fn, done: false }; timers.push(t); return t; },
    clearTimeout: (t: any) => { if (t) t.done = true; },
    now: () => clock,
    log: () => {},
  });
  const states: string[] = [];
  host.on('state', (s: string) => states.push(s));
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) if (!t.done && t.at <= clock) { t.done = true; t.fn(); }
  };
  return { host, children, forks, states, advance };
}

describe('CoreHost', () => {
  it('forks the core under Electron in Node mode with tsx, from the core dir', () => {
    const h = harness();
    h.host.start();
    expect(h.forks[0].entry).toBe('/core/src/main.ts');
    expect(h.forks[0].opts).toMatchObject({ cwd: '/core', execPath: '/Electron', execArgv: ['--import', 'tsx'], env: { A: '1', ELECTRON_RUN_AS_NODE: '1' } });
    expect(h.forks[0].opts.stdio).toContain('ipc');
    expect(h.states).toEqual(['starting']);
  });

  it('becomes running on ready and relays messages both ways', () => {
    const h = harness();
    const got: unknown[] = [];
    h.host.on('message', (m: unknown) => got.push(m));
    h.host.start();
    h.children[0].emit('message', { type: 'ready' });
    h.children[0].emit('message', { type: 'link', state: 'open' });
    expect(h.states).toEqual(['starting', 'running']);
    expect(got).toEqual([{ type: 'ready' }, { type: 'link', state: 'open' }]);
    expect(h.host.send({ type: 'show-pet' })).toBe(true);
    expect(h.children[0].sent).toEqual([{ type: 'show-pet' }]);
  });

  it('restarts after an unexpected exit, and gives up after too many', () => {
    const h = harness();
    h.host.start();
    for (let i = 0; i < 5; i++) {
      h.children.at(-1)!.emit('exit', 1, null);
      expect(h.host.state).toBe('restarting');
      h.advance(RESTART_DELAY_MS);
    }
    expect(h.children).toHaveLength(6);
    h.children.at(-1)!.emit('exit', 1, null);
    expect(h.host.state).toBe('failed');
    h.advance(RESTART_DELAY_MS);
    expect(h.children).toHaveLength(6);
    h.host.start(); // 放弃后手动再启动：重新计数
    expect(h.children).toHaveLength(7);
  });

  it('forgets crashes older than five minutes', () => {
    const h = harness();
    h.host.start();
    for (let i = 0; i < 10; i++) {
      h.children.at(-1)!.emit('exit', 1, null);
      h.advance(61_000);
    }
    expect(h.host.state).not.toBe('failed');
  });

  it('stops with SIGTERM and does not restart', async () => {
    const h = harness();
    h.host.start();
    await h.host.stop();
    expect(h.children[0].kills).toEqual(['SIGTERM']);
    expect(h.host.state).toBe('stopped');
    h.advance(RESTART_DELAY_MS);
    expect(h.children).toHaveLength(1);
    expect(h.host.send({ type: 'x' })).toBe(false);
  });

  it('kills a core that ignores SIGTERM', async () => {
    const h = harness();
    h.host.start();
    h.children[0].exitOnTerm = false;
    const stopped = h.host.stop();
    h.advance(STOP_TIMEOUT_MS);
    await stopped;
    expect(h.children[0].kills).toEqual(['SIGTERM', 'SIGKILL']);
  });

  it('cancels a pending restart when stopped', async () => {
    const h = harness();
    h.host.start();
    h.children[0].emit('exit', 1, null);
    await h.host.stop();
    h.advance(RESTART_DELAY_MS);
    expect(h.children).toHaveLength(1);
    expect(h.host.state).toBe('stopped');
  });
});
