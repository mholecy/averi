import { isMain } from '../../is-main.js';
import type { Asked } from './cases.js';
import { iosCheck, iosLab, wdaWindow } from './ios-lab.js';
import { labBlock, labBuild } from './lab-build.js';
import type { Block, BlockCtx } from './runner.js';
import { knobs as readKnobs } from './select.js';
import { shellQuote } from './shell.js';
import {
  cleanStateCommand,
  deviceInHand,
  KNOBS,
  keptLiveRun,
  liveJudge,
  standingRun,
  standingSelection,
  type Standing,
  type StandingExit,
  type StandingKnobs,
  type StandingOptions,
} from './standing.js';

/**
 * The standing lab batch on the lab simulator (backlog T24: docs/release.md's Gate C), lab-run.ts's iOS counterpart
 * through runBatch, composed of the lab plumbing alone, as runner.ts's header composes an iOS batch:
 *
 * - the `lab` block (lab-build.ts#labBlock over the ios need): the guard (ios-lab.ts#iosLab: device-check's udid and
 *   any simulator not named `averi-lab …` refused before any call), the reset (simctl boot, the lab app launched, the
 *   health check), the finportal key's first read (read only), this checkout's lab app built (xcodegen, xcodebuild)
 *   and installed, its cells.json main's;
 * - one block per idb run, `idb-<group>`: the health check (ios-lab.ts#iosCheck: the lab's WebDriverAgent ended, the
 *   Open-in alert, describe-all and a swipe, a reset when sick), then live.ts `--sources idb --groups <group>`;
 * - then one block per WebDriverAgent run, `wda-<group>`, each its own D43 settings window (ios-lab.ts#wdaWindow: the
 *   `.cases` first, the health check, the three domains backed up, the window opened as a dirty window, the run after
 *   its own health check, the WebDriverAgent ended, the 4 s wait, port 8120 proven free, the domains put back key by
 *   key, the end check, the compare). Every WDA run is inside a window and no idb run is: the idb blocks come first,
 *   and each window is closed (or left for RESTORE) before the next block starts.
 *
 * The groups are live.ts's iOS ones (forms, visibility, dismissal, ensure; carousel and chooser are Android only).
 * The ios need's end reads the finportal key again (a CHANGED key fails the run); the run's last step ends the lab's
 * WebDriverAgent and idb_companion by their exact patterns. A signal puts each open window back and exits 130.
 *
 *     npm run truth:lab:ios -- --out <dir outside the checkout> --udid <lab simulator> [--groups forms|…]
 *
 * The owner's, outside the agent's sandbox (simctl, idb, xcodebuild and WebDriverAgent do not run inside it). Its
 * selection, knobs, live runs, judge and run are standing.ts's, shared with lab-run.ts and imported from neither batch.
 * The exit code is the standing one (standing.ts#standingExitOf): 0 only when every wanted block PASSed and no line is
 * INCONCLUSIVE or ERROR; 1 a FAIL or a RESTORE; 2 refused (no udid, a group that is none, an earlier window's state
 * file dirty) or nothing ran; 3 unproven; 130 interrupted.
 */

/** live.ts's iOS groups, in the batch's order. */
export const IOS_RUN_GROUPS = ['forms', 'visibility', 'dismissal', 'ensure'] as const;
export type IosRunGroup = (typeof IOS_RUN_GROUPS)[number];
/** The tree sources, in the batch's order: every idb run before the first WebDriverAgent window. */
export const IOS_SOURCES = ['idb', 'wda'] as const;
export type IosSource = (typeof IOS_SOURCES)[number];

/** A run's block: `<source>-<group>`. */
export const iosBlockId = (source: IosSource, group: IosRunGroup): string => `${source}-${group}`;
/** A run's name (its `.cases`, record, log, rejudge summary, outcome): `ios-<source>-<group>`. */
export const iosRunName = (source: IosSource, group: IosRunGroup): string => `ios-${source}-${group}`;
/** A run's verdict label. */
export const iosLabel = (source: IosSource, group: IosRunGroup): string => `ios ${source} ${group} verdict`;

/** The batch's blocks, in its order: the lab block, every idb run, then every WebDriverAgent run. */
export const IOS_BLOCK_IDS: readonly string[] = ['lab', ...IOS_SOURCES.flatMap((s) => IOS_RUN_GROUPS.map((g) => iosBlockId(s, g)))];

/**
 * The iOS batch's selection words (standing.ts#Standing): a group selects its idb block and its WebDriverAgent
 * block.
 */
export const IOS_STANDING: Standing<IosRunGroup> = {
  batch: 'lab-run-ios',
  device: 'udid',
  groups: IOS_RUN_GROUPS,
  hint: `${IOS_RUN_GROUPS.join(', ')}, or several joined by commas`,
  blockIds: IOS_BLOCK_IDS,
  blocksOf: (g) => IOS_SOURCES.map((s) => iosBlockId(s, g)),
};

/** A run, asked: every case of its group on the lab simulator's native lab app, under its one source. */
export const iosAskedOf = (source: IosSource, group: IosRunGroup): Asked => ({ platform: 'ios', app: 'native', sources: [source], cases: [], groups: [group] });

/**
 * The hand line for a WebDriverAgent block's state file left dirty: the domains imported from the backups beside it,
 * the compare by hand, then the file written clean.
 */
export function windowStateHand(udid: string | undefined, file: string): string {
  const u = deviceInHand('udid', udid);
  return (
    `  → the WDA window's settings not put back: for each domain in ${shellQuote(file)}, ` +
    `xcrun simctl spawn ${u} defaults import <domain> <its backup beside the file>; compare them by hand; ` +
    `then: ${cleanStateCommand(file)}`
  );
}

/** The run, start to end: its exit code (standing.ts#STANDING_EXIT), for the CLI entry to exit with. */
export async function labRunIos(o: StandingOptions): Promise<StandingExit> {
  const { wanted, config } = standingSelection(o, IOS_STANDING);
  const udid = config.ok ? config.config.udid : undefined;
  const pre = readKnobs(KNOBS, o.env);
  const build = labBuild({ ...(pre.ok ? { secs: pre.values.B_BUILD } : {}) });
  const ios = iosLab({ build: build.ios, wait: o.wait });

  /** An idb run: the health check, then the run; not fit, INCONCLUSIVE naming why, nothing run. */
  const idbBlock = (group: IosRunGroup): Block<StandingKnobs> => {
    const [label, name] = [iosLabel('idb', group), iosRunName('idb', group)];
    return {
      id: iosBlockId('idb', group),
      label,
      needs: ['ios'],
      judge: liveJudge(label, name),
      async run(ctx) {
        const sim = await ios.open(ctx);
        if (!sim.ok) return ctx.verdict('INCONCLUSIVE', sim.why);
        const fit = await iosCheck(ctx, sim.value, name);
        if (!fit.ok) return ctx.verdict('INCONCLUSIVE', `${fit.why} — no idb run`);
        if (fit.warning !== undefined) ctx.step('WARN', `${name}: ${fit.warning}`);
        await keptLiveRun(ctx, name, iosAskedOf('idb', group));
      },
    };
  };

  /** A WebDriverAgent run in its own D43 window, after the work's own health check (runner.ts's header's D43). */
  const wdaBlock = (group: IosRunGroup): Block<StandingKnobs> => {
    const [label, name, asked] = [iosLabel('wda', group), iosRunName('wda', group), iosAskedOf('wda', group)];
    return {
      id: iosBlockId('wda', group),
      label,
      needs: ['ios'],
      stateful: { what: 'the WDA window not put back', hand: (file) => [windowStateHand(udid, file)] },
      judge: liveJudge(label, name),
      async run(ctx: BlockCtx<StandingKnobs>) {
        const sim = await ios.open(ctx);
        if (!sim.ok) return ctx.verdict('INCONCLUSIVE', sim.why);
        const said: string[] = [];
        const w = await wdaWindow(ctx, sim.value, {
          runs: [{ name, asked }],
          secs: ctx.knobs.B_RESTORE,
          work: async () => {
            const fit = await iosCheck(ctx, sim.value, name);
            if (!fit.ok) return ctx.verdict('INCONCLUSIVE', `${fit.why} — no wda run`);
            if (fit.warning !== undefined) said.push(fit.warning);
            await keptLiveRun(ctx, name, asked);
          },
        });
        const warnings = [...w.warnings, ...said];
        if (warnings.length > 0) ctx.step('WARN', `${name}: ${warnings.join('; ')}`);
      },
    };
  };

  const blocks = [labBlock(['ios'], { build }), ...IOS_RUN_GROUPS.map(idbBlock), ...IOS_RUN_GROUPS.map(wdaBlock)];
  return standingRun(o, IOS_STANDING, {
    blocks,
    wanted,
    needs: { ...build.needs, ios: ios.need },
    lastly: [ios.lastly, build.lastly],
    config,
  });
}

// The exit at once, as runBatch leaves it to its caller (runner.ts#runBatch).
if (isMain(import.meta.url)) process.exit(await labRunIos({ argv: process.argv.slice(2), env: process.env }));
