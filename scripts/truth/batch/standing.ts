import { join } from 'node:path';
import { failuresOf } from '../rejudge-failures.js';
import { runFiles, type Asked } from './cases.js';
import { runBatch, type Block, type BlockCtx, type BlockFiles, type LiveOutcome, type RunBatchOptions, type RunIo } from './runner.js';
import { configOf, NO_SERIAL, NO_UDID, SERIAL_FLAGS, UDID_FLAGS, type ConfigRead, type Env } from './runner-lines.js';
import { selectBlocks, type KnobValues, type Selection } from './select.js';
import { shellQuote } from './shell.js';
import { EXIT, exitCodeOf, parseVerdictLine, refusedLine, verdictLine, type Summary, type Verdict } from './words.js';

/**
 * The standing lab batches' kit (backlog A21, the review's CH3): what lab-run.ts (Android, Gate B) and lab-run-ios.ts
 * (iOS, Gate C) share, in a module of its own so that neither batch leans on the other — either can go without
 * breaking the other. Composed of runBatch alone:
 *
 * - the selection (Standing, groupsOf, onlyWith, noLiveGroup, standingSelection): `--groups` as ONLY= is, every block
 *   staying the batch's, refused with every reason;
 * - the knobs (KNOBS: the live runs', the build's and a window's restore bound);
 * - a live block's run and judge (keptLiveRun, liveJudge, liveVerdictLine): main's rejudge's exit code, its FAIL naming
 *   the failure reasons the rejudge wrote as data beside its summary (../rejudge-failures.ts#failuresOf) — a file
 *   missing, not JSON or at odds with the exit code is INCONCLUSIVE, never a PASS;
 * - the run (standingRun): runBatch's result as data, its exit the standing rule (standingExitOf) over the SUMMARY it
 *   returns, read beside words.ts#exitCodeOf from the same data; the device not given, refused;
 * - the words both batches' hand lines share: the clean state file's command (cleanStateCommand) and a lab device's id
 *   or how to give it (deviceInHand).
 */

/** The lab device a standing batch runs on, by the config's id for it: the emulator's serial, or the simulator's udid. */
export const LAB_DEVICES = {
  serial: { what: 'the lab emulator', missing: NO_SERIAL, flags: SERIAL_FLAGS },
  udid: { what: 'the lab simulator', missing: NO_UDID, flags: UDID_FLAGS },
} as const;
export type LabDeviceId = keyof typeof LAB_DEVICES;

/**
 * A standing lab batch's selection words (lab-run's, lab-run-ios's): its name, the device it runs on, its live groups,
 * the `--groups` value's hint, every block in its order, and the blocks a group selects.
 */
export interface Standing<G extends string = string> {
  batch: string;
  device: LabDeviceId;
  groups: readonly G[];
  hint: string;
  blockIds: readonly string[];
  blocksOf(group: G): readonly string[];
}

/** A standing batch's exit codes: a batch's (words.ts#EXIT), and `unproven` for a run that proved nothing. */
export const STANDING_EXIT = { ...EXIT, unproven: 3 } as const;
export type StandingExit = (typeof STANDING_EXIT)[keyof typeof STANDING_EXIT];

/**
 * A standing batch's exit code, read from the same SUMMARY as words.ts#exitCodeOf and stricter: exitCodeOf's 1, 2 and
 * 130 stand; its 0 is 0 only when no judged line (the checkout's, the labs', the blocks', the protected keys') says
 * INCONCLUSIVE or ERROR, the ERROR section is empty (an unread log's NOTE in it too: what it held is not known) and
 * every label in `wanted` has a PASS line — else unproven (3).
 */
export function standingExitOf(s: Summary, wanted: readonly string[]): StandingExit {
  const code = exitCodeOf(s);
  if (code !== EXIT.ok) return code;
  const judged = [s.checkout, ...s.labs, ...s.blocks.flatMap((b) => b.lines), ...s.protectedLines].map(parseVerdictLine).filter((v) => v !== undefined);
  const proven =
    s.errors.length === 0 &&
    !judged.some((v) => v.verdict === 'INCONCLUSIVE' || v.verdict === 'ERROR') &&
    wanted.every((l) => judged.some((v) => v.label === l && v.verdict === 'PASS'));
  return proven ? STANDING_EXIT.ok : STANDING_EXIT.unproven;
}

/** The knobs (select.ts): the live runs' bound, the build's, a window's restore (the chooser's, a WDA window's). */
export const KNOBS = {
  counts: {
    B_LIVE: { default: 1800, min: 300, max: 7200, unit: 'seconds' },
    B_BUILD: { default: 2400, min: 600, max: 7200, unit: 'seconds' },
    B_RESTORE: { default: 300, min: 60, max: 1800, unit: 'seconds' },
  },
} as const;
export type StandingKnobs = KnobValues<typeof KNOBS>;

/** A standing batch's options: lab-run's and lab-run-ios.ts's (which ignores `jvms`). */
export interface StandingOptions {
  argv: readonly string[];
  env: Env;
  /** The checkout under test when argv names none (`--repo`): this module's own. */
  repo?: string;
  io?: Partial<RunIo>;
  /** The lab plumbing's waits (tests pass one that does not wait). */
  wait?: (ms: number) => Promise<unknown>;
  /** The JVM folders the build's JDK lookup tries last (lab-lines.ts#jvmDirs by default; a test's own). */
  jvms?: readonly string[];
}

/** The state file written clean, by hand: what a hand line ends with once the lab is proven put back. */
export const cleanStateCommand = (file: string): string => `printf '%s\\n' '{"dirty":false}' > ${shellQuote(file)}`;

/** A lab device's id as a hand line names it: the one given, or where to give it. */
export const deviceInHand = (device: LabDeviceId, id: string | undefined): string => id ?? `<${LAB_DEVICES[device].what}: ${LAB_DEVICES[device].flags}>`;

/** The refusal of a standing run whose device was not given. */
export const noDeviceReason = (st: Pick<Standing, 'batch' | 'device'>): string => `${LAB_DEVICES[st.device].missing}: ${st.batch} runs on ${LAB_DEVICES[st.device].what} only`;

/**
 * `--groups <g[,g]>` taken out of argv: the groups named (none: not given), the rest for configOf, or the refusal's
 * lines (a group that is none, none named, given twice, no value).
 */
export function groupsOf<G extends string>(argv: readonly string[], st: Standing<G>): { named?: G[]; rest: string[]; errors: string[] } {
  const rest: string[] = [];
  const errors: string[] = [];
  let named: string[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--groups') {
      rest.push(argv[i]);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      errors.push(refusedLine(`--groups needs a value (${st.hint})`));
      continue;
    }
    i++;
    if (named !== undefined) {
      errors.push(refusedLine('--groups is given twice'));
      continue;
    }
    named = value.split(',');
    for (const g of named) {
      if ((st.groups as readonly string[]).includes(g)) continue;
      errors.push(refusedLine(`--groups names '${g}', which is no group of ${st.batch} (${st.groups.join(', ')})`));
    }
  }
  return { ...(named !== undefined && { named: named as G[] }), rest, errors };
}

/**
 * ONLY= as runBatch is to read it with `--groups`: the lab block and the groups named, within ONLY's names when it
 * names any (a name that is no block kept, for the runner's WARN); or why no block is left.
 */
export function onlyWith<G extends string>(
  named: readonly G[] | undefined,
  only: string | undefined,
  st: Standing<G>,
): { only?: string } | { why: string } {
  if (named === undefined) return only === undefined ? {} : { only };
  const allowed: readonly string[] = ['lab', ...named.flatMap((g) => st.blocksOf(g))];
  if (only === undefined || only === '') return { only: allowed.join(',') };
  const names = only.split(/[\s,]/).filter((n) => n !== '');
  const kept = names.filter((n) => allowed.includes(n) || !st.blockIds.includes(n));
  if (kept.some((n) => allowed.includes(n))) return { only: kept.join(',') };
  return { why: refusedLine(`ONLY=${only} and --groups ${named.join(',')} leave no block of ${st.batch} to run`) };
}

/**
 * Why a selection is refused when it holds no live group (`ONLY=lab`, with or without `--groups`): a standing run
 * that runs none proves nothing. None when the selection is itself refused (the runner says why).
 */
export function noLiveGroup<G extends string>(
  selected: Selection,
  only: string | undefined,
  named: readonly G[] | undefined,
  st: Standing<G>,
): string[] {
  const live = st.groups.flatMap((g) => st.blocksOf(g));
  if (!selected.ok || selected.wanted.some((b) => live.includes(b))) return [];
  const said = [`ONLY=${only}`, ...(named === undefined ? [] : [`--groups ${named.join(',')}`])].join(' ');
  const groups = st.groups.join(', ');
  return [refusedLine(`${said} selects no live group of ${st.batch} (${groups}): a standing run that runs none proves nothing`)];
}

/**
 * A standing batch's selection from its argv and env: `--groups` as ONLY= is, the blocks wanted, and the config —
 * refused, with every reason, on a bad group, ONLY= and --groups leaving no block, a selection with no live group, or
 * the config's own errors.
 */
export function standingSelection<G extends string>(o: Pick<StandingOptions, 'argv' | 'env' | 'repo'>, st: Standing<G>): { wanted: readonly string[]; config: ConfigRead } {
  const picked = groupsOf(o.argv, st);
  const only = onlyWith(picked.named, o.env.ONLY, st);
  const onlyValue = 'only' in only ? only.only : undefined;
  const selected = selectBlocks(st.blockIds, onlyValue);
  const read = configOf(picked.rest, { ...o.env, ONLY: onlyValue }, o.repo);
  const errors = [...picked.errors, ...('why' in only ? [only.why] : [])];
  // A group refused is said alone: what it would have selected is not asked.
  if (errors.length === 0) errors.push(...noLiveGroup(selected, o.env.ONLY, picked.named, st));
  const config: ConfigRead = read.ok && errors.length === 0 ? read : { ok: false, errors: [...(read.ok ? [] : read.errors), ...errors] };
  return { wanted: selected.ok ? selected.wanted : [], config };
}

/** stepOutcome's word for a rejudge that exit 1 with its golden header: judged, and failed (cases.ts#stepOutcome). */
const REJUDGE_FAILED = 'DONE';

/**
 * A live block's verdict from its run (LiveOutcome), its summary (the header quoted) and the failure reasons its
 * rejudge wrote (../rejudge-failures.ts#failuresOf; undefined: missing or unreadable). Main's rejudge exit 0 and no
 * reason: PASS; exit 1 and a reason: FAIL naming each; else INCONCLUSIVE naming why — no rejudge, not judged, past its
 * bound, the reasons unread, or at odds with the exit code.
 */
export function liveVerdictLine(
  label: string,
  name: string,
  o: LiveOutcome | undefined,
  summary: string | undefined,
  failures: readonly string[] | undefined,
): string {
  const header = (summary ?? '').split('\n').find((l) => l.startsWith('# Live golden:'));
  const said = header === undefined ? '' : ` (${header})`;
  const line = (v: Verdict, why: string) => verdictLine(label, v, `${name}: ${why}`);
  if (o?.rejudge === undefined) {
    return line('INCONCLUSIVE', `no rejudge of its record (live.ts: ${o === undefined ? 'not run' : o.live.why})`);
  }
  const { word } = o.rejudge;
  if (word !== 'OK' && word !== REJUDGE_FAILED) return line('INCONCLUSIVE', `main's rejudge ${o.rejudge.why}`);
  const code = word === 'OK' ? 0 : 1;
  if (failures === undefined) return line('INCONCLUSIVE', `main's rejudge exit ${code}, its failure reasons unread (${name}.rejudge.json): read ${name}.rejudge.txt`);
  if (word === 'OK' && failures.length === 0) return line('PASS', `main's rejudge exit 0${said}`);
  if (word === REJUDGE_FAILED && failures.length > 0) return line('FAIL', `main's rejudge exit 1 — ${failures.join('; ')}${said}`);
  const named = failures.length === 0 ? 'none' : failures.join('; ');
  return line('INCONCLUSIVE', `main's rejudge exit ${code}, but its failure reasons name ${named}: read ${name}.rejudge.txt`);
}

/** A live run's outcome, kept beside its record: what its block's judge reads. */
const outcomeFile = (dir: string, name: string): string => join(dir, `${name}.outcome.json`);

/** A live block's run: ctx.liveRun, its outcome then written beside its record for the block's judge (liveJudge). */
export async function keptLiveRun(ctx: BlockCtx<{ B_LIVE: number }>, name: string, asked: Asked): Promise<void> {
  const outcome = await ctx.liveRun(name, asked, { secs: ctx.knobs.B_LIVE });
  ctx.fs.createExclusive(outcomeFile(ctx.dir, name), `${JSON.stringify(outcome)}\n`);
}

/** A live block's judge, device-free: its outcome file, its rejudge summary and failure reasons, from its folder alone. */
export function liveJudge(label: string, name: string): (j: BlockFiles) => Promise<string[]> {
  return async ({ dir, fs }) => {
    const text = fs.read(outcomeFile(dir, name));
    let o: LiveOutcome | undefined;
    try {
      o = text === undefined ? undefined : (JSON.parse(text) as LiveOutcome);
    } catch {
      return [verdictLine(label, 'INCONCLUSIVE', `${name}: its outcome file ${name}.outcome.json is unreadable`)];
    }
    const f = runFiles(dir, name);
    return [liveVerdictLine(label, name, o, fs.read(f.summary), failuresOf(fs.read(f.failures)))];
  };
}

/**
 * A standing batch run through runBatch, its exit its own: runBatch's result as it returns it — refused or interrupted,
 * its exit; ended, the standing rule over its SUMMARY and the wanted blocks' labels (standingExitOf). A run
 * whose device was not given is refused (noDeviceReason). The process's exit is the CLI entry's.
 */
export async function standingRun<G extends string>(
  o: Pick<StandingOptions, 'io'>,
  st: Standing<G>,
  b: Pick<RunBatchOptions<typeof KNOBS>, 'needs' | 'lastly' | 'config'> & { blocks: readonly Block<StandingKnobs>[]; wanted: readonly string[] },
): Promise<StandingExit> {
  const given = b.config.ok && b.config.config[st.device] !== undefined;
  const batchReasons = b.config.ok && !given ? [noDeviceReason(st)] : [];
  const r = await runBatch({ name: st.batch, blocks: b.blocks, needs: b.needs, lastly: b.lastly, config: b.config, batchReasons, knobs: KNOBS, io: o.io });
  if (!('summary' in r)) return r.exit;
  return standingExitOf(r.summary, b.blocks.filter((x) => b.wanted.includes(x.id)).map((x) => x.label));
}
