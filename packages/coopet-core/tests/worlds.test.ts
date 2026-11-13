import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { World, WorldHost } from 'cortico/core/types.ts';
import type { WorldContext, WorldDefinition, WorldSection } from 'cortico/world.ts';
import { coopetDirs, loadConfig } from '../src/runtime/config.ts';
import { MemoryEventStore } from '../src/runtime/event-store.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { SecretStore } from '../src/runtime/secrets.ts';
import { WorldRuntime } from '../src/runtime/worlds.ts';
import type { HostedEvent } from '../src/runtime/world-host.ts';

interface NotifySection extends WorldSection { greeting: string }

/** 假扩展：启动时记下上下文和宿主，可以推事件 */
function fakeDefinition(opts: { failStart?: boolean } = {}) {
  const made: Array<{ ctx: WorldContext<NotifySection>; host?: WorldHost; stopped: boolean }> = [];
  const def: WorldDefinition<NotifySection> = {
    id: 'notify',
    label: '通知',
    defaults: () => ({ enabled: false, greeting: 'hi' }),
    create(ctx) {
      const rec: { ctx: WorldContext<NotifySection>; host?: WorldHost; stopped: boolean } = { ctx, stopped: false };
      made.push(rec);
      const world: World = {
        id: 'notify',
        tools: () => [],
        envPromptVars: () => ({}),
        async start(host: WorldHost) {
          if (opts.failStart) throw new Error('端口被占用');
          rec.host = host;
        },
        async stop() { rec.stopped = true; },
      } as unknown as World;
      return world;
    },
  };
  return { def: def as unknown as WorldDefinition<WorldSection>, made };
}

function setup(file: object = {}, opts: { failStart?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'coopet-worlds-'));
  const dirs = coopetDirs(root);
  writeFileSync(dirs.configFile, JSON.stringify(file));
  const loaded = loadConfig(dirs, { debounceMs: 60_000 });
  const fake = fakeDefinition(opts);
  const events: Array<{ worldId: string; e: HostedEvent }> = [];
  const runtime = new WorldRuntime({
    definitions: [fake.def],
    config: loaded,
    secrets: new SecretStore(join(root, 'secrets.json'), {}),
    dirs, store: new MemoryEventStore(), log: consoleLogger('test', 'error'),
    botName: () => '麦麦', timezone: 'Asia/Shanghai',
    onEvent: (worldId, e) => events.push({ worldId, e }),
  });
  return { root, dirs, loaded, runtime, ...fake, events };
}

describe('WorldRuntime', () => {
  it('starts only enabled worlds, with a context that reads live config and secrets', async () => {
    const t = setup({ worlds: { notify: { enabled: true, greeting: 'yo' } } });
    await t.runtime.startAll();
    expect(t.made).toHaveLength(1);
    const { ctx } = t.made[0];
    expect(ctx.cfg).toMatchObject({ enabled: true, greeting: 'yo' });
    expect(ctx.botName).toBe('麦麦');
    expect(existsSync(ctx.dataDir)).toBe(true);
    ctx.storeSecret('TOKEN', 'abc');
    expect(ctx.secret('TOKEN')).toBe('abc');
    ctx.persist({ greeting: 'hey' });
    expect(ctx.cfg.greeting).toBe('hey');
    expect(t.runtime.list()).toEqual([{ id: 'notify', label: '通知', enabled: true, running: true }]);
  });

  it('hands pushed events to onEvent with the world id', async () => {
    const t = setup({ worlds: { notify: { enabled: true } } });
    await t.runtime.startAll();
    await t.made[0].host!.pushEvent({ type: 'notify.ping', source: 'notify', ts: '2026-11-13T10:00:00+08:00', text: 'ping' });
    await new Promise((r) => setImmediate(r));
    expect(t.events).toHaveLength(1);
    expect(t.events[0]).toMatchObject({ worldId: 'notify', e: { event: { type: 'notify.ping', text: 'ping' } } });
  });

  it('enables, disables and restarts without touching other worlds, writing enabled back', async () => {
    const t = setup();
    await t.runtime.startAll();
    expect(t.made).toHaveLength(0);
    expect(await t.runtime.set('notify', true)).toContain('已启用');
    expect(t.runtime.instance('notify')).not.toBeNull();
    await t.runtime.restart('notify');
    expect(t.made).toHaveLength(2);
    expect(t.made[0].stopped).toBe(true);
    await t.runtime.set('notify', false);
    expect(t.made[1].stopped).toBe(true);
    expect(t.runtime.instance('notify')).toBeNull();
    t.loaded.flush();
    await expect(t.runtime.set('nope', true)).rejects.toThrow(/没有这个 World/);
  });

  it('records why a world could not start', async () => {
    const t = setup({}, { failStart: true });
    await expect(t.runtime.set('notify', true)).rejects.toThrow('端口被占用');
    expect(t.runtime.list()[0]).toMatchObject({ enabled: true, running: false, failure: '端口被占用' });
  });
});


