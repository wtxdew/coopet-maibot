/**
 * 开发入口：读配置，启动桌宠，按 `link.kind` 连上 MaiBot（插件或 maim_message），
 * 由 Conductor 把你在桌宠里说的话发给麦麦、把她的回复显示在气泡里。
 *
 * 运行：在仓库根目录 `corepack pnpm dev`；Ctrl+C 退出（会关掉 Electron 窗口）。
 */

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { Conductor } from './conductor/conductor.ts';
import { createDecorator } from './expr/decorate.ts';
import { CoopetPluginLink } from './link/coopet-plugin.ts';
import { MaimLegacyLink } from './link/maim-legacy.ts';
import type { Link } from './link/types.ts';
import { coopetDirs, deviceId, loadConfig, type CoopetConfig, type CoopetDirs } from './runtime/config.ts';
import { MemoryEventStore } from './runtime/event-store.ts';
import { consoleLogger } from './runtime/log.ts';
import type { Logger } from 'cortico/core/types.ts';
import { startPet } from './runtime/pet.ts';

const PLATFORM = 'coopet';
const CLIENT_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const log = consoleLogger('coopet');
const dirs = coopetDirs();
const { cfg, persistPet, flush } = loadConfig(dirs, { log });
const store = new MemoryEventStore();

const link = createLink(cfg, dirs, log.child('link'));
link.onState((s, reason) => log.info(`MaiBot 连接（${cfg.link.kind}）：${s}${reason ? `（${reason}）` : ''}`));
/** 连上插件后用 MaiBot 设置里的名字；不知道时用本地配置的 botName */
const botName = (): string => link.botName?.() ?? cfg.botName;

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
