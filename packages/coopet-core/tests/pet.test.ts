import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolOutcome } from 'cortico/core/types.ts';
import { coopetDirs, loadConfig } from '../src/runtime/config.ts';
import { MemoryEventStore } from '../src/runtime/event-store.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { startPet } from '../src/runtime/pet.ts';

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

// 不开窗口，只验证 World 能在我们的宿主里启动、停止，工具调用能走通。
describe('startPet (no window)', () => {
  it('starts, routes a tool call and stops', async () => {
    const dirs = coopetDirs(mkdtempSync(join(tmpdir(), 'coopet-pet-')));
    const { cfg, persistPet, flush } = loadConfig(dirs);
    cfg.pet.window.enabled = false;
    cfg.pet.port = await freePort();
    const store = new MemoryEventStore();
    const pet = await startPet({
      cfg: cfg.pet, persist: persistPet, dirs, store,
      log: consoleLogger('test', 'warn'), onEvent: () => {}, botName: () => '麦麦', language: () => 'zh',
    });
    try {
      // 没有页面连着：pet_say 如实返回失败
      const out = await pet.call('pet_say', { script: '你好' }) as ToolOutcome;
      expect(out.failed).toBe(true);
      await expect(pet.call('no_such_tool', {})).rejects.toThrow(/没有工具/);
      pet.phase({ state: 'model', running: [] });
      pet.phase({ state: 'idle', running: [] });
      pet.turnEnded();
    } finally {
      await pet.stop();
      flush();
    }
  });
});
