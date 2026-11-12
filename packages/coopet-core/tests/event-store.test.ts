import { describe, expect, it } from 'vitest';
import { MemoryEventStore } from '../src/runtime/event-store.ts';

function filled(): MemoryEventStore {
  const store = new MemoryEventStore();
  const base = { source: 'desktop-pet', origin: 'external' as const };
  store.append({ ...base, type: 'desktop-pet.message', senderKey: 'desktop-pet.text', ts: '2026-11-12T10:00:00+08:00', text: '你好' });
  store.append({ ...base, type: 'desktop-pet.self', senderKey: 'desktop-pet.self', ts: '2026-11-12T10:00:05+08:00', text: 'Hello back' });
  store.append({ ...base, type: 'desktop-pet.touch', senderKey: 'desktop-pet.touch', ts: '2026-11-12T02:01:00Z', text: '戳了一下' });
  store.append({ source: 'other', origin: 'internal', type: 'x', ts: '2026-11-12T10:02:00+08:00', text: 'hello again' });
  return store;
}

describe('MemoryEventStore', () => {
  it('assigns cursors from 1 and reads them back', () => {
    const store = new MemoryEventStore();
    expect(store.latestCursor()).toBe(0);
    const e = store.append({ type: 't', ts: '2026-11-12T10:00:00+08:00', source: 's', origin: 'external', text: 'a' });
    expect(e.cursor).toBe(1);
    expect(store.latestCursor()).toBe(1);
    expect(store.get(1)).toEqual(e);
    expect(store.get(0)).toBeUndefined();
    expect(store.get(2)).toBeUndefined();
    expect(store.get(1.5)).toBeUndefined();
  });

  it('filters a range with inclusive bounds and takes the last `limit`', () => {
    const store = filled();
    expect(store.range({ fromCursor: 2, toCursor: 3 }).map((e) => e.cursor)).toEqual([2, 3]);
    expect(store.range({ source: 'desktop-pet' }).map((e) => e.cursor)).toEqual([1, 2, 3]);
    expect(store.range({ source: 'desktop-pet', limit: 2 }).map((e) => e.cursor)).toEqual([2, 3]);
    expect(store.range({ senderKey: 'desktop-pet.touch' }).map((e) => e.cursor)).toEqual([3]);
    expect(store.range({ origin: 'internal' }).map((e) => e.cursor)).toEqual([4]);
    expect(store.range({ toCursor: 0 })).toEqual([]);
  });

  it('compares timestamps as instants across offsets', () => {
    const store = filled();
    // 02:01Z 就是 10:01+08:00
    const hits = store.range({ fromTs: '2026-11-12T10:00:30+08:00', toTs: '2026-11-12T10:01:00+08:00' });
    expect(hits.map((e) => e.cursor)).toEqual([3]);
  });

  it('returns neighbours around a cursor', () => {
    const store = filled();
    expect(store.around(2, 1, 1).map((e) => e.cursor)).toEqual([1, 2, 3]);
    expect(store.around(1, 5, 0).map((e) => e.cursor)).toEqual([1]);
    expect(store.around(9, 1, 1)).toEqual([]);
  });

  it('greps case-insensitively with context', () => {
    const store = filled();
    const hits = store.grep({ keyword: 'HELLO', context: 1 });
    expect(hits.map((h) => h.hitCursor)).toEqual([2, 4]);
    expect(hits[0].events.map((e) => e.cursor)).toEqual([1, 2, 3]);
    expect(store.grep({ keyword: 'hello', context: 0, limit: 1 }).map((h) => h.hitCursor)).toEqual([4]);
    expect(store.grep({ keyword: 'hello', context: 0, source: 'desktop-pet' }).map((h) => h.hitCursor)).toEqual([2]);
    expect(store.grep({ keyword: '', context: 0 })).toEqual([]);
  });
});
