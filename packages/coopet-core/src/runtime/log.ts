/**
 * Cortico `Logger` 的实现：按级别过滤，写到 stderr，可选再写一份到按天分的日志文件。
 * 格式：`HH:MM:SS.mmm 级别 [区域] 内容 {附加数据}`，时间精确到毫秒，方便算延迟。
 */

import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { LogEmitOptions, Logger, LogLevel } from 'cortico/core/types.ts';

const RANK: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const LABEL: Record<LogLevel, string> = { trace: 'TRACE', debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

export const LOG_LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/** 日志行的另一个去处（例如文件）。 */
export interface LogSink {
  write(line: string, at: Date): void;
}

export function consoleLogger(area: string, minLevel: LogLevel = 'info', sink?: LogSink): Logger {
  const write = (level: LogLevel, msg: string, data?: unknown): void => {
    if (RANK[level] < RANK[minLevel]) return;
    const at = new Date();
    const extra = data === undefined ? '' : ` ${format(data)}`;
    const line = `${clock(at)} ${LABEL[level]} [${area}] ${msg}${extra}\n`;
    process.stderr.write(line);
    sink?.write(line, at);
  };
  return {
    trace: (msg, data) => write('trace', msg, data),
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    emit: (level: LogLevel, msg: string, opts?: LogEmitOptions) => write(level, msg, opts?.err ?? opts?.data),
    child: (sub: string) => consoleLogger(`${area}/${sub}`, minLevel, sink),
  };
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

  write(line: string, at: Date): void {
    if (this.failed) return;
    try {
      appendFileSync(join(this.dir, fileName(at)), line);
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
