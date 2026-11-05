import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configOf } from '../../../scripts/truth/batch/runner-lines.js';
import { runBatch } from '../../../scripts/truth/batch/runner.js';

// tests/truth/batch/runner-proc.test.ts's child: a tiny batch run by runBatch on the real process seam, the real
// filesystem and the real terminal. Its folder is argv[2], its scenario argv[3]. It makes a git repo of one commit on
// main there (repo/: the checkout under test), and runs two blocks into out/: kf, which only says PASS, and E5, which
// opens a dirty window (its restore a detached proc-child.mjs `slow` writing E5.started and E5.done), starts a probe (a
// `tree`: a child and a grandchild, pids in probe.pids), writes `ready` and waits for the probe — until the test
// interrupts it (`int`), or, `quick`, a probe that ends at once.

const [dir, scenario] = process.argv.slice(2);
const HELPER = join(import.meta.dirname, 'proc-child.mjs');
const node = process.execPath;
const at = (name: string) => join(dir, name);

const repo = at('repo');
mkdirSync(repo);
const git = (...args: string[]) => execFileSync('git', args, { timeout: 10_000, stdio: 'ignore' });
git('-c', 'init.defaultBranch=main', 'init', '-q', repo);
git('-C', repo, '-c', 'user.name=batch-test', '-c', 'user.email=batch-test@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init');

await runBatch({
  name: 'batch-r',
  needs: {},
  blocks: [
    { id: 'kf', label: 'kf live verdict', needs: [], run: async (ctx) => ctx.verdict('PASS', 'a fixture') },
    {
      id: 'E5',
      label: 'E5 verdict',
      needs: [],
      run: async (ctx) => {
        ctx.open('E5', {
          hand: ['E5: node e5.ts --restore'],
          cleanup: 'E5 cleanup',
          restore: async (run) => {
            const r = await run(node, [HELPER, 'slow', at('E5.started'), at('E5.done'), '0'], { secs: 10 });
            return r.code === 0 && existsSync(at('E5.done')) ? { ok: true, how: 'its state read back' } : { ok: false, why: `its restore exit ${r.code}` };
          },
        });
        const probe = scenario === 'quick' ? ctx.bounded(node, [HELPER, 'echo', 'probe done'], { secs: 10 }) : ctx.bounded(node, [HELPER, 'tree', at('probe.pids')], { secs: 30 });
        writeFileSync(at('ready'), String(process.pid));
        await probe;
        ctx.close('E5');
        ctx.verdict('PASS', 'the probe ended');
      },
    },
  ],
  config: configOf(['--out', at('out'), '--repo', repo], {}),
});
