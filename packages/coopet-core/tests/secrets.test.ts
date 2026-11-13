import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SecretStore } from '../src/runtime/secrets.ts';

describe('SecretStore', () => {
  it('stores secrets in a private file and reads them back, env first', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'coopet-secrets-')), 'secrets.json');
    const store = new SecretStore(file, { OVERRIDE: 'from-env' });
    expect(store.get('API_KEY')).toBe('');
    store.set('API_KEY', 'abc');
    store.set('OVERRIDE', 'from-file');
    expect(store.get('API_KEY')).toBe('abc');
    expect(store.get('OVERRIDE')).toBe('from-env');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ API_KEY: 'abc', OVERRIDE: 'from-file' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('refuses bad names and empty or spaced values', () => {
    const store = new SecretStore(join(mkdtempSync(join(tmpdir(), 'coopet-secrets-')), 'secrets.json'), {});
    expect(() => store.set('bad-name', 'x')).toThrow(/环境变量名/);
    expect(() => store.set('OK', '')).toThrow(/不能为空/);
    expect(() => store.set('OK', 'a b')).toThrow(/空白/);
  });
});
