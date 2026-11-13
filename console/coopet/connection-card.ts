/**
 * 「连接 MaiBot」卡：放在开始页原来「连接模型」卡的位置（features/home/index.ts 的 Coopet 本地修改），
 * 样式用 Coopanion 现成的组件和开始页的样式（home.css）。
 *
 * - 状态：标题右边的小标签（已连接 / 连接中 / 没连上）和状态行（Bot 名字，或没连上的原因），每 2 秒读一次 `/api/status` 的 link。
 * - 连接方式：插件（推荐）/ maim_message（旧版），分段按钮；切换只改显示的输入框，按「保存并连接」才生效。
 * - 输入框：插件是地址和 token；maim_message 另有 Bot 账号、你的 user_id、你的昵称。
 *   token 框已设置时显示"已设置，留空不改"；真实的 token 不会传到页面上。
 * - token 框旁的「生成」填入一个随机 token（32 个字符，约 190 位）并显示出来，「复制」复制框里的内容，
 *   拿去粘贴到 MaiBot 的插件设置里。已保存的 token 页面拿不到，所以只能复制框里正在填的。
 * - 「保存并连接」：写配置组 `coopet.link`（/api/config），核心马上换上新连接；之后最多等 8 秒，报告连上了还是没连上的原因。
 */

import { get, setConfig } from '../base/api.ts';
import { pick } from '../base/language.ts';
import type { PageContext } from '../base/page.ts';

const GROUP = 'coopet.link';
const POLL_MS = 2000;
const WAIT_MS = 8000;

type Kind = 'plugin' | 'maim';
interface LinkStatus {
  kind?: Kind;
  state?: 'connecting' | 'open' | 'closed';
  reason?: string;
  botName?: string;
  tokenSet?: Record<Kind, boolean>;
}

const S = pick({
  zh: {
    title: '连接 MaiBot',
    kindLabel: '连接方式：',
    stateLabel: '当前状态：',
    plugin: '插件（推荐）',
    maim: 'maim_message（旧版）',
    open: '已连接',
    connecting: '连接中',
    closed: '没连上',
    openLine: (bot: string | undefined, kind: string) => `${bot ? `${bot} · ` : ''}${kind}`,
    pluginUrl: '插件地址',
    maimUrl: 'maim_message 地址',
    token: 'token',
    tokenKept: '已设置，留空不改',
    tokenNeeded: '必填',
    generate: '生成',
    copy: '复制',
    generated: '已生成随机 token：复制后粘贴到 MaiBot 插件设置的 token 里，再点「保存并连接」。',
    botAccount: 'Bot 账号',
    userId: '你的 user_id',
    userNickname: '你的昵称',
    save: '保存并连接',
    pluginHint: '地址和 token 都在 MaiBot 的插件设置（coopet-adapter）里，地址形如 ws://<MaiBot 主机>:18100/ws。',
    maimHint: '旧版连接，只在没装插件时用。Bot 账号要和 MaiBot 的 bot.platforms 里登记的一致。',
    saved: '已保存，正在连接…',
    connected: (bot: string | undefined) => `已连上${bot ? ` ${bot}` : ''}`,
    failed: (why: string) => `没连上：${why}`,
    stillConnecting: `${WAIT_MS / 1000} 秒内还没连上，会自动重试`,
    saveFailed: (why: string) => `保存失败：${why}`,
    reasons: {
      auth: 'token 不对',
      token: '没有 token',
      protocol: '插件的协议版本和客户端不一致',
      replaced: '被另一台设备顶替了',
      'no-url': '还没填地址',
      stopped: '已停止',
      code: (code: string) => `连不上（关闭码 ${code}）`,
    } as Record<string, string | ((code: string) => string)>,
  },
  en: {
    title: 'Connect to MaiBot',
    kindLabel: 'Connection:',
    stateLabel: 'Status:',
    plugin: 'Plugin (recommended)',
    maim: 'maim_message (legacy)',
    open: 'Connected',
    connecting: 'Connecting',
    closed: 'Not connected',
    openLine: (bot: string | undefined, kind: string) => `${bot ? `${bot} · ` : ''}${kind}`,
    pluginUrl: 'Plugin address',
    maimUrl: 'maim_message address',
    token: 'Token',
    tokenKept: 'Set; leave empty to keep',
    tokenNeeded: 'Required',
    generate: 'Generate',
    copy: 'Copy',
    generated: 'Generated a random token: copy it into the token in MaiBot\'s plugin settings, then click Save and connect.',
    botAccount: 'Bot account',
    userId: 'Your user_id',
    userNickname: 'Your nickname',
    save: 'Save and connect',
    pluginHint: 'The address and token are in MaiBot\'s plugin settings (coopet-adapter); the address looks like ws://<MaiBot host>:18100/ws.',
    maimHint: 'The legacy connection, only without the plugin. The bot account must match the one in MaiBot\'s bot.platforms.',
    saved: 'Saved, connecting…',
    connected: (bot: string | undefined) => `Connected${bot ? ` to ${bot}` : ''}`,
    failed: (why: string) => `Not connected: ${why}`,
    stillConnecting: `Not connected within ${WAIT_MS / 1000} seconds; it keeps retrying`,
    saveFailed: (why: string) => `Could not save: ${why}`,
    reasons: {
      auth: 'wrong token',
      token: 'no token',
      protocol: 'the plugin speaks another protocol version',
      replaced: 'replaced by another device',
      'no-url': 'no address yet',
      stopped: 'stopped',
      code: (code: string) => `could not connect (close code ${code})`,
    } as Record<string, string | ((code: string) => string)>,
  },
});

function reasonText(reason: string | undefined): string {
  if (!reason) return '';
  if (/^\d+$/.test(reason)) return (S.reasons.code as (c: string) => string)(reason);
  const known = S.reasons[reason];
  return typeof known === 'string' ? known : reason;
}

/** 随机 token：24 个随机字节的 base64url，32 个字符 */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_');
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 卡片的根元素；页面离开时随 ctx 的 signal 停止轮询。 */
export function connectionCard(ctx: Pick<PageContext, 'ui' | 'signal' | 'lifecycle'>): HTMLElement {
  const { ui, signal } = ctx;
  const opts = { signal };
  const card = ui.sheet({ title: S.title });
  const pill = ui.pill('—', 'off');
  card.el.querySelector(':scope > h3')?.append(pill);

  let kind: Kind = 'plugin';
  let status: LinkStatus = {};
  const kindPick = ui.segmented([{ value: 'plugin', label: S.plugin }, { value: 'maim', label: S.maim }], {
    size: 'sm', value: kind, onSelect: (v) => { kind = v as Kind; render(); },
  });
  const stateLine = ui.h('span', 'home-none', '—');
  const picker = ui.h('div', 'home-picker');
  picker.append(ui.h('span', 'home-pickerlabel', S.kindLabel), kindPick.el, ui.h('span', 'home-pickerlabel', S.stateLabel), stateLine);

  const text = () => { const el = ui.input({}); el.autocomplete = 'off'; el.spellcheck = false; return el; };
  const pluginUrl = text();
  pluginUrl.placeholder = 'ws://…:18100/ws';
  const maimUrl = text();
  maimUrl.placeholder = 'ws://…/maim/…/ws';
  const token = text();
  token.type = 'password';
  const botAccount = text();
  const userId = text();
  const userNickname = text();

  const urlField = ui.field(S.pluginUrl, pluginUrl);
  const maimUrlField = ui.field(S.maimUrl, maimUrl);
  const generate = ui.button(S.generate, { size: 'sm', onClick: () => {
    token.value = randomToken();
    token.type = 'text';
    msg.classList.remove('bad');
    msg.textContent = S.generated;
    syncCopy();
  } });
  const copy = ui.copyButton(() => token.value, { label: S.copy });
  /** 框里没有内容时没东西可复制 */
  const syncCopy = () => { copy.disabled = !token.value; };
  token.addEventListener('input', syncCopy, opts);
  const tokenBox = ui.h('span', 'coopet-tokenbox');
  tokenBox.append(token, generate, copy);
  const tokenField = ui.field(S.token, tokenBox);
  tokenField.classList.add('home-modelfield');
  const save = ui.button(S.save, { variant: 'primary' });
  const keyRow = ui.rowbar();
  keyRow.classList.add('home-keyrow');
  keyRow.append(urlField, maimUrlField, tokenField, save);
  const maimRow = ui.rowbar();
  maimRow.classList.add('home-keyrow');
  maimRow.append(ui.field(S.botAccount, botAccount), ui.field(S.userId, userId), ui.field(S.userNickname, userNickname));
  const hint = ui.h('p', 'home-note', '');
  const msg = ui.msgline('');
  msg.classList.add('feedback-status');
  card.body.append(picker, maimRow, keyRow, hint, msg);

  /** 只按选中的方式显示输入框；token 框的提示按那种方式的 token 有没有设置 */
  function render(): void {
    const maim = kind === 'maim';
    urlField.hidden = maim;
    maimUrlField.hidden = !maim;
    maimRow.hidden = !maim;
    hint.textContent = maim ? S.maimHint : S.pluginHint;
    token.placeholder = status.tokenSet?.[kind] ? S.tokenKept : S.tokenNeeded;
  }

  function renderStatus(): void {
    const state = status.state ?? 'closed';
    pill.textContent = state === 'open' ? S.open : state === 'connecting' ? S.connecting : S.closed;
    pill.className = state === 'open' ? 'pill on' : state === 'connecting' ? 'pill' : 'pill off';
    const kindName = status.kind === 'maim' ? S.maim : S.plugin;
    stateLine.textContent = state === 'open'
      ? S.openLine(status.botName, kindName)
      : state === 'connecting' ? `${S.connecting}… · ${kindName}` : `${reasonText(status.reason) || S.closed} · ${kindName}`;
    render();
  }

  const readStatus = async (): Promise<void> => {
    try {
      const st = await get<{ link?: LinkStatus }>('/api/status', opts);
      status = st?.link ?? {};
      renderStatus();
    } catch { /* 下一拍再读 */ }
  };

  const readValues = async (): Promise<void> => {
    const d = await get<{ groups?: Array<{ group: { id: string }; values?: Record<string, unknown> }> }>('/api/config', opts);
    const v = d.groups?.find((g) => g.group.id === GROUP)?.values ?? {};
    const s = (key: string) => (typeof v[key] === 'string' ? v[key] as string : '');
    kind = s('link.kind') === 'maim' ? 'maim' : 'plugin';
    kindPick.setValue(kind);
    pluginUrl.value = s('link.plugin.url');
    maimUrl.value = s('link.maim.url');
    botAccount.value = s('link.maim.botAccount');
    userId.value = s('link.maim.userId');
    userNickname.value = s('link.maim.userNickname');
    render();
  };

  save.addEventListener('click', async () => {
    const values: Record<string, string> = kind === 'plugin'
      ? { 'link.kind': 'plugin', 'link.plugin.url': pluginUrl.value.trim(), 'link.plugin.token': token.value.trim() }
      : {
        'link.kind': 'maim', 'link.maim.url': maimUrl.value.trim(), 'link.maim.token': token.value.trim(),
        'link.maim.botAccount': botAccount.value.trim(), 'link.maim.userId': userId.value.trim(), 'link.maim.userNickname': userNickname.value.trim(),
      };
    save.disabled = true;
    msg.classList.remove('bad');
    try {
      await setConfig(GROUP, values, opts);
      token.value = '';
      token.type = 'password';
      syncCopy();
      msg.textContent = S.saved;
      // 等新连接有结果：连上、被拒（关闭且有原因），或者超时
      const started = Date.now();
      while (!signal.aborted && Date.now() - started < WAIT_MS) {
        await new Promise((r) => setTimeout(r, 500));
        await readStatus();
        if (status.state === 'open') { msg.textContent = S.connected(status.botName); return; }
        if (status.state === 'closed' && status.reason) { msg.textContent = S.failed(reasonText(status.reason)); msg.classList.add('bad'); return; }
      }
      if (!signal.aborted) msg.textContent = S.stillConnecting;
    } catch (err) {
      if (signal.aborted) return;
      msg.textContent = S.saveFailed(errText(err));
      msg.classList.add('bad');
    } finally {
      save.disabled = false;
    }
  }, opts);

  render();
  syncCopy();
  void readValues().catch(() => {});
  void readStatus();
  ctx.lifecycle.interval(() => void readStatus(), POLL_MS);
  return card.el;
}
