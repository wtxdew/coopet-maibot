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

  it('passes the updater steps on (the update bubbles depend on it)', () => {
    const proc = new FakeProc();
    const got: FromShell[] = [];
    connectSupervisor(proc)!.onMessage((m) => got.push(m));
    proc.emit('message', { type: 'update', step: { phase: 'ready', version: '0.1.4' } });
    proc.emit('message', { type: 'update', step: null });
    expect(got).toEqual([{ type: 'update', step: { phase: 'ready', version: '0.1.4' } }, { type: 'update', step: null }]);
  });

  it('passes the tray click-through switch on', () => {
    const proc = new FakeProc();
    const got: FromShell[] = [];
    connectSupervisor(proc)!.onMessage((m) => got.push(m));
    proc.emit('message', { type: 'click-through', on: true });
    expect(got).toEqual([{ type: 'click-through', on: true }]);
  });

  it('reports a disconnect', () => {
    const proc = new FakeProc();
    let gone = false;
    connectSupervisor(proc)!.onDisconnect(() => { gone = true; });
    proc.emit('disconnect');
    expect(gone).toBe(true);
  });

  it('drops request and chat stream messages the old settings page used', () => {
    const proc = new FakeProc();
    const got: FromShell[] = [];
    connectSupervisor(proc)!.onMessage((m) => got.push(m));
    proc.emit('message', { type: 'request', id: 1, method: 'settings.get' });
    proc.emit('message', { type: 'chat-open', streamId: 3 });
    expect(got).toEqual([]);
  });
});
