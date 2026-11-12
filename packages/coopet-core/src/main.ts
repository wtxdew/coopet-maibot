/**
 * 阶段 1 的开发入口：读配置，启动桌宠，经 maim_message 旧版 WS 连上 MaiBot，
 * 由 Conductor 把你在桌宠里说的话发给麦麦、把她的回复显示在气泡里。
 *
 * 运行：在仓库根目录 `corepack pnpm dev`；Ctrl+C 退出（会关掉 Electron 窗口）。
 */

import { Conductor } from './conductor/conductor.ts';
import { MaimLegacyLink } from './link/maim-legacy.ts';
import { coopetDirs, loadConfig } from './runtime/config.ts';
import { MemoryEventStore } from './runtime/event-store.ts';
import { consoleLogger } from './runtime/log.ts';
import { startPet } from './runtime/pet.ts';

const PLATFORM = 'coopet';
const BOT_NAME = '麦麦';

const log = consoleLogger('coopet');
const dirs = coopetDirs();
const { cfg, persistPet, flush } = loadConfig(dirs, { log });
const store = new MemoryEventStore();

const link = new MaimLegacyLink({
  url: cfg.link.url,
  tokenFile: cfg.link.tokenFile,
  platform: PLATFORM,
  botAccount: cfg.link.botAccount,
  user: { id: cfg.link.userId, nickname: cfg.link.userNickname },
  log: log.child('link'),
});
link.onState((s, reason) => log.info(`MaiBot 连接：${s}${reason ? `（${reason}）` : ''}`));

// Conductor 要用 pet，pet 的事件又要交给 Conductor：先占位，pet 启动后再接上
let conductor: Conductor | null = null;

const pet = await startPet({
  cfg: cfg.pet,
  persist: persistPet,
  dirs,
  store,
  log,
  botName: () => BOT_NAME,
  onEvent: (e) => conductor?.handle(e),
});

conductor = new Conductor({ pet, link, log: log.child('conductor'), botName: () => BOT_NAME });
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
