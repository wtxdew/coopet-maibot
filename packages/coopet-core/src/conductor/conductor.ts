/**
 * 聊天调度（不调用 LLM）：桌宠事件 → link → MaiBot；MaiBot 的消息 → 桌宠气泡。
 *
 * "思考中"只能估计：旧版 WS 收不到 MaiBot 开始生成回复的信号，所以发出消息就显示思考中，
 * 收到第一条回复或超时就结束。MaiBot 的 planner 常常决定不回复，超时不算出错。
 * 阶段 2 改用插件的 replyer Hook 后才准确。
 */

import type { EventEnvelope, Logger } from 'cortico/core/types.ts';
import type { IncomingMessage, Link, LinkState } from '../link/types.ts';
import type { PetHandle } from '../runtime/pet.ts';
import type { HostedEvent } from '../runtime/world-host.ts';

export interface ConductorOptions {
  pet: Pick<PetHandle, 'call' | 'phase' | 'turnEnded' | 'settled'>;
  link: Pick<Link, 'state' | 'send' | 'onMessage' | 'onState'>;
  log: Logger;
  botName: () => string;
  /** 给 MaiBot 的回复加表情动作标记（表情规则 E1）；没有时原样显示 */
  decorate?: (text: string) => string;
  /** 发出消息后多久没回复就结束"思考中"，默认 30 秒 */
  thinkingTimeoutMs?: number;
}

/** 使用者说话的事件：打字、语音；原文在 meta.text（event.text 带了给模型看的时间戳前缀）。 */
const USER_SAID = new Set(['desktop-pet.message', 'desktop-pet.speech']);

export class Conductor {
  private readonly opts: ConductorOptions;
  private readonly timeoutMs: number;
  /** 已发给 MaiBot、还没等到回复的事件 */
  private waiting: EventEnvelope[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(opts: ConductorOptions) {
    this.opts = opts;
    this.timeoutMs = opts.thinkingTimeoutMs ?? 30_000;
    opts.link.onMessage((m) => void this.reply(m));
    opts.link.onState((s) => this.linkChanged(s));
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

  /** 退出前调用，清掉计时。 */
  stop(): void {
    this.clearTimer();
  }

  private async userSaid(event: EventEnvelope): Promise<void> {
    const text = typeof event.meta?.text === 'string' ? event.meta.text.trim() : '';
    if (!text) return;
    const { link, log } = this.opts;
    if (link.state() !== 'open') {
      await this.notConnected(event);
      return;
    }
    try {
      await link.send({ text });
    } catch (err) {
      log.warn(`消息没能发给 MaiBot：${(err as Error).message}`);
      await this.notConnected(event);
      return;
    }
    this.waiting.push(event);
    this.opts.pet.phase({ state: 'model', running: [] });
    this.clearTimer();
    this.timer = setTimeout(() => {
      log.info(`${this.timeoutMs / 1000} 秒内 MaiBot 没有回复`);
      this.finishTurn('delivered');
    }, this.timeoutMs);
  }

  private async notConnected(event: EventEnvelope): Promise<void> {
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
      this.opts.log.debug('MaiBot 的消息里没有能显示的内容');
      return;
    }
    // TODO（ROADMAP 阶段 6）：显示前转义文字里的【】、<>、＜＞，否则会被当成动作标记吃掉
    const script = this.opts.decorate ? this.opts.decorate(text) : text;
    this.opts.pet.phase({ state: 'tools', running: ['pet_say'] });
    await this.say(script);
    this.finishTurn('delivered');
  }

  private linkChanged(s: LinkState): void {
    if (s === 'closed' && this.waiting.length) this.finishTurn('discarded');
  }

  /** 回到空闲，把等待中的事件标成送达或丢弃。 */
  private finishTurn(outcome: 'delivered' | 'discarded'): void {
    this.clearTimer();
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

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
