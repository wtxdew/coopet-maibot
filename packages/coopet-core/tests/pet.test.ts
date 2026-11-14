import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ToolOutcome } from 'cortico/core/types.ts';
import { coopetDirs, loadConfig } from '../src/runtime/config.ts';
import { MemoryEventStore } from '../src/runtime/event-store.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { ASR_API_KEY_SECRET, startPet } from '../src/runtime/pet.ts';

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

  // 配置的端口被别的程序（例如同时开着的 Coopanion）占着：页面服务换到下一个端口，origin 要跟着实际端口走，
  // 否则外壳按配置端口放行，设置窗里的装扮页被拒（403，空白）
  it('reports the port it actually bound when the configured one is taken', async () => {
    const dirs = coopetDirs(mkdtempSync(join(tmpdir(), 'coopet-pet-')));
    const { cfg, persistPet, flush } = loadConfig(dirs);
    cfg.pet.window.enabled = false;
    const taken = createServer();
    await new Promise<void>((done, fail) => { taken.once('error', fail); taken.listen(0, '127.0.0.1', () => done()); });
    cfg.pet.port = (taken.address() as { port: number }).port;
    try {
      const pet = await startPet({
        cfg: cfg.pet, persist: persistPet, dirs, store: new MemoryEventStore(),
        log: consoleLogger('test', 'warn'), onEvent: () => {}, botName: () => '麦麦', language: () => 'zh',
      });
      try {
        const port = Number(new URL(pet.origin).port);
        expect(port).toBeGreaterThan(cfg.pet.port);
        expect(pet.origin).toBe(`http://127.0.0.1:${port}`);
      } finally {
        await pet.stop();
      }
    } finally {
      await new Promise<void>((done) => taken.close(() => done()));
      flush();
    }
  });

  // 「语音输入」页选转写服务时填的 API Key 存进 Coopet 的密钥文件；面板只看到存没存
  it('keeps the transcription API key in the secret store', async () => {
    const dirs = coopetDirs(mkdtempSync(join(tmpdir(), 'coopet-pet-')));
    const { cfg, persistPet, flush } = loadConfig(dirs);
    cfg.pet.window.enabled = false;
    cfg.pet.port = await freePort();
    const saved = new Map<string, string>();
    const secrets = { get: (name: string) => saved.get(name) ?? '', set: (name: string, value: string) => { saved.set(name, value); } };
    const pet = await startPet({
      cfg: cfg.pet, persist: persistPet, dirs, store: new MemoryEventStore(), secrets,
      log: consoleLogger('test', 'warn'), onEvent: () => {}, botName: () => '麦麦', language: () => 'zh',
    });
    try {
      const voice = (state: unknown) => (state as { api: { keySaved: boolean; baseUrl: string } }).api;
      const invoke = pet.webUi('zh').invoke!;
      expect(voice(await invoke('voice', 'setApi', [{ baseUrl: 'https://asr.example/v1', key: ' sk-test ' }]))).toMatchObject({ keySaved: true, baseUrl: 'https://asr.example/v1' });
      expect(saved.get(ASR_API_KEY_SECRET)).toBe('sk-test');
      expect(JSON.stringify(await invoke('voice', 'state', []))).not.toContain('sk-test');
    } finally {
      await pet.stop();
      flush();
    }
  });
});
