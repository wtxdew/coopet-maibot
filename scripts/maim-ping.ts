/**
 * maim_message 旧版 WS 连通性测试。
 *
 * 连上 MaiBot 的 /maim/{bot_id}/ws，发一条消息，打印 MaiBot 的回复后断开。
 * 默认发 `/list chat`：测试账号没有管理权限，MaiBot 会直接回"没有权限"的提示，
 * 不进入 Maisaka/planner，也不调用 LLM。
 *
 * 用法：corepack pnpm exec tsx scripts/maim-ping.ts [--url <ws-url>] [--text <文本>] [--timeout <秒>]
 * token 从 ~/.config/coopet/token 读取，不会打印。
 *
 * 退出码：0 收到回复；1 认证被拒或连接失败；2 超时；3 其他错误。
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import WebSocket from 'ws';

// ---- maim_message 0.6.8 的消息结构（对应 maim_message/message_base.py） ----

interface Seg {
  type: string;
  data: string | Seg[];
}

interface UserInfo {
  platform?: string;
  user_id?: string;
  user_nickname?: string;
  user_cardname?: string;
}

interface GroupInfo {
  platform?: string;
  group_id?: string;
  group_name?: string;
}

interface FormatInfo {
  content_format?: string[];
  accept_format?: string[];
}

interface BaseMessageInfo {
  platform?: string;
  message_id?: string;
  /** Unix 时间，单位秒 */
  time?: number;
  group_info?: GroupInfo;
  user_info?: UserInfo;
  format_info?: FormatInfo;
  additional_config?: Record<string, unknown>;
}

interface MessageBase {
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
type MaiBotInbound = MessageBase & {
  /** 必须是字符串 */
  account_id?: string;
  /** 路由作用域；私聊为 null */
  scope?: string | null;
};

// ---- 参数 ----

const DEFAULT_URL = 'ws://<NAS_IP>:18001/maim/<BOT_ID>/ws';
const PLATFORM = 'coopet';
const TEST_USER = 'coopet-smoke';
/** 麦麦在 coopet 平台上的账号 */
const BOT_ACCOUNT = 'coopet-maibot';
const TOKEN_FILE = join(homedir(), '.config', 'coopet', 'token');

const EXIT_OK = 0;
const EXIT_CONNECT = 1;
const EXIT_TIMEOUT = 2;
const EXIT_OTHER = 3;

const { values: args } = parseArgs({
  options: {
    url: { type: 'string', default: DEFAULT_URL },
    text: { type: 'string', default: '/list chat' },
    timeout: { type: 'string', default: '10' },
  },
});

const timeoutSec = Number(args.timeout);
if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
  console.error(`--timeout 必须是正数，收到：${args.timeout}`);
  process.exit(EXIT_OTHER);
}

function readToken(): string {
  let token: string;
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch (err) {
    console.error(`读不到 token 文件 ${TOKEN_FILE}：${(err as NodeJS.ErrnoException).code ?? err}`);
    process.exit(EXIT_OTHER);
  }
  if (!token) {
    console.error(`token 文件 ${TOKEN_FILE} 是空的`);
    process.exit(EXIT_OTHER);
  }
  return token;
}

// ---- 组包与解析 ----

function buildTextMessage(text: string): MaiBotInbound {
  return {
    account_id: BOT_ACCOUNT,
    scope: null,
    message_info: {
      platform: PLATFORM,
      message_id: `${PLATFORM}-${randomUUID()}`,
      time: Date.now() / 1000,
      user_info: { platform: PLATFORM, user_id: TEST_USER, user_nickname: TEST_USER },
      format_info: { content_format: ['text'], accept_format: ['text'] },
      additional_config: {},
    },
    message_segment: { type: 'seglist', data: [{ type: 'text', data: text }] },
    raw_message: null,
  };
}

function isMessageBase(value: unknown): value is MessageBase {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.message_info === 'object' && typeof v.message_segment === 'object';
}

/** 把消息段树里的 text 段按顺序拼起来；其他类型的段写成 [type]。 */
function flattenText(seg: Seg): string {
  if (Array.isArray(seg.data)) return seg.data.map(flattenText).join('');
  return seg.type === 'text' ? String(seg.data) : `[${seg.type}]`;
}

// ---- 主流程 ----

const token = readToken();
console.log(`→ 连接 ${args.url}（platform=${PLATFORM}）`);

const ws = new WebSocket(args.url, {
  headers: { platform: PLATFORM, Authorization: token },
});

let exitCode = EXIT_TIMEOUT;
let opened = false;

const timer = setTimeout(() => {
  console.error(`× ${timeoutSec} 秒内没有收到回复`);
  exitCode = EXIT_TIMEOUT;
  ws.terminate();
}, timeoutSec * 1000);

ws.on('open', () => {
  opened = true;
  console.log('✓ 已连接，token 认证通过');
  const message = buildTextMessage(args.text);
  ws.send(JSON.stringify(message));
  console.log(`→ 已发送 message_id=${message.message_info.message_id} 文本=${JSON.stringify(args.text)}`);
});

ws.on('message', (raw) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString());
  } catch (err) {
    console.error(`× 收到无法解析的帧：${(err as Error).message}`);
    exitCode = EXIT_OTHER;
    clearTimeout(timer);
    ws.close(1000);
    return;
  }
  if (isMessageBase(parsed)) {
    console.log(`← 回复：${flattenText(parsed.message_segment)}`);
    exitCode = EXIT_OK;
    clearTimeout(timer);
    ws.close(1000);
    return;
  }
  // 不是普通消息（例如自定义消息），只打印类型和字段名，继续等回复
  const keys = typeof parsed === 'object' && parsed !== null ? Object.keys(parsed).join(', ') : typeof parsed;
  const type = (parsed as { type?: unknown } | null)?.type;
  console.log(`← 其他帧：type=${String(type ?? '?')} 字段=[${keys}]`);
});

ws.on('unexpected-response', (_req, res) => {
  console.error(`× 握手被拒：HTTP ${res.statusCode} ${res.statusMessage ?? ''}`);
  exitCode = EXIT_CONNECT;
  clearTimeout(timer);
  ws.terminate();
});

ws.on('error', (err) => {
  // 握手失败等情况；具体原因随后在 close 里体现
  if (!opened) exitCode = EXIT_CONNECT;
  else if (exitCode !== EXIT_OK) exitCode = EXIT_OTHER;
  console.error(`× 连接错误：${err.message}`);
});

ws.on('close', (code, reason) => {
  clearTimeout(timer);
  const why = reason.toString() || '无';
  console.log(`· 连接关闭 code=${code} reason=${why}`);
  if (code === 1008) exitCode = EXIT_CONNECT; // 服务端：无效的令牌
  process.exit(exitCode);
});
