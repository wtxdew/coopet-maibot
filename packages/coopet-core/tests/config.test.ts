import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_PET_DEFAULTS } from 'cortico-world-desktop-pet';
import { coopetDirs, deviceId, loadConfig, mergeInPlace } from '../src/runtime/config.ts';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'coopet-config-')); });
afterEach(() => { vi.useRealTimers(); });

describe('mergeInPlace', () => {
  it('merges objects in place and replaces arrays', () => {
    const target = { a: { b: 1, c: 2 }, list: [1, 2], keep: 'x' };
    const inner = target.a;
    mergeInPlace(target, { a: { c: 3 }, list: [9], skip: undefined });
    expect(target).toEqual({ a: { b: 1, c: 3 }, list: [9], keep: 'x' });
    expect(target.a).toBe(inner);
  });

  it('copies patch objects instead of sharing them', () => {
    const target: Record<string, unknown> = {};
    const patch = { obj: { v: 1 } };
    mergeInPlace(target, patch);
    patch.obj.v = 2;
    expect(target.obj).toEqual({ v: 1 });
  });
});

describe('loadConfig', () => {
  it('uses defaults without creating the file', () => {
    const dirs = coopetDirs(root);
    const { cfg } = loadConfig(dirs);
    expect(cfg.pet.port).toBe(DESKTOP_PET_DEFAULTS.port);
    expect(cfg.pet.asr.enabled).toBe(false);
    expect(cfg.link.kind).toBe('plugin');
    expect(cfg.link.maim).toEqual({ url: '', tokenFile: join(root, 'token'), botAccount: 'coopet-maibot', userId: 'owner', userNickname: '主人' });
    expect(cfg.link.plugin).toEqual({ url: '', tokenFile: join(root, 'plugin-token') });
    expect(cfg.botName).toBe('MaiBot');
    expect(cfg.log).toEqual({ level: 'info', file: true });
    expect(dirs.logs).toBe(join(root, 'logs'));
    expect(dirs.events).toBe(join(root, 'events'));
    expect(existsSync(dirs.configFile)).toBe(false);
  });

  it('applies file overrides on top of defaults', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ link: { kind: 'plugin', plugin: { url: 'ws://h:18100/ws' } }, pet: { asr: { enabled: true }, window: { scale: 2 } } }));
    const { cfg } = loadConfig(dirs);
    expect(cfg.link.kind).toBe('plugin');
    expect(cfg.link.plugin).toEqual({ url: 'ws://h:18100/ws', tokenFile: join(root, 'plugin-token') });
    expect(cfg.pet.asr.enabled).toBe(true);
    expect(cfg.pet.window.scale).toBe(2);
    expect(cfg.pet.window.enabled).toBe(true);
  });

  it('reads botName and keeps other top-level keys when writing back', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ botName: '小助手', link: { maim: { url: 'ws://h/ws' } }, extra: { keep: true } }));
    const { cfg, persistPet, flush } = loadConfig(dirs, { debounceMs: 60_000 });
    expect(cfg.botName).toBe('小助手');
    expect(cfg.link.maim.url).toBe('ws://h/ws');
    persistPet({ theme: 'light' });
    flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8'))).toEqual({ botName: '小助手', link: { maim: { url: 'ws://h/ws' } }, extra: { keep: true }, pet: { theme: 'light' } });
  });

  it('migrates the old flat link fields into link.maim', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ link: { url: 'ws://old/ws', userNickname: '老板' } }));
    const { cfg, persistPet, flush } = loadConfig(dirs, { debounceMs: 60_000 });
    expect(cfg.link.maim.url).toBe('ws://old/ws');
    expect(cfg.link.maim.userNickname).toBe('老板');
    expect(cfg.link.kind).toBe('maim');
    persistPet({ theme: 'light' });
    flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8')).link).toEqual({ maim: { url: 'ws://old/ws', userNickname: '老板' }, kind: 'maim' });
  });

  it('reads log settings and rejects bad ones', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ log: { level: 'debug' } }));
    expect(loadConfig(dirs).cfg.log).toEqual({ level: 'debug', file: true });
    writeFileSync(dirs.configFile, JSON.stringify({ log: { level: 'loud' } }));
    expect(() => loadConfig(dirs)).toThrow(/log.level/);
    writeFileSync(dirs.configFile, JSON.stringify({ log: { file: 'yes' } }));
    expect(() => loadConfig(dirs)).toThrow(/log.file/);
  });

  it('persists app settings after checking them, and leaves the config alone when invalid', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ link: { maim: { url: 'ws://m/ws' } }, pet: { theme: 'light' } }));
    const { cfg, persist, flush } = loadConfig(dirs, { debounceMs: 60_000 });
    persist({ link: { kind: 'plugin', plugin: { url: 'ws://p:18100/ws' } }, log: { level: 'debug' }, botName: '小助手' });
    expect(cfg.link.kind).toBe('plugin');
    expect(cfg.link.plugin.url).toBe('ws://p:18100/ws');
    expect(cfg.link.maim.url).toBe('ws://m/ws');
    expect(cfg.log.level).toBe('debug');
    expect(cfg.botName).toBe('小助手');
    expect(() => persist({ log: { level: 'loud' as never } })).toThrow(/log.level/);
    expect(() => persist({ link: { kind: 'pigeon' as never } })).toThrow(/link.kind/);
    expect(() => persist({ botName: ' ' })).toThrow(/botName/);
    expect(cfg.log.level).toBe('debug');
    flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8'))).toEqual({
      botName: '小助手',
      link: { kind: 'plugin', maim: { url: 'ws://m/ws' }, plugin: { url: 'ws://p:18100/ws' } },
      log: { level: 'debug' },
      pet: { theme: 'light' },
    });
  });

  it('rejects an unknown link kind', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ link: { kind: 'carrier-pigeon' } }));
    expect(() => loadConfig(dirs)).toThrow(/link.kind/);
  });

  it('creates a device id once and keeps it', () => {
    const dirs = coopetDirs(join(root, 'dev'));
    const first = deviceId(dirs);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(deviceId(dirs)).toBe(first);
  });

  it('refuses a file that is not JSON and leaves it alone', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, '{oops');
    expect(() => loadConfig(dirs)).toThrow(/不是合法的 JSON/);
    expect(readFileSync(dirs.configFile, 'utf8')).toBe('{oops');
  });

  it('persists into the same pet object and writes only overrides, debounced', () => {
    vi.useFakeTimers();
    const dirs = coopetDirs(join(root, 'nested'));
    const { cfg, persistPet } = loadConfig(dirs, { debounceMs: 100 });
    const pet = cfg.pet;
    persistPet({ petX: 10 });
    persistPet({ skin: { palette: 'rose' } });
    expect(cfg.pet).toBe(pet);
    expect(cfg.pet.petX).toBe(10);
    expect(cfg.pet.skin.palette).toBe('rose');
    expect(cfg.pet.skin.figure).toBe('coo');
    expect(existsSync(dirs.configFile)).toBe(false);
    vi.advanceTimersByTime(100);
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8'))).toEqual({ link: {}, pet: { petX: 10, skin: { palette: 'rose' } } });
  });

  it('flush writes pending changes at once', () => {
    const dirs = coopetDirs(root);
    const { persistPet, flush } = loadConfig(dirs, { debounceMs: 60_000 });
    persistPet({ theme: 'light' });
    flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8')).pet).toEqual({ theme: 'light' });
  });
});

describe('language', () => {
  it('follows the system until one is chosen, then keeps it', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-lang-'));
    const dirs = coopetDirs(root);
    const loaded = loadConfig(dirs, { debounceMs: 0 });
    // vitest 里系统语言固定为 zh（vitest.config.ts 的 CORTICO_LANGUAGE）
    expect(loaded.cfg.language).toBe('zh');
    loaded.persist({ language: 'ja' });
    loaded.flush();
    expect(loaded.cfg.language).toBe('ja');
    expect(loadConfig(dirs).cfg.language).toBe('ja');
    expect(() => loaded.persist({ language: 'klingon' as never })).toThrow(/language/);
    expect(loaded.cfg.language).toBe('ja');
  });

  it('ignores an unknown language in the file', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-lang-'));
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ language: 'xx' }));
    expect(loadConfig(dirs).cfg.language).toBe('zh');
  });
});

describe('world sections', () => {
  it('gives one live object per world, defaults under the file overlay, and writes changes back', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-worlds-'));
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ worlds: { notify: { enabled: true } } }));
    const loaded = loadConfig(dirs, { debounceMs: 0 });
    const section = loaded.worldSection('notify', { enabled: false, port: 1, tags: ['a'] });
    expect(section).toEqual({ enabled: true, port: 1, tags: ['a'] });
    expect(loaded.worldSection('notify', { enabled: false })).toBe(section);
    loaded.persistWorld('notify', { port: 2, tags: ['b', 'c'] });
    expect(section).toEqual({ enabled: true, port: 2, tags: ['b', 'c'] });
    loaded.flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8')).worlds).toEqual({ notify: { enabled: true, port: 2, tags: ['b', 'c'] } });
  });
});

describe('routes', () => {
  it('reads route settings, moves the old modes over, and refuses bad values', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-routes-'));
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ routes: {
      a: { mode: 'auto' }, b: { mode: 'pet' }, c: { mode: 'off' },
      d: { mode: 'rule', unknown: 'pet', maxChars: 40 }, e: { mode: 'loud', unknown: 'x', maxChars: 2 },
    } }));
    const loaded = loadConfig(dirs, { debounceMs: 0 });
    expect(loaded.cfg.routes).toEqual({
      a: { mode: 'pet', unknown: 'record', maxChars: 80 },
      b: { mode: 'pet', unknown: 'pet', maxChars: 80 },
      c: { mode: 'off', unknown: 'record', maxChars: 80 },
      d: { mode: 'rule', unknown: 'pet', maxChars: 40 },
      e: { mode: 'pet', unknown: 'record', maxChars: 80 },
    });
    loaded.persist({ routes: { a: { maxChars: 120 }, f: { mode: 'off' } } });
    expect(loaded.cfg.routes.a).toEqual({ mode: 'pet', unknown: 'record', maxChars: 120 });
    expect(loaded.cfg.routes.f).toEqual({ mode: 'off', unknown: 'record', maxChars: 80 });
    expect(() => loaded.persist({ routes: { g: { mode: 'loud' as never } } })).toThrow(/routes.g.mode/);
    expect(() => loaded.persist({ routes: { g: { unknown: 'shout' as never } } })).toThrow(/routes.g.unknown/);
    expect(() => loaded.persist({ routes: { g: { maxChars: 5 } } })).toThrow(/routes.g.maxChars/);
    loaded.flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8')).routes.a).toEqual({ mode: 'pet', unknown: 'record', maxChars: 120 });
  });
});

describe('update', () => {
  it('turns automatic updates on by default and saves a change', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-update-'));
    const dirs = coopetDirs(root);
    const loaded = loadConfig(dirs, { debounceMs: 0 });
    expect(loaded.cfg.update).toEqual({ auto: true });
    loaded.persist({ update: { auto: false } });
    expect(loaded.cfg.update.auto).toBe(false);
    expect(() => loaded.persist({ update: { auto: 'no' as never } })).toThrow(/update.auto/);
    expect(loaded.cfg.update.auto).toBe(false);
    loaded.flush();
    expect(JSON.parse(readFileSync(dirs.configFile, 'utf8')).update).toEqual({ auto: false });
    expect(loadConfig(dirs).cfg.update.auto).toBe(false);
  });
});

describe('migrateLegacyData', () => {
  it('copies the old folder once, without electron/ and data/webui/, leaving the old one in place', async () => {
    const { migrateLegacyData } = await import('../src/runtime/config.ts');
    const base = mkdtempSync(join(tmpdir(), 'coopet-migrate-'));
    const legacy = join(base, 'old');
    const root = join(base, 'new');
    for (const d of ['electron', 'data/webui', 'data/figures', 'extensions']) mkdirSync(join(legacy, d), { recursive: true });
    writeFileSync(join(legacy, 'config.json'), '{"botName":"x"}');
    writeFileSync(join(legacy, 'plugin-token'), 't');
    writeFileSync(join(legacy, 'electron', 'Cookies'), 'c');
    writeFileSync(join(legacy, 'data', 'figures', 'a.png'), 'p');
    expect(migrateLegacyData(root, legacy)).toBe(true);
    expect(readFileSync(join(root, 'config.json'), 'utf8')).toBe('{"botName":"x"}');
    expect(existsSync(join(root, 'plugin-token'))).toBe(true);
    expect(existsSync(join(root, 'data', 'figures', 'a.png'))).toBe(true);
    expect(existsSync(join(root, 'electron'))).toBe(false);
    expect(existsSync(join(root, 'data', 'webui'))).toBe(false);
    expect(existsSync(join(legacy, 'config.json'))).toBe(true);
    // 新目录已有配置：不再拷
    writeFileSync(join(legacy, 'config.json'), '{"botName":"changed"}');
    expect(migrateLegacyData(root, legacy)).toBe(false);
    expect(migrateLegacyData(legacy, legacy)).toBe(false);
  });
});
