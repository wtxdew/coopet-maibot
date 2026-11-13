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
import { coopetDirs, deviceId, loadConfig, type CoopetConfig, type CoopetDirs } from './runtime/config.ts';
import { openEventLog } from './runtime/event-store.ts';
import { consoleLogger, DailyFileSink } from './runtime/log.ts';
import type { Logger } from 'cortico/core/types.ts';
import { startPet } from './runtime/pet.ts';
import { connectSupervisor } from './runtime/supervisor.ts';
import { ChatBridge } from './runtime/chat-bridge.ts';
import { DisconnectedLink } from './link/disconnected.ts';
import { SettingsService, type SavePatch, type TestRequest } from './settings/service.ts';
import { WebApp } from 'cortico/web/server.ts';
import { createSurface } from './webui/surface.ts';
import { prepareWebAssets } from './webui/assets.ts';

const PLATFORM = 'coopet';
const CLIENT_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const dirs = coopetDirs();
// 读配置时还不知道日志级别和要不要写文件：这一步的提示只写到终端
const { cfg, persistPet, persist, flush } = loadConfig(dirs, { log: consoleLogger('coopet') });
const log = consoleLogger('coopet', cfg.log.level, cfg.log.file ? new DailyFileSink(dirs.logs) : undefined);
log.info(`Coopet 启动（v${CLIENT_VERSION}，连接方式 ${cfg.link.kind}，日志级别 ${cfg.log.level}${cfg.log.file ? `，日志文件 ${dirs.logs}` : ''}）`);
// 事件写进文件，重启后对话页还能看到以前的记录
const store = openEventLog(dirs.events, { onWriteError: (err) => log.warn(`事件记录写不了（${dirs.events}），之后只留在内存里：${err.message}`) });

/** 被外壳启动时才有；直接 dev 运行时为 null */
const shell = connectSupervisor();

const link = createLink(cfg, dirs, log.child('link'));
/** 连上插件后用 MaiBot 设置里的名字；不知道时用本地配置的 botName */
const botName = (): string => link.botName?.() ?? cfg.botName;
link.onState((s, reason) => {
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
  onEvent: (e) => conductor?.handle(e),
  // 桌宠菜单里的"退出""设置"：交给外壳；直接 dev 运行时没有这两个按钮
  ...(shell ? {
    controls: {
      quit: () => shell.send({ type: 'quit' }),
      quitLabel: '退出 Coopet',
      openSettings: () => shell.send({ type: 'open-settings' }),
    },
  } : {}),
  onDesktopChange: (onDesktop) => shell?.send({ type: 'pet', onDesktop }),
});

conductor = new Conductor({ pet, link, log: log.child('conductor'), botName, decorate: createDecorator() });
link.start();

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
    await pet.stop();
  } finally {
    flush();
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

if (shell) {
  const settings = new SettingsService({
    cfg, persist, persistPet, pet, log: log.child('settings'),
    makeTestLink: (req) => req.kind === 'plugin'
      ? new CoopetPluginLink({ url: req.url, tokenFile: req.tokenFile, ...(req.token ? { token: req.token } : {}), deviceId: deviceId(dirs), deviceName: hostname(), clientVersion: CLIENT_VERSION, log: log.child('test-link') })
      : new MaimLegacyLink({ url: req.url, tokenFile: req.tokenFile, ...(req.token ? { token: req.token } : {}), platform: PLATFORM, botAccount: cfg.link.maim.botAccount, user: { id: cfg.link.maim.userId, nickname: cfg.link.maim.userNickname }, log: log.child('test-link') }),
  });
  shell.onRequest(async (method, params) => {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'settings.get': return settings.get();
      case 'settings.save': return settings.save(p as SavePatch);
      case 'settings.saveToken': return settings.saveToken(p.kind === 'plugin' ? 'plugin' : 'maim', String(p.token ?? ''));
      case 'settings.testConnection': {
        const result = await settings.testConnection(p as unknown as TestRequest);
        // 插件同时只接一台设备：测试连接会把正在用的连接顶掉（4003，不自动重连），测完把它接回来
        if (link.state() === 'closed') link.start();
        return result;
      }
      default: throw new Error(`不认识的请求：${method}`);
    }
  });

  const chats = new ChatBridge((socket) => pet.openChat(socket), (m) => shell.send(m));
  shell.onMessage((m) => {
    if (m.type === 'show-pet') void pet.show();
    else if (m.type === 'hide-pet') void pet.hide();
    else if (m.type === 'toggle-pet') void pet.toggle();
    else if (m.type === 'chat-open') chats.open(m.streamId);
    else if (m.type === 'chat-message') chats.message(m.streamId, m.text);
    else if (m.type === 'chat-close') chats.close(m.streamId);
    else if (m.type === 'shutdown') { chats.closeAll(); void shutdown('外壳要求退出'); }
  });
  // 外壳主进程没了（崩溃或被强制结束）：核心也退出，不留孤儿进程
  shell.onDisconnect(() => void shutdown('外壳断开'));
  const webLog = log.child('webui');
  web = new WebApp(createSurface({
    petCfg: cfg.pet, persistPet, pet, store, dirs, log: webLog, botName,
    link: () => ({ kind: cfg.link.kind, state: link.state() }),
    webDistDir: prepareWebAssets(dirs.data, webLog),
  }));
  const webPort = await web.start(0);
  log.info(`设置窗后端：http://127.0.0.1:${webPort}/`);
  shell.send({ type: 'ready', petOrigin: pet.origin, webPort });
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
