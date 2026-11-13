import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryEventStore, openEventLog } from '../src/runtime/event-store.ts';

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


const ev = (type: string, text: string) => ({ type, source: 'desktop-pet', origin: 'external' as const, ts: '2026-11-12T10:00:00+08:00', text });

describe('openEventLog', () => {
  it('writes each event to the file of its day and reads them back with cursors continuing', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'coopet-events-')), 'events');
    let now = new Date(2026, 10, 12, 23, 59);
    const first = openEventLog(dir, { now: () => now });
    first.append(ev('a', '一'));
    now = new Date(2026, 10, 13, 0, 1);
    first.append(ev('b', '二'));
    expect(readFileSync(join(dir, 'events-2026-11-12.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);
    expect(readFileSync(join(dir, 'events-2026-11-13.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1);

    const again = openEventLog(dir, { now: () => now });
    expect(again.latestCursor()).toBe(2);
    expect(again.get(1)?.text).toBe('一');
    expect(again.append(ev('c', '三')).cursor).toBe(3);
    expect(again.range({ limit: 2 }).map((e) => e.text)).toEqual(['二', '三']);
  });

  it('drops files older than keepDays, skips bad lines and keeps the last contiguous run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coopet-events-'));
    const line = (cursor: number) => JSON.stringify({ ...ev('t', `#${cursor}`), cursor });
    writeFileSync(join(dir, 'events-2026-10-01.jsonl'), `${line(1)}\n`);
    writeFileSync(join(dir, 'events-2026-11-10.jsonl'), `${line(5)}\n{broken\n${line(7)}\n`);
    writeFileSync(join(dir, 'events-2026-11-12.jsonl'), `${line(8)}\n${line(9)}\n`);
    const store = openEventLog(dir, { keepDays: 30, now: () => new Date(2026, 10, 12, 12, 0) });
    expect(existsSync(join(dir, 'events-2026-10-01.jsonl'))).toBe(false);
    expect(store.range({}).map((e) => e.cursor)).toEqual([7, 8, 9]);
    expect(store.get(8)?.text).toBe('#8');
    expect(store.get(5)).toBeUndefined();
    expect(store.append(ev('t', 'new')).cursor).toBe(10);
  });

  it('keeps working in memory when the file cannot be written', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'coopet-events-')), 'events');
    const errors: Error[] = [];
    const store = openEventLog(dir, { onWriteError: (e) => errors.push(e) });
    rmSync(dir, { recursive: true });
    writeFileSync(dir, 'not a directory'); // 目录变成了文件：之后写不进去
    store.append(ev('a', 'x'));
    store.append(ev('b', 'y'));
    expect(store.latestCursor()).toBe(2);
    expect(store.get(2)?.text).toBe('y');
    expect(errors).toHaveLength(1);
  });
});

describe('MemoryEventStore.subscribe', () => {
  it('tells subscribers about each new event, and a failing one does not stop the store', () => {
    const store = new MemoryEventStore();
    const got: number[] = [];
    store.subscribe(() => { throw new Error('boom'); });
    store.subscribe((e) => got.push(e.cursor));
    const e = store.append({ type: 't', source: 's', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text: 'x' });
    expect(e.cursor).toBe(1);
    expect(got).toEqual([1]);
  });
});
