/**
 * 没配置地址时用的占位连接：一直是 closed（原因 no-url），发消息直接失败。
 * 这样核心照常运行，配置窗还能打开去填地址，而不是一启动就退出。
 */

import type { IncomingMessage, Link, LinkState } from './types.ts';

export class DisconnectedLink implements Link {
  private readonly stateListeners: Array<(s: LinkState, reason?: string) => void> = [];

  start(): void {
    for (const cb of this.stateListeners) cb('closed', 'no-url');
  }

  async stop(): Promise<void> {}

  state(): LinkState {
    return 'closed';
  }

  send(): Promise<{ id: string }> {
    return Promise.reject(new Error('还没配置 MaiBot 的地址'));
  }

  onMessage(_cb: (m: IncomingMessage) => void): void {}

  onState(cb: (s: LinkState, reason?: string) => void): void {
    this.stateListeners.push(cb);
  }
}
