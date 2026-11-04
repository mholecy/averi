import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AbortGuard, type WindowSpec } from '../../../scripts/truth/batch/abort.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { nodeProcess } from '../../../scripts/truth/batch/proc.js';
import { RESTORE_FILE } from '../../../scripts/truth/batch/run-dir.js';
import { StepLog, terminalOf, type Terminal } from '../../../scripts/truth/batch/steps.js';
import { SUMMARY_MARKER } from '../../../scripts/truth/batch/words.js';

// tests/truth/batch/abort-proc.test.ts's child: a tiny batch run on the real process seam. Its folder is argv[2], its
// scenario argv[3]. It opens a dirty window E5 (block E5, its restore a detached proc-child.mjs `slow` that writes
// E5.started and E5.done), starts a probe (a `tree`: a child and a grandchild, pids in probe.pids), writes `ready` and
// waits for the probe — until the test interrupts it, or the scenario throws. Block kf is complete and judged by a
// detached `echo`. Everything it writes goes into its folder: <name>.out, steps.log, summary.txt, RESTORE.txt.

const [dir, scenario] = process.argv.slice(2);
const HELPER = join(import.meta.dirname, 'proc-child.mjs');
const node = process.execPath;
const at = (name: string) => join(dir, name);

/**
 * A terminal paused with Ctrl-S: writeSync into it blocks. The start line passes; the SUMMARY blocks — for 20 s here,
 * not for ever, so a child no kill reached still ends (review round 3: one hung a loaded run).
 */
const paused: Terminal = (text) => {
  if (text.startsWith(SUMMARY_MARKER)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
  return undefined;
};

const log = StepLog.open(nodeFs, {
  name: 'batch-t',
  runId: '1',
  blocks: ['kf', 'E5'],
  outFile: at('batch-t.out'),
  stepsFile: at('steps.log'),
  summaryFile: at('summary.txt'),
  terminal: scenario === 'paused' ? paused : terminalOf(),
});

/** A restore through a detached `slow` child taking `ms`: put back when it wrote E5.done — or, `fails`, never. */
const slowRestore =
  (ms: number, fails = false): WindowSpec['restore'] =>
  async (run) => {
    const r = await run(node, [HELPER, 'slow', at('E5.started'), at('E5.done'), String(ms)], { secs: 10 });
    if (fails) return { ok: false, why: 'its check exit 3', hand: ['E5: not proven clean (check exit 3) — node e5.ts --check'] };
    return r.code === 0 && existsSync(at('E5.done')) ? { ok: true, how: 'its state read back' } : { ok: false, why: `its restore exit ${r.code}` };
  };

const guard = new AbortGuard({
  name: 'batch-t',
  runId: '1',
  fs: nodeFs,
  log,
  seam: nodeProcess,
  restoreFile: at(RESTORE_FILE),
  graceMs: 200,
  head: () => ({ checkout: 'OK checkout: a fixture', labs: [], protectedLines: [] }),
  blocks: [
    { block: 'kf', complete: () => true, judge: async (run) => [(await run(node, [HELPER, 'echo', 'kf live verdict: PASS'], { secs: 10 })).out], linesSoFar: () => [] },
    { block: 'E5', complete: () => false, judge: async () => [], linesSoFar: () => ['E5 a verdict: PASS'] },
  ],
});

const e5 = (over: Partial<WindowSpec> = {}): WindowSpec => ({ block: 'E5', cleanup: 'E5 cleanup', hand: ['E5: node e5.ts --restore'], restore: slowRestore(0), ...over });
/** The probe the run waits on: a child and its grandchild, in a group of their own. */
const probe = () => guard.bounded(node, [HELPER, 'tree', at('probe.pids')], { secs: 30 });
const ready = () => writeFileSync(at('ready'), String(process.pid));

/** batch-12's pre-D62 worktree window: a temp repo and a worktree of it, removed and verified unregistered by the abort. */
function worktreeWindow(): void {
  const root = realpathSync(dir);
  const [repo, wt] = [join(root, 'repo'), join(root, 'wt')];
  const git = (...args: string[]) => execFileSync('git', args, { timeout: 10_000, stdio: 'ignore' });
  git('-c', 'init.defaultBranch=main', 'init', '-q', repo);
  git('-C', repo, '-c', 'user.name=batch-test', '-c', 'user.email=batch-test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');
  guard.open('WT', {
    hand: [`lvd62: git -C ${repo} worktree remove --force ${wt}; git -C ${repo} worktree prune`],
    restore: async (run) => {
      await run('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { secs: 10 });
      const list = await run('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { secs: 10 });
      return list.code === 0 && !list.out.split('\n').includes(`worktree ${wt}`) ? { ok: true, how: 'removed, unregistered' } : { ok: false, why: 'still registered' };
    },
  });
  git('-C', repo, 'worktree', 'add', '-q', '--detach', wt);
}

await guard.run(async () => {
  switch (scenario) {
    case 'int':
    case 'paused':
      guard.open('E5', e5());
      break;
    case 'int-fail':
      guard.open('E5', e5({ restore: slowRestore(0, true) }));
      break;
    case 'int-twice':
      guard.open('E5', e5({ restore: slowRestore(800) }));
      break;
    case 'epipe':
      // The restore writes to process.stdout, whose reader the test has closed: EPIPE, which must not abort it. The
      // raw write first: console.log drops its own write errors and would close the stream before it.
      guard.open('E5', e5({ restore: async (run) => {
        process.stdout.write('x'.repeat(1 << 16));
        for (let i = 0; i < 200; i++) console.log(`restore line ${i}`);
        return slowRestore(100)(run);
      } }));
      break;
    case 'worktree':
      worktreeWindow();
      break;
    case 'throw':
      guard.open('E5', e5());
      throw new Error('EVIL is not defined');
    case 'reject':
      guard.open('E5', e5());
      setTimeout(() => void Promise.reject(new Error('lost promise')), 50);
      break;
    case 'uncaught':
      guard.open('E5', e5());
      setTimeout(() => {
        throw new Error('thrown in a timer');
      }, 50);
      break;
    default:
      throw new Error(`abort-child: unknown scenario ${scenario}`);
  }
  const waiting = probe();
  ready();
  await waiting;
});
await guard.finish();
