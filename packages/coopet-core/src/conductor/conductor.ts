/**
 * 聊天调度（不调用 LLM）：桌宠事件 → link → MaiBot；MaiBot 的消息 → 桌宠气泡。
 *
 * "思考中"有两种来源：
 * - link 有真实的思考信号（插件协议）：完全按 MaiBot 的信号显示；ack 成功就把消息标成已送达。
 *   连接可以在运行中被换掉（link/switch.ts），所以每轮发消息时现问一次有没有信号（hasThinking）。
 * - link 不提供（maim_message）：只能估计。发出消息就显示思考中，收到第一条回复或超时就结束；
 *   MaiBot 的 planner 常常决定不回复，超时不算出错。
 *
 * 每轮对话在日志里留一条时间线：`[对话 #游标] 步骤 +距输入的时间`，方便定位延迟；
 * 同样的时间点也记进 TurnStats（stats()），设置窗「运行诊断」显示。
 * 回复、思考信号对不上具体是哪条消息引起的，统一按最近一次输入计时；
 * 距最近一次输入超过 TURN_WINDOW_MS 的回复记成 `[主动]`。
 *
 * 扩展 World 的通知按路由（routing.ts）决定说不说、说什么、交给谁。两条队列（NoticeQueue）：
 * - 桌宠说：两条气泡之间至少隔 NOTICE_GAP_MS；
 * - 交给麦麦：经插件转成 MaiBot 的通知消息（协议 notice，插件 0.2.0 起），由麦麦决定要不要说；两条之间至少隔
 *   MAIBOT_NOTICE_GAP_MS，免得一下子塞给她一串。没连上、插件不支持或转失败时，改由桌宠说，日志写明原因。
 * 还在排队时同一来源（同一扩展的同一分类：meta.topic、meta.agent，没有就是事件类型）又来了，合成一条：
 * 用最新的那条，后面注明还有几条。
 */

import type { EventEnvelope, Logger } from 'cortico/core/types.ts';
import type { IncomingMessage, Link, LinkState } from '../link/types.ts';
import type { PetHandle } from '../runtime/pet.ts';
import type { HostedEvent } from '../runtime/world-host.ts';
import { TurnStats, type ConversationStats } from './stats.ts';
import { route } from './routing.ts';
import { escapeScript } from '../expr/escape.ts';
import type { Language } from 'cortico/core/language.ts';
import { ROUTE_DEFAULTS, type RouteSettings } from '../runtime/config.ts';

export interface ConductorOptions {
  pet: Pick<PetHandle, 'call' | 'phase' | 'turnEnded' | 'settled'>;
  link: Pick<Link, 'state' | 'send' | 'onMessage' | 'onState' | 'onThinking' | 'hasThinking' | 'supportsNotice' | 'notice'>;
  log: Logger;
  botName: () => string;
  /** 给 MaiBot 的回复加表情动作标记（表情规则 E1）；没有时原样显示 */
  decorate?: (text: string) => string;
  /** 估计模式下，发出消息后多久没回复就结束"思考中"，默认 30 秒 */
  thinkingTimeoutMs?: number;
  /** 时间线用的时钟（毫秒），测试时替换 */
  now?: () => number;
  /** 扩展 World 的路由设置（cfg.routes），没写的按 ROUTE_DEFAULTS */
  routeOf?: (worldId: string) => RouteSettings;
  /** 两条通知气泡之间至少隔多久，默认 NOTICE_GAP_MS（测试时调小） */
  noticeGapMs?: number;
  /** 两条交给麦麦的通知之间至少隔多久，默认 MAIBOT_NOTICE_GAP_MS（测试时调小） */
  maibotNoticeGapMs?: number;
  /** 扩展的名字（交给麦麦时写在通知的来源里）；没有时用扩展 id */
  worldLabel?: (worldId: string) => string | undefined;
  /** 界面语言（渲染通知用） */
  language?: () => Language;
}

/** 回复离最近一次输入多久以内，算作这一轮的回复 */
const TURN_WINDOW_MS = 120_000;
/** 日志里消息原文最多记多少字 */
const PREVIEW_CHARS = 30;
/** 两条通知气泡之间至少隔多久 */
const NOTICE_GAP_MS = 4000;
/** 两条交给麦麦的通知之间至少隔多久 */
const MAIBOT_NOTICE_GAP_MS = 10_000;
/** 通知来源的长度上限（协议 notice.source） */
const SOURCE_CHARS = 64;

/** 使用者说话的事件：打字、语音；原文在 meta.text（event.text 带了给模型看的时间戳前缀）。 */
const USER_SAID = new Set(['desktop-pet.message', 'desktop-pet.speech']);

export class Conductor {
  private readonly opts: ConductorOptions;
  private readonly timeoutMs: number;
  /** 已发给 MaiBot、还没等到回复的事件 */
  private waiting: EventEnvelope[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** 真实信号模式下，桌宠当前是否显示着思考中 */
  private thinking = false;
  private readonly now: () => number;
  /** 最近一次输入：时间线以它为起点 */
  private last: { cursor: number; at: number } | null = null;
  private readonly turnStats: TurnStats;
  /** 等着桌宠说的通知 */
  private readonly petNotices: NoticeQueue;
  /** 等着交给麦麦的通知 */
  private readonly maibotNotices: NoticeQueue;

  constructor(opts: ConductorOptions) {
    this.opts = opts;
    this.timeoutMs = opts.thinkingTimeoutMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.turnStats = new TurnStats(this.now);
    this.petNotices = new NoticeQueue(opts.noticeGapMs ?? NOTICE_GAP_MS, this.now, (n) => void this.say(n.say + this.more(n.more)));
    this.maibotNotices = new NoticeQueue(opts.maibotNoticeGapMs ?? MAIBOT_NOTICE_GAP_MS, this.now, (n) => void this.toMaibot(n));
    opts.link.onMessage((m) => void this.reply(m));
    opts.link.onState((s) => this.linkChanged(s));
    opts.link.onThinking?.((on) => this.thinkingChanged(on));
  }

  /** 当前连接有没有真实的思考信号 */
  private get realThinking(): boolean {
    const { link } = this.opts;
    return link.hasThinking ? link.hasThinking() : typeof link.onThinking === 'function';
  }

  /** runtime 的 onEvent 接到这里。 */
  handle({ event }: HostedEvent): void {
    if (USER_SAID.has(event.type)) {
      void this.userSaid(event);
      return;
    }
    // 戳、摸、甩的反应由桌宠页面自己做；传给 MaiBot 见 ROADMAP 阶段 6
    this.opts.log.debug(`事件 #${event.cursor} ${event.type} 不转发`);
  }

  /**
   * 扩展 World 推出的事件：按路由（routing.ts）决定让桌宠说什么、交给麦麦，或者不处理。不算一轮对话。
   */
  worldEvent(worldId: string, { event }: HostedEvent): void {
    const settings = this.opts.routeOf?.(worldId) ?? ROUTE_DEFAULTS;
    const decision = route(event, settings, this.opts.language?.() ?? 'zh');
    if ('skip' in decision) {
      this.opts.log.debug(`[通知 · ${worldId}] #${event.cursor} ${event.type} 不处理（${decision.skip}）`);
      return;
    }
    const meta = (event.meta ?? {}) as { topic?: unknown; agent?: unknown };
    const kind = typeof meta.topic === 'string' ? meta.topic : typeof meta.agent === 'string' ? meta.agent : event.type;
    const tag = `[通知 · ${worldId}] #${event.cursor} ${event.type}`;
    const notice: PendingNotice = {
      key: `${worldId}:${kind}`, tag, say: decision.say, text: decision.text, more: 0,
      source: clip(this.opts.worldLabel?.(worldId) || worldId, SOURCE_CHARS),
    };
    if (decision.to === 'maibot') {
      const why = this.cannotNotice();
      if (!why) {
        this.opts.log.info(`${tag} → 交给麦麦：${preview(decision.text)}`);
        this.maibotNotices.push(notice);
        return;
      }
      this.opts.log.info(`${tag} → 桌宠说（交给麦麦不行：${why}）：${preview(decision.say)}`);
    } else {
      this.opts.log.info(`${tag} → 桌宠说：${preview(decision.say)}`);
    }
    this.petNotices.push(notice);
  }

  /** 现在不能交给麦麦的原因；能的话是 null */
  private cannotNotice(): string | null {
    const { link } = this.opts;
    if (link.state() !== 'open') return '没连上 MaiBot';
    if (!link.supportsNotice?.() || !link.notice) return '插件不支持转通知（要 0.2.0 以上）';
    return null;
  }

  /** 排到了：转给插件；转不了或插件没收下时改由桌宠说 */
  private async toMaibot(n: PendingNotice): Promise<void> {
    const fallback = (why: string) => {
      this.opts.log.warn(`${n.tag} 没能交给麦麦（${why}），改由桌宠说`);
      this.petNotices.push(n);
    };
    const why = this.cannotNotice();
    if (why) { fallback(why); return; }
    try {
      await this.opts.link.notice!({ source: n.source, text: n.text + this.more(n.more) });
      this.opts.log.info(`${n.tag} 麦麦收下了${n.more ? `（合并了 ${n.more + 1} 条）` : ''}`);
    } catch (err) {
      fallback((err as Error).message);
    }
  }

  /** 合并了几条时加在后面的说明 */
  private more(count: number): string {
    if (!count) return '';
    return (this.opts.language?.() ?? 'zh').startsWith('zh') ? `（还有 ${count} 条）` : ` (+${count} more)`;
  }

  /** 对话统计：本次运行几轮、最近一轮的时间线、最近的回复延迟 */
  stats(): ConversationStats {
    return this.turnStats.snapshot();
  }

  /** 退出前调用，清掉计时。 */
  stop(): void {
    this.clearTimer();
    this.petNotices.stop();
    this.maibotNotices.stop();
  }

  private async userSaid(event: EventEnvelope): Promise<void> {
    const text = typeof event.meta?.text === 'string' ? event.meta.text.trim() : '';
    if (!text) return;
    const { link } = this.opts;
    this.last = { cursor: event.cursor, at: this.now() };
    this.turnStats.start(event.cursor, event.type === 'desktop-pet.speech' ? 'voice' : 'typed');
    this.trace(`输入（${event.type === 'desktop-pet.speech' ? '语音' : '打字'}）：${preview(text)}`, false);
    if (link.state() !== 'open') {
      this.trace('没连上，未发送', true, 'warn');
      await this.notConnected(event);
      return;
    }
    try {
      await link.send({ text });
    } catch (err) {
      this.trace(`发送失败：${(err as Error).message}`, true, 'warn');
      await this.notConnected(event);
      return;
    }
    const real = this.realThinking;
    this.trace(real ? 'MaiBot 收下（ack）' : '已发出');
    this.turnStats.mark(real ? 'acked' : 'sent');
    if (real) {
      // ack 成功表示 MaiBot 已收下；会不会回复、什么时候想，由 thinking 信号决定
      this.opts.pet.settled([event], 'delivered');
      return;
    }
    this.waiting.push(event);
    this.opts.pet.phase({ state: 'model', running: [] });
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.trace(`${this.timeoutMs / 1000} 秒内没有回复，结束思考`);
      this.turnStats.end('no-reply');
      this.finishTurn('delivered');
    }, this.timeoutMs);
  }

  private async notConnected(event: EventEnvelope): Promise<void> {
    this.turnStats.end('not-sent');
    await this.say(`还没连上${this.opts.botName()}`);
    this.opts.pet.settled([event], 'discarded');
  }

  private async reply(m: IncomingMessage): Promise<void> {
    const text = m.parts.map((p) => {
      if (p.kind === 'text') return p.text;
      if (p.kind === 'image') return '[图片]';
      if (p.kind === 'emoji') return '[表情]';
      return '';
    }).join('').trim();
    if (!text) {
      this.trace(`回复里没有能显示的内容（${m.parts.map((p) => p.kind === 'other' ? p.type : p.kind).join('、')}）`);
      return;
    }
    this.trace(`回复到达（${[...text].length} 字）：${preview(text)}`);
    this.turnStats.mark('reply');
    // 先转义（回复里的【】、短的 <…> 会被桌宠当成动作标记吃掉），再加表情规则的动作标记
    const safe = escapeScript(text);
    const script = this.opts.decorate ? this.opts.decorate(safe) : safe;
    this.opts.pet.phase({ state: 'tools', running: ['pet_say'] });
    await this.say(script);
    this.trace('气泡显示');
    this.turnStats.mark('bubble');
    this.turnStats.end('replied');
    this.finishTurn('delivered');
  }

  private linkChanged(s: LinkState): void {
    if (s !== 'closed') return;
    if (this.waiting.length || this.thinking) {
      this.trace('连接断开，本轮结束', true, 'warn');
      this.turnStats.end('disconnected');
    }
    if (this.waiting.length) this.finishTurn('discarded');
    else if (this.thinking) this.finishTurn('delivered');
  }

  private thinkingChanged(on: boolean): void {
    if (on === this.thinking) return;
    if (on) {
      this.thinking = true;
      this.trace('思考开始');
      this.turnStats.mark('thinking');
      this.opts.pet.phase({ state: 'model', running: [] });
    } else {
      this.trace('思考结束（没有回复）');
      this.turnStats.end('no-reply');
      this.finishTurn('delivered');
    }
  }

  /** 回到空闲，把等待中的事件标成送达或丢弃。 */
  private finishTurn(outcome: 'delivered' | 'discarded'): void {
    this.clearTimer();
    this.thinking = false;
    const { pet } = this.opts;
    pet.phase({ state: 'idle', running: [] });
    pet.turnEnded();
    if (this.waiting.length) pet.settled(this.waiting, outcome);
    this.waiting = [];
  }

  private async say(script: string): Promise<void> {
    try {
      const out = await this.opts.pet.call('pet_say', { script });
      if (typeof out !== 'string' && out.failed) this.opts.log.warn(`桌宠没能说出来：${out.text}`);
    } catch (err) {
      this.opts.log.error('调用 pet_say 出错', err);
    }
  }

  /** 时间线的一行：`[对话 #游标] 步骤 +距输入`；离输入太久或还没有输入时记成 `[主动]`。 */
  private trace(step: string, withElapsed = true, level: 'info' | 'warn' = 'info'): void {
    const elapsed = this.last ? this.now() - this.last.at : Infinity;
    const inTurn = elapsed <= TURN_WINDOW_MS;
    const tag = inTurn ? `[对话 #${this.last!.cursor}]` : '[主动]';
    const time = withElapsed && inTurn ? ` +${formatMs(elapsed)}` : '';
    this.opts.log[level](`${tag} ${step}${time}`);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function preview(text: string): string {
  const chars = [...text.replace(/\s+/g, ' ')];
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : chars.join('');
}

/** 一条等着处理的通知：say 是桌宠念的（截过、转义过），text 是交给麦麦的；more 是合进来的条数 */
interface PendingNotice {
  key: string;
  /** 日志里的前缀 */
  tag: string;
  source: string;
  say: string;
  text: string;
  more: number;
}

/**
 * 通知队列：两条之间至少隔 gapMs；还在排队时同一 key 又来了，换成新的那条、more 加一。
 * 排到时调 deliver（合并的说明由 deliver 加）。
 */
class NoticeQueue {
  private items: PendingNotice[] = [];
  private timer: NodeJS.Timeout | null = null;
  private lastAt = -Infinity;

  constructor(
    private readonly gapMs: number,
    private readonly now: () => number,
    private readonly deliver: (n: PendingNotice) => void,
  ) {}

  push(n: PendingNotice): void {
    const waiting = this.items.find((x) => x.key === n.key);
    if (waiting) Object.assign(waiting, { ...n, more: waiting.more + n.more + 1 });
    else this.items.push({ ...n });
    this.pump();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.items = [];
  }

  private pump(): void {
    if (this.timer || this.items.length === 0) return;
    const wait = Math.max(0, this.lastAt + this.gapMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      const next = this.items.shift();
      if (!next) return;
      this.lastAt = this.now();
      this.deliver(next);
      this.pump();
    }, wait);
  }
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? chars.slice(0, max).join('') : text;
}
