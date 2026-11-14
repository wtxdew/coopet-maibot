/**
 * 开发入口：读配置，启动桌宠，按 `link.kind` 连上 MaiBot（插件或 maim_message），
 * 由 Conductor 把你在桌宠里说的话发给麦麦、把她的回复显示在气泡里。
 *
 * 运行：在仓库根目录 `corepack pnpm dev`（只有核心和桌宠窗口），或 `corepack pnpm app`（由外壳启动，见 coopet-app）。
 * Ctrl+C 退出（会关掉 Electron 窗口）。被外壳启动时经 IPC 上报状态、接收指令（runtime/supervisor.ts）。
 */

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { Conductor } from './conductor/conductor.ts';
import { createDecorator } from './expr/decorate.ts';
import { CoopetPluginLink } from './link/coopet-plugin.ts';
import { MaimLegacyLink } from './link/maim-legacy.ts';
import type { Link } from './link/types.ts';
import { LinkSwitch } from './link/switch.ts';
import { coopetDirs, deviceId, LEGACY_DATA_ROOT, loadConfig, migrateLegacyData, ROUTE_DEFAULTS, type CoopetConfig, type CoopetDirs } from './runtime/config.ts';
import { openEventLog } from './runtime/event-store.ts';
import { consoleLogger, DailyFileSink, switchableSink } from './runtime/log.ts';
import { openRunlog } from './runtime/runlog.ts';
import type { Logger } from 'cortico/core/types.ts';
import { startPet } from './runtime/pet.ts';
import { connectSupervisor } from './runtime/supervisor.ts';
import { DisconnectedLink } from './link/disconnected.ts';
import { WebApp } from 'cortico/web/server.ts';
import { createSurface } from './webui/surface.ts';
import { prepareWebAssets } from './webui/assets.ts';
import { extensionWorlds } from './webui/extension-worlds.ts';
import { routeGroup } from './webui/route-settings.ts';
import { loadWorldExtensions } from './runtime/extensions.ts';
import { WorldRuntime } from './runtime/worlds.ts';
import { SecretStore } from './runtime/secrets.ts';
import { parseStep, sayUpdates } from './runtime/updates.ts';
import { canSelfUpdate } from './webui/update-settings.ts';
import { join } from 'node:path';

const PLATFORM = 'coopet';
const CLIENT_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const dirs = coopetDirs();
// 数据目录换成各系统的惯例位置后，第一次启动时把 ~/.config/coopet 的内容拷贝过来（旧目录原样保留）
const migratedFrom = migrateLegacyData(dirs.root) ? LEGACY_DATA_ROOT : null;
// 读配置时还不知道日志级别和要不要写文件：这一步的提示只写到终端
const { cfg, persistPet, persist, flush, worldSection, persistWorld } = loadConfig(dirs, { log: consoleLogger('coopet') });
// 本次运行的结构化日志（设置窗「运行诊断」读它），和 Cortico 的格式一致
const runlog = openRunlog(dirs.data);
// 级别和写不写文本文件每次现读配置：设置窗里改了马上生效
const log = consoleLogger('coopet', () => cfg.log.level, [switchableSink(new DailyFileSink(dirs.logs), () => cfg.log.file), runlog.sink]);
log.info(`Coopet 启动（v${CLIENT_VERSION}，运行 ${runlog.runId}，连接方式 ${cfg.link.kind}，日志级别 ${cfg.log.level}${cfg.log.file ? `，日志文件 ${dirs.logs}` : ''}）`);
// 外壳设了 COOPET_SYSTEM_PROXY（没有自己的代理变量）时，fetch 按地址问外壳系统代理怎么走：mihomo 这类开着系统代理时，
// ntfy、下载语音模型也走它。在任何请求之前装上；连 MaiBot 的 WebSocket 不经过这里
if (process.env.COOPET_SYSTEM_PROXY === '1') {
  const { SystemProxy, askAppProcess, installSystemProxy } = await import('./runtime/system-proxy.ts');
  const proxyLog = log.child('proxy');
  await installSystemProxy(new SystemProxy(askAppProcess(), (line) => proxyLog.info(line)));
}
if (migratedFrom) log.info(`已把 ${migratedFrom} 的数据拷贝到 ${dirs.root}（旧目录原样保留，确认没问题后可以自己删掉）`);
// 事件写进文件，重启后对话页还能看到以前的记录
const store = openEventLog(dirs.events, { onWriteError: (err) => log.warn(`事件记录写不了（${dirs.events}），之后只留在内存里：${err.message}`) });

/** 被外壳启动时才有；直接 dev 运行时为 null */
const shell = connectSupervisor();

/** 可替换：设置窗改了连接设置后换上新连接，不重启（applyLink） */
const link = new LinkSwitch(createLink(cfg, dirs, log.child('link')));
/** 最近一次关闭的原因（设置窗的连接卡显示）；连上后清掉 */
let linkReason: string | undefined;
/** 连接进入当前状态的时刻（运行诊断显示"已持续多久"） */
let linkSince = new Date().toISOString();
const STARTED_AT = new Date().toISOString();
async function applyLink(): Promise<void> {
  linkReason = undefined;
  await link.replace(createLink(cfg, dirs, log.child('link')));
}
/** 连上插件后用 MaiBot 设置里的名字；不知道时用本地配置的 botName */
const botName = (): string => link.botName?.() ?? cfg.botName;
link.onState((s, reason) => {
  linkSince = new Date().toISOString();
  if (s === 'open') linkReason = undefined;
  else if (s === 'closed' && reason && reason !== 'switching') linkReason = reason;
  log.info(`MaiBot 连接（${cfg.link.kind}）：${s}${reason ? `（${reason}）` : ''}`);
  shell?.send({ type: 'link', kind: cfg.link.kind, state: s, ...(reason ? { reason } : {}), botName: botName() });
});

// Conductor 要用 pet，pet 的事件又要交给 Conductor：先占位，pet 启动后再接上
let conductor: Conductor | null = null;

/** 密钥文件：桌宠（语音转写服务的 API Key）和 World 扩展（例如 ntfy 的 token）共用 */
const secrets = new SecretStore(join(dirs.root, 'secrets.json'));

const pet = await startPet({
  cfg: cfg.pet,
  persist: persistPet,
  dirs,
  secrets,
  store,
  log,
  botName,
  language: () => cfg.language,
  onEvent: (e) => conductor?.handle(e),
  // 桌宠菜单里的"退出""设置"：交给外壳；直接 dev 运行时没有这两个按钮
  ...(shell ? {
    controls: {
      quit: () => shell.send({ type: 'quit' }),
      // 跟着界面语言：中文（简繁）显示中文，其他显示英文
      quitLabel: () => (cfg.language === 'zh' || cfg.language === 'zh-Hant' ? '退出 Coopet' : 'Quit Coopet'),
      openSettings: () => shell.send({ type: 'open-settings' }),
      // 菜单的「装扮」、气泡的展开键、「我的 World」悬停按钮：打开设置窗的对应页面
      openDress: () => shell.send({ type: 'open-settings', route: '#/dress' }),
      openChat: () => shell.send({ type: 'open-settings', route: '#/chat' }),
      openWorlds: () => shell.send({ type: 'open-settings', route: '#/world' }),
    },
  } : {}),
  onDesktopChange: (onDesktop) => shell?.send({ type: 'pet', onDesktop }),
});

conductor = new Conductor({
  pet, link, log: log.child('conductor'), botName, decorate: createDecorator(),
  routeOf: (worldId) => cfg.routes[worldId] ?? ROUTE_DEFAULTS,
  language: () => cfg.language,
});
link.start();

// World 扩展：从 ~/.config/coopet/extensions 加载（Cortico 的加载器），启用的启动起来；事件交给 Conductor 路由
const extensions = await loadWorldExtensions(dirs, log.child('extensions'));
const worlds = new WorldRuntime({
  definitions: extensions.worlds,
  config: { worldSection, persistWorld },
  secrets,
  dirs, store, log: log.child('worlds'), botName,
  onEvent: (worldId, e) => conductor?.worldEvent(worldId, e),
});
await worlds.startAll();

/** 设置窗的后端（只在被外壳启动时开）：只监听 127.0.0.1，端口由系统分配 */
let web: WebApp | null = null;

/** 更新器（外壳的 updater.cjs）每一步的气泡；只在被外壳启动时有 */
const updates = shell ? sayUpdates({
  pet: () => pet,
  language: () => cfg.language,
  install: () => shell.send({ type: 'update-install' }),
  releases: () => shell.send({ type: 'releases' }),
  log: log.child('update'),
}) : null;

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`收到 ${signal}，正在退出`);
  try {
    conductor?.stop();
    updates?.stop();
    await link.stop();
    await web?.stop();
    await worlds.stopAll();
    await pet.stop();
  } finally {
    flush();
    runlog.close(signal, store.latestCursor());
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (shell) {
  shell.onMessage((m) => {
    if (m.type === 'show-pet') void pet.show();
    else if (m.type === 'hide-pet') void pet.hide();
    else if (m.type === 'toggle-pet') void pet.toggle();
    else if (m.type === 'click-through') {
      log.info(`鼠标穿透：${m.on ? '开' : '关'}`);
      void pet.setClickThrough(m.on === true).catch((err: Error) => log.warn(`鼠标穿透没设上：${err.message}`));
    }
    else if (m.type === 'shutdown') void shutdown('外壳要求退出');
    else if (m.type === 'update') {
      const step = parseStep(m.step);
      if (step !== undefined) updates?.take(step);
    }
  });
  // 能自己装更新的版本：把保存的自动更新开关告诉外壳，外壳据此启动更新器
  if (canSelfUpdate()) shell.send({ type: 'auto-update', enabled: cfg.update.auto });
  // 外壳主进程没了（崩溃或被强制结束）：核心也退出，不留孤儿进程
  shell.onDisconnect(() => void shutdown('外壳断开'));
  const webLog = log.child('webui');
  web = new WebApp(createSurface({
    cfg, persist, persistPet, pet, store, dirs, log: webLog, botName,
    onLanguage: (language) => shell.send({ type: 'language', language }),
    onAutoUpdate: (enabled) => shell.send({ type: 'auto-update', enabled }),
    link: () => ({ kind: cfg.link.kind, state: link.state(), since: linkSince, ...(linkReason ? { reason: linkReason } : {}), ...(link.botName() ? { botName: link.botName() } : {}) }),
    runlog, version: CLIENT_VERSION, startedAt: STARTED_AT,
    conversation: () => conductor?.stats() ?? null,
    applyLink,
    extensions: extensionWorlds({
      runtime: worlds, persistWorld, records: extensions.records,
      extraConfig: (worldId, language) => [routeGroup(worldId, language)],
    }),
    activation: { set: (id, enabled) => worlds.set(id, enabled), restart: (id) => worlds.restart(id) },
    webDistDir: prepareWebAssets(dirs.data, webLog, undefined, extensions.webUiAssets),
  }));
  const webPort = await web.start(0);
  log.info(`设置窗后端：http://127.0.0.1:${webPort}/`);
  shell.send({ type: 'ready', petOrigin: pet.origin, webPort, language: cfg.language });
}

function createLink(config: CoopetConfig, d: CoopetDirs, linkLog: Logger): Link {
  if (config.link.kind === 'plugin') {
    const plugin = config.link.plugin;
    if (!plugin.url) return disconnected(`在设置里填插件地址（或 ${d.configFile} 的 link.plugin.url），例如 ws://<MaiBot 主机>:18100/ws`);
    return new CoopetPluginLink({
      url: plugin.url,
      tokenFile: plugin.tokenFile,
      deviceId: deviceId(d),
      deviceName: hostname(),
      clientVersion: CLIENT_VERSION,
      log: linkLog,
    });
  }
  const maim = config.link.maim;
  if (!maim.url) return disconnected(`在设置里填 maim_message 地址（或 ${d.configFile} 的 link.maim.url），例如 ws://<NAS 地址>:<WebUI 端口>/maim/<Bot ID>/ws`);
  return new MaimLegacyLink({
    url: maim.url,
    tokenFile: maim.tokenFile,
    platform: PLATFORM,
    botAccount: maim.botAccount,
    user: { id: maim.userId, nickname: maim.userNickname },
    log: linkLog,
  });
}

/** 没填地址：不退出，用占位连接照常运行，配置窗还能打开去填。 */
function disconnected(hint: string): Link {
  log.error(`还没配置 MaiBot 的地址：${hint}`);
  return new DisconnectedLink();
}
