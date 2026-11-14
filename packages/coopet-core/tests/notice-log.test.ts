import { existsSync, mkdtempSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NoticeLog, REPLY_MAX, TEXT_MAX } from '../src/conductor/notice-log.ts';

const base = { cursor: 1, worldId: 'ntfy', source: 'ntfy 通知', type: 'ntfy.message', text: 'build：构建完成', route: 'maibot' as const, result: 'queued' as const, at: '' };

describe('NoticeLog', () => {
  it('adds and updates records, newest first', () => {
    const log = new NoticeLog(null);
    const a = log.add({ ...base, at: '2026-11-14T10:00:00Z' });
    const b = log.add({ ...base, cursor: 2, at: '2026-11-14T10:00:01Z', route: 'pet' });
    log.update(a.id, { result: 'replied', reply: '好'.repeat(100) });
    log.update('nope', { result: 'said' });
    const [first, second] = log.recent(10);
    expect(first.id).toBe(b.id);
    expect(second).toMatchObject({ id: a.id, result: 'replied' });
    expect([...second.reply!].length).toBe(REPLY_MAX + 1);
    expect(log.recent(1)).toHaveLength(1);
    expect(a.id).not.toBe(b.id);
  });

  it('clips long text', () => {
    const log = new NoticeLog(null);
    expect([...log.add({ ...base, text: 'x'.repeat(500) }).text].length).toBe(TEXT_MAX + 1);
  });

  it('writes daily files and reads them back after a restart', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'coopet-notices-')), 'notices');
    const now = () => new Date(2026, 10, 14, 10, 0, 0);
    const log = new NoticeLog(dir, { now });
    const a = log.add({ ...base });
    log.update(a.id, { result: 'handed' });
    log.update(a.id, { result: 'silent' });
    expect(readdirSync(dir)).toEqual(['notices-2026-11-14.jsonl']);
    const again = new NoticeLog(dir, { now });
    expect(again.recent(5)).toEqual([expect.objectContaining({ id: a.id, result: 'silent', text: base.text })]);
  });

  it('drops files older than keepDays and skips broken lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coopet-notices-'));
    writeFileSync(join(dir, 'notices-2026-01-01.jsonl'), '{}\n');
    const now = () => new Date(2026, 10, 14, 10, 0, 0);
    const log = new NoticeLog(dir, { now, keepDays: 30 });
    log.add({ ...base });
    appendFileSync(join(dir, 'notices-2026-11-14.jsonl'), '{"op":"add","rec');
    const again = new NoticeLog(dir, { now, keepDays: 30 });
    expect(existsSync(join(dir, 'notices-2026-01-01.jsonl'))).toBe(false);
    expect(again.recent(5)).toHaveLength(1);
  });

  it('keeps working in memory when the folder cannot be written', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'coopet-notices-')), 'not-a-dir');
    writeFileSync(file, 'x');
    const errors: Error[] = [];
    const log = new NoticeLog(file, { onWriteError: (e) => errors.push(e) });
    log.add({ ...base });
    log.add({ ...base, cursor: 2 });
    expect(log.recent(5)).toHaveLength(2);
    expect(errors).toHaveLength(1);
  });
});
