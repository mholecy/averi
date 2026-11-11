import { basename, dirname, join } from 'node:path';
import { isMain } from '../../is-main.js';
import { adbLine, HAND_PREFIX, LAB_PACKAGE, PREFERRED_ARGV, type HandBase } from '../chooser-readers.js';
import { androidLab, CHOOSER_WINDOW, HANDLER_URLS } from './android-lab.js';
import { runFiles, type Asked } from './cases.js';
import { nodeFs, type BatchFs } from './io.js';
import { shellQuote } from './ios-defaults.js';
import { labBlock, labBuild } from './lab-build.js';
import { CHECK_EXIT, CHECK_OUTCOME, checkWhy, type AcceptedEntry, type CheckExit } from './lab-chooser.js';
import { chooserWindow, cleanUp, readCheck, reinstallProgress, type Check, type StateRestore } from './lab-emu.js';
import { CATALOG_PATH } from './lab-lines.js';
import { nodeProcess, type ProcessSeam } from './proc.js';
import { STATE_FILE } from './run-dir.js';
import { runBatch, type Block, type BlockFiles, type LiveOutcome, type RunIo } from './runner.js';
import { configOf, NO_SERIAL, type ConfigRead, type Env } from './runner-lines.js';
import { knobs as readKnobs, selectBlocks, type KnobValues } from './select.js';
import { EXIT, parseVerdictLine, refusedLine, verdictLine, type Verdict } from './words.js';

/**
 * The standing lab batch (backlog T20b; docs/verification.md's "standing lab run", ADR 0041's T20b amendment): the
 * chooser group (D73's net among it: lc1–lc4'', live-chooser.ts) and the forms group, run on the lab emulator through
 * runBatch, in the repo rather than in a numbered batch kept outside it. Composed of the lab plumbing's blocks only,
 * nothing new done to a device:
 *
 * - the `lab` block (lab-build.ts#labBlock over the android need and, with the chooser block wanted, the handler
 *   counts): the guard first, then this checkout's lab APK built, installed and proven main's catalog;
 * - the `chooser` block, its needs the android need and the handler counts it rests on (android-lab.ts#handlersNeed,
 *   HANDLER_URLS: shared 2, cell 1): --check before (lab-emu.ts#readCheck, read only), the group's live run inside the
 *   chooser's dirty window (lab-emu.ts#chooserWindow), and the window's cleanup, --check after (lab-emu.ts#cleanUp: a
 *   lab default left is cleared by a reinstall of the pulled APK);
 * - the `forms` block, its live run, outside the window: no forms case opens a link.
 *
 *     npm run truth:lab -- --out <dir outside the checkout> --serial emulator-5554 [--groups chooser|forms|…]
 *
 * `--groups` is a selection, as ONLY= is (both together: the blocks both name): every block stays the batch's, so
 * every block's state file is checked before a run starts. Owner-run only: the cleanup may uninstall and reinstall
 * the lab app (lab-emu.ts#clearLabEntry), so an agent never starts it; scheduling it is backlog T20c. Everything it
 * writes is under `--out`, apart from the git-ignored Gradle build products in the checkout. A run with no serial is
 * refused before anything is done; a serial that is not the lab AVD is refused by the lab guard (lab-device.ts,
 * through the android need, before anything is built: every block INCONCLUSIVE, nothing done to the device).
 *
 * The --check before speaks in its own words (it presses nothing). A lab default it finds is a FAIL with its hand
 * lines in RESTORE; a chooser in front or a read that failed is an ERROR with none (the run touched nothing); either
 * way the chooser group is not run. A default the --check after finds when the one before found none is the run's
 * own: the after line says so, and LEFT_LABEL's FAIL names the chooser group. Each live block's verdict is main's
 * rejudge's exit code (live-cases.ts#summarize), its FAIL naming the stale chooser premise, the cases or the tallies
 * the summary gives, judged from the block's folder once its run is complete (runner.ts's assess).
 *
 * The exit code (LAB_RUN_EXIT) is the standing net's, stricter than a numbered batch's: 0 only when every wanted
 * block's verdict is PASS and no line is INCONCLUSIVE or ERROR; 1 a FAIL or a RESTORE; 2 refused or nothing ran; 3
 * unproven (a block not PASS, an INCONCLUSIVE or ERROR line, the SUMMARY unread); 130 interrupted.
 */

/** The live groups the batch runs, in its order. */
export const LAB_RUN_GROUPS = ['chooser', 'forms'] as const;
export type LabRunGroup = (typeof LAB_RUN_GROUPS)[number];
/** The batch's blocks, in its order. */
const BLOCK_IDS = ['lab', ...LAB_RUN_GROUPS] as const;

/**
 * lab-run's exit codes: a numbered batch's (words.ts#EXIT), and `unproven` for a run that proved nothing wrong or
 * right.
 */
export const LAB_RUN_EXIT = { passed: 0, failed: 1, refused: 2, unproven: 3, interrupted: 130 } as const;

/** The need on the handler counts the chooser group rests on (batch-11's D55: shared 2, cell 1). */
export const HANDLERS_NEED = 'handlers';
/** The counts it expects, by URL (android-lab.ts#HANDLER_URLS, in its order). */
export const EXPECTED_HANDLERS: Readonly<Record<string, number>> = { [HANDLER_URLS[0]]: 2, [HANDLER_URLS[1]]: 1 };
/** --check before the chooser group's window, and the window's cleanup (--check after): their verdict labels. */
export const BEFORE_LABEL = 'chooser check before';
export const AFTER_LABEL = 'chooser check after';
/** A default the --check after found where the one before found none: the chooser group left it. */
export const LEFT_LABEL = 'chooser left a default';

/** No last-chosen entry is accepted: one is a WARN (lab-chooser.ts#CHECK_OUTCOME's 6), never a reinstall. */
const ACCEPTED: readonly AcceptedEntry[] = [];

/** The knobs (select.ts): the live runs' bound, the build's, the window's restore. */
export const KNOBS = {
  counts: {
    B_LIVE: { default: 1800, min: 300, max: 7200, unit: 'seconds' },
    B_BUILD: { default: 2400, min: 600, max: 7200, unit: 'seconds' },
    B_RESTORE: { default: 300, min: 60, max: 1800, unit: 'seconds' },
  },
} as const;
type K = KnobValues<typeof KNOBS>;

/** A live block's run, asked: every case of its group on the lab emulator's lab app, under uiautomator. */
export const askedOf = (group: LabRunGroup): Asked => ({ platform: 'android', app: 'native', sources: ['uiautomator'], cases: [], groups: [group] });

/**
 * `--groups <g[,g]>` taken out of argv: the groups named (none: not given), the rest for configOf, or the refusal's
 * lines (a group that is none, none named, given twice, no value).
 */
export function groupsOf(argv: readonly string[]): { named?: LabRunGroup[]; rest: string[]; errors: string[] } {
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
      errors.push(refusedLine('--groups needs a value (chooser, forms or chooser,forms)'));
      continue;
    }
    i++;
    if (named !== undefined) {
      errors.push(refusedLine('--groups is given twice'));
      continue;
    }
    named = value.split(',');
    for (const g of named) {
      if (!(LAB_RUN_GROUPS as readonly string[]).includes(g)) errors.push(refusedLine(`--groups names '${g}', which is no group of lab-run (${LAB_RUN_GROUPS.join(', ')})`));
    }
  }
  return { ...(named !== undefined && { named: named as LabRunGroup[] }), rest, errors };
}

/**
 * ONLY= as runBatch is to read it with `--groups`: the lab block and the groups named, within ONLY's names when it
 * names any (a name that is no block kept, for the runner's WARN); or why no block is left.
 */
export function onlyWith(named: readonly LabRunGroup[] | undefined, only: string | undefined): { only?: string } | { why: string } {
  if (named === undefined) return only === undefined ? {} : { only };
  const allowed: readonly string[] = ['lab', ...named];
  if (only === undefined || only === '') return { only: allowed.join(',') };
  const names = only.split(/[\s,]/).filter((n) => n !== '');
  const kept = names.filter((n) => allowed.includes(n) || !(BLOCK_IDS as readonly string[]).includes(n));
  if (!kept.some((n) => allowed.includes(n))) return { why: refusedLine(`ONLY=${only} and --groups ${named.join(',')} leave no block of lab-run to run`) };
  return { only: kept.join(',') };
}

/** The state file written clean by hand, once the lab is proven put back. */
const cleanCommand = (file: string): string => `printf '%s\\n' '{"dirty":false}' > ${shellQuote(file)}`;

/**
 * The batch's state file, written clean: no probe keeps lab data here, so putting the state back is writing the file.
 * Asked by the run's own end once the cleanup proved the lab, by a proven reinstall (lab-emu.ts#clearLabEntry), and by
 * the chooser window's restore, which writes it before its own --check (a check that fails there still leaves RESTORE).
 */
export function cleanState(fs: BatchFs, file: string): StateRestore {
  return {
    async restore() {
      fs.replace(file, `${JSON.stringify({ dirty: false })}\n`);
      return { ok: true, how: 'lab-run keeps no lab data: its state file written clean' };
    },
    command: cleanCommand(file),
  };
}

/**
 * The hand line for a chooser state file left dirty: read the defaults; a default left, the reinstall of that run's
 * pulled APK (`lab/run-<id>/installed.apk`); a chooser in front, BACK; the lab installed; then the file written clean.
 */
export function stateHand(serial: string | undefined, file: string): string {
  const s = serial ?? '<the lab emulator: --serial or AVERI_LAB_SERIAL>';
  const run = dirname(file);
  const apk = join(dirname(dirname(run)), 'lab', basename(run), 'installed.apk');
  return (
    `  → ${adbLine(s, ['shell', ...PREFERRED_ARGV])}: a lab entry with mAlways=true left, ` +
    `${adbLine(s, ['uninstall', LAB_PACKAGE])} && ${adbLine(s, ['install', apk])}; ` +
    `a chooser in front, ${adbLine(s, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'])}; ` +
    `${adbLine(s, ['shell', 'pm', 'path', LAB_PACKAGE])} (installed); then: ${cleanCommand(file)}`
  );
}

/**
 * The --check before's line in its own words (readCheck presses nothing, unlike the cleanup's check): 0 and 5 OK, 6
 * a WARN, both letting the chooser group run; 1 a FAIL with its hand lines; 3 and 4 an ERROR with none — the run
 * touched nothing, so there is nothing to put back.
 */
export function beforeLine(c: Pick<Check, 'exit' | 'focus' | 'preferred'>, base: HandBase): { line: string; hand: string[]; run: boolean } {
  const why = checkWhy(c.focus, c.preferred, ACCEPTED);
  const notRun = (v: Verdict, what: string, hand: string[] = []) => ({ line: verdictLine(BEFORE_LABEL, v, `${what} — the chooser group not run: ${why}`), hand, run: false });
  const exit: CheckExit = c.exit;
  if (exit === CHECK_EXIT.leak) return notRun('FAIL', 'a lab default (mAlways=true) is set before the run', CHECK_OUTCOME[exit].hand(base));
  if (exit === CHECK_EXIT.chooser) return notRun('ERROR', 'a chooser is in front before the run (read only: nothing pressed)');
  if (exit === CHECK_EXIT.unproven) return notRun('ERROR', 'the preferred activities or the focus not proven clean (read only: nothing pressed)');
  if (exit === CHECK_EXIT.lastChosen) return { line: verdictLine(BEFORE_LABEL, 'WARN', `a last-chosen entry (mAlways=false: no default; no reinstall clears it): ${why}`), hand: [], run: true };
  return { line: verdictLine(BEFORE_LABEL, 'OK', why), hand: [], run: true };
}

/** The cleanup's line when the run left the default: that alone, with what the cleanup did (cleared or not). */
function leftLine(c: { line: string; check: Check }): string {
  const why = checkWhy(c.check.focus, c.check.preferred, ACCEPTED);
  // What the cleanup did, as cleanUp says it on a default: from its `; cleared: …` or `; NOT cleared: …` on.
  const tail = c.line.slice(c.line.search(/; (?:NOT )?cleared: /));
  return verdictLine(AFTER_LABEL, 'FAIL', `the chooser group's run left a lab default (mAlways=true) — ${BEFORE_LABEL} found none: ${why}${tail}`);
}

/**
 * What a rejudge summary that exit 1 names: the stale chooser premise and its hand lines (T20a), else each case not ok
 * and not known (`- MISMATCH lc1` → `MISMATCH lc1`) and the tallies that fail a run (live-cases.ts#summarize).
 */
export function failuresIn(summary: string): string[] {
  const lines = summary.split('\n');
  const at = lines.findIndex((l) => l.startsWith('CHOOSER PREMISE: stale'));
  const premise: string[] = [];
  if (at >= 0) {
    premise.push(lines[at]);
    for (let i = at + 1; i < lines.length && lines[i].startsWith(HAND_PREFIX); i++) premise.push(lines[i]);
  }
  const cases = lines.flatMap((l) => {
    const m = /^- (MISMATCH|LOUD|SKIP)(?: \([^)]*\))? (\S+) /.exec(l);
    return m === null || l.includes(' [known') ? [] : [`${m[1]} ${m[2]}`];
  });
  const tallies = lines.filter((l) => /^(SKIPPED where|NO FIRST STATE|FIXED, not intermittent)/.test(l));
  return [...(premise.length > 0 ? [premise.join(' | ')] : []), ...cases, ...tallies];
}

/**
 * A live block's verdict from its run (LiveOutcome) and its summary: main's rejudge exit 0 PASS; exit 1 judged FAIL,
 * naming what the summary names; else (no rejudge, not judged, past its bound) INCONCLUSIVE naming why.
 */
export function liveVerdictLine(label: string, name: string, o: LiveOutcome | undefined, summary: string | undefined): string {
  const header = (summary ?? '').split('\n').find((l) => l.startsWith('# Live golden:'));
  const said = header === undefined ? '' : ` (${header})`;
  const line = (v: Verdict, why: string) => verdictLine(label, v, `${name}: ${why}`);
  if (o?.rejudge === undefined) return line('INCONCLUSIVE', `no rejudge of its record (live.ts: ${o === undefined ? 'not run' : o.live.why})`);
  if (o.rejudge.word === 'OK') return line('PASS', `main's rejudge exit 0${said}`);
  if (o.rejudge.word === 'DONE') {
    const named = failuresIn(summary ?? '');
    const what = named.length > 0 ? named.join('; ') : `its summary names no case or premise: read ${name}.rejudge.txt`;
    return line('FAIL', `main's rejudge exit 1 — ${what}${said}`);
  }
  return line('INCONCLUSIVE', `main's rejudge ${o.rejudge.why}`);
}

/** A live run's outcome, kept beside its record: what its block's judge reads. */
const outcomeFile = (dir: string, name: string): string => join(dir, `${name}.outcome.json`);

/** A live block's judge, device-free: its outcome file and its rejudge summary, from its folder alone. */
export function liveJudge(label: string, name: string): (j: BlockFiles) => Promise<string[]> {
  return async ({ dir, fs }) => {
    const text = fs.read(outcomeFile(dir, name));
    let o: LiveOutcome | undefined;
    try {
      o = text === undefined ? undefined : (JSON.parse(text) as LiveOutcome);
    } catch {
      return [verdictLine(label, 'INCONCLUSIVE', `${name}: its outcome file ${name}.outcome.json is unreadable`)];
    }
    return [liveVerdictLine(label, name, o, fs.read(runFiles(dir, name).summary))];
  };
}

/** An ERROR line of the SUMMARY's ERROR section: bare, timed (`HH:MM:SS `) or named by its log (`[<log>] `). */
const ERROR_STEP = /^(?:\[[^\]]*\] |\d\d:\d\d:\d\d )?ERROR\b/;

/**
 * lab-run's exit from the runner's and the SUMMARY's lines: the runner's 1, 2 and 130 stand; its 0 is 0 only when
 * every wanted block's line is PASS, no verdict line is INCONCLUSIVE or ERROR and the ERROR section is empty — else
 * unproven (3), the SUMMARY unread too.
 */
export function labRunExit(runner: number, summary: readonly string[] | undefined, labels: readonly string[]): number {
  if (runner !== EXIT.ok) return runner;
  if (summary === undefined) return LAB_RUN_EXIT.unproven;
  const parsed = summary.map(parseVerdictLine).filter((v) => v !== undefined);
  if (parsed.some((v) => v.verdict === 'INCONCLUSIVE' || v.verdict === 'ERROR')) return LAB_RUN_EXIT.unproven;
  // The SUMMARY's ERROR section: a step's (steps.log, timed) or a log's ERROR line (runner-lines.ts#logErrors).
  if (summary.some((l) => ERROR_STEP.test(l))) return LAB_RUN_EXIT.unproven;
  const passed = labels.every((l) => parsed.some((v) => v.label === l && v.verdict === 'PASS'));
  return passed ? LAB_RUN_EXIT.passed : LAB_RUN_EXIT.unproven;
}

export interface LabRunOptions {
  argv: readonly string[];
  env: Env;
  /** The checkout under test when argv names none (`--repo`): this module's own. */
  repo?: string;
  io?: Partial<RunIo>;
  /** The lab plumbing's waits (tests pass one that does not wait). */
  wait?: (ms: number) => Promise<unknown>;
}

/** The run, start to end: its exit code (LAB_RUN_EXIT), the one the seam's exit is called with. */
export async function labRun(o: LabRunOptions): Promise<number> {
  const picked = groupsOf(o.argv);
  const only = onlyWith(picked.named, o.env.ONLY);
  const env: Env = { ...o.env, ONLY: 'only' in only ? only.only : undefined };
  const read = configOf(picked.rest, env, o.repo);
  const errors = [...picked.errors, ...('why' in only ? [only.why] : [])];
  const config: ConfigRead = read.ok && errors.length === 0 ? read : { ok: false, errors: [...(read.ok ? [] : read.errors), ...errors] };
  const serial = config.ok ? config.config.serial : undefined;
  // The build's bound is given before runBatch reads the knobs (the blocks read theirs from ctx.knobs); a bad knob
  // refuses there, with nothing built.
  const pre = readKnobs(KNOBS, o.env);
  const build = labBuild(pre.ok ? { secs: pre.values.B_BUILD } : {});
  const android = androidLab({ build: build.android, settle: o.wait });
  const selected = selectBlocks(BLOCK_IDS, 'only' in only ? only.only : undefined);
  const wanted = selected.ok ? selected.wanted : [];

  const liveRun = async (ctx: Parameters<Block<K>['run']>[0], group: LabRunGroup): Promise<void> => {
    const name = `android-${group}`;
    const outcome = await ctx.liveRun(name, askedOf(group), { secs: ctx.knobs.B_LIVE });
    ctx.fs.createExclusive(outcomeFile(ctx.dir, name), `${JSON.stringify(outcome)}\n`);
  };

  const chooser: Block<K> = {
    id: 'chooser',
    label: 'chooser verdict',
    needs: ['android', HANDLERS_NEED],
    stateful: { what: 'the chooser window not put back', hand: (file) => [stateHand(serial, file)] },
    async run(ctx) {
      const opened = await android.open(ctx);
      if (!opened.ok) return ctx.verdict('INCONCLUSIVE', opened.why);
      const emu = opened.value;
      const apk = android.pulled();
      if (apk === undefined) return ctx.verdict('INCONCLUSIVE', 'no APK was pulled at the lab check: no reinstall could be proven, so the chooser group is not run');
      const base: HandBase = { serial: emu.serial, apk, then: adbLine(emu.serial, ['shell', ...PREFERRED_ARGV]) };
      const before = beforeLine(await readCheck(emu, ACCEPTED), base);
      ctx.verdictAndHand({ line: before.line, hand: before.hand });
      if (!before.run) return ctx.verdict('INCONCLUSIVE', `the lab not proven clean before the chooser group (${BEFORE_LABEL}'s line) — not run`);
      const stateFile = join(ctx.dir, STATE_FILE);
      const putBack = cleanState(ctx.fs, stateFile);
      await putBack.restore(ctx.bounded);
      const opts = { apk, catalog: join(ctx.config.repo, CATALOG_PATH), dir: ctx.dir, accepted: ACCEPTED, progress: reinstallProgress(), stateFile, putBack };
      ctx.open(CHOOSER_WINDOW, chooserWindow(emu, { ...opts, block: ctx.id, cleanup: AFTER_LABEL, secs: ctx.knobs.B_RESTORE }));
      await liveRun(ctx, 'chooser');
      const after = await cleanUp(emu, { ...opts, label: AFTER_LABEL });
      const left = after.check.exit === CHECK_EXIT.leak;
      ctx.verdictAndHand({ line: left ? leftLine(after) : after.line, hand: after.hand });
      if (left) ctx.verdict('FAIL', `the chooser group's run left a lab default (mAlways=true): ${BEFORE_LABEL} found none, ${AFTER_LABEL} found one`, LEFT_LABEL);
      // Proven: the state written clean while the window is still open, so no await lies between them and its close.
      if (after.hand.length === 0) await putBack.restore(ctx.bounded);
      ctx.close(CHOOSER_WINDOW);
    },
    judge: liveJudge('chooser verdict', 'android-chooser'),
  };

  const forms: Block<K> = {
    id: 'forms',
    label: 'forms verdict',
    needs: ['android'],
    run: (ctx) => liveRun(ctx, 'forms'),
    judge: liveJudge('forms verdict', 'android-forms'),
  };

  // The guard first: the android need asks the build itself, after the lab guard (lab-build.ts#checkDevice).
  const lab = labBlock(['android', ...(wanted.includes('chooser') ? [HANDLERS_NEED] : [])], { build });
  const blocks = [lab, chooser, forms];
  // The runner's exit is held: lab-run's own is called once the SUMMARY is read (the abort's 130 goes through).
  const real: ProcessSeam = o.io?.seam ?? nodeProcess;
  const seam: ProcessSeam = {
    start: (cmd, args, options) => real.start(cmd, args, options),
    killGroup: (pid, signal) => real.killGroup(pid, signal),
    install: (h) => real.install(h),
    exit: (code) => (code === EXIT.interrupted ? real.exit(code) : undefined),
    stderr: (text) => real.stderr(text),
  };
  const fs = o.io?.fs ?? nodeFs;
  const meta = config.ok ? join(config.config.out, 'meta') : undefined;
  const runsBefore = new Set(meta === undefined ? [] : fs.list(meta));
  const code = await runBatch({
    name: 'lab-run',
    knobs: KNOBS,
    blocks,
    needs: { ...build.needs, android: android.need, [HANDLERS_NEED]: android.handlersNeed(EXPECTED_HANDLERS) },
    lastly: [build.lastly],
    batchReasons: config.ok && serial === undefined ? [`${NO_SERIAL}: lab-run runs on the lab emulator only`] : [],
    config,
    io: { ...o.io, seam },
  });
  if (code === EXIT.interrupted) return code;
  const run = meta === undefined ? undefined : fs.list(meta).find((n) => n.startsWith('run-') && !runsBefore.has(n));
  const text = run === undefined ? undefined : fs.read(join(meta!, run, 'summary.txt'));
  const labels = blocks.filter((b) => wanted.includes(b.id)).map((b) => b.label);
  const exit = labRunExit(code, text?.split('\n'), labels);
  real.exit(exit);
  return exit;
}

if (isMain(import.meta.url)) await labRun({ argv: process.argv.slice(2), env: process.env });
