import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type ServerOptions, type WebSocket } from 'ws';
import { CoopetPluginLink, toParts, type CoopetPluginOptions } from '../src/link/coopet-plugin.ts';
import type { IncomingMessage, LinkState } from '../src/link/types.ts';
import { consoleLogger } from '../src/runtime/log.ts';

const TOKEN = 'plugin-token';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

const WELCOME = { type: 'welcome', protocol: 0, bot: { name: '麦麦', account_id: 'coopet-maibot' }, user: { id: 'owner', nickname: '主人' } };

/** 一个按协议 v0 说话的假插件；behaviour 决定它怎么回应 hello 和 chat。 */
async function fakePlugin(behaviour: {
  onHello?: (ws: WebSocket, hello: Record<string, unknown>) => void;
  onChat?: (ws: WebSocket, chat: { id: string; text: string }) => void;
} = {}, opts: ServerOptions = {}) {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', ...opts });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const hellos: Array<Record<string, unknown>> = [];
  const sockets: WebSocket[] = [];
  wss.on('connection', (ws) => {
    sockets.push(ws);
    ws.on('message', (data) => {
      const frame = JSON.parse(data.toString());
      if (frame.type === 'hello') {
        hellos.push(frame);
        (behaviour.onHello ?? ((s) => s.send(JSON.stringify(WELCOME))))(ws, frame);
      } else if (frame.type === 'chat') {
        (behaviour.onChat ?? ((s, c) => s.send(JSON.stringify({ type: 'ack', id: c.id, ok: true }))))(ws, frame);
      }
    });
  });
  cleanups.push(() => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
  const { port } = wss.address() as { port: number };
  return { url: `ws://127.0.0.1:${port}/ws`, hellos, sockets };
}

function tokenFile(content = TOKEN): string {
  const f = join(mkdtempSync(join(tmpdir(), 'coopet-plink-')), 'plugin-token');
  writeFileSync(f, `${content}\n`);
  return f;
}

function link(url: string, extra: Partial<CoopetPluginOptions> = {}) {
  const l = new CoopetPluginLink({
    url, tokenFile: tokenFile(), deviceId: 'dev-1', deviceName: 'MacBook', clientVersion: '0.0.0',
    log: consoleLogger('test', 'error'), backoff: { initialMs: 20, maxMs: 80 }, ackTimeoutMs: 300, ...extra,
  });
  const states: Array<[LinkState, string | undefined]> = [];
  const messages: IncomingMessage[] = [];
  const thinking: boolean[] = [];
  l.onState((s, r) => states.push([s, r]));
  l.onMessage((m) => messages.push(m));
  l.onThinking((on) => thinking.push(on));
  cleanups.push(() => l.stop());
  return { link: l, states, messages, thinking };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('toParts', () => {
  it('maps protocol parts and keeps unknown kinds as other', () => {
    expect(toParts([
      { kind: 'text', text: 'hi' },
      { kind: 'emoji', base64: 'AA', mime: 'image/png' },
      { kind: 'other', type: 'voice' },
      { kind: 'sticker' },
      'junk',
    ])).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'emoji', base64: 'AA' },
      { kind: 'other', type: 'voice' },
      { kind: 'other', type: 'sticker' },
    ]);
    expect(toParts(undefined)).toEqual([]);
  });
});

describe('CoopetPluginLink', () => {
  it('sends hello and is open only after welcome, with the bot name', async () => {
    const plugin = await fakePlugin();
    const { link: l, states } = link(plugin.url);
    l.start();
    await until(() => l.state() === 'open');
    expect(plugin.hellos[0]).toEqual({ type: 'hello', protocol: 0, token: TOKEN, device_id: 'dev-1', device_name: 'MacBook', client: { name: 'coopet', version: '0.0.0' } });
    expect(states.map(([s]) => s)).toEqual(['connecting', 'open']);
    expect(l.botName()).toBe('麦麦');
  });

  it('resolves send on ok ack and rejects on a failed ack', async () => {
    let ok = true;
    const plugin = await fakePlugin({ onChat: (ws, c) => ws.send(JSON.stringify(ok ? { type: 'ack', id: c.id, ok: true } : { type: 'ack', id: c.id, ok: false, error: { code: 'rejected', message: 'no' } })) });
    const { link: l } = link(plugin.url);
    l.start();
    await until(() => l.state() === 'open');
    const { id } = await l.send({ text: '你好' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    ok = false;
    await expect(l.send({ text: 'x' })).rejects.toThrow(/rejected/);
  });

  it('rejects send when no ack arrives in time', async () => {
    const plugin = await fakePlugin({ onChat: () => {} });
    const { link: l } = link(plugin.url);
    l.start();
    await until(() => l.state() === 'open');
    await expect(l.send({ text: 'x' })).rejects.toThrow(/没收到确认/);
  });

  it('rejects send while not connected', async () => {
    const { link: l } = link('ws://127.0.0.1:1/ws');
    await expect(l.send({ text: 'x' })).rejects.toThrow(/还没连上/);
  });

  it('delivers replies and thinking, ignores unknown frames', async () => {
    const plugin = await fakePlugin();
    const { link: l, messages, thinking } = link(plugin.url);
    l.start();
    await until(() => l.state() === 'open');
    const ws = plugin.sockets[0];
    ws.send(JSON.stringify({ type: 'thinking', on: true }));
    ws.send(JSON.stringify({ type: 'agent.task', goal: 'x' }));
    ws.send('not json');
    ws.send(JSON.stringify({ type: 'reply', id: 'm1', parts: [{ kind: 'text', text: '在呢' }] }));
    ws.send(JSON.stringify({ type: 'thinking', on: false }));
    await until(() => thinking.length === 2 && messages.length === 1);
    expect(thinking).toEqual([true, false]);
    expect(messages[0]).toMatchObject({ id: 'm1', parts: [{ kind: 'text', text: '在呢' }] });
  });

  it.each([[4001, 'auth'], [4002, 'protocol'], [4003, 'replaced']])('does not reconnect after close %i', async (code, reason) => {
    const plugin = await fakePlugin({ onHello: (ws) => ws.close(code) });
    const { link: l, states } = link(plugin.url);
    l.start();
    await until(() => states.some(([s, r]) => s === 'closed' && r === reason));
    await new Promise((r) => setTimeout(r, 100));
    expect(plugin.hellos).toHaveLength(1);
  });

  it('reconnects after an ordinary drop and fails pending sends', async () => {
    const plugin = await fakePlugin({ onChat: () => {} });
    const { link: l } = link(plugin.url, { ackTimeoutMs: 5000 });
    l.start();
    await until(() => l.state() === 'open');
    const pending = l.send({ text: 'x' });
    await until(() => plugin.sockets.length === 1);
    plugin.sockets[0].close(1011);
    await expect(pending).rejects.toThrow(/断开/);
    await until(() => plugin.hellos.length === 2 && l.state() === 'open');
  });

  it('drops a silent connection and reconnects', async () => {
    const plugin = await fakePlugin({}, { autoPong: false });
    const { link: l } = link(plugin.url, { heartbeat: { intervalMs: 30, timeoutMs: 30 } });
    l.start();
    await until(() => plugin.hellos.length >= 2, 3000);
  });

  it('does not start without a token', () => {
    const { link: l, states } = link('ws://127.0.0.1:1/ws', { tokenFile: tokenFile('') });
    l.start();
    expect(states).toEqual([['closed', 'token']]);
  });

  it('logs handshake time and the close code', async () => {
    const plugin = await fakePlugin();
    const lines: string[] = [];
    const log = { trace() {}, error() {}, warn() {}, emit() {}, debug: (m: string) => lines.push(`D ${m}`), info: (m: string) => lines.push(`I ${m}`), child() { return log; } };
    const { link: l } = link(plugin.url, { log });
    l.start();
    await until(() => l.state() === 'open');
    plugin.sockets[0].close(1011);
    await until(() => lines.some((x) => x.startsWith('I 连接断开')));
    expect(lines.find((x) => x.startsWith('I 已连上插件'))).toMatch(/^I 已连上插件（握手 \d+ms，Bot：麦麦）$/);
    expect(lines.some((x) => /^D ← welcome \d+ 字节$/.test(x))).toBe(true);
    expect(lines.find((x) => x.startsWith('I 连接断开'))).toMatch(/^I 连接断开：关闭码 1011，连了 \d+ 秒$/);
  });
});
