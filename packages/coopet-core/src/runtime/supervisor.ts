/**
 * 被外壳（coopet-app）启动时，和外壳主进程之间的消息通道（Node IPC：process.send / 'message'）。
 * 直接 `corepack pnpm dev` 运行时没有 IPC，connectSupervisor 返回 null，其余代码照常工作。
 *
 * 核心 → 外壳：ready（桌宠页面地址、设置窗后端的端口、界面语言）、language（界面语言改了）、link（连接状态）、pet（窗口是否在桌面上）、quit（桌宠菜单里点了退出）、
 *              open-settings（桌宠菜单里点了设置）、response（对请求的回复）、chat-data / chat-closed（对话流）
 * 外壳 → 核心：show-pet、hide-pet、toggle-pet（由核心按桌宠的实时状态决定显示还是隐藏）、shutdown、
 *              request（配置窗的请求，带 id）、chat-open / chat-message / chat-close（对话流，带 streamId）
 */

export type ToShell =
  | { type: 'ready'; petOrigin: string; webPort: number; language: string }
  | { type: 'language'; language: string }
  | { type: 'link'; kind: string; state: string; reason?: string; botName?: string }
  | { type: 'pet'; onDesktop: boolean }
  | { type: 'quit' }
  | { type: 'open-settings' }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string }
  | { type: 'chat-data'; streamId: number; data: string }
  | { type: 'chat-closed'; streamId: number };

export type FromShell =
  | { type: 'show-pet' }
  | { type: 'hide-pet' }
  | { type: 'toggle-pet' }
  | { type: 'shutdown' }
  | { type: 'request'; id: number; method: string; params: unknown }
  | { type: 'chat-open'; streamId: number }
  | { type: 'chat-message'; streamId: number; text: string }
  | { type: 'chat-close'; streamId: number };

export type RequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;

export interface Supervisor {
  send(message: ToShell): void;
  onMessage(cb: (message: FromShell) => void): void;
  /** 处理外壳的请求；返回值作为回复，抛错时回复错误说明 */
  onRequest(handler: RequestHandler): void;
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

const FROM_SHELL = new Set(['show-pet', 'hide-pet', 'toggle-pet', 'shutdown', 'chat-open', 'chat-message', 'chat-close']);

export function connectSupervisor(proc: IpcProcess = process as unknown as IpcProcess): Supervisor | null {
  if (typeof proc.send !== 'function') return null;
  const send = (message: ToShell): void => {
    if (proc.connected !== false) proc.send?.(message);
  };
  return {
    send,
    onMessage(cb) {
      proc.on('message', (raw) => {
        const type = (raw as { type?: unknown } | null)?.type;
        if (typeof type === 'string' && FROM_SHELL.has(type)) cb(raw as FromShell);
      });
    },
    onRequest(handler) {
      proc.on('message', (raw) => {
        const m = raw as { type?: unknown; id?: unknown; method?: unknown; params?: unknown } | null;
        if (m?.type !== 'request' || typeof m.id !== 'number' || typeof m.method !== 'string') return;
        const id = m.id;
        Promise.resolve()
          .then(() => handler(m.method as string, m.params))
          .then(
            (result) => send({ type: 'response', id, ok: true, result }),
            (err: unknown) => send({ type: 'response', id, ok: false, error: err instanceof Error ? err.message : String(err) }),
          );
      });
    },
    onDisconnect(cb) {
      proc.on('disconnect', cb);
    },
  };
}
