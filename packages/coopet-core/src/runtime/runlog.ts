/**
 * 每次运行一份结构化日志，格式和位置与 Cortico 一致，设置窗的「运行诊断 → 运行日志」直接读：
 *
 * - `<data>/runs/<运行 id>/log.jsonl`：每行一条 LogRecord（时间、级别、区域、内容、附加数据…），
 *   由 Cortico 的 Runlog 写（重复的 warn/error 合并计数，文件太大时轮换）。
 * - `<data>/runs/index.jsonl`：启动时一行（openRun），正常退出时一行（closeRun）。
 *
 * 区域名把 `/` 换成 `.`（`coopet/link` → `coopet.link`），诊断页按区域前缀筛选靠这个。
 * 级别过滤已在 consoleLogger 做过，这里全部写入。
 * 启动时删掉 keepDays 天以前的运行目录，索引里对应的行也去掉。
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeRun, listRuns, openRun, runsDirOf, type RunInfo } from 'cortico/core/run.ts';
import { nowIso, Runlog } from 'cortico/core/util.ts';
import type { LogRecord } from 'cortico/core/types.ts';
import type { LogSink } from './log.ts';

export interface RunlogHandle {
  readonly runId: string;
  /** 交给 consoleLogger 的去处 */
  readonly sink: LogSink;
  /** 每写一条通知（设置窗的运行日志实时显示） */
  onWrite(cb: (record: LogRecord) => void): void;
  /** 正常退出时记一行关机 */
  close(reason: string, lastCursor: number): void;
}

export interface RunlogOptions {
  timezone?: string;
  keepDays?: number;
  now?: Date;
}

export function openRunlog(dataDir: string, opts: RunlogOptions = {}): RunlogHandle {
  const timezone = opts.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  pruneRuns(dataDir, opts.keepDays ?? 7, opts.now ?? new Date());
  const run: RunInfo = openRun(dataDir, { timezone, bot: 'coopet' });
  const runlog = new Runlog(join(run.dir, 'log.jsonl'), {
    run: run.id,
    timezone,
    stdout: false,
    levels: () => ({ file: 'trace', stdout: 'error', areas: '' }),
  });
  let closed = false;
  return {
    runId: run.id,
    sink: {
      write: (e) => {
        runlog.write({
          level: e.level,
          area: e.area.replaceAll('/', '.'),
          msg: e.msg,
          ...(e.data !== undefined ? { data: e.data } : {}),
          ...(e.event ? { event: e.event } : {}),
          ...(e.durMs !== undefined ? { durMs: e.durMs } : {}),
        });
      },
    },
    onWrite: (cb) => runlog.onWrite(cb),
    close(reason, lastCursor) {
      if (closed) return;
      closed = true;
      closeRun(run, { endedAt: nowIso(timezone), lastCursor, complete: true, reason });
    },
  };
}

/** 删掉 keepDays 天以前（按运行 id 里的日期）的运行目录，并从索引里去掉它们。 */
export function pruneRuns(dataDir: string, keepDays: number, now: Date): string[] {
  const cutoff = new Date(now.getTime() - (keepDays - 1) * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const oldest = `${cutoff.getFullYear()}${pad(cutoff.getMonth() + 1)}${pad(cutoff.getDate())}`;
  const runsDir = runsDirOf(dataDir);
  const removed = listRuns(dataDir).filter((id) => id.slice(2, 10) < oldest);
  for (const id of removed) rmSync(join(runsDir, id), { recursive: true, force: true });
  const index = join(runsDir, 'index.jsonl');
  if (removed.length && existsSync(index)) {
    const gone = new Set(removed);
    const kept = readFileSync(index, 'utf8').split('\n').filter((line) => {
      if (!line.trim()) return false;
      try { return !gone.has((JSON.parse(line) as { run?: string }).run ?? ''); } catch { return false; }
    });
    writeFileSync(index, kept.length ? `${kept.join('\n')}\n` : '');
  }
  return removed;
}
