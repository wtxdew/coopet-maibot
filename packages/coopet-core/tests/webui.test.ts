import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
import { openRunlog } from '../src/runtime/runlog.ts';

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
    lamps: [{ label: '桌宠窗口', state: 'online' }, { label: '语音识别', state: 'offline' }],
    panels: [{ id: 'pet', title: '桌宠' }, { id: 'voice', title: '语音输入' }, { id: 'chat', title: '对话' }],
    config: desktopPetConfigGroups('zh'),
    promptDocs: [{ key: 'worlds.desktop-pet.envPrompt', title: '环境', description: '给模型看的', path: join(root, 'env.md') }],
    invoke,
    stream: (_panel, socket) => {
      streams.push(socket);
      socket.onMessage((text) => socket.send(`echo:${text}`));
    },
  } as WorldWebUiDecl;
  const pet = { webUi: () => decl, toolNames: () => ['pet_say'], refresh: vi.fn(), onDesktop: () => true, origin: 'http://127.0.0.1:7797' };

  // 假的面板脚本
  const petDir = join(root, 'pet');
  mkdirSync(join(petDir, 'dist'), { recursive: true });
  writeFileSync(join(petDir, 'dist', 'webui.js'), 'export const x = 1;');
  const log = consoleLogger('test', 'error');
  const webDistDir = prepareWebAssets(dirs.data, log, petDir);

  const onLanguage = vi.fn();
  const applyLink = vi.fn(async () => {});
  const store = new MemoryEventStore();
  const runlog = openRunlog(dirs.data, { timezone: 'Asia/Shanghai' });
  const runLog = consoleLogger('coopet', 'info', runlog.sink);
  const app = new WebApp(createSurface({
    cfg: loaded.cfg, persist: loaded.persist, persistPet, onLanguage, pet, store, dirs, log,
    botName: () => '麦麦', link: () => ({ kind: 'plugin', state: 'closed', reason: 'auth', since: '2026-11-13T10:00:00.000Z' }), applyLink, webDistDir,
    runlog, version: '0.0.0', startedAt: '2026-11-13T09:00:00.000Z',
    conversation: () => ({ turns: 3, last: null, recent: { replied: 2, medianReplyMs: 2500, maxReplyMs: 4000 } }),
  }));
  apps.push(app);
  const port = await app.start(0);
  const base = `http://127.0.0.1:${port}`;
  const get = async (path: string) => { const r = await fetch(base + path); return { status: r.status, body: await r.json() as any }; };
  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  return { root, dirs, loaded, persistPet, onLanguage, applyLink, store, runlog, runLog, pet, invoke, streams, base, port, get, post };
}

describe('webui surface', () => {
  it('reports status and capabilities', async () => {
    const t = await setup();
    const st = await t.get('/api/status');
    expect(st.body).toMatchObject({
      displayName: '麦麦', loop: { paused: false }, pet: { onDesktop: true },
      link: { kind: 'plugin', state: 'closed', reason: 'auth', tokenSet: { plugin: false, maim: false } },
    });
    const caps = (await t.get('/api/capabilities')).body.capabilities;
    expect(caps).toMatchObject({ config: true, worlds: true, avatar: true, debug: true, extensions: false, run: false, prompts: false });
    expect(st.body).toMatchObject({
      version: '0.0.0', startedAt: '2026-11-13T09:00:00.000Z', runId: t.runlog.runId,
      link: { since: '2026-11-13T10:00:00.000Z' }, pet: { url: 'http://127.0.0.1:7797' },
      events: { latest: 0 }, log: { level: 'info', file: true },
      conversation: { turns: 3, recent: { medianReplyMs: 2500 } },
    });
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

  it('offers the interface language and saves a change', async () => {
    const t = await setup();
    const { groups } = (await t.get('/api/config')).body as { groups: Array<{ group: { id: string }; values: Record<string, unknown> }> };
    expect(groups.find((g) => g.group.id === 'companion')!.values).toEqual({ language: 'zh' });
    const { options } = (await t.get('/api/config/options/coopanion.language')).body as { options: Array<{ value: string; label: string }> };
    expect(options).toHaveLength(11);
    expect(options).toContainEqual({ value: 'ja', label: '日本語' });
    const r = await t.post('/api/config', { group: 'companion', values: { language: 'en' } });
    expect(r.body).toMatchObject({ ok: true, result: 'Saved' });
    expect(t.loaded.cfg.language).toBe('en');
    expect(t.pet.refresh).toHaveBeenCalledOnce();
    expect(t.onLanguage).toHaveBeenCalledWith('en');
    expect((await t.post('/api/config', { group: 'companion', values: { language: 'xx' } })).status).toBe(400);
    expect(t.loaded.cfg.language).toBe('en');
  });

  it('shows the link settings without tokens', async () => {
    const t = await setup();
    writeFileSync(join(t.root, 'plugin-token'), 'secret-token');
    const r = await t.get('/api/config');
    expect(JSON.stringify(r.body)).not.toContain('secret-token');
    const link = (r.body.groups as Array<{ group: { id: string }; values: Record<string, unknown> }>).find((g) => g.group.id === 'coopet.link')!;
    expect(link.values).toMatchObject({ 'link.kind': 'maim', 'link.plugin.token': '', 'link.maim.userId': 'owner' });
    expect((await t.get('/api/status')).body.link.tokenSet).toEqual({ plugin: true, maim: false });
  });

  it('saves link settings, writes the token privately and switches the link', async () => {
    const t = await setup();
    const r = await t.post('/api/config', { group: 'coopet.link', values: { 'link.kind': 'plugin', 'link.plugin.url': ' ws://nas:18100/ws ', 'link.plugin.token': ' tok ', 'link.maim.token': '' } });
    expect(r.status).toBe(200);
    expect(r.body.result).toBe('已保存，正在连接');
    expect(t.loaded.cfg.link.kind).toBe('plugin');
    expect(t.loaded.cfg.link.plugin.url).toBe('ws://nas:18100/ws');
    const file = join(t.root, 'plugin-token');
    expect(readFileSync(file, 'utf8')).toBe('tok');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(join(t.root, 'token'))).toBe(false);
    expect(t.applyLink).toHaveBeenCalledOnce();
  });

  it('refuses a link address that is not a WebSocket one, changing nothing', async () => {
    const t = await setup();
    const r = await t.post('/api/config', { group: 'coopet.link', values: { 'link.plugin.url': 'http://nas', 'link.plugin.token': 'tok' } });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(String(r.body.error)).toContain('ws://');
    expect(existsSync(join(t.root, 'plugin-token'))).toBe(false);
    expect(t.loaded.cfg.link.plugin.url).toBe('');
    expect(t.applyLink).not.toHaveBeenCalled();
    expect((await t.post('/api/config', { group: 'coopet.link', values: { 'link.kind': 'carrier-pigeon' } })).status).toBe(400);
  });

  it('saves log settings', async () => {
    const t = await setup();
    const r = await t.post('/api/config', { group: 'coopet.log', values: { 'log.level': 'debug', 'log.file': false } });
    expect(r.body.result).toBe('已保存');
    expect(t.loaded.cfg.log).toEqual({ level: 'debug', file: false });
    expect((await t.post('/api/config', { group: 'coopet.log', values: { 'log.level': 'loud' } })).status).toBe(400);
  });

  it('serves this run\'s log and the runs index', async () => {
    const t = await setup();
    t.runLog.child('link').warn('连不上', { code: 1006 });
    const runs = (await t.get('/api/runs')).body;
    expect(runs.current).toBe(t.runlog.runId);
    expect(runs.runs.map((r: { run: string }) => r.run)).toContain(t.runlog.runId);
    const records = (await t.get('/api/log?area=coopet.link')).body as Array<{ msg: string; area: string }>;
    expect(records).toEqual([expect.objectContaining({ area: 'coopet.link', msg: '连不上' })]);
    const bundle = (await t.get('/api/diagnostics')).body;
    expect(JSON.stringify(bundle)).toContain('连不上');
  });

  it('pushes new events and log records on the debug channel', async () => {
    const t = await setup();
    const ws = new WebSocket(`ws://127.0.0.1:${t.port}/ws/debug`);
    const frames: Array<{ t: string }> = [];
    await new Promise<void>((resolve, reject) => { ws.on('open', () => resolve()); ws.on('error', reject); });
    ws.on('message', (data) => frames.push(JSON.parse(String(data))));
    t.store.append({ type: 'desktop-pet.message', source: 'desktop-pet', origin: 'external', ts: '2026-11-13T10:00:00+08:00', text: '你好' });
    t.runLog.info('一轮结束');
    await new Promise((r) => setTimeout(r, 100));
    ws.close();
    expect(frames.map((f) => f.t)).toEqual(expect.arrayContaining(['event', 'runlog']));
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

  it('puts the pet page in the manifest with its panel script, without prompts and voice input', async () => {
    const t = await setup();
    const manifest = (await t.get('/api/webui/manifest')).body;
    const page = manifest.providers.find((p: { id: string }) => p.id === 'world:desktop-pet');
    expect(page).toMatchObject({ kind: 'world', label: '桌宠', availability: 'active' });
    expect(page.prompts).toBeUndefined();
    expect(page.lamps).toEqual([{ label: '桌宠窗口', state: 'online' }]);
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
