import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'cortico/core/types.ts';
import { MemoryEventStore } from '../src/runtime/event-store.ts';
import { createWorldHost, MAIBOT_MODEL_FACTS, type HostedEvent } from '../src/runtime/world-host.ts';

function fakeLog(): Logger & { warns: string[]; errors: string[] } {
  const warns: string[] = [];
  const errors: string[] = [];
  const log = {
    warns, errors,
    trace() {}, debug() {}, info() {},
    warn: (m: string) => { warns.push(m); },
    error: (m: string) => { errors.push(m); },
    emit() {},
    child: () => log,
  };
  return log;
}

const flushImmediate = () => new Promise<void>((r) => setImmediate(r));
const base = { type: 'desktop-pet.message', source: 'desktop-pet', ts: '2026-11-12T10:00:00+08:00', text: '[10:00] 主人：你好', meta: { text: '你好' } };

describe('createWorldHost', () => {
  it('stores and dispatches a delivered event after pushEvent returns', async () => {
    const store = new MemoryEventStore();
    const seen: HostedEvent[] = [];
    const host = createWorldHost({ store, log: fakeLog(), modelFacts: MAIBOT_MODEL_FACTS, onEvent: (e) => seen.push(e) });
    const saved = await host.pushEvent(base, { trigger: 'preempt' });
    expect(saved).toMatchObject({ cursor: 1, origin: 'external', contextDelivery: 'deliver', meta: { text: '你好' } });
    expect(seen).toEqual([]);
    await flushImmediate();
    expect(seen).toEqual([{ event: saved, trigger: 'preempt' }]);
    expect(store.get(1)).toEqual(saved);
  });

  it('only stores an event pushed with deliver: false', async () => {
    const store = new MemoryEventStore();
    const onEvent = vi.fn();
    const host = createWorldHost({ store, log: fakeLog(), modelFacts: MAIBOT_MODEL_FACTS, onEvent });
    const saved = await host.pushEvent({ ...base, type: 'desktop-pet.self' }, { deliver: false });
    await flushImmediate();
    expect(saved.contextDelivery).toBe('archive-only');
    expect(onEvent).not.toHaveBeenCalled();
    expect(store.latestCursor()).toBe(1);
  });

  it('drops attachments with a warning and keeps the given origin', async () => {
    const log = fakeLog();
    const host = createWorldHost({ store: new MemoryEventStore(), log, modelFacts: MAIBOT_MODEL_FACTS, onEvent: () => {} });
    const saved = await host.pushEvent({ ...base, origin: 'internal', blobs: [{ bytes: new Uint8Array([1]), mime: 'image/png', fallbackText: '图' }] });
    expect(saved.blobs).toBeUndefined();
    expect(saved.origin).toBe('internal');
    expect(log.warns).toHaveLength(1);
  });

  it('keeps a throwing handler from breaking the World', async () => {
    const log = fakeLog();
    const host = createWorldHost({ store: new MemoryEventStore(), log, modelFacts: MAIBOT_MODEL_FACTS, onEvent: () => { throw new Error('boom'); } });
    await host.pushEvent(base);
    await flushImmediate();
    expect(log.errors).toHaveLength(1);
  });

  it('answers queue questions honestly and has no blobs or attachments', async () => {
    const host = createWorldHost({ store: new MemoryEventStore(), log: fakeLog(), modelFacts: MAIBOT_MODEL_FACTS, onEvent: () => {} });
    expect(await host.withdrawPending!(1)).toBe(false);
    expect(await host.promotePending!(1, 'flush')).toBe(false);
    expect(await host.drainPendingEvents(() => true)).toEqual([]);
    expect(host.blob('log:x')).toBeNull();
    expect(host.modelFacts.accepts('image/jpeg')).toBe(false);
  });
});
