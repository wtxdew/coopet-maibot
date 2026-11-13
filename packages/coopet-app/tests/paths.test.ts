import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { defaultDataRoot as coreRoot } from '../../coopet-core/src/runtime/config.ts';

const require = createRequire(import.meta.url);
const { defaultDataRoot: shellRoot } = require('../paths.cjs');

const cases: Array<[NodeJS.Platform, NodeJS.ProcessEnv, string]> = [
  ['darwin', {}, '/Users/me/Library/Application Support/Coopet'],
  ['win32', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'C:\\Users\\me\\AppData\\Roaming/Coopet'],
  ['linux', {}, '/Users/me/.config/coopet'],
  ['linux', { XDG_CONFIG_HOME: '/x' }, '/x/coopet'],
  ['darwin', { COOPET_DATA_DIR: '/tmp/c' }, '/tmp/c'],
];

describe('data directory', () => {
  it.each(cases)('is the same in the shell and the core (%s)', (platform, env, expected) => {
    expect(shellRoot(platform, env, '/Users/me')).toBe(expected);
    expect(coreRoot(platform, env, '/Users/me')).toBe(expected);
  });
});
