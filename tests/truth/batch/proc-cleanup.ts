import type { ChildProcess } from 'node:child_process';

// The real-child tests' cleanup (bounded-proc.test.ts, abort-proc.test.ts): whatever a test did, its children end
// and hold nothing of vitest open. Under parallel load a kill was refused with EPERM once (review round 3), and a
// child left with its pipes open kept the worker alive: so each kill is tried again, every pipe is destroyed and
// every child unref'd. The fixtures bound their own lives too (proc-child.mjs, abort-child.ts), so a child no kill
// reached still ends.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** SIGKILL to `target` (a pid, or -pgid for a group); EPERM tried again up to 3 times, 50 ms apart; ESRCH is done. */
export async function killHard(target: number): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      process.kill(target, 'SIGKILL');
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') return;
      await sleep(50);
    }
  }
}

/** End `children` (their groups and themselves) and every pid in `pids`; let go of their pipes. */
export async function endChildren(children: readonly ChildProcess[], pids: readonly number[]): Promise<void> {
  for (const c of children) {
    for (const stream of [c.stdin, c.stdout, c.stderr]) stream?.destroy();
    c.unref();
  }
  const targets = [...children.flatMap((c) => (c.pid === undefined ? [] : [-c.pid, c.pid])), ...pids];
  for (const t of targets) await killHard(t);
}
