/**
 * 内存事件库：实现 Cortico 的 `EventStore`，给桌宠 World 用。
 *
 * 桌宠用它做两件事：`pushEvent` 返回带游标的事件；对话页通过 `range()` 读历史
 * （包括桌宠自己说过的话）。阶段 1 只存在内存里，进程重启后清空；
 * 聊天记录的正本在 MaiBot。
 */

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
  /** 按游标升序；游标从 1 开始连续分配，所以第 i 条的游标是 i + 1。 */
  private readonly events: EventEnvelope[] = [];

  append(e: Omit<EventEnvelope, 'cursor'>): EventEnvelope {
    const saved: EventEnvelope = { ...e, cursor: this.events.length + 1 };
    this.events.push(saved);
    return saved;
  }

  get(cursor: number): EventEnvelope | undefined {
    return Number.isInteger(cursor) ? this.events[cursor - 1] : undefined;
  }

  /** 还没有事件时为 0。 */
  latestCursor(): number {
    return this.events.length;
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
    const i = cursor - 1;
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
