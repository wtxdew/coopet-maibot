/**
 * 扩展 World 事件的路由：Conductor 收到扩展 World 推出的事件时，按这里决定说不说、说什么。
 *
 * 扩展 World 是为 Cortico 的模型写的，事件正文多半是给模型的指示（"请总结……调用 pet_say"），
 * 不能原样念。所以认得的事件类型有专门的渲染（RENDERERS），把它说成一句适合气泡的话。
 * 每个扩展的路由设置（runtime/config.ts 的 RouteSettings）：
 * - 认得的通知按 mode 送：pet、maibot，或 rule（照事件 meta.route 的去向：pet / maibot / off；扩展没带就按 pet）；
 * - 认不得的通知按 unknown：record 只记录，pet 念正文开头，maibot 交给麦麦（rule 模式下 meta.route 是 off 时也不处理）；
 * - 说出来的话截到 maxChars 字。
 * 决定送给麦麦时由 Conductor 处理（现在先由桌宠说）。
 *
 * 气泡文字先清理：去掉 Markdown 记号，再转义桌宠脚本会当成动作标记的写法（expr/escape.ts）。
 */

import type { EventEnvelope } from 'cortico/core/types.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { RouteSettings } from '../runtime/config.ts';
import { escapeScript } from '../expr/escape.ts';

/** 去向 */
export type Destination = 'pet' | 'maibot';
/** 一个事件该怎么处理 */
export type RouteDecision = { say: string; to: Destination } | { skip: 'off' | 'rule-off' | 'no-renderer' | 'empty' };

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
  const said = text ? clip(plain(text), settings.maxChars) : '';
  return said ? { say: said, to } : { skip: 'empty' };
}

/** 气泡里的纯文字：去掉 Markdown 记号，压掉多余空白，再转义会被当成动作标记的写法 */
export function plain(text: string): string {
  return escapeScript(text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim());
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
