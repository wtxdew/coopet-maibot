/**
 * Link 的 maim_message 旧版实现：连 MaiBot 的 `/maim/{bot_id}/ws`。
 *
 * - 握手头 `platform` + `Authorization`（token 原文）；token 在每次 start() 时从文件读一次。
 * - 断线重连：等待 1s、2s、4s… 最长 30s，连上后重置。token 无效（关闭码 1008 或握手 HTTP 403）不重试。
 * - 心跳：服务端会 ping，ws 库自动回 pong；客户端也每 30s ping 一次，10s 没回 pong 就断开重连，
 *   用来发现 NAS 重启、电脑睡醒这类"看着连着、其实断了"的情况。
 * - 前提见 ARCHITECTURE.md §2.3：MaiBot 配了 token，bot.platforms 登记了 `<platform>:<botAccount>`。
 */

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { Logger } from 'cortico/core/types.ts';
import { buildTextMessage, isMessageBase, type Seg } from './maim-message.ts';
import type { IncomingMessage, IncomingPart, Link, LinkState, OutgoingChat } from './types.ts';

export interface MaimLegacyOptions {
  url: string;
  tokenFile: string;
  platform: string;
  /** Bot 在该平台上的账号，须与 MaiBot 的 bot.platforms 一致 */
  botAccount: string;
  /** 使用者在该平台上的身份 */
  user: { id: string; nickname: string };
  log: Logger;
  backoff?: { initialMs: number; maxMs: number };
  heartbeat?: { intervalMs: number; timeoutMs: number };
}

const AUTH_CLOSE_CODE = 1008;

export class MaimLegacyLink implements Link {
  private readonly opts: MaimLegacyOptions;
  private readonly backoff: { initialMs: number; maxMs: number };
  private readonly heartbeat: { intervalMs: number; timeoutMs: number };
  private ws: WebSocket | null = null;
  private current: LinkState = 'closed';
  private running = false;
  private token = '';
  private retryMs: number;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private readonly messageListeners: Array<(m: IncomingMessage) => void> = [];
  private readonly stateListeners: Array<(s: LinkState, reason?: string) => void> = [];

  constructor(opts: MaimLegacyOptions) {
    this.opts = opts;
    this.backoff = opts.backoff ?? { initialMs: 1000, maxMs: 30_000 };
    this.heartbeat = opts.heartbeat ?? { intervalMs: 30_000, timeoutMs: 10_000 };
    this.retryMs = this.backoff.initialMs;
  }

  start(): void {
    if (this.running) return;
    try {
      this.token = readFileSync(this.opts.tokenFile, 'utf8').trim();
    } catch (err) {
      this.opts.log.error(`读不到 token 文件 ${this.opts.tokenFile}：${(err as NodeJS.ErrnoException).code ?? err}`);
      this.setState('closed', 'token');
      return;
    }
    if (!this.token) {
      this.opts.log.error(`token 文件 ${this.opts.tokenFile} 是空的`);
      this.setState('closed', 'token');
      return;
    }
    this.running = true;
    this.retryMs = this.backoff.initialMs;
    this.connect();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.clearRetry();
    this.stopHeartbeat();
    const ws = this.ws;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        const fallback = setTimeout(() => { ws.terminate(); resolve(); }, 2000);
        ws.once('close', () => { clearTimeout(fallback); resolve(); });
        ws.close(1000);
      });
    }
    this.ws = null;
    this.setState('closed', 'stopped');
  }

  state(): LinkState {
    return this.current;
  }

  send(msg: OutgoingChat): Promise<{ id: string }> {
    const ws = this.ws;
    if (this.current !== 'open' || !ws) return Promise.reject(new Error('还没连上 MaiBot'));
    const message = buildTextMessage({ platform: this.opts.platform, botAccount: this.opts.botAccount, user: this.opts.user, text: msg.text });
    const id = message.message_info.message_id!;
    return new Promise((resolve, reject) => {
      ws.send(JSON.stringify(message), (err) => (err ? reject(err) : resolve({ id })));
    });
  }

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onState(cb: (s: LinkState, reason?: string) => void): void {
    this.stateListeners.push(cb);
  }

  /* ---------- 连接 ---------- */

  private connect(): void {
    if (!this.running) return;
    this.setState('connecting');
    let authFailed = false;
    const ws = new WebSocket(this.opts.url, { headers: { platform: this.opts.platform, Authorization: this.token } });
    this.ws = ws;

    ws.on('open', () => {
      this.retryMs = this.backoff.initialMs;
      this.setState('open');
      this.startHeartbeat(ws);
    });

    ws.on('message', (raw) => this.receive(raw.toString()));

    ws.on('pong', () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    });

    ws.on('unexpected-response', (_req, res) => {
      // 服务端在接受前就关闭（token 无效）时，握手表现为 HTTP 403
      if (res.statusCode === 403) authFailed = true;
      this.opts.log.warn(`握手被拒：HTTP ${res.statusCode}`);
      ws.terminate();
    });

    ws.on('error', (err) => {
      this.opts.log.debug(`连接错误：${err.message}`);
    });

    ws.on('close', (code) => {
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      if (!this.running) return;
      if (authFailed || code === AUTH_CLOSE_CODE) {
        this.running = false;
        this.opts.log.error('MaiBot 拒绝了 token，不再重连；检查 token 文件和 MaiBot 的 maim_message.auth_token');
        this.setState('closed', 'auth');
        return;
      }
      this.setState('closed', String(code));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.clearRetry();
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, this.backoff.maxMs);
    this.opts.log.info(`${Math.round(wait / 100) / 10} 秒后重连`);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(); }, wait);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (this.pongTimer) return; // 上一次还在等
      this.pongTimer = setTimeout(() => {
        this.opts.log.warn('心跳超时，断开重连');
        ws.terminate();
      }, this.heartbeat.timeoutMs);
      ws.ping();
    }, this.heartbeat.intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pingTimer = null;
    this.pongTimer = null;
  }

  private receive(text: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.opts.log.debug('收到无法解析的帧，已丢弃');
      return;
    }
    if (!isMessageBase(parsed)) {
      this.opts.log.debug('收到不是消息的帧，已丢弃');
      return;
    }
    const message: IncomingMessage = {
      ...(parsed.message_info.message_id ? { id: parsed.message_info.message_id } : {}),
      parts: segmentsToParts(parsed.message_segment),
      receivedAt: Date.now(),
    };
    for (const cb of this.messageListeners) {
      try {
        cb(message);
      } catch (err) {
        this.opts.log.error('处理 MaiBot 消息时出错', err);
      }
    }
  }

  private setState(s: LinkState, reason?: string): void {
    if (s === this.current && s !== 'closed') return;
    this.current = s;
    for (const cb of this.stateListeners) {
      try {
        cb(s, reason);
      } catch (err) {
        this.opts.log.error('处理连接状态时出错', err);
      }
    }
  }
}

/** 把 seglist 递归展开成平铺的段。 */
export function segmentsToParts(seg: Seg): IncomingPart[] {
  if (Array.isArray(seg.data)) return seg.data.flatMap(segmentsToParts);
  if (seg.type === 'text') return [{ kind: 'text', text: String(seg.data) }];
  if ((seg.type === 'image' || seg.type === 'emoji') && typeof seg.data === 'string') return [{ kind: seg.type, base64: seg.data }];
  return [{ kind: 'other', type: seg.type }];
}
