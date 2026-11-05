import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { incompleteLine, type Asked } from './cases.js';
import { DEFAULT_GROUPS } from './live-table.js';
import { shortSha, type CheckoutPrecondition } from './preconditions.js';
import { firstLineOf, nameInLine, refusedLine, verdictLine } from './words.js';

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
 * refused, every error at once, in order. A device id not given is left out, never empty.
 */
export function configOf(argv: readonly string[], env: Env, repo = MODULE_REPO): ConfigRead {
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
  if (errors.length > 0 || out === undefined) return { ok: false, errors };
  const [udid, serial] = [valueOf('udid'), valueOf('serial')];
  return { ok: true, config: { out, repo: theRepo, ...(udid === undefined ? {} : { udid }), ...(serial === undefined ? {} : { serial }), env } };
}

/** The lab folder: made on every run (batch-11's O_lab), for what the lab checks keep — a pulled APK, the catalog's log. */
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
export type NeedResult = { ok: true; how: string } | { ok: false; why: string };

/** A need's lab line: `LAB <need>: OK — <how>` or `LAB <need>: ERROR — <why>`, its first line only. */
export const labLine = (need: string, r: NeedResult): string => verdictLine(`LAB ${need}`, r.ok ? 'OK' : 'ERROR', firstLineOf(r.ok ? r.how : r.why));

/** A block not run for its failed needs: `<label>: INCONCLUSIVE — <need>: <why>; …`, in the block's order. */
export const needsLine = (label: string, failed: readonly { need: string; why: string }[]): string =>
  verdictLine(label, 'INCONCLUSIVE', failed.map((f) => `${f.need}: ${firstLineOf(f.why)}`).join('; '));

/** The backstop's words for a block that asked nothing and wrote no verdict line (batch-11.sh:689–696). */
export const NOT_RUN = 'not run (see the ERROR lines)';

/** A run a block asked — a live run's Completeness or a record's — as the backstop reads it. */
export interface AskedRun {
  name: string;
  result: { ok: true } | { ok: false; why: string };
}

/**
 * The backstop: the line of a wanted block that wrote none of its label. Nothing asked: `not run (see the ERROR
 * lines)`. Some run incomplete: S3's incompleteLine. Every run complete: the analyzer wrote nothing, said so.
 */
export function backstopLine(label: string, runs: readonly AskedRun[]): string {
  if (runs.length === 0) return verdictLine(label, 'INCONCLUSIVE', NOT_RUN);
  return incompleteLine(label, runs) ?? verdictLine(label, 'INCONCLUSIVE', `its ${runs.length} run(s) are complete, but no verdict line was written (see the ERROR lines)`);
}

/** Whether `lines` hold one of the block's own label (`<label>:` at the start, whatever follows): batch-11's grep. */
export const hasVerdictOf = (lines: readonly string[], label: string): boolean => lines.some((l) => l.startsWith(`${label}:`));

/**
 * A non-live block's record (batch-12's E5 and T6 wrote `{"runs":N}` as a `.cases`; S3 keeps `.cases` for live runs):
 * how many runs it was asked, then how many it did. One kind for now; another is a new member of the union.
 */
export interface RunsRecord {
  kind: 'runs';
  runs: number;
}
export type BlockRecord = RunsRecord;

/** `v` as a record, or undefined: kind `runs` and a whole number of runs, 0 or more. */
export function recordOf(v: unknown): BlockRecord | undefined {
  const r = (v ?? {}) as Record<string, unknown>;
  return r.kind === 'runs' && Number.isSafeInteger(r.runs) && (r.runs as number) >= 0 ? { kind: 'runs', runs: r.runs as number } : undefined;
}

/** A record's two files: what it was asked, written first, and what it did (`.asked.json`, `.done.json`). */
export const recordFiles = (dir: string, name: string) => ({ asked: join(dir, `${name}.asked.json`), done: join(dir, `${name}.done.json`) });

const NO_RECORD = 'is no record of runs (kind "runs", runs: a whole number)';

/** The text's record, or undefined when it is none (no JSON or another shape). */
function parsedRecord(text: string): BlockRecord | undefined {
  try {
    return recordOf(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Why the record `name` is not complete, or undefined when it is: what it recorded is what it was asked. Its asked file
 * unreadable or no record, nothing recorded, a done file that is no record, another count — each said.
 */
export function recordGap(name: string, askedText: string | undefined, doneText: string | undefined): string | undefined {
  if (askedText === undefined) return `${name}.asked.json is unreadable: what it was asked is unknown`;
  const asked = parsedRecord(askedText);
  if (asked === undefined) return `${name}.asked.json ${NO_RECORD}`;
  if (doneText === undefined) return `asked ${asked.runs} run(s), nothing recorded (no ${name}.done.json)`;
  const done = parsedRecord(doneText);
  if (done === undefined) return `${name}.done.json ${NO_RECORD}`;
  return done.runs === asked.runs ? undefined : `asked ${asked.runs} run(s), recorded ${done.runs}`;
}

/** The lines of a log or an analyze.txt that start with ERROR (a step line's word; batch-12's `grep -h '^ERROR'`). */
export const errorLinesIn = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.startsWith('ERROR'));

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
  return text
    .split('\n')
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

/** The device flags for a live run, or why there are none: the device id not given. */
export function deviceArgs(asked: Asked, ids: { udid?: string; serial?: string }): { args: string[] } | { why: string } {
  if (asked.platform === 'android') return ids.serial === undefined ? { why: 'no lab emulator serial given (--serial or AVERI_LAB_SERIAL)' } : { args: ['--serial', ids.serial] };
  return ids.udid === undefined ? { why: 'no lab simulator udid given (--udid or AVERI_LAB_UDID)' } : { args: ['--udid', ids.udid, '--sources', asked.sources.join(',')] };
}

const groupsOf = (asked: Asked): string => (asked.groups ?? DEFAULT_GROUPS).join(',');

/**
 * live.ts's argv for a run (batch-11's live_run): the device, the app unless native, the groups (forms by default), the
 * cases asked (none: all of the groups), the record.
 */
export const liveArgs = ({ repo, asked, device, record }: { repo: string; asked: Asked; device: readonly string[]; record: string }): string[] => [
  '--import',
  'tsx',
  join(repo, LIVE_TS),
  ...device,
  ...(asked.app === 'native' ? [] : ['--app', asked.app]),
  '--groups',
  groupsOf(asked),
  ...(asked.cases.length > 0 ? ['--cases', asked.cases.join(',')] : []),
  '--record',
  record,
];

/** live.ts's rejudge of a record: main's judges, the same groups (batch-11.sh:479). */
export const rejudgeArgs = ({ repo, asked, record }: { repo: string; asked: Asked; record: string }): string[] => ['--import', 'tsx', join(repo, LIVE_TS), '--rejudge', record, '--groups', groupsOf(asked)];

/** A live step's text: OK bare; else its why and the log to read (batch-11.sh:234–237). */
export const liveStepText = (what: string, outcome: { word: 'OK' | 'DONE' | 'FAIL'; why: string }, log: string): string => (outcome.word === 'OK' ? what : `${what} (${outcome.why}) — see ${log}`);
