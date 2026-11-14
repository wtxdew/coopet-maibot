import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { releasePage } = require('../release-page.cjs');
const LATEST = 'https://github.com/wtxdew/coopet-maibot/releases/latest';

describe('releasePage', () => {
  it('opens the tag page of a version', () => {
    expect(releasePage('0.2.0', LATEST)).toBe('https://github.com/wtxdew/coopet-maibot/releases/tag/v0.2.0');
  });

  it('opens the latest release without a version or with anything else', () => {
    for (const v of [undefined, null, 2, '', 'v0.2.0', '0.2', '0.2.0-beta', '0.2.0/../../evil', '0.2.0?x=1']) {
      expect(releasePage(v, LATEST)).toBe(LATEST);
    }
  });
});
