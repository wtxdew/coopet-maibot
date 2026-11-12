/**
 * 被外壳（coopet-app）启动时，和外壳主进程之间的消息通道（Node IPC：process.send / 'message'）。
 * 直接 `corepack pnpm dev` 运行时没有 IPC，connectSupervisor 返回 null，其余代码照常工作。
 *
 * 核心 → 外壳：ready（桌宠页面地址）、link（连接状态）、pet（窗口是否在桌面上）、quit（桌宠菜单里点了退出）
 * 外壳 → 核心：show-pet、hide-pet、toggle-pet（由核心按桌宠的实时状态决定显示还是隐藏）、shutdown
 */

export type ToShell =
  | { type: 'ready'; petOrigin: string }
  | { type: 'link'; kind: string; state: string; reason?: string; botName?: string }
  | { type: 'pet'; onDesktop: boolean }
  | { type: 'quit' };

export type FromShell = { type: 'show-pet' } | { type: 'hide-pet' } | { type: 'toggle-pet' } | { type: 'shutdown' };

export interface Supervisor {
  send(message: ToShell): void;
  onMessage(cb: (message: FromShell) => void): void;
  /** 外壳断开（主进程没了）时调用 */
  onDisconnect(cb: () => void): void;
}

/** 只用到 process 的这几个成员，测试时可以传假的。 */
export interface IpcProcess {
  send?: (message: unknown) => boolean;
  connected?: boolean;
  on(event: 'message', cb: (message: unknown) => void): unknown;
  on(event: 'disconnect', cb: () => void): unknown;
}

const FROM_SHELL = new Set(['show-pet', 'hide-pet', 'toggle-pet', 'shutdown']);

export function connectSupervisor(proc: IpcProcess = process as unknown as IpcProcess): Supervisor | null {
  if (typeof proc.send !== 'function') return null;
  return {
    send(message) {
      if (proc.connected !== false) proc.send?.(message);
    },
    onMessage(cb) {
      proc.on('message', (raw) => {
        const type = (raw as { type?: unknown } | null)?.type;
        if (typeof type === 'string' && FROM_SHELL.has(type)) cb(raw as FromShell);
      });
    },
    onDisconnect(cb) {
      proc.on('disconnect', cb);
    },
  };
}
