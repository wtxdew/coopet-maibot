import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { statusText, trayTemplate, trayTooltip } = require('../tray-menu.cjs');

const base = { core: 'running', link: { kind: 'plugin', state: 'open', botName: '麦麦' }, onDesktop: true, petOrigin: 'http://127.0.0.1:7797', loginItem: false, loginItemAvailable: true, language: 'zh' };
const actions = () => ({ openSettings: vi.fn(), togglePet: vi.fn(), openDress: vi.fn(), setLoginItem: vi.fn(), openLogs: vi.fn(), restartCore: vi.fn(), quit: vi.fn() });

describe('statusText', () => {
  it.each([
    [base, '已连上 麦麦（插件）'],
    [{ ...base, link: { kind: 'maim', state: 'open' } }, '已连上 MaiBot（maim_message）'],
    [{ ...base, link: { kind: 'plugin', state: 'connecting' } }, '正在连接 MaiBot…'],
    [{ ...base, link: { kind: 'plugin', state: 'closed', reason: 'auth' } }, 'MaiBot 未连接：token 不对'],
    [{ ...base, link: { kind: 'plugin', state: 'closed', reason: '1006' } }, 'MaiBot 未连接：关闭码 1006'],
    [{ ...base, link: { kind: 'plugin', state: 'closed', reason: 'no-url' } }, 'MaiBot 未连接：还没填地址'],
    [{ ...base, core: 'starting' }, '核心启动中…'],
    [{ ...base, core: 'failed' }, '核心多次崩溃，已停止'],
  ])('%#', (state, text) => {
    expect(statusText(state)).toBe(text);
  });
});

describe('trayTemplate', () => {
  it('lists the items and wires the actions', () => {
    const a = actions();
    const items = trayTemplate(base, a);
    expect(items.map((i: any) => i.label ?? '—')).toEqual(['已连上 麦麦（插件）', '—', '设置…', '隐藏桌宠', '装扮…', '—', '开机自启', '打开日志文件夹', '—', '退出 Coopet']);
    items.find((i: any) => i.label === '隐藏桌宠').click();
    items.find((i: any) => i.label === '开机自启').click();
    items.find((i: any) => i.label === '退出 Coopet').click();
    expect(a.togglePet).toHaveBeenCalled();
    expect(a.setLoginItem).toHaveBeenCalledWith(true);
    expect(a.quit).toHaveBeenCalled();
  });

  it('toggles click-through and says so in the tooltip', () => {
    const a = { ...actions(), setClickThrough: vi.fn() };
    const items = trayTemplate(base, a);
    expect(items.map((i: any) => i.label ?? '—').slice(3, 5)).toEqual(['隐藏桌宠', '鼠标穿透']);
    const item = items.find((i: any) => i.label === '鼠标穿透');
    expect(item).toMatchObject({ type: 'checkbox', checked: false, enabled: true });
    item.click();
    expect(a.setClickThrough).toHaveBeenCalledWith(true);
    trayTemplate({ ...base, clickThrough: true }, a).find((i: any) => i.label === '鼠标穿透').click();
    expect(a.setClickThrough).toHaveBeenLastCalledWith(false);
    expect(trayTemplate({ ...base, core: 'starting' }, a).find((i: any) => i.label === '鼠标穿透').enabled).toBe(false);
    expect(trayTooltip(base)).toBe('Coopet');
    expect(trayTooltip({ ...base, clickThrough: true })).toBe('Coopet（鼠标穿透中）');
    expect(trayTooltip({ ...base, clickThrough: true, language: 'en' })).toBe('Coopet (click-through)');
  });

  it('offers restart-and-update once an update is downloaded', () => {
    const a = { ...actions(), installUpdate: vi.fn() };
    expect(trayTemplate(base, a).some((i: any) => i.label?.startsWith('重启并更新'))).toBe(false);
    const items = trayTemplate({ ...base, updateReady: '0.1.4' }, a);
    expect(items.map((i: any) => i.label ?? '—').slice(-2)).toEqual(['重启并更新到 v0.1.4', '退出 Coopet']);
    items.find((i: any) => i.label === '重启并更新到 v0.1.4').click();
    expect(a.installUpdate).toHaveBeenCalled();
    expect(trayTemplate({ ...base, updateReady: '0.1.4', language: 'en' }, a).some((i: any) => i.label === 'Restart and update to v0.1.4')).toBe(true);
  });

  it('disables pet items until the core runs, and offers a restart after it failed', () => {
    const starting = trayTemplate({ ...base, core: 'starting', onDesktop: false }, actions());
    expect(starting.find((i: any) => i.label === '显示桌宠').enabled).toBe(false);
    expect(starting.find((i: any) => i.label === '装扮…').enabled).toBe(false);
    const failed = trayTemplate({ ...base, core: 'failed' }, actions());
    expect(failed.some((i: any) => i.label === '重新启动核心')).toBe(true);
  });

  it('marks the login item unavailable in development', () => {
    const items = trayTemplate({ ...base, loginItemAvailable: false }, actions());
    const login = items.find((i: any) => String(i.label).startsWith('开机自启'));
    expect(login).toMatchObject({ label: '开机自启（打包后可用）', enabled: false });
  });
});

describe('tray language', () => {
  it('shows English for English and other non-Chinese languages', () => {
    const labels = (language: string) => trayTemplate({ ...base, language }, actions()).map((i: { label?: string }) => i.label).filter(Boolean);
    expect(labels('en')).toContain('Settings…');
    expect(labels('ja')).toContain('Quit Coopet');
    expect(labels('zh-Hant')).toContain('设置…');
    expect(statusText({ ...base, language: 'en', link: { kind: 'plugin', state: 'closed', reason: 'auth' } })).toBe('MaiBot not connected: wrong token');
  });
});
