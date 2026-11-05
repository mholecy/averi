import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { DEVICE_CHECK_SIMULATOR } from '../../../scripts/truth/lab-device.js';
import { TIMED_OUT, type CallResult } from '../../../scripts/truth/batch/bounded.js';
import {
  cellsWhy,
  companionPattern,
  freshIn,
  LSOF_ARGV,
  openInAlertOf,
  pkillOf,
  portHand,
  portOf,
  portPart,
  wdaKillPatterns,
  wdaBlockedOf,
  wdaRestoredOf,
  compareHand,
  javaHomeOf,
} from '../../../scripts/truth/batch/lab-lines.js';

// scripts/truth/batch/lab-lines.ts: the lab plumbing's pure half (T2 S6b) — what the port, pkill, the Open-in alert,
// an installed cells.json and a JDK read say, the WDA window's restore line with its port part, the patterns the lab's
// processes are ended by. Strings in, strings out. The titles name the batch and the fix that found each rule.

const ok = (out = ''): CallResult => ({ code: 0, timedOut: false, signal: null, out, err: '' });
const exit = (code: number, err = '', out = ''): CallResult => ({ code, timedOut: false, signal: null, out, err });
const timedOut: CallResult = { code: TIMED_OUT, timedOut: true, signal: 'SIGKILL', out: '', err: '' };
const LAB = 'LAB-SIMULATOR-UDID';

describe('the lab\'s processes, by their exact patterns (batch-11.sh:321–325 kill_lab_wda; never device-check\'s)', () => {
  it('the WebDriverAgent: the lab\'s own derived data, and the runner under the lab simulator\'s folder; the companion of the lab simulator', () => {
    expect(wdaKillPatterns(LAB)).toEqual(['DerivedData/averi-wda-lab([/ ]|$)', `Devices/${LAB}/.*WebDriverAgentRunner`]);
    expect(companionPattern(LAB)).toBe(`idb_companion --udid ${LAB}`);
  });

  it('device-check\'s simulator is refused, whatever its case: no pattern may name it', () => {
    for (const udid of [DEVICE_CHECK_SIMULATOR, DEVICE_CHECK_SIMULATOR.toLowerCase()]) {
      expect(() => wdaKillPatterns(udid)).toThrow(/device-check simulator/);
      expect(() => companionPattern(udid)).toThrow(/device-check simulator/);
    }
  });

  it('anchored (review round 1, NIT 7): the lab\'s xcodebuild and runner match; device-check\'s derived data, this node process and a batch\'s own command line never', () => {
    const [derived, runner] = wdaKillPatterns(LAB).map((p) => new RegExp(p));
    expect(derived.test('xcodebuild test-without-building -derivedDataPath /h/Library/Developer/Xcode/DerivedData/averi-wda-lab -destination id=X')).toBe(true);
    expect(derived.test('/h/Library/Developer/Xcode/DerivedData/averi-wda-lab/Build/Products/WebDriverAgentRunner-Runner.app')).toBe(true);
    expect(runner.test(`/h/Library/Developer/CoreSimulator/Devices/${LAB}/data/Containers/Bundle/Application/X/WebDriverAgentRunner-Runner.app/WebDriverAgentRunner-Runner`)).toBe(true);
    for (const line of [
      'xcodebuild test-without-building -derivedDataPath /h/Library/Developer/Xcode/DerivedData/averi-wda -destination id=Y',
      '/h/Library/Developer/Xcode/DerivedData/averi-wda-labx/Build',
      process.argv.join(' '),
      `node --import tsx /s/batch-13.ts --out /s/averi-wda-lab-runs --udid ${LAB} --serial emulator-5554`,
    ]) for (const p of [derived, runner]) expect(p.test(line)).toBe(false);
  });

  it('a pattern that would match device-check\'s derived data (averi-wda alone) is never one of them', () => {
    expect(wdaKillPatterns(LAB).some((p) => new RegExp(p).test('xcodebuild -derivedDataPath /x/DerivedData/averi-wda test'))).toBe(false);
  });

  it('pkill\'s exit: 0 something ended, 1 nothing matched — both fine; any other, or past its bound, why', () => {
    expect(pkillOf(ok())).toEqual({ ended: true });
    expect(pkillOf(exit(1))).toEqual({ ended: false });
    expect(pkillOf(exit(2, 'pkill: illegal option'))).toEqual({ why: 'pkill: exit 2 pkill: illegal option' });
    expect(pkillOf(timedOut)).toEqual({ why: 'pkill: past its bound (exit 142)' });
  });
});

describe('port 8120 (d43-gate.ts\'s restore: the port free, else killed): lsof\'s answer as free, busy or unread', () => {
  it('lsof asks the lab port only, never 8100 or 8101', () => {
    expect(LSOF_ARGV).toEqual(['-t', '-n', '-P', '-sTCP:LISTEN', '-i', 'tcp:8120']);
  });

  it('exit 1 with nothing printed is free; exit 0 its pids; anything else unread (never free)', () => {
    expect(portOf(exit(1))).toEqual({ state: 'free' });
    expect(portOf(exit(1, '\n', ' \n'))).toEqual({ state: 'free' });
    expect(portOf(ok(' 4242 \n\n'))).toEqual({ state: 'busy', pids: [4242] });
    for (const out of ['42\nabc\n', 'x42\n', '42x\n']) expect(portOf(ok(out)).state).toBe('unread');
    expect(portOf(ok('4242\n4343\n'))).toEqual({ state: 'busy', pids: [4242, 4343] });
    expect(portOf(exit(1, '', '17\n'))).toEqual({ state: 'unread', why: 'lsof: exit 1 17' });
    expect(portOf(exit(2, 'lsof: WARNING'))).toEqual({ state: 'unread', why: 'lsof: exit 2 lsof: WARNING' });
    expect(portOf(timedOut)).toEqual({ state: 'unread', why: 'lsof: past its bound (exit 142)' });
    expect(portOf(ok('a pid\n'))).toEqual({ state: 'unread', why: 'lsof printed no pid: a pid' });
    expect(portOf(ok(''))).toEqual({ state: 'unread', why: 'lsof printed no pid: ' });
  });

  it('the port part of the restore line: free, free after a kill, still listened on, or not read', () => {
    expect(portPart({ state: 'free' }, false)).toBe('port 8120 free');
    expect(portPart({ state: 'free' }, true)).toBe('port 8120 free (a listener killed)');
    expect(portPart({ state: 'busy', pids: [1, 2] }, true)).toBe('port 8120 still has a listener (pid 1, 2)');
    expect(portPart({ state: 'unread', why: 'lsof: exit 2' }, false)).toBe('port 8120 not read (lsof: exit 2)');
  });

  it('its hand line: the lab\'s kill by hand, quoted, for the lab simulator only', () => {
    expect(portHand(LAB)).toBe(`D43 (iOS): first end the lab's WebDriverAgent (a runner still running undoes a restore at its exit): pkill -f 'DerivedData/averi-wda-lab([/ ]|$)'; pkill -f 'Devices/${LAB}/.*WebDriverAgentRunner'; lsof -t -n -P -sTCP:LISTEN -i tcp:8120 | xargs kill`);
    expect(() => portHand(DEVICE_CHECK_SIMULATOR)).toThrow(/device-check simulator/);
  });
});

describe('the WDA window\'s put-back line: S4\'s line and the port part (the port is the runner\'s: ios-defaults.ts#domainPart leaves it out)', () => {
  const restored = { ok: true as const, line: 'D43 WDA-window restore: OK — every domain equals its backup (nothing put back)', hand: ['never shown'] };
  const failed = { ok: false as const, line: 'D43 WDA-window restore: ERROR — NOT VERIFIED — com.apple.Accessibility NOT equal to its backup', hand: ['D43 (iOS): xcrun simctl spawn U defaults import …'] };

  it('restored with the port free: S4\'s line, the port named — free, or free once a listener was killed', () => {
    expect(wdaRestoredOf(restored, false)).toEqual({ ok: true, line: 'D43 WDA-window restore: OK — every domain equals its backup (nothing put back); port 8120 free', hand: [] });
    expect(wdaRestoredOf(restored, true).line).toMatch(/; port 8120 free \(a listener killed\)$/);
    expect(wdaRestoredOf(failed, false)).toEqual({ ok: false, line: `${failed.line}; port 8120 free`, hand: failed.hand });
  });

  it('the port not proven free (review round 1, BLOCKER): no restore at all — a runner still running undoes it at its exit; NOT VERIFIED, the state left dirty; the WDA\'s kill first, then each domain\'s lines, then the compare', () => {
    const domains = ['D43 (iOS): xcrun simctl spawn U defaults import com.apple.Accessibility /s/b.plist'];
    expect(wdaBlockedOf({ state: 'busy', pids: [7] }, true, LAB, domains, '/s/state.json')).toEqual({
      ok: false,
      line: 'D43 WDA-window restore: ERROR — NOT VERIFIED — port 8120 still has a listener (pid 7): the domains not put back (a WebDriverAgent still running undoes a restore at its exit); the state file left dirty',
      hand: [portHand(LAB), ...domains, compareHand('/s/state.json')],
    });
    expect(wdaBlockedOf({ state: 'unread', why: 'lsof: exit 2' }, false, LAB, [], '/s/state.json').line).toContain('port 8120 not read (lsof: exit 2): the domains not put back');
    expect(compareHand("/s/a b.json")).toBe("D43 (iOS): then read each domain back (defaults export) and compare it with its backup beside '/s/a b.json'; only when every one is equal, set the state file's dirty to false");
  });
});

describe('the Open-in alert (open-in-alert.py, batch-2 block D/A: a leftover "Open in …?" holds every later launch)', () => {
  const tree = (els: unknown[]) => ok(JSON.stringify(els));
  const alert = { AXLabel: 'Open in “AveriLab”?', type: 'StaticText' };
  const cancel = { AXLabel: 'Cancel', type: 'Button', frame: { x: 100, y: 400, width: 80, height: 40 } };

  it('none: no element labelled (or valued) "Open in …" at its start', () => {
    expect(openInAlertOf(tree([{ AXLabel: 'Opening hours', type: 'StaticText' }, cancel]))).toEqual({ state: 'none' });
    expect(openInAlertOf(tree([{ AXLabel: 'Not Open in “AveriLab”', type: 'StaticText' }, cancel]))).toEqual({ state: 'none' });
    expect(openInAlertOf(tree([]))).toEqual({ state: 'none' });
  });

  it('found: its label, its buttons, and Cancel\'s centre from its frame', () => {
    expect(openInAlertOf(tree([alert, { AXLabel: 'Open', type: 'Button' }, cancel]))).toEqual({ state: 'found', label: 'Open in “AveriLab”?', buttons: ['Open', 'Cancel'], cancel: { x: 140, y: 420 } });
  });

  it('its label from AXValue when AXLabel is empty; Cancel by its trimmed label, any case; its centre from AXFrame when it has no frame', () => {
    const r = openInAlertOf(tree([{ AXLabel: '', AXValue: 'Open in “AveriLab”?' }, { AXLabel: ' CANCEL ', type: 'Button', AXFrame: '{{10, 20}, {30, 40}}' }]));
    expect(r).toEqual({ state: 'found', label: 'Open in “AveriLab”?', buttons: [' CANCEL '], cancel: { x: 25, y: 40 } });
    // No AXLabel at all, or a null one: the value is the label; a null frame falls back to AXFrame; AXFrame unspaced.
    for (const label of [{}, { AXLabel: null }]) {
      expect(openInAlertOf(tree([{ ...label, AXValue: 'Open in “X”?' }, { AXLabel: 'Cancel', type: 'Button', frame: null, AXFrame: '{{10,20},{30,40}}' }]))).toEqual({ state: 'found', label: 'Open in “X”?', buttons: ['Cancel'], cancel: { x: 25, y: 40 } });
    }
  });

  it('found with no Cancel, or a Cancel with no frame: no point to tap', () => {
    expect(openInAlertOf(tree([alert, { AXLabel: 'Open', type: 'Button' }]))).toMatchObject({ state: 'found', cancel: undefined });
    expect(openInAlertOf(tree([alert, { AXLabel: 'Cancel', type: 'Button', frame: { x: 1 } }]))).toMatchObject({ state: 'found', cancel: undefined });
    expect(openInAlertOf(tree([alert, { AXLabel: 'Cancel', type: 'Button', AXFrame: 'none' }]))).toMatchObject({ state: 'found', cancel: undefined });
  });

  it('a "Cancel" that is no button is not the one to tap', () => {
    expect(openInAlertOf(tree([alert, { ...cancel, type: 'StaticText' }]))).toMatchObject({ state: 'found', buttons: [], cancel: undefined });
  });

  it('a read that failed or does not parse as a list is unread: never "none"', () => {
    expect(openInAlertOf(exit(1, 'idb: no companion'))).toEqual({ state: 'unread', why: 'idb ui describe-all: exit 1 idb: no companion' });
    expect(openInAlertOf(ok('not json'))).toMatchObject({ state: 'unread', why: expect.stringMatching(/^idb ui describe-all printed no JSON list: /) });
    expect(openInAlertOf(ok('{"a":1}'))).toEqual({ state: 'unread', why: 'idb ui describe-all printed no JSON list: {"a":1}' });
    expect(openInAlertOf(ok('[null, 3]'))).toEqual({ state: 'none' });
    expect(openInAlertOf(tree([null, alert, 3, cancel]))).toEqual({ state: 'found', label: 'Open in “AveriLab”?', buttons: ['Cancel'], cancel: { x: 140, y: 420 } });
  });
});

describe('an installed cells.json against main\'s catalog, byte for byte (batch-11.sh:402–404, 437–441)', () => {
  it('equal: no why; else why, naming where it was read', () => {
    expect(cellsWhy('{"cells":[]}\n', '{"cells":[]}\n', 'the installed app')).toBeUndefined();
    expect(cellsWhy('{"cells":[]}', '{"cells":[]}\n', 'the installed app')).toBe("the installed app's cells.json is not main's");
    expect(cellsWhy(undefined, '{}', 'the installed app')).toBe("the installed app's cells.json could not be read");
    expect(cellsWhy('{}', undefined, 'the installed app')).toBe("main's catalog (fixtures/apps/cells.json) could not be read");
  });
});

describe('the JDK for the Android build (batch-11.sh:309–310: `java_home -v 17`, its release file says 17)', () => {
  it('a home whose release says JAVA_VERSION="17…: that home; else why — the release read only once there is a home', () => {
    const read: string[] = [];
    const release = (text: string | undefined) => (home: string) => (read.push(home), text);
    expect(javaHomeOf(ok('/jdk17\n'), release('IMPLEMENTOR="x"\nJAVA_VERSION="17.0.12"\n'))).toEqual({ home: '/jdk17' });
    expect(read).toEqual(['/jdk17']);
    expect(javaHomeOf(ok('/jdk21\n'), release('JAVA_VERSION="21.0.1"\n'))).toEqual({ why: "no JDK 17 (java_home -v 17 → '/jdk21', its release says no 17)" });
    expect(javaHomeOf(ok('/jdk\n'), release('IMPLEMENTOR_JAVA_VERSION="17"\n'))).toEqual({ why: "no JDK 17 (java_home -v 17 → '/jdk', its release says no 17)" });
    expect(javaHomeOf(ok('/jdk17\n'), release(undefined))).toEqual({ why: "no JDK 17 (java_home -v 17 → '/jdk17', its release file not read)" });
    read.length = 0;
    expect(javaHomeOf(exit(1, 'Unable to find any JVMs\n', '/jdk\n'), release('JAVA_VERSION="17"'))).toEqual({ why: 'no JDK 17 (java_home -v 17 → nothing: exit 1 Unable to find any JVMs)' });
    expect(javaHomeOf(ok(' \n'), release('JAVA_VERSION="17"'))).toEqual({ why: 'no JDK 17 (java_home -v 17 → nothing)' });
    expect(read).toEqual([]);
  });
});

describe('a kept file is never overwritten (io.ts: a run\'s evidence is never replaced)', () => {
  it('freshIn: the name itself, or the next free -2, -3 before its extension', () => {
    const dir = mkdtempSync(join(tmpdir(), 'batch-lab-lines-'));
    try {
      expect(freshIn(nodeFs, dir, 'x.json')).toBe(join(dir, 'x.json'));
      writeFileSync(join(dir, 'x.json'), '');
      writeFileSync(join(dir, 'x-2.json'), '');
      expect(freshIn(nodeFs, dir, 'x.json')).toBe(join(dir, 'x-3.json'));
      writeFileSync(join(dir, 'noext'), '');
      expect(freshIn(nodeFs, dir, 'noext')).toBe(join(dir, 'noext-2'));
      writeFileSync(join(dir, '.hidden'), '');
      expect(freshIn(nodeFs, dir, '.hidden')).toBe(join(dir, '.hidden-2'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
