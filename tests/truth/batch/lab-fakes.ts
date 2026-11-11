import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHOOSER_FOCUS_COMMAND } from '../../../src/adapters/android-chooser.js';
import { DEVICE_CHECK_SIMULATOR, DEVICE_CHECK_WDA_PORTS, LAB_APP } from '../../../scripts/truth/lab-device.js';
import type { Run } from '../../../scripts/truth/batch/bounded.js';
import { DOMAINS, PROTECTED, type KeyVal } from '../../../scripts/truth/batch/ios-defaults.js';

// The lab devices as fakes, shared by the S6b tests (ios-lab, android-lab, lab-build, and lab-batch through runBatch):
// a simulator (its domains in memory, `defaults export` writing the typed map to the host file, plistlib reading it
// back; the lab's WebDriverAgent whose exit flips com.apple.Accessibility from bool to int as batch-10 measured; port
// 8120's listeners; the Open-in alert; the installed app's container), an emulator (its AVD, the installed APK, the
// handlers, the role holders and clipboard reads of API 33), and the host's tools (pkill, lsof, kill, unzip, the
// builds). Every call is checked for what b11-dry's shims flagged as a VIOLATION, made exact: device-check's simulator
// or WDA ports named; a write to the schemeapproval domain; a pkill by any pattern but the lab's; a kill of a pid
// port 8120 did not list; an adb call naming no serial or another one; any `input tap`; an idb tap anywhere but the
// alert's Cancel. No device and no process is touched.

export const LAB_UDID = 'LAB-SIMULATOR-UDID';
export const LAB_SERIAL = 'LAB-SERIAL';
const A11Y = 'com.apple.Accessibility';
const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'batch');
export const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const exported = (domain: string, phase: string): Record<string, KeyVal> => JSON.parse(fixture(`d43-b10/${domain}.${phase}.json`)) as Record<string, KeyVal>;
export const CATALOG = '{"cells":[{"id":"open"},{"id":"form-basic"}]}\n';
/** API 33's preferred block with no lab entry (batch-10). */
export const PREFERRED = fixture('dumpsys-package-preferred-api33-b10.txt');
/** That block with a lab default (`mAlways=true`) for averilab://shared — what "Always" leaves. */
export const PREFERRED_WITH_DEFAULT = PREFERRED.replace(
  '  Schemes:\n',
  [
    '  Schemes:',
    '      averilab:',
    '        9d3a2b9 dev.averi.lab/.Twin',
    '         mMatch=0x300000 mAlways=true',
    '          Selected from:',
    '            dev.averi.lab/.MainActivity',
    '            dev.averi.lab/.Twin',
    '          Action: "android.intent.action.VIEW"',
    '          Scheme: "averilab"',
    '          Authority: "shared": -1',
    '',
  ].join('\n'),
);
/** API 33's focus read with the chooser in front (batch-10, T4's fixture). */
export const FOCUS_CHOOSER = fixture('../dumpsys-window-focus-api33-b10-chooser.txt');
export const DEVICE_APK = '/data/app/~~HASH==/dev.averi.lab-HASH==/base.apk';

export interface Result {
  code: number;
  out: string;
  err: string;
  timedOut?: boolean;
}
const ok = (out = ''): Result => ({ code: 0, out, err: '' });
const exit = (code: number, err = '', out = ''): Result => ({ code, out, err });

/**
 * idb's words for a call whose stored companion is gone (batch-13 rerun 1, `idb ui describe-all`), its socket's
 * folder put as a placeholder.
 */
export const STALE_COMPANION_ERR = `Failed to connect to companion at address DomainSocketAddress(path='<idb state folder>/${LAB_UDID}_companion.sock'): [Errno 2] No such file or directory`;

/** The Open-in alert's elements as idb lists them, Cancel at the centre (140, 420). */
export const ALERT_TREE = [
  { AXLabel: 'Open in “AveriLab”?', type: 'StaticText' },
  { AXLabel: 'Open', type: 'Button', frame: { x: 200, y: 400, width: 80, height: 40 } },
  { AXLabel: 'Cancel', type: 'Button', frame: { x: 100, y: 400, width: 80, height: 40 } },
];

export interface WorldOptions {
  /** Where the fake writes what a device holds on the host (the app container, the built app). */
  dir: string;
  simName?: string;
  /** The installed app's cells.json (none: not installed). */
  appCells?: string | null;
  /** How many Cancel taps dismiss the alert (0: none up; Infinity: never). */
  alertTaps?: number;
  /** The health check fails (describe-all or swipe) until a reset. */
  sick?: 'describe-all' | 'swipe';
  /** `simctl boot` fails. */
  bootFails?: boolean;
  /** The WDA runner's exit flips Accessibility once more after the restore (a late writer). */
  lateFlip?: boolean;
  /** Port 8120's listeners now, and whether a kill leaves one (it never goes). */
  listeners?: number[];
  stickyListener?: boolean;
  /** `defaults export` fails for this domain; every write, import and delete fails (the restore not verified). */
  exportFails?: string;
  restoreFails?: boolean;
  /** The finportal key: its value (none: absent), and a value it takes at the end (CHANGED). */
  finportal?: string;
  finportalEnd?: string;
  /** The emulator: its AVD, reachable, the lab installed, the installed APK's cells.json. */
  avd?: string;
  reachable?: boolean;
  installed?: boolean;
  apkCells?: string;
  /** What the roles and clipboard reads print before and after a block (API 33: no such command). */
  roles?: [string, string];
  clipboard?: [string, string];
  /**
   * idb's local companion list for the lab simulator at the start: no entry (idb spawns one at its first call), a live
   * companion, or a stale entry (its companion ended, the entry left: batch-13 rerun 1) — every idb call for the udid
   * then fails fast with "Failed to connect to companion", until `idb disconnect <udid>` drops it.
   */
  companion?: 'none' | 'live' | 'stale';
  /** `idb disconnect` fails (exit 1) or passes its bound. */
  disconnectFails?: 'exit' | 'timeout';
  /** What the focus read (CHOOSER_FOCUS_COMMAND) prints: API 33's launcher in front unless given. */
  focus?: string;
  /** The preferred block `dumpsys package preferred` prints (API 33's fixture unless given); an uninstall puts it back. */
  preferred?: string;
  /** The builds: which step fails. */
  buildFails?: 'catalog' | 'xcodegen' | 'xcodebuild' | 'gradlew' | 'java';
  /** What the built APK's cells.json holds (CATALOG unless given). */
  builtCells?: string;
}

/** The fake lab: its answer to each call (undefined: not a lab call), every call's words, and what it flagged. */
export function labWorld(o: WorldOptions) {
  const domains = new Map(Object.entries(Object.fromEntries(DOMAINS.map((d) => [d, exported(d, 'backup')]))));
  if (o.finportal !== undefined) domains.set(PROTECTED.domain, { [PROTECTED.key]: { t: 'string', c: JSON.stringify(o.finportal), v: o.finportal } });
  const st = {
    booted: true,
    sick: o.sick,
    wda: false,
    restored: false,
    lateFlipped: false,
    listeners: [...(o.listeners ?? [])],
    alertTaps: o.alertTaps ?? 0,
    installed: o.installed ?? true,
    apkCells: o.apkCells ?? CATALOG,
    readsAt: { roles: 0, clipboard: 0 },
    listed: new Set<number>(),
    alertUp: (o.alertTaps ?? 0) > 0,
    reachable: () => o.reachable !== false,
    companion: o.companion ?? 'none',
    /** The preferred block now: a test may set it (a default left); `adb uninstall` of the lab clears it. */
    preferred: o.preferred ?? PREFERRED,
    /** The focus read now: a test may set it (a chooser in front). */
    focus: o.focus ?? fixture('dumpsys-window-focus-api33-b10-launcher-no-header.txt'),
  };
  const app = join(o.dir, 'container', 'AveriLab.app');
  rmSync(app, { recursive: true, force: true });
  if (o.appCells !== null) {
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, 'cells.json'), o.appCells ?? CATALOG);
  }
  const calls: string[] = [];
  const violations: string[] = [];
  const flip = () => domains.set(A11Y, exported(A11Y, 'after'));

  const xcrun = (args: readonly string[]): Result => {
    if (args[0] !== 'simctl') return exit(2, `xcrun: ${args[0]}`);
    const [verb, udid] = [args[1], args[2]];
    if (verb === 'list') return ok(JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ udid: LAB_UDID, name: o.simName ?? 'averi-lab iPhone 17' }] } }));
    if (udid !== LAB_UDID) return exit(2, `no simulator ${udid}`);
    if (verb === 'shutdown') return (st.booted = false), ok();
    if (verb === 'boot') return o.bootFails === true ? exit(149, 'Unable to boot device') : ((st.booted = true), (st.sick = undefined), ok());
    if (verb === 'bootstatus') return ok('Device already booted');
    if (verb === 'launch') return ok(`${LAB_APP.native.bundle}: 4242`);
    if (verb === 'install') {
      if (!existsSync(join(args[3], 'cells.json'))) return exit(2, `no app at ${args[3]}`);
      const cells = readFileSync(join(args[3], 'cells.json'), 'utf8');
      mkdirSync(app, { recursive: true });
      writeFileSync(join(app, 'cells.json'), cells);
      return ok();
    }
    if (verb === 'get_app_container') return existsSync(app) ? ok(`${app}\n`) : exit(2, 'No such file or directory');
    if (verb !== 'spawn' || args[3] !== 'defaults') return exit(2, `simctl ${verb}`);
    const [dverb, domain, key] = [args[4], args[5], args[6]];
    const map = domains.get(domain);
    if (dverb !== 'read' && domain.toLowerCase().includes(PROTECTED.domain.toLowerCase())) violations.push(`schemeapproval written: ${args.join(' ')}`);
    if (dverb === 'export') {
      if (o.exportFails === domain) return exit(1, `export ${domain} failed`);
      writeFileSync(key, JSON.stringify(map ?? {}));
      return ok();
    }
    if (dverb === 'read') {
      if (domain === PROTECTED.domain && key === PROTECTED.key) {
        const v = st.restored && o.finportalEnd !== undefined ? o.finportalEnd : o.finportal;
        return v === undefined ? exit(1, fixture('schemeapproval-absent-protected-key.txt')) : ok(`${v}\n`);
      }
      return map === undefined ? exit(1, `Domain ${domain} does not exist`) : ok(`${JSON.stringify(map)}\n`);
    }
    if (o.restoreFails === true && ['write', 'import', 'delete'].includes(dverb)) return exit(1, `defaults ${dverb}: refused`);
    if (dverb === 'write') {
      const [flag, v] = [args[7], args[8]];
      const kv: KeyVal = flag === '-bool' ? { t: 'bool', c: v, v } : flag === '-int' ? { t: 'int', c: String(Number(v)), v } : { t: 'string', c: JSON.stringify(v), v };
      domains.set(domain, { ...map, [key]: kv });
      st.restored = true;
      return ok();
    }
    if (dverb === 'import') {
      domains.set(domain, { ...map, ...(JSON.parse(readFileSync(key, 'utf8')) as Record<string, KeyVal>) });
      st.restored = true;
      return ok();
    }
    if (dverb === 'delete') {
      const rest = { ...map };
      delete rest[key];
      domains.set(domain, rest);
      return ok();
    }
    return exit(2, `defaults ${dverb}`);
  };

  const idb = (args: readonly string[]): Result => {
    // `idb kill` clears every companion idb knows, device-check's too (batch-13): never.
    if (args[0] === 'kill') violations.push(`idb kill: ${args.join(' ')}`);
    if (args[0] === 'disconnect') {
      if (args.length !== 2 || args[1] !== LAB_UDID) violations.push(`idb disconnect not of the lab simulator alone: ${args.join(' ')}`);
      if (o.disconnectFails === 'timeout') return { code: 142, out: '', err: '', timedOut: true };
      if (o.disconnectFails === 'exit') return exit(1, 'DisconnectCommandException: Could not disconnect');
      st.companion = 'none';
      return ok();
    }
    if (args.at(-2) !== '--udid' || args.at(-1) !== LAB_UDID) violations.push(`idb not for the lab simulator: ${args.join(' ')}`);
    if (st.companion === 'stale') return exit(1, STALE_COMPANION_ERR);
    st.companion = 'live';
    if (args[1] === 'describe-all') {
      if (st.sick === 'describe-all') return exit(1, 'No translation object returned');
      if (args[2] !== '--json') return ok('[]');
      return ok(JSON.stringify(st.alertUp ? ALERT_TREE : [{ AXLabel: 'AveriLab', type: 'Application' }]));
    }
    if (args[1] === 'swipe') return st.sick === 'swipe' ? exit(1, 'swipe failed') : ok();
    if (args[1] === 'tap') {
      if (!(st.alertUp && args[2] === '140' && args[3] === '420')) violations.push(`an idb tap not on the alert's Cancel: ${args.join(' ')}`);
      if (--st.alertTaps <= 0) st.alertUp = false;
      return ok();
    }
    return exit(2, `idb ${args[1]}`);
  };

  const pkill = (args: readonly string[]): Result => {
    const pattern = args[1];
    const allowed = ['DerivedData/averi-wda-lab([/ ]|$)', `Devices/${LAB_UDID}/.*WebDriverAgentRunner`, `idb_companion --udid ${LAB_UDID}`];
    if (args[0] !== '-f' || !allowed.includes(pattern)) violations.push(`pkill by a pattern not the lab's: ${args.join(' ')}`);
    if (pattern === allowed[2]) {
      // A pkill ends the companion, and idb's list keeps its entry (fb-idb prunes only in list_targets).
      if (st.companion !== 'live') return exit(1);
      st.companion = 'stale';
      return ok();
    }
    if (pattern === allowed[0]) {
      // The runner's exit flips Accessibility (batch-10): at the window's kill, once more after the restore when late.
      if (st.wda) flip();
      else if (o.lateFlip === true && st.restored && !st.lateFlipped) (st.lateFlipped = true), flip();
      st.wda = false;
      if (o.stickyListener !== true) st.listeners = [];
      return ok();
    }
    return exit(1);
  };

  const lsof = (args: readonly string[]): Result => {
    if (args.join(' ') !== '-t -n -P -sTCP:LISTEN -i tcp:8120') violations.push(`lsof not of port 8120: ${args.join(' ')}`);
    for (const p of st.listeners) st.listed.add(p);
    return st.listeners.length === 0 ? exit(1) : ok(`${st.listeners.join('\n')}\n`);
  };

  const kill = (args: readonly string[]): Result => {
    const pid = Number(args[1]);
    if (args[0] !== '-TERM' || !st.listed.has(pid)) violations.push(`a kill of a pid port 8120 did not list: ${args.join(' ')}`);
    if (o.stickyListener !== true) st.listeners = st.listeners.filter((p) => p !== pid);
    return ok();
  };

  const adb = (args: readonly string[]): Result => {
    if (args[0] !== '-s' || args[1] !== LAB_SERIAL) violations.push(`adb not for the lab serial: ${args.join(' ')}`);
    const words = args.slice(2);
    const said = words.join(' ');
    if (said.includes('input tap')) violations.push(`an input tap: ${said}`);
    if (said === 'emu avd name') return o.avd === null ? exit(1, 'error: no emulator') : ok(`${o.avd ?? 'averi_lab'}\r\nOK\r\n`);
    if (said === 'get-state') return st.reachable() ? ok('device\n') : exit(1, 'error: device offline');
    if (said === `shell pm path ${LAB_APP.native.package}`) return st.installed ? ok(`package:${DEVICE_APK}\n`) : exit(1);
    if (words[0] === 'pull') return writeFileSync(words[2], 'APK'), ok('1 file pulled');
    if (words[0] === 'install') {
      if (!existsSync(words.at(-1)!)) return exit(1, `adb: failed to stat ${words.at(-1)}: No such file or directory`);
      st.installed = true;
      const apk = readFileSync(words.at(-1)!, 'utf8');
      if (apk.startsWith('BUILT:')) st.apkCells = apk.slice('BUILT:'.length);
      return ok('Success');
    }
    if (words[0] === 'shell' && words[1] === 'cmd' && words[2] === 'package' && words[3] === 'query-activities') {
      return ok(fixture(said.includes('shared') ? 'query-activities-api33-b10-shared.txt' : 'query-activities-api33-b10-cell.txt'));
    }
    if (said === `shell ${CHOOSER_FOCUS_COMMAND}`) return ok(st.focus);
    if (said === 'shell dumpsys package preferred') return ok(st.preferred);
    // An uninstall of the lab clears its defaults (lab-emu.ts#clearLabEntry's reinstall; API 33, batch-11 measured).
    if (said === `uninstall ${LAB_APP.native.package}`) return (st.installed = false), (st.preferred = PREFERRED), ok('Success');
    if (said === 'shell input keyevent KEYCODE_HOME' || said === 'shell input keyevent KEYCODE_BACK') return ok();
    if (said === 'shell cmd role get-role-holders android.app.role.BROWSER') return readAt('roles', o.roles, 'role-holders-api33-b9-unknown-command.txt', 255);
    if (said === 'shell cmd clipboard help') return readAt('clipboard', o.clipboard, 'clipboard-help-api33-b9.txt', 0);
    return exit(2, `adb ${said}`);
  };
  /** A read that prints `pair[0]` before a block and `pair[1]` after; none given: API 33's answer (a fixture). */
  const readAt = (what: 'roles' | 'clipboard', pair: [string, string] | undefined, file: string, code: number): Result => {
    const n = st.readsAt[what]++;
    return pair === undefined ? { code, out: fixture(file), err: '' } : ok(`${pair[Math.min(n, 1)]}\n`);
  };

  const answer = (cmd: string, args: readonly string[], call: { cwd?: string } = {}): Result | undefined => {
    const said = args.join(' ');
    calls.push(`${cmd.endsWith('node') || cmd === process.execPath ? 'node' : cmd} ${said}`);
    if (said.toUpperCase().includes(DEVICE_CHECK_SIMULATOR)) violations.push(`device-check's simulator named: ${cmd} ${said}`);
    for (const p of DEVICE_CHECK_WDA_PORTS) if (args.some((a) => new RegExp(`(^|\\D)${p}(\\D|$)`).test(a))) violations.push(`port ${p} named: ${cmd} ${said}`);
    if (cmd === 'xcrun') return xcrun(args);
    if (cmd === 'python3') return existsSync(args[3]) ? ok(readFileSync(args[3], 'utf8')) : exit(1, 'plistlib.InvalidFileException');
    if (cmd === 'idb') return idb(args);
    if (cmd === 'pkill') return pkill(args);
    if (cmd === 'lsof') return lsof(args);
    if (cmd === 'kill') return kill(args);
    if (cmd === 'adb') return adb(args);
    if (cmd === 'unzip') return ok(args[1].includes('outputs/apk') ? (o.builtCells ?? CATALOG) : st.apkCells);
    if ((cmd === process.execPath || cmd.endsWith('node')) && said.includes('catalog.ts --check')) return o.buildFails === 'catalog' ? exit(1, 'fixtures/apps/cells.json is stale') : ok();
    if (cmd === 'xcodegen') return o.buildFails === 'xcodegen' ? exit(127, 'xcodegen: not found') : ok();
    if (cmd === 'xcodebuild') {
      if (o.buildFails === 'xcodebuild') return exit(65, '** BUILD FAILED **');
      const product = join(call.cwd!, 'build/Build/Products/Debug-iphonesimulator/AveriLab.app');
      mkdirSync(product, { recursive: true });
      writeFileSync(join(product, 'cells.json'), o.builtCells ?? CATALOG);
      return ok('** BUILD SUCCEEDED **');
    }
    if (cmd.endsWith('java_home')) return o.buildFails === 'java' ? exit(1, 'Unable to find any JVMs matching version "17"') : ok(`${join(o.dir, 'jdk17')}\n`);
    if (cmd.endsWith('gradlew')) {
      if (args.includes('--stop')) return ok('Stopping Daemon(s)');
      if (o.buildFails === 'gradlew') return exit(1, 'FAILURE: Build failed with an exception.');
      const apk = join(call.cwd!, 'build/outputs/apk/debug');
      mkdirSync(apk, { recursive: true });
      writeFileSync(join(apk, 'AveriLab-debug.apk'), `BUILT:${o.builtCells ?? CATALOG}`);
      return ok('BUILD SUCCESSFUL');
    }
    return undefined;
  };
  mkdirSync(join(o.dir, 'jdk17'), { recursive: true });
  writeFileSync(join(o.dir, 'jdk17', 'release'), 'JAVA_VERSION="17.0.12"\n');
  /** The WDA window's work started the lab's WebDriverAgent: listening on 8120, its exit to flip Accessibility. */
  const startWda = () => {
    st.wda = true;
    st.listeners = [4242];
  };
  return { answer, calls, violations, domains, st, startWda, app };
}

export type LabWorld = ReturnType<typeof labWorld>;

/** A Run over the world: each call answered (a call it does not know throws), its Call kept beside its words. */
export function runOf(w: LabWorld): Run & { seen: { words: string; secs?: number; cwd?: string; log?: string; env?: NodeJS.ProcessEnv }[] } {
  const seen: { words: string; secs?: number; cwd?: string; log?: string; env?: NodeJS.ProcessEnv }[] = [];
  const run = (async (cmd, args, call) => {
    const r = w.answer(cmd, args, { cwd: call?.cwd });
    if (r === undefined) throw new Error(`no answer for ${cmd} ${args.join(' ')}`);
    seen.push({ words: w.calls.at(-1)!, secs: call?.secs, cwd: call?.cwd, log: call?.log, env: call?.env });
    if (call?.log !== undefined) writeFileSync(call.log, `${r.out}${r.err}`, { flag: 'a' });
    return { code: r.code, timedOut: r.timedOut ?? false, signal: null, out: call?.log === undefined ? r.out : '', err: call?.log === undefined ? r.err : '' };
  }) as Run & { seen: typeof seen };
  run.seen = seen;
  return run;
}
