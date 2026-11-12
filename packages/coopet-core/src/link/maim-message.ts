/**
 * maim_message 旧版协议的消息结构与组包（对应 maim_message 0.6.8 的 message_base.py），
 * 加上 MaiBot 1.4.x 的顶层路由扩展。不依赖网络，scripts/maim-ping.ts 和 link 都用它。
 */

import { randomUUID } from 'node:crypto';

export interface Seg {
  type: string;
  data: string | Seg[];
}

export interface UserInfo {
  platform?: string;
  user_id?: string;
  user_nickname?: string;
  user_cardname?: string;
}

export interface GroupInfo {
  platform?: string;
  group_id?: string;
  group_name?: string;
}

export interface FormatInfo {
  content_format?: string[];
  accept_format?: string[];
}

export interface BaseMessageInfo {
  platform?: string;
  message_id?: string;
  /** Unix 时间，单位秒 */
  time?: number;
  group_info?: GroupInfo;
  user_info?: UserInfo;
  format_info?: FormatInfo;
  additional_config?: Record<string, unknown>;
}

export interface MessageBase {
  message_info: BaseMessageInfo;
  message_segment: Seg;
  raw_message?: string | null;
}

/**
 * MaiBot 1.4.x 对入站消息的扩展：顶层路由归属字段（不属于 maim_message）。
 * account_id 是 Bot 在该平台上的账号，MaiBot 用它作为回复的发送身份；
 * 缺少时会走旧版归属解析并告警，且平台未在 bot.platforms 登记时无法回复。
 * 见 MaiBot src/platform_io/route_key_factory.py `from_message_dict`。
 */
export type MaiBotInbound = MessageBase & {
  /** 必须是字符串 */
  account_id?: string;
  /** 路由作用域；私聊为 null */
  scope?: string | null;
};

export interface TextMessageInput {
  platform: string;
  /** Bot 在该平台上的账号 */
  botAccount: string;
  user: { id: string; nickname: string };
  text: string;
}

/** 一条私聊文字消息；message_id 为 `<platform>-<uuid>`。 */
export function buildTextMessage(input: TextMessageInput): MaiBotInbound {
  const { platform } = input;
  return {
    account_id: input.botAccount,
    scope: null,
    message_info: {
      platform,
      message_id: `${platform}-${randomUUID()}`,
      time: Date.now() / 1000,
      user_info: { platform, user_id: input.user.id, user_nickname: input.user.nickname },
      format_info: { content_format: ['text'], accept_format: ['text'] },
      additional_config: {},
    },
    message_segment: { type: 'seglist', data: [{ type: 'text', data: input.text }] },
    raw_message: null,
  };
}

export function isMessageBase(value: unknown): value is MessageBase {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.message_info === 'object' && v.message_info !== null
    && typeof v.message_segment === 'object' && v.message_segment !== null;
}

/** 把消息段树里的 text 段按顺序拼起来；其他类型的段写成 [type]。 */
export function flattenText(seg: Seg): string {
  if (Array.isArray(seg.data)) return seg.data.map(flattenText).join('');
  return seg.type === 'text' ? String(seg.data) : `[${seg.type}]`;
}
