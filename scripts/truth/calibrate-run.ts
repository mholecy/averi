import type { GoldenJson } from '../differential/golden.js';
import { sideRunOf, WORKING_TREE, type SideRun } from './side-run.js';
import type { SideCache } from './side-cache.js';

/**
 * Running the sides of the calibration (calibrate.ts, which holds the model and the command line): golden as a process
 * over a commit's checkout or the working tree, its stdout read as a SideRun, a process that failed itself run once
 * more, and why a side did not load (runSide); every side of a run taken from the cache (side-cache.ts) or run, several
 * at once (runSides). tests/truth/calibration.test.ts pins it with a fake golden, checkout and cache.
 */

const lastLine = (stdout: string) => stdout.trim().split('\n').at(-1) ?? '';
const jsonOf = (line: string): GoldenJson | undefined => {
  try {
    return JSON.parse(line) as GoldenJson;
  } catch {
    return undefined;
  }
};

/** golden's stdout (its JSON on the last line) as a SideRun; `failure` is why the process failed, if it did. */
export function sideRunFromOutput(stdout: string, failure?: string): SideRun {
  const json = lastLine(stdout);
  const parsed = jsonOf(json);
  return parsed === undefined ? { error: failure ?? `no JSON from golden: ${json.slice(0, 200)}` } : sideRunOf(parsed);
}

/** execFile's error for a process that failed: its exit code (or a spawn error's code), the signal that killed it. */
export interface ProcessError {
  code?: number | string | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  message: string;
}

/**
 * Why a golden process failed: killed by a signal, its exit code or its spawn error — and the last 3 lines of its
 * stderr.
 */
export function failureOf(err: ProcessError): string {
  const how =
    err.signal != null
      ? `killed by ${err.signal}`
      : typeof err.code === 'number'
        ? `exit code ${err.code}`
        : err.code != null
          ? `spawn error ${err.code}`
          : err.message.split('\n')[0];
  const tail = (err.stderr ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(-3);
  return `${how}; ${tail.length > 0 ? `stderr: ${tail.join(' | ')}` : 'no stderr'}`;
}

/** What runSide needs from the world: golden run as a process, and a checkout of a commit. */
export interface SideDeps {
  /** Runs golden with these arguments: its stdout, or rejects with execFile's error (ProcessError). */
  golden: (args: string[]) => Promise<string>;
  /** golden's arguments over a code root. */
  args: (root: string) => string[];
  /** checkout.ts#codeRoot for a commit; throws when it cannot be checked out. */
  checkout: (sha: string) => { root: string; cleanup?: () => void };
}

export interface SideOutcome {
  run: SideRun;
  /** Removes the checkout, when this run created it. */
  cleanup?: () => void;
  /** Why the first golden process failed, when the side was run twice. */
  retried?: string;
  /** Taken from the cache, not run. */
  cached?: true;
  /** Run, loaded, and not kept: what its key covers was edited while it ran (runSides), so no key names the run. */
  unkept?: true;
}

/**
 * One side's run: its checkout (the working tree is `repo` itself), then golden over it. golden exits 1 on any mismatch
 * with its JSON still on stdout; a process that printed no JSON or was killed failed itself — not the side's tool — and
 * is run once more. A side that still does not load carries why (failureOf, or git's stderr for a checkout).
 */
export async function runSide(side: string, repo: string, deps: SideDeps): Promise<SideOutcome> {
  let code: { root: string; cleanup?: () => void };
  try {
    code = side === WORKING_TREE ? { root: repo } : deps.checkout(side);
  } catch (e) {
    return { run: { error: `no checkout: ${(e as Error).message.replace(/\s*\n\s*/g, ' ')}` } };
  }
  const once = async (): Promise<{ run: SideRun; failed?: string }> => {
    try {
      return { run: sideRunFromOutput(await deps.golden(deps.args(code.root))) };
    } catch (e) {
      const err = e as ProcessError;
      const failure = failureOf(err);
      const stdout = err.stdout ?? '';
      return { run: sideRunFromOutput(stdout, failure), ...((err.signal != null || jsonOf(lastLine(stdout)) === undefined) && { failed: failure }) };
    }
  };
  const first = await once();
  if (first.failed === undefined) return { run: first.run, cleanup: code.cleanup };
  return { run: (await once()).run, cleanup: code.cleanup, retried: first.failed };
}

/**
 * The console line for a side: ran, from the cache, or DID NOT LOAD with why; why it was run twice; and that a run was
 * not kept.
 */
export const sideLine = (side: string, o: SideOutcome, seconds: number): string =>
  o.cached === true
    ? `calibrate: ${side} from the cache`
    : `calibrate: ${side} ${'error' in o.run ? `DID NOT LOAD — ${o.run.error}` : 'ran'} in ${seconds.toFixed(1)} s` +
      (o.retried === undefined ? '' : ` (run twice: the first golden process failed — ${o.retried})`) +
      (o.unkept === undefined ? '' : ' (not kept: the harness or the side\'s src was edited while it ran)');

/** Calls `task` on every item, at most `jobs` at once, each started as soon as one finishes; the results in order. */
export async function pool<T, R>(items: readonly T[], jobs: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await task(items[i]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, items.length)) }, worker));
  return out;
}

/** How runSides runs the sides: one side's run, the cache and its keys, how many at once. */
export interface Sides {
  /** One side's run (runSide over the real golden and checkouts). */
  run: (side: string) => Promise<SideOutcome>;
  cache: SideCache;
  /**
   * The sides' keys as the checkout is on disk now (side-cache.ts#sideKeys; undefined: run the side, never keep it) —
   * taken when the run starts, and again when a side has run: its run is kept only under the key it was run at.
   */
  keys: () => (side: string) => string | undefined;
  /** `reuse`: a run kept under the side's key stands in for it; `refresh` (--no-cache): every side run, kept afresh. */
  mode: 'reuse' | 'refresh';
  jobs: number;
  /** Told each side's console line (sideLine) as it is done. */
  log: (line: string) => void;
}

/** A side's key taken again after its run; undefined when the keys no longer derive (a computed import added mid-run). */
const keyNow = (s: Sides, side: string): string | undefined => {
  try {
    return s.keys()(side);
  } catch {
    return undefined;
  }
};

/**
 * Every side's run, by side: from the cache where a run is kept under its key (`reuse`), else run — `jobs` at once
 * (pool) — and kept if it loaded (one that did not may have failed itself, and is run again next time) and its key held
 * while it ran (an edit mid-run: the run is of neither content). The checkouts the runs created are handed back for
 * --remove, and the sides taken from the cache are named.
 */
export async function runSides(sides: readonly string[], s: Sides): Promise<{ runs: Map<string, SideRun>; cleanups: (() => void)[]; cached: string[] }> {
  const cacheKeyOf = s.keys();
  const outcomes = await pool(sides, s.jobs, async (side): Promise<SideOutcome> => {
    const started = Date.now();
    const key = cacheKeyOf(side);
    const kept = key === undefined || s.mode === 'refresh' ? undefined : await s.cache.get(key);
    let outcome: SideOutcome = kept !== undefined ? { run: kept, cached: true } : await s.run(side);
    if (key !== undefined && outcome.cached === undefined && !('error' in outcome.run)) {
      if (keyNow(s, side) === key) await s.cache.put(key, outcome.run);
      else outcome = { ...outcome, unkept: true };
    }
    s.log(sideLine(side, outcome, (Date.now() - started) / 1000));
    return outcome;
  });
  return {
    runs: new Map(sides.map((side, i) => [side, outcomes[i].run])),
    cleanups: outcomes.flatMap((o) => (o.cleanup === undefined ? [] : [o.cleanup])),
    cached: sides.filter((_, i) => outcomes[i].cached === true),
  };
}
