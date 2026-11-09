import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { failedCaptureLines, loadCorpus, runLines } from '../../scripts/differential/corpus.js';

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

  it('refuses a platform it does not know, naming the run', async () => {
    await run('run-a', { platform: 'harmony', captures: [] }, {});
    await expect(loadCorpus(dir)).rejects.toThrow(/run-a.*"harmony"/);
  });

  it('refuses a form other than raw or normalized, naming the capture', async () => {
    await run('run-a', { platform: 'ios', captures: [{ file: 'x.json', source: 'wda', form: 'parsed' }] }, { 'x.json': '{}' });
    await expect(loadCorpus(dir)).rejects.toThrow(/run-a\/x\.json.*"parsed"/);
  });

  it('gives a ground-truth capture the paths of its screenshot and truth, beside it', async () => {
    await run(
      'truth',
      { platform: 'ios', captures: [{ file: 'open.wda.json', source: 'wda', form: 'raw', screenshot: 'open.png', truth: 'open.truth.json' }, { file: 'plain.json', source: 'idb', form: 'raw' }] },
      { 'open.wda.json': '{}', 'open.png': 'png', 'open.truth.json': '{}', 'plain.json': '[]' },
    );
    const corpus = await loadCorpus(dir);
    expect(corpus.map((r) => [r.id, r.screenshot, r.truth])).toEqual([
      ['truth/open.wda.json', join(dir, 'truth', 'open.png'), join(dir, 'truth', 'open.truth.json')],
      ['truth/plain.json', undefined, undefined],
    ]);
  });

  it.each(['screenshot', 'truth'] as const)('refuses a capture whose %s file is missing, naming the capture and the file', async (field) => {
    const files: Record<string, string> = { 'open.wda.json': '{}', 'open.png': 'png', 'open.truth.json': '{}' };
    delete files[field === 'screenshot' ? 'open.png' : 'open.truth.json'];
    await run('truth', { platform: 'ios', captures: [{ file: 'open.wda.json', source: 'wda', form: 'raw', screenshot: 'open.png', truth: 'open.truth.json' }] }, files);
    await expect(loadCorpus(dir)).rejects.toThrow(field === 'screenshot' ? /truth\/open\.wda\.json: open\.png is missing/ : /truth\/open\.wda\.json: open\.truth\.json is missing/);
  });

  it('refuses a directory without a manifest rather than skipping its trees', async () => {
    await mkdir(join(dir, 'stray'));
    await expect(loadCorpus(dir)).rejects.toThrow(/stray.*manifest\.json/);
  });
});

describe('runLines', () => {
  it('names each replayed run with its tree count and what its manifest says it is, so a rebuilt run never reads as a device capture', async () => {
    await run('rebuilt', { platform: 'ios', device: 'none: REBUILT from normalized trees', note: 'not device captures', captures: [] }, {});
    await run('device', { platform: 'ios', device: 'iPhone 17 simulator', captures: [] }, {});
    await run('bare', { platform: 'android', captures: [] }, {});
    expect(await runLines(dir, ['rebuilt/a.json', 'device/b.json', 'rebuilt/c.json', 'bare/d.xml'])).toEqual([
      '- bare: 1 trees',
      '- device: 1 trees — iPhone 17 simulator',
      '- rebuilt: 2 trees — none: REBUILT from normalized trees — not device captures',
    ]);
  });
});

describe('failedCaptureLines', () => {
  it("one line per run whose manifest lists failed cells (the truth capture's RunManifest.failed), naming each and why; none for a run without", async () => {
    await run('run-b', { platform: 'android', captures: [], failed: [{ cell: 'carousel-lazy', reason: 'adb: device offline' }, { cell: 'x', reason: 'y' }] }, {});
    await run('run-a', { platform: 'ios', captures: [] }, {});
    await run('run-c', { platform: 'ios', captures: [], failed: [] }, {});
    await writeFile(join(dir, 'README.md'), 'not a run');
    expect(await failedCaptureLines(dir)).toEqual(['golden: corpus run run-b holds no capture from its last attempt at 2 cells (manifest.json `failed`): carousel-lazy: adb: device offline; x: y']);
    await run('run-d', { platform: 'ios', captures: [], failed: [{ cell: 'held-no', reason: 'z' }] }, {});
    expect((await failedCaptureLines(dir)).at(-1)).toBe('golden: corpus run run-d holds no capture from its last attempt at 1 cell (manifest.json `failed`): held-no: z');
  });

  it("a run with no readable manifest gets the corpus's own error, not a raw ENOENT or SyntaxError — as loadCorpus and runLines", async () => {
    await mkdir(join(dir, 'run-x'));
    await expect(failedCaptureLines(dir)).rejects.toThrow(/^corpus run run-x: no readable manifest\.json \(ENOENT/);
    await writeFile(join(dir, 'run-x', 'manifest.json'), '{');
    await expect(failedCaptureLines(dir)).rejects.toThrow(/^corpus run run-x: no readable manifest\.json \(/);
    await expect(runLines(dir, ['run-x/a.xml'])).rejects.toThrow(/^corpus run run-x: no readable manifest\.json/);
  });
});
