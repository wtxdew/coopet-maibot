import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { chromeOptions, applyTheme, readSize, saveSize, DEFAULT_SIZE } = require('../console-chrome.cjs');

const area = { width: 1600, height: 1000 };

describe('chromeOptions', () => {
  it('hides the system title bar, traffic lights in the page bar on macOS', () => {
    expect(chromeOptions('darwin')).toMatchObject({ titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 11 } });
    expect(chromeOptions('win32')).toMatchObject({ titleBarStyle: 'hidden', titleBarOverlay: { height: 36 } });
  });
});

describe('applyTheme', () => {
  it('follows the page colours, overlay buttons only off macOS, bad values ignored', () => {
    const win = { setBackgroundColor: vi.fn(), setTitleBarOverlay: vi.fn() };
    applyTheme(win, { color: '#112233', symbolColor: '#ffffff' }, 'darwin');
    expect(win.setBackgroundColor).toHaveBeenCalledWith('#112233');
    expect(win.setTitleBarOverlay).not.toHaveBeenCalled();
    applyTheme(win, { color: '#112233', symbolColor: '#ffffff' }, 'win32');
    expect(win.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#112233', symbolColor: '#ffffff' });
    applyTheme(win, { color: 'red', symbolColor: '#fff' }, 'win32');
    applyTheme(win, null, 'win32');
    expect(win.setBackgroundColor).toHaveBeenCalledTimes(2);
  });
});

describe('window size', () => {
  it('uses the default without a file, and a saved size within the screen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coopet-size-'));
    const file = join(dir, 'console-size.json');
    expect(readSize(file, area)).toMatchObject(DEFAULT_SIZE);
    saveSize(file, { width: 1000, height: 700 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ width: 1000, height: 700 });
    expect(readSize(file, area)).toMatchObject({ width: 1000, height: 700 });
    saveSize(file, { width: 5000, height: 100 });
    expect(readSize(file, area)).toMatchObject({ width: 1600, height: 600 });
    writeFileSync(file, 'not json');
    expect(readSize(file, area)).toMatchObject(DEFAULT_SIZE);
  });
});
