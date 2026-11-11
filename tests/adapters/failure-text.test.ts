import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { commandFailureText, lastResortText, shownCommand, withoutHostPaths } from '../../src/adapters/failure-text.js';

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

  it('reads a header behind a log prefix, its frames beneath it', () => {
    const logged = '2026-10-19 05:39:32 [ERROR] Traceback (most recent call last):\n  File "/Users/me/a.py", line 1, in a\nValueError: boom\n';
    expect(failed('idb x', logged).split('\n').slice(1)).toEqual([expect.stringMatching(/^idb crashed: ValueError: boom \(Python/)]);
    expect(failed('idb x', '[ERROR]Traceback (most recent call last):\n  File "a.py", line 1, in a\nE: x\n').split('\n')[1]).toMatch(/^idb crashed: E: x/);
    expect(failed('idb x', 'first\n  [E] Traceback (most recent call last):\n  File "a.py", line 1, in a\nE: x\n').split('\n')[1]).toMatch(/^idb crashed: E: x/);
  });

  it('no frame beneath it, a prefixed header is a mention', () => {
    for (const mention of ['see Traceback (most recent call last):\nnext', 'see Traceback (most recent call last):', 'see Traceback (most recent call last):\nFile "a.py" said', 'seeTraceback (most recent call last):\n  File "a.py"', 'x Traceback (most recent call last): more\n  File "a.py"', 'see Traceback (most recent call last):\nhe said File "a.py"']) {
      expect(failed('idb x', mention).split('\n').slice(1).join('\n')).toBe(mention);
    }
  });

  it('bounds the exception line, at 300 characters and an ellipsis', () => {
    const at = (length: number) => failed('idb x', `Traceback (most recent call last):\nE${'x'.repeat(length - 1)}\n`).split('\n')[1];
    expect(at(300)).toBe(`idb crashed: E${'x'.repeat(299)} (Python traceback left out: run the command by hand, with the real text and paths, to see it)`);
    expect(at(301)).toBe(`idb crashed: E${'x'.repeat(299)}… (Python traceback left out: run the command by hand, with the real text and paths, to see it)`);
  });

  it('scrubs before it bounds: a home across the cut goes whole', () => {
    const text = `E ${'x'.repeat(288)} /srv/alice/secret.log and more ${'y'.repeat(50)}`;
    const said = commandFailureText({ command: 'idb x', exitCode: 1, stderr: `Traceback (most recent call last):\n${text}\n`, timedOut: false }, '/srv/alice').split('\n')[1];
    expect(said).not.toContain('/srv');
    expect(said).toContain(`E ${'x'.repeat(288)} ~/secret`);
    expect(said).toMatch(/…\s\(Python/);
  });

  it('cuts on code points, never inside a surrogate pair', () => {
    const at = (text: string) => failed('idb x', `Traceback (most recent call last):\n${text}\n`).split('\n')[1].replace(/ \(Python.*$/, '').replace('idb crashed: ', '');
    expect(at(`${'x'.repeat(299)}😀y`)).toBe(`${'x'.repeat(299)}😀…`);
    expect(at('😀'.repeat(300))).toBe('😀'.repeat(300));
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
    expect(said('/Users/lab/a,/home/x/b')).toBe('~/a,~/b');
  });

  it('leaves what is no home', () => {
    for (const kept of [`${USERS}/Shared/a`, '/rootfs/a', '/homework/a', '/Users', '/home', 'https://h/Users/lab/a', 'myapp:/home/x/a']) {
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
    expect(said('/opt/a,/opt/b')).toBe('…/a,…/b');
  });

  it('never touches a device path or a URL\'s path', () => {
    for (const kept of ['/sdcard/Download/a.png', '/data/local/tmp/a.xml', '/data/user/0/dev.averi/tmp/a', '/storage/emulated/0/a', '/system/bin/sh', 'https://example.com/tmp/a', 'myapp://tmp/a', 'myapp:/tmp/a', 'file:///data/local/tmp/a', 'file:///sdcard/a', 'https://example.com/?next=/tmp/x', 'a/tmp/b', '/tmpfs/a', '/optional/a', `${VOLUMES}2/a`]) {
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

  it('leaves a word with a URL alone, whatever marks stand inside it', () => {
    for (const url of ['myapp://o/p,/tmp/x', 'myapp://o/a?x=(/home/x/a)', 'https://x.y/a,/Users/lab/profile', '(https://x.y/a=/opt/b)', 'a+b.c-d://o,/tmp/x']) {
      expect(said(url)).toBe(url);
    }
    expect(said('myapp://o/p /tmp/x')).toBe('myapp://o/p <tmp>/x');
    expect(said('MYAPP://o/p,/tmp/x')).toBe('MYAPP://o/p,/tmp/x');
  });

  it('a word starting with a scheme is a URL with or without `//`, file: apart', () => {
    for (const url of ['myapp:open?next=/home/x/a', 'mailto:a@b?body=/tmp/x', 'myapp:/go?p=/opt/x', 'MYAPP:a=/tmp/x', 'a+b.c-d:a=/tmp/x']) {
      expect(said(url)).toBe(url);
    }
    expect(said('file:a=/tmp/x')).toBe('file:a=<tmp>/x');
    expect(said('x=myapp:a=/tmp/x')).toBe('x=myapp:a=<tmp>/x');
    expect(said('1a:b=/tmp/x')).toBe('1a:b=<tmp>/x');
  });

  it('the own home goes from a URL word too; file:// is no such word', () => {
    expect(said('myapp://o,/Users/me/a')).toBe('myapp://o,~/a');
    expect(said('file:///tmp/x,/tmp/x')).toBe('file://<tmp>/x,<tmp>/x');
    expect(said('profile://a/tmp/x')).toBe('profile://a/tmp/x');
  });

  it('takes a host path after `=` and `file://`', () => {
    expect(said(`NSFilePath=${PRIVATE}/tmp/x/app.app, NSURL=file://${PRIVATE}/tmp/x/app.app`)).toBe('NSFilePath=<tmp>/app.app, NSURL=file://<tmp>/app.app');
    expect(said('path=/tmp/x other=/Users/lab/a.apk')).toBe('path=<tmp>/x other=~/a.apk');
    expect(said(`file://${VOLUMES}/Disk/b.ipa x=/opt/y/z`)).toBe('file://…/b.ipa x=…/z');
    expect(said('file:///home/x')).toBe('file://~');
  });

  it('keeps a device path after `=` and `file://`', () => {
    for (const kept of ['path=/data/local/tmp/a.xml', 'x=/sdcard/a', 'file:///data/local/tmp/a', 'x=/storage/emulated/0/a']) {
      expect(said(kept)).toBe(kept);
    }
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

describe('shownCommand: a typed text never stands in the argv a failure shows (A17)', () => {
  it('writes <typed text> at the indexes the caller declared, and only there', () => {
    expect(shownCommand('idb', ['ui', 'text', '--udid', 'U', '--', '-hunter2'], [5])).toBe('idb ui text --udid U -- <typed text>');
    expect(shownCommand('adb', ['-s', 'emulator-5554', 'shell', 'input', 'text', "'h'"], [5])).toBe('adb -s emulator-5554 shell input text <typed text>');
    expect(shownCommand('x', ['a', 'b', 'c'], [0, 2])).toBe('x <typed text> b <typed text>');
  });

  it('a text of any shape goes whole: a newline, a home, the word --udid, an empty word', () => {
    expect(shownCommand('idb', ['ui', 'text', '--udid', 'U', '--', 'line\ntwo /Users/me/x --udid V'], [5])).toBe('idb ui text --udid U -- <typed text>');
    expect(shownCommand('idb', ['ui', 'text', '--udid', 'U', '--', ''], [5])).toBe('idb ui text --udid U -- <typed text>');
  });

  it('with nothing declared, or an index past the argv, it is exec\'s own join', () => {
    expect(shownCommand('idb', ['ui', 'tap', '1', '2'])).toBe('idb ui tap 1 2');
    expect(shownCommand('idb', ['ui', 'tap', '1', '2'], [])).toBe('idb ui tap 1 2');
    expect(shownCommand('idb', ['ui', 'tap'], [7])).toBe('idb ui tap');
  });
});

describe('commandFailureText: the command as the caller showed it (A17: no argv is recognised by its shape)', () => {
  it('quotes a typing\'s argv as given: what masks it is shownCommand, upstream', () => {
    expect(failed('idb ui text --udid U -- <typed text>', 'e')).toBe('Command failed (exit 1): idb ui text --udid U -- <typed text>\ne');
    expect(failed('idb ui text hunter2 --udid U', 'e')).toBe('Command failed (exit 1): idb ui text hunter2 --udid U\ne');
    expect(failed("adb -s emulator-5554 shell input text 'h'", 'e', { timedOut: true })).toBe("Command timed out: adb -s emulator-5554 shell input text 'h'");
  });

  it('argparse\'s line keeps its words, at exit 2 too: behind `--` no text reaches argparse (D74)', () => {
    expect(failed('idb ui text --udid U -- <typed text>', 'idb ui text: error: gone\n', { exitCode: 2 }).split('\n')[1]).toBe('idb ui text: error: gone');
  });
});
