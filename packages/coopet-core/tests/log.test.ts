import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { consoleLogger, DailyFileSink, fileName, switchableSink, type LogEntry, type LogSink } from '../src/runtime/log.ts';

afterEach(() => { vi.restoreAllMocks(); });

function captured(): { lines: string[]; entries: LogEntry[]; sink: LogSink } {
  const lines: string[] = [];
  const entries: LogEntry[] = [];
  return { lines, entries, sink: { write: (e) => { lines.push(e.line); entries.push(e); } } };
}

describe('consoleLogger', () => {
  it('writes millisecond timestamps, filters by level and tees to the sink', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { lines, sink } = captured();
    const log = consoleLogger('coopet', 'info', sink);
    log.debug('hidden');
    log.info('hello', { n: 1 });
    log.child('link').warn('careful');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3} INFO  \[coopet\] hello \{"n":1\}\n$/);
    expect(lines[1]).toMatch(/WARN  \[coopet\/link\] careful/);
    expect(err).toHaveBeenCalledTimes(2);
  });

  it('reads a level function on each write and passes entries with event and duration', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { entries, sink } = captured();
    let level: 'info' | 'debug' = 'info';
    const log = consoleLogger('coopet', () => level, sink).child('link');
    log.debug('a');
    level = 'debug';
    log.debug('b');
    log.emit('warn', 'slow', { event: 'turn', durMs: 1200, data: { n: 2 } });
    expect(entries.map((e) => e.msg)).toEqual(['b', 'slow']);
    expect(entries[1]).toMatchObject({ level: 'warn', area: 'coopet/link', event: 'turn', durMs: 1200, data: { n: 2 } });
  });

  it('writes to a switchable sink only while enabled', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { lines, sink } = captured();
    let on = false;
    const log = consoleLogger('coopet', 'info', switchableSink(sink, () => on));
    log.info('off');
    on = true;
    log.info('on');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('on');
  });
});

describe('DailyFileSink', () => {
  it('appends to the file of the local day', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'coopet-log-')), 'logs');
    const sink = new DailyFileSink(dir);
    const day1 = new Date(2026, 10, 12, 23, 59);
    const day2 = new Date(2026, 10, 13, 0, 1);
    sink.write({ line: 'a\n', at: day1 });
    sink.write({ line: 'b\n', at: day1 });
    sink.write({ line: 'c\n', at: day2 });
    expect(readFileSync(join(dir, 'coopet-2026-11-12.log'), 'utf8')).toBe('a\nb\n');
    expect(readFileSync(join(dir, fileName(day2)), 'utf8')).toBe('c\n');
  });

  it('removes files older than keepDays and leaves others alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coopet-log-'));
    for (const name of ['coopet-2026-11-05.log', 'coopet-2026-11-06.log', 'coopet-2026-11-12.log', 'notes.txt']) writeFileSync(join(dir, name), 'x');
    new DailyFileSink(dir, 7, new Date(2026, 10, 12, 12, 0));
    expect(existsSync(join(dir, 'coopet-2026-11-05.log'))).toBe(false);
    expect(existsSync(join(dir, 'coopet-2026-11-06.log'))).toBe(true);
    expect(existsSync(join(dir, 'coopet-2026-11-12.log'))).toBe(true);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);
  });

  it('stops writing after a failure instead of throwing', () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const base = mkdtempSync(join(tmpdir(), 'coopet-log-'));
    const blocker = join(base, 'file');
    writeFileSync(blocker, 'x');
    const sink = new DailyFileSink(join(blocker, 'logs')); // 父路径是文件，建不了目录
    expect(() => sink.write({ line: 'a\n', at: new Date() })).not.toThrow();
    expect(err).toHaveBeenCalledTimes(1);
  });
});
