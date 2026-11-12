// @ts-check
/**
 * 设置页的逻辑：四个分页（连接、World、对话、日志与通用）。
 * 只通过 preload 给的 window.coopet 和外壳、核心打交道；表单和对话的渲染在 render.js。
 */
(function () {
  /** @type {any} */
  const api = /** @type {any} */ (window).coopet;
  /** @type {any} */
  const R = /** @type {any} */ (window).CoopetRender;
  const $ = (/** @type {string} */ id) => /** @type {any} */ (document.getElementById(id));

  /** @type {any} 最近一次读到的设置 */
  let snapshot = null;

  /* ---------- 状态栏 ---------- */

  const REASONS = { auth: 'token 不对', token: '没有 token', protocol: '协议版本不一致', replaced: '被另一台设备顶替', stopped: '已停止', 'no-url': '还没填地址' };
  /** @param {any} s */
  function showStatus(s) {
    if (!s) return;
    let text;
    if (s.core === 'failed') text = '核心多次崩溃，已停止';
    else if (s.core !== 'running') text = '核心启动中…';
    else if (!s.link || s.link.state === 'connecting') text = '正在连接 MaiBot…';
    else if (s.link.state === 'open') text = `已连上 ${s.link.botName || 'MaiBot'}（${s.link.kind === 'plugin' ? '插件' : 'maim_message'}）`;
    else text = `MaiBot 未连接${s.link.reason ? `：${/** @type {any} */ (REASONS)[s.link.reason] ?? `关闭码 ${s.link.reason}`}` : ''}`;
    $('status-text').textContent = text;
    $('login-item').checked = !!s.loginItem;
    $('login-item').disabled = !s.loginItemAvailable;
    $('login-hint').textContent = s.loginItemAvailable ? '' : '开发模式下不可用，打包后才能设置开机自启。';
  }
  api.onStatus(showStatus);

  /** 有要重启才生效的改动时，状态栏出现「重启核心」按钮 */
  function needRestart() {
    $('restart').hidden = false;
  }
  $('restart').addEventListener('click', async () => {
    $('restart').disabled = true;
    try {
      await api.shell('restartCore');
      $('restart').hidden = true;
      // 核心重启后重新读设置；对话流由 onData 收到关闭后自动重开
      setTimeout(() => void load(), 1500);
    } finally {
      $('restart').disabled = false;
    }
  });

  /* ---------- 分页 ---------- */

  for (const btn of document.querySelectorAll('.tabs button')) {
    btn.addEventListener('click', () => {
      const tab = /** @type {HTMLElement} */ (btn).dataset.tab;
      for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b === btn));
      for (const sec of document.querySelectorAll('.tab')) /** @type {HTMLElement} */ (sec).hidden = sec.id !== `tab-${tab}`;
      if (tab === 'chat') openChat();
    });
  }

  /**
   * @param {string} id 结果显示的元素
   * @param {boolean} ok
   * @param {string} text
   */
  function result(id, ok, text) {
    const el = $(id);
    el.textContent = text;
    el.className = `result ${ok ? 'ok' : 'bad'}`;
  }

  /* ---------- 读取 ---------- */

  async function load() {
    try {
      snapshot = await api.request('settings.get');
    } catch (err) {
      $('status-text').textContent = `读不到设置：${/** @type {Error} */ (err).message}`;
      return;
    }
    fillConnection(snapshot.app);
    fillGeneral(snapshot.app);
    renderWorlds(snapshot.worlds);
    showStatus(await api.shell('getStatus'));
  }

  /* ---------- 连接 ---------- */

  /** @param {any} app */
  function fillConnection(app) {
    const link = app.link;
    for (const r of document.querySelectorAll('input[name="kind"]')) /** @type {HTMLInputElement} */ (r).checked = /** @type {HTMLInputElement} */ (r).value === link.kind;
    $('plugin-url').value = link.plugin.url;
    $('maim-url').value = link.maim.url;
    $('maim-botAccount').value = link.maim.botAccount;
    $('maim-userId').value = link.maim.userId;
    $('maim-userNickname').value = link.maim.userNickname;
    for (const [kind, set] of [['plugin', link.plugin.tokenSet], ['maim', link.maim.tokenSet]]) {
      const input = $(`${kind}-token`);
      input.value = '';
      input.placeholder = set ? '已设置（留空不改）' : '未设置';
    }
  }

  function kindNow() {
    const r = /** @type {HTMLInputElement | null} */ (document.querySelector('input[name="kind"]:checked'));
    return r ? r.value : 'plugin';
  }

  $('test').addEventListener('click', async () => {
    const kind = kindNow();
    const token = $(`${kind}-token`).value.trim();
    $('test').disabled = true;
    result('connection-result', true, '正在测试…');
    try {
      const r = await api.request('settings.testConnection', { kind, url: $(`${kind}-url`).value.trim(), ...(token ? { token } : {}) });
      if (r.ok) result('connection-result', true, `连上了${r.botName ? `：${r.botName}` : ''}（握手 ${r.ms} 毫秒）`);
      else result('connection-result', false, `没连上：${r.reason}`);
    } catch (err) {
      result('connection-result', false, `测试出错：${/** @type {Error} */ (err).message}`);
    } finally {
      $('test').disabled = false;
    }
  });

  $('save-connection').addEventListener('click', async () => {
    const link = {
      kind: kindNow(),
      plugin: { url: $('plugin-url').value.trim() },
      maim: {
        url: $('maim-url').value.trim(),
        botAccount: $('maim-botAccount').value.trim(),
        userId: $('maim-userId').value.trim(),
        userNickname: $('maim-userNickname').value.trim(),
      },
    };
    try {
      await api.request('settings.save', { app: { link } });
      for (const kind of ['plugin', 'maim']) {
        const token = $(`${kind}-token`).value.trim();
        if (token) await api.request('settings.saveToken', { kind, token });
      }
      result('connection-result', true, '已保存，重启核心后生效');
      needRestart();
      await load();
    } catch (err) {
      result('connection-result', false, `没保存：${/** @type {Error} */ (err).message}`);
    }
  });

  /* ---------- World ---------- */

  /** @param {any[]} worlds */
  function renderWorlds(worlds) {
    const box = $('worlds');
    box.replaceChildren();
    for (const w of worlds) {
      const card = document.createElement('div');
      card.className = 'world';
      const head = document.createElement('div');
      head.className = 'world-head';
      const title = document.createElement('h3');
      title.textContent = w.label;
      const enabled = document.createElement('label');
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = w.enabled;
      toggle.disabled = !w.canDisable;
      enabled.append(toggle, w.canDisable ? ' 启用' : ' 启用（客户端本身，不能停用）');
      head.append(title, enabled);
      if (w.id === 'desktop-pet') {
        const dress = document.createElement('button');
        dress.type = 'button';
        dress.textContent = '装扮…';
        dress.addEventListener('click', () => void api.shell('openDress'));
        head.append(dress);
      }
      card.append(head);

      /** 要重启才生效的改动，点「保存」时一起提交 */
      /** @type {Record<string, unknown>} */
      const pending = {};
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'primary';
      save.textContent = '保存（重启核心后生效）';
      save.hidden = true;
      const status = document.createElement('p');
      status.className = 'result';

      for (const group of w.groups) {
        const h = document.createElement('h3');
        h.textContent = group.schema.title;
        card.append(h);
        for (const [key, prop] of Object.entries(group.schema.properties)) {
          card.append(R.renderField(document, key, prop, w.values[key], async (/** @type {unknown} */ value) => {
            if (/** @type {any} */ (prop)['x-hot'] === true) {
              try {
                await api.request('settings.save', { worlds: { [w.id]: { [key]: value } } });
                status.textContent = '';
              } catch (err) {
                status.className = 'result bad';
                status.textContent = `没保存：${/** @type {Error} */ (err).message}`;
              }
            } else {
              pending[key] = value;
              save.hidden = false;
            }
          }));
        }
      }
      save.addEventListener('click', async () => {
        try {
          await api.request('settings.save', { worlds: { [w.id]: pending } });
          for (const k of Object.keys(pending)) delete pending[k];
          save.hidden = true;
          status.className = 'result ok';
          status.textContent = '已保存，重启核心后生效';
          needRestart();
        } catch (err) {
          status.className = 'result bad';
          status.textContent = `没保存：${/** @type {Error} */ (err).message}`;
        }
      });
      card.append(save, status);
      box.append(card);
    }
  }

  /* ---------- 日志与通用 ---------- */

  /** @param {any} app */
  function fillGeneral(app) {
    $('log-level').value = app.log.level;
    $('log-file').checked = app.log.file;
  }
  $('save-general').addEventListener('click', async () => {
    try {
      await api.request('settings.save', { app: { log: { level: $('log-level').value, file: $('log-file').checked } } });
      result('general-result', true, '已保存，重启核心后生效');
      needRestart();
    } catch (err) {
      result('general-result', false, `没保存：${/** @type {Error} */ (err).message}`);
    }
  });
  $('open-logs').addEventListener('click', () => void api.shell('openLogs'));
  $('login-item').addEventListener('change', async () => {
    $('login-item').checked = await api.shell('setLoginItem', $('login-item').checked);
  });

  /* ---------- 对话 ---------- */

  /** @type {number | null} */
  let chatStream = null;
  let names = { user: '你', bot: 'MaiBot' };
  /** 已显示的最早一条的游标，用来加载更早的 */
  let oldest = Infinity;
  /** 还没送达的消息 */
  const pendingCursors = new Set();

  /** @param {any} item @param {boolean} prepend */
  function addChat(item, prepend = false) {
    const line = R.chatLine(item, names);
    if (!line) return;
    const li = document.createElement('li');
    li.className = line.side + (pendingCursors.has(line.cursor) ? ' pending' : '');
    li.dataset.cursor = String(line.cursor);
    if (line.who) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = line.who;
      li.append(who);
    }
    li.append(document.createTextNode(line.text));
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = R.shortTime(line.ts);
    li.append(time);
    if (prepend) $('chat').prepend(li);
    else $('chat').append(li);
    oldest = Math.min(oldest, line.cursor);
  }

  /** @param {string} data */
  function onChatFrame(data) {
    let f;
    try { f = JSON.parse(data); } catch { return; }
    if (f.t === 'init') {
      names = { user: f.user || '你', bot: f.bot || 'MaiBot' };
      $('chat').replaceChildren();
      oldest = Infinity;
      pendingCursors.clear();
      for (const c of f.pending ?? []) pendingCursors.add(c);
      for (const item of f.items ?? []) addChat(item);
      $('chat-more').hidden = !f.more;
      $('chat').lastElementChild?.scrollIntoView({ block: 'end' });
    } else if (f.t === 'older') {
      for (const item of [...(f.items ?? [])].reverse()) addChat(item, true);
      $('chat-more').hidden = !f.more;
    } else if (f.t === 'item') {
      if (f.pending) pendingCursors.add(f.item.cursor);
      addChat(f.item);
      $('chat').lastElementChild?.scrollIntoView({ block: 'end' });
    } else if (f.t === 'settled') {
      for (const c of f.cursors ?? []) {
        pendingCursors.delete(c);
        $('chat').querySelector(`li[data-cursor="${c}"]`)?.classList.remove('pending');
      }
    }
  }

  async function openChat() {
    if (chatStream !== null) return;
    try {
      chatStream = await api.chat.open();
      api.chat.send(chatStream, JSON.stringify({ t: 'hello' }));
    } catch {
      chatStream = null;
    }
  }
  api.chat.onData((/** @type {number} */ id, /** @type {string | null} */ data) => {
    if (id !== chatStream) return;
    if (data === null) {
      // 流关了（例如核心重启）：过一会儿重开
      chatStream = null;
      if (!$('tab-chat').hidden) setTimeout(() => void openChat(), 2000);
      return;
    }
    onChatFrame(data);
  });
  $('chat-more').addEventListener('click', () => {
    if (chatStream !== null && Number.isFinite(oldest)) api.chat.send(chatStream, JSON.stringify({ t: 'more', before: oldest }));
  });

  void load();
})();
