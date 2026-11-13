/**
 * 把一段要显示的文字转义成桌宠脚本里的纯文字（桌宠的脚本规则见 cortico-world-desktop-pet/src/script.ts）：
 *
 * - `【…】`：只要后面有 `】`，整段被当成"阻塞动作"，里面的字不显示，还会另起一个气泡。
 *   所以 `【` `】` 一律换成相似的 `〖` `〗`。
 * - `<…>`、`＜…＞`：闭合、里面不超过 32 个字、不跨行时，整段被当成"行内动作"吃掉（里面不是动作词也一样）。
 *   只把会被吃掉的那种的开头 `<` / `＜` 换成 `‹` / `﹤`；更长或跨行的本来就照常显示，不动（"a < b" 保持原样）。
 *
 * MaiBot 的回复先转义、再由表情规则（decorate.ts）加上我们自己的动作标记。
 */

/** 和桌宠的 INLINE_TAG_MAX 一致 */
const INLINE_TAG_MAX = 32;

export function escapeScript(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '【') { out += '〖'; continue; }
    if (ch === '】') { out += '〗'; continue; }
    if (ch === '<' || ch === '＜') {
      const end = text.indexOf(ch === '<' ? '>' : '＞', i + 1);
      const inner = end < 0 ? '' : text.slice(i + 1, end);
      const wouldBeTag = end >= 0 && inner.length <= INLINE_TAG_MAX && !/\n/.test(inner);
      out += wouldBeTag ? (ch === '<' ? '‹' : '﹤') : ch;
      continue;
    }
    out += ch;
  }
  return out;
}
