import { describe, expect, it } from 'vitest';
import { createDecorator } from '../src/expr/decorate.ts';
import { DEFAULT_INLINE_RULES, DEFAULT_LEAD_RULES } from '../src/expr/rules.ts';

const decorate = createDecorator();

describe('E1 decorate', () => {
  it.each([
    // emoji
    ['今天好开心😂', '<happy>今天好开心😂'],
    ['呜😭', '<cry>呜😭'],
    ['爱你❤️', '<love>爱你❤️'],
    ['让我想想🤔', '<thinking>让我想想🤔'],
    // 颜文字
    ['被发现了>_<', '<flustered>被发现了>_<'],
    ['QAQ 主人不理我', '<cry>QAQ 主人不理我'],
    ['(￣▽￣)', '<smug>(￣▽￣)'],
    // 关键词
    ['哈哈哈你又熬夜了？', '<happy>哈哈哈你又熬夜了？'],
    ['哼，不理你了', '<pout>哼，不理你了'],
    ['晚安~', '<sleepy>晚安~'],
    ['加油！', '<determined>加油！'],
    ['什么？真的吗', '<surprised>什么？真的吗'],
    ['好耶！终于周末了', '<excited>好耶<flap>！终于周末了'],
    ['你好呀主人', '<happy>你好<wave>呀主人'],
    ['谢谢主人', '<happy>谢谢<bow>主人'],
    // 句中动作
    ['好的主人，马上', '好的<nod>主人，马上'],
    ['不行，太晚了', '不行<shake>，太晚了'],
    // 句末标点
    ['今天吃了什么?', '<confused>今天吃了什么?'],
    ['冲冲冲！！', '<excited>冲冲冲！！'],
    // 不命中
    ['今天吃了什么', '今天吃了什么'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(decorate(input)).toBe(expected);
  });

  it('prefers emoji over keywords and keywords over punctuation', () => {
    expect(decorate('哈哈😭')).toBe('<cry>哈哈😭');
    expect(decorate('哈哈是吗？')).toBe('<happy>哈哈是吗？');
  });

  it('adds at most one inline motion, the earliest one', () => {
    expect(decorate('不是，好的好的')).toBe('不是<shake>，好的好的');
    expect(decorate('嗯嗯，不要')).toBe('嗯嗯<nod>，不要');
  });

  it('lets a lead rule motion win over inline keywords', () => {
    expect(decorate('好的，谢谢')).toBe('<happy>好的，谢谢<bow>');
  });

  it('uses only ascii angle-bracket markers', () => {
    const samples = ['好耶！', '谢谢', '呜😭', '好的', '是吗？', '冲！！'];
    for (const s of samples) expect(decorate(s)).not.toMatch(/[【】＜＞]/);
  });

  it('only uses ids from the shared Coo/whale vocabulary', () => {
    const vocab = new Set(['neutral', 'happy', 'wink', 'love', 'shy', 'surprised', 'angry', 'sad', 'sleepy', 'thinking', 'smug', 'pout', 'worried', 'determined', 'flustered', 'scared', 'excited', 'cry', 'confused',
      'stand', 'jump', 'hop', 'look', 'turn', 'nod', 'shake', 'spin', 'sit', 'sleep', 'dizzy', 'walk', 'run', 'wave', 'bow', 'shiver', 'flap', 'dance']);
    for (const r of DEFAULT_LEAD_RULES) {
      expect(vocab.has(r.lead)).toBe(true);
      if (r.inline) expect(vocab.has(r.inline)).toBe(true);
    }
    for (const r of DEFAULT_INLINE_RULES) expect(vocab.has(r.inline)).toBe(true);
  });
});
