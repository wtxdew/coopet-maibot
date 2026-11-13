import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { connectSupervisor, type FromShell } from '../src/runtime/supervisor.ts';

class FakeProc extends EventEmitter {
  connected = true;
  sent: unknown[] = [];
  send = (m: unknown) => { this.sent.push(m); return true; };
}

describe('connectSupervisor', () => {
  it('is null without IPC', () => {
    expect(connectSupervisor(new EventEmitter() as never)).toBeNull();
  });

  it('sends while connected and passes only known messages', () => {
    const proc = new FakeProc();
    const sup = connectSupervisor(proc)!;
    const got: FromShell[] = [];
    sup.onMessage((m) => got.push(m));
    sup.send({ type: 'ready', petOrigin: 'http://127.0.0.1:7797', webPort: 50123, language: 'zh' });
    proc.emit('message', { type: 'show-pet' });
    proc.emit('message', { type: 'toggle-pet' });
    proc.emit('message', { type: 'format-disk' });
    proc.emit('message', null);
    proc.emit('message', { type: 'shutdown' });
    expect(proc.sent).toEqual([{ type: 'ready', petOrigin: 'http://127.0.0.1:7797', webPort: 50123, language: 'zh' }]);
    expect(got).toEqual([{ type: 'show-pet' }, { type: 'toggle-pet' }, { type: 'shutdown' }]);
    proc.connected = false;
    sup.send({ type: 'quit' });
    expect(proc.sent).toHaveLength(1);
  });

  it('reports a disconnect', () => {
    const proc = new FakeProc();
    let gone = false;
    connectSupervisor(proc)!.onDisconnect(() => { gone = true; });
    proc.emit('disconnect');
    expect(gone).toBe(true);
  });

  it('answers requests with the handler result or its error', async () => {
    const proc = new FakeProc();
    const sup = connectSupervisor(proc)!;
    sup.onRequest(async (method, params) => {
      if (method === 'boom') throw new Error('坏了');
      return { method, params };
    });
    proc.emit('message', { type: 'request', id: 1, method: 'settings.get', params: { a: 1 } });
    proc.emit('message', { type: 'request', id: 2, method: 'boom', params: null });
    proc.emit('message', { type: 'request', id: 'x', method: 'bad' });
    await new Promise((r) => setTimeout(r, 0));
    expect(proc.sent).toEqual([
      { type: 'response', id: 1, ok: true, result: { method: 'settings.get', params: { a: 1 } } },
      { type: 'response', id: 2, ok: false, error: '坏了' },
    ]);
  });

  it('passes chat stream messages through', () => {
    const proc = new FakeProc();
    const got: FromShell[] = [];
    connectSupervisor(proc)!.onMessage((m) => got.push(m));
    proc.emit('message', { type: 'chat-open', streamId: 3 });
    proc.emit('message', { type: 'chat-message', streamId: 3, text: '{"t":"more"}' });
    proc.emit('message', { type: 'chat-close', streamId: 3 });
    expect(got.map((m) => m.type)).toEqual(['chat-open', 'chat-message', 'chat-close']);
  });
});
