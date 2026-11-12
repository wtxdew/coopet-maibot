import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { statusText, trayTemplate } = require('../tray-menu.cjs');

const base = { core: 'running', link: { kind: 'plugin', state: 'open', botName: '麦麦' }, onDesktop: true, petOrigin: 'http://127.0.0.1:7797', loginItem: false, loginItemAvailable: true };
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
