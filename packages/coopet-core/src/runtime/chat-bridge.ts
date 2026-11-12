/**
 * 把桌宠的对话数据流（world.webUi().stream('chat', socket)，src/chat.ts）接到外壳。
 * 外壳每开一个对话页就给一个 streamId；这里为每个 streamId 造一个 WorldStreamSocket 交给桌宠，
 * 桌宠发出的数据经 IPC 原样转给外壳，外壳发来的数据（hello、more 等）原样交给桌宠。
 */

import type { WorldStreamSocket } from 'cortico/core/types.ts';
import type { ToShell } from './supervisor.ts';

interface BridgeSocket extends WorldStreamSocket {
  deliver(text: string): void;
  shutdown(): void;
}

export class ChatBridge {
  private readonly sockets = new Map<number, BridgeSocket>();

  constructor(
    private readonly openStream: (socket: WorldStreamSocket) => void,
    private readonly send: (message: ToShell) => void,
  ) {}

  open(streamId: number): void {
    this.close(streamId);
    const messageCbs: Array<(text: string) => void> = [];
    const closeCbs: Array<() => void> = [];
    let open = true;
    const finish = (notifyShell: boolean): void => {
      if (!open) return;
      open = false;
      this.sockets.delete(streamId);
      for (const cb of closeCbs) cb();
      if (notifyShell) this.send({ type: 'chat-closed', streamId });
    };
    const socket: BridgeSocket = {
      send: (data) => { if (open) this.send({ type: 'chat-data', streamId, data }); },
      close: () => finish(true),
      onMessage: (cb) => { messageCbs.push(cb); },
      onClose: (cb) => { closeCbs.push(cb); },
      get open() { return open; },
      deliver: (text) => { if (open) for (const cb of messageCbs) cb(text); },
      shutdown: () => finish(false),
    };
    this.sockets.set(streamId, socket);
    this.openStream(socket);
  }

  message(streamId: number, text: string): void {
    this.sockets.get(streamId)?.deliver(text);
  }

  /** 外壳那边关了：通知桌宠，不再回传 chat-closed */
  close(streamId: number): void {
    this.sockets.get(streamId)?.shutdown();
  }

  closeAll(): void {
    for (const id of [...this.sockets.keys()]) this.close(id);
  }
}
