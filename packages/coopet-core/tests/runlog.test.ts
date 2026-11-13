import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readRunsIndex } from 'cortico/web/files.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { openRunlog, pruneRuns } from '../src/runtime/runlog.ts';

const lines = (file: string) => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

describe('openRunlog', () => {
  it('opens a run, writes structured records with dotted areas and closes it', () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const data = mkdtempSync(join(tmpdir(), 'coopet-runlog-'));
    const run = openRunlog(data, { timezone: 'Asia/Shanghai' });
    expect(run.runId).toMatch(/^r-\d{8}-\d{6}-[0-9a-f]{4}$/);
    const seen: string[] = [];
    run.onWrite((r) => seen.push(r.msg));
    const log = consoleLogger('coopet', 'info', run.sink);
    log.child('link').info('连上了', { ms: 12 });
    log.debug('不写');
    log.emit('info', '一轮结束', { event: 'turn', durMs: 3400 });
    const records = lines(join(data, 'runs', run.runId, 'log.jsonl'));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ run: run.runId, level: 'info', area: 'coopet.link', msg: '连上了', data: { ms: 12 } });
    expect(records[1]).toMatchObject({ area: 'coopet', event: 'turn', durMs: 3400 });
    expect(seen).toEqual(['连上了', '一轮结束']);
    run.close('SIGTERM', 42);
    run.close('again', 43);
    const index = readRunsIndex(join(data, 'runs', 'index.jsonl'));
    expect(index).toEqual([expect.objectContaining({ run: run.runId, bot: 'coopet', lastCursor: 42, reason: 'SIGTERM', complete: true })]);
  });
});

describe('pruneRuns', () => {
  it('removes runs older than keepDays and their index lines', () => {
    const data = mkdtempSync(join(tmpdir(), 'coopet-runlog-'));
    const runs = join(data, 'runs');
    const ids = ['r-20261101-090000-aaaa', 'r-20261107-090000-bbbb', 'r-20261113-090000-cccc'];
    for (const id of ids) mkdirSync(join(runs, id), { recursive: true });
    writeFileSync(join(runs, 'index.jsonl'), `${ids.map((run) => JSON.stringify({ run })).join('\n')}\n`);
    const removed = pruneRuns(data, 7, new Date(2026, 10, 13, 12, 0));
    expect(removed).toEqual(['r-20261101-090000-aaaa']);
    expect(existsSync(join(runs, ids[0]))).toBe(false);
    expect(existsSync(join(runs, ids[1]))).toBe(true);
    expect(readRunsIndex(join(runs, 'index.jsonl')).map((r) => r.run)).toEqual(ids.slice(1));
  });
});
