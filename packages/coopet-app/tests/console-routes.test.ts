import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { decide, windowFilePath, isLocal, mayRequest, RELEASE_CHECK } = require('../console-routes.cjs');

const CORE = 'http://127.0.0.1:50123';
const PET = 'http://127.0.0.1:7797';
const origins = { coreOrigin: CORE, petOrigin: PET };
const req = (url: string, referrer = '', method = 'GET') => decide({ url, referrer, method }, origins);

describe('decide', () => {
  it('serves the window files itself', () => {
    expect(req(`${CORE}/coopet/`)).toEqual({ kind: 'file' });
    expect(req(`${CORE}/coopet/index.js`, `${CORE}/coopet/`)).toEqual({ kind: 'file' });
  });

  it('forwards core requests only from the window, with its origin', () => {
    expect(req(`${CORE}/api/status`, `${CORE}/coopet/`)).toEqual({ kind: 'forward', origin: CORE });
    expect(req(`${CORE}/api/config`, `${CORE}/coopet/#/pet`, 'POST')).toEqual({ kind: 'forward', origin: CORE });
    expect(req(`${CORE}/api/status`)).toEqual({ kind: 'refuse' });
    expect(req(`${CORE}/api/config`, `${PET}/dress`, 'POST')).toEqual({ kind: 'refuse' });
  });

  it('forwards pet server requests from the window or the pet pages', () => {
    expect(req(`${PET}/dress`, `${CORE}/coopet/`)).toEqual({ kind: 'forward', origin: CORE });
    expect(req(`${PET}/api/packs`, `${PET}/dress`, 'POST')).toEqual({ kind: 'forward', origin: PET });
  });

  it('lets the sandboxed figure frame read only its files', () => {
    expect(req(`${PET}/figure-frame`)).toEqual({ kind: 'forward', origin: 'null' });
    expect(req(`${PET}/web/figure.js`)).toEqual({ kind: 'forward', origin: 'null' });
    expect(req(`${PET}/packs/x/skin.png`, '', 'HEAD')).toEqual({ kind: 'forward', origin: 'null' });
    expect(req(`${PET}/api/packs`)).toEqual({ kind: 'refuse' });
    expect(req(`${PET}/figure-frame`, '', 'POST')).toEqual({ kind: 'refuse' });
  });

  it('refuses everything else', () => {
    expect(req('http://127.0.0.1:9999/', `${CORE}/coopet/`)).toEqual({ kind: 'refuse' });
    expect(req('http://example.com/', `${CORE}/coopet/`)).toEqual({ kind: 'refuse' });
    expect(decide({ url: `${CORE}/coopet/`, referrer: '', method: 'GET' }, { coreOrigin: null, petOrigin: null })).toEqual({ kind: 'refuse' });
  });
});

describe('windowFilePath', () => {
  const dir = join(sep, 'app', 'build', 'console');
  it('maps paths under the folder, index.html by default', () => {
    expect(windowFilePath(dir, '/coopet/')).toBe(join(dir, 'index.html'));
    expect(windowFilePath(dir, '/coopet/index.js')).toBe(join(dir, 'index.js'));
  });
  it('refuses paths that leave the folder and bad escapes', () => {
    expect(windowFilePath(dir, '/coopet/..%2F..%2Fsecret')).toBeNull();
    expect(windowFilePath(dir, '/coopet/%E0%A4%A')).toBeNull();
  });
});

describe('isLocal', () => {
  it('allows only this machine', () => {
    expect(isLocal('http://127.0.0.1:5/x')).toBe(true);
    expect(isLocal('ws://localhost:5/ws')).toBe(true);
    expect(isLocal('https://api.github.com/x')).toBe(false);
    expect(isLocal('http://127.0.0.1.evil.com/')).toBe(false);
  });

  it('lets the release check out and nothing else', () => {
    expect(mayRequest(RELEASE_CHECK)).toBe(true);
    expect(mayRequest('http://127.0.0.1:5/x')).toBe(true);
    expect(mayRequest(`${RELEASE_CHECK}?x=1`)).toBe(false);
    expect(mayRequest('https://api.github.com/repos/other/repo/releases/latest')).toBe(false);
  });
});
