import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WindowSpec } from '../../../scripts/truth/batch/abort.js';
import type { Asked } from '../../../scripts/truth/batch/cases.js';
import type { Run } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import {
  ALERT_WAIT_MS,
  CHECK_WAIT_MS,
  dismissOpenIn,
  endLabProcesses,
  health,
  HOST_SECS,
  iosCheck,
  iosLab,
  IosSim,
  killLabWda,
  PORT_RECHECK_MS,
  RESET_WAIT_MS,
  reset,
  WDA_EXIT_WAIT_MS,
  WDA_WINDOW,
  wdaWindow,
  wdaWindowSpec,
} from '../../../scripts/truth/batch/ios-lab.js';
import { portHand } from '../../../scripts/truth/batch/lab-lines.js';
import type { BlockCtx, NeedCtx } from '../../../scripts/truth/batch/runner.js';
import { stateOf } from '../../../scripts/truth/batch/run-dir.js';
import { verdictLine } from '../../../scripts/truth/batch/words.js';
import { CATALOG, LAB_UDID, labWorld, runOf, type LabWorld, type WorldOptions } from './lab-fakes.js';

// scripts/truth/batch/ios-lab.ts over the fake lab (lab-fakes.ts): the `ios` need, the health check and the Open-in
// alert, the reset, the WDA window on its normal path and as the abort's dirty window, the iOS stretch's end and the
// run's last step. Real files in a temp dir, through io.ts; waits recorded, never waited. Every call of every test is
// checked for b11-dry's VIOLATIONs made exact (afterEach). The titles name the batch and the fix each rule comes from.

let dir: string;
let world: LabWorld;
let waits: number[];
const wait = async (ms: number) => void waits.push(ms);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-ios-lab-'));
  mkdirSync(join(dir, 'lab'));
  mkdirSync(join(dir, 'repo', 'fixtures', 'apps'), { recursive: true });
  writeFileSync(join(dir, 'repo', 'fixtures', 'apps', 'cells.json'), CATALOG);
  waits = [];
  world = labWorld({ dir });
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});

const fresh = (o: Omit<WorldOptions, 'dir'> = {}) => (world = labWorld({ dir, ...o }));
async function simOf(run: Run = runOf(world)): Promise<IosSim> {
  const r = await IosSim.open(LAB_UDID, run, { wait });
  if (!r.ok) throw new Error(r.why);
  return r.lab;
}
const config = (over: { udid?: string } = { udid: LAB_UDID }) => ({ out: join(dir, 'out'), repo: join(dir, 'repo'), env: {}, ...over });
const steps: string[] = [];
const needCtx = (run = runOf(world), udid: string | null = LAB_UDID): NeedCtx => ({ bounded: run, labDir: join(dir, 'lab'), config: config(udid === null ? {} : { udid }), fs: nodeFs, step: (w, t) => void steps.push(`${w} ${t}`) });
beforeEach(() => void (steps.length = 0));
/** The words of the calls made, from the `n`th on. */
const words = (from = 0) => world.calls.slice(from);

/** A block's ctx as the runner gives it, recording what the block said and did, in order. */
function blockCtx(run = runOf(world), id = 'D43') {
  const events: string[] = [];
  const windows = new Map<string, WindowSpec>();
  const ctx = {
    id: 'D43',
    dir: join(dir, id),
    labDir: join(dir, 'lab'),
    config: config(),
    fs: nodeFs,
    knobs: {},
    bounded: run,
    step: (w: string, t: string) => void events.push(`${w} ${t}`),
    note: (l: string) => void events.push(`note ${l}`),
    err: (t: string) => void events.push(`ERROR ${t}`),
    print: () => {},
    open: (name: string, spec: WindowSpec) => (windows.set(name, spec), void events.push(`open ${name}`)),
    close: (name: string) => (windows.delete(name), void events.push(`close ${name}`)),
    stopKept: async () => {},
    verdict: (v: string, why?: string) => void events.push(`verdict ${verdictLine('D43 live verdict', v as 'PASS', why)}`),
    verdictLines: (lines: readonly string[]) => void events.push(...lines.map((l) => `verdict ${l}`)),
    restoreHand: (hand: readonly string[]) => void events.push(...hand.map((h) => `hand ${h}`)),
    verdictAndHand: (r: { line: string; hand: readonly string[] }) => void events.push(`verdict ${r.line}`, ...r.hand.map((h) => `hand ${h}`)),
    protectedLine: (l: string) => void events.push(`protected ${l}`),
    liveRun: async () => ({ live: { word: 'OK' as const, why: 'exit 0' } }),
    asksLive: (name: string) => void events.push(`asks ${name}, state ${existsSync(join(dir, id, 'state.json')) ? 'there' : 'none'}`),
    asks: () => {},
    record: () => {},
  } satisfies BlockCtx;
  mkdirSync(ctx.dir, { recursive: true });
  return { ctx, events, windows };
}

describe('IosSim — the lab simulator had only through ios-domains.ts\'s LabSim guard (batch-11 lab_guard)', () => {
  it('a simulator not named `averi-lab …` is refused after simctl\'s list alone; the lab one opens with the guard\'s words', async () => {
    fresh({ simName: 'iPhone 17 Pro' });
    const r = await IosSim.open(LAB_UDID, runOf(world));
    expect(r).toEqual({ ok: false, why: `the lab guard refused ${LAB_UDID} (nothing was done to it): simulator ${LAB_UDID} is "iPhone 17 Pro", not the lab's (averi-lab …): refused` });
    expect(words()).toEqual(['xcrun simctl list devices -j']);
    fresh();
    const lab = await simOf();
    expect([lab.udid, lab.sim.description, lab.fs]).toEqual([LAB_UDID, 'averi-lab iPhone 17 simulator, iOS 27.0', nodeFs]);
  });

  it('`using` keeps it guarded over another Run, which then gets every call', async () => {
    const lab = await simOf();
    const other = runOf(world);
    await lab.using(other).idb(['ui', 'describe-all']);
    expect(other.seen.map((s) => s.words)).toEqual([`idb ui describe-all --udid ${LAB_UDID}`]);
  });
});

describe('the lab\'s WebDriverAgent ended by its exact patterns, port 8120 only (batch-11.sh:321–325 kill_lab_wda)', () => {
  it('pkill by its derived data and by its runner under the lab simulator, then each listener of 8120 killed — each call bounded', async () => {
    fresh({ listeners: [4242, 4343] });
    const run = runOf(world);
    const r = await killLabWda({ run, udid: LAB_UDID });
    expect(run.seen.map((s) => s.words)).toEqual(['pkill -f averi-wda-lab', `pkill -f Devices/${LAB_UDID}/.*WebDriverAgentRunner`, 'lsof -t -n -P -sTCP:LISTEN -i tcp:8120']);
    expect(r).toEqual({ port: { state: 'free' }, whys: [] });
    expect(run.seen.every((s) => s.secs === HOST_SECS)).toBe(true);
  });

  it('a listener left after pkill: killed by its pid (never this process\'s), read as busy', async () => {
    fresh({ listeners: [4242, process.pid], stickyListener: true });
    const run = runOf(world);
    const r = await killLabWda({ run, udid: LAB_UDID });
    expect(run.seen.map((s) => s.words).slice(3)).toEqual(['kill -TERM 4242']);
    expect(r.port).toEqual({ state: 'busy', pids: [4242, process.pid] });
  });

  it('a pkill or a kill that fails, or an unread port, is said in its whys', async () => {
    const r = await killLabWda({ run: async (cmd) => ({ code: cmd === 'lsof' ? 2 : 3, timedOut: false, signal: null, out: '', err: `${cmd} broke` }), udid: LAB_UDID });
    expect(r.whys).toEqual(['pkill: exit 3 pkill broke', 'pkill: exit 3 pkill broke', 'lsof: exit 2 lsof broke']);
    const k = await killLabWda({ run: async (cmd) => ({ code: cmd === 'kill' ? 1 : 0, timedOut: false, signal: null, out: cmd === 'lsof' ? '7\n' : '', err: '' }), udid: LAB_UDID });
    expect(k.whys).toEqual(['kill 7: exit 1']);
  });
});

describe('the health check, the Open-in alert and the reset (batch-11.sh:326–361; open-in-alert.py)', () => {
  it('health: describe-all, then a swipe; either failing says which', async () => {
    expect(await health(await simOf())).toBeUndefined();
    expect(words(1)).toEqual([`idb ui describe-all --udid ${LAB_UDID}`, `idb ui swipe 200 600 200 400 --udid ${LAB_UDID}`]);
    fresh({ sick: 'describe-all' });
    expect(await health(await simOf())).toBe('describe-all: exit 1 No translation object returned');
    fresh({ sick: 'swipe' });
    expect(await health(await simOf())).toBe('swipe: exit 1 swipe failed');
  });

  it('no alert: none, nothing tapped; one up: Cancel tapped at its centre, read again after ALERT_WAIT_MS — dismissed', async () => {
    expect(await dismissOpenIn(await simOf())).toEqual({ state: 'none' });
    fresh({ alertTaps: 1 });
    expect(await dismissOpenIn(await simOf())).toEqual({ state: 'dismissed', how: 'Cancel tapped at 140,420 (attempt 1)' });
    expect(words(1)).toEqual([`idb ui describe-all --json --udid ${LAB_UDID}`, `idb ui tap 140 420 --udid ${LAB_UDID}`, `idb ui describe-all --json --udid ${LAB_UDID}`]);
    expect(waits).toEqual([ALERT_WAIT_MS]);
  });

  it('still up after two taps: stuck; a third is never tried', async () => {
    fresh({ alertTaps: 3 });
    expect(await dismissOpenIn(await simOf())).toEqual({ state: 'stuck', why: 'the open-in alert Open in “AveriLab”? is still up after 2 Cancel taps' });
    expect(words().filter((w) => w.includes('ui tap'))).toHaveLength(2);
  });

  it('no Cancel with a frame: stuck at once, nothing tapped; a read that fails: unread', async () => {
    const lab = await simOf(async (cmd, args) =>
      cmd === 'xcrun' ? runOf(world)(cmd, args) : { code: 0, timedOut: false, signal: null, out: JSON.stringify([{ AXLabel: 'Open in “X”?' }, { AXLabel: 'Open', type: 'Button' }]), err: '' },
    );
    expect(await dismissOpenIn(lab)).toEqual({ state: 'stuck', why: 'the open-in alert Open in “X”? has no Cancel button with a frame (buttons: Open)' });
    fresh({ sick: 'describe-all' });
    expect(await dismissOpenIn(await simOf())).toEqual({ state: 'unread', why: 'idb ui describe-all: exit 1 No translation object returned' });
  });

  it('the reset in batch-11\'s order: the companion and the WDA ended, shutdown, boot, bootstatus -b, wait, launch, wait, health', async () => {
    const lab = await simOf();
    expect(await reset(needCtx(), lab)).toBeUndefined();
    expect(words(1)).toEqual([
      `pkill -f idb_companion --udid ${LAB_UDID}`,
      'pkill -f averi-wda-lab',
      `pkill -f Devices/${LAB_UDID}/.*WebDriverAgentRunner`,
      'lsof -t -n -P -sTCP:LISTEN -i tcp:8120',
      `xcrun simctl shutdown ${LAB_UDID}`,
      `xcrun simctl boot ${LAB_UDID}`,
      `xcrun simctl bootstatus ${LAB_UDID} -b`,
      `xcrun simctl launch ${LAB_UDID} dev.averi.lab`,
      `idb ui describe-all --udid ${LAB_UDID}`,
      `idb ui swipe 200 600 200 400 --udid ${LAB_UDID}`,
    ]);
    expect(waits).toEqual([RESET_WAIT_MS, RESET_WAIT_MS]);
    expect(steps).toEqual([`NOTE ios-reset: ${LAB_UDID}, its idb companion and the lab's WebDriverAgent`, 'OK ios-reset']);
  });

  it('a boot that fails stops the reset there, naming it; a health check failing after it is said', async () => {
    fresh({ bootFails: true });
    expect(await reset(needCtx(), await simOf())).toBe('simctl boot: exit 149 Unable to boot device');
    expect(words().some((w) => w.includes('launch'))).toBe(false);
    const lab = await simOf(async (cmd, args) => (cmd === 'idb' ? { code: 1, timedOut: false, signal: null, out: '', err: 'gone' } : runOf((fresh(), world))(cmd, args)));
    expect(await reset(needCtx(), lab)).toBe('the health check after the reset: describe-all: exit 1 gone');
  });

  it('iosCheck: the WDA ended, CHECK_WAIT_MS, the alert, the health check — OK; an alert dismissed is a WARN', async () => {
    fresh({ alertTaps: 1 });
    const c = needCtx();
    expect(await iosCheck(c, await simOf(), 'D43 wda 1')).toBeUndefined();
    expect(waits).toEqual([CHECK_WAIT_MS, ALERT_WAIT_MS]);
    expect(steps).toEqual(['WARN open-in alert before D43 wda 1: dismissed — Cancel tapped at 140,420 (attempt 1)', 'OK ios-health before D43 wda 1']);
  });

  it('iosCheck: a failed health check or a stuck alert resets; a reset that fails too is an ERROR and why it is not fit', async () => {
    fresh({ sick: 'swipe' });
    expect(await iosCheck(needCtx(), await simOf(), 'D43 wda 1')).toBeUndefined();
    expect(steps).toContain('WARN ios-health before D43 wda 1: swipe: exit 1 swipe failed — resetting');
    expect(steps.at(-1)).toBe('OK ios-reset');
    steps.length = 0;
    fresh({ alertTaps: 5, bootFails: true });
    expect(await iosCheck(needCtx(), await simOf(), 'D43 wda 1')).toBe('the iOS reset before D43 wda 1 failed: simctl boot: exit 149 Unable to boot device');
    expect(steps).toContain('WARN ios-health before D43 wda 1: the open-in alert could not be dismissed: the open-in alert Open in “AveriLab”? is still up after 2 Cancel taps — resetting');
    expect(steps.at(-1)).toBe('ERROR ios-reset before D43 wda 1 failed: simctl boot: exit 149 Unable to boot device');
  });

  it('iosCheck: an alert that cannot be read is a NOTE, and the health check decides', async () => {
    const lab = await simOf(async (cmd, args) => (args.includes('--json') ? { code: 2, timedOut: false, signal: null, out: '', err: 'idb: x' } : runOf(world)(cmd, args)));
    expect(await iosCheck(needCtx(), lab, 'T6')).toBeUndefined();
    expect(steps).toEqual(['NOTE open-in alert before T6 not read: idb ui describe-all: exit 2 idb: x', 'OK ios-health before T6']);
  });
});

describe('the ios need (batch-11.sh:383–410): guard, reset, the finportal key\'s first read, this run\'s build installed, the installed cells.json main\'s', () => {
  it('met: its how names the simulator, the reset, the build and the cells; the installed cells kept in the lab folder', async () => {
    const ios = iosLab({ wait });
    const r = await (ios.need as { check(c: NeedCtx): Promise<unknown> }).check(needCtx());
    expect(r).toEqual({ ok: true, how: "averi-lab iPhone 17 simulator, iOS 27.0, reset; not rebuilt; the installed cells.json is main's" });
    expect(readFileSync(join(dir, 'lab', 'ios-installed-cells.json'), 'utf8')).toBe(CATALOG);
    expect(steps).toContain("NOTE com.apple.launchservices.schemeapproval's finportal key at the iOS stretch's start: absent (read only: no batch writes it)");
  });

  it('no udid given: not met, nothing called; a refused simulator: the guard\'s why', async () => {
    const ios = iosLab({ wait });
    const check = (ios.need as { check(c: NeedCtx): Promise<unknown> }).check;
    expect(await check(needCtx(runOf(world), null))).toEqual({ ok: false, why: 'no lab simulator udid given (--udid or AVERI_LAB_UDID)' });
    expect(world.calls).toEqual([]);
    fresh({ simName: 'iPhone 17' });
    expect(await check(needCtx())).toMatchObject({ ok: false, why: expect.stringContaining('the lab guard refused') });
  });

  it('a reset that fails, an install of this run\'s build that fails, a cells.json not main\'s, no app: not met, each its why', async () => {
    fresh({ bootFails: true });
    const check = (o = {}) => (iosLab({ wait, ...o }).need as { check(c: NeedCtx): Promise<unknown> }).check(needCtx());
    expect(await check()).toEqual({ ok: false, why: 'the initial iOS reset failed: simctl boot: exit 149 Unable to boot device' });
    fresh({ appCells: '{"cells":[]}\n' });
    expect(await check({ reset: false })).toEqual({ ok: false, why: `the installed app (${world.app})'s cells.json is not main's (rerun with ONLY=lab,…)` });
    fresh({ appCells: null });
    expect(await check({ reset: false })).toEqual({ ok: false, why: 'the lab app is not installed (simctl get_app_container: exit 2 No such file or directory) (rerun with ONLY=lab,…)' });
    expect(await check({ reset: false, build: () => join(dir, 'no-such.app') })).toMatchObject({ ok: false, why: expect.stringMatching(/^this run's build not installed/) });
  });

  it('this run\'s build: installed before the cells are compared (batch-11.sh:399–401), said in the how', async () => {
    fresh({ appCells: '{"old":1}\n' });
    const app = join(dir, 'built.app');
    mkdirSync(app);
    writeFileSync(join(app, 'cells.json'), CATALOG);
    const r = await (iosLab({ wait, reset: false, build: () => app }).need as { check(c: NeedCtx): Promise<unknown> }).check(needCtx());
    expect(r).toEqual({ ok: true, how: "averi-lab iPhone 17 simulator, iOS 27.0; this run's build installed; the installed cells.json is main's" });
    expect(words()).toContain(`xcrun simctl install ${LAB_UDID} ${app}`);
  });

  it('alive: the guard, then describe-all (a read; no swipe, no reset)', async () => {
    const alive = (iosLab({ wait }).need as { alive(c: NeedCtx): Promise<unknown> }).alive;
    expect(await alive(needCtx())).toEqual({ ok: true, how: 'idb answers' });
    expect(words()).toEqual(['xcrun simctl list devices -j', `idb ui describe-all --udid ${LAB_UDID}`]);
    fresh({ sick: 'describe-all' });
    expect(await alive(needCtx())).toEqual({ ok: false, why: 'idb ui describe-all: exit 1 No translation object returned' });
    expect(await alive(needCtx(runOf(world), null))).toMatchObject({ ok: false });
  });
});

describe('the iOS stretch\'s end: the finportal key read again, its line to the protected-key slot (batch-11.sh:656–658; batch-8\'s VOID)', () => {
  async function stretch(o: Omit<WorldOptions, 'dir'>, startRead = true) {
    fresh(o);
    const ios = iosLab({ wait, reset: false });
    if (startRead) await (ios.need as { check(c: NeedCtx): Promise<unknown> }).check(needCtx());
    world.st.restored = true;
    const { ctx, events } = blockCtx();
    await ios.endStretch(ctx, await simOf());
    return events;
  }

  it('unchanged (absent at both ends, or the same value): OK', async () => {
    expect(await stretch({})).toEqual(["protected OK   com.apple.launchservices.schemeapproval's -->sk.finportal.myport unchanged (absent; read only)"]);
    expect(await stretch({ finportal: '1' })).toEqual(["protected OK   com.apple.launchservices.schemeapproval's -->sk.finportal.myport unchanged (1; read only)"]);
  });

  it('CHANGED, or the start never read: an ERROR line — never unchanged', async () => {
    expect((await stretch({ finportal: '1', finportalEnd: '2' }))[0]).toMatch(/^protected ERROR com\.apple\.launchservices\.schemeapproval's -->sk\.finportal\.myport CHANGED: 1 at the start, 2 at the end/);
    expect((await stretch({}, false))[0]).toMatch(/unread: unreadable \(not read at the iOS stretch's start\) at the start, absent at the end/);
  });
});

describe('the WDA window (batch-11.sh:623–655): the .cases first, the backup, the work, the WDA ended, the 4 s wait, port 8120 free, the restore key by key, the end check, the compare', () => {
  const asked: Asked = { platform: 'ios', app: 'native', sources: ['wda'], cases: ['p7w'] };
  const runs = [{ name: 'ios-wda-d43-1', asked }];

  it('the whole window: every line in order — the restore OK with its port part, the window closed, the compare OK', async () => {
    const { ctx, events, windows } = blockCtx();
    const lab = await simOf();
    let ran = false;
    expect(await wdaWindow(ctx, lab, { runs, work: async () => void ((ran = true), world.startWda(), events.push('work')) })).toBe(true);
    expect(ran).toBe(true);
    const state = join(ctx.dir, 'state.json');
    expect(events).toEqual([
      'asks ios-wda-d43-1, state none',
      'OK ios-health before the WDA window',
      `note OK   D43 backup: com.apple.keyboard.preferences exported, com.apple.Preferences exported, com.apple.Accessibility exported; state ${state} (dirty until the restore verifies)`,
      `open ${WDA_WINDOW}`,
      'work',
      'verdict D43 WDA-window restore: OK — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility); port 8120 free',
      `close ${WDA_WINDOW}`,
      'OK ios-health before iOS end',
      'verdict D43 WDA-window compare: OK — every domain still equals its backup after the end check',
    ]);
    expect(windows.size).toBe(0);
    expect(stateOf(nodeFs, state)).toBe('clean');
    // The check's 2 s, the 4 s after the WDA's end, the end check's 2 s: the restore never before the runner's exit.
    expect(waits).toEqual([CHECK_WAIT_MS, WDA_EXIT_WAIT_MS, CHECK_WAIT_MS]);
  });

  it('the restore comes after the WDA kill and the wait: the runner\'s exit flips Accessibility at the kill, and the restore puts it back', async () => {
    const { ctx } = blockCtx();
    const lab = await simOf();
    const before = world.calls.length;
    await wdaWindow(ctx, lab, { work: async () => void world.startWda() });
    const after = words(before);
    const kill = after.indexOf('pkill -f averi-wda-lab', after.findIndex((w) => w.includes('export com.apple.Accessibility')));
    const write = after.findIndex((w) => w.includes('defaults write com.apple.Accessibility'));
    expect(kill).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(kill);
    expect(world.domains.get('com.apple.Accessibility')!.ApplicationAccessibilityEnabled).toEqual({ t: 'bool', c: 'true', v: 'true' });
  });

  it('d43-backupfail: the backup fails — the block\'s INCONCLUSIVE naming why, an ERROR, no window opened, the work never run', async () => {
    fresh({ exportFails: 'com.apple.Preferences' });
    const { ctx, events } = blockCtx();
    let ran = false;
    expect(await wdaWindow(ctx, await simOf(), { runs, work: async () => void (ran = true) })).toBe(false);
    expect(ran).toBe(false);
    const why = 'the simulator domains could not be backed up — no wda run (nothing changed): defaults export com.apple.Preferences: exit 1 export com.apple.Preferences failed — no state written';
    expect(events.slice(1)).toEqual(['OK ios-health before the WDA window', `ERROR the WDA window: ${why}`, `verdict D43 live verdict: INCONCLUSIVE — the WDA window did not run: ${why}`]);
    expect(events[0]).toBe('asks ios-wda-d43-1, state none');
  });

  it('the health check before it fails past a reset: INCONCLUSIVE, nothing backed up', async () => {
    fresh({ sick: 'swipe', bootFails: true });
    const { ctx, events } = blockCtx();
    expect(await wdaWindow(ctx, await simOf(), { work: async () => {} })).toBe(false);
    expect(events.at(-1)).toBe('verdict D43 live verdict: INCONCLUSIVE — the WDA window did not run: the iOS reset before the WDA window failed: simctl boot: exit 149 Unable to boot device — no wda run (nothing changed)');
    expect(existsSync(join(ctx.dir, 'state.json'))).toBe(false);
  });

  it('a late writer (the runner\'s exit after the restore, batch-11 review round 1): the compare WARN, its hand lines to RESTORE, the state marked dirty again', async () => {
    fresh({ lateFlip: true });
    const { ctx, events } = blockCtx();
    await wdaWindow(ctx, await simOf(), { work: async () => void world.startWda() });
    expect(events.find((e) => e.startsWith('verdict D43 WDA-window compare'))).toMatch(/^verdict D43 WDA-window compare: WARN — com\.apple\.Accessibility: .*bool true → int 0.* — the state file marked dirty again; the hand lines are in RESTORE$/);
    expect(events.filter((e) => e.startsWith('hand ')).length).toBeGreaterThan(0);
    expect(stateOf(nodeFs, join(ctx.dir, 'state.json'))).toBe('dirty');
  });

  it('a listener of 8120 left after the wait: killed, read again after 1.5 s — free (a listener killed); one that stays: NOT VERIFIED, the window left open for RESTORE, the compare still read', async () => {
    const { ctx, events } = blockCtx();
    // A listener that comes up during the 4 s wait (another runner's exit): killed at the port check.
    const opened = await IosSim.open(LAB_UDID, runOf(world), { wait: async (ms) => void (ms === WDA_EXIT_WAIT_MS && (world.st.listeners = [4343])) });
    await wdaWindow(ctx, (opened as { lab: IosSim }).lab, { work: async () => void world.startWda() });
    expect(events.find((e) => e.startsWith('verdict D43 WDA-window restore'))).toMatch(/; port 8120 free \(a listener killed\)$/);
    expect(words()).toContain('kill -TERM 4343');
    fresh({ stickyListener: true });
    const two = blockCtx(runOf(world), 'D43b');
    await wdaWindow(two.ctx, await simOf(), { work: async () => void world.startWda() });
    expect(two.events).toContain('verdict D43 WDA-window restore: ERROR — NOT VERIFIED — com.apple.keyboard.preferences equal, com.apple.Preferences equal, com.apple.Accessibility put back (wrote back AccessibilityEnabled, ApplicationAccessibilityEnabled, AutomationEnabled in com.apple.Accessibility); port 8120 still has a listener (pid 4242)');
    expect(two.events).toContain('ERROR the WDA window: the simulator not provably put back — the window stays open, its hand lines go to RESTORE');
    expect(two.windows.has(WDA_WINDOW)).toBe(true);
    // The domains verified, so the state is clean: the compare still runs (a WebDriverAgent left could write late).
    expect(two.events.some((e) => e.startsWith('verdict D43 WDA-window compare: OK'))).toBe(true);
    expect(waits.filter((w) => w === PORT_RECHECK_MS)).toHaveLength(1);
  });

  it('as the abort\'s dirty window: its restore over the abort\'s runner kills the WDA, waits, restores; its hand lines S4\'s and the WDA\'s kill', async () => {
    const { ctx, windows } = blockCtx();
    const lab = await simOf();
    let spec: WindowSpec | undefined;
    await wdaWindow(ctx, lab, {
      work: async () => {
        world.startWda();
        spec = windows.get(WDA_WINDOW);
        throw new Error('interrupted');
      },
    }).catch(() => {});
    expect(spec?.stateFile).toBe(join(ctx.dir, 'state.json'));
    expect(spec?.block).toBe('D43');
    expect(spec?.hand.at(-1)).toBe(portHand(LAB_UDID));
    expect(spec?.hand[0]).toMatch(/^D43 \(iOS\): xcrun simctl spawn LAB-SIMULATOR-UDID defaults import com\.apple\.keyboard\.preferences /);
    const detached = runOf(world);
    waits.length = 0;
    expect(await spec!.restore(detached)).toEqual({ ok: true, how: expect.stringMatching(/^D43 WDA-window restore: OK — .*; port 8120 free$/) });
    expect(detached.seen[0].words).toBe('pkill -f averi-wda-lab');
    expect(waits).toEqual([WDA_EXIT_WAIT_MS]);
    expect(stateOf(nodeFs, join(ctx.dir, 'state.json'))).toBe('clean');
  });

  it('the abort\'s restore not proven (a listener stays): not put back, why the line, the port\'s hand line; its bound passed on', async () => {
    fresh({ stickyListener: true, listeners: [4242] });
    const lab = await simOf();
    const spec = wdaWindowSpec(lab, join(dir, 'state.json'), { secs: 90 });
    expect(spec.secs).toBe(90);
    expect(spec.block).toBeUndefined();
    expect(await spec.restore(runOf(world))).toEqual({
      ok: false,
      why: 'D43 WDA-window restore: ERROR — NOT VERIFIED — nothing to do (no state file: the window backed nothing up, so changed nothing); port 8120 still has a listener (pid 4242)',
      hand: [portHand(LAB_UDID)],
    });
  });
});

describe('the run\'s last step: the lab\'s WebDriverAgent and idb_companion ended (batch-11.sh:660, and the end of on_abort)', () => {
  it('only once the guard cleared the simulator this run: no call before', async () => {
    const run = runOf(world);
    await endLabProcesses(() => undefined)({ run, step: (w, t) => void steps.push(`${w} ${t}`) });
    expect(run.seen).toEqual([]);
    expect(steps).toEqual([]);
  });

  it('after the need\'s check: the WDA\'s patterns, port 8120, the companion — a NOTE; one that fails a WARN naming it', async () => {
    const ios = iosLab({ wait, reset: false });
    await (ios.need as { check(c: NeedCtx): Promise<unknown> }).check(needCtx());
    steps.length = 0;
    const run = runOf(world);
    await ios.lastly({ run, step: (w, t) => void steps.push(`${w} ${t}`) });
    expect(run.seen.map((s) => s.words)).toEqual(['pkill -f averi-wda-lab', `pkill -f Devices/${LAB_UDID}/.*WebDriverAgentRunner`, 'lsof -t -n -P -sTCP:LISTEN -i tcp:8120', `pkill -f idb_companion --udid ${LAB_UDID}`]);
    expect(steps).toEqual([`NOTE the lab's WebDriverAgent (port 8120 free) and idb_companion of ${LAB_UDID} ended`]);
    steps.length = 0;
    await endLabProcesses(() => LAB_UDID)({ run: async (cmd) => ({ code: cmd === 'lsof' ? 1 : 2, timedOut: false, signal: null, out: '', err: '' }), step: (w, t) => void steps.push(`${w} ${t}`) });
    expect(steps).toEqual([`WARN the lab's WebDriverAgent (port 8120 free) and idb_companion of ${LAB_UDID} ended, not all proven: pkill: exit 2; pkill: exit 2; pkill: exit 2`]);
  });
});
