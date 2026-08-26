import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { packageVersion } from '../../src/util/version.js';

describe('packageVersion', () => {
  it('resolves the real package.json, not a copy that can drift', async () => {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    const { version } = JSON.parse(await readFile(path, 'utf8')) as { version: string };
    expect(await packageVersion()).toBe(version);
    // The bug this replaces: a literal that never moved off the first release.
    expect(await packageVersion()).not.toBe('0.0.1');
  });
});
