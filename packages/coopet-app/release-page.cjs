// @ts-check
/**
 * 要打开的 Release 页面：核心的 `releases` 消息带了版本号（更新后的气泡点了「看看改了什么」）时，打开这个版本的 tag 页面；
 * 没带、或者不是三段数字的版本号时，打开最新的 Release（updater.cjs 的 RELEASES_URL）。
 * 版本号先检查格式再拼进网址：网址交给系统浏览器打开，不让核心传来的任意字符串进去。
 */

const REPO = 'https://github.com/wtxdew/coopet-maibot/releases';

/**
 * @param {unknown} version
 * @param {string} latest 最新 Release 的地址
 * @returns {string}
 */
function releasePage(version, latest) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? `${REPO}/tag/v${version}` : latest;
}

module.exports = { releasePage };
