/**
 * 通知记录：扩展 World 的每条通知后来怎么样了（去了哪里、退没退回桌宠、合没合并、麦麦说没说），设置窗「运行诊断 → 通知」显示。
 *
 * 通知本身在事件库里（runtime/event-store.ts）；这里只记处理的经过。记录放在内存里（最多 MEMORY_MAX 条），
 * 同时按本地日期追加写进 `<dir>/notices-YYYY-MM-DD.jsonl`：新增一行 `{op:"add", record}`，之后的变化各一行
 * `{op:"update", id, patch}`。启动时读回 keepDays 天内的文件（更早的删掉），坏行跳过。
 * 写文件失败时只记一次警告，之后只留在内存里，不影响通知本身。
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** 一条通知的结果 */
export type NoticeResult =
  /** 没处理（路由关掉、规则里关掉、认不得只记录、内容为空），原因在 skip */
  | 'skipped'
  /** 排着队 */
  | 'queued'
  /** 桌宠说了 */
  | 'said'
  /** 还在排队时同一来源又来了一条，合进了 mergedInto 那条 */
  | 'merged'
  /** 交给了麦麦，等她说 */
  | 'handed'
  /** 麦麦说了，开头在 reply（按时间推断：交出去后一段时间内的第一条主动回复） */
  | 'replied'
  /** 交给麦麦后一段时间内她没说 */
  | 'silent';

export interface NoticeRecord {
  id: string;
  /** 收到的时刻（ISO） */
  at: string;
  /** 事件库里的游标 */
  cursor: number;
  worldId: string;
  /** 扩展的名字（界面语言） */
  source: string;
  type: string;
  /** 渲染后的那句话，最多 TEXT_MAX 字 */
  text: string;
  /** 路由的去向；没处理时为 null */
  route: 'pet' | 'maibot' | null;
  /** 没处理的原因（routing.ts 的 skip） */
  skip?: string;
  /** 本该交给麦麦、改由桌宠说的原因 */
  fallback?: string;
  result: NoticeResult;
  mergedInto?: string;
  reply?: string;
  /** 最近一次变化的时刻（ISO） */
  updatedAt: string;
}

export type NoticePatch = Partial<Pick<NoticeRecord, 'route' | 'fallback' | 'result' | 'mergedInto' | 'reply'>>;

export interface NoticeLogOptions {
  /** 保留多少天的文件，默认 30 */
  keepDays?: number;
  now?: () => Date;
  /** 写文件失败时调用一次；之后不再写 */
  onWriteError?: (err: Error) => void;
}

/** 内存里最多留多少条（更早的只在文件里） */
const MEMORY_MAX = 1000;
/** 记录里的内容最多多少字 */
export const TEXT_MAX = 200;
/** 麦麦的回复记多少字 */
export const REPLY_MAX = 60;

type Line = { op: 'add'; record: NoticeRecord } | { op: 'update'; id: string; patch: NoticePatch; at: string };

export class NoticeLog {
  private readonly records = new Map<string, NoticeRecord>();
  private readonly now: () => Date;
  private failed = false;
  private seq = 0;

  /** dir 为空时只在内存里记（测试、直接 dev 运行时也能用） */
  constructor(private readonly dir: string | null, private readonly opts: NoticeLogOptions = {}) {
    this.now = opts.now ?? (() => new Date());
    if (dir) this.load(dir);
  }

  /** 新增一条，返回它（id 由这里给） */
  add(fields: Omit<NoticeRecord, 'id' | 'updatedAt' | 'text'> & { text: string }): NoticeRecord {
    const at = this.now().toISOString();
    const record: NoticeRecord = {
      ...fields,
      text: clip(fields.text, TEXT_MAX),
      id: `${Date.parse(at).toString(36)}-${(this.seq++).toString(36)}-${fields.cursor}`,
      updatedAt: at,
    };
    this.put(record);
    this.write({ op: 'add', record });
    return record;
  }

  /** 改一条；没有这条时什么也不做 */
  update(id: string, patch: NoticePatch): void {
    const record = this.records.get(id);
    if (!record) return;
    const at = this.now().toISOString();
    const clean = patch.reply !== undefined ? { ...patch, reply: clip(patch.reply, REPLY_MAX) } : patch;
    Object.assign(record, clean, { updatedAt: at });
    this.write({ op: 'update', id, patch: clean, at });
  }

  get(id: string): NoticeRecord | undefined {
    return this.records.get(id);
  }

  /** 最近的 limit 条，新的在前 */
  recent(limit: number): NoticeRecord[] {
    return [...this.records.values()].slice(-limit).reverse().map((r) => ({ ...r }));
  }

  private put(record: NoticeRecord): void {
    this.records.set(record.id, record);
    while (this.records.size > MEMORY_MAX) this.records.delete(this.records.keys().next().value as string);
  }

  private write(line: Line): void {
    if (!this.dir || this.failed) return;
    try {
      appendFileSync(join(this.dir, `notices-${localDate(this.now())}.jsonl`), `${JSON.stringify(line)}\n`);
    } catch (err) {
      this.failed = true;
      this.opts.onWriteError?.(err as Error);
    }
  }

  private load(dir: string): void {
    try {
      mkdirSync(dir, { recursive: true });
      const keepDays = this.opts.keepDays ?? 30;
      const oldest = localDate(new Date(this.now().getTime() - (keepDays - 1) * 86_400_000));
      const files = readdirSync(dir).filter((n) => /^notices-\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort();
      for (const name of files) {
        if (name.slice(8, 18) < oldest) {
          unlinkSync(join(dir, name));
          continue;
        }
        for (const raw of readFileSync(join(dir, name), 'utf8').split('\n')) {
          if (!raw.trim()) continue;
          try {
            const line = JSON.parse(raw) as Line;
            if (line.op === 'add' && typeof line.record?.id === 'string') this.put(line.record);
            else if (line.op === 'update') {
              const record = this.records.get(line.id);
              if (record) Object.assign(record, line.patch, { updatedAt: line.at });
            }
          } catch { /* 写到一半断电留下的坏行：跳过 */ }
        }
      }
    } catch (err) {
      this.failed = true;
      this.opts.onWriteError?.(err as Error);
    }
  }
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
