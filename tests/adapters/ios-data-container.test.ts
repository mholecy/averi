import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTAINER_METADATA, FRESH_CONTAINER_DIRS, resetDataContainer } from '../../src/adapters/ios-data-container.js';

/** Every path under `dir`, relative, directories with a trailing `/`, sorted. */
async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(`${rel}/`, ...(await tree(dir, rel)));
    else out.push(rel);
  }
  return out.sort();
}

const FRESH = ['Documents/', 'Library/', 'Library/Caches/', 'Library/Preferences/', 'SystemData/', 'tmp/'];

describe('resetDataContainer — clearState leaves the data container as a fresh install has it (A44, ADR 0047)', () => {
  let container: string;
  beforeEach(async () => {
    container = await mkdtemp(join(tmpdir(), 'averi-test-container-'));
  });
  afterEach(async () => {
    await rm(container, { recursive: true, force: true });
  });

  it('the fresh layout is the standard folders, Library/Caches and Library/Preferences among them', () => {
    expect([...FRESH_CONTAINER_DIRS]).toEqual(['Documents', 'Library/Caches', 'Library/Preferences', 'SystemData', 'tmp']);
    expect(CONTAINER_METADATA).toBe('.com.apple.mobile_container_manager.metadata.plist');
  });

  it('a container holding Documents/x: Documents/ stays, empty — an app that writes into it without creating it still can', async () => {
    await mkdir(join(container, 'Documents'));
    await writeFile(join(container, 'Documents', 'x'), 'state');
    await resetDataContainer(container);
    expect((await stat(join(container, 'Documents'))).isDirectory()).toBe(true);
    expect(await readdir(join(container, 'Documents'))).toEqual([]);
  });

  it('every app write goes, at any depth and in every folder; the fresh layout is what is left', async () => {
    for (const d of ['Documents/deep/er', 'Library/Preferences', 'Library/Caches/img', 'Library/Application Support', 'Library/SplashBoard', 'SystemData/x', 'tmp']) {
      await mkdir(join(container, d), { recursive: true });
    }
    await writeFile(join(container, 'Documents/deep/er/f.json'), '{}');
    await writeFile(join(container, 'Library/Preferences/dev.averi.lab.plist'), 'p');
    await writeFile(join(container, 'Library/Caches/img/a.png'), 'a');
    await writeFile(join(container, 'tmp/t'), 't');
    await mkdir(join(container, 'AppMadeFolder'));
    await writeFile(join(container, 'stray'), 's');
    await resetDataContainer(container);
    expect(await tree(container)).toEqual(FRESH);
  });

  it('the container manager\'s metadata plist is kept, untouched: it is the container\'s own, not the app\'s', async () => {
    await writeFile(join(container, CONTAINER_METADATA), 'identity');
    await writeFile(join(container, '.other-dotfile'), 'app');
    await resetDataContainer(container);
    expect(await tree(container)).toEqual([CONTAINER_METADATA, ...FRESH].sort());
    expect(await readFile(join(container, CONTAINER_METADATA), 'utf8')).toBe('identity');
  });

  it('an entry named as a folder but not one (a file `Library`) is replaced by the folder', async () => {
    await writeFile(join(container, 'Library'), '');
    await writeFile(join(container, 'tmp'), '');
    await resetDataContainer(container);
    expect(await tree(container)).toEqual(FRESH);
  });

  it('an empty container gets the fresh layout', async () => {
    await resetDataContainer(container);
    expect(await tree(container)).toEqual(FRESH);
  });
});
