// @ts-check
/**
 * 托盘菜单的内容（纯函数，不依赖 Electron，方便测试）。tray.cjs 把它交给 Electron 显示。
 *
 * @typedef {{ kind: string, state: string, reason?: string, botName?: string }} LinkInfo
 * @typedef {{
 *   core: 'stopped' | 'starting' | 'running' | 'restarting' | 'failed',
 *   link: LinkInfo | null,
 *   onDesktop: boolean,
 *   petOrigin: string | null,
 *   loginItem: boolean,
 *   loginItemAvailable: boolean,
 *   language: string,
 *   updateReady?: string | null,
 *   clickThrough?: boolean,
 * }} TrayState
 * @typedef {{
 *   openSettings: () => void,
 *   togglePet: () => void,
 *   setClickThrough?: (on: boolean) => void,
 *   openDress: () => void,
 *   setLoginItem: (on: boolean) => void,
 *   openLogs: () => void,
 *   restartCore: () => void,
 *   installUpdate?: () => void,
 *   quit: () => void,
 * }} TrayActions
 * @typedef {{ label?: string, type?: 'normal' | 'separator' | 'checkbox', enabled?: boolean, checked?: boolean, click?: () => void }} MenuItem
 */

/** 托盘菜单的文字：中文和英文，其他语言用英文（和设置窗处理缺少的翻译一样） */
const TEXT = {
  zh: {
    reasons: /** @type {Record<string, string>} */ ({
      auth: 'token 不对', token: '没有 token 文件', protocol: '协议版本不一致', replaced: '被另一台设备顶替', 'no-url': '还没填地址', stopped: '已停止',
    }),
    code: (/** @type {string} */ c) => `关闭码 ${c}`,
    failed: '核心多次崩溃，已停止',
    starting: '核心启动中…',
    connecting: '正在连接 MaiBot…',
    plugin: '插件',
    open: (/** @type {string} */ bot, /** @type {string} */ via) => `已连上 ${bot}（${via}）`,
    closed: (/** @type {string} */ why) => `MaiBot 未连接${why ? `：${why}` : ''}`,
    settings: '设置…',
    hidePet: '隐藏桌宠',
    showPet: '显示桌宠',
    clickThrough: '鼠标穿透',
    tooltipThrough: 'Coopet（鼠标穿透中）',
    dress: '装扮…',
    loginItem: '开机自启',
    loginItemLater: '开机自启（打包后可用）',
    logs: '打开日志文件夹',
    restartCore: '重新启动核心',
    installUpdate: (/** @type {string} */ v) => `重启并更新到 v${v}`,
    quit: '退出 Coopet',
  },
  en: {
    reasons: /** @type {Record<string, string>} */ ({
      auth: 'wrong token', token: 'no token file', protocol: 'protocol version mismatch', replaced: 'replaced by another device', 'no-url': 'no address yet', stopped: 'stopped',
    }),
    code: (/** @type {string} */ c) => `close code ${c}`,
    failed: 'The core crashed repeatedly and stopped',
    starting: 'Starting the core…',
    connecting: 'Connecting to MaiBot…',
    plugin: 'plugin',
    open: (/** @type {string} */ bot, /** @type {string} */ via) => `Connected to ${bot} (${via})`,
    closed: (/** @type {string} */ why) => `MaiBot not connected${why ? `: ${why}` : ''}`,
    settings: 'Settings…',
    hidePet: 'Hide the pet',
    showPet: 'Show the pet',
    clickThrough: 'Click through',
    tooltipThrough: 'Coopet (click-through)',
    dress: 'Dress up…',
    loginItem: 'Start at login',
    loginItemLater: 'Start at login (in the packaged app)',
    logs: 'Open the log folder',
    restartCore: 'Restart the core',
    installUpdate: (/** @type {string} */ v) => `Restart and update to v${v}`,
    quit: 'Quit Coopet',
  },
};

/** @param {string} language */
const textOf = (language) => (language === 'zh' || language === 'zh-Hant' ? TEXT.zh : TEXT.en);

/**
 * 菜单顶部的状态行
 * @param {TrayState} s
 */
function statusText(s) {
  const t = textOf(s.language);
  if (s.core === 'failed') return t.failed;
  if (s.core !== 'running') return t.starting;
  const link = s.link;
  if (!link || link.state === 'connecting') return t.connecting;
  const via = link.kind === 'plugin' ? t.plugin : 'maim_message';
  if (link.state === 'open') return t.open(link.botName || 'MaiBot', via);
  const reason = link.reason ? (t.reasons[link.reason] ?? t.code(link.reason)) : '';
  return t.closed(reason);
}

/**
 * @param {TrayState} s
 * @param {TrayActions} a
 * @returns {MenuItem[]}
 */
function trayTemplate(s, a) {
  const t = textOf(s.language);
  const running = s.core === 'running';
  /** @type {MenuItem[]} */
  const items = [
    { label: statusText(s), enabled: false },
    { type: 'separator' },
    { label: t.settings, click: a.openSettings },
    { label: s.onDesktop ? t.hidePet : t.showPet, enabled: running, click: a.togglePet },
    // 鼠标穿透：点击都穿过桌宠落到下面的窗口（打游戏时），桌宠照常走动和说话；只在这次运行有效
    ...(a.setClickThrough ? [/** @type {MenuItem} */ ({
      label: t.clickThrough, type: 'checkbox', checked: !!s.clickThrough, enabled: running,
      click: () => a.setClickThrough?.(!s.clickThrough),
    })] : []),
    { label: t.dress, enabled: running && !!s.petOrigin, click: a.openDress },
    { type: 'separator' },
    {
      label: s.loginItemAvailable ? t.loginItem : t.loginItemLater,
      type: 'checkbox', checked: s.loginItem, enabled: s.loginItemAvailable,
      click: () => a.setLoginItem(!s.loginItem),
    },
    { label: t.logs, click: a.openLogs },
  ];
  if (s.core === 'failed') items.push({ label: t.restartCore, click: a.restartCore });
  items.push({ type: 'separator' });
  // 下载好了更新（自动更新，updater.cjs）：和桌宠气泡里的「现在重启更新」一样
  if (s.updateReady && a.installUpdate) items.push({ label: t.installUpdate(s.updateReady), click: a.installUpdate });
  items.push({ label: t.quit, click: a.quit });
  return items;
}

/**
 * 托盘图标的提示文字：鼠标穿透时写明，免得以为桌宠点不动是坏了
 * @param {TrayState} s
 */
function trayTooltip(s) {
  return s.clickThrough ? textOf(s.language).tooltipThrough : 'Coopet';
}

module.exports = { statusText, trayTemplate, trayTooltip };
