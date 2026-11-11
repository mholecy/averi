import { basename, dirname, join } from 'node:path';
import { isMain } from '../../is-main.js';
import { adbLine, LAB_PACKAGE, PREFERRED_ARGV, type HandBase } from '../chooser-readers.js';
import { androidLab, CHOOSER_WINDOW, HANDLER_URLS } from './android-lab.js';
import type { Asked } from './cases.js';
import type { BatchFs } from './io.js';
import { labBlock, labBuild } from './lab-build.js';
import { CHECK_EXIT, CHECK_OUTCOME, checkWhy, type AcceptedEntry, type CheckExit } from './lab-chooser.js';
import { chooserWindow, cleanUp, readCheck, reinstallProgress, type Check, type StateRestore } from './lab-emu.js';
import { CATALOG_PATH } from './lab-lines.js';
import { STATE_FILE } from './run-dir.js';
import type { Block, BlockCtx } from './runner.js';
import type { Env } from './runner-lines.js';
import { knobs as readKnobs } from './select.js';
import {
  cleanStateCommand,
  deviceInHand,
  keptLiveRun,
  KNOBS,
  liveJudge,
  liveSecsOf,
  standingRun,
  standingSelection,
  type Standing,
  type StandingExit,
  type StandingKnobs,
  type StandingOptions,
} from './standing.js';
import { verdictLine, type Verdict } from './words.js';

/**
 * The standing lab batch (backlog T20b; docs/verification.md's "standing lab run", ADR 0041's T20b amendment): the
 * chooser group (D73's net among it: lc1–lc4'', live-chooser.ts) and live.ts's other Android groups (forms,
 * visibility, ensure, carousel: A22, so Gate B is this one command), run on the lab emulator through runBatch, in the
 * repo rather than in a numbered batch kept outside it. Composed of the lab plumbing's blocks only, nothing new done to
 * a device:
 *
 * - the `lab` block (lab-build.ts#labBlock over the android need and, with the chooser block wanted, the handler
 *   counts): the guard first, then this checkout's lab APK built, installed and proven main's catalog;
 * - the `chooser` block, its needs the android need and the handler counts it rests on (android-lab.ts#handlersNeed,
 *   HANDLER_URLS: shared 2, cell 1): --check before (lab-emu.ts#readCheck, read only), the group's live run inside the
 *   chooser's dirty window (lab-emu.ts#chooserWindow), and the window's cleanup, --check after (lab-emu.ts#cleanUp: a
 *   lab default left is cleared by a reinstall of the pulled APK);
 * - then one block per other group, `forms`, `visibility`, `ensure` and `carousel`, each its live run, outside the
 *   window: no case of theirs opens a link (each launch names the lab's activity: lab-device.ts#launch).
 *
 *     npm run truth:lab -- --out <dir outside the checkout> --serial emulator-5554 [--groups chooser|forms|…]
 *
 * `--groups` is a selection, as ONLY= is (both together: the blocks both name): every block stays the batch's, so
 * every block's state file is checked before a run starts. A release gate (docs/release.md's Gate B, backlog T24, which
 * replaced the schedule T20c): run before every release, by the agent on emulator-5554 or by the owner — the cleanup may
 * uninstall and reinstall the lab app (lab-emu.ts#clearLabEntry), a lab APK install the release allows. Everything it
 * writes is under `--out`, apart from the git-ignored Gradle build products in the checkout. A run with no serial is
 * refused before anything is done; a serial that is not the lab AVD is refused by the lab guard (lab-device.ts,
 * through the android need, before anything is built: every block INCONCLUSIVE, nothing done to the device).
 *
 * The --check before speaks in its own words (it presses nothing). A lab default it finds is a FAIL with its hand
 * lines in RESTORE; a chooser in front or a read that failed is an ERROR with none (the run touched nothing); either
 * way the chooser group is not run. A default the --check after finds when the one before found none is the run's
 * own: the after line says so, and LEFT_LABEL's FAIL names the chooser group. Each live block's verdict is main's
 * rejudge's exit code (live-cases.ts#summarize), its FAIL naming the failure reasons the rejudge wrote beside its
 * summary (the stale chooser premise, each unknown MISMATCH, the tallies and the hedged ceiling that fail a run),
 * judged from the block's folder once its run is complete (runner.ts's assess; standing.ts#liveJudge).
 *
 * The selection, the knobs, the live runs and their judge, and the run come from standing.ts, which lab-run-ios.ts
 * shares. The exit code (standing.ts#STANDING_EXIT) is the standing net's, stricter than a numbered batch's, read from
 * the SUMMARY runBatch returns: 0 only when every wanted block's verdict is PASS, no line is INCONCLUSIVE or ERROR and
 * the ERROR section is empty; 1 a FAIL or a RESTORE; 2 refused or nothing ran; 3 unproven; 130 interrupted.
 */

/**
 * The live groups the batch runs, in its order: the chooser group, then live.ts's other Android groups (dismissal is
 * iOS only: lab-run-ios.ts runs it).
 */
export const LAB_RUN_GROUPS = ['chooser', 'forms', 'visibility', 'ensure', 'carousel'] as const;
export type LabRunGroup = (typeof LAB_RUN_GROUPS)[number];
/** The batch's blocks, in its order. */
const BLOCK_IDS = ['lab', ...LAB_RUN_GROUPS] as const;

/** lab-run's: one block per group, named by it. */
export const LAB_RUN_STANDING: Standing<LabRunGroup> = {
  batch: 'lab-run',
  device: 'serial',
  groups: LAB_RUN_GROUPS,
  hint: `${LAB_RUN_GROUPS.join(', ')}, or several joined by commas`,
  blockIds: BLOCK_IDS,
  blocksOf: (g) => [g],
};

/**
 * A live group's own bound, in seconds, where B_LIVE's default (1800 s) does not fit its run (A34): the visibility
 * group, 181 cases over 32 cells, ran past 1800 s in A22's first Gate B on main (173 cases logged) and takes about
 * 1880 s at a load under 17 (about 10.4 s a case; ADR 0041's A34 amendment) — its bound about 1.6 times that. Every
 * other group keeps B_LIVE's default, so a hung forms, ensure or carousel run is still cut at 1800 s. B_LIVE given
 * bounds every group alike (standing.ts#liveSecsOf).
 */
export const LIVE_SECS: Readonly<Partial<Record<LabRunGroup, number>>> = { visibility: 3000 };

/** A live group's bound in a run: its own (LIVE_SECS) unless B_LIVE is given, else B_LIVE's default. */
export const labLiveSecs = (group: LabRunGroup, env: Env, knobs: { B_LIVE: number }): number => liveSecsOf(env, knobs, LIVE_SECS[group]);

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

/** A live block's run, asked: every case of its group on the lab emulator's lab app, under uiautomator. */
export const askedOf = (group: LabRunGroup): Asked => ({
  platform: 'android',
  app: 'native',
  sources: ['uiautomator'],
  cases: [],
  groups: [group],
});

/** A live block's run, by its group: its `.cases`, record, log, rejudge summary and outcome are named so. */
const runName = (group: LabRunGroup): string => `android-${group}`;

/** A live block's id, label and judge, from its group alone. */
const liveBlock = (group: LabRunGroup): Pick<Block<StandingKnobs>, 'id' | 'label' | 'judge'> => {
  const label = `${group} verdict`;
  return { id: group, label, judge: liveJudge(label, runName(group)) };
};

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
    command: cleanStateCommand(file),
  };
}

/**
 * The hand line for a chooser state file left dirty: read the defaults; a default left, the reinstall of that run's
 * pulled APK (`lab/run-<id>/installed.apk`); a chooser in front, BACK; the lab installed; then the file written clean.
 */
export function stateHand(serial: string | undefined, file: string): string {
  const s = deviceInHand('serial', serial);
  const run = dirname(file);
  const apk = join(dirname(dirname(run)), 'lab', basename(run), 'installed.apk');
  return (
    `  → ${adbLine(s, ['shell', ...PREFERRED_ARGV])}: a lab entry with mAlways=true left, ` +
    `${adbLine(s, ['uninstall', LAB_PACKAGE])} && ${adbLine(s, ['install', apk])}; ` +
    `a chooser in front, ${adbLine(s, ['shell', 'input', 'keyevent', 'KEYCODE_BACK'])}; ` +
    `${adbLine(s, ['shell', 'pm', 'path', LAB_PACKAGE])} (installed); then: ${cleanStateCommand(file)}`
  );
}

/**
 * The --check before's line in its own words (readCheck presses nothing, unlike the cleanup's check): 0 and 5 OK, 6
 * a WARN, both letting the chooser group run; 1 a FAIL with its hand lines; 3 and 4 an ERROR with none — the run
 * touched nothing, so there is nothing to put back.
 */
export function beforeLine(
  c: Pick<Check, 'exit' | 'focus' | 'preferred'>,
  base: HandBase,
): { line: string; hand: string[]; run: boolean } {
  const why = checkWhy(c.focus, c.preferred, ACCEPTED);
  const notRun = (v: Verdict, what: string, hand: string[] = []) => ({
    line: verdictLine(BEFORE_LABEL, v, `${what} — the chooser group not run: ${why}`),
    hand,
    run: false,
  });
  const exit: CheckExit = c.exit;
  if (exit === CHECK_EXIT.leak) {
    return notRun('FAIL', 'a lab default (mAlways=true) is set before the run', CHECK_OUTCOME[exit].hand(base));
  }
  if (exit === CHECK_EXIT.chooser) {
    return notRun('ERROR', 'a chooser is in front before the run (read only: nothing pressed)');
  }
  if (exit === CHECK_EXIT.unproven) {
    return notRun('ERROR', 'the preferred activities or the focus not proven clean (read only: nothing pressed)');
  }
  if (exit === CHECK_EXIT.lastChosen) {
    const said = `a last-chosen entry (mAlways=false: no default; no reinstall clears it): ${why}`;
    return { line: verdictLine(BEFORE_LABEL, 'WARN', said), hand: [], run: true };
  }
  return { line: verdictLine(BEFORE_LABEL, 'OK', why), hand: [], run: true };
}

/**
 * The cleanup's line when the run left the default: that alone, with what the cleanup did — cleanUp's
 * `; cleared: …` or `; NOT cleared: …` on, found by search. A line holding neither (cleanUp worded otherwise) is kept whole: it is
 * the after check's line still, its FAIL beside LEFT_LABEL's.
 */
export function leftLine(c: { line: string; check: Pick<Check, 'focus' | 'preferred'> }): string {
  const at = c.line.search(/; (?:NOT )?cleared: /);
  if (at < 0) return c.line;
  const why = checkWhy(c.check.focus, c.check.preferred, ACCEPTED);
  const said = `the chooser group's run left a lab default (mAlways=true) — ${BEFORE_LABEL} found none: ${why}`;
  return verdictLine(AFTER_LABEL, 'FAIL', `${said}${c.line.slice(at)}`);
}

/** The run, start to end: its exit code (standing.ts#STANDING_EXIT), for the CLI entry to exit with. */
export async function labRun(o: StandingOptions): Promise<StandingExit> {
  const { wanted, config } = standingSelection(o, LAB_RUN_STANDING);
  const serial = config.ok ? config.config.serial : undefined;
  // The build's bound is given before runBatch reads the knobs (the blocks read theirs from ctx.knobs); a bad knob
  // refuses there, with nothing built.
  const pre = readKnobs(KNOBS, o.env);
  const build = labBuild({ ...(pre.ok ? { secs: pre.values.B_BUILD } : {}), jvms: o.jvms });
  const android = androidLab({ build: build.android, settle: o.wait });

  const liveRun = (ctx: BlockCtx<StandingKnobs>, group: LabRunGroup): Promise<void> =>
    keptLiveRun(ctx, runName(group), askedOf(group), labLiveSecs(group, o.env, ctx.knobs));

  const chooser: Block<StandingKnobs> = {
    ...liveBlock('chooser'),
    needs: ['android', HANDLERS_NEED],
    stateful: { what: 'the chooser window not put back', hand: (file) => [stateHand(serial, file)] },
    async run(ctx) {
      const opened = await android.open(ctx);
      if (!opened.ok) return ctx.verdict('INCONCLUSIVE', opened.why);
      const emu = opened.value;
      const apk = android.pulled();
      if (apk === undefined) {
        return ctx.verdict('INCONCLUSIVE', 'no APK was pulled at the lab check: no reinstall could be proven, so the chooser group is not run');
      }
      const base: HandBase = { serial: emu.serial, apk, then: adbLine(emu.serial, ['shell', ...PREFERRED_ARGV]) };
      const before = beforeLine(await readCheck(emu, ACCEPTED), base);
      ctx.verdictAndHand({ line: before.line, hand: before.hand });
      if (!before.run) {
        return ctx.verdict('INCONCLUSIVE', `the lab not proven clean before the chooser group (${BEFORE_LABEL}'s line) — not run`);
      }
      const stateFile = join(ctx.dir, STATE_FILE);
      const putBack = cleanState(ctx.fs, stateFile);
      await putBack.restore(ctx.bounded);
      const catalog = join(ctx.config.repo, CATALOG_PATH);
      const opts = { apk, catalog, dir: ctx.dir, accepted: ACCEPTED, progress: reinstallProgress(), stateFile, putBack };
      const window = { ...opts, block: ctx.id, cleanup: AFTER_LABEL, secs: ctx.knobs.B_RESTORE };
      ctx.open(CHOOSER_WINDOW, chooserWindow(emu, window));
      await liveRun(ctx, 'chooser');
      const after = await cleanUp(emu, { ...opts, label: AFTER_LABEL });
      const left = after.check.exit === CHECK_EXIT.leak;
      ctx.verdictAndHand({ line: left ? leftLine(after) : after.line, hand: after.hand });
      if (left) {
        const why = `the chooser group's run left a lab default (mAlways=true): ${BEFORE_LABEL} found none, ${AFTER_LABEL} found one`;
        ctx.verdict('FAIL', why, LEFT_LABEL);
      }
      // Proven: the state written clean while the window is still open, so no await lies between them and its close.
      if (after.hand.length === 0) await putBack.restore(ctx.bounded);
      ctx.close(CHOOSER_WINDOW);
    },
  };

  /** A group outside the chooser's window: its live run alone. */
  const outside = (group: Exclude<LabRunGroup, 'chooser'>): Block<StandingKnobs> => ({ ...liveBlock(group), needs: ['android'], run: (ctx) => liveRun(ctx, group) });

  // The guard first: the android need asks the build itself, after the lab guard (lab-build.ts#checkDevice).
  const lab = labBlock(['android', ...(wanted.includes('chooser') ? [HANDLERS_NEED] : [])], { build });
  const blocks = [lab, chooser, ...LAB_RUN_GROUPS.filter((g) => g !== 'chooser').map(outside)];
  return standingRun(o, LAB_RUN_STANDING, {
    blocks,
    wanted,
    needs: { ...build.needs, android: android.need, [HANDLERS_NEED]: android.handlersNeed(EXPECTED_HANDLERS) },
    lastly: [build.lastly],
    config,
  });
}

// The exit at once, as runBatch leaves it to its caller (runner.ts#runBatch).
if (isMain(import.meta.url)) process.exit(await labRun({ argv: process.argv.slice(2), env: process.env }));
