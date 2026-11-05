import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WindowSpec } from '../../../scripts/truth/batch/abort.js';
import type { Run } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { ANDROID_NEED, androidLab, CHOOSER_WINDOW, chooserStretch, HANDLER_URLS, keepTree, probeRestore, withReads } from '../../../scripts/truth/batch/android-lab.js';
import { LabEmu, reinstallProgress } from '../../../scripts/truth/batch/lab-emu.js';
import type { BlockCtx, NeedCtx } from '../../../scripts/truth/batch/runner.js';
import { CATALOG, DEVICE_APK, LAB_SERIAL, labWorld, runOf, type LabWorld, type WorldOptions } from './lab-fakes.js';

// scripts/truth/batch/android-lab.ts over the fake lab (lab-fakes.ts): the `android` need and its recheck, the
// handlers' need, the tri-state reads around a block, a tree kept with its fitness as a fixture, the probe's own
// restore as a bounded child, the chooser's stretch. Real files in a temp dir, through io.ts. Every call of every test
// is checked for b11-dry's VIOLATIONs made exact (afterEach): an adb call for another serial, any `input tap`.

let dir: string;
let world: LabWorld;
const steps: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-android-lab-'));
  mkdirSync(join(dir, 'lab'));
  mkdirSync(join(dir, 'repo', 'fixtures', 'apps'), { recursive: true });
  writeFileSync(join(dir, 'repo', 'fixtures', 'apps', 'cells.json'), CATALOG);
  world = labWorld({ dir });
  steps.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  expect(world.violations).toEqual([]);
});

const fresh = (o: Omit<WorldOptions, 'dir'> = {}) => (world = labWorld({ dir, ...o }));
const config = (serial: string | null = LAB_SERIAL) => ({ out: join(dir, 'out'), repo: join(dir, 'repo'), env: {}, ...(serial === null ? {} : { serial }) });
const needCtx = (run: Run = runOf(world), serial: string | null = LAB_SERIAL): NeedCtx => ({ bounded: run, labDir: join(dir, 'lab'), config: config(serial), fs: nodeFs, step: (w, t) => void steps.push(`${w} ${t}`) });
type Spec = { check(c: NeedCtx): Promise<unknown>; alive(c: NeedCtx): Promise<unknown> };
const settle = async () => {};

describe('the android need (batch-11.sh:427–450): guard, this run\'s build installed, the APK pulled and its cells.json main\'s, the handlers counted', () => {
  it('met: its how; the APK pulled into the lab folder, its cells.json and the handler counts kept beside it', async () => {
    const android = androidLab({ settle });
    const r = await (android.need as Spec).check(needCtx());
    const apk = join(dir, 'lab', 'installed.apk');
    expect(r).toEqual({ ok: true, how: `averi_lab emulator ${LAB_SERIAL}; not rebuilt; the APK's assets/cells.json is main's (pulled: ${apk}); handlers: averilab://shared/open 2, averilab://cell/open 1` });
    expect(world.calls).toEqual([
      `adb -s ${LAB_SERIAL} emu avd name`,
      `adb -s ${LAB_SERIAL} get-state`,
      `adb -s ${LAB_SERIAL} shell pm path dev.averi.lab`,
      `adb -s ${LAB_SERIAL} pull ${DEVICE_APK} ${apk}`,
      `unzip -p ${apk} assets/cells.json`,
      `adb -s ${LAB_SERIAL} shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://shared/open`,
      `adb -s ${LAB_SERIAL} shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://cell/open`,
    ]);
    expect(android.pulled()).toBe(apk);
    expect(android.counts()).toEqual({ 'averilab://shared/open': 2, 'averilab://cell/open': 1 });
    expect(readFileSync(join(dir, 'lab', 'android-installed-cells.json'), 'utf8')).toBe(CATALOG);
    expect(readFileSync(join(dir, 'lab', 'android-handlers.txt'), 'utf8')).toBe('handlers: averilab://shared/open 2, averilab://cell/open 1\n');
    expect(HANDLER_URLS).toEqual(['averilab://shared/open', 'averilab://cell/open']);
    expect([ANDROID_NEED, CHOOSER_WINDOW]).toEqual(['android', 'D55 chooser']);
  });

  it('open: the guarded emulator over the ctx\'s own fs and the kit\'s settle', async () => {
    const fs = { ...nodeFs };
    const settled: number[] = [];
    const r = await androidLab({ settle: async (ms) => void settled.push(ms) }).open({ bounded: runOf(world), config: config(), fs });
    expect(r.ok && r.emu.fs).toBe(fs);
    if (r.ok) await r.emu.key('KEYCODE_HOME');
    expect(settled).toEqual([1000]);
  });

  it('a second check pulls into a fresh file: an earlier pull is never overwritten', async () => {
    const android = androidLab({ settle });
    await (android.need as Spec).check(needCtx());
    await (android.need as Spec).check(needCtx());
    expect(android.pulled()).toBe(join(dir, 'lab', 'installed-2.apk'));
  });

  it('no serial given: not met, nothing called; an emulator not the lab AVD: the guard\'s why (b11-dry noandroid)', async () => {
    const check = (androidLab({ settle }).need as Spec).check;
    expect(await check(needCtx(runOf(world), null))).toEqual({ ok: false, why: 'no lab emulator serial given (--serial or AVERI_LAB_SERIAL)' });
    expect(world.calls).toEqual([]);
    fresh({ avd: 'Pixel_7' });
    expect(await check(needCtx())).toEqual({ ok: false, why: `the lab guard refused ${LAB_SERIAL} (nothing was done to it): ${LAB_SERIAL} is AVD "Pixel_7", not the lab's averi_lab: refused` });
    expect(world.calls).toEqual([`adb -s ${LAB_SERIAL} emu avd name`]);
  });

  it('the lab not installed, adb unreachable, the cells.json not main\'s: not met, each its why — unreachable is unknown, never missing', async () => {
    const check = () => (androidLab({ settle }).need as Spec).check(needCtx());
    fresh({ installed: false });
    expect(await check()).toEqual({ ok: false, why: 'the lab APK is not installed (pm path)' });
    fresh({ reachable: false });
    expect(await check()).toEqual({ ok: false, why: 'whether the lab is installed is unknown (adb get-state: exit 1 error: device offline)' });
    fresh({ apkCells: '{"cells":[]}\n' });
    expect(await check()).toEqual({ ok: false, why: `the installed APK (${DEVICE_APK})'s cells.json is not main's (rerun with ONLY=lab,…)` });
  });

  it('a pull that fails, or an unzip that fails: not met, never compared as equal', async () => {
    const r = await (androidLab({ settle }).need as Spec).check(needCtx(async (cmd, args, call) => (args.includes('pull') ? { code: 1, timedOut: false, signal: null, out: '', err: 'adb: error: remote object does not exist' } : runOf(world)(cmd, args, call))));
    expect(r).toEqual({ ok: false, why: 'the installed APK not pulled (exit 1 adb: error: remote object does not exist)' });
    const none = await (androidLab({ settle }).need as Spec).check(needCtx(async (cmd, args, call) => (args.includes('pull') ? { code: 0, timedOut: false, signal: null, out: '', err: '' } : runOf(world)(cmd, args, call))));
    expect(none).toEqual({ ok: false, why: 'the installed APK not pulled (exit 0 but no file)' });
    const u = await (androidLab({ settle }).need as Spec).check(needCtx(async (cmd, args, call) => (cmd === 'unzip' ? { code: 11, timedOut: false, signal: null, out: '', err: 'caution: filename not matched' } : runOf(world)(cmd, args, call))));
    expect(u).toEqual({ ok: false, why: `the installed APK (${DEVICE_APK})'s cells.json could not be read (rerun with ONLY=lab,…)` });
    expect(existsSync(join(dir, 'lab', 'android-installed-cells.json'))).toBe(false);
  });

  it('this run\'s build: installed -r (batch-11\'s lab install, the data kept) before the check, said in the how; its failure not met', async () => {
    fresh({ apkCells: '{"old":1}\n' });
    const apk = join(dir, 'built.apk');
    writeFileSync(apk, `BUILT:${CATALOG}`);
    const r = await (androidLab({ settle, build: () => apk }).need as Spec).check(needCtx());
    expect(r).toMatchObject({ ok: true, how: expect.stringContaining("; this run's build installed; the APK's assets/cells.json is main's") });
    expect(world.calls[1]).toBe(`adb -s ${LAB_SERIAL} install -r ${apk}`);
    const bad = await (androidLab({ settle, build: () => join(dir, 'none.apk') }).need as Spec).check(needCtx());
    expect(bad).toEqual({ ok: false, why: `this run's build not installed (adb install -r: exit 1 adb: failed to stat ${join(dir, 'none.apk')}: No such file or directory)` });
  });

  it('a count that cannot be read is said, never a number; the URLs are the batch\'s to name', async () => {
    const android = androidLab({ settle, handlers: ['averilab://shared/open'] });
    const r = await (android.need as Spec).check(needCtx(async (cmd, args, call) => (args.includes('query-activities') ? { code: 1, timedOut: false, signal: null, out: '', err: 'no' } : runOf(world)(cmd, args, call))));
    expect(r).toMatchObject({ ok: true, how: expect.stringMatching(/handlers: averilab:\/\/shared\/open not read \(query-activities: exit 1 no\)$/) });
  });

  it('alive: the guard, get-state and pm path — no pull, no handlers', async () => {
    const alive = (androidLab({ settle }).need as Spec).alive;
    expect(await alive(needCtx())).toEqual({ ok: true, how: 'adb answers; the lab installed' });
    expect(world.calls).toEqual([`adb -s ${LAB_SERIAL} emu avd name`, `adb -s ${LAB_SERIAL} get-state`, `adb -s ${LAB_SERIAL} shell pm path dev.averi.lab`]);
    fresh({ installed: false });
    expect(await alive(needCtx())).toEqual({ ok: false, why: 'the lab APK is not installed (pm path)' });
    fresh({ reachable: false });
    expect(await alive(needCtx())).toEqual({ ok: false, why: 'adb get-state: exit 1 error: device offline' });
    expect(await alive(needCtx(runOf(world), null))).toMatchObject({ ok: false });
  });
});

describe('the handlers\' need: the counts a block expects (batch-11.sh:445: expected 2 and 1, else D55 skipped)', () => {
  it('as expected: met; one off: not met naming each; read again each time it is asked', async () => {
    const android = androidLab({ settle });
    const ok = android.handlersNeed({ 'averilab://shared/open': 2, 'averilab://cell/open': 1 }) as Spec;
    expect(await ok.check(needCtx())).toEqual({ ok: true, how: 'handlers as expected: averilab://shared/open 2, averilab://cell/open 1' });
    expect(await ok.alive(needCtx())).toEqual({ ok: true, how: 'handlers as expected: averilab://shared/open 2, averilab://cell/open 1' });
    const off = android.handlersNeed({ 'averilab://shared/open': 3, 'averilab://cell/open': 2 }) as Spec;
    expect(await off.check(needCtx())).toEqual({ ok: false, why: 'averilab://shared/open has 2 handler(s), 3 expected; averilab://cell/open has 1 handler(s), 2 expected' });
    expect(await off.check(needCtx(runOf(world), null))).toMatchObject({ ok: false });
  });
});

/** A block's ctx, recording its lines and windows. */
function blockCtx() {
  const events: string[] = [];
  const windows = new Map<string, WindowSpec>();
  const ctx = {
    id: 'D55',
    dir: join(dir, 'D55'),
    labDir: join(dir, 'lab'),
    config: config(),
    fs: nodeFs,
    knobs: {},
    bounded: runOf(world),
    step: (w: string, t: string) => void events.push(`${w} ${t}`),
    note: () => {},
    err: (t: string) => void events.push(`ERROR ${t}`),
    print: () => {},
    open: (name: string, spec: WindowSpec) => (windows.set(name, spec), void events.push(`open ${name}`)),
    close: (name: string) => (windows.delete(name), void events.push(`close ${name}`)),
    stopKept: async () => {},
    verdict: () => {},
    verdictLines: (lines: readonly string[]) => void events.push(...lines.map((l) => `verdict ${l}`)),
    restoreHand: () => {},
    verdictAndHand: (r: { line: string; hand: readonly string[] }) => void events.push(`verdict ${r.line}`, ...r.hand.map((h) => `hand ${h}`)),
    protectedLine: () => {},
    liveRun: async () => ({ live: { word: 'OK' as const, why: 'exit 0' } }),
    asksLive: () => {},
    asks: () => {},
    record: () => {},
  } satisfies BlockCtx;
  mkdirSync(ctx.dir, { recursive: true });
  return { ctx, events, windows };
}
async function emuOf(): Promise<LabEmu> {
  const r = await LabEmu.open(LAB_SERIAL, runOf(world), { settle });
  if (!r.ok) throw new Error(r.why);
  return r.emu;
}

describe('the tri-state reads around a block (batch-9: the role read was "Unknown command" — unread, never unchanged)', () => {
  it('API 33: both unread — WARN not compared, never OK; the work run between the reads, its result passed back', async () => {
    const { ctx, events } = blockCtx();
    const order: string[] = [];
    const r = await withReads(ctx, await emuOf(), { roles: 'D55 browser role', clipboard: 'D55 clipboard' }, async () => (order.push(`work after ${world.calls.length - 1} calls`), 'done'));
    expect(r).toBe('done');
    expect(order).toEqual(['work after 2 calls']);
    expect(events).toEqual([
      'verdict D55 browser role: WARN — not compared: before: exit 255 Unknown command: get-role-holders; after: exit 255 Unknown command: get-role-holders',
      'verdict D55 clipboard: WARN — not compared: before: the device has no such command: No shell command implementation.; after: the device has no such command: No shell command implementation.',
    ]);
  });

  it('read both times: unchanged OK, changed an ERROR naming both; a read not asked is not made', async () => {
    fresh({ roles: ['com.android.chrome', 'com.android.chrome'], clipboard: ['a', 'b'] });
    const { ctx, events } = blockCtx();
    await withReads(ctx, await emuOf(), { roles: 'D55 browser role' }, async () => {});
    await withReads(ctx, await emuOf(), { clipboard: 'D55 clipboard' }, async () => {});
    expect(events).toEqual(['verdict D55 browser role: OK — unchanged ("com.android.chrome")', 'verdict D55 clipboard: ERROR — CHANGED: "a" → "b"']);
    expect(world.calls.filter((c) => c.includes('cmd role'))).toHaveLength(2);
  });
});

describe('a tree kept: evidence in the block\'s folder, its fitness as a fixture said (lab-chooser.ts#sanitizeFixture)', () => {
  it('a fresh file each time; one holding a device path or the serial is kept but said unfit', () => {
    const { ctx, events } = blockCtx();
    expect(keepTree(ctx, 'resolver.xml', '<hierarchy/>', LAB_SERIAL)).toEqual({ path: join(ctx.dir, 'resolver.xml'), fit: true });
    expect(keepTree(ctx, 'resolver.xml', `<node text="${LAB_SERIAL}" path="/data/app/x"/>`, LAB_SERIAL)).toEqual({ path: join(ctx.dir, 'resolver-2.xml'), fit: false });
    expect(events).toEqual(['NOTE resolver.xml kept; fit as a fixture as it is', `NOTE resolver-2.xml kept; not fit as a fixture as it is (it holds /data/, ${LAB_SERIAL}): sanitise it before committing`]);
    expect(readFileSync(join(ctx.dir, 'resolver.xml'), 'utf8')).toBe('<hierarchy/>');
  });
});

describe('the probe\'s own state put back (S5\'s StateRestore: batch-11\'s `d55-b11.ts --restore`)', () => {
  const stateFile = () => join(dir, 'D55-state.json');
  const restoreOf = (stateCommand?: string) => probeRestore({ repo: join(dir, 'repo'), probe: '/probes/d55-b13.ts', args: ['--serial', LAB_SERIAL, '--apk', '/runs/lab/installed.apk'], stateFile: stateFile(), secs: 300, fs: nodeFs, stateCommand });

  it('a bounded child from the checkout; put back only when it exits 0 and its state file reads clean', async () => {
    const seen: { cmd: string; args: readonly string[]; secs?: number; cwd?: string }[] = [];
    const run: Run = async (cmd, args, call) => {
      seen.push({ cmd, args, secs: call?.secs, cwd: call?.cwd });
      writeFileSync(stateFile(), JSON.stringify({ dirty: false }));
      return { code: 0, timedOut: false, signal: null, out: '', err: '' };
    };
    expect(await restoreOf().restore(run)).toEqual({ ok: true, how: 'd55-b13.ts --restore: its state file clean' });
    expect(seen).toEqual([{ cmd: process.execPath, args: ['--import', 'tsx', '/probes/d55-b13.ts', '--restore', '--serial', LAB_SERIAL, '--apk', '/runs/lab/installed.apk', '--state', stateFile()], secs: 300, cwd: join(dir, 'repo') }]);
  });

  it('exit 0 with its state file still dirty, or a failed run: not put back, why', async () => {
    writeFileSync(stateFile(), JSON.stringify({ dirty: true }));
    expect(await restoreOf().restore(async () => ({ code: 0, timedOut: false, signal: null, out: '', err: '' }))).toEqual({ ok: false, why: 'd55-b13.ts --restore exited 0, but its state file is dirty' });
    expect(await restoreOf().restore(async () => ({ code: 3, timedOut: false, signal: null, out: '', err: 'no device' }))).toEqual({ ok: false, why: 'd55-b13.ts --restore: exit 3 no device' });
  });

  it('its command for a hand line, every word shell-quoted; the state command passed on', () => {
    expect(restoreOf().command).toBe(`node --import tsx /probes/d55-b13.ts --restore --serial ${LAB_SERIAL} --apk /runs/lab/installed.apk --state ${stateFile()}`);
    expect(restoreOf("node d55.ts --state 'x y'").stateCommand).toBe("node d55.ts --state 'x y'");
    expect('stateCommand' in restoreOf()).toBe(false);
  });
});

describe('the chooser\'s stretch (batch-11\'s D55, batch-12\'s E5): the window, the work, the cleanup\'s line and hand lines, the window closed', () => {
  it('a clean lab: the window opened with its cleanup label and block, the work, the cleanup OK, closed', async () => {
    const { ctx, events, windows } = blockCtx();
    let spec: WindowSpec | undefined;
    const c = await chooserStretch(ctx, await emuOf(), { apk: join(dir, 'lab', 'installed.apk'), catalog: join(dir, 'repo', 'fixtures', 'apps', 'cells.json'), dir: ctx.dir, accepted: [], progress: reinstallProgress(), stateFile: join(ctx.dir, 'state.json') }, async () => {
      spec = windows.get(CHOOSER_WINDOW);
      events.push('work');
    });
    expect(c.verdict).toBe('OK');
    expect(spec?.block).toBe('D55');
    expect(spec?.cleanup).toBe('D55 cleanup');
    expect(events).toEqual([`open ${CHOOSER_WINDOW}`, 'work', expect.stringMatching(/^verdict D55 cleanup: OK — /), `close ${CHOOSER_WINDOW}`]);
  });
});
