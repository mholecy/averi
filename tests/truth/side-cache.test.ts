import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GoldenCheck } from '../../scripts/differential/golden.js';
import { WORKING_TREE, type SideRun } from '../../scripts/truth/calibrate.js';
import { harnessDigest, harnessImports, sideCache, sideKeys, type Host } from '../../scripts/truth/side-cache.js';

const HOST: Host = { node: 'v26.0.0', ocrSkip: undefined };

/** A checkout in miniature: golden.ts loading src/a.ts (which loads src/a2.ts), and a type from src/b.ts. */
const FILES: Record<string, string> = {
  'scripts/differential/golden.ts': ["import { a } from '../../src/a.js';", "import type { B } from '../../src/b.js';", "export const g = (b: B) => a(b);"].join('\n'),
  'scripts/differential/side.ts': 'export const side = 1;',
  'scripts/truth/replies.ts': 'export const r = 1;',
  'scripts/truth/calibration.json': '{"notes":[]}',
  'scripts/differential/README.md': '# the harness',
  'tests/differential/golden/known.ts': 'export const k = 1;',
  'tests/fixtures/truth/cell.json': '{}',
  'tests/fixtures/dumpsys.txt': 'mInputMethodWindow',
  'corpus/elsewhere/cell.json': '{}',
  'src/a.ts': "import {\n  a2,\n} from './a2.js';\nexport const a = (x: unknown) => a2(x);",
  'src/a2.ts': 'export const a2 = (x: unknown) => x;',
  'src/b.ts': 'export type B = number;',
  'src/c.ts': 'export const c = 1;',
  'package-lock.json': '{"lockfileVersion":3}',
};

let repo: string;
const write = (path: string, text: string) => {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
};
const digest = (host: Host = HOST, corpus = 'tests/fixtures/truth') => harnessDigest(repo, corpus, host);

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'side-cache-'));
  for (const [path, text] of Object.entries(FILES)) write(path, text);
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe('side-cache.ts — the harness the runs depend on (harnessImports, harnessDigest)', () => {
  it('harnessImports: golden.ts and the src it loads at run time, through every import — not a type-only import', () => {
    expect(harnessImports(repo)).toEqual(['scripts/differential/golden.ts', 'src/a.ts', 'src/a2.ts']);
  });

  it('this checkout: the src the harness loads itself is found (recorded-source.ts, replies.ts), the tools not', () => {
    const imports = harnessImports(fileURLToPath(new URL('../..', import.meta.url)));
    expect(imports).toEqual(expect.arrayContaining(['src/adapters/wda-source.ts', 'src/adapters/ios-tree-source.ts', 'src/ui-tree/miss.ts', 'tests/differential/golden/files.ts']));
    expect(imports).not.toContain('src/mcp/tools.ts');
  });

  it('nothing changed: the same digest — the runs are reused', () => {
    expect(digest()).toBe(digest());
  });

  it.each([
    'scripts/differential/side.ts',
    'scripts/truth/replies.ts',
    'tests/differential/golden/known.ts',
    'tests/fixtures/truth/cell.json',
    'tests/fixtures/dumpsys.txt',
    'src/a.ts',
    'src/a2.ts',
    'package-lock.json',
  ])('a change to %s: another digest', (path) => {
    const before = digest();
    write(path, `${FILES[path]}\n// changed`);
    expect(digest()).not.toBe(before);
  });

  it('a file added to the harness: another digest', () => {
    const before = digest();
    write('scripts/differential/golden-spec/new.ts', 'export const n = 1;');
    expect(digest()).not.toBe(before);
  });

  it.each(['scripts/truth/calibration.json', 'scripts/differential/README.md', 'src/b.ts', 'src/c.ts'])('a change to %s, which no run reads: the same digest', (path) => {
    const before = digest();
    write(path, `${FILES[path]}\n// changed`);
    expect(digest()).toBe(before);
  });

  it('the corpus is in it wherever it is (here outside tests/fixtures)', () => {
    const before = digest(HOST, 'corpus/elsewhere');
    write('corpus/elsewhere/cell.json', '{"x":1}');
    expect(digest(HOST, 'corpus/elsewhere')).not.toBe(before);
  });

  it('another node, or the ocr rows skipped where they were asked: another digest', () => {
    expect(digest({ ...HOST, node: 'v27.0.0' })).not.toBe(digest());
    expect(digest({ ...HOST, ocrSkip: 'Vision answers nilError' })).not.toBe(digest());
  });
});

describe("side-cache.ts — a side's key (sideKeys)", () => {
  const commits: Record<string, string> = { aaaaaaa: 'a'.repeat(40), bbbbbbb: 'b'.repeat(40) };
  const keys = (harness = 'h') => sideKeys(repo, harness, (side) => commits[side]);

  it('a commit: its full SHA and the harness — the same twice, another for another commit or harness', () => {
    expect(keys()('aaaaaaa')).toBe(keys()('aaaaaaa'));
    expect(keys()('aaaaaaa')).not.toBe(keys()('bbbbbbb'));
    expect(keys('h2')('aaaaaaa')).not.toBe(keys()('aaaaaaa'));
  });

  it('a side git does not know: no key (run, never kept)', () => {
    expect(keys()('zzzzzzz')).toBeUndefined();
  });

  it("the working tree: its src as on disk — any change to src/ another key, a commit's key unchanged", () => {
    const before = { wt: keys()(WORKING_TREE), commit: keys()('aaaaaaa') };
    expect(keys()(WORKING_TREE)).toBe(before.wt);
    write('src/c.ts', 'export const c = 2;');
    expect(keys()(WORKING_TREE)).not.toBe(before.wt);
    expect(keys()('aaaaaaa')).toBe(before.commit);
  });
});

describe('side-cache.ts — the cache on disk (sideCache)', () => {
  const check = (recording: string, mismatch?: string): GoldenCheck => ({ recording, target: 't', verb: 'tap', reply: 'r', ...(mismatch !== undefined && { mismatch }) }) as GoldenCheck;

  it('a side that loaded: kept and read back as it was, its checks in order', async () => {
    const cache = sideCache(join(repo, 'cache'));
    const run: SideRun = { checks: new Map([['b t tap', check('b', 'red')], ['a t tap', check('a')]]) };
    expect(await cache.get('k')).toBeUndefined();
    await cache.put('k', run);
    const back = await sideCache(join(repo, 'cache')).get('k');
    expect(back).toEqual(run);
    expect(back !== undefined && 'checks' in back && [...back.checks.keys()]).toEqual(['b t tap', 'a t tap']);
  });

  it('a side that did not load: never kept', async () => {
    const cache = sideCache(join(repo, 'cache'));
    await cache.put('k', { error: 'killed by SIGKILL; no stderr' });
    expect(await cache.get('k')).toBeUndefined();
  });
});
