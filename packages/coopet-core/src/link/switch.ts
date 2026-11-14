/**
 * 可替换的连接：Conductor 和 main.ts 拿着它，它把调用转给里面真正的连接（插件、maim_message 或占位）。
 * 设置窗改了连接方式、地址或 token 时调用 replace，不用重启核心。
 *
 * - 回调只向它注册一次；它在每个内部连接上各挂一份转发，只转发当前那个连接的事件，
 *   被换下的连接停下时发出的 closed 不会传出去。
 * - replace：先停旧连接，对外报一次 closed（原因 'switching'），让 Conductor 结束正在等的这一轮；
 *   再启动新连接（只有 start 过才会启动）。
 * - hasThinking：当前连接有没有真实的思考信号（插件协议有，maim_message 没有），Conductor 每轮问一次。
 */

import type { IncomingMessage, Link, LinkState, OutgoingChat, OutgoingNotice } from './types.ts';

export class LinkSwitch implements Link {
  private current: Link;
  private started = false;
  private readonly messageCbs: Array<(m: IncomingMessage) => void> = [];
  private readonly stateCbs: Array<(s: LinkState, reason?: string) => void> = [];
  private readonly thinkingCbs: Array<(on: boolean) => void> = [];

  constructor(initial: Link) {
    this.current = initial;
    this.bind(initial);
  }

  /** 当前的内部连接（测试和日志用） */
  inner(): Link {
    return this.current;
  }

  start(): void {
    this.started = true;
    this.current.start();
  }

  async stop(): Promise<void> {
    this.started = false;
    await this.current.stop();
  }

  /** 换上新连接；返回时旧连接已停，新连接已开始连（如果之前 start 过）。 */
  async replace(next: Link): Promise<void> {
    const old = this.current;
    this.current = next;
    this.bind(next);
    await old.stop();
    for (const cb of this.stateCbs) cb('closed', 'switching');
    if (this.started) next.start();
  }

  state(): LinkState {
    return this.current.state();
  }

  send(msg: OutgoingChat): Promise<{ id: string }> {
    return this.current.send(msg);
  }

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.messageCbs.push(cb);
  }

  onState(cb: (s: LinkState, reason?: string) => void): void {
    this.stateCbs.push(cb);
  }

  onThinking(cb: (on: boolean) => void): void {
    this.thinkingCbs.push(cb);
  }

  hasThinking(): boolean {
    return typeof this.current.onThinking === 'function';
  }

  botName(): string | undefined {
    return this.current.botName?.();
  }

  supportsNotice(): boolean {
    return this.current.supportsNotice?.() ?? false;
  }

  notice(n: OutgoingNotice): Promise<{ id: string }> {
    return this.current.notice ? this.current.notice(n) : Promise.reject(new Error('这种连接不能转通知'));
  }

  private bind(link: Link): void {
    const live = () => link === this.current;
    link.onMessage((m) => { if (live()) for (const cb of this.messageCbs) cb(m); });
    link.onState((s, reason) => { if (live()) for (const cb of this.stateCbs) cb(s, reason); });
    link.onThinking?.((on) => { if (live()) for (const cb of this.thinkingCbs) cb(on); });
  }
}
