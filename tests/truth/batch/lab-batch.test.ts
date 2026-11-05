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
// WDA window and which ends the iOS stretch — over a fake process seam that answers git and live.ts as runner.test.ts
// does and every lab call through the fake lab (lab-fakes.ts), with real files in a temp dir, a fixed clock and pid.
// The whole SUMMARY; a need that fails; ONLY=lab; a build that fails; the abort inside the WDA window; the lab's
// processes at the run's end. Every call is checked for b11-dry's VIOLATIONs made exact (afterEach). No device.

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
    if (this.hang === undefined || !said.includes(this.hang)) this.ends.get(pid)!({ code: a.code, signal: null });
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

/** The fake batch: the lab block, an Android block with the tri-state reads, an iOS block in the WDA window. */
function batch() {
  const build = labBuild();
  const android = androidLab({ build: build.built.android, settle: noWait });
  const ios = iosLab({ wait: noWait });
  const judgeOf = (label: string) => async () => [`${label}: PASS — its runs complete`];
  const d55: Block = {
    id: 'D55',
    label: 'D55 verdict',
    needs: ['android'],
    run: async (ctx) => {
      const emu = await android.open(ctx);
      if (!emu.ok) return ctx.verdict('INCONCLUSIVE', emu.why);
      await withReads(ctx, emu.emu, { roles: 'D55 browser role', clipboard: 'D55 clipboard' }, () => ctx.liveRun('android-kf-1', KF, { secs: 60 }));
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
      await wdaWindow(ctx, sim.lab, {
        runs: [{ name: 'ios-wda-d43-1', asked: P7W }],
        work: async () => {
          if ((await iosCheck(ctx, sim.lab, 'D43 wda 1')) === undefined) await ctx.liveRun('ios-wda-d43-1', P7W, { secs: 60 });
        },
      });
      await ios.endStretch(ctx, sim.lab);
    },
    judge: judgeOf('D43 verdict'),
  };
  const blocks = [labBlock(['android-build', 'android']), d55, d43];
  return { build, android, ios, blocks, needs: { ...build.needs, android: android.need, ios: ios.need }, lastly: [ios.lastly] };
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
      `LAB android-build: OK — built from the checkout under test (${join(repo, 'fixtures/apps/android/build/outputs/apk/debug/AveriLab-debug.apk')}); its assets/cells.json main's; the Gradle daemon stopped`,
      `LAB android: OK — averi_lab emulator ${LAB_SERIAL}; this run's build installed; the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1`,
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
    expect(seam.words.slice(-4)).toEqual(['pkill -f averi-wda-lab', `pkill -f Devices/${LAB_UDID}/.*WebDriverAgentRunner`, 'lsof -t -n -P -sTCP:LISTEN -i tcp:8120', `pkill -f idb_companion --udid ${LAB_UDID}`]);
    expect(outText()).toContain(`NOTE the lab's WebDriverAgent (port 8120 free) and idb_companion of ${LAB_UDID} ended`);
  });

  it('a late writer after the restore: the compare WARN, its hand lines in RESTORE, exit 1; the finportal key CHANGED an ERROR line', async () => {
    fresh({ lateFlip: true, finportal: '1', finportalEnd: '2' });
    expect(await go(batch())).toBe(1);
    const s = summary();
    expect(s.find((l) => l.startsWith('D43 WDA-window compare:'))).toMatch(/^D43 WDA-window compare: WARN — com\.apple\.Accessibility: .* — the state file marked dirty again; the hand lines are in RESTORE$/);
    expect(s).toContain(`RESTORE: state not provably put back — ${join(out, 'RESTORE.txt')}:`);
    expect(s.some((l) => l.startsWith('D43 (iOS, changed after the restore — a late writer): xcrun simctl spawn LAB-SIMULATOR-UDID defaults write com.apple.Accessibility'))).toBe(true);
    expect(s.find((l) => l.includes('finportal'))).toMatch(/^ERROR com\.apple\.launchservices\.schemeapproval's -->sk\.finportal\.myport CHANGED: 1 at the start, 2 at the end/);
  });

  it('d43-backupfail: the D43 block INCONCLUSIVE naming the backup\'s why, nothing changed, its .cases asked and never ran', async () => {
    fresh({ exportFails: 'com.apple.Preferences' });
    expect(await go(batch())).toBe(0);
    expect(summary()).toContain('D43 verdict: INCONCLUSIVE — the WDA window did not run: the simulator domains could not be backed up — no wda run (nothing changed): defaults export com.apple.Preferences: exit 1 export com.apple.Preferences failed — no state written');
    expect(existsSync(join(dirOf('D43'), 'ios-wda-d43-1.cases'))).toBe(true);
    expect(seam.words.some((w) => w.includes('--sources wda'))).toBe(false);
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
    expect(s.find((l) => l.startsWith('LAB android:'))).toContain('not rebuilt');
    expect(seam.words.filter((w) => w.includes('gradlew')).at(-1)).toMatch(/--stop$/);
    expect(seam.words.some((w) => w.includes('install -r'))).toBe(false);
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

describe('ONLY=lab runs just the lab check: its needs, no other block (batch-11, batch-12)', () => {
  it('the build and the Android check only; no iOS need asked, no other block run; exit 0', async () => {
    expect(await go(batch(), { ONLY: 'lab' })).toBe(0);
    expect(summary().filter((l) => /^(LAB|lab check|D55|D43)/.test(l)).map((l) => l.split(':')[0])).toEqual(['LAB android-build', 'LAB android', 'lab check']);
    expect(seam.words.some((w) => w.startsWith('xcrun') || w.startsWith('idb'))).toBe(false);
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
    expect(seam.words.at(-1)).toBe(`pkill -f idb_companion --udid ${LAB_UDID}`);
    expect(world.domains.get('com.apple.Accessibility')!.ApplicationAccessibilityEnabled).toEqual({ t: 'bool', c: 'true', v: 'true' });
  });

  it('a listener of 8120 that stays: not put back — the port\'s hand line in RESTORE, exit 130', async () => {
    fresh({ stickyListener: true });
    seam.hang = '--sources wda';
    const done = go(batch());
    await until(() => seam.words.some((w) => w.includes('--sources wda')));
    seam.handlers!.signal('SIGINT');
    expect(await done).toBe(130);
    const restore = readFileSync(join(out, 'RESTORE.txt'), 'utf8');
    expect(restore).toContain("D43 (iOS): the lab's WebDriverAgent may still be running (port 8120 not proven free): pkill -f averi-wda-lab;");
    expect(summary()).toContain(`RESTORE: state not provably put back — ${join(out, 'RESTORE.txt')}:`);
  });
});
