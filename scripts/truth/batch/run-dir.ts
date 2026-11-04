import { join, relative, sep } from 'node:path';
import type { BatchFs } from './io.js';
import { oneLine } from './words.js';

/**
 * Where a run writes, and when it must not start.
 *
 * Every block writes into `<out>/<block>/run-<RUN_ID>/`, a folder made fresh for this run: never emptied, never reused,
 * never removed. batch-3's B2 lost its raw data on 2026-11-02 when a second run emptied `batch-3/B2` before its
 * prechecks stopped it; since batch-11 every block has a run folder of its own, and an earlier run's are only read.
 *
 * A run must not start over state an earlier run did not provably put back: a RESTORE file left, or an earlier run's
 * state file not clean. batch-7 to batch-9 only renamed a leftover RESTORE aside with a WARN; batch-10 refused, since
 * a new run would bury it; batch-11 read the state of every earlier run folder, not only the last.
 */

/** A probe's state file: `{dirty: false, …}` once a restore has been verified; anything else is not proven clean. */
export type DirtyState = 'dirty' | 'clean' | 'unreadable';

/** The RESTORE file's name, at the top of the out folder. */
export const RESTORE_FILE = 'RESTORE.txt';

/** Where the RESTORE file goes once its hand commands are done (the refusal says so; the shell fills in the date). */
const RESTORE_DONE = 'RESTORE.done-$(date +%Y%m%d-%H%M%S).txt';

/** The state file's name in a stateful block's run folder (the probes' `--state` file). */
export const STATE_FILE = 'state.json';

/**
 * `dirty` read with JSON's own parser: clean only when it is exactly `false`; dirty when the file is a JSON object
 * with anything else there (or nothing); unreadable when the file is missing, cut short, or no JSON object.
 */
export function stateOf(fs: BatchFs, file: string): DirtyState {
  let state: unknown;
  try {
    state = JSON.parse(fs.read(file) ?? '');
  } catch {
    // missing or no JSON: no object, so unreadable
  }
  if (typeof state !== 'object' || state === null || Array.isArray(state)) return 'unreadable';
  return (state as { dirty?: unknown }).dirty === false ? 'clean' : 'dirty';
}

/** A block whose run folders may hold a state file: what is not put back when it is dirty, and the hand lines for it. */
export interface Stateful {
  block: string;
  /** Said in the refusal: `(<what>)`, e.g. "E5 not put back". */
  what: string;
  /** The commands that put it back by hand, one line each (`  → …`). */
  hand: (stateFile: string) => string[];
}

/** The run's files under its out folder: nothing literal, everything from the folder the batch was given. */
export interface Layout {
  /** What an earlier run could not put back: its presence alone refuses the next run. */
  restoreFile: string;
  /** Every run's steps, appended. */
  stepsFile: string;
  /** A symlink to the latest run's `.out`. */
  latestOut: string;
  /** This run's own output, in its meta folder. */
  outFile: string;
}

export const layoutOf = (out: string, name: string, metaDir: string): Layout => ({
  restoreFile: join(out, RESTORE_FILE),
  stepsFile: join(out, 'steps.log'),
  latestOut: join(out, `${name}.out`),
  outFile: join(metaDir, `${name}.out`),
});

/** Whether `inner` is `outer` or lies under it, symlinks resolved on both sides. */
function within(fs: BatchFs, inner: string, outer: string): boolean {
  const rel = relative(fs.real(outer), fs.real(inner));
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * Why the run must not start — none when it may. In order: an out folder inside the checkout (`repo`: it must stay
 * clean, and a status of tracked files only would not see the run's files); the RESTORE file, with its hand lines and
 * how to move it aside once done; every earlier run's state file of every stateful block that is not clean.
 */
export function refusals(fs: BatchFs, { out, repo, stateful }: { out: string; repo?: string; stateful: readonly Stateful[] }): string[] {
  const lines: string[] = [];
  if (repo !== undefined && within(fs, out, repo)) lines.push(`the out folder ${out} lies inside the checkout ${repo}: give an --out outside it`);
  const restore = join(out, RESTORE_FILE);
  if (fs.exists(restore)) {
    const text = fs.read(restore) ?? '(unreadable)';
    lines.push(`${restore} exists (an earlier run left state not provably put back):`);
    lines.push(...text.split('\n').filter((l) => l !== ''));
    lines.push(`  → run its hand commands, then: mv ${restore} ${join(out, RESTORE_DONE)}`);
  }
  for (const s of stateful) {
    for (const run of fs.list(join(out, s.block)).filter((n) => n.startsWith('run-'))) {
      const file = join(out, s.block, run, STATE_FILE);
      if (!fs.exists(file)) continue;
      const state = stateOf(fs, file);
      if (state === 'clean') continue;
      lines.push(`${file} ${state === 'dirty' ? 'is dirty' : 'is unreadable, so not provably clean'} (${s.what}):`, ...s.hand(file));
    }
  }
  return lines;
}

/** The refusal as the batch prints it, before it exits 2. */
export const refusalLines = (name: string, reasons: readonly string[]): string[] => [`ERROR ${name} refuses to start — nothing was done:`, ...reasons];

const two = (n: number) => String(n).padStart(2, '0');
/** A run's id: its local start time and the pid, `YYYYMMDD-HHMMSS-<pid>` (as `date +%Y%m%d-%H%M%S`-$$). */
export const newRunId = (now: Date, pid: number): string =>
  `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}-${pid}`;

/** A RUN_ID or a block name: one plain path segment, so its folder cannot leave `<out>`. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const BLOCK = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
/** The run's own folder (its .out, the checkout line): not a block name. */
export const META = 'meta';

export type OpenedRun = { ok: true; dirs: Readonly<Record<string, string>> } | { ok: false; error: string };

/**
 * Make this run's folders: `<out>/meta/run-<id>/` and one per wanted block — none for a block not wanted. First every
 * block's folder of this id, wanted or not, and meta's, must not exist: any one that does refuses, and nothing is
 * made. Each mkdir is exclusive too, so a folder made between the check and the mkdir refuses as well (the folders
 * made before it stay, empty: nothing is ever removed). A RUN_ID or block name that is no plain path segment is a programming error.
 */
export function openRun(fs: BatchFs, { out, runId, blocks, wanted }: { out: string; runId: string; blocks: readonly string[]; wanted: readonly string[] }): OpenedRun {
  if (!RUN_ID.test(runId)) throw new Error(`RUN_ID ${JSON.stringify(runId)}: one plain path segment is needed`);
  for (const b of blocks) {
    if (!BLOCK.test(b) || b === META) throw new Error(`block name ${JSON.stringify(b)}: one plain path segment, not "${META}", is needed`);
    if (blocks.indexOf(b) !== blocks.lastIndexOf(b)) throw new Error(`block ${b} is named twice`);
  }
  for (const w of wanted) if (!blocks.includes(w)) throw new Error(`wanted block ${w} is not a block of the batch`);
  const dirOf = (b: string) => join(out, b, `run-${runId}`);
  const refused = (d: string): OpenedRun => ({ ok: false, error: `ERROR the run folder ${d} already exists: nothing was done` });
  const taken = [META, ...blocks].map(dirOf).find((d) => fs.exists(d));
  if (taken !== undefined) return refused(taken);
  const dirs: Record<string, string> = {};
  for (const b of [META, ...blocks.filter((x) => wanted.includes(x))]) {
    try {
      fs.mkdirExclusive(dirOf(b));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return refused(dirOf(b));
      throw e;
    }
    dirs[b] = dirOf(b);
  }
  return { ok: true, dirs };
}

/**
 * Append the hand commands of state not provably put back: `<header>; state to put back by hand:`, then one line each.
 * Nothing to put back: nothing written (false). Appended, never overwritten: a second write in the same run (the end,
 * then an abort) keeps the first's lines.
 */
export function writeRestore(fs: BatchFs, file: string, { header, hand }: { header: string; hand: readonly string[] }): boolean {
  if (hand.length === 0) return false;
  const lines = [`${header}; state to put back by hand:`, ...hand].map((l) => oneLine(l, 'a RESTORE line'));
  fs.append(file, `${lines.join('\n')}\n`);
  return true;
}
