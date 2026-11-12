import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_PET_DEFAULTS } from 'cortico-world-desktop-pet';
import { coopetDirs, loadConfig, mergeInPlace } from '../src/runtime/config.ts';

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
    expect(cfg.link.botAccount).toBe('coopet-maibot');
    expect(cfg.link.userId).toBe('owner');
    expect(cfg.link.userNickname).toBe('主人');
    expect(cfg.link.tokenFile).toBe(join(root, 'token'));
    expect(existsSync(dirs.configFile)).toBe(false);
  });

  it('applies file overrides on top of defaults', () => {
    const dirs = coopetDirs(root);
    writeFileSync(dirs.configFile, JSON.stringify({ link: { botAccount: 'other' }, pet: { asr: { enabled: true }, window: { scale: 2 } } }));
    const { cfg } = loadConfig(dirs);
    expect(cfg.link.botAccount).toBe('other');
    expect(cfg.pet.asr.enabled).toBe(true);
    expect(cfg.pet.window.scale).toBe(2);
    expect(cfg.pet.window.enabled).toBe(true);
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
