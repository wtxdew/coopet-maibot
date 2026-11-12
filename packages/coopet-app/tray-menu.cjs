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
 * }} TrayState
 * @typedef {{
 *   openSettings: () => void,
 *   togglePet: () => void,
 *   openDress: () => void,
 *   setLoginItem: (on: boolean) => void,
 *   openLogs: () => void,
 *   restartCore: () => void,
 *   quit: () => void,
 * }} TrayActions
 * @typedef {{ label?: string, type?: 'normal' | 'separator' | 'checkbox', enabled?: boolean, checked?: boolean, click?: () => void }} MenuItem
 */

const LINK_REASON = {
  auth: 'token 不对',
  token: '没有 token 文件',
  protocol: '协议版本不一致',
  replaced: '被另一台设备顶替',
  'no-url': '还没填地址',
  stopped: '已停止',
};

/**
 * 菜单顶部的状态行
 * @param {TrayState} s
 */
function statusText(s) {
  if (s.core === 'failed') return '核心多次崩溃，已停止';
  if (s.core !== 'running') return '核心启动中…';
  const link = s.link;
  if (!link || link.state === 'connecting') return '正在连接 MaiBot…';
  const via = link.kind === 'plugin' ? '插件' : 'maim_message';
  if (link.state === 'open') return `已连上 ${link.botName || 'MaiBot'}（${via}）`;
  const reason = link.reason ? (/** @type {Record<string, string>} */ (LINK_REASON)[link.reason] ?? `关闭码 ${link.reason}`) : '';
  return `MaiBot 未连接${reason ? `：${reason}` : ''}`;
}

/**
 * @param {TrayState} s
 * @param {TrayActions} a
 * @returns {MenuItem[]}
 */
function trayTemplate(s, a) {
  const running = s.core === 'running';
  /** @type {MenuItem[]} */
  const items = [
    { label: statusText(s), enabled: false },
    { type: 'separator' },
    { label: '设置…', click: a.openSettings },
    { label: s.onDesktop ? '隐藏桌宠' : '显示桌宠', enabled: running, click: a.togglePet },
    { label: '装扮…', enabled: running && !!s.petOrigin, click: a.openDress },
    { type: 'separator' },
    {
      label: s.loginItemAvailable ? '开机自启' : '开机自启（打包后可用）',
      type: 'checkbox', checked: s.loginItem, enabled: s.loginItemAvailable,
      click: () => a.setLoginItem(!s.loginItem),
    },
    { label: '打开日志文件夹', click: a.openLogs },
  ];
  if (s.core === 'failed') items.push({ label: '重新启动核心', click: a.restartCore });
  items.push({ type: 'separator' }, { label: '退出 Coopet', click: a.quit });
  return items;
}

module.exports = { statusText, trayTemplate };
