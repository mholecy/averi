import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandFailureText, lastResortText, withoutHostPaths } from '../../src/adapters/failure-text.js';

const HOME = '/Users/me';
/** Roots tests/docs/path-hygiene.test.ts strikes in a committed file, spelled apart: here they are the subject, no machine's. */
const USERS = ['', 'Users'].join('/');
const PRIVATE = ['', 'private'].join('/');
const VOLUMES = ['', 'Volumes'].join('/');
const failed = (command: string, stderr: string, extra: { exitCode?: number | null; timedOut?: boolean; note?: string } = {}) =>
  commandFailureText({ command, exitCode: extra.exitCode === undefined ? 1 : extra.exitCode, stderr, timedOut: extra.timedOut ?? false, note: extra.note }, HOME);

/** docs/truth/live-records/ios-forms-a9.json, b1d under idb: its record wrote the home as `~`. Put back here, as idb printed it. */
const RECORDED_CRASH = readFileSync(new URL('../fixtures/idb-ui-text-no-keycode-traceback-b1d-stderr.txt', import.meta.url), 'utf8');
const CRASH_WITH_HOME = RECORDED_CRASH.replaceAll('"~/', `"${HOME}/`);

describe('lastResortText: the words when wording throws', () => {
  it('names only the tool and the exit, or the timeout', () => {
    const base = { exitCode: 1, stderr: 'said', timedOut: false, note: 'n' };
    expect(lastResortText({ ...base, command: 'idb ui text hunter2 --udid U' })).toBe('Command failed (exit 1): idb');
    expect(lastResortText({ ...base, command: '/opt/homebrew/bin/adb -s S install /Users/me/a.apk' })).toBe('Command failed (exit 1): adb');
    expect(lastResortText({ ...base, command: 'idb x', timedOut: true })).toBe('Command timed out: idb');
    expect(lastResortText({ ...base, exitCode: null, command: 'idb x' })).toBe('Command failed (exit null): idb');
  });

  it('reads no more of a huge argv than a tool\'s name can take', () => {
    expect(lastResortText({ exitCode: 1, stderr: '', timedOut: false, command: `${'x'.repeat(300)} y` })).toBe(`Command failed (exit 1): ${'x'.repeat(256)}`);
  });

  it('cannot throw, on any value', () => {
    const odd = { toString: () => { throw new Error('no'); } } as unknown as string;
    expect(lastResortText({ exitCode: 1, stderr: '', timedOut: false, command: odd })).toBe('Command failed');
    expect(lastResortText({ exitCode: Symbol('x') as unknown as number, stderr: '', timedOut: false, command: 'c' })).toBe('Command failed');
  });
});

describe('commandFailureText: a command failure with nothing to take out', () => {
  it('is exec\'s shape to the byte', () => {
    expect(failed('adb -s emulator-9998 shell monkey -p dev.averi.lab 1', "\nadb: device 'emulator-9998' not found\n"))
      .toBe("Command failed (exit 1): adb -s emulator-9998 shell monkey -p dev.averi.lab 1\nadb: device 'emulator-9998' not found");
    expect(failed('idb ui tap 1 2 --udid U', 'x', { exitCode: null })).toBe('Command failed (exit null): idb ui tap 1 2 --udid U\nx');
  });

  it('says a timeout without its stderr, and a note on its own last line', () => {
    expect(failed('adb devices', 'ignored', { timedOut: true })).toBe('Command timed out: adb devices');
    expect(failed('adb devices', 'said', { note: 'monkey: stdout tail' })).toBe('Command failed (exit 1): adb devices\nsaid\nmonkey: stdout tail');
    expect(failed('adb devices', '', { timedOut: true, note: 'n' })).toBe('Command timed out: adb devices\nn');
  });
});

describe('commandFailureText: a Python traceback', () => {
  it('shrinks the recorded idb crash to the tool, its exception and how to see the trace', () => {
    expect(failed('idb describe --udid U', CRASH_WITH_HOME)).toBe(
      'Command failed (exit 1): idb describe --udid U\n' +
        'idb crashed: Exception: No keycode found for Š (Python traceback left out: run the command by hand, with the real text and paths, to see it)',
    );
  });

  it('reads the last traceback of a chain, and only the first line of a long exception message', () => {
    const chain =
      'Traceback (most recent call last):\n  File "a.py", line 1, in a\nKeyError: 1\n\n' +
      'During handling of the above exception, another exception occurred:\n\n' +
      'Traceback (most recent call last):\n  File "b.py", line 2, in b\n    raise X\n\ngrpclib.GRPCError: (UNAVAILABLE, down)\n  more detail\nand more\n';
    expect(failed('idb ui tap 1 2 --udid U', chain).split('\n')[1]).toMatch(/^idb crashed: grpclib\.GRPCError: \(UNAVAILABLE, down\) \(Python/);
  });

  it('reads an exception group, whose lines sit behind a margin', () => {
    const group =
      '  + Exception Group Traceback (most recent call last):\n  |   File "a.py", line 1, in a\n  | ExceptionGroup: unhandled errors (1 sub-exception)\n' +
      '  +-+---------------- 1 ----------------\n    | Traceback (most recent call last):\n    |   File "b.py", line 2, in b\n    | ValueError: boom\n    +------------------------------------\n';
    expect(failed('idb x', group).split('\n')[1]).toMatch(/^idb crashed: ValueError: boom \(Python/);
  });

  it('says only the crash when the traceback was cut before its exception', () => {
    expect(failed('idb x', 'Traceback (most recent call last):\n  File "a.py", line 1, in a\n').split('\n')[1])
      .toBe('idb crashed (Python traceback left out: run the command by hand, with the real text and paths, to see it)');
  });

  it('takes an exception group\'s rule for no exception, when the traceback was cut there', () => {
    const left = 'idb crashed (Python traceback left out: run the command by hand, with the real text and paths, to see it)';
    expect(failed('idb x', '  + Exception Group Traceback (most recent call last):\n  |   File "a.py", line 1, in a\n  +-+---------------- 1 ----------------\n').split('\n')[1]).toBe(left);
    expect(failed('idb x', '    | Traceback (most recent call last):\n    |   File "b.py", line 2, in b\n    +------------------------------------\n').split('\n')[1]).toBe(left);
  });

  it('reads a traceback with CRLF line ends', () => {
    const crlf = 'Traceback (most recent call last):\r\n  File "a.py", line 1, in a\r\nValueError: boom\r\n';
    expect(failed('idb x', crlf).split('\n')[1]).toMatch(/^idb crashed: ValueError: boom \(Python/);
  });

  it('takes the message from the next line when the exception line ends at its colon', () => {
    const blank = 'Traceback (most recent call last):\n  File "a.py", line 1, in a\nException: \n\n  real reason  \nmore\n';
    expect(failed('idb x', blank).split('\n')[1]).toMatch(/^idb crashed: Exception: real reason \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nException:\n   \n  why\n').split('\n')[1]).toMatch(/^idb crashed: Exception: why \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nException:\n').split('\n')[1]).toMatch(/^idb crashed: Exception: \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nValueError: a: b\nnext\n').split('\n')[1]).toMatch(/^idb crashed: ValueError: a: b \(Python/);
  });

  it('joins only an indented next line: a log line and an exception group\'s rule are no message', () => {
    expect(failed('idb x', 'Traceback (most recent call last):\nException: connect to:\n2026 [INFO] token=abc\n').split('\n')[1]).toMatch(/^idb crashed: Exception: connect to: \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nException: x:\n  +------------\n').split('\n')[1]).toMatch(/^idb crashed: Exception: x: \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nException: x:\n  not-found\n').split('\n')[1]).toMatch(/^idb crashed: Exception: x: not-found \(Python/);
    expect(failed('idb x', 'Traceback (most recent call last):\nException: x:\n  -----\n  why\n').split('\n')[1]).toMatch(/^idb crashed: Exception: x: why \(Python/);
  });

  it('drops the lines around the traceback', () => {
    expect(failed('idb x', 'warning before\nTraceback (most recent call last):\nE: x\nnote after\n')).toBe(
      'Command failed (exit 1): idb x\nidb crashed: E: x (Python traceback left out: run the command by hand, with the real text and paths, to see it)',
    );
  });

  it('names the tool: a path\'s last word, and what xcrun ran', () => {
    const tb = 'Traceback (most recent call last):\nE: x\n';
    expect(failed('/opt/homebrew/bin/idb x', tb).split('\n')[1]).toMatch(/^idb crashed: E: x/);
    expect(failed('xcrun simctl list', tb).split('\n')[1]).toMatch(/^simctl crashed: E: x/);
    expect(failed('xcrun', tb).split('\n')[1]).toMatch(/^xcrun crashed: E: x/);
  });

  it('leaves a stderr that only mentions a traceback alone', () => {
    for (const mention of ['see the Traceback (most recent call last): above', 'see Traceback (most recent call last):', 'Traceback (most recent call last): above']) {
      expect(failed('idb x', mention).split('\n')[1]).toBe(mention);
    }
  });

  it('keeps a note beside the crash', () => {
    expect(failed('idb x', 'Traceback (most recent call last):\nE: x\n', { note: 'n' }).split('\n')[2]).toBe('n');
  });
});

describe('commandFailureText: host paths', () => {
  const said = (text: string) => failed('tool', text).split('\n')[1];

  it('takes the user\'s home out wherever it stands, a URL\'s path too, and only that folder', () => {
    expect(said('open /Users/me/.idb/x.log failed')).toBe('open ~/.idb/x.log failed');
    expect(said('cwd=/Users/me')).toBe('cwd=~');
    expect(said('file:///Users/me/a https://h/Users/me/b')).toBe('file://~/a https://h~/b');
    expect(said('https://h/Users/me.old/a')).toBe('https://h/Users/me.old/a');
    expect(commandFailureText({ command: 'c', exitCode: 1, stderr: '/data/a b/a /Users/a b/a', timedOut: false }, '/Users/a b').split('\n')[1]).toBe('/data/a b/a ~/a');
  });

  it('takes out any macOS or Linux home at a word\'s start, another user\'s too', () => {
    expect(said('/Users/lab/a "/home/x/b" (/root/c) /root')).toBe('~/a "~/b" (~/c) ~');
    expect(said("'/Users/lab' [/home/x/d], <file:///Users/lab/e>")).toBe("'~' [~/d], <file://~/e>");
    expect(said('`/Users/lab/f`')).toBe('`~/f`');
  });

  it('leaves what is no home', () => {
    for (const kept of [`${USERS}/Shared/a`, '/rootfs/a', '/homework/a', '/Users', '/home', 'https://h/Users/lab/a', 'x=/home/x/a', 'myapp:/home/x/a']) {
      expect(said(kept)).toBe(kept);
    }
  });

  it('reduces a temporary path to its basename', () => {
    expect(said(`/tmp/x/b.apk ${PRIVATE}/tmp/c /var/tmp/d ${PRIVATE}/var/tmp/e`)).toBe('<tmp>/b.apk <tmp>/c <tmp>/d <tmp>/e');
    expect(said('/var/folders/x/T/x.swift:10:3: error')).toBe('<tmp>/x.swift:10:3: error');
    expect(said(`"${PRIVATE}/var/folders/x/T/y"`)).toBe('"<tmp>/y"');
    expect(said('/tmp /tmp/')).toBe('<tmp> <tmp>');
    expect(said('(/tmp/x) [/tmp/x], </tmp/x>')).toBe('(<tmp>/x) [<tmp>/x], <<tmp>/x>');
    expect(said('`/tmp/x` "/tmp/x"')).toBe('`<tmp>/x` "<tmp>/x"');
    expect(said('/tmp/x,/tmp/x `/tmp/x`/tmp/x')).toBe('<tmp>/x,<tmp>/x `<tmp>/x`<tmp>/x');
  });

  it('reduces a path under the Mac\'s volumes and /opt to its basename', () => {
    expect(said(`${VOLUMES}/Disk/app/b.ipa /opt/homebrew/bin/idb`)).toBe('…/b.ipa …/idb');
    expect(said(`${VOLUMES} /opt`)).toBe('… …');
  });

  it('never touches a device path or a URL\'s path', () => {
    for (const kept of ['/sdcard/Download/a.png', '/data/local/tmp/a.xml', '/data/user/0/dev.averi/tmp/a', '/storage/emulated/0/a', '/system/bin/sh', 'https://example.com/tmp/a', 'myapp://tmp/a', 'myapp:/tmp/a', 'file:///tmp/a', 'https://example.com/?next=/tmp/x', 'a/tmp/b', '/tmpfs/a', '/optional/a', `${VOLUMES}2/a`]) {
      expect(said(kept)).toBe(kept);
    }
  });

  it('takes them out of the command and the note too, keeps a line count', () => {
    expect(failed('adb -s S install -r /Users/me/b/app.apk', 'adb: failed', { note: 'see /tmp/x' }))
      .toBe('Command failed (exit 1): adb -s S install -r ~/b/app.apk\nadb: failed\nsee <tmp>/x');
    expect(failed('adb push /tmp/x /sdcard/a.png', 'e', { timedOut: true })).toBe('Command timed out: adb push <tmp>/x /sdcard/a.png');
  });

  it('asks nothing of a home that is the root folder', () => {
    expect(commandFailureText({ command: 'c', exitCode: 1, stderr: '/sdcard/', timedOut: false }, '/')).toBe('Command failed (exit 1): c\n/sdcard/');
    expect(commandFailureText({ command: 'c', exitCode: 1, stderr: '/sdcard/a', timedOut: false }, '')).toBe('Command failed (exit 1): c\n/sdcard/a');
  });

  const inHome = (text: string, home: string) => withoutHostPaths(text, home);

  it('a home of one folder goes at a word\'s start only: the anywhere rule would cut device paths', () => {
    expect(inHome('/data/local/tmp/a.xml /tmp/x', '/tmp')).toBe('/data/local/tmp/a.xml ~/x');
    expect(inHome('/sys/root/a', '/root')).toBe('/sys/root/a');
    expect(inHome('/data/var/a /var/b', '/var')).toBe('/data/var/a ~/b');
    expect(inHome('/tmpfs/a', '/tmp')).toBe('/tmpfs/a');
  });

  it('a home of two folders or more goes anywhere, and ends where its folder ends', () => {
    expect(inHome('https://h/opt/me/a', '/opt/me')).toBe('https://h~/a');
    expect(inHome('https://h/opt/mel/a https://h/opt/me.old https://h/opt/me-2', '/opt/me')).toBe('https://h/opt/mel/a https://h/opt/me.old https://h/opt/me-2');
  });

  it('a home that is no absolute path takes nothing out', () => {
    expect(inHome('ab abc /ab/c', 'ab')).toBe('ab abc /ab/c');
    expect(inHome('a/b', 'a/b')).toBe('a/b');
  });

  it('a home with a trailing slash is the same home', () => {
    expect(inHome('https://h/opt/me/a', '/opt/me/')).toBe('https://h~/a');
    expect(inHome('https://h/opt/me/a', '/opt/me//')).toBe('https://h~/a');
    expect(inHome('/sdcard/', '/')).toBe('/sdcard/');
    expect(inHome('/tmp/x', '/tmp/')).toBe('~/x');
  });

  it('a home with a regular expression\'s characters is taken literally', () => {
    expect(commandFailureText({ command: 'c', exitCode: 1, stderr: '/data/a+b/c /data/aab/c', timedOut: false }, '/data/a+b').split('\n')[1]).toBe('~/c /data/aab/c');
  });
});

describe('commandFailureText: typed text', () => {
  it('stays out of an idb ui text argv, whatever it holds', () => {
    expect(failed('idb ui text hunter2 --udid U', 'e')).toBe('Command failed (exit 1): idb ui text <typed text> --udid U\ne');
    expect(failed('idb ui text a b --udid c --udid U', 'e', { timedOut: true })).toBe('Command timed out: idb ui text <typed text> --udid U');
    expect(failed('idb ui text a --udid AAAA-1111', 'e').split('\n')[0]).toBe('Command failed (exit 1): idb ui text <typed text> --udid AAAA-1111');
    expect(failed('idb ui text line\ntwo --udid U', 'e')).toBe('Command failed (exit 1): idb ui text <typed text> --udid U\ne');
  });

  it('stays out of an adb input text argv, one character or many', () => {
    expect(failed("adb -s emulator-5554 shell input text 'h'", 'e')).toBe('Command failed (exit 1): adb -s emulator-5554 shell input text <typed text>\ne');
    expect(failed("adb shell input text '%s'", 'e', { timedOut: true })).toBe('Command timed out: adb shell input text <typed text>');
  });

  it('stays out of node\'s own line, which exec puts in stderr for a silent child', () => {
    expect(failed('idb ui text hunter2 --udid U', 'Command failed: idb ui text hunter2 --udid U\n'))
      .toBe('Command failed (exit 1): idb ui text <typed text> --udid U\nCommand failed: idb ui text <typed text> --udid U');
  });

  it('leaves every other argv as it is', () => {
    for (const command of ['idb ui tap 1 2 --udid U', 'idb ui key 40 --udid U', 'adb -s S shell input tap 1 2', 'adb -s S shell input keyevent 66', 'xcrun simctl openurl U ui text', 'echo idb ui text a --udid U', 'idb ui text a --udid U and more']) {
      expect(failed(command, 'e')).toBe(`Command failed (exit 1): ${command}\ne`);
    }
  });

  it('idb\'s argparse line leaves a typing\'s stderr, whatever it quotes; the usage stays', () => {
    const rejected = 'idb rejected its arguments (its error line, which can quote the typed text, is left out)';
    expect(failed('idb ui text --log=s3cret --udid U', "usage: idb [-h]\nidb: error: argument --log: invalid choice: 's3cret'\n", { exitCode: 2 }))
      .toBe(`Command failed (exit 2): idb ui text <typed text> --udid U\nusage: idb [-h]\n${rejected}`);
    expect(failed('idb ui text -abc --udid U', 'idb ui text: error: the following arguments are required: text\n', { exitCode: 2 }).split('\n')[1]).toBe(rejected);
  });

  it('a line before argparse\'s stays, argparse\'s goes wherever it stands, and all it echoes goes with it: argparse exits right after it', () => {
    const rejected = 'idb rejected its arguments (its error line, which can quote the typed text, is left out)';
    expect(failed('idb ui text -hunter2 --udid U', "log: error: earlier\nidb ui text: error: ignored explicit argument 'unter2'\n", { exitCode: 2 }).split('\n').slice(1))
      .toEqual(['log: error: earlier', rejected]);
    expect(failed('idb ui text --c=a\nsecret --udid U', 'idb: error: ambiguous option: --c=a\nsecret could match --companion\n', { exitCode: 2 }).split('\n').slice(1)).toEqual([rejected]);
  });

  it('only exit 2 is argparse, and only a line naming idb: another tool\'s error keeps its words', () => {
    expect(failed('idb ui text a --udid U', 'idb ui text: error: gone', { exitCode: 1 }).split('\n')[1]).toBe('idb ui text: error: gone');
    expect(failed('idb ui text a --udid U', 'grpc: error: connection refused to companion', { exitCode: 2 }).split('\n')[1]).toBe('grpc: error: connection refused to companion');
    expect(failed('idb ui text a --udid U', 'my idb: error: x', { exitCode: 2 }).split('\n')[1]).toBe('my idb: error: x');
    expect(failed('idb ui text a --udid U', 'idb: x: error: y', { exitCode: 2 }).split('\n')[1]).toBe('idb: x: error: y');
  });

  it('that line stays on every other command, and on Android\'s typing, whose adb errors name the device', () => {
    const line = 'idb describe: error: bad choice';
    expect(failed('idb describe --udid U', line, { exitCode: 2 }).split('\n')[1]).toBe(line);
    expect(failed('adb -s S shell input text h', 'adb: error: connect failed: closed').split('\n')[1]).toBe('adb: error: connect failed: closed');
  });

  it('a stderr line that merely holds the words stays on a typing', () => {
    expect(failed('idb ui text a --udid U', 'x: y: error: z\nerror: gone').split('\n').slice(1)).toEqual(['x: y: error: z', 'error: gone']);
  });

  it('a home in a typed text goes with the text', () => {
    expect(failed('idb ui text /Users/me/x --udid U', 'e')).toBe('Command failed (exit 1): idb ui text <typed text> --udid U\ne');
  });
});
