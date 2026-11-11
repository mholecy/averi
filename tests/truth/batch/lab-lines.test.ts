import { describe, expect, it } from 'vitest';
import { DEVICE_CHECK_SIMULATOR } from '../../../scripts/truth/lab-device.js';
import { TIMED_OUT, type CallResult } from '../../../scripts/truth/batch/bounded.js';
import {
  cellsWhy,
  companionPattern,
  LSOF_ARGV,
  openInAlertOf,
  pkillOf,
  portHand,
  portOf,
  portPart,
  wdaKillPatterns,
  wdaBlockedOf,
  wdaHandOf,
  wdaRestoredOf,
  compareHand,
  disconnectArgv,
  disconnectWarning,
  idbFailText,
  jdk17Of,
  jdkLine,
  JVM_DIR,
  says17,
  jvmDirs,
  type JdkProbes,
  STALE_COMPANION_WHY,
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
  const restored = { ok: true as const, line: 'D43 WDA-window restore: OK — every domain equals its backup (nothing put back)' };
  const failed = { ok: false as const, line: 'D43 WDA-window restore: ERROR — NOT VERIFIED — com.apple.Accessibility NOT equal to its backup' };
  const hand = ['D43 (iOS): the window\'s hand lines'];

  it('restored with the port free: S4\'s line, the port named — free, or free once a listener was killed', () => {
    expect(wdaRestoredOf(restored, false, hand)).toEqual({ ok: true, line: 'D43 WDA-window restore: OK — every domain equals its backup (nothing put back); port 8120 free', hand: [] });
    expect(wdaRestoredOf(restored, true, hand).line).toMatch(/; port 8120 free \(a listener killed\)$/);
    // Not verified: the window's own hand lines (code review, MAJOR 1: one builder for every end).
    expect(wdaRestoredOf(failed, false, hand)).toEqual({ ok: false, line: `${failed.line}; port 8120 free`, hand });
  });

  it('the port not proven free (review round 1, BLOCKER): no restore at all — a runner still running undoes it at its exit; NOT VERIFIED, the state left dirty; the WDA\'s kill first, then each domain\'s lines, then the compare', () => {
    const domains = ['D43 (iOS): xcrun simctl spawn U defaults import com.apple.Accessibility /s/b.plist'];
    expect(wdaHandOf(LAB, domains, '/s/state.json')).toEqual([portHand(LAB), ...domains, compareHand('/s/state.json')]);
    expect(wdaBlockedOf({ state: 'busy', pids: [7] }, true, wdaHandOf(LAB, domains, '/s/state.json'))).toEqual({
      ok: false,
      line: 'D43 WDA-window restore: ERROR — NOT VERIFIED — port 8120 still has a listener (pid 7): the domains not put back (a WebDriverAgent still running undoes a restore at its exit); the state file left dirty',
      hand: [portHand(LAB), ...domains, compareHand('/s/state.json')],
    });
    expect(wdaBlockedOf({ state: 'unread', why: 'lsof: exit 2' }, false, []).line).toContain('port 8120 not read (lsof: exit 2): the domains not put back');
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

describe('the JDK for the Android build (batch-11.sh:309–310; T23: JAVA_HOME, else `java_home -v 17`, else the JVM folders)', () => {
  /** The probes: JAVA_HOME as given, java_home's answer, the JVM folders' entries, each home's release, javac. */
  const probes = (o: { env?: string; javaHome?: CallResult; entries?: Record<string, string[]>; releases?: Record<string, string>; jre?: string[] }) => {
    const asked: string[] = [];
    const p: JdkProbes = {
      javaHomeEnv: o.env,
      javaHome: async () => (asked.push('java_home'), o.javaHome ?? exit(1, 'Unable to locate a Java Runtime.\n')),
      jvms: ['/J', '/U'],
      list: (dir) => (asked.push(`list ${dir}`), o.entries?.[dir] ?? []),
      release: (home) => (asked.push(`release ${home}`), o.releases?.[home]),
      javac: (home) => !(o.jre ?? []).includes(home),
    };
    return { p, asked };
  };
  const R17 = 'IMPLEMENTOR="x"\nJAVA_VERSION="17.0.12"\n';
  const NO_JRE = 'Unable to locate a Java Runtime.';

  it('JAVA_HOME first, when it is a JDK 17: java_home never asked, no folder listed, nothing passed over', async () => {
    const { p, asked } = probes({ env: '/jdk17', javaHome: ok('/other\n'), releases: { '/jdk17': R17, '/other': R17 } });
    expect(await jdk17Of(p)).toEqual({ home: '/jdk17', from: 'JAVA_HOME' });
    expect(asked).toEqual(['release /jdk17']);
  });

  it('JAVA_HOME unset or empty: `java_home -v 17` next, its home checked; no warning (nothing passed over)', async () => {
    for (const env of [undefined, '']) {
      const { p, asked } = probes({ env, javaHome: ok('/jdk17\n'), releases: { '/jdk17': R17 } });
      expect(await jdk17Of(p)).toEqual({ home: '/jdk17', from: 'java_home' });
      expect(asked).toEqual(['java_home', 'release /jdk17']);
    }
  });

  it('JAVA_HOME set but no JDK 17 (release unread, another version, a JRE): java_home used, the warning says why', async () => {
    const releases = { '/jdk21': 'JAVA_VERSION="21.0.1"\n', '/jre17': R17, '/jdk17': R17 };
    const cases: [string, string][] = [
      ['/jdk21', "JAVA_HOME '/jdk21': its release says no 17"],
      ['/gone', "JAVA_HOME '/gone': its release file not read"],
      ['/jre17', "JAVA_HOME '/jre17': no bin/javac (a JRE)"],
    ];
    for (const [env, said] of cases) {
      const { p, asked } = probes({ env, javaHome: ok('/jdk17\n'), releases, jre: ['/jre17'] });
      expect(await jdk17Of(p)).toEqual({ home: '/jdk17', from: 'java_home', warning: `${said} — the build used the one from java_home` });
      expect(asked).toEqual([`release ${env}`, 'java_home', 'release /jdk17']);
    }
  });

  it('then the first *.jdk in the JVM folders, each sorted, in order — a JDK 17 home (the sandbox: java_home finds none)', async () => {
    const releases = {
      '/J/0-jre17/Contents/Home': R17,
      '/J/a-21.jdk/Contents/Home': 'JAVA_VERSION="21"\n',
      '/J/b-jre.jdk/Contents/Home': R17,
      '/J/c.jdk/Contents/Home': R17,
      '/J/d-17.jdk/Contents/Home': R17,
    };
    const { p, asked } = probes({ entries: { '/J': ['d-17.jdk', 'notes.txt', 'c.jdk', '0-jre17', 'b-jre.jdk', 'a-21.jdk'] }, releases, jre: ['/J/b-jre.jdk/Contents/Home'] });
    expect(await jdk17Of(p)).toEqual({ home: '/J/c.jdk/Contents/Home', from: 'JavaVirtualMachines', warning: `java_home -v 17 → nothing: exit 1 ${NO_JRE} — the build used the one from JavaVirtualMachines` });
    expect(asked).toEqual(['java_home', 'list /J', 'release /J/a-21.jdk/Contents/Home', 'release /J/b-jre.jdk/Contents/Home', 'release /J/c.jdk/Contents/Home']);
    // The user's folder (~/Library/Java/JavaVirtualMachines) after the system one; the system one's misses passed over.
    const user = probes({ entries: { '/J': ['a.jdk'], '/U': ['azul-17.0.19.jdk'] }, releases: { '/U/azul-17.0.19.jdk/Contents/Home': R17 } });
    expect(await jdk17Of(user.p)).toEqual({
      home: '/U/azul-17.0.19.jdk/Contents/Home',
      from: 'JavaVirtualMachines',
      warning: `java_home -v 17 → nothing: exit 1 ${NO_JRE}; /J: no JDK 17 among a.jdk (its release file not read) — the build used the one from JavaVirtualMachines`,
    });
    expect(user.asked).toEqual(['java_home', 'list /J', 'release /J/a.jdk/Contents/Home', 'list /U', 'release /U/azul-17.0.19.jdk/Contents/Home']);
  });

  it('none: why names every source tried, each with what it said', async () => {
    const entries = { '/J': ['a.jdk', 'b.jdk', 'c.jdk'] };
    const releases = { '/jdk21': 'JAVA_VERSION="21"\n', '/J/a.jdk/Contents/Home': 'IMPLEMENTOR_JAVA_VERSION="17"\n', '/J/c.jdk/Contents/Home': R17 };
    const { p } = probes({ env: '/jdk21', entries, releases, jre: ['/J/c.jdk/Contents/Home'] });
    expect(await jdk17Of(p)).toEqual({
      why:
        "no JDK 17 (JAVA_HOME '/jdk21': its release says no 17; java_home -v 17 → nothing: exit 1 Unable to locate a Java Runtime.; " +
        '/J: no JDK 17 among a.jdk (its release says no 17), b.jdk (its release file not read), c.jdk (no bin/javac (a JRE)); /U: no *.jdk (or unreadable))',
    });
    expect(await jdk17Of(probes({ javaHome: ok(' \n') }).p)).toEqual({ why: 'no JDK 17 (JAVA_HOME unset; java_home -v 17 → nothing; /J: no *.jdk (or unreadable); /U: no *.jdk (or unreadable))' });
    const unread = probes({ env: '/gone', javaHome: ok('/jdk\n'), releases: { '/jdk': 'JAVA_VERSION="170"\n' } }).p;
    expect(await jdk17Of(unread)).toMatchObject({ why: expect.stringMatching(/^no JDK 17 \(JAVA_HOME '\/gone': its release file not read; java_home -v 17 → '\/jdk': its release says no 17; \/J: /) });
    const noRelease = probes({ javaHome: exit(1, '', '/jdk\n'), releases: {} }).p;
    expect(await jdk17Of(noRelease)).toMatchObject({ why: expect.stringMatching(/^no JDK 17 \(JAVA_HOME unset; java_home -v 17 → nothing: exit 1 \/jdk; \/J: /) });
    expect(await jdk17Of(probes({ javaHome: ok('/x\n') }).p)).toMatchObject({ why: expect.stringContaining("java_home -v 17 → '/x': its release file not read; ") });
    expect(await jdk17Of(probes({ javaHome: ok('/x\n'), releases: { '/x': R17 }, jre: ['/x'] }).p)).toMatchObject({ why: expect.stringContaining("java_home -v 17 → '/x': no bin/javac (a JRE); ") });
  });

  it('the version check: JAVA_VERSION="17" or "17.…" on a line of its own; not 170, not another key ending in it', () => {
    expect([R17, 'JAVA_VERSION="17"', 'X=1\nJAVA_VERSION="17.0.19"'].map(says17)).toEqual([true, true, true]);
    expect(['JAVA_VERSION="170"', 'IMPLEMENTOR_JAVA_VERSION="17"', 'JAVA_VERSION="21.0.1"', 'JAVA_VERSION=17', ''].map(says17)).toEqual([false, false, false, false, false]);
  });

  it('the line naming the winner: `JDK 17: <home> (from <source>)`; the folders: the system one, the user\'s', () => {
    expect(jdkLine({ home: '/J/zulu-17.jdk/Contents/Home', from: 'JavaVirtualMachines' })).toBe('JDK 17: /J/zulu-17.jdk/Contents/Home (from JavaVirtualMachines)');
    expect(jdkLine({ home: '/a\nb', from: 'JAVA_HOME' })).toBe('JDK 17: "/a\\nb" (from JAVA_HOME)');
    expect(JVM_DIR).toBe('/Library/Java/JavaVirtualMachines');
    expect(jvmDirs('/Users/me')).toEqual([JVM_DIR, '/Users/me/Library/Java/JavaVirtualMachines']);
  });
});

describe("batch-13 fixes: idb's companion entry — the disconnect's argv and warning, the stale entry's words", () => {
  it('batch-13: `idb disconnect <lab udid>`, the udid alone (never `idb kill`); device-check\'s simulator refused, whatever its case', () => {
    expect(disconnectArgv(LAB)).toEqual(['disconnect', LAB]);
    for (const udid of [DEVICE_CHECK_SIMULATOR, DEVICE_CHECK_SIMULATOR.toLowerCase()]) expect(() => disconnectArgv(udid)).toThrow(/device-check simulator/);
  });

  it('batch-13: a disconnect that answered warns of nothing; one that failed or passed its bound: the entry may be stale, why', () => {
    expect(disconnectWarning(ok())).toBeUndefined();
    expect(disconnectWarning(exit(1, 'DisconnectCommandException: Could not disconnect from X:None\nmore'))).toBe("idb's companion entry may be stale — idb disconnect: exit 1 DisconnectCommandException: Could not disconnect from X:None");
    expect(disconnectWarning(timedOut)).toBe("idb's companion entry may be stale — idb disconnect: past its bound (exit 142)");
    expect(disconnectWarning({ ...ok(), timedOut: true })).toBe("idb's companion entry may be stale — idb disconnect: past its bound (exit 0)");
  });

  it('batch-13 rerun 1: idb\'s "Failed to connect to companion" (stderr or stdout, any line) names the stale entry as the likely cause; other words are left as they are', () => {
    const said = "Failed to connect to companion at address DomainSocketAddress(path='<idb>/X_companion.sock'): [Errno 2] No such file or directory";
    expect(idbFailText(exit(1, said))).toBe(`exit 1 ${said} — ${STALE_COMPANION_WHY}`);
    expect(idbFailText(exit(1, 'Traceback (most recent call last):\n' + said))).toBe(`exit 1 Traceback (most recent call last): — ${STALE_COMPANION_WHY}`);
    expect(idbFailText(exit(1, '', said))).toBe(`exit 1 ${said} — ${STALE_COMPANION_WHY}`);
    expect(idbFailText(exit(1, 'No translation object returned'))).toBe('exit 1 No translation object returned');
    expect(STALE_COMPANION_WHY).toBe("idb's local list names a companion for this simulator that does not answer: most likely a stale entry");
  });
});
