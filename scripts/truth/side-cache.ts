import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { GoldenCheck } from '../differential/golden.js';
import { ocrSkip, probeRecognizer } from '../differential/ocr-probe.js';
import { keyOf, WORKING_TREE, type SideRun } from './calibrate.js';

/**
 * calibrate's side cache (calibrate.ts `--cache`, `--no-cache`): a side's run (SideRun) kept on disk under a key that
 * changes whenever anything the run could depend on changes — so a warm run replays only what changed, and a stale
 * entry can never stand in for a harness change. The key (sideKeys) is the side and the harness:
 *
 *   the side      a commit's full SHA (its src never changes); the working tree's every file under src/ as on disk
 *   the harness   every file under scripts/differential, scripts/truth and tests/differential/golden (but the table,
 *                 scripts/truth/calibration.json, which golden never reads: the verdicts are judged from the runs anew
 *                 every time; and the Markdown, which no run reads); the corpus and the rest of tests/fixtures (the fake device's dumpsys captures); the src
 *                 THIS checkout's harness loads itself (harnessImports: recorded-source.ts's dialect marks, replies.ts's
 *                 hints — what a fix there changes for every side); package-lock.json; the node version; and whether
 *                 the host asks the `ocr` rows (golden.ts#ocrAvailability: a run in a sandbox skips them)
 *
 * Only a side that loaded is kept: one that did not may have failed itself (killed, a checkout git refused), and is run
 * again next time. An entry is the side's checks as the run kept them, in its order — what results() reads.
 */

/** Where the runs are kept: a run by its key, or undefined when none is. */
export interface SideCache {
  get(key: string): Promise<SideRun | undefined>;
  /** Keeps a side that loaded (an error is never kept). */
  put(key: string, run: SideRun): Promise<void>;
}

/** The host's part of the key: the node that runs golden, and why the `ocr` rows are skipped (undefined: asked). */
export interface Host {
  node: string;
  ocrSkip: string | undefined;
}

/**
 * This host as a golden process here sees it: this node, and the harness's own OCR probe (ocr-probe.ts, on the image
 * golden.ts#ocrAvailability probes with) — whether the `ocr` rows are asked or skipped.
 */
export async function thisHost(repo: string): Promise<Host> {
  const run = promisify(execFile);
  const exec = async (cmd: string, args: string[]) => {
    const { stdout, stderr } = await run(cmd, args, { encoding: 'buffer' });
    return { stdout, stderr: stderr.toString('utf8') };
  };
  return { node: process.version, ocrSkip: ocrSkip(await probeRecognizer(exec, join(repo, 'tests/fixtures/truth/ios-iphone17-ios27/form-basic.png'))) };
}

/** The harness's directories, every file of which is in the key. */
export const HARNESS_DIRS = ['scripts/differential', 'scripts/truth', 'tests/differential/golden', 'tests/fixtures'] as const;
/**
 * In the harness's directories but no input of a run: the table calibrate judges the runs by, and the Markdown (the
 * READMEs: a run reads none).
 */
const isInput = (file: string) => file !== 'scripts/truth/calibration.json' && !file.endsWith('.md');
/** The process every side runs: where harnessImports starts. */
const GOLDEN = 'scripts/differential/golden.ts';

/** Every file under `dir` (none when it is not there), absolute. */
const filesUnder = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));

/**
 * An import a module makes at run time, of a module of this checkout: a static `import … from './x.js'`, a bare
 * `import './x.js'`, an `export … from` and a literal `import('./x.js')` — not an `import type`, which the run never
 * loads. A string in a comment that reads as one only widens the key.
 */
const IMPORT = /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]|^\s*(?:import|export)\s+(?!type\s)(?:[^'";]*?\bfrom\s*)?['"](\.{1,2}\/[^'"]+)['"]/gms;

/**
 * The files of this checkout a golden process loads, from GOLDEN through every run-time import (a `.js` specifier is
 * its `.ts` source), as paths relative to `repo`. The side's own src is loaded by path (side.ts#loadSide), so it is not
 * among them: that is the side's part of the key.
 */
export function harnessImports(repo: string, entry = GOLDEN): string[] {
  const seen = new Set([resolve(repo, entry)]);
  const queue = [...seen];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const target = resolve(dirname(file), (m[1] ?? m[2]).replace(/\.js$/, '.ts'));
      if (!seen.has(target) && existsSync(target) && statSync(target).isFile()) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen].map((f) => relative(repo, f)).sort();
}

/** A digest of `files` (relative to `repo`): each one's path and content, in sorted order, and `extra` lines. */
function digestOf(repo: string, files: Iterable<string>, extra: readonly string[] = []): string {
  const hash = createHash('sha256');
  for (const f of [...new Set(files)].sort()) hash.update(`${f}\0`).update(createHash('sha256').update(readFileSync(join(repo, f))).digest('hex')).update('\n');
  for (const line of extra) hash.update(`${line}\n`);
  return hash.digest('hex');
}

/** The harness's part of the key (the module doc): what every side's run depends on besides the side's own src. */
export function harnessDigest(repo: string, corpus: string, host: Host): string {
  const dirs = [...HARNESS_DIRS, corpus].flatMap((d) => filesUnder(join(repo, d)).map((f) => relative(repo, f)));
  const lock = existsSync(join(repo, 'package-lock.json')) ? ['package-lock.json'] : [];
  return digestOf(
    repo,
    [...dirs.filter(isInput), ...harnessImports(repo), ...lock],
    [`node ${host.node}`, `ocr ${host.ocrSkip === undefined ? 'asked' : `skipped: ${host.ocrSkip}`}`],
  );
}

/**
 * Each side's key: the side (a commit's full SHA by `commitOf`, the working tree's src/ as on disk) and the harness's
 * digest. undefined when the side is no commit `commitOf` knows: such a side is run, never kept.
 */
export function sideKeys(repo: string, harness: string, commitOf: (side: string) => string | undefined): (side: string) => string | undefined {
  let workingTree: string | undefined;
  return (side) => {
    const identity = side === WORKING_TREE ? `working tree ${(workingTree ??= digestOf(repo, filesUnder(join(repo, 'src')).map((f) => relative(repo, f))))}` : commitOf(side);
    return identity === undefined ? undefined : createHash('sha256').update(`${identity}\n${harness}`).digest('hex');
  };
}

/** The cache in `dir`, one JSON file per key; written whole or not at all (several sides finish at once). */
export function sideCache(dir: string): SideCache {
  const path = (key: string) => join(dir, `${key}.json`);
  return {
    async get(key) {
      let checks: GoldenCheck[];
      try {
        checks = (JSON.parse(await readFile(path(key), 'utf8')) as { checks: GoldenCheck[] }).checks;
      } catch {
        return undefined;
      }
      return { checks: new Map(checks.map((c) => [keyOf(c), c])) };
    },
    async put(key, run) {
      if ('error' in run) return;
      await mkdir(dir, { recursive: true });
      const staging = `${path(key)}.${process.pid}`;
      await writeFile(staging, JSON.stringify({ checks: [...run.checks.values()] }));
      await rename(staging, path(key));
    },
  };
}
