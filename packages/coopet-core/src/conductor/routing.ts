/**
 * 扩展 World 事件的路由：Conductor 收到扩展 World 推出的事件时，按这里决定说不说、说什么。
 *
 * 扩展 World 是为 Cortico 的模型写的，事件正文多半是给模型的指示（"请总结……调用 pet_say"），
 * 不能原样念。所以认得的事件类型有专门的渲染（RENDERERS），把它说成一句适合气泡的话。
 * 每个扩展的路由设置（runtime/config.ts 的 RouteSettings）：
 * - 认得的通知按 mode 送：pet、maibot，或 rule（照事件 meta.route 的去向：pet / maibot / off；扩展没带就按 pet）；
 * - 认不得的通知按 unknown：record 只记录，pet 念正文开头，maibot 交给麦麦（rule 模式下 meta.route 是 off 时也不处理）；
 * - 桌宠念的话（say）截到 maxChars 字；送给麦麦时另有一份 text：不转义、最多 MAIBOT_CHARS 字（maxChars 只管念多长）。
 * 决定送给麦麦时由 Conductor 转给插件（协议 notice）；转不了时用 say 由桌宠说。
 *
 * 文字先清理：去掉 Markdown 记号、压掉多余空白；气泡用的 say 再转义桌宠脚本会当成动作标记的写法（expr/escape.ts）。
 */

import type { EventEnvelope } from 'cortico/core/types.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { RouteSettings } from '../runtime/config.ts';
import { escapeScript } from '../expr/escape.ts';

/** 去向 */
export type Destination = 'pet' | 'maibot';
/** 一个事件该怎么处理 */
export type RouteDecision = { say: string; text: string; to: Destination } | { skip: 'off' | 'rule-off' | 'no-renderer' | 'empty' };

/** 送给麦麦的通知最多多少字（协议上限 2000，这里留得短些，免得一条通知占满她的上下文） */
export const MAIBOT_CHARS = 500;

type Renderer = (e: EventEnvelope, language: Language) => string | null;

const CODING_AGENTS: Record<string, string> = {
  codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', dsh: 'DeepSeek Harness', muse: 'Muse Code', agy: 'Antigravity', workbuddy: 'WorkBuddy',
};

/** 结论截到多少字 */
const SUMMARY_CHARS = 60;

/** 认得的事件类型 → 渲染 */
export const RENDERERS: Readonly<Record<string, Renderer>> = {
  /**
   * cortico-world-coding-agent-notify（ThermalEng）：某个 Coding Agent 完成了一轮任务。
   * meta 里有 agent、workspace、test；最终结论在正文"最终结论："那一行之后。
   */
  'coding-agent.completed': (e, language) => {
    const zh = baseLanguage(language) === 'zh';
    const meta = (e.meta ?? {}) as { agent?: unknown; workspace?: unknown; test?: unknown };
    const agent = typeof meta.agent === 'string' ? CODING_AGENTS[meta.agent] ?? meta.agent : 'Coding Agent';
    if (meta.test === true) return zh ? `${agent} 的完成通知通了` : `${agent} notifications work`;
    const project = typeof meta.workspace === 'string' ? meta.workspace.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '' : '';
    const marker = e.text.indexOf('最终结论：');
    const summary = marker >= 0 ? firstSentence(e.text.slice(marker + '最终结论：'.length), SUMMARY_CHARS) : '';
    const head = zh ? `${agent} 完成了${project ? ` · ${project}` : ''}` : `${agent} finished${project ? ` · ${project}` : ''}`;
    return summary ? `${head}：${summary}` : head;
  },
  /**
   * cortico-world-ntfy（wtxdew）：订阅的 ntfy 话题来了一条通知。meta 里有 label（话题的片段名）、title、message。
   * 说成「片段：标题：内容」，没有标题就「片段：内容」。
   */
  'ntfy.message': (e) => {
    const meta = (e.meta ?? {}) as { label?: unknown; topic?: unknown; title?: unknown; message?: unknown };
    const label = typeof meta.label === 'string' ? meta.label : typeof meta.topic === 'string' ? meta.topic : 'ntfy';
    const message = typeof meta.message === 'string' ? meta.message : '';
    const title = typeof meta.title === 'string' && meta.title ? `${meta.title}：` : '';
    return message || title ? `${label}：${title}${message}` : null;
  },
};

/** 扩展在事件里带的分类去向（rule 模式用） */
function ruleOf(e: EventEnvelope): Destination | 'off' | null {
  const r = (e.meta as { route?: unknown } | undefined)?.route;
  return r === 'pet' || r === 'maibot' || r === 'off' ? r : null;
}

/** 按路由设置和事件类型决定 */
export function route(e: EventEnvelope, settings: RouteSettings, language: Language): RouteDecision {
  if (settings.mode === 'off') return { skip: 'off' };
  const rule = settings.mode === 'rule' ? ruleOf(e) : null;
  if (rule === 'off') return { skip: 'rule-off' };
  const renderer = RENDERERS[e.type];
  let text: string | null;
  let to: Destination;
  if (renderer) {
    text = renderer(e, language);
    to = settings.mode === 'rule' ? rule ?? 'pet' : settings.mode;
  } else {
    if (settings.unknown === 'record') return { skip: 'no-renderer' };
    text = e.text;
    to = settings.unknown;
  }
  const clean = text ? unmark(text) : '';
  if (!clean) return { skip: 'empty' };
  return { say: clip(escapeScript(clean), settings.maxChars), text: clip(clean, MAIBOT_CHARS), to };
}

/** 气泡里的纯文字：去掉 Markdown 记号，压掉多余空白，再转义会被当成动作标记的写法 */
export function plain(text: string): string {
  return escapeScript(unmark(text));
}

/** 去掉 Markdown 记号，压掉多余空白（不转义：送给麦麦的文字用它） */
function unmark(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 第一句（到第一个句号、问号、叹号或换行），再截到 max 字 */
function firstSentence(text: string, max: number): string {
  const cleaned = plain(text.split(/\n\s*\n/)[0] ?? text);
  const m = /^(.+?[。！？!?]|.+?\.(?=\s|$))/.exec(cleaned);
  return clip(m ? m[1] : cleaned, max);
}

function clip(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}
