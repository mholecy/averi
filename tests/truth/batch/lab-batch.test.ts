import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { androidLab, withReads } from '../../../scripts/truth/batch/android-lab.js';
import type { Asked } from '../../../scripts/truth/batch/cases.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { iosCheck, iosLab, wdaWindow } from '../../../scripts/truth/batch/ios-lab.js';
import { labBlock, labBuild } from '../../../scripts/truth/batch/lab-build.js';
import type { LiveCases, LiveTable } from '../../../scripts/truth/batch/live-table.js';
import type { Ended, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';
import { runBatch, type Block } from '../../../scripts/truth/batch/runner.js';
import { LIVE_GOLDEN_HEADER } from '../../../scripts/truth/batch/steps.js';
import { CATALOG, LAB_SERIAL, LAB_UDID, labWorld, type LabWorld, type WorldOptions } from './lab-fakes.js';

// The lab plumbing under runBatch (T2 S6b, spec S6b's tests): a fake batch — the lab block (the Android build and the
// device checks), an Android block with the tri-state reads around its live run, an iOS block whose live run is in the
// WDA window after its own health check (the finportal key read by the ios need's end) — over a fake process seam that
// answers git and live.ts as runner.test.ts does and every lab call through the fake lab (lab-fakes.ts), with real
// files in a temp dir, a fixed clock and pid. The whole SUMMARY; a need that fails; ONLY=lab; a build that fails; the
// work's check not fit; the abort inside the WDA window; the lab's processes at the run's end. Every call is checked for b11-dry's VIOLATIONs made exact (afterEach). No device.

const HEAD = 'a'.repeat(40);
const ID = '20261105-094426-4242';
const clock = () => new Date(2026, 10, 5, 9, 44, 26);

/** A fake seam over the fake lab: git and live.ts answered here, every other call by the world; `hang` holds one. */
class LabSeam implements ProcessSeam {
  readonly words: string[] = [];
  handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void } | undefined;
  readonly exits: number[] = [];
  private nextPid = 100;
  private readonly ends = new Map<number, (e: Ended) => void>();
  private readonly ended = new Set<number>();
  /** A call whose words include this runs until its group is signalled. */
  hang: string | undefined;
  /** A call whose words include this fails: exit 149, as a boot that cannot be made. */
  fails: string | undefined;
  constructor(
    public world: LabWorld,
    private readonly repo: string,
  ) {}
  start(cmd: string, args: readonly string[], options: StartOptions): Started {
    const said = `${cmd === process.execPath ? 'node' : cmd} ${args.join(' ')}`;
    this.words.push(said);
    const a = this.answer(cmd, args, options);
    if (a === undefined) throw new Error(`no answer for ${said}`);
    if (options.logFd !== undefined) writeSync(options.logFd, `${a.out}${a.err}`);
    const pid = this.nextPid++;
    let end!: (e: Ended) => void;
    const exited = new Promise<Ended>((r) => (end = r));
    this.ends.set(pid, (e) => (this.ended.add(pid), end(e)));
    // Only the first call matching hangs: a later one (the last step's --stop) answers.
    if (this.hang === undefined || !said.includes(this.hang)) this.ends.get(pid)!({ code: a.code, signal: null });
    else this.hang = undefined;
    return { pid, exited, closed: exited.then(() => {}), out: () => (options.logFd === undefined ? a.out : ''), err: () => (options.logFd === undefined ? a.err : ''), release: () => {} };
  }
  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult {
    if (this.ended.has(pid)) return 'gone';
    if (signal !== 0) this.ends.get(pid)?.({ code: null, signal });
    return 'sent';
  }
  install(h: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void }): void {
    this.handlers = h;
  }
  exit(code: number): void {
    this.exits.push(code);
  }
  stderr(): void {}

  /** The cases each record was asked, for its rejudge's summary. */
  private readonly asked = new Map<string, { cases: string[]; source: string }>();
  private answer(cmd: string, args: readonly string[], options: StartOptions): { code: number; out: string; err: string } | undefined {
    if (cmd === 'git') {
      const said = args.slice(2).join(' ');
      if (said === 'rev-parse --show-toplevel') return { code: 0, out: `${nodeFs.real(args[1])}\n`, err: '' };
      if (said.startsWith('rev-parse --verify')) return { code: 0, out: `${HEAD}\n`, err: '' };
      return { code: 0, out: '', err: '' };
    }
    if (cmd === process.execPath && args.some((a) => a.endsWith('live.ts'))) {
      const at = (flag: string) => args[args.indexOf(flag) + 1];
      if (args.includes('--rejudge')) {
        const a = this.asked.get(at('--rejudge'))!;
        return { code: 0, out: summaryOf(a.cases, a.source), err: '' };
      }
      const source = args.includes('--sources') ? at('--sources') : 'uiautomator';
      const cases = at('--cases').split(',');
      this.asked.set(at('--record'), { cases, source });
      writeFileSync(at('--record'), '{"results":[]}');
      // A live run under WebDriverAgent starts the lab's runner: it listens on 8120, its exit flips the domains.
      if (source === 'wda') this.world.startWda();
      return { code: 0, out: summaryOf(cases, source), err: '' };
    }
    if (this.fails !== undefined && `${cmd} ${args.join(' ')}`.includes(this.fails)) return { code: 149, out: '', err: 'Unable to boot device' };
    return this.world.answer(cmd, args, { cwd: options.cwd });
  }
}
const summaryOf = (ids: readonly string[], source: string) => [`${LIVE_GOLDEN_HEADER} ${ids.length} cases, ${ids.length} ok`, '', `## ${source}`, ...ids.map((id) => `- ok ${id} form-basic: says — fine`), ''].join('\n');

const table: LiveTable = async () =>
  ({
    selectCases: async (s) => ['kf1', 'p7w'].filter((id) => s.only === undefined || s.only.includes(id)).map((id) => ({ id })),
    catalogOf: async () => ({ cells: [{ id: 'open' }, { id: 'form-basic' }] }),
  }) satisfies LiveCases;

let root: string;
let repo: string;
let out: string;
let seam: LabSeam;
let world: LabWorld;
const noWait = async () => {};
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'batch-lab-batch-')));
  repo = join(root, 'repo');
  out = join(root, 'out');
  for (const d of ['ios', 'android']) mkdirSync(join(repo, 'fixtures', 'apps', d), { recursive: true });
  writeFileSync(join(repo, 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir: root });
  seam = new LabSeam(world, repo);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});
const fresh = (o: Omit<WorldOptions, 'dir'>) => (seam.world = world = labWorld({ dir: root, ...o }));

const dirOf = (block: string) => join(out, block, `run-${ID}`);
const summary = () => readFileSync(join(dirOf('meta'), 'summary.txt'), 'utf8').split('\n').slice(0, -1);
const outText = () => readFileSync(join(dirOf('meta'), 'batch-l.out'), 'utf8');
const KF: Asked = { platform: 'android', app: 'native', sources: ['uiautomator'], cases: ['kf1'] };
const P7W: Asked = { platform: 'ios', app: 'native', sources: ['wda'], cases: ['p7w'] };

/**
 * The fake batch: the lab block, an Android block with the tri-state reads, an iOS block in the WDA window — its work's
 * health check first (`beforeWork` changes the lab before it), a check not fit its INCONCLUSIVE naming why; each
 * window's outcome kept in `windows`.
 */
function batch(o: { labNeeds?: string[]; d55First?: boolean; beforeWork?: () => void } = {}) {
  const windows: Awaited<ReturnType<typeof wdaWindow>>[] = [];
  const build = labBuild();
  const android = androidLab({ build: build.android, settle: noWait });
  const ios = iosLab({ wait: noWait });
  const judgeOf = (label: string) => async () => [`${label}: PASS — its runs complete`];
  const d55: Block = {
    id: 'D55',
    label: 'D55 verdict',
    needs: ['android'],
    run: async (ctx) => {
      const emu = await android.open(ctx);
      if (!emu.ok) return ctx.verdict('INCONCLUSIVE', emu.why);
      await withReads(ctx, emu.value, { roles: 'D55 browser role', clipboard: 'D55 clipboard' }, () => ctx.liveRun('android-kf-1', KF, { secs: 60 }));
    },
    judge: judgeOf('D55 verdict'),
  };
  const d43: Block = {
    id: 'D43',
    label: 'D43 verdict',
    needs: ['ios'],
    stateful: { what: 'the WDA window not put back', hand: (file) => [`put the domains back from the backups beside ${file}`] },
    run: async (ctx) => {
      const sim = await ios.open(ctx);
      if (!sim.ok) return ctx.verdict('INCONCLUSIVE', sim.why);
      const w = await wdaWindow(ctx, sim.value, {
        runs: [{ name: 'ios-wda-d43-1', asked: P7W }],
        work: async () => {
          o.beforeWork?.();
          const fit = await iosCheck(ctx, sim.value, 'D43 wda 1');
          if (fit.ok) await ctx.liveRun('ios-wda-d43-1', P7W, { secs: 60 });
          else ctx.verdict('INCONCLUSIVE', `${fit.why} — no wda run`);
        },
      });
      windows.push(w);
    },
    judge: judgeOf('D43 verdict'),
  };
  const lab = labBlock(o.labNeeds ?? ['android-build', 'android'], { build });
  const blocks = o.d55First === true ? [d55, lab, d43] : [lab, d55, d43];
  return { build, android, ios, blocks, windows, needs: { ...build.needs, android: android.need, ios: ios.need }, lastly: [ios.lastly, build.lastly] };
}

function go(b: ReturnType<typeof batch>, env: Record<string, string> = {}): Promise<number> {
  return runBatch({
    name: 'batch-l',
    blocks: b.blocks,
    needs: b.needs,
    lastly: b.lastly,
    config: { ok: true, config: { out, repo, udid: LAB_UDID, serial: LAB_SERIAL, env } },
    io: { fs: nodeFs, seam, terminal: () => {}, clock, pid: 4242, table, graceMs: 5 },
  });
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean, ms = 1500): Promise<void> {
  for (const end = Date.now() + ms; Date.now() < end; await tick(2)) if (ok()) return;
  throw new Error('the condition never held');
}

describe('a fake lab batch under runBatch: the lab lines from the needs, the reads, the WDA window, the protected-key line (spec S6b)', () => {
  it('the whole SUMMARY of a clean run: every lab line in the order checked, each block\'s lines, the finportal key unchanged, RESTORE none; exit 0', async () => {
    const b = batch();
    expect(await go(b)).toBe(0);
    const apk = join(dirOf('lab'), 'installed.apk');
    expect(summary()).toEqual([
      '======== SUMMARY',
      "OK checkout: main's HEAD aaaaaaaa, clean",
      `LAB android-build: OK — built from the checkout under test (${join(repo, 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk')}) under JDK 17: ${join(root, 'jdk17')} (from java_home); its assets/cells.json main's; the Gradle daemon stopped`,
      `LAB android: OK — averi_lab emulator ${LAB_SERIAL}; this run's build installed under JDK 17: ${join(root, 'jdk17')} (from java_home); the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
      "LAB ios: OK — averi-lab iPhone 17 simulator, iOS 27.0, reset; not rebuilt; the installed cells.json is main's",
      "lab check: PASS — every lab need met: android-build, android (each one's LAB line above)",
      'D55 browser role: WARN — not compared: before: exit 255 Unknown command: get-role-holders; after: exit 255 Unknown command: get-role-holders',
      'D55 clipboard: WARN — not compared: before: the device has no such command: No shell command implementation.; after: the device has no such command: No shell command implementation.',
      'D55 verdict: PASS — its runs complete',
      'D43 WDA-window restore: OK — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility); port 8120 free',
      'D43 WDA-window compare: OK — every domain still equals its backup after the end check',
      'D43 verdict: PASS — its runs complete',
      "OK   com.apple.launchservices.schemeapproval's -->sk.finportal.myport unchanged (absent; read only)",
      'RESTORE: none — everything dirty was put back and verified',
      `======== SUMMARY end (run ${ID})`,
    ]);
    // The Android build's daemon stopped right after its build; the lab's processes ended at the run's end.
    const gradle = seam.words.filter((w) => w.includes('gradlew'));
    expect(gradle.map((w) => w.split(' ').slice(1).join(' '))).toEqual(['--console=plain assembleDebug', '--stop']);
    expect(seam.words.slice(-5)).toEqual(['pkill -f DerivedData/averi-wda-lab([/ ]|$)', `pkill -f Devices/${LAB_UDID}/.*WebDriverAgentRunner`, 'lsof -t -n -P -sTCP:LISTEN -i tcp:8120', `pkill -f idb_companion --udid ${LAB_UDID}`, `idb disconnect ${LAB_UDID}`]);
    expect(outText()).toContain(`NOTE the lab's WebDriverAgent (port 8120 free) and idb_companion of ${LAB_UDID} ended`);
  });

  it('a late writer after the restore: the compare WARN, its hand lines in RESTORE, exit 1; the finportal key CHANGED a FAIL line, from the ios need\'s end (T2b batch-13 gap 4)', async () => {
    fresh({ lateFlip: true, finportal: '1', finportalEnd: '2' });
    expect(await go(batch())).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('D43 WDA-window compare:'))).toMatch(/^D43 WDA-window compare: WARN — com\.apple\.Accessibility: .* — the state file marked dirty again; the hand lines are in RESTORE$/);
    expect(s).toContain(`RESTORE: state not provably put back — ${join(out, 'RESTORE.txt')}:`);
    expect(s.some((l) => l.startsWith('D43 (iOS, changed after the restore — a late writer): xcrun simctl spawn LAB-SIMULATOR-UDID defaults write com.apple.Accessibility'))).toBe(true);
    expect(s.filter((l) => l.includes('finportal'))).toHaveLength(1);
    expect(s.find((l) => l.includes('finportal'))).toMatch(/^FAIL com\.apple\.launchservices\.schemeapproval's -->sk\.finportal\.myport CHANGED: 1 at the start, 2 at the end/);
  });

  it('d43-backupfail: the D43 block INCONCLUSIVE naming the backup\'s why, nothing changed, its .cases asked and never ran', async () => {
    fresh({ exportFails: 'com.apple.Preferences' });
    expect(await go(batch())).toBe(0);
    expect(summary()).toContain('D43 verdict: INCONCLUSIVE — the WDA window did not run: the simulator domains could not be backed up — no wda run (nothing changed): defaults export com.apple.Preferences: exit 1 export com.apple.Preferences failed — no state written');
    expect(existsSync(join(dirOf('D43'), 'ios-wda-d43-1.cases'))).toBe(true);
    expect(seam.words.some((w) => w.includes('--sources wda'))).toBe(false);
  });
});

describe('the work\'s own health check inside the WDA window (T2b batch-13: never at batch level before, only in the dry harness)', () => {
  it('not fit ({ok: false}: sick, and its reset cannot boot): the block INCONCLUSIVE naming why, no wda run, the window still put back and compared; exit 0', async () => {
    const b = batch({ beforeWork: () => ((world.st.sick = 'describe-all'), (seam.fails = 'simctl boot')) });
    expect(await go(b)).toBe(0);
    const s = summary();
    expect(s).toContain('D43 verdict: INCONCLUSIVE — the iOS reset before D43 wda 1 failed: simctl boot: exit 149 Unable to boot device — no wda run');
    expect(s.find((l) => l.startsWith('D43 WDA-window restore:'))).toMatch(/^D43 WDA-window restore: OK — /);
    expect(s).toContain('D43 WDA-window compare: OK — every domain still equals its backup after the end check');
    expect(s).toContain('RESTORE: none — everything dirty was put back and verified');
    expect(seam.words.some((w) => w.includes('--sources wda'))).toBe(false);
    expect(b.windows).toEqual([{ ran: true, putBack: true, warnings: [] }]);
  });
});

describe('the finportal key CHANGED fails the run by itself: the ios need\'s end reads it, no block of the batch\'s own judges it (T2b batch-13 gap 4)', () => {
  it('a clean run whose key changed: exit 1, its FAIL line in the protected-key slot, after the blocks\' lines', async () => {
    fresh({ finportal: '1', finportalEnd: '2' });
    expect(await go(batch())).toBe(1);
    const s = summary();
    expect(s.slice(-4, -1)).toEqual([
      'D43 verdict: PASS — its runs complete',
      "FAIL com.apple.launchservices.schemeapproval's -->sk.finportal.myport CHANGED: 1 at the start, 2 at the end — no batch writes it: read it by hand (batch-5's backup stays read only)",
      'RESTORE: none — everything dirty was put back and verified',
    ]);
  });

  it('ONLY=D55: the ios need never met, so never ended — no finportal line, exit 0', async () => {
    fresh({ finportal: '1', finportalEnd: '2' });
    expect(await go(batch(), { ONLY: 'D55' })).toBe(0);
    expect(summary().some((l) => l.includes('finportal'))).toBe(false);
  });
});

describe('needs not met make their blocks INCONCLUSIVE, the others run (b11-dry noandroid, b2-noios)', () => {
  it('an emulator that is not the lab\'s: the lab block and D55 INCONCLUSIVE naming the guard; D43 runs', async () => {
    fresh({ avd: 'Pixel_7' });
    expect(await go(batch())).toBe(0);
    const s = summary();
    const why = `the lab guard refused ${LAB_SERIAL} (nothing was done to it): ${LAB_SERIAL} is AVD "Pixel_7", not the lab's averi_lab: refused`;
    expect(s).toContain(`LAB android: ERROR — ${why}`);
    expect(s).toContain(`lab check: INCONCLUSIVE — android: ${why}`);
    expect(s).toContain(`D55 verdict: INCONCLUSIVE — android: ${why}`);
    expect(s).toContain('D43 verdict: PASS — its runs complete');
  });

  it('the lab build failing: the blocks needing it INCONCLUSIVE; the device check still installs nothing of it', async () => {
    fresh({ buildFails: 'gradlew' });
    const b = batch();
    expect(await go(b)).toBe(0);
    const s = summary();
    const why = `the Android build failed (exit 1; ${join(dirOf('lab'), 'android-build.log')})`;
    expect(s).toContain(`LAB android-build: ERROR — ${why}`);
    expect(s).toContain(`lab check: INCONCLUSIVE — android-build: ${why}`);
    // batch-11's WARN (review round 1, MINOR 3): the build's why, the APK already installed used.
    expect(s.find((l) => l.startsWith('LAB android:'))).toMatch(new RegExp(`^LAB android: WARN — ${why.replace(/[()]/g, '\\$&')}; the app already installed is used: averi_lab emulator LAB-SERIAL; not rebuilt;`));
    expect(seam.words.filter((w) => w.includes('gradlew')).at(-1)).toMatch(/--stop$/);
    expect(seam.words.some((w) => w.includes('install -r'))).toBe(false);
    expect(seam.words.filter((w) => w.includes('assembleDebug'))).toHaveLength(1);
  });

  it('the lab block naming only the device need: the build failed is a WARN, never "every lab need met" (review round 1, MAJOR 2)', async () => {
    fresh({ buildFails: 'gradlew' });
    expect(await go(batch({ labNeeds: ['android'] }))).toBe(0);
    expect(summary().find((l) => l.startsWith('lab check:'))).toBe(`lab check: WARN — the lab devices checked, but this run's build failed (android-build: the Android build failed (exit 1; ${join(dirOf('lab'), 'android-build.log')})): the app already installed is used`);
  });

  it('a simulator that is not the lab\'s: D43 INCONCLUSIVE, its WDA window never opened, no finportal line', async () => {
    fresh({ simName: 'iPhone 17' });
    expect(await go(batch())).toBe(0);
    const s = summary();
    expect(s.find((l) => l.startsWith('D43 verdict'))).toMatch(/^D43 verdict: INCONCLUSIVE — ios: the lab guard refused/);
    expect(s.some((l) => l.includes('finportal'))).toBe(false);
    expect(seam.words.some((w) => w.includes('pkill'))).toBe(false);
  });
});

describe('this run\'s build installed once, whatever the order of the needs or the blocks (review round 1, MAJOR 2)', () => {
  const once = () => {
    expect(seam.words.filter((w) => w.includes('assembleDebug'))).toHaveLength(1);
    expect(seam.words.filter((w) => w.includes(' install -r '))).toHaveLength(1);
    expect(summary().find((l) => l.startsWith('LAB android:'))).toContain("this run's build installed");
  };
  it('the Android block before the lab block: its need asks the build itself', async () => {
    expect(await go(batch({ d55First: true }))).toBe(0);
    once();
  });
  it('the device need listed before the build need in the lab block', async () => {
    expect(await go(batch({ labNeeds: ['android', 'android-build'] }))).toBe(0);
    once();
  });
});

describe('ONLY=lab runs just the lab check: its needs, no other block (batch-11, batch-12)', () => {
  it('the build and the Android check only; no iOS need asked, no other block run; exit 0', async () => {
    expect(await go(batch(), { ONLY: 'lab' })).toBe(0);
    expect(summary().filter((l) => /^(LAB|lab check|D55|D43)/.test(l)).map((l) => l.split(':')[0])).toEqual(['LAB android-build', 'LAB android', 'lab check']);
    expect(seam.words.some((w) => w.startsWith('xcrun') || w.startsWith('idb'))).toBe(false);
  });
});

describe('the Gradle daemon after an abort inside the Android build (review round 1, MINOR 6)', () => {
  it('SIGINT during assembleDebug: the build stopped, its own --stop refused, then the kit\'s last step runs `gradlew --stop`; exit 130', async () => {
    seam.hang = 'assembleDebug';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.includes('assembleDebug')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(seam.words.filter((w) => w.includes('gradlew')).map((w) => w.split(' ').slice(1).join(' '))).toEqual(['--console=plain assembleDebug', '--stop']);
    expect(outText()).toContain("NOTE lab android: the Gradle daemon stopped at the run's end (its build was cut short)");
  });
});

describe('an abort landing during the build\'s own --stop (review round 2, MINOR 2)', () => {
  it('its --stop cut: the marker kept, the last step runs --stop again', async () => {
    seam.hang = 'gradlew --stop';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.endsWith('gradlew --stop')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(seam.words.filter((w) => w.endsWith('gradlew --stop'))).toHaveLength(2);
    // The reason the one the marker was kept for (code review, MINOR 2).
    expect(outText()).toContain("NOTE lab android: the Gradle daemon stopped at the run's end (its --stop failed: exit 143)");
  });
});

describe('the abort inside the WDA window: the WDA ended, the wait, the restore; RESTORE hand lines when it is not put back (S2 window, batch-11.sh:195–203)', () => {
  it('SIGINT during the wda live run: the lab\'s WDA ended, the domains put back, verified by the abort; the lab\'s processes ended last; exit 130', async () => {
    seam.hang = '--sources wda';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.includes('--sources wda')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(outText()).toMatch(/OK   WDA window put back \(verified by the abort\): D43 WDA-window restore: OK — .*com\.apple\.Accessibility put back .*; port 8120 free/);
    expect(summary()).toContain('RESTORE: none — everything dirty was put back and verified');
    // The companion's entry dropped after its pkill on the abort's end too (batch-13).
    expect(seam.words.slice(-2)).toEqual([`pkill -f idb_companion --udid ${LAB_UDID}`, `idb disconnect ${LAB_UDID}`]);
    expect(world.domains.get('com.apple.Accessibility')!.ApplicationAccessibilityEnabled).toEqual({ t: 'bool', c: 'true', v: 'true' });
  });

  /** RESTORE.txt when port 8120 stays listened on: the WDA's kill, each domain, the compare (review round 1, BLOCKER). */
  const blockedRestore = (how: string) => {
    const dir = dirOf('D43');
    return [
      `batch-l run ${ID} ${how} at 2026-11-05 09:44:26; state to put back by hand:`,
      `D43 (iOS): first end the lab's WebDriverAgent (a runner still running undoes a restore at its exit): pkill -f 'DerivedData/averi-wda-lab([/ ]|$)'; pkill -f 'Devices/${LAB_UDID}/.*WebDriverAgentRunner'; lsof -t -n -P -sTCP:LISTEN -i tcp:8120 | xargs kill`,
      ...['com.apple.keyboard.preferences', 'com.apple.Preferences', 'com.apple.Accessibility'].map((d) => `D43 (iOS): xcrun simctl spawn ${LAB_UDID} defaults import ${d} ${join(dir, `state.${d}.backup.plist`)}`),
      `D43 (iOS): then read each domain back (defaults export) and compare it with its backup beside ${join(dir, 'state.json')}; only when every one is equal, set the state file's dirty to false`,
      '',
    ].join('\n');
  };

  it('a listener of 8120 that stays, interrupted: nothing restored, the state dirty; RESTORE the WDA\'s kill, each domain, the compare; exit 130 (review round 1, BLOCKER)', async () => {
    fresh({ stickyListener: true });
    seam.hang = '--sources wda';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.includes('--sources wda')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe(blockedRestore('interrupted'));
    expect(summary()).toContain(`RESTORE: state not provably put back — ${join(out, 'RESTORE.txt')}:`);
    expect(seam.words.some((w) => / defaults (write|import|delete) /.test(w))).toBe(false);
    expect(JSON.parse(readFileSync(join(dirOf('D43'), 'state.json'), 'utf8')).dirty).toBe(true);
  });

  it('the port free but the key-by-key restore failing, interrupted: the same hand lines, from the one builder (code review, MAJOR 1)', async () => {
    fresh({ restoreFails: true });
    seam.hang = '--sources wda';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.includes('--sources wda')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe(blockedRestore('interrupted'));
  });

  it('…and on the normal path: the window left open, RESTORE at the end the same lines; the block INCONCLUSIVE (code review, MAJOR 1)', async () => {
    fresh({ restoreFails: true });
    expect(await go(batch())).toBe(1);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe(blockedRestore('ended'));
    expect(summary()).toContain("D43 verdict: INCONCLUSIVE — the lab's settings not put back (see RESTORE)");
  });

  it('the same on the normal path: the window left open, its hand lines in RESTORE at the end, in the same order; exit 1 (review round 1, BLOCKER)', async () => {
    fresh({ stickyListener: true });
    expect(await go(batch())).toBe(1);
    expect(readFileSync(join(out, 'RESTORE.txt'), 'utf8')).toBe(blockedRestore('ended'));
    expect(summary().some((l) => l.startsWith('D43 WDA-window compare'))).toBe(false);
    // Not put back, never PASS (review round 2): the block's verdict INCONCLUSIVE whatever its judge would say.
    expect(summary()).toContain("D43 verdict: INCONCLUSIVE — the lab's settings not put back (see RESTORE)");
    expect(summary().some((l) => l.startsWith('D43 verdict: PASS'))).toBe(false);
  });

});
