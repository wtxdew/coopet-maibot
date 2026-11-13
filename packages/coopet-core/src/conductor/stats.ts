/**
 * 对话统计：Conductor 在每一轮的几个时间点记一下，设置窗「运行诊断」显示（/api/status 的 conversation）。
 * 和日志里的时间线是同一组时间点：输入、收下（ack）或已发出、思考开始、回复到达、气泡显示，以及这一轮怎么结束。
 *
 * - turns：本次运行有几轮（每次你说一句话算一轮，没连上没发出去的也算）。
 * - last：最近一轮各步骤距输入的毫秒数和结局。
 * - recent：最近 RECENT 轮里有回复的那些，"输入 → 回复到达"的中位数和最慢的一次。
 */

export type TurnStep = 'sent' | 'acked' | 'thinking' | 'reply' | 'bubble';
export type TurnOutcome = 'replied' | 'no-reply' | 'not-sent' | 'disconnected';

export interface TurnRecord {
  cursor: number;
  via: 'typed' | 'voice';
  /** 输入的时刻（ISO） */
  at: string;
  /** 各步骤距输入的毫秒数，按发生顺序 */
  steps: Array<{ step: TurnStep; ms: number }>;
  outcome?: TurnOutcome;
}

export interface ConversationStats {
  turns: number;
  last: TurnRecord | null;
  recent: { replied: number; medianReplyMs: number | null; maxReplyMs: number | null };
}

const RECENT = 20;

export class TurnStats {
  private turns = 0;
  private current: (TurnRecord & { startedAt: number }) | null = null;
  private last: TurnRecord | null = null;
  /** 最近几轮"输入 → 回复到达"的毫秒数（没有回复的不算） */
  private replyMs: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** 你说了一句话：开始新的一轮（上一轮没结束的话按"没有回复"结束） */
  start(cursor: number, via: TurnRecord['via']): void {
    if (this.current) this.end('no-reply');
    this.turns++;
    const startedAt = this.now();
    this.current = { cursor, via, at: new Date(startedAt).toISOString(), steps: [], startedAt };
    this.last = this.public(this.current);
  }

  /** 这一轮到了某一步；同一步只记第一次（例如多条回复只记第一条） */
  mark(step: TurnStep): void {
    const cur = this.current;
    if (!cur || cur.steps.some((s) => s.step === step)) return;
    const ms = this.now() - cur.startedAt;
    cur.steps.push({ step, ms });
    if (step === 'reply') this.replyMs = [...this.replyMs, ms].slice(-RECENT);
    this.last = this.public(cur);
  }

  /** 这一轮结束 */
  end(outcome: TurnOutcome): void {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    this.last = { ...this.public(cur), outcome };
  }

  snapshot(): ConversationStats {
    const sorted = [...this.replyMs].sort((a, b) => a - b);
    const median = sorted.length ? sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
    return {
      turns: this.turns,
      last: this.last && { ...this.last, steps: [...this.last.steps] },
      recent: { replied: sorted.length, medianReplyMs: median, maxReplyMs: sorted.at(-1) ?? null },
    };
  }

  private public(cur: TurnRecord & { startedAt: number }): TurnRecord {
    const { startedAt: _, ...rest } = cur;
    return { ...rest, steps: [...rest.steps] };
  }
}
