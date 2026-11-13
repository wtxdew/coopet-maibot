/**
 * Cortico `Logger` 的实现：按级别过滤，写到 stderr，再交给若干"去处"（按天的文本文件、每次运行的结构化日志）。
 * 文本格式：`HH:MM:SS.mmm 级别 [区域] 内容 {附加数据}`，时间精确到毫秒，方便算延迟。
 * 级别可以是函数：每写一条读一次，设置窗改了日志级别马上生效。
 */

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEmitOptions, Logger, LogLevel } from 'cortico/core/types.ts';

const RANK: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const LABEL: Record<LogLevel, string> = { trace: 'TRACE', debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/** 一条日志（已过级别过滤） */
export interface LogEntry {
  at: Date;
  level: LogLevel;
  /** 区域，`coopet/link` 这样用斜杠分层 */
  area: string;
  msg: string;
  /** 附加数据；error 级别常是 Error */
  data?: unknown;
  /** 区域内的事件类型（emit 时给的） */
  event?: string;
  durMs?: number;
  /** 文本格式的整行（含换行），文本去处直接写它 */
  line: string;
}

/** 日志的去处（例如文件）。 */
export interface LogSink {
  write(entry: LogEntry): void;
}

export function consoleLogger(area: string, minLevel: LogLevel | (() => LogLevel) = 'info', sinks: LogSink | readonly LogSink[] = []): Logger {
  const level = typeof minLevel === 'function' ? minLevel : () => minLevel;
  const outs = Array.isArray(sinks) ? sinks : [sinks as LogSink];
  const write = (lv: LogLevel, msg: string, data?: unknown, opts?: Pick<LogEmitOptions, 'event' | 'durMs'>): void => {
    if (RANK[lv] < RANK[level()]) return;
    const at = new Date();
    const extra = data === undefined ? '' : ` ${format(data)}`;
    const line = `${clock(at)} ${LABEL[lv]} [${area}] ${msg}${extra}\n`;
    process.stderr.write(line);
    const entry: LogEntry = { at, level: lv, area, msg, line, ...(data !== undefined ? { data } : {}), ...(opts?.event ? { event: opts.event } : {}), ...(opts?.durMs !== undefined ? { durMs: opts.durMs } : {}) };
    for (const sink of outs) sink.write(entry);
  };
  return {
    trace: (msg, data) => write('trace', msg, data),
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    emit: (lv: LogLevel, msg: string, opts?: LogEmitOptions) => write(lv, msg, opts?.err ?? opts?.data, opts),
    child: (sub: string) => consoleLogger(`${area}/${sub}`, level, outs),
  };
}

/** 只在 enabled() 为真时写的去处（设置窗里"写日志文件"的开关） */
export function switchableSink(sink: LogSink, enabled: () => boolean): LogSink {
  return { write: (entry) => { if (enabled()) sink.write(entry); } };
}

/**
 * 按天写日志文件：`<dir>/coopet-YYYY-MM-DD.log`（本地日期），追加写入。
 * 创建时删掉超过 keepDays 天的旧文件。写失败只报一次，不影响程序运行。
 */
export class DailyFileSink implements LogSink {
  private readonly dir: string;
  private failed = false;

  constructor(dir: string, keepDays = 7, now: Date = new Date()) {
    this.dir = dir;
    try {
      mkdirSync(dir, { recursive: true });
      this.prune(keepDays, now);
    } catch (err) {
      this.fail(err);
    }
  }

  write(entry: Pick<LogEntry, 'line' | 'at'>): void {
    if (this.failed) return;
    try {
      appendFileSync(join(this.dir, fileName(entry.at)), entry.line);
    } catch (err) {
      this.fail(err);
    }
  }

  private prune(keepDays: number, now: Date): void {
    const oldest = localDate(new Date(now.getTime() - (keepDays - 1) * 86_400_000));
    for (const name of readdirSync(this.dir)) {
      const m = /^coopet-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
      if (m && m[1] < oldest) unlinkSync(join(this.dir, name));
    }
  }

  private fail(err: unknown): void {
    this.failed = true;
    process.stderr.write(`日志文件写不了（${this.dir}），之后只写到终端：${(err as Error).message}\n`);
  }
}

export function fileName(at: Date): string {
  return `coopet-${localDate(at)}.log`;
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 本地时间 HH:MM:SS.mmm */
function clock(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function format(data: unknown): string {
  if (data instanceof Error) return data.stack ?? `${data.name}: ${data.message}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
