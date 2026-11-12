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

const PLATFORM = 'coopet';
const CLIENT_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const dirs = coopetDirs();
// 读配置时还不知道日志级别和要不要写文件：这一步的提示只写到终端
const { cfg, persistPet, flush } = loadConfig(dirs, { log: consoleLogger('coopet') });
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
  // 桌宠菜单里的"退出"：交给外壳退出整个应用；直接 dev 运行时没有这个按钮
  ...(shell ? { controls: { quit: () => shell.send({ type: 'quit' }), quitLabel: '退出 Coopet' } } : {}),
  onDesktopChange: (onDesktop) => shell?.send({ type: 'pet', onDesktop }),
});

conductor = new Conductor({ pet, link, log: log.child('conductor'), botName, decorate: createDecorator() });
link.start();

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`收到 ${signal}，正在退出`);
  try {
    conductor?.stop();
    await link.stop();
    await pet.stop();
  } finally {
    flush();
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
  shell.send({ type: 'ready', petOrigin: pet.origin });
}

function createLink(config: CoopetConfig, d: CoopetDirs, linkLog: Logger): Link {
  if (config.link.kind === 'plugin') {
    const plugin = config.link.plugin;
    if (!plugin.url) exitWithHint(`在 ${d.configFile} 里填 link.plugin.url，例如 ws://<MaiBot 主机>:18100/ws`);
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
  if (!maim.url) exitWithHint(`在 ${d.configFile} 里填 link.maim.url，例如 ws://<NAS 地址>:<WebUI 端口>/maim/<Bot ID>/ws`);
  return new MaimLegacyLink({
    url: maim.url,
    tokenFile: maim.tokenFile,
    platform: PLATFORM,
    botAccount: maim.botAccount,
    user: { id: maim.userId, nickname: maim.userNickname },
    log: linkLog,
  });
}

function exitWithHint(hint: string): never {
  log.error(`还没配置 MaiBot 的地址：${hint}`);
  process.exit(1);
}
