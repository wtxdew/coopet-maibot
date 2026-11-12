/**
 * 阶段 1 的开发入口：读配置、启动桌宠，窗口连上后说一句话验证气泡和表情。
 * 桌宠推出的事件先只打日志；之后换成 Conductor + link。
 *
 * 运行：在仓库根目录 `corepack pnpm dev`；Ctrl+C 退出（会关掉 Electron 窗口）。
 */

import type { ToolOutcome } from 'cortico/core/types.ts';
import { coopetDirs, loadConfig } from './runtime/config.ts';
import { MemoryEventStore } from './runtime/event-store.ts';
import { consoleLogger } from './runtime/log.ts';
import { startPet, type PetHandle } from './runtime/pet.ts';

const GREETING = '【开心】你好呀<点头>，我是麦麦！';
const CONNECT_WAIT_MS = 30_000;

const log = consoleLogger('coopet');
const dirs = coopetDirs();
const { cfg, persistPet, flush } = loadConfig(dirs, { log });
const store = new MemoryEventStore();

const pet = await startPet({
  cfg: cfg.pet,
  persist: persistPet,
  dirs,
  store,
  log,
  botName: () => '麦麦',
  onEvent: ({ event, trigger }) => {
    const text = typeof event.meta?.text === 'string' ? event.meta.text : '';
    log.info(`事件 #${event.cursor} ${event.type}${trigger ? ` (${trigger})` : ''}${text ? `：${text}` : ''}`);
  },
});

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log.info(`收到 ${signal}，正在退出`);
  try {
    await pet.stop();
  } finally {
    flush();
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await greetWhenConnected(pet);

/** 窗口连上页面前 pet_say 会如实失败；每秒重试，直到成功或超时。 */
async function greetWhenConnected(p: PetHandle): Promise<void> {
  const deadline = Date.now() + CONNECT_WAIT_MS;
  while (!stopping && Date.now() < deadline) {
    const out = await p.call('pet_say', { script: GREETING });
    const outcome: ToolOutcome = typeof out === 'string' ? { text: out } : out;
    if (!outcome.failed) {
      log.info('窗口已连上，打过招呼了');
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!stopping) log.warn(`${CONNECT_WAIT_MS / 1000} 秒内窗口没有连上页面，检查 Electron 是否启动`);
}
