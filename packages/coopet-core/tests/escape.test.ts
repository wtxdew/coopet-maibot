import { describe, expect, it } from 'vitest';
import { parseScript } from '../../cortico-world-desktop-pet/src/script.ts';
import { escapeScript } from '../src/expr/escape.ts';

/** 桌宠实际显示出来的文字（不管动作） */
const shown = (script: string) => parseScript(script, []).beats.map((b) => b.text).join('|');

describe('escapeScript', () => {
  it('keeps text the pet would eat as markers', () => {
    const reply = '好呀【开心】我在<看书>呢，＜嘿嘿＞';
    expect(shown(reply)).toBe('好呀|我在呢，');
    expect(shown(escapeScript(reply))).toBe('好呀〖开心〗我在‹看书>呢，﹤嘿嘿＞');
    // 比较符号成对出现、中间不长时，桌宠也会把它吃掉
    expect(shown('a < b and c > d')).toBe('a  d');
    expect(shown(escapeScript('a < b and c > d'))).toBe('a ‹ b and c > d');
  });

  it('leaves unclosed, long or multi-line angle text alone, as the pet shows it anyway', () => {
    for (const text of ['a < b', 'x > 3', `<${'x'.repeat(33)}>`, '<第一行\n第二行>', '只有开头 <']) {
      expect(escapeScript(text)).toBe(text);
      expect(shown(escapeScript(text))).toBe(shown(text));
    }
  });

  it('is safe to run twice', () => {
    const once = escapeScript('【a】<b>＜c＞');
    expect(escapeScript(once)).toBe(once);
  });
});
