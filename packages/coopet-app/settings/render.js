// @ts-check
/**
 * 设置页的纯渲染函数（不碰 window.coopet，方便在测试里用 jsdom 跑）。
 * 浏览器里经 <script> 加载后挂到 window.CoopetRender；测试里用 require。
 *
 * - 表单：按配置说明书（ConfigProperty）生成一项设置的控件。
 * - 对话：把桌宠对话流里的一条记录（src/chat.ts 的 ChatItem）变成要显示的文字。
 */
(function (root) {
  /** 说明书里没有中文的选项值，这里补上；没列出的直接显示原值 */
  const ENUM_LABELS = {
    // 用桌宠官方说明里的叫法（src/i18n/zh.ts）
    'worlds.desktop-pet.roam': { free: '常走动', calm: '多待着', off: '不乱动' },
    'worlds.desktop-pet.theme': { dark: '夜间', light: '白天' },
    'worlds.desktop-pet.speech.pitch': { low: '低', mid: '中', high: '高', custom: '自定义' },
    'worlds.desktop-pet.speech.speed': { low: '慢', mid: '中', high: '快', custom: '自定义' },
  };

  /**
   * @param {string} key
   * @param {string} value
   */
  function enumLabel(key, value) {
    const map = /** @type {Record<string, Record<string, string>>} */ (ENUM_LABELS)[key];
    return (map && map[value]) || value;
  }

  /**
   * 显示值与存储值：x-scale 存的是"显示值 × scale"
   * @param {any} prop @param {unknown} stored
   */
  function toDisplay(prop, stored) {
    return typeof stored === 'number' && prop['x-scale'] ? stored / prop['x-scale'] : stored;
  }
  /** @param {any} prop @param {unknown} shown */
  function toStored(prop, shown) {
    return typeof shown === 'number' && prop['x-scale'] ? shown * prop['x-scale'] : shown;
  }

  /**
   * 一项设置的控件。onChange(值) 在用户改动时调用，值已换回存储单位。
   * @param {Document} doc
   * @param {string} key
   * @param {any} prop ConfigProperty
   * @param {unknown} value 存储值
   * @param {(v: unknown) => void} onChange
   */
  function renderField(doc, key, prop, value, onChange) {
    const row = doc.createElement('div');
    row.className = 'field';
    row.dataset.key = key;
    const label = doc.createElement('label');
    label.className = 'field-title';
    label.textContent = prop.title + (prop['x-hot'] === true ? '' : '（重启核心后生效）');
    row.append(label);

    const shown = toDisplay(prop, value);
    /** @type {HTMLElement} */
    let control;
    if (prop.type === 'boolean') {
      const input = doc.createElement('input');
      input.type = 'checkbox';
      input.checked = shown === true;
      input.addEventListener('change', () => onChange(input.checked));
      control = input;
    } else if (prop.type === 'string' && Array.isArray(prop.enum)) {
      const select = doc.createElement('select');
      for (const v of prop.enum) {
        const opt = doc.createElement('option');
        opt.value = v;
        opt.textContent = enumLabel(key, v);
        select.append(opt);
      }
      select.value = typeof shown === 'string' ? shown : prop.enum[0];
      select.addEventListener('change', () => onChange(select.value));
      control = select;
    } else if (prop.type === 'number' || prop.type === 'integer') {
      const wrap = doc.createElement('div');
      wrap.className = 'number';
      const number = doc.createElement('input');
      number.type = 'number';
      const step = prop.multipleOf ?? (prop.type === 'integer' ? 1 : 0.01);
      number.step = String(step);
      if (prop.minimum !== undefined) number.min = String(toDisplay(prop, prop.minimum));
      if (prop.maximum !== undefined) number.max = String(toDisplay(prop, prop.maximum));
      number.value = shown === null || shown === undefined ? '' : String(shown);
      /** @type {HTMLInputElement | null} */
      let range = null;
      if (prop.minimum !== undefined && prop.maximum !== undefined) {
        range = doc.createElement('input');
        range.type = 'range';
        range.min = number.min;
        range.max = number.max;
        range.step = number.step;
        range.value = number.value;
        const r = range;
        r.addEventListener('input', () => { number.value = r.value; });
        r.addEventListener('change', () => onChange(toStored(prop, Number(r.value))));
        wrap.append(r);
      }
      number.addEventListener('change', () => {
        if (number.value === '') return;
        const n = prop.type === 'integer' ? Math.round(Number(number.value)) : Number(number.value);
        if (range) range.value = String(n);
        onChange(toStored(prop, n));
      });
      wrap.append(number);
      if (prop['x-suffix']) {
        const suffix = doc.createElement('span');
        suffix.className = 'suffix';
        suffix.textContent = prop['x-suffix'];
        wrap.append(suffix);
      }
      control = wrap;
    } else {
      const input = doc.createElement('input');
      input.type = 'text';
      input.value = typeof shown === 'string' ? shown : '';
      input.addEventListener('change', () => onChange(input.value));
      control = input;
    }
    control.classList.add('field-control');
    row.append(control);
    if (prop.description) {
      const desc = doc.createElement('p');
      desc.className = 'field-desc';
      desc.textContent = prop.description;
      row.append(desc);
    }
    return row;
  }

  /**
   * 对话流里的一条记录 → 要显示的内容；不显示的返回 null。
   * @param {any} item ChatItem
   * @param {{ user: string, bot: string }} names
   * @returns {{ side: 'user' | 'pet' | 'note', who: string, text: string, ts: string, cursor: number } | null}
   */
  function chatLine(item, names) {
    const base = { ts: String(item.ts ?? ''), cursor: Number(item.cursor) };
    switch (item.kind) {
      case 'user': {
        const via = item.via === 'voice' ? '（语音）' : '';
        return { ...base, side: 'user', who: names.user + via, text: String(item.text ?? '') };
      }
      case 'say': {
        const beats = Array.isArray(item.beats) ? item.beats : [];
        const text = beats.map((/** @type {any} */ b) => String(b.text ?? '')).join('');
        const mood = beats.map((/** @type {any} */ b) => b.mood?.zh).find(Boolean);
        return { ...base, side: 'pet', who: names.bot + (mood ? `（${mood}）` : ''), text };
      }
      case 'ask': return { ...base, side: 'pet', who: names.bot, text: `${item.question}${item.options?.length ? `（${item.options.join(' / ')}）` : ''}` };
      case 'answer': return { ...base, side: 'user', who: names.user, text: item.dismissed ? '（没有回答）' : String(item.text ?? `选了第 ${(item.index ?? 0) + 1} 项`) };
      case 'touch': {
        const kinds = { poke: '戳了戳', pet: '摸了摸', throw: '把它甩了出去', drop: '把它拎起来放下', crash: '把它摔晕了' };
        const t = item.touch;
        const what = t ? (/** @type {Record<string, string>} */ (kinds)[t.kind] ?? t.kind) : String(item.text ?? '碰了碰');
        return { ...base, side: 'note', who: '', text: `${names.user}${what}${t && t.count > 1 ? ` ×${t.count}` : ''}` };
      }
      case 'figure': {
        const name = item.figure?.name?.zh ?? item.figure?.name?.en ?? '';
        const what = item.figure?.kind === 'dress' ? '换了装扮' : item.figure?.kind === 'failed' ? '形象没能加载' : '换了形象';
        return { ...base, side: 'note', who: '', text: `${what}${name ? `：${name}` : ''}` };
      }
      default:
        return null;
    }
  }

  /** @param {string} ts ISO 时间 → 本地 HH:MM（跨天时带日期） */
  function shortTime(ts, now = new Date()) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return d.toDateString() === now.toDateString() ? hm : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  }

  const api = { enumLabel, toDisplay, toStored, renderField, chatLine, shortTime };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else /** @type {any} */ (root).CoopetRender = api;
})(typeof window !== 'undefined' ? window : globalThis);
