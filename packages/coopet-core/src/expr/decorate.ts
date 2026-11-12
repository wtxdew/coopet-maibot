/**
 * 表情规则 E1：按规则给麦麦的一条回复加上桌宠的动作标记，不调用 LLM。
 *
 * - 句首表情最多 1 个：按 emoji → 颜文字 → 关键词 → 句末标点的顺序，同类里按规则顺序，第一个命中的生效；
 *   都没命中就不加。
 * - 句中动作最多 1 个：句首规则自带的动作优先，插在它命中的词后面；否则取最早出现的动作关键词。
 *
 * 纯函数：同样的输入永远得到同样的输出。
 */

import {
  DEFAULT_INLINE_RULES,
  DEFAULT_LEAD_RULES,
  LEAD_KIND_ORDER,
  type InlineRule,
  type LeadRule,
} from './rules.ts';

interface Hit {
  /** 命中的词结束的位置（不含） */
  end: number;
}

export function createDecorator(
  leadRules: readonly LeadRule[] = DEFAULT_LEAD_RULES,
  inlineRules: readonly InlineRule[] = DEFAULT_INLINE_RULES,
): (text: string) => string {
  return (text) => {
    let lead: { rule: LeadRule; hit: Hit } | null = null;
    for (const kind of LEAD_KIND_ORDER) {
      for (const rule of leadRules) {
        if (rule.kind !== kind) continue;
        const hit = find(text, rule.match);
        if (hit) { lead = { rule, hit }; break; }
      }
      if (lead) break;
    }

    let inline: { id: string; at: number } | null = null;
    if (lead?.rule.inline) {
      inline = { id: lead.rule.inline, at: lead.hit.end };
    } else {
      for (const rule of inlineRules) {
        const hit = find(text, rule.match);
        if (hit && (!inline || hit.end < inline.at)) inline = { id: rule.inline, at: hit.end };
      }
    }

    const body = inline ? `${text.slice(0, inline.at)}<${inline.id}>${text.slice(inline.at)}` : text;
    return lead ? `<${lead.rule.lead}>${body}` : body;
  };
}

/** 最早出现的命中；字符串列表里取出现位置最早的那个。 */
function find(text: string, match: readonly string[] | RegExp): Hit | null {
  if (match instanceof RegExp) {
    const m = new RegExp(match.source, match.flags.replace('g', '')).exec(text);
    return m ? { end: m.index + m[0].length } : null;
  }
  let best: Hit | null = null;
  let bestAt = Infinity;
  for (const word of match) {
    const at = text.indexOf(word);
    if (at >= 0 && at < bestAt) { bestAt = at; best = { end: at + word.length }; }
  }
  return best;
}
