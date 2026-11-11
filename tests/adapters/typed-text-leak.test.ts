import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AndroidAdapter } from '../../src/adapters/android.js';
import { exec as realExec, ExecError, type ExecFn } from '../../src/adapters/exec.js';
import { IDB_HELPER_CALL_END, IDB_HELPER_CALL_START, type IdbHelperCall } from '../../src/adapters/idb.js';
import { IdbHelperTimeout, type IdbHelper, type IdbHelperReply } from '../../src/adapters/idb-helper.js';
import { IosAdapter } from '../../src/adapters/ios.js';
import type { IosTreeSource } from '../../src/adapters/ios-tree-source.js';
import { drawnOverStrip } from '../helpers/android-dumps.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

// The LEAK SWEEP (A17, ADR 0043's amendment): a typed text is out of every failure's words only because each typing
// call site declares its word typed (ExecOptions.typed). Nothing recognises an argv by its shape any more, so a call
// site that forgets is a leak no other test sees. Here both adapters' typeText runs through every way a typing fails
// — the CLI, a real child, through the real exec (exit 1, exit 2, a silent exit, a timeout); on iOS also the idb
// helper (a nonzero answer, silent or not, a death after it took the input, its timeout, a request it never took),
// the helper off, and D24's split, failing on either of its two calls — and no piece of the text may stand in the
// error's command, message or stack, in anything `inspect` prints of it, or in what the helper's channel published.

/** iOS's text: each grapheme a letter nothing else prints, so D24's first key alone ('Ж') is as findable as the rest. */
const IOS_TEXT = 'ЖЩ§hunter2Ђ';
const IOS_PIECES = ['Ж', 'Щ', '§', 'hunter2', 'Ђ'];
/** Android's: ASCII (`input text`'s), one call per character, each a mark no message or stack holds. */
const ANDROID_TEXT = '^|~';
const ANDROID_PIECES = ['^', '|', '~'];

/** The ways a CLI typing fails: a script run by the real exec in idb's or adb's place, the argv as the adapter built it. */
const CLI_FAILURES = {
  'exit 1': 'echo "companion gone" >&2; exit 1',
  'exit 2': 'echo "usage: idb [-h]" >&2; echo "idb: error: refused" >&2; exit 2',
  'a silent exit (node\'s own line in stderr)': 'exit 1',
  'a timeout': 'sleep 5',
} as const;
type CliFailure = keyof typeof CLI_FAILURES;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'averi-leak-sweep-'));
  for (const [i, body] of Object.values(CLI_FAILURES).entries()) {
    await writeFile(join(dir, `fail-${i}`), `#!/bin/sh\n${body}\n`);
    await chmod(join(dir, `fail-${i}`), 0o755);
  }
});
afterAll(() => rm(dir, { recursive: true, force: true }));

let savedDeveloperDir: string | undefined;
beforeEach(() => {
  savedDeveloperDir = process.env.DEVELOPER_DIR;
  process.env.DEVELOPER_DIR = '/fake/Developer'; // the Xcode probe answers without exec
});
afterEach(() => {
  if (savedDeveloperDir === undefined) delete process.env.DEVELOPER_DIR;
  else process.env.DEVELOPER_DIR = savedDeveloperDir;
});

/**
 * An exec whose `failOn`-th typing (`idb ui text`, `adb … input text`) runs the failure's script through the real exec,
 * with the adapter's own args and options (its `typed`) and a short timeout; every other call answers empty.
 */
function failingExec(failure: CliFailure, failOn: number): ExecFn {
  let typings = 0;
  const script = join(dir, `fail-${Object.keys(CLI_FAILURES).indexOf(failure)}`);
  return async (cmd, args, opts) => {
    const typing = (cmd === 'idb' && args[1] === 'text') || (cmd === 'adb' && args.includes('input') && args.includes('text'));
    if (typing && ++typings === failOn) return realExec(script, args, { ...opts, timeoutMs: 200 });
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
}

/** The ways the idb helper answers a typing, each as IdbHelper.run would (a timeout rejects with its own error). */
const HELPER_REPLIES = {
  'a nonzero answer': async () => ({ kind: 'answer', code: 1, stdout: Buffer.alloc(0), stderr: 'companion gone\n' }),
  'a silent nonzero answer': async () => ({ kind: 'answer', code: 1, stdout: Buffer.alloc(0), stderr: '' }),
  'exit 2': async () => ({ kind: 'answer', code: 2, stdout: Buffer.alloc(0), stderr: 'idb: error: refused\n' }),
  'a death after it took the input': async () => ({ kind: 'died' }),
  'its timeout': async (argv, typed) => Promise.reject(new IdbHelperTimeout(argv, typed)),
} satisfies Record<string, (argv: readonly string[], typed?: readonly number[]) => Promise<IdbHelperReply>>;

/** A helper that takes every call `run` is offered and answers it so — or `unsent`, then the CLI types it. */
function fakeHelper(reply: (argv: readonly string[], typed?: readonly number[]) => Promise<IdbHelperReply> | undefined): IdbHelper {
  return { run: (argv: readonly string[], opts: { typed?: readonly number[] }) => reply(argv, opts.typed), dispose: async () => {} } as unknown as IdbHelper;
}

const NO_TREE: IosTreeSource = {
  kind: 'idb',
  read: () => Promise.reject(new Error('unused')),
  systemAlert: () => Promise.reject(new Error('unused')),
  applicationLabel: () => Promise.reject(new Error('unused')),
  dispose: () => Promise.resolve(),
};

/** What the helper's channel published while `run` ran. */
async function published(run: () => Promise<unknown>): Promise<string> {
  const seen: (readonly string[])[] = [];
  const listen = (m: unknown) => void seen.push([...(m as IdbHelperCall).argv]);
  IDB_HELPER_CALL_START.subscribe(listen);
  IDB_HELPER_CALL_END.subscribe(listen);
  try {
    await run();
  } finally {
    IDB_HELPER_CALL_START.unsubscribe(listen);
    IDB_HELPER_CALL_END.unsubscribe(listen);
  }
  return JSON.stringify(seen);
}

/** The failure, and every place it could show a piece of the text. */
async function failureOf(typing: () => Promise<void>): Promise<{ error: ExecError; channel: string }> {
  let error: unknown;
  const channel = await published(() => typing().catch((e: unknown) => void (error = e)));
  expect(error).toBeInstanceOf(ExecError); // it failed, and as a host command does
  return { error: error as ExecError, channel };
}

function expectNoPiece({ error, channel }: { error: ExecError; channel: string }, pieces: readonly string[]): void {
  const shown = { command: error.command, message: error.message, stack: error.stack ?? '', inspected: inspect(error, { depth: 5 }), channel };
  for (const piece of pieces) for (const [where, text] of Object.entries(shown)) expect(text.includes(piece), `${JSON.stringify(piece)} in ${where}: ${text}`).toBe(false);
  expect(error.command).toContain('<typed text>');
}

/** An iOS adapter in an app seen dropping a tail (D24): its typing is the first key alone, then the rest. */
async function splitting(exec: ExecFn, idbHelper?: IdbHelper): Promise<IosAdapter> {
  const adapter = new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE, idbHelper });
  await adapter.launch('com.lab.rn');
  adapter.noteDroppedTail();
  return adapter;
}

describe('the leak sweep: iOS typeText on the CLI (the helper off, or given nothing)', () => {
  const cases = Object.keys(CLI_FAILURES).flatMap((f) => [
    [f, 'one burst', 1],
    [f, 'D24\'s first key alone', 1],
    [f, 'D24\'s rest', 2],
  ] as [CliFailure, string, number][]);

  it.each(cases)('%s, %s: no piece of the text anywhere', async (failure, call, failOn) => {
    const exec = failingExec(failure, failOn);
    const adapter = call === 'one burst' ? new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE }) : await splitting(exec);
    expectNoPiece(await failureOf(() => adapter.typeText(IOS_TEXT)), IOS_PIECES);
  });

  it.each(Object.keys(CLI_FAILURES) as CliFailure[])('%s, the helper there but off (it takes no call): no piece of the text anywhere', async (failure) => {
    const adapter = await splitting(failingExec(failure, 2), fakeHelper(() => undefined));
    expectNoPiece(await failureOf(() => adapter.typeText(IOS_TEXT)), IOS_PIECES);
  });
});

describe('the leak sweep: iOS typeText through the idb helper', () => {
  const cases = Object.keys(HELPER_REPLIES).flatMap((r) => [
    [r, 'one burst', 1],
    [r, 'D24\'s first key alone', 1],
    [r, 'D24\'s rest', 2],
  ] as [keyof typeof HELPER_REPLIES, string, number][]);

  it.each(cases)('%s, %s: no piece of the text anywhere, the channel included', async (reply, call, failOn) => {
    let calls = 0;
    const helper = fakeHelper((argv, typed) => (++calls === failOn ? HELPER_REPLIES[reply](argv, typed) : Promise.resolve({ kind: 'answer', code: 0, stdout: Buffer.alloc(0), stderr: '' })));
    const exec = failingExec('exit 1', Number.POSITIVE_INFINITY);
    const adapter = call === 'one burst' ? new IosAdapter({ udid: 'AAAA-1111', exec, treeSource: NO_TREE, idbHelper: helper }) : await splitting(exec, helper);
    expectNoPiece(await failureOf(() => adapter.typeText(IOS_TEXT)), IOS_PIECES);
  });

  it.each(Object.keys(CLI_FAILURES) as CliFailure[])('a request the helper never took (`unsent`), then the CLI: %s', async (failure) => {
    const adapter = await splitting(failingExec(failure, 1), fakeHelper(async () => ({ kind: 'unsent' })));
    expectNoPiece(await failureOf(() => adapter.typeText(IOS_TEXT)), IOS_PIECES);
  });
});

describe('the leak sweep: Android typeText, one `input text` per character', () => {
  const cases = Object.keys(CLI_FAILURES).flatMap((f) => [...ANDROID_TEXT].map((_, i) => [f, i + 1] as [CliFailure, number]));

  it.each(cases)('%s on character %i: no character of the text anywhere', async (failure, failOn) => {
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: failingExec(failure, failOn) });
    expectNoPiece(await failureOf(() => adapter.typeText(ANDROID_TEXT)), ANDROID_PIECES);
  });
});
