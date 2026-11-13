/**
 * Coopet 的字标（标题栏的版本号和更新状态在 release.ts）。
 *
 * 字标照 Coopanion 的 "Coopanion" 字标（console/branding.ts）画：同样是线宽 16、圆头的笔画，
 * 同样的坐标系（x 高 86–134，圆半径 24，字距 31）。前三笔 C、o、o 和 p 照抄原字标，e 和 t 是新画的。
 * 子元素顺序和原字标一致（C、o、o、其余），rail/brand.ts 靠这个顺序做侧边栏折叠时的动画。
 * 宽度比原字标窄，侧边栏里的尺寸在 coopet.css 里按同样的比例改。
 */

const P_STEM = 260.698484809835;
const E_CX = 363.698484809835;
const T_X = 418.698484809835;
/** 视图框：左边和高度与原字标一致，右边到 t 的脚 */
export const LETTERING_VIEWBOX = '-8 18 456 148';

export function coopetLettering(doc: Document): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', LETTERING_VIEWBOX);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '16');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('wordmark-lettering');
  svg.innerHTML = [
    // C、o、o（两只眼睛）：照抄原字标
    '<path d="M71.7 62.3A42 42 0 1 0 71.7 121.7"/>',
    '<path d="M126.698484809835 86A24 24 0 1 1 126.698484809835 134A24 24 0 1 1 126.698484809835 86" class="accent"/>',
    '<path d="M205.698484809835 86A24 24 0 1 1 205.698484809835 134A24 24 0 1 1 205.698484809835 86" class="accent"/>',
    // p：原字标 panion 的 p（竖到下伸部 158，碗心 x+24）
    `<path d="M${P_STEM} 86V158"/>`,
    `<path d="M${P_STEM + 24} 86A24 24 0 1 1 ${P_STEM + 24} 134A24 24 0 1 1 ${P_STEM + 24} 86"/>`,
    // e：横笔穿过中线，圆弧从右端逆时针绕到右下 45°处
    `<path d="M${E_CX - 24} 110H${E_CX + 24}A24 24 0 1 0 ${E_CX + 17} 127"/>`,
    // t：竖笔从上伸部下来，底端向右弯；横笔在 x 高顶线
    `<path d="M${T_X} 64V118A16 16 0 0 0 ${T_X + 16} 134H${T_X + 18}"/>`,
    `<path d="M${T_X - 16} 86H${T_X + 18}"/>`,
  ].join('');
  return svg;
}

