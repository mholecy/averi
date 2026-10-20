import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, version as osVersion } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GoldenCheck } from '../../scripts/differential/golden.js';
import { WORKING_TREE } from '../../scripts/truth/side-run.js';
import { harnessDigest, harnessImports, sideCache, sideKeys, thisHost, type Host, type LoadedRun } from '../../scripts/truth/side-cache.js';

const HOST: Host = { node: 'v26.0.0', ocr: { asked: 'swift-driver version: 1.120.5 Apple Swift version 6.2; macOS 26A100' } };

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

  it.each([
    ['a multi-line import whose list holds a comment with quotes', "import {\n  x, // the side's own 'x'\n  y,\n} from '../../src/c.js';"],
    ['a second import on one line', "import { a } from '../../src/a.js'; import { c } from '../../src/c.js';"],
    ['an export * from', "export * from '../../src/c.js';"],
    ['a template literal import()', 'export const load = () => import(`../../src/c.js`);'],
    ['an import = require()', "import c = require('../../src/c.js');"],
    ['a literal require()', "const c = require('../../src/c.js');"],
  ])('harnessImports follows %s', (_, text) => {
    write('scripts/differential/golden.ts', text);
    expect(harnessImports(repo)).toContain('src/c.ts');
  });

  it('harnessImports: not an export type … from; a computed import() is an error, not a narrower key', () => {
    write('scripts/differential/golden.ts', "export type { B } from '../../src/b.js';");
    expect(harnessImports(repo)).toEqual(['scripts/differential/golden.ts']);
    write('scripts/differential/golden.ts', "const name = 'c';\nexport const load = () => import(`../../src/${name}.js`);");
    expect(() => harnessImports(repo)).toThrow(/golden\.ts loads a module it computes/);
  });

  it("harnessImports: side.ts's computed imports are the side's src (its part of the key), its literal ones followed", () => {
    write('scripts/differential/golden.ts', "import { side } from './side.js';");
    write('scripts/differential/side.ts', "import { c } from '../../src/c.js';\nexport const side = (root: string) => import(`${root}/src/x.ts`);");
    expect(harnessImports(repo)).toEqual(['scripts/differential/golden.ts', 'scripts/differential/side.ts', 'src/c.ts']);
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

  it('another node, the ocr rows skipped where they were asked, or read by another toolchain or macOS build: another digest', () => {
    expect(digest({ ...HOST, node: 'v27.0.0' })).not.toBe(digest());
    expect(digest({ ...HOST, ocr: { skipped: 'Vision answers nilError' } })).not.toBe(digest());
    expect(digest({ ...HOST, ocr: { asked: 'swift-driver version: 1.120.5 Apple Swift version 6.2; macOS 26B50' } })).not.toBe(digest());
    expect(digest({ ...HOST, ocr: { asked: 'swift-driver version: 1.121.1 Apple Swift version 6.3; macOS 26A100' } })).not.toBe(digest());
  });
});

describe('side-cache.ts — this host (thisHost): the probe golden decides by, and the recognizer that reads', () => {
  /** A host whose swiftc answers `toolchain`, whose probe reads `reading`, whose sw_vers answers `build` (or fails). */
  const host = (toolchain: string, reading: string, build?: string) => {
    const probed: string[] = [];
    const exec = async (cmd: string, args: string[]) => {
      const out = (s: string) => ({ stdout: Buffer.from(s), stderr: '' });
      if (cmd === 'swiftc' && args[0] === '--version') return out(toolchain);
      if (cmd === 'swiftc') {
        writeFileSync(args[2], ''); // the probe, "compiled" (into the temp dir: removed after these tests)
        compiled.push(args[2].replace(/\.\d+$/, ''));
        return out('');
      }
      if (cmd === 'sw_vers') {
        if (build === undefined) throw new Error('sw_vers: ENOENT');
        return out(`${build}\n`);
      }
      probed.push(args[0]);
      return out(reading);
    };
    return { exec, probed };
  };
  const toolchain = `Apple Swift version 6.2 (side-cache.test ${process.pid} ${Date.now()})\n`;
  const compiled: string[] = [];
  afterAll(() => compiled.forEach((f) => rmSync(f, { force: true })));

  it.skipIf(process.platform !== 'darwin')("asked: the toolchain and the macOS build, the probe on golden's own image", async () => {
    const h = host(toolchain, 'LOGIN\n', '26A100');
    expect(await thisHost(h.exec)).toEqual({ node: process.version, ocr: { asked: `${toolchain.trim()}; macOS 26A100` } });
    expect(h.probed).toEqual([fileURLToPath(new URL('../fixtures/truth/ios-iphone17-ios27/form-basic.png', import.meta.url))]);
  });

  it.skipIf(process.platform !== 'darwin')('asked where sw_vers does not answer: the kernel version stands for the build', async () => {
    expect(await thisHost(host(toolchain, 'LOGIN\n').exec)).toEqual({ node: process.version, ocr: { asked: `${toolchain.trim()}; ${osVersion()}` } });
  });

  it.skipIf(process.platform !== 'darwin')('skipped (Vision answers nilError): why, and no recognizer', async () => {
    expect(await thisHost(host(toolchain, 'ERROR Error Domain=x Code=9 "nilError"\n', '26A100').exec)).toEqual({
      node: process.version,
      ocr: { skipped: 'Vision answers nilError (it does not run here: a sandbox)' },
    });
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
    const run: LoadedRun = { checks: new Map([['b t tap', check('b', 'red')], ['a t tap', check('a')]]) };
    expect(await cache.get('k')).toBeUndefined();
    await cache.put('k', run);
    const back = await sideCache(join(repo, 'cache')).get('k');
    expect(back).toEqual(run);
    expect(back !== undefined && 'checks' in back && [...back.checks.keys()]).toEqual(['b t tap', 'a t tap']);
  });

  it('an entry not whole (cut short, or JSON of another shape): none kept — the side is run again', async () => {
    write('cache/cut.json', '{"checks":[{"recording":');
    write('cache/other.json', '{"runs":[]}');
    const cache = sideCache(join(repo, 'cache'));
    expect(await cache.get('cut')).toBeUndefined();
    expect(await cache.get('other')).toBeUndefined();
  });
});
