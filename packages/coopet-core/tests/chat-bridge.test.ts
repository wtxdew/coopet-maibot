import { describe, expect, it } from 'vitest';
import type { WorldStreamSocket } from 'cortico/core/types.ts';
import { ChatBridge } from '../src/runtime/chat-bridge.ts';
import type { ToShell } from '../src/runtime/supervisor.ts';

function setup() {
  const sockets: WorldStreamSocket[] = [];
  const sent: ToShell[] = [];
  const bridge = new ChatBridge((s) => sockets.push(s), (m) => sent.push(m));
  return { bridge, sockets, sent };
}

describe('ChatBridge', () => {
  it('relays data both ways for each stream', () => {
    const t = setup();
    t.bridge.open(1);
    const got: string[] = [];
    t.sockets[0].onMessage((x) => got.push(x));
    t.bridge.message(1, '{"t":"hello"}');
    t.bridge.message(2, 'nobody');
    t.sockets[0].send('{"t":"history"}');
    expect(got).toEqual(['{"t":"hello"}']);
    expect(t.sent).toEqual([{ type: 'chat-data', streamId: 1, data: '{"t":"history"}' }]);
    expect(t.sockets[0].open).toBe(true);
  });

  it('closes from the shell side without echoing back', () => {
    const t = setup();
    t.bridge.open(1);
    let closed = false;
    t.sockets[0].onClose(() => { closed = true; });
    t.bridge.close(1);
    t.sockets[0].send('late');
    expect(closed).toBe(true);
    expect(t.sockets[0].open).toBe(false);
    expect(t.sent).toEqual([]);
  });

  it('tells the shell when the pet closes the stream', () => {
    const t = setup();
    t.bridge.open(4);
    t.sockets[0].close('no stream');
    expect(t.sent).toEqual([{ type: 'chat-closed', streamId: 4 }]);
  });

  it('closes everything on closeAll', () => {
    const t = setup();
    t.bridge.open(1);
    t.bridge.open(2);
    t.bridge.closeAll();
    expect(t.sockets.every((s) => !s.open)).toBe(true);
  });
});
