import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CallResult } from './bounded.js';
import { incompleteLine, type Asked } from './cases.js';
import { DEFAULT_GROUPS } from './live-table.js';
import { shortSha, type CheckoutPrecondition } from './preconditions.js';
import { canonicalJson, failedCall, firstLineOf, nameInLine, refusedLine, verdictLine } from './words.js';

/**
 * The runner's pure half (runner.ts holds the calls and the files): its config read from argv and env, the lines it
 * writes of its own — the checkout line, the lab lines, a block not run for a need, the backstop — the non-live
 * records' rule, the ERROR lines it collects, the details printout before the SUMMARY, and live.ts's argv. Strings in,
 * strings out, as words.ts; split as ios-defaults.ts and lab-chooser.ts are from their io (T2 S4, S5).
 */

/** The checkout this module lives in: the repo a batch tests unless it names another (live-cases.ts's ROOT). */
export const MODULE_REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

/** An env as a batch reads it: the knobs, ONLY=, the config's fallbacks. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Where a run writes and what it runs against: nothing literal, every path and device id from argv or env. */
export interface BatchConfig {
  /** The out folder: every run's folders, steps.log, RESTORE.txt (an absolute path, outside the checkout). */
  out: string;
  /** The checkout under test (absolute): its git, its live.ts and live-cases.ts. */
  repo: string;
  /** The lab simulator's udid (`--udid`, AVERI_LAB_UDID); none: no iOS run can be made. */
  udid?: string;
  /** The lab emulator's serial (`--serial`, AVERI_LAB_SERIAL); none: no Android run can be made. */
  serial?: string;
  /** The env the knobs and ONLY= are read from. */
  env: Env;
  /** The Android SDK a lab build uses (ANDROID_HOME, else the SDK under the home folder); none: the build's own. */
  androidHome?: string;
}

/** The config, or why the batch must not start (refusal lines: exit 2, nothing done). */
export type ConfigRead = { ok: true; config: BatchConfig } | { ok: false; errors: string[] };

const FLAGS: Readonly<Record<string, 'out' | 'repo' | 'udid' | 'serial'>> = { '--out': 'out', '--repo': 'repo', '--udid': 'udid', '--serial': 'serial' };
/** Each value's env fallback (t2-analysis §5); the repo has none: it is the module's own checkout by default. */
const FALLBACK = { out: 'AVERI_BATCH_OUT', udid: 'AVERI_LAB_UDID', serial: 'AVERI_LAB_SERIAL' } as const;

/**
 * The config from a batch's argv (`--out <dir> --udid <sim> --serial <emu> [--repo <checkout>]`), each value falling
 * back to its env variable (an empty one is unset), the repo to `repo` (this module's checkout). No out folder, a
 * relative out or repo, an unknown option, a flag without its value (none, or another flag next) or a flag given twice:
 * refused, every error at once, in order. A device id not given is left out, never empty. The Android SDK: ANDROID_HOME,
 * else the one under `home` (T2 S6b code review: the lab build reads the config, not the home folder).
 */
export function configOf(argv: readonly string[], env: Env, repo = MODULE_REPO, home = homedir()): ConfigRead {
  const errors: string[] = [];
  const given: Partial<Record<'out' | 'repo' | 'udid' | 'serial', string>> = {};
  for (let i = 0; i < argv.length; i++) {
    const key = FLAGS[argv[i]];
    if (key === undefined) {
      errors.push(refusedLine(`${nameInLine(argv[i])} is no option of a batch (${Object.keys(FLAGS).join(', ')})`));
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      errors.push(refusedLine(`${argv[i]} needs a value`));
      continue;
    }
    i++;
    if (given[key] !== undefined) errors.push(refusedLine(`${argv[i - 1]} is given twice`));
    else given[key] = value;
  }
  const valueOf = (key: keyof typeof FALLBACK): string | undefined => given[key] ?? (env[FALLBACK[key]] === '' ? undefined : env[FALLBACK[key]]);
  const out = valueOf('out');
  const theRepo = given.repo ?? repo;
  if (out === undefined) errors.push(refusedLine(`no out folder: pass --out <dir> or set ${FALLBACK.out}`));
  else if (!isAbsolute(out)) errors.push(refusedLine(`the out folder ${nameInLine(out)} is not an absolute path`));
  if (!isAbsolute(theRepo)) errors.push(refusedLine(`the repo ${nameInLine(theRepo)} is not an absolute path`));
  if (errors.length > 0) return { ok: false, errors };
  const [udid, serial] = [valueOf('udid'), valueOf('serial')];
  // No error: the out folder was given (its absence is one).
  const androidHome = env.ANDROID_HOME === undefined || env.ANDROID_HOME === '' ? join(home, 'Library', 'Android', 'sdk') : env.ANDROID_HOME;
  return { ok: true, config: { out: out as string, repo: theRepo, ...(udid === undefined ? {} : { udid }), ...(serial === undefined ? {} : { serial }), env, androidHome } };
}

/** The lab folder: made on every run (batch-11's O_lab), for what the lab checks keep: a pulled APK, a log. */
export const LAB = 'lab';

/**
 * The SUMMARY's checkout line (batch-11's CHECKOUT_LINE): `OK checkout: main's HEAD <sha>, clean`, or ERROR with S3's
 * why and what it means — no block runs, each is INCONCLUSIVE naming the why, and the SUMMARY is still written.
 */
export function checkoutLine(r: CheckoutPrecondition): string {
  return r.ok ? `OK checkout: main's HEAD ${shortSha(r.head)}, clean` : `ERROR checkout: ${r.why} — every block INCONCLUSIVE, none run`;
}

/** The abort's checkout line when the checkout had not been read yet. */
export const NOT_READ_CHECKOUT = 'NOTE checkout: not read before the interrupt';

/** A need's answer (S6b supplies the checks): met, and how; or not, and why. */
export type NeedResult = { ok: true; how: string; warning?: string } | { ok: false; why: string };

/**
 * A need's lab line, its first line only: `LAB <need>: OK — <how>`; met with a warning (this run's build failed, the
 * app already installed is used — T2 S6b review round 1), `LAB <need>: WARN — <warning>: <how>`; not met, `LAB <need>:
 * ERROR — <why>`.
 */
export function labLine(need: string, r: NeedResult): string {
  const label = `LAB ${need}`;
  if (!r.ok) return verdictLine(label, 'ERROR', firstLineOf(r.why));
  return r.warning === undefined ? verdictLine(label, 'OK', firstLineOf(r.how)) : verdictLine(label, 'WARN', firstLineOf(`${r.warning}: ${r.how}`));
}

/** A block not run for its failed needs: `<label>: INCONCLUSIVE — <need>: <why>; …`, in the block's order. */
export const needsLine = (label: string, failed: readonly { need: string; why: string }[]): string =>
  verdictLine(label, 'INCONCLUSIVE', failed.map((f) => `${f.need}: ${firstLineOf(f.why)}`).join('; '));

/** How many calls of one need are recorded (T2b): past it, one line says the rest were not. */
export const NEED_CALLS_MAX = 500;
/** How much of an argument, or of a failed call's first line, a recorded call keeps, in code points, before `…`. */
export const NEED_CALL_CHARS = 200;

/** One call a need's check, alive or end made (runner.ts records each), with what it answered. */
export interface NeedCall {
  need: string;
  phase: 'check' | 'alive' | 'end';
  /** Its time of day (words.ts#timeOf), as the steps say it. */
  at: string;
  cmd: string;
  args: readonly string[];
  secs?: number;
  result: CallResult;
}

/** A need's calls' file in the lab folder: `<need>-calls.jsonl`, appended, never overwritten. */
export const needCallsFile = (labDir: string, need: string): string => join(labDir, `${need}-calls.jsonl`);

const cut = (text: string): string => {
  const c = [...text];
  return c.length > NEED_CALL_CHARS ? `${c.slice(0, NEED_CALL_CHARS).join('')}…` : text;
};

/**
 * One call as its line (T2b, batch-13 gap 6: batch-13 wrapped the ios need's calls itself to see why a reset failed):
 * one JSON object, its fields sorted — the need, the phase, the time, the command's base name, its args, its bound, its
 * exit — and, for a call that failed, its first line (stderr's before stdout's), no more of its output than a step line
 * says; no env. Each argument and that line cut at NEED_CALL_CHARS. The args keep the host paths a call names (the
 * checkout's, a build's): accepted (T2b review round 1) — the file lives in the run's lab folder, outside the checkout,
 * beside the run's other files that name them; the udid and serial are lab facts already there.
 */
export function needCallLine(c: NeedCall): string {
  const { result: r } = c;
  const said = failedCall(r) ? { said: cut(firstLineOf(r.err + r.out)) } : {};
  return `${canonicalJson({ need: c.need, phase: c.phase, at: c.at, cmd: basename(c.cmd), args: c.args.map(cut), secs: c.secs, code: r.code, timedOut: r.timedOut, ...said })}\n`;
}

/** The line after NEED_CALLS_MAX calls of a need: the rest are not recorded. */
export const needCallsCutLine = (need: string): string => `${canonicalJson({ need, dropped: `the calls past the first ${NEED_CALLS_MAX} not recorded` })}\n`;

/** Why a need's key is unread when its end passed its bound (the ERROR line's and endUnread's). */
export const endLateWhy = (secs: number): string => `its end did not finish within ${secs} s`;
/** Why a need's key is unread when its end threw: its message's first line. */
export const endThrewWhy = (message: string): string => `its end threw: ${firstLineOf(message)}`;
/** Why the abort's SUMMARY says a need's key unread (endUnread's why): no end was asked once interrupted. */
export const ABORT_UNREAD = 'not read at its end: the run was interrupted (the abort reads nothing)';
/** The ERROR line's text for a need's end that could not say its key. */
export const needEndError = (need: string, why: string): string => `LAB ${need}: ${why}`;
/** The NOTE for a protected-key line an end wrote after its bound: kept aside, taken only if it settles in time. */
export const lateLineNote = (need: string, line: string): string => `LAB ${need}: a protected-key line after its end's bound, kept if its end finishes before the SUMMARY: ${line}`;
/** The NOTE, once per need, when its calls' file cannot be written: never the need's failure. */
export const callsNotRecordedNote = (need: string, message: string): string => `LAB ${need}: its calls not recorded (${firstLineOf(message)})`;

/** The backstop's words for a block that asked nothing and wrote no verdict line (batch-11.sh:689–696). */
export const NOT_RUN = 'not run (see the ERROR lines)';

/** A run a block asked — a live run's Completeness or a record's — as the backstop reads it. */
export interface AskedRun {
  name: string;
  result: { ok: true } | { ok: false; why: string };
}

/**
 * The backstop: the line of a wanted block that wrote none of its label. S3's incompleteLine, the one source of the
 * words for runs not complete — with nothing asked, `not run (see the ERROR lines)` (NOT_RUN, its `none`). Every run
 * complete: the analyzer wrote nothing, said so.
 */
export function backstopLine(label: string, runs: readonly AskedRun[]): string {
  return incompleteLine(label, runs, NOT_RUN) ?? verdictLine(label, 'INCONCLUSIVE', `its ${runs.length} run(s) are complete, but no verdict line was written (see the ERROR lines)`);
}

/** Whether `lines` hold one of the block's own label (`<label>:` at the start, whatever follows): batch-11's grep. */
export const hasVerdictOf = (lines: readonly string[], label: string): boolean => lines.some((l) => l.startsWith(`${label}:`));

/**
 * A probe's or an analyzer's text as lines: split at CR LF, LF and a lone CR (a progress line a terminal overwrites),
 * so no line the runner keeps holds a break — the SUMMARY refuses one, and must never be lost to a probe's output.
 */
export const linesOf = (text: string): string[] => text.split(/\r\n|\n|\r/);

/** `texts` as lines (linesOf), empty ones dropped: what a judge or an analyzer hands in. */
export const linesIn = (texts: readonly string[]): string[] => texts.flatMap(linesOf).filter((l) => l !== '');

/** The lines of a log or an analyze.txt that start with ERROR (a step line's word; batch-12's `grep -h '^ERROR'`). */
export const errorLinesIn = (text: string): string[] => linesOf(text).filter((l) => l.startsWith('ERROR'));

/**
 * How many distinct ERROR lines the SUMMARY shows from this run's logs: a probe looping on errors must not bury the
 * rest.
 */
export const ERROR_LINES_SHOWN = 20;

/** How many logs an ERROR line's `in …` names before `+<n> more`. */
export const WHERE_SHOWN = 3;

/** `line` at most `max` code points, `…` its last when cut. */
const cutTo = (line: string, max: number): string => {
  const points = [...line];
  return points.length <= max ? line : `${points.slice(0, max - 1).join('')}…`;
};

/** Names as a line lists them: the first WHERE_SHOWN, then `+<n> more`. */
const whereOf = (names: readonly string[]): string => [...names.slice(0, WHERE_SHOWN), ...(names.length > WHERE_SHOWN ? [`+${names.length - WHERE_SHOWN} more`] : [])].join(', ');

/** One of this run's logs: its name in a line (`<block>/<file>`), its path, its text (undefined: not read) and why. */
export interface RunLog {
  name: string;
  path: string;
  text: string | undefined;
  why?: string;
  /** Its lines start with a step's time (steps.log): set aside to count them. */
  timed?: boolean;
}

/** A step line's time, `HH:MM:SS ` (steps.ts#StepLog.note). */
const STEP_TIME = /^\d\d:\d\d:\d\d /;

/**
 * This run's ERROR lines, for the SUMMARY (T2 S6a review rounds 1–3, code review): its steps' (steps.log, timed) and
 * its logs', counted across them all first (a step's line by what it says, its time aside), one line per distinct ERROR
 * in first-seen order — said once in one log, bare; else `(×<total>, in <logs>)` — each cut so the whole is at most
 * DETAIL_CHARS; at most ERROR_LINES_SHOWN of them, then `… <n> more distinct ERROR lines (in <logs>)`. Then a NOTE for
 * each log that could not be read, naming its path and what is known of why: never skipped.
 */
export function logErrors(logs: readonly RunLog[]): string[] {
  const seen = new Map<string, { first: string; n: number; in: string[] }>();
  for (const log of logs) {
    // An unread log holds no line to count: it is said below, as a NOTE.
    if (log.text === undefined) continue;
    for (const line of linesOf(log.text)) {
      // A step line (steps.log's, `timed`) is counted by what it says, shown as first seen; any other log's as it is.
      const said = log.timed === true ? line.replace(STEP_TIME, '') : line;
      if (!said.startsWith('ERROR')) continue;
      const e = seen.get(said) ?? { first: line, n: 0, in: [] };
      e.n++;
      if (!e.in.includes(log.name)) e.in.push(log.name);
      seen.set(said, e);
    }
  }
  const all = [...seen.values()].map((e) => [e.first, e] as const);
  const shown = all.slice(0, ERROR_LINES_SHOWN).map(([l, e]) => {
    const tail = e.n > 1 ? ` (×${e.n}, in ${whereOf(e.in)})` : '';
    return `${cutTo(l, DETAIL_CHARS - tail.length)}${tail}`;
  });
  const hidden = all.slice(ERROR_LINES_SHOWN);
  const where = [...new Set(hidden.flatMap(([, e]) => e.in))];
  const more = hidden.length > 0 ? [`… ${hidden.length} more distinct ERROR lines (in ${whereOf(where)})`] : [];
  const unread = logs.filter((l) => l.text === undefined).map((l) => `NOTE ${nameInLine(l.path)} not read: unreadable${l.why === undefined ? '' : `: ${l.why}`}`);
  return [...shown, ...more, ...unread];
}

/** A block the abort judged whose judge wrote no verdict of its label: still a line of its own. */
export const judgedNothingLine = (label: string): string => verdictLine(label, 'INCONCLUSIVE', 'interrupted: its judge wrote no verdict');

/** This run's part of steps.log: from its header line (steps.ts#StepLog.open) to the end; none without one. */
export function stepsOfRun(steps: string, name: string, runId: string): string[] {
  const lines = steps.split('\n');
  const from = lines.findIndex((l) => l.includes(` ---- ${name} run ${runId}, blocks `));
  return from < 0 ? [] : lines.slice(from).filter((l) => l !== '');
}

/** A detail line's length when a spec names none (batch-11 cut its details at 700 to 900). */
export const DETAIL_CHARS = 700;

/** What of a block's file the details print: its lines `match` matches (none: all but `==` banners), each cut. */
export interface DetailSpec {
  /** The file, in the block's run folder. */
  file: string;
  match?: RegExp;
  /** The longest line printed, in code points (DETAIL_CHARS by default). */
  cut?: number;
}

/** A file's detail lines: matched (String#search, so a g flag holds no state), empty ones out, cut, indented 3. */
export function detailLines(spec: DetailSpec, text: string): string[] {
  const keep = (l: string): boolean => (spec.match === undefined ? !l.startsWith('==') : l.search(spec.match) >= 0);
  return linesOf(text)
    .filter((l) => l !== '' && keep(l))
    .map((l) => `   ${[...l].slice(0, spec.cut ?? DETAIL_CHARS).join('')}`);
}

/**
 * The details printout, before the SUMMARY (batch-11.sh:698–716): its header, the checkout line, this run's steps,
 * each wanted block's folder and detail lines, and where everything is.
 */
export function detailsLines(d: { checkout: string; runId: string; stepsFile: string; steps: readonly string[]; blocks: readonly { id: string; dir: string; lines: readonly string[] }[]; out: string }): string[] {
  return [
    '',
    '================================ details ================================',
    d.checkout,
    `-- steps of this run (${d.runId}; the whole log: ${d.stepsFile})`,
    ...d.steps,
    ...d.blocks.flatMap((b) => [`-- ${b.id} (${b.dir}/)`, ...b.lines]),
    `== DONE — all outputs in ${d.out}/<block>/run-${d.runId} ==`,
  ];
}

/** live.ts in the checkout under test. */
export const LIVE_TS = 'scripts/truth/live.ts';

/** The lab devices' ids a run was given (`--udid`, `--serial`): none, no run on that platform. */
export interface DeviceIds {
  udid?: string;
  serial?: string;
}

/** A live run's bounds: live.ts's (B_LIVE) and its rejudge's (REJUDGE_SECS when none). */
export interface LiveBounds {
  secs: number;
  rejudgeSecs?: number;
}

/** What a live run's argv is made of: the checkout under test, what was asked, its record. */
export interface LiveRunSpec {
  repo: string;
  asked: Asked;
  record: string;
}

/** Where a lab device's id is given: its flag, or its env. */
export const UDID_FLAGS = '--udid or AVERI_LAB_UDID';
export const SERIAL_FLAGS = '--serial or AVERI_LAB_SERIAL';
/** A device id not given (`--udid`, `--serial`, or their env): no run, and no lab need, on that platform. */
export const NO_UDID = `no lab simulator udid given (${UDID_FLAGS})`;
export const NO_SERIAL = `no lab emulator serial given (${SERIAL_FLAGS})`;

/** The device flags for a live run, or why there are none: the device id not given. */
export function deviceArgs(asked: Asked, ids: DeviceIds): { args: string[] } | { why: string } {
  if (asked.platform === 'android') return ids.serial === undefined ? { why: NO_SERIAL } : { args: ['--serial', ids.serial] };
  return ids.udid === undefined ? { why: NO_UDID } : { args: ['--udid', ids.udid, '--sources', asked.sources.join(',')] };
}

const groupsOf = (asked: Asked): string => (asked.groups ?? DEFAULT_GROUPS).join(',');

/** `node`'s argv before live.ts's own: tsx, then live.ts of the checkout under test. */
const liveTs = (repo: string): string[] => ['--import', 'tsx', join(repo, LIVE_TS)];

/**
 * live.ts's argv for a run (batch-11's live_run): the device, the app unless native, the groups (forms by default), the
 * cases asked (none: all of the groups), the record.
 */
export const liveArgs = ({ repo, asked, device, record }: LiveRunSpec & { device: readonly string[] }): string[] => [
  ...liveTs(repo),
  ...device,
  ...(asked.app === 'native' ? [] : ['--app', asked.app]),
  '--groups',
  groupsOf(asked),
  ...(asked.cases.length > 0 ? ['--cases', asked.cases.join(',')] : []),
  '--record',
  record,
];

/** A live rejudge's bound when none is given: it only judges a record, device-free (batch-11 ran it unbounded). */
export const REJUDGE_SECS = 120;

/** live.ts's and its rejudge's calls: bounded (secs; rejudgeSecs, else REJUDGE_SECS), from the checkout, logged. */
export const liveCalls = ({ repo, secs, rejudgeSecs, files }: LiveBounds & { repo: string; files: { log: string; summary: string } }) => ({
  live: { secs, cwd: repo, log: files.log },
  rejudge: { secs: rejudgeSecs ?? REJUDGE_SECS, cwd: repo, log: files.summary },
});

/**
 * live.ts's rejudge of a record: main's judges, the same groups (batch-11.sh:479); its failure reasons written to
 * `failures` (cases.ts#failuresJson, A21).
 */
export const rejudgeArgs = ({ repo, asked, record, failures }: LiveRunSpec & { failures: string }): string[] => [
  ...liveTs(repo),
  '--rejudge',
  record,
  '--groups',
  groupsOf(asked),
  '--failures',
  failures,
];

/** A live step's text: OK bare; else its why and the log to read (batch-11.sh:234–237). */
export const liveStepText = (what: string, outcome: { word: 'OK' | 'DONE' | 'FAIL'; why: string }, log: string): string => (outcome.word === 'OK' ? what : `${what} (${outcome.why}) — see ${log}`);
