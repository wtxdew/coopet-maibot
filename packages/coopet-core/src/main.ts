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
import { coopetDirs, deviceId, loadConfig, type CoopetConfig, type CoopetDirs } from './runtime/config.ts';
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
import { join } from 'node:path';

const PLATFORM = 'coopet';
const CLIENT_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const dirs = coopetDirs();
// 读配置时还不知道日志级别和要不要写文件：这一步的提示只写到终端
const { cfg, persistPet, persist, flush, worldSection, persistWorld } = loadConfig(dirs, { log: consoleLogger('coopet') });
// 本次运行的结构化日志（设置窗「运行诊断」读它），和 Cortico 的格式一致
const runlog = openRunlog(dirs.data);
// 级别和写不写文本文件每次现读配置：设置窗里改了马上生效
const log = consoleLogger('coopet', () => cfg.log.level, [switchableSink(new DailyFileSink(dirs.logs), () => cfg.log.file), runlog.sink]);
log.info(`Coopet 启动（v${CLIENT_VERSION}，运行 ${runlog.runId}，连接方式 ${cfg.link.kind}，日志级别 ${cfg.log.level}${cfg.log.file ? `，日志文件 ${dirs.logs}` : ''}）`);
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

const pet = await startPet({
  cfg: cfg.pet,
  persist: persistPet,
  dirs,
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
  routeOf: (worldId) => cfg.routes[worldId]?.mode ?? 'auto',
  language: () => cfg.language,
});
link.start();

// World 扩展：从 ~/.config/coopet/extensions 加载（Cortico 的加载器），启用的启动起来；事件交给 Conductor 路由
const extensions = await loadWorldExtensions(dirs, log.child('extensions'));
const worlds = new WorldRuntime({
  definitions: extensions.worlds,
  config: { worldSection, persistWorld },
  secrets: new SecretStore(join(dirs.root, 'secrets.json')),
  dirs, store, log: log.child('worlds'), botName,
  onEvent: (worldId, e) => conductor?.worldEvent(worldId, e),
});
await worlds.startAll();

/** 设置窗的后端（只在被外壳启动时开）：只监听 127.0.0.1，端口由系统分配 */
let web: WebApp | null = null;

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`收到 ${signal}，正在退出`);
  try {
    conductor?.stop();
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
    else if (m.type === 'shutdown') void shutdown('外壳要求退出');
  });
  // 外壳主进程没了（崩溃或被强制结束）：核心也退出，不留孤儿进程
  shell.onDisconnect(() => void shutdown('外壳断开'));
  const webLog = log.child('webui');
  web = new WebApp(createSurface({
    cfg, persist, persistPet, pet, store, dirs, log: webLog, botName,
    onLanguage: (language) => shell.send({ type: 'language', language }),
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
