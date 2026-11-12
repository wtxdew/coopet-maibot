/**
 * Link 的插件实现：连 coopet-adapter 插件，说协议 v0（docs/PROTOCOL.md）。
 *
 * - 握手：WS 打开后发 hello，收到 welcome 才算 open；welcome 带 Bot 名字和身份。
 * - 发消息：chat 带 UUID，等对应的 ack（10 秒），ok 才算 MaiBot 收下。
 * - 收消息：reply → onMessage；thinking → onThinking；error 记日志；不认识的 type 忽略。
 * - 重连：1s 起翻倍，最长 30s；4001（token）、4002（协议版本）、4003（被顶替）不重连。
 * - 心跳：服务端会 ping；客户端也每 30s ping 一次，10s 没回 pong 就断开重连。
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import type { Logger } from 'cortico/core/types.ts';
import type { IncomingMessage, IncomingPart, Link, LinkState, OutgoingChat } from './types.ts';

export const PROTOCOL_VERSION = 0;

/** 不重连的关闭码，以及对应的 closed 原因 */
const FATAL_CLOSE: Record<number, string> = { 4001: 'auth', 4002: 'protocol', 4003: 'replaced' };

export interface CoopetPluginOptions {
  url: string;
  tokenFile: string;
  deviceId: string;
  deviceName: string;
  clientVersion: string;
  log: Logger;
  backoff?: { initialMs: number; maxMs: number };
  heartbeat?: { intervalMs: number; timeoutMs: number };
  ackTimeoutMs?: number;
}

interface PendingAck {
  resolve: (r: { id: string }) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export class CoopetPluginLink implements Link {
  private readonly opts: CoopetPluginOptions;
  private readonly backoff: { initialMs: number; maxMs: number };
  private readonly heartbeat: { intervalMs: number; timeoutMs: number };
  private readonly ackTimeoutMs: number;
  private ws: WebSocket | null = null;
  private current: LinkState = 'closed';
  private running = false;
  private token = '';
  private name: string | undefined;
  private retryMs: number;
  private retryTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  private readonly pending = new Map<string, PendingAck>();
  private readonly messageListeners: Array<(m: IncomingMessage) => void> = [];
  private readonly stateListeners: Array<(s: LinkState, reason?: string) => void> = [];
  private readonly thinkingListeners: Array<(on: boolean) => void> = [];

  constructor(opts: CoopetPluginOptions) {
    this.opts = opts;
    this.backoff = opts.backoff ?? { initialMs: 1000, maxMs: 30_000 };
    this.heartbeat = opts.heartbeat ?? { intervalMs: 30_000, timeoutMs: 10_000 };
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 10_000;
    this.retryMs = this.backoff.initialMs;
  }

  start(): void {
    if (this.running) return;
    try {
      this.token = readFileSync(this.opts.tokenFile, 'utf8').trim();
    } catch (err) {
      this.opts.log.error(`读不到插件 token 文件 ${this.opts.tokenFile}：${(err as NodeJS.ErrnoException).code ?? err}`);
      this.setState('closed', 'token');
      return;
    }
    if (!this.token) {
      this.opts.log.error(`插件 token 文件 ${this.opts.tokenFile} 是空的`);
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
    this.failPending('连接已关闭');
    this.setState('closed', 'stopped');
  }

  state(): LinkState {
    return this.current;
  }

  botName(): string | undefined {
    return this.name;
  }

  send(msg: OutgoingChat): Promise<{ id: string }> {
    const ws = this.ws;
    if (this.current !== 'open' || !ws) return Promise.reject(new Error('还没连上 MaiBot'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.ackTimeoutMs / 1000} 秒内没收到确认`));
      }, this.ackTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'chat', id, text: msg.text }), (err) => {
        if (!err) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      });
    });
  }

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.messageListeners.push(cb);
  }

  onState(cb: (s: LinkState, reason?: string) => void): void {
    this.stateListeners.push(cb);
  }

  onThinking(cb: (on: boolean) => void): void {
    this.thinkingListeners.push(cb);
  }

  /* ---------- 连接 ---------- */

  private connect(): void {
    if (!this.running) return;
    this.setState('connecting');
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;

    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        token: this.token,
        device_id: this.opts.deviceId,
        device_name: this.opts.deviceName,
        client: { name: 'coopet', version: this.opts.clientVersion },
      }));
    });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      this.receive(ws, raw.toString());
    });

    ws.on('pong', () => {
      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = null;
    });

    ws.on('error', (err) => this.opts.log.debug(`连接错误：${err.message}`));

    ws.on('close', (code) => {
      this.stopHeartbeat();
      if (this.ws === ws) this.ws = null;
      this.failPending('连接断开');
      if (!this.running) return;
      const fatal = FATAL_CLOSE[code];
      if (fatal) {
        this.running = false;
        this.opts.log.error(closeHint(fatal));
        this.setState('closed', fatal);
        return;
      }
      this.setState('closed', String(code));
      this.scheduleReconnect();
    });
  }

  private receive(ws: WebSocket, text: string): void {
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('不是对象');
      frame = parsed as Record<string, unknown>;
    } catch {
      this.opts.log.debug('收到无法解析的帧，已丢弃');
      return;
    }
    switch (frame.type) {
      case 'welcome': {
        const bot = frame.bot as { name?: unknown } | undefined;
        this.name = typeof bot?.name === 'string' && bot.name ? bot.name : undefined;
        this.retryMs = this.backoff.initialMs;
        this.startHeartbeat(ws);
        this.setState('open');
        return;
      }
      case 'ack': {
        const id = typeof frame.id === 'string' ? frame.id : '';
        const waiter = this.pending.get(id);
        if (!waiter) return;
        this.pending.delete(id);
        clearTimeout(waiter.timer);
        if (frame.ok === true) {
          waiter.resolve({ id });
        } else {
          const error = frame.error as { code?: unknown; message?: unknown } | undefined;
          waiter.reject(new Error(`${String(error?.code ?? 'error')}：${String(error?.message ?? '')}`));
        }
        return;
      }
      case 'reply': {
        const message: IncomingMessage = {
          ...(typeof frame.id === 'string' && frame.id ? { id: frame.id } : {}),
          parts: toParts(frame.parts),
          receivedAt: Date.now(),
        };
        this.emit(this.messageListeners, message, '处理 MaiBot 消息时出错');
        return;
      }
      case 'thinking':
        if (typeof frame.on === 'boolean') this.emit(this.thinkingListeners, frame.on, '处理思考状态时出错');
        return;
      case 'error':
        this.opts.log.warn(`插件报错：${String(frame.code)} ${String(frame.message ?? '')}`);
        return;
      default:
        this.opts.log.debug(`忽略不认识的消息类型：${String(frame.type)}`);
    }
  }

  private emit<T>(listeners: Array<(v: T) => void>, value: T, what: string): void {
    for (const cb of listeners) {
      try {
        cb(value);
      } catch (err) {
        this.opts.log.error(what, err);
      }
    }
  }

  private failPending(reason: string): void {
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
      this.pending.delete(id);
    }
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
      if (this.pongTimer) return;
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

function closeHint(reason: string): string {
  if (reason === 'auth') return '插件拒绝了 token，不再重连；检查插件 token 文件和 MaiBot 插件设置里的 token';
  if (reason === 'protocol') return '插件不支持这个协议版本，不再重连；请升级客户端或插件';
  return '已被另一台设备顶替，不再重连';
}

/** 协议的 reply.parts → IncomingPart；不认识的 kind 记为 other。 */
export function toParts(raw: unknown): IncomingPart[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((part): IncomingPart[] => {
    if (typeof part !== 'object' || part === null) return [];
    const p = part as Record<string, unknown>;
    if (p.kind === 'text' && typeof p.text === 'string') return [{ kind: 'text', text: p.text }];
    if ((p.kind === 'image' || p.kind === 'emoji') && typeof p.base64 === 'string') return [{ kind: p.kind, base64: p.base64 }];
    return [{ kind: 'other', type: String(p.type ?? p.kind) }];
  });
}
