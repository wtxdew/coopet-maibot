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
    sup.send({ type: 'ready', petOrigin: 'http://127.0.0.1:7797' });
    proc.emit('message', { type: 'show-pet' });
    proc.emit('message', { type: 'toggle-pet' });
    proc.emit('message', { type: 'format-disk' });
    proc.emit('message', null);
    proc.emit('message', { type: 'shutdown' });
    expect(proc.sent).toEqual([{ type: 'ready', petOrigin: 'http://127.0.0.1:7797' }]);
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
});
