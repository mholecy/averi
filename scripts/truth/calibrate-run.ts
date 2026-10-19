import type { GoldenJson } from '../differential/golden.js';
import { sideRunOf, WORKING_TREE, type SideRun } from './calibrate.js';

/**
 * Running one side of the calibration (calibrate.ts, which holds the model and the command line): golden as a process
 * over a commit's checkout or the working tree, its stdout read as a SideRun, a process that failed itself run once
 * more, and why a side did not load. tests/truth/calibration.test.ts pins it with a fake golden and checkout.
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

/** The console line for a side: ran, or DID NOT LOAD with why; and why it was run twice. */
export const sideLine = (side: string, o: SideOutcome, seconds: number): string =>
  `calibrate: ${side} ${'error' in o.run ? `DID NOT LOAD — ${o.run.error}` : 'ran'} in ${seconds.toFixed(1)} s` +
  (o.retried === undefined ? '' : ` (run twice: the first golden process failed — ${o.retried})`);
