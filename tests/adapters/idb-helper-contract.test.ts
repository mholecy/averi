import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exec, ExecError } from '../../src/adapters/exec.js';
import { withUdid } from '../../src/adapters/idb.js';
import { IdbHelper, idbInterpreter, type IdbHelperReply } from '../../src/adapters/idb-helper.js';

// The helper's contract with fb-idb (D7a): `gen_main` run in-process by the helper's script answers as the `idb` CLI
// does — the same exit code, the same stderr, the same stdout bytes. `gen_main` is not public fb-idb API; this is the
// test that catches an fb-idb that changed under it. It runs the real interpreter idb's shebang names, and needs no
// simulator: a companion at localhost:1 fails to connect the same way in both, and `--help` is answered before any
// connection. Skipped where idb (with a Python shebang) is not installed. The bootstrap — what the helper imports, and
// its exit code — is checked below against a fake fb-idb under the same interpreter.

const found = await idbInterpreter(process.env);
const UDID = 'D8DACDE6-6352-437C-AA22-86FB06275C3F';

/** The CLI's answer, as exec gives it — the result or the ExecError's code, stdout and stderr. */
async function cli(argv: string[]) {
  try {
    const r = await exec('idb', argv, { timeoutMs: 20_000 });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (e) {
    if (!(e instanceof ExecError)) throw e;
    return { code: e.exitCode, stdout: e.stdout, stderr: e.stderr };
  }
}

/** The helper's answer, once it is ready: the first `run` starts it, and each later one waits for ready. */
async function untilReady(helper: IdbHelper, argv: string[]): Promise<IdbHelperReply> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const pending = helper.run(argv, { timeoutMs: 20_000 });
    if (pending !== undefined) return pending;
    if (Date.now() > deadline) throw new Error('the idb helper never said ready');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** logging's asctime (`2026-10-31 13:40:02,494`): the one thing two runs of the same failure print differently. */
const untimed = (text: string) => text.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,\d+/g, '<time>');

describe.skipIf(found === undefined)('the idb helper against the idb CLI (real fb-idb)', () => {
  const helper = new IdbHelper();
  afterAll(() => helper.dispose());

  const viaHelper = (argv: string[]) => untilReady(helper, argv);

  it('fails to connect with the same code and stderr as the CLI', async () => {
    const argv = ['--companion', 'localhost:1', 'ui', 'describe-all', '--json', '--udid', UDID];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper.kind).toBe('answer');
    if (byHelper.kind !== 'answer') return;
    expect(byCli.code).not.toBe(0);
    expect(byHelper.code).toBe(byCli.code);
    expect(byHelper.stderr).toBe(byCli.stderr);
    expect(byHelper.stderr).toMatch(/companion/);
  }, 60_000);

  it('prints the same stdout bytes for `ui describe-all --help`', async () => {
    const argv = ['ui', 'describe-all', '--help'];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper.kind).toBe('answer');
    if (byHelper.kind !== 'answer') return;
    expect(byHelper.code).toBe(0);
    expect(byCli.code).toBe(0);
    expect(byHelper.stdout.equals(byCli.stdout)).toBe(true);
    expect(byHelper.stdout.toString()).toMatch(/^usage: idb ui describe-all/);
  }, 60_000);

  it('prints a traceback through the logging handler as the CLI does — same code, same stderr but the timestamp', async () => {
    // `localhost:abc` fails in int(): gen_main's `logger.exception` writes through basicConfig's handler, not print.
    const argv = ['--companion', 'localhost:abc', 'ui', 'describe-all', '--json', '--udid', UDID];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper.kind).toBe('answer');
    if (byHelper.kind !== 'answer') return;
    expect(byHelper.code).toBe(byCli.code);
    expect(untimed(byHelper.stderr)).toBe(untimed(byCli.stderr));
    expect(byHelper.stderr).toMatch(/\[ERROR\] - root - Exception thrown in main\n[\s\S]*ValueError: invalid literal for int/);
  }, 60_000);

  // D7b: every HID argv IosAdapter sends (ios.ts), against a companion that is not there — the same failure, the same
  // code and stderr as the CLI, the --udid where runIdb puts it (withUdid). D74: a text after `--` is the positional
  // whatever it starts with, so `-h` is no help (exit 0, nothing typed) and `-hunter2` no option (argparse's exit 2):
  // every typing reaches the companion, and fails to connect with 1.
  it.each([
    ['ui', 'tap', '1', '1'],
    ['ui', 'tap', '1', '1', '--duration', '0.8'],
    ['ui', 'swipe', '200', '700', '200', '176', '--duration', '0.3'],
    ['ui', 'text', '--', 'a'],
    ['ui', 'text', '--', 'Jan Nováček 😀'],
    ['ui', 'text', '--', '-x'],
    ['ui', 'text', '--', '-h'],
    ['ui', 'text', '--', '-hunter2'],
    ['ui', 'text', '--', '--log=s3cret'],
    ['ui', 'key', '4'],
    ['ui', 'key-sequence', '42', '42', '76'],
    ['ui', 'button', 'HOME'],
  ].map((a) => [a.join(' '), a]))('fails `%s` with the same code and stderr as the CLI', async (_, args) => {
    const argv = ['--companion', 'localhost:1', ...withUdid(args, UDID).argv];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper.kind).toBe('answer');
    if (byHelper.kind !== 'answer') return;
    expect(byCli.code).not.toBe(0);
    if (args[1] === 'text') expect(byCli.code).toBe(1);
    expect(byHelper.code).toBe(byCli.code);
    expect(byHelper.stderr).toBe(byCli.stderr);
    expect(byHelper.stdout.equals(byCli.stdout)).toBe(true);
  }, 60_000);

  it('prints the same stdout bytes for `ui tap --help`', async () => {
    const argv = ['ui', 'tap', '--help'];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper).toMatchObject({ kind: 'answer', code: 0 });
    if (byHelper.kind !== 'answer') return;
    expect(byHelper.stdout.equals(byCli.stdout)).toBe(true);
    expect(byHelper.stdout.toString()).toMatch(/^usage: idb ui tap/);
  }, 60_000);

  // D26b: iOS's screenshot, `screenshot -` — a read the helper serves.
  it('fails `screenshot -` with the same code and stderr as the CLI (D26b)', async () => {
    const argv = ['--companion', 'localhost:1', 'screenshot', '-', '--udid', UDID];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper.kind).toBe('answer');
    if (byHelper.kind !== 'answer') return;
    expect(byCli.code).not.toBe(0);
    expect(byHelper.code).toBe(byCli.code);
    expect(byHelper.stderr).toBe(byCli.stderr);
    expect(byHelper.stdout.equals(byCli.stdout)).toBe(true);
    expect(byHelper.stderr).toMatch(/companion/);
  }, 60_000);

  it('prints the same stdout bytes for `screenshot --help` (D26b)', async () => {
    const argv = ['screenshot', '--help'];
    const [byHelper, byCli] = [await viaHelper(argv), await cli(argv)];
    expect(byHelper).toMatchObject({ kind: 'answer', code: 0 });
    if (byHelper.kind !== 'answer') return;
    expect(byCli.code).toBe(0);
    expect(byHelper.stdout.equals(byCli.stdout)).toBe(true);
    expect(byHelper.stdout.toString()).toMatch(/^usage: idb screenshot/);
  }, 60_000);

  it('answers 50 requests in a row alike — one event loop per request leaves nothing behind', async () => {
    const argv = ['--companion', 'localhost:1', 'ui', 'describe-all', '--json', '--udid', UDID];
    const byCli = await cli(argv);
    for (let i = 0; i < 50; i++) {
      const byHelper = await viaHelper(argv);
      expect(byHelper).toMatchObject({ kind: 'answer', code: byCli.code, stderr: byCli.stderr });
    }
  }, 60_000);
});

describe.skipIf(found === undefined)('the helper\'s bootstrap — what it imports, and the exit code (a fake fb-idb, the real interpreter)', () => {
  // A fake `idb.cli.main` beside a fake idb script, reached through a symlink as uv's ~/.local/bin/idb is: the helper
  // must import the one beside the script's REAL path, never one planted in its cwd.
  let dir: string;
  let helper: IdbHelper;
  const pkg = (who: string) => [
    'import logging, sys',
    "logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')",
    'async def gen_main(argv):',
    "    if argv[0] == 'who':",
    `        print('${who}')`,
    '        return 0',
    "    if argv[0] == 'code':",
    '        return int(argv[1])',
    "    if argv[0] == 'log':",
    "        logging.getLogger().error('through the handler')",
    '        return 0',
    // fb-idb's `screenshot -`, `file pull … -` and `video` write bytes to sys.stdout.buffer (D7b, ADR 0032 NIT-2).
    "    if argv[0] == 'bytes':",
    "        print('text first, é')",
    '        sys.stdout.flush()',
    "        sys.stdout.buffer.write(bytes([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x0a]))",
    "        sys.stderr.buffer.write(b'raw \\xff\\n')",
    '        return 0',
    // D26b: a screenshot's size of binary — 5 MB of NUL, newline, 0xFF and CR — written as fb-idb's `screenshot -` does.
    "    if argv[0] == 'big':",
    '        sys.stdout.buffer.write(bytes([0x00, 0x0a, 0xff, 0x0d, 0x89, 0x50]) * (5 * 1024 * 1024 // 6))',
    '        return 0',
    // A surrogate escape (an undecodable byte of an argv or a file name) printed as text: stderr's error handler.
    // A helper that dies inside gen_main — after it acknowledged the request (D7b).
    "    if argv[0] == 'exit':",
    '        import os',
    '        os._exit(9)',
    "    if argv[0] == 'surrogate':",
    "        print('\\udcff', file=sys.stderr)",
    '        return 0',
    '',
  ].join('\n');
  async function fakeIdb(root: string, who: string) {
    await mkdir(join(root, 'idb', 'cli'), { recursive: true });
    await writeFile(join(root, 'idb', '__init__.py'), '');
    await writeFile(join(root, 'idb', 'cli', '__init__.py'), '');
    await writeFile(join(root, 'idb', 'cli', 'main.py'), pkg(who));
  }
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-idb-bootstrap-'));
    await fakeIdb(join(dir, 'tool'), 'beside the script');
    // Runnable as the CLI is: the fake's own `idb` process, for what the real stderr does.
    await writeFile(
      join(dir, 'tool', 'idb-script'),
      '#!/usr/bin/env python3\nimport asyncio, sys\nfrom idb.cli.main import gen_main\nsys.exit(asyncio.run(gen_main(sys.argv[1:])))\n',
    );
    await mkdir(join(dir, 'bin'));
    await symlink(join(dir, 'tool', 'idb-script'), join(dir, 'bin', 'idb'));
    await fakeIdb(join(dir, 'cwd'), 'planted in the cwd');
    helper = new IdbHelper({
      interpreter: async () => ({ python: found!.python, idb: join(dir, 'bin', 'idb') }),
      spawn: (cmd, args, opts) => spawn(cmd, args, { ...opts, cwd: join(dir, 'cwd') }),
    });
  });
  afterAll(async () => {
    await helper.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it('imports idb from beside the real path of the idb script, not from its cwd', async () => {
    const r = await untilReady(helper, ['who']);
    expect(r).toMatchObject({ kind: 'answer', code: 0 });
    if (r.kind === 'answer') expect(r.stdout.toString()).toBe('beside the script\n');
  }, 30_000);

  it('masks the exit code to a byte, as the process status does', async () => {
    expect(await untilReady(helper, ['code', '259'])).toMatchObject({ kind: 'answer', code: 3 });
    expect(await untilReady(helper, ['code', '-1'])).toMatchObject({ kind: 'answer', code: 255 });
  }, 30_000);

  it('carries what a command writes to sys.stdout.buffer byte for byte — and stderr\'s bytes decoded as exec decodes them', async () => {
    const r = await untilReady(helper, ['bytes']);
    expect(r).toMatchObject({ kind: 'answer', code: 0 });
    if (r.kind !== 'answer') return;
    expect(r.stdout.equals(Buffer.concat([Buffer.from('text first, é\n'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00, 0x0a])]))).toBe(true);
    expect(r.stderr).toBe('raw \uFFFD\n'); // exec: stderr.toString('utf8')
  }, 30_000);

  it('carries a 5 MB binary stdout back byte-equal — the size of a large screenshot, every byte value a text protocol trips on (D26b)', async () => {
    const r = await untilReady(helper, ['big']);
    expect(r).toMatchObject({ kind: 'answer', code: 0 });
    if (r.kind !== 'answer') return;
    const want = Buffer.alloc(Math.floor((5 * 1024 * 1024) / 6) * 6);
    for (let i = 0; i < want.length; i++) want[i] = [0x00, 0x0a, 0xff, 0x0d, 0x89, 0x50][i % 6];
    expect(r.stdout.length).toBe(want.length);
    expect(r.stdout.equals(want)).toBe(true);
  }, 30_000);

  it('prints a surrogate escape to stderr as the fake\'s own process does — the stream\'s error handler, not strict', async () => {
    const r = await untilReady(helper, ['surrogate']);
    const byProcess = await exec(found!.python, [join(dir, 'bin', 'idb'), 'surrogate'], { timeoutMs: 20_000 });
    expect(r).toMatchObject({ kind: 'answer', code: 0 });
    if (r.kind !== 'answer') return;
    expect(r.stderr).toBe(byProcess.stderr);
    expect(r.stderr).toBe('\\udcff\n'); // backslashreplace, Python's stderr handler
  }, 30_000);

  it('answers `died`, not `unsent`, for a request gen_main was running when the process died — the ack is read', async () => {
    // A helper of its own each time: one that dies before its first answer counts as a failed start (two turn it off).
    for (let i = 0; i < 5; i++) {
      const dying = new IdbHelper({ interpreter: async () => ({ python: found!.python, idb: join(dir, 'bin', 'idb') }) });
      try {
        expect(await untilReady(dying, ['exit'])).toEqual({ kind: 'died' });
      } finally {
        await dying.dispose();
      }
    }
  }, 60_000);

  it('captures what a logging handler writes into the reply\'s stderr', async () => {
    expect(await untilReady(helper, ['log'])).toMatchObject({ kind: 'answer', code: 0, stderr: 'ERROR through the handler\n' });
  }, 30_000);
});
