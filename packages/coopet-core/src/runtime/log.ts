/**
 * Cortico `Logger` 的最小实现：按级别过滤后写到 stderr。
 * 格式：`HH:MM:SS 级别 [区域] 内容 {附加数据}`。阶段 3 再加日志文件。
 */

import type { LogEmitOptions, Logger, LogLevel } from 'cortico/core/types.ts';

const RANK: Record<LogLevel, number> = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
const LABEL: Record<LogLevel, string> = { trace: 'TRACE', debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR' };

export function consoleLogger(area: string, minLevel: LogLevel = 'info'): Logger {
  const write = (level: LogLevel, msg: string, data?: unknown): void => {
    if (RANK[level] < RANK[minLevel]) return;
    const time = new Date().toTimeString().slice(0, 8);
    const extra = data === undefined ? '' : ` ${format(data)}`;
    process.stderr.write(`${time} ${LABEL[level]} [${area}] ${msg}${extra}\n`);
  };
  return {
    trace: (msg, data) => write('trace', msg, data),
    debug: (msg, data) => write('debug', msg, data),
    info: (msg, data) => write('info', msg, data),
    warn: (msg, data) => write('warn', msg, data),
    error: (msg, data) => write('error', msg, data),
    emit: (level: LogLevel, msg: string, opts?: LogEmitOptions) => write(level, msg, opts?.err ?? opts?.data),
    child: (sub: string) => consoleLogger(`${area}/${sub}`, minLevel),
  };
}

function format(data: unknown): string {
  if (data instanceof Error) return data.stack ?? `${data.name}: ${data.message}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
