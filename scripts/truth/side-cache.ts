import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { version as osVersion } from 'node:os';
import { promisify } from 'node:util';
import ts from 'typescript';
import type { GoldenCheck } from '../differential/golden.js';
import { ocrSkip, probeHarness } from '../differential/ocr-probe.js';
import { keyOf, WORKING_TREE, type SideRun } from './side-run.js';

/**
 * calibrate's side cache (calibrate.ts `--cache`, `--no-cache`): a side's run (SideRun) kept on disk under a key that
 * changes whenever anything the run could depend on changes — so a warm run replays only what changed, and a stale
 * entry can never stand in for a harness change. The key (sideKeys) is the side and the harness:
 *
 *   the side      a commit's full SHA (its src never changes); the working tree's every file under src/ as on disk
 *   the harness   every file under scripts/differential, scripts/truth and tests/differential/golden (but the table,
 *                 scripts/truth/calibration.json, which golden never reads: the verdicts are judged from the runs anew
 *                 every time; and the Markdown, which no run reads); the corpus and the rest of tests/fixtures (the
 *                 fake device's dumpsys captures); the src THIS checkout's harness loads itself (harnessImports:
 *                 recorded-source.ts's dialect marks, replies.ts's hints — what a fix there changes for every side);
 *                 the checkout's own package-lock.json, package.json and tsconfig.json (CHECKOUT_FILES); the node
 *                 version; and the host's `ocr` rows (thisHost): skipped, and why (a run in a sandbox skips them), or
 *                 asked — and then the recognizer that reads them, the swiftc toolchain compiling it and the macOS build
 *                 whose Vision runs it (the cached `ocr` replies are its readings)
 *
 * Only a side that loaded is kept: one that did not may have failed itself (killed, a checkout git refused), and is run
 * again next time. Nor one whose `ocr` rows its golden process decided otherwise than the key's host (decidedAsHost):
 * each process probes for itself, after calibrate's own probe made the key. An entry is the side's checks as the run
 * kept them, in its order — what results() reads.
 */

/** A side's run that loaded: the only kind the cache keeps. */
export type LoadedRun = Extract<SideRun, { checks: unknown }>;

/** Where the runs are kept: a run by its key, or undefined when none is. */
export interface SideCache {
  get(key: string): Promise<LoadedRun | undefined>;
  put(key: string, run: LoadedRun): Promise<void>;
}

/**
 * The host's part of the key: the node that runs golden, and its `ocr` rows — skipped (why), or asked and read by this
 * recognizer (the toolchain that compiles it, the macOS build whose Vision runs it).
 */
export interface Host {
  node: string;
  ocr: { skipped: string } | { asked: string };
}

/**
 * This host as a golden process here sees it: this node, and the harness's own OCR probe (ocr-probe.ts#probeHarness,
 * what golden.ts#ocrAvailability decides by) — the rows skipped, or asked and the recognizer's toolchain and macOS
 * build (`sw_vers -buildVersion`; the kernel's version where that does not answer).
 */
export async function thisHost(exec: HostExec = processExec): Promise<Host> {
  const probe = await probeHarness(exec);
  const skipped = ocrSkip(probe);
  if (skipped !== undefined) return { node: process.version, ocr: { skipped } };
  const build = await exec('sw_vers', ['-buildVersion']).then(
    (o) => `macOS ${o.stdout.toString('utf8').trim()}`,
    () => osVersion(),
  );
  return { node: process.version, ocr: { asked: `${probe.toolchain?.trim() ?? 'swiftc'}; ${build}` } };
}

/** The host's processes, as the probe runs them (ocr-probe.ts#probeRecognizer). */
type HostExec = Parameters<typeof probeHarness>[0];
const processExec: HostExec = async (cmd, args) => {
  const { stdout, stderr } = await promisify(execFile)(cmd, args, { encoding: 'buffer' });
  return { stdout, stderr: stderr.toString('utf8') };
};

/**
 * Whether `run`'s `ocr` rows were decided as `host` says (thisHost, the key's): every one asked where the host asks
 * them, every one skipped for the host's reason where it skips them. golden decides per process (golden.ts
 * #ocrAvailability, the same probe), so a process can disagree with the probe that made the key — a transient failure,
 * another sandbox — and its run is then no run of that key.
 */
export const decidedAsHost = (run: LoadedRun, host: Host): boolean => {
  const skip = 'skipped' in host.ocr ? host.ocr.skipped : undefined;
  return [...run.checks.values()].every((c) => c.verb !== 'ocr' || c.skipped === skip);
};

/**
 * The checkout's own files every run is loaded by, besides the harness's: the lock (the dependencies), package.json
 * (its `type`, how node loads every module) and tsconfig.json (how tsx compiles the harness and the working tree's
 * src). A commit side's own are in its SHA; these are this checkout's, which runs every side.
 */
const CHECKOUT_FILES = ['package-lock.json', 'package.json', 'tsconfig.json'] as const;

/** The harness's directories, every file of which is in the key. */
export const HARNESS_DIRS = ['scripts/differential', 'scripts/truth', 'tests/differential/golden', 'tests/fixtures'] as const;
/**
 * In the harness's directories but no input of a run: the table calibrate judges the runs by, and the Markdown (the
 * READMEs: a run reads none).
 */
const isInput = (file: string) => file !== 'scripts/truth/calibration.json' && !file.endsWith('.md');
/** The process every side runs: where harnessImports starts. */
const GOLDEN = 'scripts/differential/golden.ts';
/** Where the harness loads the side's own src, by a path it computes from the side's root: the side's part of the key. */
const SIDE_LOADER = 'scripts/differential/side.ts';

/** Every file under `dir` (none when it is not there), absolute. */
const filesUnder = (dir: string): string[] =>
  !existsSync(dir) ? [] : readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? filesUnder(join(dir, d.name)) : [join(dir, d.name)]));

/**
 * The relative specifiers a module loads at run time, as TypeScript parses them: an `import … from`, a bare `import`,
 * an `export … from`, an `import x = require()`, and a literal `import()` or `require()` — not an `import type` or
 * `export type … from`, which the run never loads. A computed `import()` or `require()` is an error — the closure would
 * miss what it loads, and the key with it — but in SIDE_LOADER (`computed: 'the side'`), whose are the side's src.
 */
function runTimeImports(file: string, computed: 'error' | 'the side'): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const literal = (e: ts.Node | undefined) => (e !== undefined && (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) ? e.text : undefined);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly !== true) found.push(literal(node.moduleSpecifier)!);
    else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier !== undefined) found.push(literal(node.moduleSpecifier)!);
    else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) found.push(literal(node.moduleReference.expression)!);
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const specifier = literal(node.arguments[0]);
      if (specifier === undefined && computed === 'the side') return ts.forEachChild(node, visit);
      if (specifier === undefined) throw new Error(`side-cache: ${file} loads a module it computes (${node.getText(source).slice(0, 80)}) — the cache key cannot follow it`);
      found.push(specifier);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found.filter((s) => s.startsWith('./') || s.startsWith('../'));
}

/**
 * The files of this checkout a golden process loads, from GOLDEN through every run-time import (a `.js` specifier is
 * its `.ts` source), as paths relative to `repo`. The side's own src is loaded by path (side.ts#loadSide), so it is not
 * among them: that is the side's part of the key.
 */
export function harnessImports(repo: string, entry = GOLDEN): string[] {
  const seen = new Set([resolve(repo, entry)]);
  const queue = [...seen];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const specifier of runTimeImports(file, file === resolve(repo, SIDE_LOADER) ? 'the side' : 'error')) {
      const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
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
  const own = CHECKOUT_FILES.filter((f) => existsSync(join(repo, f)));
  return digestOf(
    repo,
    [...dirs.filter(isInput), ...harnessImports(repo), ...own],
    [`node ${host.node}`, 'asked' in host.ocr ? `ocr asked: ${host.ocr.asked}` : `ocr skipped: ${host.ocr.skipped}`],
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

/**
 * The cache in `dir`, one JSON file per key; written whole or not at all (several sides finish at once, two sides of
 * one key among them: each write stages a file of its own).
 */
export function sideCache(dir: string): SideCache {
  const path = (key: string) => join(dir, `${key}.json`);
  let staged = 0;
  return {
    async get(key) {
      try {
        const { checks } = JSON.parse(await readFile(path(key), 'utf8')) as { checks: GoldenCheck[] };
        return { checks: new Map(checks.map((c) => [keyOf(c), c])) };
      } catch {
        return undefined; // none kept, or not whole: run the side again
      }
    },
    async put(key, run) {
      await mkdir(dir, { recursive: true });
      const staging = `${path(key)}.${process.pid}.${staged++}`;
      await writeFile(staging, JSON.stringify({ checks: [...run.checks.values()] }));
      await rename(staging, path(key));
    },
  };
}
