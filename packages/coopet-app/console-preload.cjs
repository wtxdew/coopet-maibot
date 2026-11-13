// @ts-check
/**
 * 设置窗的 preload：页面加载时从 localStorage（`cortico.console.language`）读界面语言
 * （console/base/language.ts），这里在每次加载前写成中文。没有它时页面按系统语言显示。
 *
 * Coopanion 的 preload 还提供开机自启、窗口按钮配色等（app/settings-preload.cjs），第二期再加。
 */
try {
  localStorage.setItem('cortico.console.language', 'zh');
} catch { /* 没有存储的页面 */ }
