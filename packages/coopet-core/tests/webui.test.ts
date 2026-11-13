import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import { WebApp } from 'cortico/web/server.ts';
import type { WorldStreamSocket, WorldWebUiDecl } from 'cortico/core/types.ts';
import { desktopPetConfigGroups } from 'cortico-world-desktop-pet';
import { coopetDirs, loadConfig } from '../src/runtime/config.ts';
import { consoleLogger } from '../src/runtime/log.ts';
import { MemoryEventStore } from '../src/runtime/event-store.ts';
import { createSurface } from '../src/webui/surface.ts';
import { petPackageDir, prepareWebAssets } from '../src/webui/assets.ts';

const apps: WebApp[] = [];
afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); });

/** 真实的 WebApp + 假桌宠（只有页面声明），返回地址和各个假对象。 */
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'coopet-webui-'));
  const dirs = coopetDirs(root);
  writeFileSync(dirs.configFile, '{}');
  const loaded = loadConfig(dirs, { debounceMs: 60_000 });
  const persistPet = vi.fn((patch: unknown) => loaded.persistPet(patch as never));
  const invoke = vi.fn(async (panel: string, method: string, args: unknown[]) => ({ panel, method, args }));
  const streams: WorldStreamSocket[] = [];
  const decl: WorldWebUiDecl = {
    label: '桌宠',
    panels: [{ id: 'pet', title: '桌宠' }, { id: 'chat', title: '对话' }],
    config: desktopPetConfigGroups('zh'),
    promptDocs: [{ key: 'worlds.desktop-pet.envPrompt', title: '环境', description: '给模型看的', path: join(root, 'env.md') }],
    invoke,
    stream: (_panel, socket) => {
      streams.push(socket);
      socket.onMessage((text) => socket.send(`echo:${text}`));
    },
  } as WorldWebUiDecl;
  const pet = { webUi: () => decl, toolNames: () => ['pet_say'], refresh: vi.fn(), onDesktop: () => true };

  // 假的面板脚本
  const petDir = join(root, 'pet');
  mkdirSync(join(petDir, 'dist'), { recursive: true });
  writeFileSync(join(petDir, 'dist', 'webui.js'), 'export const x = 1;');
  const log = consoleLogger('test', 'error');
  const webDistDir = prepareWebAssets(dirs.data, log, petDir);

  const app = new WebApp(createSurface({
    petCfg: loaded.cfg.pet, persistPet, pet, store: new MemoryEventStore(), dirs, log,
    botName: () => '麦麦', link: () => ({ kind: 'plugin', state: 'open' }), webDistDir,
  }));
  apps.push(app);
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any }; };
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  return { root, dirs, loaded, persistPet, pet, invoke, streams, base, port, get, post };
}

describe('webui surface', () => {
  it('reports status and capabilities', async () => {
    const t = await setup();
    const st = await t.get('/api/status');
    expect(st.body).toMatchObject({ displayName: '麦麦', loop: { paused: false }, link: { kind: 'plugin', state: 'open' }, pet: { onDesktop: true } });
    const caps = (await t.get('/api/capabilities')).body.capabilities;
    expect(caps).toMatchObject({ config: true, worlds: true, avatar: true, extensions: false, run: false, prompts: false });
  });

  it('lists the pet config groups without speech recognition and computer use', async () => {
    const t = await setup();
    const { groups } = (await t.get('/api/config')).body as { groups: Array<{ group: { id: string }; values: Record<string, unknown> }> };
    const ids = groups.map((g) => g.group.id);
    expect(ids).toContain('world:desktop-pet');
    expect(ids).toContain('world:desktop-pet:sound');
    expect(ids.some((id) => id.endsWith(':cua') || id.endsWith(':asr'))).toBe(false);
    expect(groups.find((g) => g.group.id === 'world:desktop-pet')!.values['worlds.desktop-pet.window.scale']).toBe(1);
    expect((await t.get('/api/config/options/anything')).body).toEqual({ options: [] });
  });

  it('writes a checked value, refreshes the pet and returns the groups', async () => {
    const t = await setup();
    const r = await t.post('/api/config', { group: 'world:desktop-pet', values: { 'worlds.desktop-pet.window.scale': 1.5 } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, result: '已保存' });
    expect(t.loaded.cfg.pet.window.scale).toBe(1.5);
    expect(t.pet.refresh).toHaveBeenCalledOnce();
    const g = (r.body.groups as Array<{ group: { id: string }; values: Record<string, unknown> }>).find((x) => x.group.id === 'world:desktop-pet')!;
    expect(g.values['worlds.desktop-pet.window.scale']).toBe(1.5);
  });

  it('refuses bad values, unknown groups and other sites, changing nothing', async () => {
    const t = await setup();
    expect((await t.post('/api/config', { group: 'world:desktop-pet', values: { 'worlds.desktop-pet.window.scale': 99 } })).status).toBe(400);
    expect((await t.post('/api/config', { group: 'world:desktop-pet', values: { 'worlds.desktop-pet.nope': 1 } })).status).toBe(400);
    expect((await t.post('/api/config', { group: 'world:desktop-pet:cua', values: {} })).status).toBe(400);
    expect((await t.post('/api/config', { group: 'world:desktop-pet', values: { 'worlds.desktop-pet.window.scale': 1.2 } }, { origin: 'https://evil.example' })).status).toBe(403);
    expect(t.persistPet).not.toHaveBeenCalled();
    expect(t.loaded.cfg.pet.window.scale).toBe(1);
  });

  it('keeps the colour scheme in the config folder', async () => {
    const t = await setup();
    expect((await t.get('/api/theme')).body).toMatchObject({ theme: null });
    const saved = await t.post('/api/theme', { v: 1, selectedId: 'default', mode: 'dark', custom: [] });
    expect(saved.status).toBe(200);
    expect(existsSync(join(t.dirs.root, 'theme.json'))).toBe(true);
    expect((await t.get('/api/theme')).body.theme).toMatchObject({ mode: 'dark' });
  });

  it('lists the pet as the one World', async () => {
    const t = await setup();
    const { worlds } = (await t.get('/api/worlds')).body;
    expect(worlds).toEqual([expect.objectContaining({ id: 'desktop-pet', status: 'active', label: '桌宠', tools: ['pet_say'] })]);
  });

  it('puts the pet page in the manifest with its panel script and without prompts', async () => {
    const t = await setup();
    const manifest = (await t.get('/api/webui/manifest')).body;
    const page = manifest.providers.find((p: { id: string }) => p.id === 'world:desktop-pet');
    expect(page).toMatchObject({ kind: 'world', label: '桌宠', availability: 'active' });
    expect(page.prompts).toBeUndefined();
    expect(page.panels.map((p: { id: string }) => p.id)).toEqual(['pet', 'chat']);
    expect(JSON.stringify(page)).toContain('/assets/desktop-pet/webui.js');
    const js = await fetch(`${t.base}/assets/desktop-pet/webui.js`);
    expect(js.status).toBe(200);
    expect(await js.text()).toBe('export const x = 1;');
  });

  it('forwards panel calls to the pet', async () => {
    const t = await setup();
    const r = await t.post('/api/webui/providers/world%3Adesktop-pet/panels/pet/state', { args: [1] });
    expect(r.status).toBe(200);
    expect(t.invoke).toHaveBeenCalledWith('pet', 'state', [1]);
  });

  it('forwards a panel stream to the pet', async () => {
    const t = await setup();
    const ws = new WebSocket(`ws://127.0.0.1:${t.port}/ws/providers/world%3Adesktop-pet/panels/chat`);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send('{"t":"hello"}'));
      ws.on('message', (data) => resolve(String(data)));
      ws.on('error', reject);
    });
    ws.close();
    expect(reply).toBe('echo:{"t":"hello"}');
    expect(t.streams).toHaveLength(1);
  });

  it('refuses a stream opened from another site', async () => {
    const t = await setup();
    const ws = new WebSocket(`ws://127.0.0.1:${t.port}/ws/providers/world%3Adesktop-pet/panels/chat`, { origin: 'https://evil.example' });
    const outcome = await new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'));
      ws.on('error', () => resolve('refused'));
    });
    expect(outcome).toBe('refused');
    expect(t.streams).toHaveLength(0);
  });
});

describe('prepareWebAssets', () => {
  it('finds the pet package by its name', () => {
    expect(existsSync(join(petPackageDir(), 'src', 'index.ts'))).toBe(true);
  });

  it('writes an empty manifest when the panel script is not built', () => {
    const root = mkdtempSync(join(tmpdir(), 'coopet-assets-'));
    const out = prepareWebAssets(root, consoleLogger('test', 'error'), join(root, 'no-pet'));
    expect(JSON.parse(readFileSync(join(out, 'asset-manifest.json'), 'utf8'))).toMatchObject({ providers: {} });
  });
});
