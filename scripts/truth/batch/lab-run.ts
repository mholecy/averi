import { join } from 'node:path';
import { isMain } from '../../is-main.js';
import { adbLine, LAB_PACKAGE, PREFERRED_ARGV, type HandBase } from '../chooser-readers.js';
import { androidLab, chooserStretch, HANDLER_URLS } from './android-lab.js';
import { runFiles, type Asked } from './cases.js';
import type { BatchFs } from './io.js';
import { shellQuote } from './ios-defaults.js';
import { ANDROID_BUILD_NEED, labBlock, labBuild } from './lab-build.js';
import { CHECK_EXIT, CHECK_OUTCOME, checkWhy, type AcceptedEntry } from './lab-chooser.js';
import { readCheck, reinstallProgress, type StateRestore } from './lab-emu.js';
import { CATALOG_PATH } from './lab-lines.js';
import { STATE_FILE } from './run-dir.js';
import { runBatch, type Block, type LiveOutcome, type RunIo } from './runner.js';
import { configOf, NO_SERIAL, type ConfigRead, type Env } from './runner-lines.js';
import { knobs as readKnobs, type KnobValues } from './select.js';
import { refusedLine, verdictLine, type Verdict } from './words.js';

/**
 * The standing lab batch (backlog T20b; docs/verification.md's "standing lab run", ADR 0041's T20b amendment): the
 * chooser group (D73's net among it: lc1–lc4'', live-chooser.ts) and the forms group, run on the lab emulator through
 * runBatch, in the repo rather than in a numbered batch kept outside it. Composed of the lab plumbing's blocks only,
 * nothing new done to a device: the `lab` block (lab-build.ts#labBlock: this checkout's lab APK built, installed and
 * proven main's catalog, its handlers counted); the `chooser` block — its needs the android need and the handler counts it rests on
 * (android-lab.ts#handlersNeed, HANDLER_URLS: shared 2, cell 1), then --check before (lab-emu.ts#readCheck, read only),
 * the group's live run inside the chooser's dirty window, and the window's cleanup, --check after
 * (android-lab.ts#chooserStretch, lab-emu.ts#cleanUp: a lab default left is cleared by a reinstall of the pulled APK);
 * then the `forms` block, its live run. `--groups chooser|forms|chooser,forms` (default both) picks the live blocks;
 * ONLY= still selects blocks as in every batch.
 *
 *     npm run truth:lab -- --out <dir outside the checkout> --serial emulator-5554
 *
 * Owner-run only: the cleanup may uninstall and reinstall the lab app (lab-emu.ts#clearLabEntry), so an agent never
 * starts it, and scheduling it is backlog T20c. Everything it writes is under `--out` (run-dir.ts: an out folder
 * inside the checkout is refused). A run with no serial is refused before anything is done; a serial that is not the
 * lab AVD is refused by the lab guard (lab-device.ts, through the android need: every block INCONCLUSIVE, nothing done
 * to the device).
 *
 * The --check before not proving the lab clean (a default, a chooser in front, a read that failed) leaves the chooser
 * group not run: its premise is not the batch's to fix, so the line is a verdict with its hand lines in RESTORE. A
 * default (`mAlways=true`) the --check after finds when the one before found none is the run's own: its FAIL line,
 * LEFT_LABEL, names the chooser group, beside the cleanup's. Each live block's verdict is main's rejudge's exit code
 * (live-cases.ts#summarize: an unknown MISMATCH, a stale chooser premise, a SKIP that proves nothing fail it), judged
 * only once its run is complete (runner.ts's assess).
 */

/** The live groups the batch runs, in its order. */
export const LAB_RUN_GROUPS = ['chooser', 'forms'] as const;
export type LabRunGroup = (typeof LAB_RUN_GROUPS)[number];

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
 * `--groups <g[,g]>` taken out of argv: the groups in the batch's order, the rest for configOf, or the refusal's lines
 * (a group that is none, none named, given twice, no value).
 */
export function groupsOf(argv: readonly string[]): { groups: LabRunGroup[]; rest: string[]; errors: string[] } {
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
    for (const g of named) if (!(LAB_RUN_GROUPS as readonly string[]).includes(g)) errors.push(refusedLine(`--groups names '${g}', which is no group of lab-run (${LAB_RUN_GROUPS.join(', ')})`));
  }
  const groups = LAB_RUN_GROUPS.filter((g) => named === undefined || named.includes(g));
  return { groups, rest, errors };
}

/**
 * The batch's state file, written clean: no probe keeps lab data here, so nothing but the file is put back once the
 * lab is proven (the reinstall's putBack, the abort's window, the run's own end).
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

/** The state file written clean by hand, once the lab is proven put back. */
const cleanCommand = (file: string): string => `printf '%s\\n' '{"dirty":false}' > ${shellQuote(file)}`;

/**
 * A live block's verdict from its run (LiveOutcome) and its summary: main's rejudge exit 0 PASS, exit 1 judged FAIL,
 * else (no rejudge, not judged, past its bound) INCONCLUSIVE naming why.
 */
export function liveVerdictLine(label: string, name: string, o: LiveOutcome | undefined, summary: string | undefined): string {
  const header = (summary ?? '').split('\n').find((l) => l.startsWith('# Live golden:'));
  const said = header === undefined ? '' : ` (${header})`;
  const line = (v: Verdict, why: string) => verdictLine(label, v, `${name}: ${why}`);
  if (o?.rejudge === undefined) return line('INCONCLUSIVE', `no rejudge of its record (live.ts: ${o === undefined ? 'not run' : o.live.why})`);
  if (o.rejudge.word === 'OK') return line('PASS', `main's rejudge exit 0${said}`);
  if (o.rejudge.word === 'DONE') return line('FAIL', `main's rejudge exit 1: an unknown MISMATCH, a stale chooser premise or a SKIP that proves nothing${said}`);
  return line('INCONCLUSIVE', `main's rejudge ${o.rejudge.why}`);
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

/** The run, start to end: runBatch's exit code. */
export async function labRun(o: LabRunOptions): Promise<number> {
  const picked = groupsOf(o.argv);
  const read = configOf(picked.rest, o.env, o.repo);
  const config: ConfigRead = read.ok && picked.errors.length === 0 ? read : { ok: false, errors: [...(read.ok ? [] : read.errors), ...picked.errors] };
  // The build's bound is given before runBatch reads the knobs (the blocks read theirs from ctx.knobs); a bad knob
  // refuses there, with nothing built.
  const pre = readKnobs(KNOBS, o.env);
  const build = labBuild(pre.ok ? { secs: pre.values.B_BUILD } : {});
  const android = androidLab({ build: build.android, settle: o.wait });
  const outcomes = new Map<string, LiveOutcome>();
  const judgeOf = (label: string, name: string): Block<K>['judge'] =>
    async ({ dir, fs }) => [liveVerdictLine(label, name, outcomes.get(name), fs.read(runFiles(dir, name).summary))];

  const chooser: Block<K> = {
    id: 'chooser',
    label: 'chooser verdict',
    needs: ['android', HANDLERS_NEED],
    stateful: {
      what: 'the chooser window not put back',
      hand: (file) => [
        `  → adb -s <lab emulator> shell dumpsys package preferred (no lab entry with mAlways=true may be left); ` +
          `adb -s <lab emulator> shell pm path ${LAB_PACKAGE} (installed); then: ${cleanCommand(file)}`,
      ],
    },
    async run(ctx) {
      const opened = await android.open(ctx);
      if (!opened.ok) return ctx.verdict('INCONCLUSIVE', opened.why);
      const emu = opened.value;
      const apk = android.pulled();
      if (apk === undefined) return ctx.verdict('INCONCLUSIVE', 'no APK was pulled at the lab check: no reinstall could be proven, so the chooser group is not run');
      const before = await readCheck(emu, ACCEPTED);
      const outcome = CHECK_OUTCOME[before.exit];
      const line = verdictLine(BEFORE_LABEL, outcome.word, outcome.words(checkWhy(before.focus, before.preferred, ACCEPTED)));
      if (!outcome.proven) {
        const base: HandBase = { serial: emu.serial, apk, then: adbLine(emu.serial, ['shell', ...PREFERRED_ARGV]) };
        ctx.verdictAndHand({ line, hand: outcome.hand(base) });
        return ctx.verdict('INCONCLUSIVE', `the lab not proven clean before the chooser group (${BEFORE_LABEL}'s line) — not run`);
      }
      ctx.verdictLines([line]);
      const stateFile = join(ctx.dir, STATE_FILE);
      const putBack = cleanState(ctx.fs, stateFile);
      await putBack.restore(ctx.bounded);
      const name = 'android-chooser';
      const opts = { apk, catalog: join(ctx.config.repo, CATALOG_PATH), dir: ctx.dir, accepted: ACCEPTED, progress: reinstallProgress(), stateFile, putBack, cleanup: AFTER_LABEL, secs: ctx.knobs.B_RESTORE };
      const after = await chooserStretch(ctx, emu, opts, async () => void outcomes.set(name, await ctx.liveRun(name, askedOf('chooser'), { secs: ctx.knobs.B_LIVE })));
      if (after.check.exit === CHECK_EXIT.leak) ctx.verdict('FAIL', `the chooser group's run left a lab default (mAlways=true): ${BEFORE_LABEL} found none, ${AFTER_LABEL} found one`, LEFT_LABEL);
      if (after.hand.length === 0) await putBack.restore(ctx.bounded);
    },
    judge: judgeOf('chooser verdict', 'android-chooser'),
  };

  const forms: Block<K> = {
    id: 'forms',
    label: 'forms verdict',
    needs: ['android'],
    async run(ctx) {
      outcomes.set('android-forms', await ctx.liveRun('android-forms', askedOf('forms'), { secs: ctx.knobs.B_LIVE }));
    },
    judge: judgeOf('forms verdict', 'android-forms'),
  };

  const wanted = { chooser, forms };
  const lab = labBlock([ANDROID_BUILD_NEED, 'android', ...(picked.groups.includes('chooser') ? [HANDLERS_NEED] : [])]);
  return runBatch({
    name: 'lab-run',
    knobs: KNOBS,
    blocks: [lab, ...picked.groups.map((g) => wanted[g])],
    needs: { ...build.needs, android: android.need, [HANDLERS_NEED]: android.handlersNeed(EXPECTED_HANDLERS) },
    lastly: [build.lastly],
    batchReasons: config.ok && config.config.serial === undefined ? [`${NO_SERIAL}: lab-run runs on the lab emulator only`] : [],
    config,
    io: o.io,
  });
}

if (isMain(import.meta.url)) await labRun({ argv: process.argv.slice(2), env: process.env });
