import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coopetDirs } from '../src/runtime/config.ts';
import { loadWorldExtensions } from '../src/runtime/extensions.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { prepareWebAssets } from '../src/webui/assets.ts';

/** 在 <root>/extensions 下放一个包 */
function addPackage(root: string, name: string, pkg: object, files: Record<string, string>): void {
  const ext = join(root, 'extensions');
  const dir = join(ext, 'node_modules', ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', ...pkg }));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(join(dir, f, '..'), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  const list = join(ext, 'package.json');
  let deps: Record<string, string> = {};
  try { deps = JSON.parse(readFileSync(list, 'utf8')).dependencies ?? {}; } catch { /* 新目录 */ }
  writeFileSync(list, JSON.stringify({ dependencies: { ...deps, [name]: '1.0.0' } }));
}

const WORLD = `export default { id: 'demo', label: 'Demo', defaults: () => ({ enabled: false }), create: () => ({}) };`;

describe('loadWorldExtensions', () => {
  it('loads World extensions with their panel script, and reports the ones it skips', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-ext-'));
    addPackage(root, 'cortico-world-demo', { main: 'index.js', cortico: { kind: 'world', api: 6, webUiClient: 'dist/webui.js' } }, {
      'index.js': WORLD, 'dist/webui.js': 'export default {};',
    });
    addPackage(root, 'cortico-world-old', { main: 'index.js', cortico: { kind: 'world', api: 3 } }, { 'index.js': WORLD });
    addPackage(root, 'cortico-world-pet-clash', { main: 'index.js', cortico: { kind: 'world', api: 6 } }, {
      'index.js': `export default { id: 'desktop-pet', label: 'X', defaults: () => ({ enabled: false }), create: () => ({}) };`,
    });
    const log = consoleLogger('test', 'error');
    const loaded = await loadWorldExtensions(coopetDirs(root), log);
    expect(loaded.worlds.map((w) => w.id)).toEqual(['demo']);
    const byName = Object.fromEntries(loaded.records.map((r) => [r.name, r]));
    expect(byName['cortico-world-demo']).toMatchObject({ loaded: true, worldId: 'demo', webUi: 'served' });
    expect(byName['cortico-world-old'].loaded).toBe(false);
    expect(byName['cortico-world-pet-clash'].loaded).toBe(false);

    const out = prepareWebAssets(join(root, 'data'), log, join(root, 'no-pet'), loaded.webUiAssets);
    const manifest = JSON.parse(readFileSync(join(out, 'asset-manifest.json'), 'utf8'));
    expect(manifest.providers['world:demo']).toEqual({ js: '/assets/ext/cortico-world-demo/1.0.0/webui.js' });
    expect(readFileSync(join(out, 'ext', 'cortico-world-demo', '1.0.0', 'webui.js'), 'utf8')).toBe('export default {};');
  });

  it('is empty without an extensions folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-ext-'));
    const loaded = await loadWorldExtensions(coopetDirs(root), consoleLogger('test', 'error'));
    expect(loaded).toMatchObject({ worlds: [], records: [], webUiAssets: [] });
  });
});
