import { describe, expect, it } from 'vitest';
import { hostProcessPattern, pgrepReason, pgrepVerdict } from '../../src/adapters/ios-liveness.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';

const U = 'D8DACDE6-1111-2222-3333-444455556666';
const OTHER = '37956039-94EA-4F51-93E5-94F7723A4578';
const G = '95E78B94-6D6B-4B15-8D47-45D88DDC2ABD';
const app = (udid: string, guid: string, exe: string, bundle = exe) =>
  `/Users/me/Library/Developer/CoreSimulator/Devices/${udid}/data/Containers/Bundle/Application/${guid}/${bundle}.app`;

/** The produced ERE, read by JS RegExp as its stand-in (every escape the module writes means the same in both). */
const matches = (pattern: string | undefined, argv: string) => {
  if (pattern === undefined) throw new Error('no pattern');
  return new RegExp(pattern).test(argv);
};

describe('hostProcessPattern — the bundle\'s exact executable path on THIS simulator, as pgrep -f reads it', () => {
  const lab = hostProcessPattern({ path: app(U, G, 'AveriLab'), executable: 'AveriLab' }, U);

  it('matches the measured argv form, alone and with arguments after it', () => {
    expect(matches(lab, `${app(U, G, 'AveriLab')}/AveriLab`)).toBe(true);
    expect(matches(lab, `${app(U, G, 'AveriLab')}/AveriLab -cell open`)).toBe(true);
  });

  it('is the escaped path, a slash, the escaped executable and the end anchor — exactly', () => {
    expect(hostProcessPattern({ path: '/x/' + U + '/data/Containers/Bundle/Application/G/A.app', executable: 'A' }, U)).toBe(
      `/x/${U}/data/Containers/Bundle/Application/G/A\\.app/A( |$)`,
    );
  });

  it('does not match the same path on another simulator', () => {
    expect(matches(lab, `${app(OTHER, G, 'AveriLab')}/AveriLab`)).toBe(false);
  });

  it('does not match another bundle with the same executable name (Flutter Runner, flavours) on this simulator', () => {
    const runner = hostProcessPattern({ path: app(U, G, 'Runner'), executable: 'Runner' }, U);
    expect(matches(runner, `${app(U, '00000000-6D6B-4B15-8D47-45D88DDC2ABD', 'Runner')}/Runner`)).toBe(false);
  });

  it('does not match an executable the name prefixes, in another bundle or in its own', () => {
    const foo = hostProcessPattern({ path: app(U, G, 'Foo'), executable: 'Foo' }, U);
    expect(matches(foo, `${app(U, G, 'FooBar')}/FooBar`)).toBe(false);
    expect(matches(foo, `${app(U, G, 'Foo')}/FooHelper`)).toBe(false);
  });

  it('does not match an extension or XPC service inside the bundle', () => {
    const foo = hostProcessPattern({ path: app(U, G, 'Foo'), executable: 'Foo' }, U);
    expect(matches(foo, `${app(U, G, 'Foo')}/PlugIns/W.appex/W`)).toBe(false);
    expect(matches(foo, `${app(U, G, 'Foo')}/XPCServices/X.xpc/X`)).toBe(false);
  });

  it('does not match its own text — a concurrent pgrep never reads as the app', () => {
    expect(matches(lab, `/usr/bin/pgrep -f ${lab}`)).toBe(false);
    expect(matches(lab, lab!)).toBe(false);
  });

  it('every ERE special in path and executable is literal; nothing else is escaped', () => {
    const odd = 'A.b+c(d) e$f[g]*h?i{j}k|l^m\\n-o';
    const path = `/Users/a b/${U}/data/Containers/Bundle/Application/${G}/${odd}.app`;
    const pattern = hostProcessPattern({ path, executable: odd }, U);
    expect(matches(pattern, `${path}/${odd}`)).toBe(true);
    expect(matches(pattern, `${path}/${odd.replace('.', 'X')}`)).toBe(false);
    expect(matches(pattern, `${path.replace('A.b', 'AXb')}/${odd}`)).toBe(false);
    expect(pattern).not.toMatch(/\\[-/ ]/);
    expect(pattern).toContain('\\.b\\+c\\(d\\) e\\$f\\[g\\]\\*h\\?i\\{j\\}k\\|l\\^m\\\\n-o');
  });

  it('no pattern for a path outside this simulator\'s user-app containers (a system app, another device)', () => {
    const contacts = '/Library/Developer/CoreSimulator/Volumes/iOS_24A434/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/Applications/Contacts.app';
    expect(hostProcessPattern({ path: contacts, executable: 'Contacts' }, U)).toBeUndefined();
    expect(hostProcessPattern({ path: app(OTHER, G, 'AveriLab'), executable: 'AveriLab' }, U)).toBeUndefined();
    expect(hostProcessPattern({ path: `/x/${U}/data/Containers/Data/Application/${G}/A.app`, executable: 'A' }, U)).toBeUndefined();
  });

  it("the UDID is this simulator's whatever its case", () => {
    const pattern = hostProcessPattern({ path: app(U, G, 'AveriLab'), executable: 'AveriLab' }, U.toLowerCase());
    expect(matches(pattern, `${app(U, G, 'AveriLab')}/AveriLab`)).toBe(true);
    expect(hostProcessPattern({ path: app(U.toLowerCase(), G, 'A'), executable: 'A' }, U)).toBeDefined();
    expect(hostProcessPattern({ path: app(OTHER.toLowerCase(), G, 'A'), executable: 'A' }, U)).toBeUndefined();
  });

  it('no pattern without a path or an executable (an appinfo format drift)', () => {
    expect(hostProcessPattern({ executable: 'AveriLab' }, U)).toBeUndefined();
    expect(hostProcessPattern({ path: app(U, G, 'AveriLab') }, U)).toBeUndefined();
    expect(hostProcessPattern({ path: app(U, G, 'AveriLab'), executable: '' }, U)).toBeUndefined();
  });
});

describe('pgrepVerdict — what pgrep\'s outcome says about the host process list', () => {
  const failed = (code: number | null, timedOut = false) => execErrorLikeExec('/usr/bin/pgrep -f x', code, 'err', { timedOut });

  it('success is a match', () => {
    expect(pgrepVerdict(undefined)).toBe('yes');
  });

  it('exit 1 is no match', () => {
    expect(pgrepVerdict(failed(1))).toBe('no');
  });

  it('exit 2 (usage/regex), exit 3 (no process list), any other exit, or a spawn failure is an unreadable list', () => {
    expect(pgrepVerdict(failed(2))).toBe('unreadable');
    expect(pgrepVerdict(failed(3))).toBe('unreadable');
    expect(pgrepVerdict(failed(0))).toBe('unreadable');
    expect(pgrepVerdict(failed(null))).toBe('unreadable');
    expect(pgrepVerdict(new Error('spawn EPERM'))).toBe('unreadable');
  });

  it("only exec's ExecError is read: another error carrying an exit code or a timeout flag is an unreadable list", () => {
    expect(pgrepVerdict(Object.assign(new Error('x'), { exitCode: 1 }))).toBe('unreadable');
    expect(pgrepVerdict(Object.assign(new Error('x'), { timedOut: true }))).toBe('unreadable');
  });

  it('a timeout is its own outcome, whatever the exit code reads', () => {
    expect(pgrepVerdict(failed(null, true))).toBe('timeout');
    expect(pgrepVerdict(failed(1, true))).toBe('timeout');
  });
});

describe("pgrepReason — pgrep's own words for the stderr line, not its command line", () => {
  const cmd = '/usr/bin/pgrep -f /a/very/long/pattern\\.app/X( |$)';
  const NO_HOME = '';

  it('a host path in that line leaves it (ADR 0043)', () => {
    expect(pgrepReason(execErrorLikeExec(cmd, 3, 'pgrep: /Users/lab/x unreadable\n'), NO_HOME)).toBe('exit 3: pgrep: ~/x unreadable');
    expect(pgrepReason(execErrorLikeExec(cmd, null, 'spawn /Users/lab/pgrep ENOENT\n'), NO_HOME)).toBe('spawn ~/pgrep ENOENT');
  });

  it('the home is the caller\'s: this leaf reads nothing', () => {
    expect(pgrepReason(execErrorLikeExec(cmd, 3, 'pgrep: https://h/opt/me/x\n'), '/opt/me')).toBe('exit 3: pgrep: https://h~/x');
  });

  it("an exit: its code and stderr's last non-empty line", () => {
    expect(pgrepReason(execErrorLikeExec(cmd, 3, 'pgrep: warning\nsysmon request failed with error: sysmond service not found  \n   \n'), NO_HOME)).toBe(
      'exit 3: sysmon request failed with error: sysmond service not found',
    );
  });

  it("an exit with nothing on stderr: exec's stand-in message's last line — the code alone when that is the command", () => {
    expect(pgrepReason(execErrorLikeExec(cmd, 2, ''), NO_HOME)).toBe('exit 2');
  });

  it('no exit code (a spawn failure): the last line alone, or that there was no exit code', () => {
    expect(pgrepReason(execErrorLikeExec(cmd, null, 'spawn /usr/bin/pgrep ENOENT'), NO_HOME)).toBe('spawn /usr/bin/pgrep ENOENT');
    expect(pgrepReason(execErrorLikeExec(cmd, null, ''), NO_HOME)).toBe('no exit code');
  });

  it("another error: its message's first line", () => {
    expect(pgrepReason(new Error('boom\nmore'), NO_HOME)).toBe('boom');
    expect(pgrepReason('odd', NO_HOME)).toBe('odd');
  });
});
