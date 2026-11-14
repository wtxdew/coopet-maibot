/**
 * 与 MaiBot 的连接接口。Conductor 只依赖这里，不知道协议细节；
 * 阶段 1 用 maim_message 旧版实现，阶段 2 换成插件协议的实现。
 */

export type LinkState = 'connecting' | 'open' | 'closed';

/** 发给 MaiBot 的一条聊天；阶段 1 只发文字。 */
export interface OutgoingChat {
  text: string;
}

/**
 * 转给麦麦的一条通知（扩展的通知设成「交给麦麦」时）。插件 0.2.0 起支持（协议 notice），
 * 插件把它作为主人私聊里的通知消息交给 MaiBot，由她决定要不要说。
 */
export interface OutgoingNotice {
  /** 通知从哪来（扩展名），最多 64 字 */
  source: string;
  /** 通知内容，最多 2000 字 */
  text: string;
  title?: string;
}

export type IncomingPart =
  | { kind: 'text'; text: string }
  /** MaiBot 发图片、表情包时，内容是 base64 */
  | { kind: 'image' | 'emoji'; base64: string }
  /** voice、file、at、reply、forward 等，阶段 1 不处理 */
  | { kind: 'other'; type: string };

export interface IncomingMessage {
  /** MaiBot 给的消息 id，可能没有 */
  id?: string;
  parts: IncomingPart[];
  /** 收到时刻，Unix 毫秒 */
  receivedAt: number;
}

export interface Link {
  /** 开始连接；断线后自动重连（认证失败除外） */
  start(): void;
  /** 断开并停止重连 */
  stop(): Promise<void>;
  state(): LinkState;
  /** 没连上时直接 reject，不排队、不补发 */
  send(msg: OutgoingChat): Promise<{ id: string }>;
  onMessage(cb: (m: IncomingMessage) => void): void;
  /** 状态变化；closed 时 reason 说明原因，例如 'auth'、'token'、'stopped' 或关闭码 */
  onState(cb: (s: LinkState, reason?: string) => void): void;
  /**
   * MaiBot 的真实思考信号（插件协议有，maim_message 没有）。
   * 提供了这个方法，Conductor 就用它驱动"思考中"，不再自己估计。
   */
  onThinking?(cb: (on: boolean) => void): void;
  /**
   * 现在有没有真实的思考信号。可替换的连接（link/switch.ts）总是有 onThinking，
   * 由它说明里面的连接到底有没有；没有这个方法时按"有没有 onThinking"判断。
   */
  hasThinking?(): boolean;
  /** 连上后 MaiBot 设置里的 Bot 名字（插件在握手时下发）；不知道时为 undefined */
  botName?(): string | undefined;
  /** 现在能不能转通知给麦麦：连着、而且插件支持（welcome.features 里有 notice）。没有这个方法当作不能 */
  supportsNotice?(): boolean;
  /** 转一条通知给麦麦，等插件确认收下；不能转时直接 reject */
  notice?(n: OutgoingNotice): Promise<{ id: string }>;
}
