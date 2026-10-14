import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadCorpus } from '../../scripts/differential/corpus.js';

// The corpus a differential run reads (scripts/differential/README.md, "Corpus format"): one directory per capture
// run, a manifest naming each tree's platform, source kind and form, and the tree files beside it.

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'averi-corpus-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function run(name: string, manifest: unknown, files: Record<string, string>): Promise<void> {
  await mkdir(join(dir, name));
  await writeFile(join(dir, name, 'manifest.json'), JSON.stringify(manifest));
  for (const [file, body] of Object.entries(files)) await writeFile(join(dir, name, file), body);
}

describe('loadCorpus', () => {
  it('reads every capture of every run, with the run\'s platform, app and screen and the capture\'s own source and form, the payload byte for byte', async () => {
    await run(
      'run-b',
      { platform: 'android', app: 'clock', screen: { width: 1080, height: 2220 }, captures: [{ file: 'dump.xml', source: 'uiautomator', form: 'raw' }] },
      { 'dump.xml': '<hierarchy rotation="0"/>' },
    );
    await run(
      'run-a',
      {
        platform: 'ios',
        screen: { width: 402, height: 874 },
        captures: [
          { file: 'source.json', source: 'wda', form: 'raw', app: 'Contacts' },
          { file: 'snap.json', source: 'idb', form: 'normalized', screen: { width: 430, height: 932 }, note: 'a Pro Max' },
        ],
      },
      { 'source.json': '{"value":{"type":"Application"}}', 'snap.json': '{"role":"container"}' },
    );

    const corpus = await loadCorpus(dir);

    expect(corpus.map((r) => [r.id, r.platform, r.source, r.form, r.app, r.screen, r.note, r.payload])).toEqual([
      ['run-a/snap.json', 'ios', 'idb', 'normalized', undefined, { width: 430, height: 932 }, 'a Pro Max', '{"role":"container"}'],
      ['run-a/source.json', 'ios', 'wda', 'raw', 'Contacts', { width: 402, height: 874 }, undefined, '{"value":{"type":"Application"}}'],
      ['run-b/dump.xml', 'android', 'uiautomator', 'raw', 'clock', { width: 1080, height: 2220 }, undefined, '<hierarchy rotation="0"/>'],
    ]);
  });

  it('refuses a manifest whose capture file is missing, naming the run and the file', async () => {
    await run('run-a', { platform: 'ios', captures: [{ file: 'gone.json', source: 'wda', form: 'raw' }] }, {});
    await expect(loadCorpus(dir)).rejects.toThrow(/run-a\/gone\.json/);
  });

  it('refuses a source kind the platform has no reader for — a uiautomator dump in an iOS run', async () => {
    await run('run-a', { platform: 'ios', captures: [{ file: 'x.xml', source: 'uiautomator', form: 'raw' }] }, { 'x.xml': '<hierarchy/>' });
    await expect(loadCorpus(dir)).rejects.toThrow(/run-a\/x\.xml.*uiautomator.*ios/);
  });

  it('refuses a directory without a manifest rather than skipping its trees', async () => {
    await mkdir(join(dir, 'stray'));
    await expect(loadCorpus(dir)).rejects.toThrow(/stray.*manifest\.json/);
  });
});
