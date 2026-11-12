import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Link, LinkState } from '../src/link/types.ts';
import { coopetDirs, loadConfig } from '../src/runtime/config.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { SettingsService, type TestRequest } from '../src/settings/service.ts';

/** 假连接：start 后按脚本报状态。 */
function fakeLink(script: Array<[LinkState, string?]>, botName?: string): Link & { stopped: boolean; req?: unknown } {
  const listeners: Array<(s: LinkState, r?: string) => void> = [];
  const link = {
    stopped: false,
    start: () => { queueMicrotask(() => { for (const [s, r] of script) for (const cb of listeners) cb(s, r); }); },
    stop: async () => { link.stopped = true; },
    state: () => 'closed' as LinkState,
    send: async () => ({ id: 'x' }),
    onMessage: () => {},
    onState: (cb: (s: LinkState, r?: string) => void) => { listeners.push(cb); },
    botName: () => botName,
  };
  return link;
}

function setup(file: object = {}, linkFor: (req: TestRequest & { tokenFile: string }) => Link = () => fakeLink([['open']])) {
  const root = mkdtempSync(join(tmpdir(), 'coopet-settings-'));
  const dirs = coopetDirs(root);
  writeFileSync(dirs.configFile, JSON.stringify(file));
  const loaded = loadConfig(dirs, { debounceMs: 60_000 });
  const pet = { refresh: vi.fn() };
  const requests: Array<TestRequest & { tokenFile: string }> = [];
  const service = new SettingsService({
    cfg: loaded.cfg, persist: loaded.persist, persistPet: loaded.persistPet, pet,
    log: consoleLogger('test', 'error'),
    makeTestLink: (req) => { requests.push(req); return linkFor(req); },
    testTimeoutMs: 200,
  });
  return { root, dirs, loaded, pet, service, requests };
}

describe('SettingsService.get', () => {
  it('reports app settings without tokens, and the pet schema minus hidden items', () => {
    const t = setup({ link: { kind: 'plugin', plugin: { url: 'ws://p/ws' } } });
    writeFileSync(join(t.root, 'plugin-token'), 'secret-token\n');
    const snap = t.service.get();
    expect(snap.app.link).toMatchObject({ kind: 'plugin', plugin: { url: 'ws://p/ws', tokenSet: true }, maim: { tokenSet: false } });
    expect(JSON.stringify(snap)).not.toContain('secret-token');
    const pet = snap.worlds[0];
    expect(pet).toMatchObject({ id: 'desktop-pet', canDisable: false, enabled: true });
    const keys = pet.groups.flatMap((g) => Object.keys(g.schema.properties));
    expect(keys).toContain('worlds.desktop-pet.window.scale');
    expect(keys).toContain('worlds.desktop-pet.theme');
    for (const hidden of ['port', 'user', 'window.enabled', 'window.electronFile', 'window.exportOverlay', 'selfAdjust', 'touch.enabled', 'touch.wakeOn']) {
      expect(keys).not.toContain(`worlds.desktop-pet.${hidden}`);
    }
    expect(keys.some((k) => k.includes('.asr.'))).toBe(false);
    expect(pet.values['worlds.desktop-pet.window.scale']).toBe(1);
  });
});

describe('SettingsService.save', () => {
  it('applies hot pet settings at once without a restart', () => {
    const t = setup();
    const r = t.service.save({ worlds: { 'desktop-pet': { 'worlds.desktop-pet.window.scale': 1.5, 'worlds.desktop-pet.theme': 'light' } } });
    expect(r).toEqual({ restartNeeded: false });
    expect(t.loaded.cfg.pet.window.scale).toBe(1.5);
    expect(t.loaded.cfg.pet.theme).toBe('light');
    expect(t.pet.refresh).toHaveBeenCalledOnce();
  });

  it('asks for a restart for link and log changes', () => {
    const t = setup();
    expect(t.service.save({ app: { link: { kind: 'plugin' } } })).toEqual({ restartNeeded: true });
    expect(t.service.save({ app: { log: { level: 'debug' } } })).toEqual({ restartNeeded: true });
    expect(t.service.save({ app: { botName: '小助手' } })).toEqual({ restartNeeded: false });
  });

  it('rejects bad values and unknown or hidden keys, changing nothing', () => {
    const t = setup();
    const bad = [
      { 'worlds.desktop-pet.window.scale': 99 },
      { 'worlds.desktop-pet.window.scale': 'big' },
      { 'worlds.desktop-pet.theme': 'neon' },
      { 'worlds.desktop-pet.rememberPosition': 'yes' },
      { 'worlds.desktop-pet.port': 8000 },
      { 'worlds.desktop-pet.nope': 1 },
    ];
    for (const values of bad) expect(() => t.service.save({ worlds: { 'desktop-pet': values } })).toThrow();
    expect(() => t.service.save({ worlds: { webhook: {} } })).toThrow(/没有这个 World/);
    expect(t.loaded.cfg.pet.window.scale).toBe(1);
    expect(t.pet.refresh).not.toHaveBeenCalled();
  });

  it('does not write pet settings when the app part is invalid', () => {
    const t = setup();
    expect(() => t.service.save({ app: { log: { level: 'loud' as never } }, worlds: { 'desktop-pet': { 'worlds.desktop-pet.theme': 'light' } } })).toThrow();
    expect(t.loaded.cfg.pet.theme).toBe('dark');
  });
});

describe('SettingsService.saveToken', () => {
  it('writes the token file with private permissions', () => {
    const t = setup();
    expect(t.service.saveToken('plugin', '  abc  ')).toEqual({ restartNeeded: true });
    const file = join(t.root, 'plugin-token');
    expect(readFileSync(file, 'utf8')).toBe('abc');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => t.service.saveToken('maim', '   ')).toThrow(/不能为空/);
  });
});

describe('SettingsService.testConnection', () => {
  it('reports success with the bot name and stops the temporary link', async () => {
    let made: ReturnType<typeof fakeLink> | undefined;
    const t = setup({}, () => (made = fakeLink([['connecting'], ['open']], '麦麦')));
    const r = await t.service.testConnection({ kind: 'plugin', url: 'ws://p/ws', token: 't' });
    expect(r).toMatchObject({ ok: true, botName: '麦麦' });
    expect(made!.stopped).toBe(true);
    expect(t.requests[0]).toMatchObject({ kind: 'plugin', url: 'ws://p/ws', token: 't', tokenFile: join(t.root, 'plugin-token') });
  });

  it.each([
    [[['connecting'], ['closed', 'auth']], 'token 不对'],
    [[['connecting'], ['closed', '1006']], '连不上（关闭码 1006）'],
    [[['connecting']], '0.2 秒内没连上'],
  ] as Array<[Array<[LinkState, string?]>, string]>)('reports failure %#', async (script, reason) => {
    const t = setup({}, () => fakeLink(script));
    expect(await t.service.testConnection({ kind: 'maim', url: 'ws://m/ws' })).toMatchObject({ ok: false, reason });
  });

  it('refuses an empty address without connecting', async () => {
    const t = setup();
    expect(await t.service.testConnection({ kind: 'plugin', url: ' ' })).toEqual({ ok: false, ms: 0, reason: '地址是空的' });
    expect(t.requests).toHaveLength(0);
  });
});
