/**
 * 「运行诊断」：照 Coopanion 的诊断页（advanced/features/core/index.ts）搭——页头、子页签、右上角「导出诊断包」。
 *
 * - 运行：Coopet 自己的状态卡（核心、MaiBot 连接、桌宠、对话统计、记录；每 2 秒读一次 /api/status），
 *   下面是 Coopanion 的事件流（/api/events）。
 * - 通知：扩展通知的处理记录（/api/status 的 notices，最近 100 条，新的在前）：时间、来源、内容、去向、结果
 *   （桌宠说了、合并、交给麦麦、她说了什么、退回桌宠的原因、没处理的原因）。在这个页签时和「运行」一样每 2 秒读一次。
 * - 运行日志：Coopanion 的运行日志（/api/log、/api/runs：本次和最近 7 天每次运行的结构化日志）。
 * - 配置：Coopanion 的通用配置表单，只放 `coopet.log`（日志级别、写不写文本日志）。
 *
 * 调试通道（/ws/debug）推来新事件、新日志时，事件流追新、运行日志提示有新记录；连不上时事件流自己轮询。
 */

import type { Disposable } from 'cortico/web/shared/client-panel.ts';
import { get } from '../base/api.ts';
import { pick } from '../base/language.ts';
import { pageTabs } from '../base/ui/page-tabs.ts';
import { pageIntro } from '../base/ui/page.ts';
import { icon } from '../base/ui/icons.ts';
import { actionProblem } from '../base/ui/problem.ts';
import { browserSocketEnv, openFrameworkSocket } from '../base/websocket.ts';
import type { FeatureContext, FrameworkFeature } from '../advanced/features/feature.ts';
import { createEventsView } from '../advanced/features/core/events.ts';
import { createRunlogView } from '../advanced/features/core/runlog.ts';
import { createConfigView } from '../advanced/features/config/view.ts';
import { exportDiagnostics } from '../advanced/features/live/diagnostics.ts';
import { S as LIVE_S } from '../advanced/features/live/strings.ts';

const ROUTE = 'diagnostics';
const POLL_MS = 2000;
const LAST_SUB_KEY = 'coopet.diagnostics.sub';

type Step = 'sent' | 'acked' | 'thinking' | 'reply' | 'bubble';
type Outcome = 'replied' | 'no-reply' | 'not-sent' | 'disconnected';
type NoticeResult = 'skipped' | 'queued' | 'said' | 'merged' | 'handed' | 'replied' | 'silent';

/** 一条通知记录（core 的 conductor/notice-log.ts） */
interface NoticeRecord {
  id: string;
  at: string;
  source: string;
  text: string;
  route: 'pet' | 'maibot' | null;
  skip?: string;
  fallback?: string;
  result: NoticeResult;
  mergedInto?: string;
  reply?: string;
}

/** /api/status 里诊断页读的字段（webui/surface.ts） */
interface Status {
  version?: string;
  startedAt?: string;
  uptimeSec?: number;
  runId?: string;
  link?: { kind?: string; state?: string; reason?: string; botName?: string; since?: string };
  pet?: { onDesktop?: boolean; url?: string };
  events?: { latest?: number; dir?: string };
  log?: { level?: string; file?: boolean; dir?: string };
  conversation?: {
    turns: number;
    last: { cursor: number; via: 'typed' | 'voice'; at: string; steps: Array<{ step: Step; ms: number }>; outcome?: Outcome } | null;
    recent: { replied: number; medianReplyMs: number | null; maxReplyMs: number | null };
  } | null;
  notices?: NoticeRecord[];
}

const S = pick({
  zh: {
    nav: '运行诊断',
    group: '诊断',
    title: '运行诊断',
    subRun: '运行',
    statusTitle: '运行状态',
    subRunlog: '运行日志',
    subConfig: '配置',
    configEmpty: '没有可调的设置',
    subNotices: '通知',
    noticesTitle: '通知记录',
    noticesHint: '扩展的每条通知去了哪里、结果如何（最近 100 条）。「麦麦说了」按时间推断：交给她之后 90 秒内她的第一条主动回复。',
    noticesEmpty: '还没有通知',
    cols: { at: '时间', source: '来源', text: '内容', route: '去向', result: '结果' },
    routes: { pet: '桌宠', maibot: '麦麦' } as Record<string, string>,
    skips: { off: '关闭', 'rule-off': '规则里关掉', 'no-renderer': '认不得，只记录', empty: '内容为空' } as Record<string, string>,
    results: {
      skipped: (why: string) => `没处理（${why}）`,
      queued: () => '排队中',
      said: () => '桌宠说了',
      fellBack: (why: string) => `退回桌宠说了（${why}）`,
      merged: (when: string) => `合并到 ${when} 那条`,
      handed: () => '已交给麦麦，等她说',
      replied: (text: string) => `麦麦说了：「${text}」`,
      silent: () => '麦麦没说',
    },
    netOffline: '调试通道断开，事件流改为轮询',
    core: '核心', version: '版本', uptime: '已运行', run: '本次运行',
    link: 'MaiBot 连接', kind: '方式', state: '状态', bot: 'Bot 名字', lastReason: '断开原因', since: '已持续',
    plugin: '插件', maim: 'maim_message',
    states: { open: '已连接', connecting: '连接中', closed: '没连上' } as Record<string, string>,
    pet: '桌宠', onDesktop: '窗口', onDesktopYes: '在桌面上', onDesktopNo: '不在桌面上', petUrl: '页面服务',
    talk: '对话', turns: '本次运行', turnsValue: (n: number) => `${n} 轮`, lastTurn: '最近一轮', recent: '回复延迟',
    recentValue: (n: number, median: string, max: string) => `最近 ${n} 次回复：中位 ${median}，最慢 ${max}`,
    none: '—',
    via: { typed: '打字', voice: '语音' },
    steps: { sent: '已发出', acked: '收下', thinking: '开始思考', reply: '回复到达', bubble: '气泡显示' } as Record<Step, string>,
    outcomes: { replied: '已回复', 'no-reply': '没有回复', 'not-sent': '没发出去', disconnected: '连接断开' } as Record<Outcome, string>,
    records: '记录', eventCursor: '最新事件', logLevel: '日志级别', logFile: '文本日志', logFileOn: '写入', logFileOff: '不写',
    duration: (sec: number) => sec < 60 ? `${sec} 秒` : sec < 3600 ? `${Math.floor(sec / 60)} 分 ${sec % 60} 秒` : `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`,
  },
  en: {
    nav: 'Diagnostics',
    group: 'Diagnostics',
    title: 'Diagnostics',
    subRun: 'Run',
    statusTitle: 'Status',
    subRunlog: 'Run log',
    subConfig: 'Settings',
    configEmpty: 'Nothing to set',
    subNotices: 'Notices',
    noticesTitle: 'Notice record',
    noticesHint: 'Where each extension notice went and how it ended (last 100). "MaiBot said" is inferred by time: her first unprompted reply within 90 s of handing it over.',
    noticesEmpty: 'No notices yet',
    cols: { at: 'Time', source: 'Source', text: 'Content', route: 'To', result: 'Result' },
    routes: { pet: 'Pet', maibot: 'MaiBot' } as Record<string, string>,
    skips: { off: 'off', 'rule-off': 'off by rule', 'no-renderer': 'unknown, only recorded', empty: 'empty' } as Record<string, string>,
    results: {
      skipped: (why: string) => `Not handled (${why})`,
      queued: () => 'Waiting',
      said: () => 'The pet said it',
      fellBack: (why: string) => `The pet said it instead (${why})`,
      merged: (when: string) => `Merged into the one at ${when}`,
      handed: () => 'Handed to MaiBot, waiting',
      replied: (text: string) => `MaiBot said: "${text}"`,
      silent: () => 'MaiBot said nothing',
    },
    netOffline: 'Debug channel lost; the event stream polls instead',
    core: 'Core', version: 'Version', uptime: 'Up for', run: 'This run',
    link: 'MaiBot link', kind: 'Connection', state: 'State', bot: 'Bot name', lastReason: 'Last drop', since: 'For',
    plugin: 'plugin', maim: 'maim_message',
    states: { open: 'Connected', connecting: 'Connecting', closed: 'Not connected' } as Record<string, string>,
    pet: 'Desktop pet', onDesktop: 'Window', onDesktopYes: 'On the desktop', onDesktopNo: 'Not on the desktop', petUrl: 'Page server',
    talk: 'Conversation', turns: 'This run', turnsValue: (n: number) => `${n} turn${n === 1 ? '' : 's'}`, lastTurn: 'Last turn', recent: 'Reply time',
    recentValue: (n: number, median: string, max: string) => `last ${n} replies: median ${median}, slowest ${max}`,
    none: '—',
    via: { typed: 'typed', voice: 'voice' },
    steps: { sent: 'sent', acked: 'received', thinking: 'thinking', reply: 'reply', bubble: 'bubble' } as Record<Step, string>,
    outcomes: { replied: 'replied', 'no-reply': 'no reply', 'not-sent': 'not sent', disconnected: 'link dropped' } as Record<Outcome, string>,
    records: 'Records', eventCursor: 'Latest event', logLevel: 'Log level', logFile: 'Text logs', logFileOn: 'written', logFileOff: 'off',
    duration: (sec: number) => sec < 60 ? `${sec} s` : sec < 3600 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${Math.floor(sec / 3600)} h ${Math.floor((sec % 3600) / 60)} min`,
  },
});

const REASONS = pick({
  zh: { auth: 'token 不对', token: '没有 token', protocol: '协议版本不一致', replaced: '被另一台设备顶替', 'no-url': '还没填地址', stopped: '已停止' } as Record<string, string>,
  en: { auth: 'wrong token', token: 'no token', protocol: 'protocol version mismatch', replaced: 'replaced by another device', 'no-url': 'no address yet', stopped: 'stopped' } as Record<string, string>,
});

const ms = (n: number | null | undefined): string => (n == null ? S.none : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const since = (iso: string | undefined): string => {
  if (!iso) return S.none;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? S.none : S.duration(Math.max(0, Math.round((Date.now() - t) / 1000)));
};

export const diagnosticsFeature: FrameworkFeature = {
  route: ROUTE,
  label: S.nav,
  icon: 'activity',
  navGroup: S.group,
  mount: (ctx) => mount(ctx),
};

function mount(ctx: FeatureContext): Disposable | void {
  const { ui } = ctx;
  const doc = ctx.root.ownerDocument;
  const subs = [
    { value: 'run', label: S.subRun },
    { value: 'notices', label: S.subNotices },
    { value: 'runlog', label: S.subRunlog },
    { value: 'config', label: S.subConfig },
  ];
  const wanted = typeof ctx.route.segments[1] === 'string' ? ctx.route.segments[1] : (localStorage.getItem(LAST_SUB_KEY) ?? '');
  let current = subs.some((s) => s.value === wanted) ? wanted : 'run';

  // ── 页头 ──
  const view = ui.h('div', 'coreview');
  const head = pageIntro(ui, S.title);
  head.className = 'featureintro pagehead';
  const tabs = pageTabs(doc, ctx.signal, subs, { value: current, onSelect: (v) => show(v, true) });
  const net = ui.msgline('');
  const problem = actionProblem(ui, doc, ctx.signal);
  const exportButton = ui.button('', {
    size: 'sm',
    onClick: () => {
      void exportDiagnostics({ ui, doc, signal: ctx.signal }).catch((err: unknown) => {
        problem(exportButton, LIVE_S.exportFailed);
        ctx.onError(err);
      });
    },
  });
  exportButton.className = 'pagetabs-action';
  exportButton.append(icon(doc, 'download'), ui.h('span', null, LIVE_S.exportDiagnostics));
  tabs.el.append(net, ui.h('span', 'grow'), exportButton);
  const scroll = ui.h('div', 'scroll');
  const measure = ui.h('div', 'measure');
  scroll.append(measure);
  view.append(head, tabs.el, scroll);
  ctx.root.append(view);

  // ── 运行：状态卡 + 事件流 ──
  const card = ui.sheet({ title: S.statusTitle });
  card.el.classList.add('coopet-diag');
  const grid = ui.h('div', 'coopet-diag-grid');
  card.body.append(grid);
  const section = (title: string, rows: Array<{ k: string; v: string | HTMLElement }>): HTMLElement => {
    const box = ui.h('div', 'coopet-diag-section');
    box.append(ui.h('h4', 'coopet-diag-title', title), ui.kv(rows));
    return box;
  };
  let status: Status | null = null;
  const renderStatus = (): void => {
    const st = status;
    if (!st) return;
    const link = st.link ?? {};
    const state = link.state ?? 'closed';
    const statePill = ui.pill(S.states[state] ?? state, state === 'open' ? 'on' : state === 'closed' ? 'off' : undefined);
    const conv = st.conversation;
    const last = conv?.last;
    const lastLine = last
      ? `#${last.cursor}（${S.via[last.via]}）${last.steps.map((s) => `${S.steps[s.step]} +${ms(s.ms)}`).join(' → ')}${last.outcome ? ` · ${S.outcomes[last.outcome]}` : ''}`
      : S.none;
    const recent = conv && conv.recent.replied > 0 ? S.recentValue(conv.recent.replied, ms(conv.recent.medianReplyMs), ms(conv.recent.maxReplyMs)) : S.none;
    grid.replaceChildren(
      section(S.core, [
        { k: S.version, v: st.version ? `v${st.version}` : S.none },
        { k: S.uptime, v: st.uptimeSec != null ? S.duration(st.uptimeSec) : S.none },
        { k: S.run, v: st.runId ?? S.none },
      ]),
      section(S.link, [
        { k: S.state, v: statePill },
        { k: S.kind, v: link.kind === 'maim' ? S.maim : S.plugin },
        { k: S.bot, v: link.botName ?? S.none },
        { k: S.since, v: since(link.since) },
        ...(link.reason ? [{ k: S.lastReason, v: REASONS[link.reason] ?? link.reason }] : []),
      ]),
      section(S.pet, [
        { k: S.onDesktop, v: st.pet?.onDesktop ? S.onDesktopYes : S.onDesktopNo },
        { k: S.petUrl, v: st.pet?.url ?? S.none },
      ]),
      section(S.talk, [
        { k: S.turns, v: conv ? S.turnsValue(conv.turns) : S.none },
        { k: S.lastTurn, v: lastLine },
        { k: S.recent, v: recent },
      ]),
      section(S.records, [
        { k: S.eventCursor, v: st.events?.latest != null ? `#${st.events.latest}` : S.none },
        { k: S.logLevel, v: st.log?.level ?? S.none },
        { k: S.logFile, v: st.log?.file ? S.logFileOn : S.logFileOff },
      ]),
    );
  };
  // ── 通知：处理记录 ──
  const noticesCard = ui.sheet({ title: S.noticesTitle });
  noticesCard.el.classList.add('coopet-notices');
  const noticesList = ui.h('div', 'coopet-notices-list');
  noticesCard.body.append(ui.h('p', 'coopet-notices-hint', S.noticesHint), noticesList);
  const clock = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return S.none;
    const pad = (n: number) => String(n).padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    return d.toDateString() === new Date().toDateString() ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  };
  const renderNotices = (): void => {
    const records = status?.notices ?? [];
    if (records.length === 0) { noticesList.replaceChildren(ui.h('p', 'coopet-notices-empty', S.noticesEmpty)); return; }
    const byId = new Map(records.map((r) => [r.id, r]));
    const table = ui.h('table', 'coopet-notices-table');
    const head = ui.h('tr');
    for (const c of [S.cols.at, S.cols.source, S.cols.text, S.cols.route, S.cols.result]) head.append(ui.h('th', null, c));
    table.append(head);
    for (const r of records) {
      const result = r.result === 'skipped' ? S.results.skipped(S.skips[r.skip ?? ''] ?? r.skip ?? S.none)
        : r.result === 'said' && r.fallback ? S.results.fellBack(r.fallback)
        : r.result === 'merged' ? S.results.merged(byId.has(r.mergedInto ?? '') ? clock(byId.get(r.mergedInto!)!.at) : S.none)
        : r.result === 'replied' ? S.results.replied(r.reply ?? '')
        : r.result === 'said' ? S.results.said()
        : r.result === 'handed' ? S.results.handed()
        : r.result === 'silent' ? S.results.silent()
        : S.results.queued();
      const tone = r.result === 'skipped' || r.result === 'merged' ? 'muted' : r.fallback ? 'warn' : r.result === 'replied' || r.result === 'said' ? 'ok' : '';
      const row = ui.h('tr', tone ? `is-${tone}` : null);
      const text = ui.h('td', 'coopet-notices-text', r.text);
      text.title = r.text;
      row.append(ui.h('td', 'coopet-notices-at', clock(r.at)), ui.h('td', null, r.source), text,
        ui.h('td', null, r.route ? S.routes[r.route] ?? r.route : S.none), ui.h('td', 'coopet-notices-result', result));
      table.append(row);
    }
    noticesList.replaceChildren(table);
  };

  const readStatus = async (): Promise<void> => {
    try {
      status = await get<Status>('/api/status', { signal: ctx.signal });
      renderStatus();
      renderNotices();
    } catch (err) {
      if ((err as { name?: string } | null)?.name !== 'AbortError') ctx.onError(err);
    }
  };
  const events = createEventsView({ ui, lifecycle: ctx.lifecycle, signal: ctx.signal, onError: (err) => ctx.onError(err) });
  const runPane = ui.h('div', 'core-run');
  runPane.append(card.el, events.el);

  // ── 运行日志、配置 ──
  const runlog = createRunlogView({ ui, signal: ctx.signal, onError: (err) => ctx.onError(err) });
  const config = createConfigView({
    ui, lifecycle: ctx.lifecycle, signal: ctx.signal,
    filter: (group) => group.id === 'coopet.log',
    showOwner: false,
    emptyText: S.configEmpty,
  });

  const panes: Record<string, HTMLElement> = { run: runPane, notices: noticesCard.el, runlog: runlog.el, config: config.el };
  let debugOnline = false;
  const enter: Record<string, () => void> = {
    run: () => { renderStatus(); void readStatus(); void events.init(); events.setPolling(!debugOnline); },
    notices: () => { renderNotices(); void readStatus(); },
    runlog: () => { void runlog.refresh(); },
    config: () => { void config.load(); },
  };

  function show(sub: string, navigate: boolean): void {
    const next = subs.some((s) => s.value === sub) ? sub : 'run';
    if (next !== current && current === 'run') events.setPolling(false);
    current = next;
    tabs.setValue(current);
    try { localStorage.setItem(LAST_SUB_KEY, current); } catch { /* 存不了就不记 */ }
    measure.replaceChildren(panes[current]!);
    enter[current]?.();
    if (navigate) ctx.router.navigate([ROUTE, current]);
  }

  ctx.lifecycle.own(ctx.router.onChange((route) => {
    if (route.segments[0] !== ROUTE) return;
    const sub = typeof route.segments[1] === 'string' ? route.segments[1] : 'run';
    if (sub !== current) show(sub, false);
  }));
  ctx.lifecycle.interval(() => { if ((current === 'run' || current === 'notices') && !doc.hidden) void readStatus(); }, POLL_MS);

  if (ctx.capabilities.debug === true) {
    openFrameworkSocket({
      path: '/ws/debug',
      lifecycle: ctx.lifecycle,
      env: browserSocketEnv(window),
      onNet: (online) => {
        debugOnline = online;
        net.className = online ? 'msgline' : 'msgline bad';
        net.textContent = online ? '' : S.netOffline;
        if (current === 'run') events.setPolling(!online);
      },
      onError: (err) => ctx.onError(err),
      onFrame: (f) => {
        if (f.t === 'event' && current === 'run') void events.poll();
        else if (f.t === 'runlog' && current === 'runlog') runlog.noteLive();
      },
    });
  }

  show(current, false);
}
