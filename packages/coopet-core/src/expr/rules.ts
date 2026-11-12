/**
 * 表情规则 E1 的默认规则表（阶段 3 再放进配置窗）。
 *
 * 标记一律写成英文尖括号 `<id>`：句首的 `<id>` 在气泡开始打字时立刻做，句中的打字打到那里时做。
 * 不用全角的 `【】`，免得和回复文字里的全角符号混在一起。id 是 Coo 和鲸娘共用的词表 id
 * （web/coo/figure.json、web/whale/figure.json），导入的形象不认识的词会被桌宠丢掉。
 *
 * 只用表情和短动作；walk/run（12 秒）、sit/sleep（一直保持）、look/dizzy（偏长）不用。
 */

/** 句首表情的信号来源；按这个顺序找，第一个命中的生效。 */
export type LeadKind = 'emoji' | 'kaomoji' | 'keyword' | 'punct';

export interface LeadRule {
  kind: LeadKind;
  /** 字符串：包含即命中；正则：exec 命中 */
  match: readonly string[] | RegExp;
  /** 句首表情或动作的 id */
  lead: string;
  /** 同时在命中的词后面插入的动作 id */
  inline?: string;
}

export interface InlineRule {
  match: readonly string[];
  /** 插在命中的词后面的动作 id */
  inline: string;
}

export const LEAD_KIND_ORDER: readonly LeadKind[] = ['emoji', 'kaomoji', 'keyword', 'punct'];

export const DEFAULT_LEAD_RULES: readonly LeadRule[] = [
  // emoji
  { kind: 'emoji', match: ['😂', '😄', '😊', '😆', '😁'], lead: 'happy' },
  { kind: 'emoji', match: ['😭'], lead: 'cry' },
  { kind: 'emoji', match: ['😢', '😞'], lead: 'sad' },
  { kind: 'emoji', match: ['😡', '😠'], lead: 'angry' },
  { kind: 'emoji', match: ['❤', '🥰', '😍', '💕'], lead: 'love' },
  { kind: 'emoji', match: ['😳'], lead: 'shy' },
  { kind: 'emoji', match: ['🤔'], lead: 'thinking' },
  { kind: 'emoji', match: ['😴', '💤'], lead: 'sleepy' },
  { kind: 'emoji', match: ['😮', '😲'], lead: 'surprised' },
  { kind: 'emoji', match: ['🥺'], lead: 'worried' },
  // 颜文字
  { kind: 'kaomoji', match: ['QAQ', 'T_T', 'TAT', '呜呜'], lead: 'cry' },
  { kind: 'kaomoji', match: ['>_<', '＞﹏＜', '>﹏<'], lead: 'flustered' },
  { kind: 'kaomoji', match: ['^_^', '^^', '≧▽≦'], lead: 'happy' },
  { kind: 'kaomoji', match: ['￣▽￣'], lead: 'smug' },
  // 关键词
  { kind: 'keyword', match: ['好耶', '太好了', '太棒'], lead: 'excited', inline: 'flap' },
  { kind: 'keyword', match: ['哈哈', '嘻嘻'], lead: 'happy' },
  { kind: 'keyword', match: ['嘿嘿', '得意'], lead: 'smug' },
  { kind: 'keyword', match: ['哼', '才不'], lead: 'pout' },
  { kind: 'keyword', match: ['生气', '气死'], lead: 'angry' },
  { kind: 'keyword', match: ['难过', '伤心'], lead: 'sad' },
  { kind: 'keyword', match: ['害羞', '脸红'], lead: 'shy' },
  { kind: 'keyword', match: ['喜欢你', '爱你'], lead: 'love' },
  { kind: 'keyword', match: ['担心', '小心'], lead: 'worried' },
  { kind: 'keyword', match: ['加油'], lead: 'determined' },
  { kind: 'keyword', match: ['晚安', '好困'], lead: 'sleepy' },
  // 只认句首的「啊？」「什么？」：句尾的「吃了什么？」是普通提问，交给句末标点
  { kind: 'keyword', match: /^\s*(啊|什么)[？?]|诶/, lead: 'surprised' },
  { kind: 'keyword', match: ['你好', '早呀', '早安', '嗨'], lead: 'happy', inline: 'wave' },
  { kind: 'keyword', match: ['谢谢'], lead: 'happy', inline: 'bow' },
  // 句末标点（前面都没命中时）
  { kind: 'punct', match: /[？?]\s*$/, lead: 'confused' },
  { kind: 'punct', match: /[!！]{2,}\s*$/, lead: 'excited' },
];

export const DEFAULT_INLINE_RULES: readonly InlineRule[] = [
  { match: ['嗯嗯', '好的', '对呀', '没错'], inline: 'nod' },
  { match: ['不行', '不要', '不是'], inline: 'shake' },
];
