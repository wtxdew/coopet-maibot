/**
 * 事件库：实现 Cortico 的 `EventStore`，给桌宠 World 用。
 *
 * 桌宠用它做两件事：`pushEvent` 返回带游标的事件；对话页通过 `range()` 读历史
 * （包括桌宠自己说过的话）。事件放在内存里查询；`openEventLog` 再把每条事件追加写进
 * `<dir>/events-YYYY-MM-DD.jsonl`，启动时读回最近 keepDays 天，所以重启后对话页还能看到以前的记录。
 * 聊天记录的正本仍在 MaiBot。
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type {
  EventEnvelope,
  EventGrepHit,
  EventGrepQuery,
  EventRangeQuery,
  EventStore,
} from 'cortico/core/types.ts';

interface Filter {
  senderKey?: string;
  source?: string;
  origin?: EventEnvelope['origin'];
  fromTs?: string;
  toTs?: string;
}

export class MemoryEventStore implements EventStore {
  /** 按游标升序、连续；第一条的游标是 base（读回的历史被裁掉开头时大于 1）。 */
  private readonly events: EventEnvelope[];
  private readonly base: number;
  private readonly onAppend?: (e: EventEnvelope) => void;

  /**
   * @param seed 已有的事件，游标必须从 seed[0].cursor 起连续递增
   * @param onAppend 每存一条新事件后调用（例如写文件）
   */
  constructor(seed: EventEnvelope[] = [], onAppend?: (e: EventEnvelope) => void) {
    this.events = [...seed];
    this.base = seed[0]?.cursor ?? 1;
    this.onAppend = onAppend;
  }

  append(e: Omit<EventEnvelope, 'cursor'>): EventEnvelope {
    const saved: EventEnvelope = { ...e, cursor: this.base + this.events.length };
    this.events.push(saved);
    this.onAppend?.(saved);
    return saved;
  }

  get(cursor: number): EventEnvelope | undefined {
    return Number.isInteger(cursor) ? this.events[cursor - this.base] : undefined;
  }

  /** 还没有事件时为 base - 1（全新时为 0）。 */
  latestCursor(): number {
    return this.base + this.events.length - 1;
  }

  /** 区间两端都包含；有 limit 时取区间末尾的至多 limit 条，结果按游标升序。 */
  range(q: EventRangeQuery): EventEnvelope[] {
    const hits = this.events.filter((e) =>
      (q.fromCursor === undefined || e.cursor >= q.fromCursor)
      && (q.toCursor === undefined || e.cursor <= q.toCursor)
      && matches(e, q));
    return q.limit === undefined ? hits : hits.slice(Math.max(0, hits.length - q.limit));
  }

  /** 该游标之前 before 条、它自己、之后 after 条；游标不存在时为空。 */
  around(cursor: number, before: number, after: number): EventEnvelope[] {
    const i = cursor - this.base;
    if (!this.events[i]) return [];
    return this.events.slice(Math.max(0, i - before), i + after + 1);
  }

  /** 不区分大小写的子串匹配；有 limit 时取最近的至多 limit 组命中，结果按游标升序。 */
  grep(q: EventGrepQuery): EventGrepHit[] {
    const keyword = q.keyword.toLowerCase();
    if (!keyword) return [];
    const hits = this.events.filter((e) => matches(e, q) && e.text.toLowerCase().includes(keyword));
    const picked = q.limit === undefined ? hits : hits.slice(Math.max(0, hits.length - q.limit));
    return picked.map((e) => ({ hitCursor: e.cursor, events: this.around(e.cursor, q.context, q.context) }));
  }
}

export interface EventLogOptions {
  /** 保留多少天的文件，默认 30 */
  keepDays?: number;
  now?: () => Date;
  /** 写文件失败时调用一次；之后不再写，只留在内存里 */
  onWriteError?: (err: Error) => void;
}

/**
 * 打开写文件的事件库：删掉超过 keepDays 天的文件，读回其余文件里的事件，
 * 之后每条新事件追加写进当天（本地日期）的文件。坏行跳过；游标不连续时只保留最后一段连续的。
 */
export function openEventLog(dir: string, opts: EventLogOptions = {}): MemoryEventStore {
  const keepDays = opts.keepDays ?? 30;
  const now = opts.now ?? (() => new Date());
  mkdirSync(dir, { recursive: true });

  const oldest = localDate(new Date(now().getTime() - (keepDays - 1) * 86_400_000));
  const files = readdirSync(dir).filter((n) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
  const seed: EventEnvelope[] = [];
  for (const name of files) {
    if (name.slice(7, 17) < oldest) {
      unlinkSync(join(dir, name));
      continue;
    }
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as EventEnvelope;
        if (Number.isInteger(e.cursor) && typeof e.type === 'string') seed.push(e);
      } catch { /* 写到一半断电留下的坏行：跳过 */ }
    }
  }
  seed.sort((a, b) => a.cursor - b.cursor);

  let failed = false;
  return new MemoryEventStore(contiguousTail(seed), (e) => {
    if (failed) return;
    try {
      appendFileSync(join(dir, `events-${localDate(now())}.jsonl`), `${JSON.stringify(e)}\n`);
    } catch (err) {
      failed = true;
      opts.onWriteError?.(err as Error);
    }
  });
}

/** 从末尾往前找，保留最后一段游标连续递增的事件。 */
function contiguousTail(events: EventEnvelope[]): EventEnvelope[] {
  let start = events.length - 1;
  while (start > 0 && events[start - 1].cursor === events[start].cursor - 1) start--;
  return start < 0 ? [] : events.slice(start);
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function matches(e: EventEnvelope, f: Filter): boolean {
  if (f.senderKey !== undefined && e.senderKey !== f.senderKey) return false;
  if (f.source !== undefined && e.source !== f.source) return false;
  if (f.origin !== undefined && e.origin !== f.origin) return false;
  // 时刻带时区偏移，按绝对时间比较，不按字符串比较
  const t = Date.parse(e.ts);
  if (f.fromTs !== undefined && !(t >= Date.parse(f.fromTs))) return false;
  if (f.toTs !== undefined && !(t <= Date.parse(f.toTs))) return false;
  return true;
}
