import { mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage as HttpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type ServerOptions, type WebSocket } from 'ws';
import { consoleLogger } from '../src/runtime/log.ts';
import { MaimLegacyLink, segmentsToParts, type MaimLegacyOptions } from '../src/link/maim-legacy.ts';
import type { IncomingMessage, LinkState } from '../src/link/types.ts';

const TOKEN = 'test-token';
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function tokenFile(content = TOKEN): string {
  const f = join(mkdtempSync(join(tmpdir(), 'coopet-link-')), 'token');
  writeFileSync(f, `${content}\n`);
  return f;
}

async function server(opts: ServerOptions = {}): Promise<{ wss: WebSocketServer; url: string; conns: Array<{ ws: WebSocket; req: HttpRequest }> }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1', ...opts });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  const conns: Array<{ ws: WebSocket; req: HttpRequest }> = [];
  wss.on('connection', (ws, req) => conns.push({ ws, req }));
  cleanups.push(() => new Promise<void>((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }));
  const { port } = wss.address() as { port: number };
  return { wss, url: `ws://127.0.0.1:${port}/ws`, conns };
}

function link(url: string, extra: Partial<MaimLegacyOptions> = {}): { link: MaimLegacyLink; states: Array<[LinkState, string | undefined]>; messages: IncomingMessage[] } {
  const l = new MaimLegacyLink({
    url, tokenFile: tokenFile(), platform: 'coopet', botAccount: 'coopet-maibot', user: { id: 'owner', nickname: '主人' },
    log: consoleLogger('test', 'error'), backoff: { initialMs: 20, maxMs: 80 }, ...extra,
  });
  const states: Array<[LinkState, string | undefined]> = [];
  const messages: IncomingMessage[] = [];
  l.onState((s, r) => states.push([s, r]));
  l.onMessage((m) => messages.push(m));
  cleanups.push(() => l.stop());
  return { link: l, states, messages };
}

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('segmentsToParts', () => {
  it('flattens nested seglists into parts', () => {
    expect(segmentsToParts({ type: 'seglist', data: [
      { type: 'text', data: '你好' },
      { type: 'seglist', data: [{ type: 'emoji', data: 'AAA' }, { type: 'reply', data: '42' }] },
      { type: 'image', data: 'BBB' },
    ] })).toEqual([
      { kind: 'text', text: '你好' },
      { kind: 'emoji', base64: 'AAA' },
      { kind: 'other', type: 'reply' },
      { kind: 'image', base64: 'BBB' },
    ]);
  });
});

describe('MaimLegacyLink', () => {
  it('connects with platform and token headers and sends a routed text message', async () => {
    const srv = await server();
    const { link: l } = link(srv.url);
    l.start();
    await until(() => l.state() === 'open');
    expect(srv.conns[0].req.headers.platform).toBe('coopet');
    expect(srv.conns[0].req.headers.authorization).toBe(TOKEN);
    const got = new Promise<string>((r) => srv.conns[0].ws.once('message', (d) => r(d.toString())));
    const { id } = await l.send({ text: '你好' });
    const sent = JSON.parse(await got);
    expect(sent.account_id).toBe('coopet-maibot');
    expect(sent.message_info.message_id).toBe(id);
    expect(sent.message_info.user_info).toEqual({ platform: 'coopet', user_id: 'owner', user_nickname: '主人' });
    expect(sent.message_segment.data).toEqual([{ type: 'text', data: '你好' }]);
  });

  it('turns incoming MessageBase frames into messages and drops other frames', async () => {
    const srv = await server();
    const { link: l, messages } = link(srv.url);
    l.start();
    await until(() => l.state() === 'open');
    srv.conns[0].ws.send('not json');
    srv.conns[0].ws.send(JSON.stringify({ type: 'custom' }));
    srv.conns[0].ws.send(JSON.stringify({ message_info: { message_id: 'm1' }, message_segment: { type: 'seglist', data: [{ type: 'text', data: '在呢' }] } }));
    await until(() => messages.length === 1);
    expect(messages[0]).toMatchObject({ id: 'm1', parts: [{ kind: 'text', text: '在呢' }] });
  });

  it('rejects send while not connected', async () => {
    const { link: l } = link('ws://127.0.0.1:1/ws');
    await expect(l.send({ text: 'x' })).rejects.toThrow(/还没连上/);
  });

  it('reconnects after the server drops the connection', async () => {
    const srv = await server();
    const { link: l, states } = link(srv.url);
    l.start();
    await until(() => srv.conns.length === 1 && l.state() === 'open');
    srv.conns[0].ws.close(1011);
    await until(() => srv.conns.length === 2 && l.state() === 'open');
    expect(states.some(([s, r]) => s === 'closed' && r === '1011')).toBe(true);
  });

  it('stops retrying when the token is refused with 1008', async () => {
    const srv = await server();
    srv.wss.on('connection', (ws) => ws.close(1008, 'invalid token'));
    const { link: l, states } = link(srv.url);
    l.start();
    await until(() => states.some(([s, r]) => s === 'closed' && r === 'auth'));
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.conns).toHaveLength(1);
  });

  it('stops retrying when the handshake is refused with 403', async () => {
    const srv = await server({ verifyClient: (_info, cb) => cb(false, 403) });
    const { link: l, states } = link(srv.url);
    l.start();
    await until(() => states.some(([s, r]) => s === 'closed' && r === 'auth'));
    expect(l.state()).toBe('closed');
  });

  it('drops a connection whose pongs stop and reconnects', async () => {
    const srv = await server({ autoPong: false });
    const { link: l } = link(srv.url, { heartbeat: { intervalMs: 30, timeoutMs: 30 } });
    l.start();
    await until(() => srv.conns.length >= 2, 3000);
  });

  it('does not start without a token', () => {
    const { link: l, states } = link('ws://127.0.0.1:1/ws', { tokenFile: tokenFile('   ') });
    l.start();
    expect(states).toEqual([['closed', 'token']]);
  });

  it('stop closes the connection and does not reconnect', async () => {
    const srv = await server();
    const { link: l, states } = link(srv.url);
    l.start();
    await until(() => l.state() === 'open');
    await l.stop();
    expect(states.at(-1)).toEqual(['closed', 'stopped']);
    await new Promise((r) => setTimeout(r, 100));
    expect(srv.conns).toHaveLength(1);
  });
});
