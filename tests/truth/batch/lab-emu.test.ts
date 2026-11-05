import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHOOSER_FOCUS_COMMAND } from '../../../src/adapters/android-chooser.js';
import { TIMED_OUT, type Call, type CallResult, type Run } from '../../../scripts/truth/batch/bounded.js';
import type { AcceptedEntry } from '../../../scripts/truth/batch/lab-chooser.js';
import {
  CELLS_ENTRY,
  chooserWindow,
  cleanUp,
  clearLabEntry,
  dismissChooser,
  freshApkOf,
  handlers,
  LabEmu,
  labInstalled,
  MAX_BACKS,
  readCheck,
  readClipboard,
  readRoleHolders,
  reinstallProgress,
  SETTLE_MS,
  tapSafely,
  UNZIP_SECS,
  type ReinstallOptions,
  type StateRestore,
} from '../../../scripts/truth/batch/lab-emu.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';

// scripts/truth/batch/lab-emu.ts over an emulator: a recording fake Run stands in for adb (the lab installed or not, its
// preferred block, the focus, the chooser's tree; uninstall and install changing them as API 33 does — an uninstall
// clears the lab's defaults, never a last-chosen entry: batch-11) and for unzip (the pulled APK's cells.json). Real
// files in a temp dir, through io.ts. Every call of every test is checked (afterEach) for what b11-dry's shims flagged
// as a VIOLATION, made exact: an adb call that names no serial or another one; an `input tap` inside an "Always" node of
// the last tree dumped; a `pm`, `settings`, `cmd` or `am` that writes, and an uninstall or install outside a reinstall's
// own steps. No device is touched.

const SERIAL = 'LAB-SERIAL';
const BATCH = join(import.meta.dirname, '..', '..', 'fixtures', 'batch');
const T4 = join(import.meta.dirname, '..', '..', 'fixtures');
const fixture = (name: string): string => readFileSync(join(BATCH, name), 'utf8');
const BLOCK = fixture('dumpsys-package-preferred-api33-b10.txt');
const CHOOSER_FOCUS = readFileSync(join(T4, 'dumpsys-window-focus-api33-b10-chooser.txt'), 'utf8');
const LAUNCHER_FOCUS = fixture('dumpsys-window-focus-api33-b10-launcher-no-header.txt');
const resolverXml = (selected = false): string => readFileSync(join(T4, `uiautomator-lab-resolver${selected ? '-selected' : ''}.xml`), 'utf8');
const CATALOG_TEXT = '{"cells":[{"id":"open"}]}\n';
const DEVICE_APK = '/data/app/~~HASH==/dev.averi.lab-HASH==/base.apk';

/** A lab entry in the block's own shape (lab-chooser.test.ts's; batch-12's analysis's words). */
const labEntry = (flag: 'true' | 'false' | 'none', authority = 'shared'): string =>
  [
    '      averilab:',
    '        9d3a2b9 dev.averi.lab/.Twin',
    `         mMatch=0x300000${flag === 'none' ? '' : ` mAlways=${flag}`}`,
    '          Selected from:',
    '            dev.averi.lab/.MainActivity',
    '            dev.averi.lab/.Twin',
    '          Action: "android.intent.action.VIEW"',
    '          Scheme: "averilab"',
    `          Authority: "${authority}": -1`,
  ].join('\n');
const SHARED_TWIN: AcceptedEntry = { authority: 'shared', component: /^dev\.averi\.lab\/\.Twin$/, why: "batch-11 E2's \"Just once\"" };

const ok = (out = ''): CallResult => ({ code: 0, timedOut: false, signal: null, out, err: '' });
const exit = (code: number, err = '', out = ''): CallResult => ({ code, timedOut: false, signal: null, out, err });
const timedOut: CallResult = { code: TIMED_OUT, timedOut: true, signal: 'SIGKILL', out: '', err: '' };

let dir: string;
const violations: string[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'batch-lab-emu-'));
  violations.length = 0;
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  expect(violations).toEqual([]);
});

type Rule = (words: readonly string[], cmd: string) => CallResult | undefined;

/** Every "Always" node's rect in a tree. */
type Box = [number, number, number, number];
/**
 * Every "Always" node's bounds in a dump, read from the XML itself — not by the module's own isAlways (T2 S5 review
 * round 1): a node whose resource-id ends in button_always, or whose text or content-desc holds "always", any case.
 */
function alwaysBoxes(xml: string): Box[] {
  const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
  return [...xml.matchAll(/<node\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((t) => /(^|\/)button_always$/.test(attr(t, 'resource-id')) || /always/i.test(attr(t, 'text')) || /always/i.test(attr(t, 'content-desc')))
    .map((t) => (/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attr(t, 'bounds')) ?? []).slice(1).map(Number) as Box);
}

/**
 * A fake lab emulator. `avd`: what `emu avd name` says; `installed`; `entries`: the lab's preferred entries (the
 * block's), `defaults` cleared by an uninstall, last-chosen kept; `chooser`: how many BACKs dismiss the one in front
 * (Infinity: none does; HOME always does); `tree`: what a dump prints; `reachable`: get-state's answer; `cells`: what
 * the APK the install puts there holds; `writes`: an uninstall or install is expected; `rules`: answers tried first.
 */
function fakeEmu(opts: { avd?: string; installed?: boolean; entries?: { flag: 'true' | 'false' | 'none'; authority?: string }[]; chooser?: number; tree?: string; reachable?: boolean; cells?: string; writes?: boolean; rules?: Rule[] } = {}) {
  const st = {
    installed: opts.installed ?? true,
    entries: [...(opts.entries ?? [])],
    chooser: opts.chooser ?? 0,
    reachable: opts.reachable ?? true,
    cells: opts.cells ?? CATALOG_TEXT,
    tree: opts.tree ?? resolverXml(),
    dumped: undefined as string | undefined,
  };
  const calls: { cmd: string; args: readonly string[]; call: Call | undefined }[] = [];
  const taps: string[] = [];
  const run: Run = async (cmd, args, call) => {
    calls.push({ cmd, args, call });
    if (cmd === 'unzip') {
      if (args[0] !== '-p' || args[2] !== 'assets/cells.json') throw new Error(`no answer for unzip ${args.join(' ')}`);
      return existsSync(args[1]) ? ok(readFileSync(args[1], 'utf8')) : exit(9, `unzip: cannot find ${args[1]}`);
    }
    if (cmd !== 'adb') throw new Error(`no answer for ${cmd} ${args.join(' ')}`);
    if (args[0] !== '-s' || args[1] !== SERIAL) violations.push(`adb not on the lab serial: ${args.join(' ')}`);
    const words = args.slice(2);
    const said = words.join(' ');
    if (/^shell (pm (?!path )|settings (?!get )|cmd (?!package query-activities |role get-role-holders |clipboard help$)|am )/.test(said)) violations.push(`a write: ${said}`);
    if ((words[0] === 'uninstall' || words[0] === 'install') && opts.writes !== true) violations.push(`an ${words[0]} outside a reinstall: ${said}`);
    if (words[0] === 'shell' && words[1] === 'input' && words[2] === 'tap') {
      const [x, y] = [Number(words[3]), Number(words[4])];
      taps.push(`${x},${y}`);
      if (st.dumped === undefined) violations.push(`a tap with no tree dumped: ${said}`);
      for (const [l, t, r, b] of alwaysBoxes(st.dumped ?? '')) if (x >= l && x < r && y >= t && y < b) violations.push(`input tap inside "Always": ${said}`);
    }
    for (const rule of opts.rules ?? []) {
      const r = rule(words, cmd);
      if (r !== undefined) return r;
    }
    if (said === 'emu avd name') return opts.avd === undefined ? ok(fixture('emu-avd-name-api33-b10.txt')) : ok(`${opts.avd}\r\nOK\r\n`);
    if (!st.reachable) return exit(1, 'error: no devices/emulators found');
    if (said === 'get-state') return ok('device\n');
    if (said === `shell ${CHOOSER_FOCUS_COMMAND}`) return ok(st.chooser > 0 ? CHOOSER_FOCUS : LAUNCHER_FOCUS);
    if (said === 'shell dumpsys package preferred') return ok(BLOCK.replace('  Schemes:\n', `  Schemes:\n${st.entries.map((e) => labEntry(e.flag, e.authority)).join('\n')}${st.entries.length ? '\n' : ''}`));
    if (said === 'shell input keyevent KEYCODE_BACK') {
      if (st.chooser > 0) st.chooser--;
      return ok();
    }
    if (said === 'shell input keyevent KEYCODE_HOME') {
      st.chooser = 0;
      return ok();
    }
    if (said === 'shell pm path dev.averi.lab') return st.installed ? ok(`package:${DEVICE_APK}\n`) : exit(1);
    if (said === 'uninstall dev.averi.lab') {
      st.installed = false;
      st.entries = st.entries.filter((e) => e.flag === 'false');
      return ok('Success\n');
    }
    if (words[0] === 'install' && words.length === 2) {
      if (!existsSync(words[1])) return exit(1, `adb: failed to stat ${words[1]}: No such file or directory`);
      st.installed = true;
      return ok('Performing Streamed Install\nSuccess\n');
    }
    if (words[0] === 'pull' && words[1] === DEVICE_APK) {
      writeFileSync(words[2], st.cells, { flag: 'wx' });
      return ok(`${words[1]}: 1 file pulled.\n`);
    }
    if (said === 'exec-out uiautomator dump /dev/tty') {
      st.dumped = st.tree;
      return ok(`${st.tree}UI hierchary dumped to: /dev/tty\n`);
    }
    if (words[0] === 'shell' && words[1] === 'input' && words[2] === 'tap') return ok();
    if (said === 'shell cmd clipboard help') return ok(fixture('clipboard-help-api33-b9.txt'));
    if (said === 'shell cmd role get-role-holders android.app.role.BROWSER') return exit(255, '', fixture('role-holders-api33-b9-unknown-command.txt'));
    if (said === "shell cmd package query-activities --brief -a android.intent.action.VIEW -d averilab://shared/open") return ok(fixture('query-activities-api33-b10-shared.txt'));
    throw new Error(`no answer for adb ${said}`);
  };
  /** Each adb call's words after `-s <serial>`. */
  const words = () => calls.filter((c) => c.cmd === 'adb').map((c) => c.args.slice(2).join(' '));
  return { run, calls, st, taps, words };
}

/** The guarded lab emulator over a fake, with no wait after a key. */
async function emuOf(fake: { run: Run }): Promise<LabEmu> {
  const opened = await LabEmu.open(SERIAL, fake.run, { settle: async () => {} });
  if (!opened.ok) throw new Error(opened.why);
  return opened.emu;
}

/** The pulled APK (a text file standing in: the fake's unzip reads it whole), main's catalog, a probe state (null: none). */
function files(state: unknown = { dirty: false, serial: SERIAL, before: { running: false, stateFile: null } }): ReinstallOptions {
  const apk = join(dir, 'installed.apk');
  writeFileSync(apk, CATALOG_TEXT);
  const catalog = join(dir, 'cells.json');
  writeFileSync(catalog, CATALOG_TEXT);
  const stateFile = join(dir, 'state.json');
  if (state !== null) writeFileSync(stateFile, typeof state === 'string' ? state : JSON.stringify(state));
  return { apk, catalog, stateFile, dir, accepted: [SHARED_TWIN], progress: reinstallProgress() };
}
/** The probe's state restore as the batch hands it in: its call, and its command for a RESTORE line. */
const RESTORE_CMD = 'node --import tsx d55-probe.ts --restore --serial LAB-SERIAL --state state.json';
const STATE_CMD = 'node --import tsx d55-probe.ts --state state.json';
const restoreOf = (restore: StateRestore['restore']): StateRestore => ({ restore, command: RESTORE_CMD, stateCommand: STATE_CMD });
const readState = (o: ReinstallOptions) => JSON.parse(readFileSync(o.stateFile, 'utf8')) as { dirty: boolean };

describe("LabEmu.open — lab-device.ts's Android guard before any other call (batch-11.sh's android_guard)", () => {
  it("batch-10's `emu avd name` (averi_lab, CRLF and OK after it): the lab emulator; its calls all name its serial", async () => {
    const fake = fakeEmu();
    const emu = await emuOf(fake);
    expect(emu.serial).toBe(SERIAL);
    expect(fake.words()).toEqual(['emu avd name']);
  });

  it('another AVD, or no emulator adb can name, is refused after that one read: nothing else is called', async () => {
    const other = fakeEmu({ avd: 'Pixel_3a' });
    expect(await LabEmu.open(SERIAL, other.run)).toEqual({ ok: false, why: `the lab guard refused ${SERIAL} (nothing was done to it): ${SERIAL} is AVD "Pixel_3a", not the lab's averi_lab: refused` });
    expect(other.words()).toEqual(['emu avd name']);
    const none = fakeEmu({ rules: [(w) => (w.join(' ') === 'emu avd name' ? exit(1, 'error: no emulator') : undefined)] });
    expect(await LabEmu.open(SERIAL, none.run)).toEqual({ ok: false, why: `the lab guard refused ${SERIAL} (nothing was done to it): ${SERIAL} is no emulator adb can name, not the lab's averi_lab: refused` });
  });

  it('`using` keeps the guarded emulator over another Run, which then gets every call; no guard again', async () => {
    const first = fakeEmu();
    const emu = await emuOf(first);
    const second = fakeEmu();
    await readCheck(emu.using(second.run), []);
    expect(second.words()).toEqual([`shell ${CHOOSER_FOCUS_COMMAND}`, 'shell dumpsys package preferred']);
    expect(first.words()).toEqual(['emu avd name']);
    expect(emu.using(second.run).run).toBe(second.run);
  });
});

describe("readCheck — --check, read only (d55-b11.ts --check; batch-12's e5_check)", () => {
  it("the focus by src's CHOOSER_FOCUS_COMMAND (one word, its pipe for the device's sh), the block by `dumpsys package preferred`", async () => {
    const fake = fakeEmu();
    const c = await readCheck(await emuOf(fake), []);
    expect(c.exit).toBe(0);
    expect(c.line).toBe('D55 check: OK — chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)');
    expect(fake.calls.find((x) => x.args.includes(CHOOSER_FOCUS_COMMAND))?.args).toEqual(['-s', SERIAL, 'shell', CHOOSER_FOCUS_COMMAND]);
  });

  it('a chooser up: 4; a default: 1; the accepted last-chosen entry: 5; a read that fails: 3', async () => {
    expect((await readCheck(await emuOf(fakeEmu({ chooser: 1 })), [])).exit).toBe(4);
    expect((await readCheck(await emuOf(fakeEmu({ entries: [{ flag: 'true' }] })), [])).exit).toBe(1);
    expect((await readCheck(await emuOf(fakeEmu({ entries: [{ flag: 'false' }] })), [SHARED_TWIN])).exit).toBe(5);
    const failing = fakeEmu({ rules: [(w) => (w.join(' ') === 'shell dumpsys package preferred' ? timedOut : undefined)] });
    expect((await readCheck(await emuOf(failing), [])).exit).toBe(3);
  });
});

describe('dismissChooser — BACK while a chooser is in front, at most 3, then HOME (d55-b11.ts restore, batch-12 on_abort)', () => {
  it('one BACK per chooser read, then HOME, each followed by its settle wait', async () => {
    const fake = fakeEmu({ chooser: 2 });
    const waits: number[] = [];
    const opened = await LabEmu.open(SERIAL, fake.run, { settle: async (ms) => void waits.push(ms) });
    if (!opened.ok) throw new Error(opened.why);
    expect(await dismissChooser(opened.emu)).toEqual({ backs: 2 });
    expect(fake.words().filter((w) => w.startsWith('shell input'))).toEqual(['shell input keyevent KEYCODE_BACK', 'shell input keyevent KEYCODE_BACK', 'shell input keyevent KEYCODE_HOME']);
    expect(waits).toEqual([SETTLE_MS, SETTLE_MS, SETTLE_MS]);
  });

  it('a chooser BACK does not dismiss: MAX_BACKS presses, then HOME; none up: HOME alone; an unread focus is no chooser to press BACK for', async () => {
    const stuck = fakeEmu({ chooser: Infinity });
    expect(await dismissChooser(await emuOf(stuck))).toEqual({ backs: MAX_BACKS });
    expect(stuck.words().filter((w) => w.endsWith('KEYCODE_HOME'))).toHaveLength(1);
    const none = fakeEmu();
    expect(await dismissChooser(await emuOf(none))).toEqual({ backs: 0 });
    const unread = fakeEmu({ chooser: 1, rules: [(w) => (w[1] === CHOOSER_FOCUS_COMMAND ? exit(1) : undefined)] });
    expect(await dismissChooser(await emuOf(unread))).toEqual({ backs: 0 });
  });
});

describe('labInstalled — `adb get-state` first: unreachable is unknown, never "missing" (batch-12.sh, e5_installed)', () => {
  it('installed with its path; missing on `pm path` exit 1 with nothing said', async () => {
    expect(await labInstalled(await emuOf(fakeEmu()))).toEqual({ state: 'installed', path: DEVICE_APK });
    expect(await labInstalled(await emuOf(fakeEmu({ installed: false })))).toEqual({ state: 'missing' });
  });

  it('get-state failing: unknown, and `pm path` is never asked', async () => {
    const fake = fakeEmu();
    const emu = await emuOf(fake);
    fake.st.reachable = false;
    expect(await labInstalled(emu)).toEqual({ state: 'unknown', why: 'adb get-state: exit 1 error: no devices/emulators found' });
    expect(fake.words().some((w) => w.includes('pm path'))).toBe(false);
  });

  it('get-state saying offline is unknown too; pm path past its bound, unknown', async () => {
    const offline = fakeEmu({ rules: [(w) => (w[0] === 'get-state' ? ok('offline\n') : undefined)] });
    expect(await labInstalled(await emuOf(offline))).toEqual({ state: 'unknown', why: 'adb get-state: offline, not device' });
    const slow = fakeEmu({ rules: [(w) => (w[1] === 'pm' ? timedOut : undefined)] });
    expect(await labInstalled(await emuOf(slow))).toEqual({ state: 'unknown', why: `pm path: past its bound (exit ${TIMED_OUT})` });
  });
});

describe('readRoleHolders, readClipboard and handlers — the tri-state reads over the device (batch-9 D55 and D43; batch-11.sh, handlers)', () => {
  it("API 33's role holder and clipboard reads are unread, never unchanged; averilab://shared/open has 2 handlers", async () => {
    const emu = await emuOf(fakeEmu());
    expect(await readRoleHolders(emu)).toEqual({ state: 'unread', why: 'exit 255 Unknown command: get-role-holders' });
    expect(await readClipboard(emu)).toEqual({ state: 'unread', why: 'the device has no such command: No shell command implementation.' });
    expect(await handlers(emu, 'averilab://shared/open')).toBe(2);
  });
});

describe('tapSafely — the one tap a batch makes on the chooser, at safeTap\'s point only, never "Always" (batch-11 E2, batch-12 E5 d)', () => {
  it("batch-11's row tap: the twin row at (540, 1881), then \"Just once\" once enabled at (723, 2058)", async () => {
    const fake = fakeEmu({ chooser: 1 });
    const emu = await emuOf(fake);
    expect(await tapSafely(emu, { row: 'AveriLab twin' })).toEqual({ tapped: true, point: { x: 540, y: 1881 }, why: 'row 2 ("AveriLab", "AveriLab twin") at (540, 1881)' });
    fake.st.tree = resolverXml(true);
    expect(await tapSafely(emu, 'once')).toEqual({ tapped: true, point: { x: 723, y: 2058 }, why: 'button_once ("Just once") at (723, 2058)' });
    expect(fake.taps).toEqual(['540,1881', '723,2058']);
  });

  it('refused, nothing tapped: "Just once" disabled, a point on "Always", a row no label names uniquely', async () => {
    const fake = fakeEmu({ chooser: 1 });
    const emu = await emuOf(fake);
    expect(await tapSafely(emu, 'once')).toEqual({ tapped: false, refusal: 'disabled', why: 'button_once ("Just once") is disabled' });
    fake.st.tree = resolverXml(true);
    expect(await tapSafely(emu, 'once', { x: 936, y: 2058 })).toMatchObject({ tapped: false, refusal: 'outside' });
    expect(await tapSafely(emu, { row: 'AveriLab' })).toMatchObject({ tapped: false, refusal: 'not-unique' });
    expect(fake.taps).toEqual([]);
  });

  it('a dump that fails or holds no tree taps nothing; a tap adb refuses is said, never "tapped"', async () => {
    const failing = fakeEmu({ rules: [(w) => (w[1] === 'uiautomator' ? exit(137, 'Killed') : undefined)] });
    expect(await tapSafely(await emuOf(failing), { row: 2 })).toEqual({ tapped: false, refusal: 'no-tree', why: 'uiautomator dump: exit 137 Killed' });
    const empty = fakeEmu({ tree: 'null root node returned by UiTestAutomationBridge.\n' });
    expect(await tapSafely(await emuOf(empty), { row: 2 })).toMatchObject({ tapped: false, refusal: 'no-tree' });
    const refusedTap = fakeEmu({ rules: [(w) => (w[2] === 'tap' ? exit(1, 'error: closed') : undefined)] });
    expect(await tapSafely(await emuOf(refusedTap), { row: 2 })).toEqual({ tapped: false, refusal: 'not-sent', why: 'input tap: exit 1 error: closed' });
    expect(empty.taps).toEqual([]);
  });
});

describe('clearLabEntry — the abort-safe reinstall that clears a lab default (batch-11.sh d55_reinstall, `pm path` after)', () => {
  it("BACK/HOME, the state marked dirty BEFORE the uninstall, uninstall, install of the pulled APK, `pm path`, its cells.json the catalog's, --check: proven", async () => {
    const o = files();
    let dirtyAtUninstall: boolean | undefined;
    const fake = fakeEmu({ chooser: 1, entries: [{ flag: 'true' }], writes: true, rules: [(w) => void (w[0] === 'uninstall' && (dirtyAtUninstall = readState(o).dirty))] });
    const r = await clearLabEntry(await emuOf(fake), o);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) throw new Error(r.why);
    expect(r.how).toBe(
      `uninstalled and reinstalled from ${o.apk} (pm path ${DEVICE_APK}; its ${CELLS_ENTRY} the catalog's); D55 check: OK — chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)`,
    );
    expect(dirtyAtUninstall).toBe(true);
    expect(o.progress.step).toBe('proven');
    const order = fake.words().filter((w) => /KEYCODE_|^uninstall|^install|pm path|^pull/.test(w));
    expect(order).toEqual(['shell input keyevent KEYCODE_BACK', 'shell input keyevent KEYCODE_HOME', 'uninstall dev.averi.lab', `install ${o.apk}`, 'shell pm path dev.averi.lab', `pull ${DEVICE_APK} ${join(dir, 'reinstalled.apk')}`]);
    // The lab's data is wiped: the state stays dirty until the probe's own restore has put it back.
    expect(readState(o).dirty).toBe(true);
  });

  it('install and uninstall by the install bound (boundFor: no secs given), unzip by UNZIP_SECS', async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    await clearLabEntry(await emuOf(fake), o);
    expect(fake.calls.filter((c) => /^(un)?install$/.test(c.args[2] ?? '')).map((c) => c.call)).toEqual([undefined, undefined]);
    expect(fake.calls.find((c) => c.cmd === 'unzip')?.call).toEqual({ secs: UNZIP_SECS });
  });

  it("the probe's state put back only after the proof, through the emulator's Run; its failure is the result's", async () => {
    const o = files();
    const seen: string[] = [];
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    const emu = await emuOf(fake);
    o.putBack = restoreOf(async (run) => {
      seen.push(`${o.progress.step} ${run === emu.run}`);
      return { ok: true, how: 'D55 restore: OK — the state file put back' };
    });
    const r = await clearLabEntry(emu, o);
    expect(seen).toEqual(['proven true']);
    expect(r).toMatchObject({ ok: true, how: expect.stringMatching(/; D55 restore: OK — the state file put back$/) });
    const o3 = files();
    // Its failure with no hand line of its own: the RESTORE line names its command (T2 S5 review round 1).
    o3.putBack = restoreOf(async () => ({ ok: false, why: 'D55 restore: NOT VERIFIED — no hand given' }));
    expect(await clearLabEntry(await emuOf(fakeEmu({ entries: [{ flag: 'true' }], writes: true })), o3)).toEqual({ ok: false, why: "reinstalled and proven, but the lab's state not put back: D55 restore: NOT VERIFIED — no hand given", hand: [`D55 (Android): the lab's state not put back: ${RESTORE_CMD}`] });
    const o2 = files();
    o2.putBack = restoreOf(async () => ({ ok: false, why: 'D55 restore: NOT VERIFIED — read back 0 bytes', hand: ['by hand: the probe --restore'] }));
    expect(await clearLabEntry(await emuOf(fakeEmu({ entries: [{ flag: 'true' }], writes: true })), o2)).toEqual({ ok: false, why: "reinstalled and proven, but the lab's state not put back: D55 restore: NOT VERIFIED — read back 0 bytes", hand: ['by hand: the probe --restore'] });
  });

  it('refused, nothing done: no pulled APK, a catalog that cannot be read, a state file that cannot be marked dirty', async () => {
    const noApk = files();
    rmSync(noApk.apk);
    const fake = fakeEmu({ entries: [{ flag: 'true' }] });
    const emu = await emuOf(fake);
    expect(await clearLabEntry(emu, noApk)).toMatchObject({ ok: false, why: `no pulled APK at ${noApk.apk} to reinstall — nothing done` });
    const noCatalog = { ...files(), catalog: join(dir, 'none.json') };
    expect(await clearLabEntry(emu, noCatalog)).toMatchObject({ ok: false, why: `the catalog ${noCatalog.catalog} cannot be read, so a reinstall could not be proven — nothing done` });
    const unreadable = files('{not json');
    expect(await clearLabEntry(emu, unreadable)).toMatchObject({ ok: false, why: `the state file ${unreadable.stateFile} cannot be marked dirty (unreadable) — nothing done` });
    expect(fake.words()).toEqual(['emu avd name']);
    expect(unreadable.progress.step).toBe('not started');
  });

  it("a state file that cannot be replaced (its folder read-only): the error said, nothing done", async () => {
    const o = files();
    chmodSync(dir, 0o555);
    try {
      const fake = fakeEmu({ entries: [{ flag: 'true' }] });
      const r = await clearLabEntry(await emuOf(fake), o);
      expect(r).toMatchObject({ ok: false, why: expect.stringMatching(/^the state file .* cannot be marked dirty \(EACCES: permission denied, open .*\) — nothing done$/) });
      expect(fake.words()).toEqual(['emu avd name']);
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('no probe state to mark dirty: refused, nothing uninstalled — the protocol needs its dirty mark first (T2 S5 code review)', async () => {
    const o = files(null);
    const fake = fakeEmu({ entries: [{ flag: 'true' }] });
    const r = await clearLabEntry(await emuOf(fake), { ...o, putBack: restoreOf(async () => ({ ok: true, how: 'never asked' })) });
    expect(r).toEqual({
      ok: false,
      why: `the state file ${o.stateFile} cannot be marked dirty (missing) — nothing done`,
      hand: [`D55 (Android): no reinstall was done: the probe's state file ${o.stateFile} was not marked dirty (missing); run ${STATE_CMD} first, then clear the default by hand: adb -s ${SERIAL} uninstall dev.averi.lab && adb -s ${SERIAL} install ${o.apk}`],
    });
    expect(fake.words()).toEqual(['emu avd name']);
  });

  it('the install fails and the lab is gone: not proven, its hand line the install of the pulled APK', async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'install' ? exit(1, 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]') : undefined)] });
    expect(await clearLabEntry(await emuOf(fake), o)).toEqual({
      ok: false,
      why: 'the reinstall not proven: after the install (exit 1 Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]); the lab is NOT installed',
      hand: [`D55 (Android): the lab APK is NOT installed: adb -s ${SERIAL} install ${o.apk}; then: adb -s ${SERIAL} shell dumpsys package preferred`],
    });
    expect(o.progress.step).toBe('started');
  });

  it("adb gone after the install: unknown — never \"missing\", never \"put back\" — its hand line `pm path` first (b11-dry int-reinstall-noadb)", async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'get-state' ? exit(1, 'error: device offline') : undefined)] });
    const r = await clearLabEntry(await emuOf(fake), o);
    expect(r).toEqual({
      ok: false,
      why: 'the reinstall not proven: after the install (exit 0); whether the lab is installed is unknown (adb get-state: exit 1 error: device offline)',
      hand: [
        `D55 (Android): whether the lab is installed is unknown (interrupted during its reinstall, adb unreachable): once adb answers, adb -s ${SERIAL} get-state (device), then adb -s ${SERIAL} shell pm path dev.averi.lab; if it prints nothing, adb -s ${SERIAL} install ${o.apk}; then: adb -s ${SERIAL} shell dumpsys package preferred`,
      ],
    });
  });

  it("the reinstalled APK not main's (its cells.json another), not pulled, or its cells.json not read: not proven", async () => {
    const other = files();
    expect(await clearLabEntry(await emuOf(fakeEmu({ entries: [{ flag: 'true' }], writes: true, cells: '{"cells":[]}\n' })), other)).toMatchObject({
      ok: false,
      why: `the reinstall not proven: the reinstalled APK's ${CELLS_ENTRY} is not the catalog's ${other.catalog}; the lab is installed`,
      // The hand line names the step that failed (T2 S5 review round 1).
      hand: [
        `D55 (Android): the installed lab not proven the pulled APK (the reinstalled APK's assets/cells.json is not the catalog's ${other.catalog}): adb -s ${SERIAL} shell pm path dev.averi.lab, adb -s ${SERIAL} pull <that path> <a file>, unzip -p <that file> assets/cells.json must equal ${other.catalog}; if not, adb -s ${SERIAL} uninstall dev.averi.lab && adb -s ${SERIAL} install ${other.apk}; then: adb -s ${SERIAL} shell dumpsys package preferred`,
      ],
    });
    const notPulled = files();
    expect(await clearLabEntry(await emuOf(fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'pull' ? exit(1, 'adb: error: failed to stat') : undefined)] })), notPulled)).toMatchObject({
      ok: false,
      why: 'the reinstall not proven: the reinstalled APK not pulled (exit 1 adb: error: failed to stat); the lab is installed',
      hand: [expect.stringMatching(/^D55 \(Android\): the installed lab not proven the pulled APK \(the reinstalled APK not pulled \(exit 1/)],
    });
    // A pull that fails is no pull, whatever it left behind (T2 S5 mutation round).
    const partial = files();
    const partly = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'pull' ? (writeFileSync(w[2], '{"cel'), exit(1, 'adb: error: connection reset')) : undefined)] });
    expect(await clearLabEntry(await emuOf(partly), partial)).toMatchObject({ ok: false, why: 'the reinstall not proven: the reinstalled APK not pulled (exit 1 adb: error: connection reset); the lab is installed' });
    const noFile = files();
    expect(await clearLabEntry(await emuOf(fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'pull' ? ok('pulled') : undefined)] })), noFile)).toMatchObject({
      ok: false,
      why: 'the reinstall not proven: the reinstalled APK not pulled (exit 0 but no file); the lab is installed',
    });
    const badZip = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    const run: Run = async (cmd, args, call) => (cmd === 'unzip' ? exit(9, 'End-of-central-directory signature not found.') : fake.run(cmd, args, call));
    expect(await clearLabEntry(await emuOf({ run }), badZip)).toMatchObject({
      ok: false,
      why: `the reinstall not proven: ${CELLS_ENTRY} not read from the reinstalled APK (unzip: exit 9 End-of-central-directory signature not found.); the lab is installed`,
      hand: [expect.stringMatching(/^D55 \(Android\): the installed lab not proven the pulled APK \(assets\/cells\.json not read/)],
    });
  });

  it('a pulled APK is a fresh file, never overwritten: a second reinstall pulls reinstalled-2.apk', async () => {
    const o = files();
    writeFileSync(join(dir, 'reinstalled.apk'), 'an earlier run');
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    expect(await clearLabEntry(await emuOf(fake), o)).toMatchObject({ ok: true });
    expect(readFileSync(join(dir, 'reinstalled.apk'), 'utf8')).toBe('an earlier run');
    expect(fake.words()).toContain(`pull ${DEVICE_APK} ${join(dir, 'reinstalled-2.apk')}`);
    writeFileSync(join(dir, 'reinstalled-2.apk'), 'x');
    expect(freshApkOf(nodeFs, dir)).toBe(join(dir, 'reinstalled-3.apk'));
  });

  it('the default still listed after the reinstall, or the check unproven after it: not proven', async () => {
    const o = files();
    const sticky = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'uninstall' ? ok('Success\n') : undefined)] });
    expect(await clearLabEntry(await emuOf(sticky), o)).toMatchObject({ ok: false, why: expect.stringMatching(/^the reinstall not proven: after the reinstall, D55 check: FAIL — .*; the lab is installed$/), hand: [expect.stringMatching(/^D55 \(Android\): a lab default/)] });
    const unread = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    const emu = await emuOf(unread);
    let reinstalled = false;
    const run: Run = async (cmd, args, call) => {
      if (args[2] === 'install') reinstalled = true;
      return reinstalled && args.join(' ').endsWith('dumpsys package preferred') ? exit(1) : unread.run(cmd, args, call);
    };
    expect(await clearLabEntry(emu.using(run), files())).toMatchObject({ ok: false, why: expect.stringMatching(/^the reinstall not proven: after the reinstall, D55 check: ERROR — /), hand: [expect.stringMatching(/^D55 \(Android\): the chooser and the preferred activities not proven/)] });
  });

  it('a last-chosen entry not accepted left after the reinstall (exit 6) is no default: proven (hand mutant)', async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }, { flag: 'false', authority: 'pair' }], writes: true });
    expect(await clearLabEntry(await emuOf(fake), o)).toMatchObject({ ok: true, check: { exit: 6 } });
    expect(o.progress.step).toBe('proven');
  });

  it("a chooser that stays over a preferred read that fails (exit 4) proves nothing: not proven, never \"cleared\" (T2 S5 review round 1, its repro)", async () => {
    const o = files();
    let reinstalled = false;
    const fake = fakeEmu({
      chooser: Infinity,
      entries: [{ flag: 'true' }],
      writes: true,
      rules: [
        (w) => (w.join(' ').endsWith('KEYCODE_HOME') ? ok() : undefined),
        (w) => void (w[0] === 'install' && (reinstalled = true)),
        (w) => (reinstalled && w.join(' ') === 'shell dumpsys package preferred' ? exit(1, 'boom') : undefined),
      ],
    });
    const r = await clearLabEntry(await emuOf(fake), o);
    expect(r).toEqual({
      ok: false,
      why: 'the reinstall not proven: after the reinstall, D55 check: ERROR — chooser yes (android/com.android.internal.app.ResolverActivity); preferred unread (dumpsys package preferred: exit 1 boom); the lab is installed',
      hand: [`D55 (Android): the chooser and the preferred activities not proven put back: adb -s ${SERIAL} shell dumpsys package preferred (no lab entry with mAlways=true may be left); a chooser in front: adb -s ${SERIAL} shell input keyevent KEYCODE_BACK`],
    });
    expect(o.progress.step).toBe('started');
    expect(readState(o).dirty).toBe(true);
  });

  it('the uninstall refused: not proven, the lab still installed with its default — its hand line the uninstall again', async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'uninstall' ? exit(1, 'Failure [DELETE_FAILED_INTERNAL_ERROR]') : undefined)] });
    expect(await clearLabEntry(await emuOf(fake), o)).toEqual({
      ok: false,
      why: 'the reinstall not proven: the uninstall failed (exit 1 Failure [DELETE_FAILED_INTERNAL_ERROR]); the lab is installed',
      hand: [expect.stringContaining(`adb -s ${SERIAL} uninstall dev.averi.lab && adb -s ${SERIAL} install ${o.apk}`)],
    });
    expect(fake.words()).not.toContain(`install ${o.apk}`);
    // The uninstall failing with adb gone after it: unknown, its hand line `pm path` first (mutation round).
    const gone = fakeEmu({ entries: [{ flag: 'true' }], writes: true, rules: [(w) => (w[0] === 'uninstall' ? exit(1, 'error: closed') : w[0] === 'get-state' ? exit(1, 'error: closed') : undefined)] });
    expect(await clearLabEntry(await emuOf(gone), files())).toMatchObject({ ok: false, hand: [expect.stringMatching(/^D55 \(Android\): whether the lab is installed is unknown/)] });
  });
});

describe("cleanUp — the block's cleanup by --check's exit (batch-11.sh:539–583; batch-12's e5_check)", () => {
  it('0: OK, nothing reinstalled, no hand line', async () => {
    const fake = fakeEmu();
    const c = await cleanUp(await emuOf(fake), files());
    expect(c).toMatchObject({ verdict: 'OK', line: 'D55 cleanup: OK — chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)', hand: [] });
  });

  it("5, the accepted last-chosen entry: OK, never \"cleared\" by a reinstall (batch-12 fixed batch-11's defect 1/2)", async () => {
    const fake = fakeEmu({ entries: [{ flag: 'false' }] });
    const c = await cleanUp(await emuOf(fake), files());
    expect(c).toMatchObject({ verdict: 'OK', hand: [] });
    expect(c.line).toMatch(/^D55 cleanup: OK — chooser no; preferred read \(1 user\); lab entries 1 \(defaults 0, last-chosen 1, accepted 1\); first: /);
  });

  it('6, a last-chosen entry not accepted: a WARN, no RESTORE line, no reinstall tried', async () => {
    const fake = fakeEmu({ entries: [{ flag: 'false', authority: 'pair' }] });
    const c = await cleanUp(await emuOf(fake), files());
    expect(c.verdict).toBe('WARN');
    expect(c.line).toMatch(/^D55 cleanup: WARN — a last-chosen entry not accepted \(mAlways=false: no default; no reinstall clears it, so none is tried — no RESTORE\): chooser no; /);
    expect(c.hand).toEqual([]);
  });

  it("1, a lab default: FAIL even after a clean reinstall cleared it (b11-dry d55-left; review round 1's FAIL-naming)", async () => {
    const o = files();
    const fake = fakeEmu({ entries: [{ flag: 'true' }], writes: true });
    const c = await cleanUp(await emuOf(fake), o);
    expect(c.verdict).toBe('FAIL');
    expect(c.line).toMatch(/^D55 cleanup: FAIL — a lab default \(mAlways=true\) is set — "Always" is never tapped, so it predates the batch or is a defect: chooser no; .*; cleared: uninstalled and reinstalled from /);
    expect(c.hand).toEqual([]);
    expect(fake.st.entries).toEqual([]);
  });

  it('1 with the reinstall not proven: FAIL, NOT cleared, its hand lines', async () => {
    const o = files();
    rmSync(o.apk);
    const c = await cleanUp(await emuOf(fakeEmu({ entries: [{ flag: 'true' }] })), o);
    expect(c.verdict).toBe('FAIL');
    expect(c.line).toContain(`; NOT cleared: no pulled APK at ${o.apk} to reinstall — nothing done`);
    expect(c.hand).toEqual([`D55 (Android): a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: adb -s ${SERIAL} uninstall dev.averi.lab && adb -s ${SERIAL} install ${o.apk} (clears it; wipes the lab's data); then: adb -s ${SERIAL} shell dumpsys package preferred`]);
  });

  it('4: BACK and HOME, --check once more — a chooser gone is OK; one that stays is ERROR with its hand line', async () => {
    const gone = fakeEmu({ chooser: 1 });
    expect((await cleanUp(await emuOf(gone), files())).verdict).toBe('OK');
    // --check, the dismissal's two reads (chooser, then gone), --check again.
    expect(gone.words().filter((w) => w.includes(CHOOSER_FOCUS_COMMAND))).toHaveLength(4);
    const stays = fakeEmu({ chooser: Infinity, rules: [(w) => (w.join(' ').endsWith('KEYCODE_HOME') ? ok() : undefined)] });
    const c = await cleanUp(await emuOf(stays), files());
    expect(c).toMatchObject({ verdict: 'ERROR', hand: [`D55 (Android): the chooser and the preferred activities not proven put back: adb -s ${SERIAL} shell dumpsys package preferred (no lab entry with mAlways=true may be left); a chooser in front: adb -s ${SERIAL} shell input keyevent KEYCODE_BACK`] });
    expect(c.line).toMatch(/^D55 cleanup: ERROR — the chooser is still in front after BACK and HOME: chooser yes /);
  });

  it('an entry with no mAlways line: ERROR, unproven, its hand line the check — never a reinstall (T2 S5 code review)', async () => {
    const fake = fakeEmu({ entries: [{ flag: 'none' }] });
    const c = await cleanUp(await emuOf(fake), files());
    expect(c.verdict).toBe('ERROR');
    expect(c.line).toMatch(/^D55 cleanup: ERROR — the preferred activities or the focus not proven clean: .*no mAlways 1/);
    expect(c.hand).toEqual([expect.stringMatching(/^D55 \(Android\): the chooser and the preferred activities not proven put back/)]);
    expect(fake.words().some((w) => /^(un)?install/.test(w))).toBe(false);
  });

  it('3: ERROR, not proven clean, with its hand line', async () => {
    const fake = fakeEmu({ rules: [(w) => (w.join(' ') === 'shell dumpsys package preferred' ? exit(1, 'error: closed') : undefined)] });
    const c = await cleanUp(await emuOf(fake), files());
    expect(c.line).toBe('D55 cleanup: ERROR — the preferred activities or the focus not proven clean: chooser no; preferred unread (dumpsys package preferred: exit 1 error: closed)');
    expect(c.hand).toHaveLength(1);
  });
});

describe('chooserWindow — the chooser\'s dirty window for the abort (batch-11.sh:163–177; batch-12 on_abort; b11-dry int-reinstall*)', () => {
  const windowOf = async (fake: ReturnType<typeof fakeEmu>, o: Partial<Parameters<typeof chooserWindow>[1]> = {}) =>
    chooserWindow(await emuOf(fake), { apk: join(dir, 'installed.apk'), catalog: join(dir, 'cells.json'), dir, accepted: [SHARED_TWIN], progress: reinstallProgress(), ...o });

  it('outside a reinstall: BACK and HOME, then --check over the abort\'s Run: put back (int-d55)', async () => {
    const fake = fakeEmu({ chooser: 1 });
    const w = await windowOf(fake);
    const detached = fakeEmu({ chooser: 1 });
    expect(await w.restore(detached.run)).toEqual({ ok: true, how: 'chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)' });
    // `adb get-state` first, then the dismissal (T2 S5 review round 1).
    expect(detached.words().slice(0, 3)).toEqual(['get-state', `shell ${CHOOSER_FOCUS_COMMAND}`, 'shell input keyevent KEYCODE_BACK']);
    expect(fake.words()).toEqual(['emu avd name']);
  });

  it('interrupted inside the reinstall with the lab gone: installed again from the pulled APK, proven, then checked (int-reinstall-nolab)', async () => {
    files();
    const fake = fakeEmu({ installed: false, writes: true });
    const w = await windowOf(fake, { progress: { step: 'started' } });
    expect(await w.restore(fake.run)).toMatchObject({ ok: true });
    expect(fake.words().filter((x) => /get-state|pm path|^install|^pull/.test(x))).toEqual(['get-state', 'get-state', 'shell pm path dev.averi.lab', `install ${join(dir, 'installed.apk')}`, 'get-state', 'shell pm path dev.averi.lab', `pull ${DEVICE_APK} ${join(dir, 'reinstalled.apk')}`]);
  });

  it("outside a reinstall, adb unreachable: unknown at once — no key pressed, nothing called put back (T2 S5 review round 1)", async () => {
    const fake = fakeEmu();
    const w = await windowOf(fake);
    fake.st.reachable = false;
    expect(await w.restore(fake.run)).toEqual({ ok: false, why: 'adb unreachable, so nothing could be read or put back (adb get-state: exit 1 error: no devices/emulators found)', hand: [expect.stringMatching(/^D55 \(Android\): the chooser and the preferred activities not proven put back/)] });
    expect(fake.words()).toEqual(['emu avd name', 'get-state']);
  });

  it('inside the reinstall, the lab installed again or found installed is proven by its cells.json, or not put back (T2 S5 review round 1)', async () => {
    files();
    const other = fakeEmu({ installed: false, writes: true, cells: '{"cells":[]}\n' });
    expect(await (await windowOf(other, { progress: { step: 'started' } })).restore(other.run)).toMatchObject({
      ok: false,
      why: `interrupted during the reinstall: the installed lab not proven the pulled APK: the reinstalled APK's assets/cells.json is not the catalog's ${join(dir, 'cells.json')}`,
      hand: [expect.stringMatching(/^D55 \(Android\): the installed lab not proven the pulled APK/)],
    });
    const found = fakeEmu({ writes: true });
    expect(await (await windowOf(found, { progress: { step: 'started' } })).restore(found.run)).toMatchObject({ ok: true });
    expect(found.words().filter((x) => /^install|^pull/.test(x))).toEqual([`pull ${DEVICE_APK} ${join(dir, 'reinstalled-2.apk')}`]);
  });

  it('interrupted inside the reinstall with adb unreachable: unknown — never "missing", never "put back", nothing installed (int-reinstall-noadb)', async () => {
    const fake = fakeEmu({ writes: true });
    const w = await windowOf(fake, { progress: { step: 'started' } });
    fake.st.reachable = false;
    const p = await w.restore(fake.run);
    expect(p).toEqual({ ok: false, why: 'interrupted during the reinstall: whether the lab is installed is unknown (adb get-state: exit 1 error: no devices/emulators found)', hand: [expect.stringMatching(/^D55 \(Android\): whether the lab is installed is unknown/)] });
    // Unknown at once: no key, no pm path, no install after the failed get-state (T2 S5 review round 1).
    expect(fake.words()).toEqual(['emu avd name', 'get-state']);
  });

  it('interrupted inside the reinstall, the install again failing: still missing, or unknown after it — each its own hand line', async () => {
    files();
    const failing = fakeEmu({ installed: false, writes: true, rules: [(w) => (w[0] === 'install' ? exit(1, 'Failure') : undefined)] });
    expect(await (await windowOf(failing, { progress: { step: 'started' } })).restore(failing.run)).toEqual({
      ok: false,
      why: 'interrupted during the reinstall: the lab was not installed; after the install it is still missing',
      hand: [`D55 (Android): the lab APK is NOT installed: adb -s ${SERIAL} install ${join(dir, 'installed.apk')}; then: adb -s ${SERIAL} shell dumpsys package preferred`],
    });
    let gets = 0;
    const lost = fakeEmu({ installed: false, writes: true, rules: [(w) => (w[0] === 'get-state' && ++gets > 2 ? exit(1, 'error: closed') : undefined)] });
    expect(await (await windowOf(lost, { progress: { step: 'started' } })).restore(lost.run)).toMatchObject({
      ok: false,
      why: 'interrupted during the reinstall: the lab was not installed; after the install it is unknown (adb get-state: exit 1 error: closed)',
      hand: [expect.stringMatching(/^D55 \(Android\): whether the lab is installed is unknown/)],
    });
  });

  it("the probe's state put back after the install is proven, over the abort's Run; its failure is the window's", async () => {
    files();
    const fake = fakeEmu();
    const seen: unknown[] = [];
    const w = await windowOf(fake, {
      progress: { step: 'started' },
      putBack: restoreOf(async (run) => {
        seen.push(run === fake.run);
        return { ok: false, why: 'D55 restore: NOT VERIFIED — the state file not read back equal', hand: ['D55 (Android): the probe --restore'] };
      }),
    });
    expect(await w.restore(fake.run)).toEqual({ ok: false, why: 'D55 restore: NOT VERIFIED — the state file not read back equal', hand: ['D55 (Android): the probe --restore'] });
    expect(seen).toEqual([true]);
    // With no hand line of its own, the RESTORE line names its command (T2 S5 review round 1).
    const bare = fakeEmu();
    const w3 = await windowOf(bare, { progress: { step: 'started' }, putBack: restoreOf(async () => ({ ok: false, why: 'NOT VERIFIED' })) });
    expect(await w3.restore(bare.run)).toEqual({ ok: false, why: 'NOT VERIFIED', hand: [`D55 (Android): the lab's state not put back: ${RESTORE_CMD}`] });
    // A restore giving an empty hand: its command too (mutation round).
    const empty = fakeEmu();
    const w5 = await windowOf(empty, { progress: { step: 'proven' }, putBack: restoreOf(async () => ({ ok: false, why: 'NOT VERIFIED', hand: [] })) });
    expect(await w5.restore(empty.run)).toEqual({ ok: false, why: 'NOT VERIFIED', hand: [`D55 (Android): the lab's state not put back: ${RESTORE_CMD}`] });
    // Inside the reinstall, `pm path` itself not answering: unknown, nothing installed (mutation round).
    const slow = fakeEmu({ writes: true, rules: [(w) => (w[1] === 'pm' ? timedOut : undefined)] });
    expect(await (await windowOf(slow, { progress: { step: 'started' } })).restore(slow.run)).toEqual({
      ok: false,
      why: `interrupted during the reinstall: whether the lab is installed is unknown (pm path: past its bound (exit ${TIMED_OUT}))`,
      hand: [expect.stringMatching(/^D55 \(Android\): whether the lab is installed is unknown/)],
    });
    expect(slow.words().some((x) => x.startsWith('install'))).toBe(false);
    // The catalog unreadable inside the reinstall: not proven, said.
    const noCat = fakeEmu();
    const w4 = await windowOf(noCat, { progress: { step: 'started' }, catalog: join(dir, 'none.json') });
    expect(await w4.restore(noCat.run)).toMatchObject({ ok: false, why: `interrupted during the reinstall: the installed lab not proven the pulled APK: the catalog ${join(dir, 'none.json')} cannot be read` });
    // Inside the reinstall, a state restore that verifies: the check's words, nothing more (mutation round).
    const fine = fakeEmu();
    const w6 = await windowOf(fine, { progress: { step: 'started' }, putBack: restoreOf(async () => ({ ok: true, how: 'put back' })) });
    expect(await w6.restore(fine.run)).toEqual({ ok: true, how: 'chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)' });
    const ok2 = fakeEmu();
    const w2 = await windowOf(ok2, { putBack: restoreOf(async () => ({ ok: true, how: 'put back' })) });
    expect(await w2.restore(ok2.run)).toEqual({ ok: true, how: "chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0); nothing was wiped; the probe's state put back" });
  });

  it("outside a reinstall, a dirty state file is put back by the probe's restore — it also undoes the probe's own changes; the note that nothing was wiped added (T2 S5 review round 4: the code review's decision reversed)", async () => {
    const o = files({ dirty: true, serial: SERIAL });
    const fake = fakeEmu();
    let asked = 0;
    const w = await windowOf(fake, {
      stateFile: o.stateFile,
      putBack: restoreOf(async () => {
        asked++;
        writeFileSync(o.stateFile, JSON.stringify({ dirty: false, serial: SERIAL }));
        return { ok: true, how: 'D55 restore: OK' };
      }),
    });
    expect(await w.restore(fake.run)).toEqual({ ok: true, how: "chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0); nothing was wiped; the probe's state put back" });
    expect(asked).toBe(1);
    expect(readState(o).dirty).toBe(false);
    // The restore failing: its own why, no "put back" claimed (review round 5).
    const failed = await windowOf(fakeEmu(), { stateFile: o.stateFile.replace('state.json', 'none.json'), putBack: restoreOf(async () => ({ ok: false, why: 'NOT VERIFIED', hand: ['h'] })) });
    expect(await failed.restore(fakeEmu().run)).toEqual({ ok: false, why: 'NOT VERIFIED', hand: ['h'] });
  });

  it('a state file already clean needs no restore: none run, said (T2 S5 review round 4)', async () => {
    const o = files({ dirty: false, serial: SERIAL });
    let asked = 0;
    const w = await windowOf(fakeEmu(), { stateFile: o.stateFile, progress: { step: 'started' }, putBack: restoreOf(async () => (asked++, { ok: true, how: 'x' })) });
    expect(await w.restore(fakeEmu().run)).toEqual({ ok: true, how: "chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0); the probe's state file is clean: nothing to put back" });
    expect(asked).toBe(0);
    // An unreadable one is not clean: the restore runs.
    const bad = files('{not json');
    const w2 = await windowOf(fakeEmu(), { stateFile: bad.stateFile, putBack: restoreOf(async () => (asked++, { ok: true, how: 'x' })) });
    expect(await w2.restore(fakeEmu().run)).toMatchObject({ ok: true });
    expect(asked).toBe(1);
  });

  it('after the restore: the window\'s words are the cleanup\'s, exit by exit (T2 S5 code review: one table)', async () => {
    for (const opts of [{}, { entries: [{ flag: 'false' as const }] }, { entries: [{ flag: 'false' as const, authority: 'pair' }] }, { entries: [{ flag: 'none' as const }] }, { chooser: Infinity, rules: [(w: readonly string[]) => (w.join(' ').endsWith('KEYCODE_HOME') ? ok() : undefined)] }]) {
      const c = await cleanUp(await emuOf(fakeEmu(opts)), files());
      const p = await (await windowOf(fakeEmu(opts))).restore(fakeEmu(opts).run);
      expect(p.ok ? p.how : p.why).toBe(c.line.replace(/^D55 cleanup: [A-Z]+ — /, ''));
      expect(p.ok ? (p.verdict ?? 'OK') : (p.verdict ?? 'ERROR')).toBe(c.verdict);
    }
  });

  it('after the restore: the accepted last-chosen entry is put back, its check said (T2 S5 mutation round)', async () => {
    const accepted = fakeEmu({ entries: [{ flag: 'false' }] });
    expect(await (await windowOf(accepted)).restore(accepted.run)).toMatchObject({ ok: true, how: expect.stringMatching(/^chooser no; preferred read \(1 user\); lab entries 1 \(defaults 0, last-chosen 1, accepted 1\)/) });
  });

  it('after the restore: a last-chosen entry not accepted is put back with its WARN; a default FAIL; unproven or a chooser that stays, not put back', async () => {
    const other = fakeEmu({ entries: [{ flag: 'false', authority: 'pair' }] });
    // A WARN, the cleanup's own words (T2 S5 review round 1: the abort and cleanUp agree).
    const p = await (await windowOf(other)).restore(other.run);
    const c = await cleanUp(await emuOf(fakeEmu({ entries: [{ flag: 'false', authority: 'pair' }] })), files());
    expect(p).toEqual({ ok: true, verdict: 'WARN', how: c.line.replace(/^D55 cleanup: WARN — /, '') });
    expect(c.verdict).toBe('WARN');
    const aDefault = fakeEmu({ entries: [{ flag: 'true' }] });
    expect(await (await windowOf(aDefault)).restore(aDefault.run)).toMatchObject({ ok: false, verdict: 'FAIL', hand: [expect.stringMatching(/^D55 \(Android\): a lab default/)] });
    const unread = fakeEmu({ rules: [(w) => (w.join(' ') === 'shell dumpsys package preferred' ? exit(1) : undefined)] });
    expect(await (await windowOf(unread)).restore(unread.run)).toMatchObject({ ok: false, why: expect.stringMatching(/^the preferred activities or the focus not proven clean: /), hand: [expect.stringMatching(/^D55 \(Android\): the chooser and/)] });
    const stays = fakeEmu({ chooser: Infinity, rules: [(w) => (w.join(' ').endsWith('KEYCODE_HOME') ? ok() : undefined)] });
    expect(await (await windowOf(stays)).restore(stays.run)).toMatchObject({ ok: false, why: expect.stringMatching(/^the chooser is still in front after BACK and HOME: /) });
  });

  it('its hand lines name the exact step: inside the reinstall the install read first; never an uninstall no default was measured for (T2 S5 code review); its options carried to the abort', async () => {
    const fake = fakeEmu();
    const progress = reinstallProgress();
    const w = await windowOf(fake, { progress, stateFile: join(dir, 'state.json'), block: 'D55', cleanup: 'D55 cleanup', secs: 60 });
    expect(w.hand).toEqual([expect.stringMatching(/^D55 \(Android\): the chooser and the preferred activities not proven put back/)]);
    progress.step = 'started';
    expect(w.hand).toHaveLength(2);
    expect(w.hand[0]).toMatch(/^D55 \(Android\): whether the lab is installed is unknown/);
    expect(w.hand.join('\n')).not.toContain('uninstall');
    const withState = await windowOf(fake, { putBack: restoreOf(async () => ({ ok: true, how: 'x' })) });
    expect(withState.hand).toEqual([expect.stringMatching(/^D55 \(Android\): the chooser/), `D55 (Android): the lab's state not put back: ${RESTORE_CMD}`]);
    expect([w.stateFile, w.block, w.cleanup, w.secs]).toEqual([join(dir, 'state.json'), 'D55', 'D55 cleanup', 60]);
    const bare = await windowOf(fakeEmu());
    expect(Object.keys(bare)).toEqual(['restore', 'hand']);
  });
});
