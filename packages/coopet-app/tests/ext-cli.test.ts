import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { runExt } = require('../ext-cli.cjs');

function setup(pnpmCode = 0) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'coopet-ext-cli-'));
  const calls: Array<{ args: string[]; cwd: string }> = [];
  const out: string[] = [];
  const deps = {
    dataRoot, packageManager: 'pnpm@11.28.6',
    pnpm: (args: string[], cwd: string) => { calls.push({ args, cwd }); return pnpmCode; },
    log: (m: string) => out.push(m), error: (m: string) => out.push(`E:${m}`),
  };
  return { dataRoot, calls, out, deps };
}

describe('runExt', () => {
  it('adds through pnpm in the extensions folder, pinning the package manager', () => {
    const t = setup();
    expect(runExt(['add', 'cortico-world-x'], t.deps)).toBe(0);
    const dir = join(t.dataRoot, 'extensions');
    expect(t.calls).toEqual([{ args: ['add', 'cortico-world-x'], cwd: dir }]);
    expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))).toMatchObject({ private: true, packageManager: 'pnpm@11.28.6' });
    expect(t.out.join('\n')).toContain('装好了');
  });

  it('lists what is installed, and passes on pnpm failures', () => {
    const t = setup(1);
    expect(runExt(['list'], t.deps)).toBe(0);
    expect(t.out[0]).toContain('还没有装扩展');
    expect(runExt(['add', 'x'], t.deps)).toBe(1);
    writeFileSync(join(t.dataRoot, 'extensions', 'package.json'), JSON.stringify({ dependencies: { 'cortico-world-x': '1.0.0' } }));
    t.out.length = 0;
    runExt(['list'], t.deps);
    expect(t.out[0]).toBe('cortico-world-x  1.0.0');
  });

  it('refuses remove before anything is installed, and bad usage', () => {
    const t = setup();
    expect(runExt(['remove', 'x'], t.deps)).toBe(1);
    expect(runExt(['add'], t.deps)).toBe(2);
    expect(runExt(['frobnicate'], t.deps)).toBe(2);
    expect(t.calls).toEqual([]);
  });
});
