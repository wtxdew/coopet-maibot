/**
 * 被外壳（coopet-app）启动时，和外壳主进程之间的消息通道（Node IPC：process.send / 'message'）。
 * 直接 `corepack pnpm dev` 运行时没有 IPC，connectSupervisor 返回 null，其余代码照常工作。
 *
 * 核心 → 外壳：ready（桌宠页面地址、设置窗后端的端口、界面语言）、language（界面语言改了）、link（连接状态）、
 *              pet（窗口是否在桌面上）、quit（桌宠菜单里点了退出）、open-settings（桌宠菜单里点了设置、装扮等，带页面）、
 *              auto-update（自动更新的开关，启动时和改了时）、update-install（气泡里点了现在重启更新）、releases（打开 Release 页面）
 * 外壳 → 核心：show-pet、hide-pet、toggle-pet（由核心按桌宠的实时状态决定显示还是隐藏）、click-through（托盘的鼠标穿透）、shutdown、
 *              update（更新器的一步，或 null：更新被取消；runtime/updates.ts 在气泡里说）
 *
 * 设置窗不走这里：它直接和核心里的设置窗后端（Cortico WebApp，webui/surface.ts）说话。
 */

export type ToShell =
  | { type: 'ready'; petOrigin: string; webPort: number; language: string }
  | { type: 'language'; language: string }
  | { type: 'link'; kind: string; state: string; reason?: string; botName?: string }
  | { type: 'pet'; onDesktop: boolean }
  | { type: 'quit' }
  /** route：设置窗的页面，例如 `#/dress`；不给时打开上次的页面 */
  | { type: 'open-settings'; route?: string }
  | { type: 'auto-update'; enabled: boolean }
  | { type: 'update-install' }
  | { type: 'releases' };

export type FromShell =
  | { type: 'show-pet' }
  | { type: 'hide-pet' }
  | { type: 'toggle-pet' }
  /** 托盘的「鼠标穿透」：点击都穿过桌宠；只在这次运行有效，核心重启后外壳会再发一次 */
  | { type: 'click-through'; on: boolean }
  | { type: 'shutdown' }
  | { type: 'update'; step: unknown };

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

/** 收得下的外壳消息。写成以 FromShell 的 type 为键的表：FromShell 加了新类型而这里漏写，类型检查就会报错 */
const FROM_SHELL: Readonly<Record<FromShell['type'], true>> = { 'show-pet': true, 'hide-pet': true, 'toggle-pet': true, 'click-through': true, shutdown: true, update: true };

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
        if (typeof type === 'string' && Object.hasOwn(FROM_SHELL, type)) cb(raw as FromShell);
      });
    },
    onDisconnect(cb) {
      proc.on('disconnect', cb);
    },
  };
}
