import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { shellCommandLine, shellQuote } from '../../src/adapters/adb-shell.js';
import { AndroidAdapter } from '../../src/adapters/android.js';
import { deviceShExec, runOnDeviceSh } from '../helpers/device-sh.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

/**
 * What `adb shell` hands the device is ONE line for its sh (adb-shell.ts).
 * These tests parse that line with a real sh (tests/helpers/device-sh.ts),
 * so "the device command got exactly this argv" is checked by the same
 * parsing the device does — not by joining strings the way adb does, which
 * is how the old fake missed the injection.
 *
 * The values are the review's measured failures (2026-10-07, emulator-5554:
 * a deep link cut at `&`, an extra split at a space, `$HOME` expanded and
 * `;id` executed — all exiting 0) and the rest of what sh interprets.
 */
const HOSTILE: Array<[string, string]> = [
  ['a space', 'hello world'],
  ['two spaces and a tab', 'a  b\tc'],
  ['an ampersand (a second query parameter)', 'app://login?a=1&b=2'],
  ['a semicolon and a command', 'app://x/;echo injected'],
  ['a single quote', "it's"],
  ['only a single quote', "'"],
  ['a double quote', 'say "hi"'],
  ['a dollar and a variable', 'app://x/$HOME'],
  ['$HOME;id — the measured one', 'app://x/$HOME;id'],
  ['a command substitution', '$(echo injected)'],
  ['backticks', '`echo injected`'],
  ['a newline', 'line1\nline2'],
  ['a backslash', 'C:\\path\\n'],
  ['the empty string', ''],
  ['unicode', 'Ľubovoľný text — žltý kôň 🐴'],
  ['a pipe and a redirect', 'a|b>c<d'],
  ['a glob', '*'],
  // Globs that MATCH on any host (and on the device: /etc is there too) — an
  // unmatched glob stays literal in sh, so only these catch `?` or `[` passed bare.
  ['a ? glob that matches /etc', '/e?c'],
  ['a [ ] glob that matches /etc', '/[e]tc'],
  // Brace expansion is NOT POSIX: mksh (the device) and bash-as-sh (the macOS
  // host) expand it, dash does not — so this case only bites on a bash /bin/sh host.
  ['a brace list', 'a{x,y}b'],
  ['a leading tilde', '~/x'],
  ['a leading hash (a comment)', '#not-a-comment'],
  ['an assignment-shaped word', 'A=b'],
  ['a history bang and a caret', 'wow!^'],
  ['parentheses and braces', '(a){b}[c]'],
];

describe('shellCommandLine — the device sh receives the argv unchanged', () => {
  it.each(HOSTILE)('%s', (_name, value) => {
    expect(runOnDeviceSh(shellCommandLine(['am', 'start', '-d', value]))).toEqual([['am', 'start', '-d', value]]);
  });

  // Each sh special character ALONE between two letters, so the allowlist
  // cannot pass one of them bare while another character in the same value
  // forces the quotes (every headline case above holds more than one).
  it.each([
    '&', ';', '|', '<', '>', '(', ')', '$', '`', '\\', '"', "'", ' ', '\t', '\n',
    '*', '?', '[', ']', '#', '~', '=', '!', '{', '}',
  ])('a%sb — the character alone, between two letters', (c) => {
    const value = `a${c}b`;
    expect(runOnDeviceSh(shellCommandLine(['am', value]))).toEqual([['am', value]]);
    // and at the word's start, where `#` and `~` (and `=` in a first word) mean something
    expect(runOnDeviceSh(shellCommandLine(['am', `${c}b`]))).toEqual([['am', `${c}b`]]);
  });

  it('every hostile value in one argv, each still its own word, in order', () => {
    const values = HOSTILE.map(([, v]) => v);
    expect(runOnDeviceSh(shellCommandLine(['input', ...values]))).toEqual([['input', ...values]]);
  });

  it('adb\'s own join of the quoted words IS the command line (the adapter passes them as separate adb arguments)', () => {
    const argv = ['am', 'start', '-d', 'app://login?a=1&b=2', '--es', 'k', "it's here"];
    expect(argv.map(shellQuote).join(' ')).toBe(shellCommandLine(argv));
  });
});

describe('the stand-in device sh (tests/helpers/device-sh.ts) runs nothing but its recorders', () => {
  it('an unlisted command fails loudly instead of executing on the host', () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'averi-device-sh-')), 'ran');
    expect(() => runOnDeviceSh(`am start; touch ${marker}`)).toThrow(/should not have.*touch/s);
    expect(existsSync(marker)).toBe(false);
  });
  it('an injected command does too', () => {
    expect(() => runOnDeviceSh('am start -d app://x/;id')).toThrow(/should not have/);
  });
});

describe('shellQuote — the spelling', () => {
  it('leaves a plain word bare, so command lines in errors and tests read as before', () => {
    for (const plain of ['input', 'tap', '540', '%s', 'md.bank.app', 'md.bank.app/.MainActivity',
      'android.intent.action.VIEW', '-n', '--es', 'bank://pay', 'user@bank.md', 'a,b+c']) {
      expect(shellQuote(plain)).toBe(plain);
    }
  });
  it('wraps anything else in single quotes, a quote inside as \'\\\'\'', () => {
    expect(shellQuote('a b')).toBe("'a b'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$')).toBe("'$'");
  });
  it('keeps the empty string as an argument', () => {
    expect(shellQuote('')).toBe("''");
    expect(runOnDeviceSh(shellCommandLine(['am', '', 'x']))).toEqual([['am', '', 'x']]);
  });
});

describe('AndroidAdapter — every user value reaches the device command as one word', () => {
  it('openDeepLink: a url with `&`, `;`, `$` and a space arrives whole, and nothing else runs', async () => {
    const { fn, commands } = deviceShExec();
    const url = "app://login?a=1&b=2;echo x $HOME 'q'";
    await new AndroidAdapter({ serial: 'e', exec: fn }).openDeepLink(url);
    expect(commands).toEqual([['am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]]);
  });

  it('launch: intent data and extras (keys and values) arrive whole', async () => {
    const { fn, commands } = deviceShExec();
    await new AndroidAdapter({ serial: 'e', exec: fn }).launch('md.bank.app', {
      intent: {
        action: 'android.intent.action.VIEW',
        data: 'bank://pay?to=a b&amount=1;id',
        extras: { 'qr payload': 'hello world', note: "it's `x` $(y)" },
      },
    });
    expect(commands).toEqual([[
      'am', 'start', '-p', 'md.bank.app', '-a', 'android.intent.action.VIEW',
      '-d', 'bank://pay?to=a b&amount=1;id',
      '--es', 'qr payload', 'hello world', '--es', 'note', "it's `x` $(y)",
    ]]);
  });

  it('launch with clearState, terminate and the monkey launch go through the same quoting', async () => {
    const { fn, commands } = deviceShExec();
    const adapter = new AndroidAdapter({ serial: 'e', exec: fn });
    await adapter.launch('odd pkg;x', { clearState: true });
    await adapter.terminate('odd pkg;x');
    expect(commands).toEqual([
      ['pm', 'clear', 'odd pkg;x'],
      ['monkey', '-p', 'odd pkg;x', '-c', 'android.intent.category.LAUNCHER', '1'],
      ['am', 'force-stop', 'odd pkg;x'],
    ]);
  });

  it('typeText: each character, metacharacters included, is one `input text` word; a space is input\'s %s', async () => {
    const { fn, commands } = deviceShExec();
    await new AndroidAdapter({ serial: 'e', exec: fn }).typeText("a '\\$;`\"!^");
    expect(commands).toEqual([
      ['input', 'text', 'a'],
      ['input', 'text', '%s'],
      ['input', 'text', "'"],
      ['input', 'text', '\\'],
      ['input', 'text', '$'],
      ['input', 'text', ';'],
      ['input', 'text', '`'],
      ['input', 'text', '"'],
      ['input', 'text', '!'],
      ['input', 'text', '^'],
      ['input', 'keyevent', '21'],
      ['input', 'keyevent', '22'],
    ]);
  });

  it.each([['a newline', 'ab\ncd', '"\\n"'], ['a return', 'ab\rcd', '"\\r"'], ['a tab', 'ab\tcd', '"\\t"']])(
    'typeText refuses %s before sending anything — input text would make it a key (ENTER submits)',
    async (_name, text, shown) => {
      const { fn, commands } = deviceShExec();
      const typing = new AndroidAdapter({ serial: 'e', exec: fn }).typeText(text);
      await expect(typing).rejects.toThrow(`typeText cannot type ${shown} on Android`);
      await expect(typing).rejects.toThrow(/pressKey\('enter'\)/);
      expect(commands).toEqual([]);
    },
  );

  it('isAppRunning: the package name is quoted INTO the rawShell line — pidof gets one word, the `|| true` still runs', async () => {
    const { fn, commands, adbArgv } = deviceShExec();
    expect(await new AndroidAdapter({ serial: 'e', exec: fn }).isAppRunning('x; echo injected')).toBe(false);
    expect(commands).toEqual([['pidof', 'x; echo injected']]);
    expect(adbArgv).toEqual([['-s', 'e', 'shell', "pidof 'x; echo injected' || true"]]);
  });

  // exec-out is the other way round: the adb CLIENT escapes every word after
  // the command (escape_arg), so execOut must NOT quote too — that would put
  // literal quotes into the device command's argument. No caller sends a
  // non-plain word today; this pins the invariant for the first one that does.
  it('execOut: a non-plain word arrives once-quoted — adb escapes it, the adapter does not', async () => {
    // screencap answers with a PNG signature: screenshot() refuses anything else (screenshot-bytes.ts).
    const { fn, commands } = deviceShExec((argv) =>
      argv[1] === 'screencap' ? { stdout: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) } : {},
    );
    const adapter = new AndroidAdapter({ serial: 'e', exec: fn });
    await adapter['execOut'](['uiautomator', 'dump', "/sdcard/a b&c;'d'.xml"]);
    await adapter.screenshot();
    expect(commands).toEqual([
      ['uiautomator', 'dump', "/sdcard/a b&c;'d'.xml"],
      ['screencap', '-p'],
    ]);
  });

  it('the keyboard witness stays a rawShell line: its pipe runs on the device, not as words to dumpsys', async () => {
    const { fn, commands } = deviceShExec();
    await new AndroidAdapter({ serial: 'e', exec: fn }).keyboard?.witness();
    // dumpsys's own record went into the pipe, so only grep's reaches stdout —
    // which is what a pipe is. Quoted as words, dumpsys would get `|` and grep's flags.
    expect(commands).toEqual([['grep', '-m1', '-w', 'mInputShown']]);
  });
});
