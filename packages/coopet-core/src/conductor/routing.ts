/**
 * 扩展 World 事件的路由：Conductor 收到扩展 World 推出的事件时，按这里决定说不说、说什么。
 *
 * 扩展 World 是为 Cortico 的模型写的，事件正文多半是给模型的指示（"请总结……调用 pet_say"），
 * 不能原样念。所以认得的事件类型有专门的渲染（RENDERERS），把它说成一句适合气泡的话；
 * 认不得的按路由设置：auto 不处理，pet 念正文开头。
 *
 * 气泡文字先清理：去掉 Markdown 记号，把桌宠脚本会当成动作标记的【】、<>、＜＞ 换成相似的字符。
 */

import type { EventEnvelope } from 'cortico/core/types.ts';
import { baseLanguage, type Language } from 'cortico/core/language.ts';
import type { RouteMode } from '../runtime/config.ts';

/** 一个事件该怎么处理 */
export type RouteDecision = { say: string } | { skip: 'off' | 'no-renderer' | 'empty' };

type Renderer = (e: EventEnvelope, language: Language) => string | null;

const CODING_AGENTS: Record<string, string> = {
  codex: 'Codex', claude: 'Claude Code', opencode: 'OpenCode', dsh: 'DeepSeek Harness', muse: 'Muse Code', agy: 'Antigravity', workbuddy: 'WorkBuddy',
};

/** 结论截到多少字 */
const SUMMARY_CHARS = 60;
/** 没有专门渲染、念正文时最多多少字 */
const GENERIC_CHARS = 80;

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

/** 按路由设置和事件类型决定 */
export function route(e: EventEnvelope, mode: RouteMode, language: Language): RouteDecision {
  if (mode === 'off') return { skip: 'off' };
  const renderer = RENDERERS[e.type];
  let text: string | null;
  if (renderer) text = renderer(e, language);
  else if (mode === 'pet') text = clip(plain(e.text), GENERIC_CHARS);
  else return { skip: 'no-renderer' };
  const said = text ? plain(text) : '';
  return said ? { say: said } : { skip: 'empty' };
}

/** 气泡里的纯文字：去掉 Markdown 记号，换掉会被当成动作标记的括号，压掉多余空白 */
export function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/【/g, '〖').replace(/】/g, '〗')
    .replace(/</g, '‹').replace(/>/g, '›')
    .replace(/＜/g, '﹤').replace(/＞/g, '﹥')
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
