import { afterAll, describe, expect, it } from 'vitest';
import { exec, ExecError } from '../../src/adapters/exec.js';
import { IdbHelper, idbInterpreter, type IdbHelperReply } from '../../src/adapters/idb-helper.js';

// The helper's contract with fb-idb (D7a): `gen_main` run in-process by the helper's script answers as the `idb` CLI
// does — the same exit code, the same stderr, the same stdout bytes. `gen_main` is not public fb-idb API; this is the
// test that catches an fb-idb that changed under it. It runs the real interpreter idb's shebang names, and needs no
// simulator: a companion at localhost:1 fails to connect the same way in both, and `--help` is answered before any
// connection. Skipped where idb (with a Python shebang) is not installed.

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

describe.skipIf(found === undefined)('the idb helper against the idb CLI (real fb-idb)', () => {
  const helper = new IdbHelper();
  afterAll(() => helper.dispose());

  /** The helper's answer, once it is ready: the first `run` starts it, and each later one waits for ready. */
  async function viaHelper(argv: string[]): Promise<IdbHelperReply> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const pending = helper.run(argv, { timeoutMs: 20_000 });
      if (pending !== undefined) return pending;
      if (Date.now() > deadline) throw new Error('the idb helper never said ready');
      await new Promise((r) => setTimeout(r, 20));
    }
  }

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
});
