import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbortGuard, markDirty, type AbortBlock, type WindowSpec } from '../../../scripts/truth/batch/abort.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import type { Ended, ProcessSeam, Started } from '../../../scripts/truth/batch/proc.js';
import { RESTORE_FILE } from '../../../scripts/truth/batch/run-dir.js';
import { StepLog } from '../../../scripts/truth/batch/steps.js';

// scripts/truth/batch/abort.ts over a fake process seam: the dirty windows, and what an interrupt, a throw or an
// unhandled rejection does with them — batch-6's on_abort, batch-7's TRAPEXIT, batch-11's detached restores, batch-12's
// abort SUMMARY. Real files in a temp dir, a fixed clock, no process started; the real signals, groups and pipes are
// tests/truth/batch/abort-proc.test.ts.

/** A fake seam: calls end when told to (or at their group's SIGTERM); the handlers it was given; the exit code. */
class FakeSeam implements ProcessSeam {
  readonly started: { cmd: string; args: readonly string[]; end(e: Ended): void }[] = [];
  readonly events: string[] = [];
  handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void } | undefined;
  exits: number[] = [];
  installs = 0;
  /** Its calls ignore SIGTERM (a grandchild that traps it): only SIGKILL ends them. */
  stubborn = false;
  private exited!: (code: number) => void;
  readonly exit$ = new Promise<number>((r) => (this.exited = r));
  private nextPid = 100;

  start(cmd: string, args: readonly string[]): Started {
    let end!: (e: Ended) => void;
    const done = new Promise<Ended>((r) => (end = r));
    const pid = this.nextPid++;
    this.started.push({ cmd, args, end });
    this.events.push(`start ${cmd} ${args.join(' ')}`);
    return { pid, done, out: () => (args[0] === 'judge' ? `${args[1]}\n` : ''), err: () => '' };
  }
  killGroup(pid: number, signal: NodeJS.Signals): void {
    this.events.push(`${signal} -${pid}`);
    if (signal === 'SIGTERM' && this.stubborn) return;
    this.started[pid - 100]?.end({ code: null, signal });
  }
  install(handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void }): void {
    this.handlers = handlers;
    this.installs++;
  }
  exit(code: number): void {
    this.exits.push(code);
    this.exited(code);
  }
}

let out: string;
let seam: FakeSeam;
let terminal: string[];
let log: StepLog;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'batch-abort-'));
  mkdirSync(join(out, 'meta'));
  seam = new FakeSeam();
  terminal = [];
  log = StepLog.open(nodeFs, {
    name: 'batch-n',
    runId: '1',
    blocks: ['kf', 'E5'],
    outFile: join(out, 'meta', 'batch-n.out'),
    stepsFile: join(out, 'steps.log'),
    summaryFile: join(out, 'meta', 'summary.txt'),
    terminal: (t) => {
      terminal.push(t);
    },
    clock,
  });
  terminal.length = 0;
});
afterEach(() => rmSync(out, { recursive: true, force: true }));

const clock = () => new Date(2026, 10, 4, 9, 44, 26);
const restoreFile = () => join(out, RESTORE_FILE);
const text = (p: string) => readFileSync(p, 'utf8');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const CHECKOUT = "OK checkout: main's HEAD 5c63edd1, clean";

const block = (name: string, over: Partial<AbortBlock> = {}): AbortBlock => ({
  block: name,
  complete: () => false,
  judge: async () => [`${name} verdict: PASS`],
  linesSoFar: () => [],
  ...over,
});

function guardOf(
  blocks: AbortBlock[] = [block('kf'), block('E5')],
  over: { head?: () => { checkout: string; labs: string[]; protectedLines: string[] }; graceMs?: number; installSecs?: number; clock?: () => Date } = {},
) {
  return new AbortGuard({
    name: 'batch-n',
    runId: '1',
    fs: nodeFs,
    log,
    seam,
    restoreFile: restoreFile(),
    head: over.head ?? (() => ({ checkout: CHECKOUT, labs: ['LAB android: OK — emulator-5554'], protectedLines: [] })),
    blocks,
    clock: 'clock' in over ? over.clock : clock,
    graceMs: over.graceMs ?? 5,
    installSecs: over.installSecs,
  });
}

const putBack = (how = 'read back'): WindowSpec['restore'] => async () => ({ ok: true, how });
const window = (over: Partial<WindowSpec> = {}): WindowSpec => ({ restore: putBack(), hand: ['E5 (Android): node e5.ts --restore'], ...over });

/** Run `body` inside the guard, send SIGINT once the body is waiting, and wait for the abort's exit. */
async function interrupt(guard: AbortGuard, body: () => void | Promise<void> = () => {}, signal: NodeJS.Signals = 'SIGINT') {
  const ran = guard.run(async () => {
    await body();
    await new Promise(() => {}); // the run waits here, as a probe would
  });
  ran.catch(() => {});
  await tick();
  seam.handlers?.signal(signal);
  return seam.exit$;
}

const summaryText = () => text(join(out, 'meta', 'summary.txt'));

describe('the abort on SIGINT, SIGTERM or SIGHUP — the dirty windows put back, verified; exit 130 (batch-6\'s on_abort: an interrupted run must not leave the remembered answer deleted)', () => {
  it('int-d55: a dirty window\'s restore runs and is verified; no RESTORE; the abort SUMMARY; exit 130', async () => {
    const guard = guardOf();
    const ran: string[] = [];
    expect(await interrupt(guard, () => guard.open('E5', window({ restore: async () => (ran.push('E5'), { ok: true, how: 'the lab state read back' }) })))).toBe(130);
    expect(seam.exits).toEqual([130]);
    expect(ran).toEqual(['E5']);
    expect(existsSync(restoreFile())).toBe(false);
    expect(summaryText().split('\n')).toEqual([
      '======== SUMMARY',
      CHECKOUT,
      'INTERRUPTED: batch-n run 1 was interrupted at 09:44:26',
      'LAB android: OK — emulator-5554',
      'kf: INTERRUPTED — its records are not complete, not judged (rerun ONLY=kf)',
      'E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)',
      'RESTORE: none — everything dirty was put back and verified',
      '09:44:26 ERROR batch-n interrupted (run 1) by SIGINT',
      '======== SUMMARY end (run 1, INTERRUPTED)',
      '',
    ]);
    expect(text(join(out, 'steps.log'))).toContain('09:44:26 OK   E5 put back (verified by the abort): the lab state read back');
    expect(text(join(out, 'steps.log'))).not.toContain('running call(s) stopped');
  });

  it('the guard\'s grace and install bound reach its calls: a probe that traps SIGTERM is killed after graceMs; an adb install gets installSecs', async () => {
    seam.stubborn = true;
    const guard = guardOf(undefined, { graceMs: 20, installSecs: 0.02 });
    const started = Date.now();
    const ran = guard.run(async () => {
      expect(await guard.bounded('adb', ['install', 'a.apk'])).toMatchObject({ code: 142, signal: 'SIGKILL' });
    });
    await ran;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seam.events).toEqual(['start adb install a.apk', 'SIGTERM -100', 'SIGKILL -100']);
  });

  it('with no clock given, the time is now\'s', async () => {
    const guard = guardOf(undefined, { clock: undefined });
    await interrupt(guard);
    const now = new Date();
    expect(summaryText()).toMatch(new RegExp(`INTERRUPTED: batch-n run 1 was interrupted at ${String(now.getHours()).padStart(2, '0')}:\\d\\d:\\d\\d`));
  });

  it('installed once, however often it runs', async () => {
    const guard = guardOf();
    await guard.run(async () => {});
    await guard.run(async () => {});
    expect(seam.installs).toBe(1);
  });

  it.each(['SIGTERM', 'SIGHUP'] as const)('%s aborts the same way (trap on_abort INT TERM HUP)', async (sig) => {
    const guard = guardOf();
    expect(await interrupt(guard, () => guard.open('E5', window()), sig)).toBe(130);
    expect(summaryText()).toContain(`ERROR batch-n interrupted (run 1) by ${sig}`);
  });

  it('d55-chooser / d43-restorefail: a restore that fails writes its hand lines to RESTORE — "RESTORE: state not provably put back" (b11-dry check.sh:20)', async () => {
    const guard = guardOf();
    await interrupt(guard, () => guard.open('E5', window({ restore: async () => ({ ok: false, why: 'check exit 3', hand: ['E5 (Android): not proven clean (check exit 3) — node e5.ts --check'] }) })));
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): not proven clean (check exit 3) — node e5.ts --check\n');
    const s = summaryText();
    expect(s).toContain(`RESTORE: state not provably put back — ${restoreFile()}:\nbatch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): not proven clean (check exit 3) — node e5.ts --check\n`);
    expect(s).toContain('09:44:26 ERROR E5 not provably put back: check exit 3');
    expect(s).toContain(`09:44:26 ERROR state not provably put back — ${restoreFile()}`);
  });

  it('a failed restore with no hand lines of its own gets the window\'s', async () => {
    const guard = guardOf();
    await interrupt(guard, () => guard.open('E5', window({ restore: async () => ({ ok: false, why: 'adb unreachable', hand: [] }) })));
    expect(text(restoreFile()).split('\n')[1]).toBe('E5 (Android): node e5.ts --restore');
  });

  it('a restore that throws is not put back, and says why', async () => {
    const guard = guardOf();
    await interrupt(guard, () =>
      guard.open('E5', window({ restore: async () => {
        throw new Error('no state.json');
      } })),
    );
    expect(summaryText()).toContain('ERROR E5 not provably put back: its restore threw: no state.json');
    expect(text(restoreFile())).toContain('E5 (Android): node e5.ts --restore');
  });

  it('a restore that never settles is bounded by the window\'s secs: not put back, and the abort goes on', async () => {
    const guard = guardOf();
    await interrupt(guard, () => guard.open('E5', window({ secs: 0.02, restore: () => new Promise(() => {}) })));
    expect(summaryText()).toContain('ERROR E5 not provably put back: its restore passed its bound (0.02 s)');
    expect(seam.exits).toEqual([130]);
  });

  it('a restore that says done while its state file is still dirty is not put back (batch-12: state_of after the restore)', async () => {
    const state = join(out, 'state.json');
    const guard = guardOf();
    await interrupt(guard, () => {
      guard.open('E5', window({ stateFile: state }));
      writeFileSync(state, '{"dirty":true,"before":"x"}');
    });
    expect(summaryText()).toContain(`ERROR E5 not provably put back: its restore said done, but ${state} is dirty`);
  });

  it('a restore that fails with its state file dirty says its own why', async () => {
    const state = join(out, 'state.json');
    const guard = guardOf();
    await interrupt(guard, () => {
      guard.open('E5', window({ stateFile: state, restore: async () => ({ ok: false, why: 'adb unreachable' }) }));
      writeFileSync(state, '{"dirty":true}');
    });
    expect(summaryText()).toContain('ERROR E5 not provably put back: adb unreachable');
  });

  it('a restore that says done with its state file clean, or with none written (the probe changed nothing yet), is put back', async () => {
    const clean = join(out, 'clean.json');
    const guard = guardOf();
    await interrupt(guard, () => {
      guard.open('E5', window({ stateFile: clean }));
      guard.open('W', window({ stateFile: join(out, 'never-written.json') }));
      writeFileSync(clean, '{"dirty":false}');
    });
    expect(existsSync(restoreFile())).toBe(false);
    expect(text(join(out, 'steps.log'))).toMatch(/OK {3}W put back[\s\S]*OK {3}E5 put back/);
  });

  it('every dirty window, the last opened first; a closed one is not restored', async () => {
    const order: string[] = [];
    const guard = guardOf();
    const spec = (n: string) => window({ restore: async () => (order.push(n), { ok: true, how: n }) });
    await interrupt(guard, () => {
      guard.open('WT', spec('WT'));
      guard.open('A', spec('A'));
      guard.open('E5', spec('E5'));
      guard.close('A');
    });
    expect(order).toEqual(['E5', 'WT']);
  });

  it('the restores run with detached calls only: the abort hands each restore the detached runner', async () => {
    const guard = guardOf();
    const exit = interrupt(guard, () =>
      guard.open('E5', window({ restore: async (run) => {
        const r = await run('adb', ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
        return r.code === 0 ? { ok: true, how: 'home' } : { ok: false, why: 'home failed' };
      } })),
    );
    await tick(20);
    // A later signal or the abort's own stopAll must not end it: only its own end does.
    seam.handlers?.signal('SIGINT');
    await tick(20);
    expect(seam.events.filter((e) => e.startsWith('SIG'))).toEqual([]);
    seam.started[0].end({ code: 0, signal: null });
    expect(await exit).toBe(130);
    expect(existsSync(restoreFile())).toBe(false);
  });

  it('running probes are stopped, each its whole group, before the first restore starts (a probe no longer gets the terminal\'s Ctrl-C)', async () => {
    const guard = guardOf();
    await interrupt(guard, () => {
      guard.open('E5', window({ restore: async () => (seam.events.push('restore E5'), { ok: true, how: 'x' }) }));
      void guard.bounded('node', ['probe.ts'], { secs: 60 });
    });
    expect(seam.events).toEqual(['start node probe.ts', 'SIGTERM -100', 'SIGKILL -100', 'restore E5']);
    expect(text(join(out, 'steps.log'))).toContain('NOTE 1 running call(s) stopped, each its whole process group');
  });
});

describe('later signals are ignored while the abort runs (`trap \'\' INT TERM HUP`)', () => {
  it('int-twice: a second SIGINT during a restore neither restarts the abort nor ends the restore; one exit, 130', async () => {
    const guard = guardOf();
    let release!: () => void;
    let calls = 0;
    const exit = interrupt(guard, () =>
      guard.open('E5', window({ restore: () => (calls++, new Promise((r) => (release = () => r({ ok: true, how: 'slow' })))) })),
    );
    await tick(10);
    seam.handlers?.signal('SIGINT');
    seam.handlers?.signal('SIGTERM');
    await tick(10);
    release();
    expect(await exit).toBe(130);
    expect(calls).toBe(1);
    expect(seam.exits).toEqual([130]);
    const steps = text(join(out, 'steps.log'));
    expect(steps).toContain('NOTE SIGINT ignored: the abort is putting state back');
    expect(steps).toContain('NOTE SIGTERM ignored: the abort is putting state back');
    expect(steps.match(/ERROR batch-n interrupted/g)).toHaveLength(1);
  });
});

describe('TRAPEXIT\'s port: a throw or a rejection inside a window still restores (batch-7: a fatal `set -u` inside a dirty window exited with no signal)', () => {
  it('setu-chooser: the run\'s body throws inside a window — the window restored, the abort SUMMARY names the error, exit 130', async () => {
    const guard = guardOf();
    const restored: string[] = [];
    const ran = guard.run(async () => {
      guard.open('E5', window({ restore: async () => (restored.push('E5'), { ok: true, how: 'x' }) }));
      throw new Error('EVIL is not defined');
    });
    await expect(ran).rejects.toThrow(/batch-n run 1 was interrupted/);
    expect(seam.exits).toEqual([130]);
    expect(restored).toEqual(['E5']);
    expect(summaryText()).toContain('ERROR batch-n interrupted (run 1) by an error: EVIL is not defined');
  });

  it('an uncaught exception or unhandled rejection (the seam\'s fatal handler) aborts the same way', async () => {
    const guard = guardOf();
    const restored: string[] = [];
    void guard.run(async () => {
      guard.open('E5', window({ restore: async () => (restored.push('E5'), { ok: true, how: 'x' }) }));
      await new Promise(() => {});
    }).catch(() => {});
    await tick();
    seam.handlers?.fatal(new Error('lost promise'));
    expect(await seam.exit$).toBe(130);
    expect(restored).toEqual(['E5']);
    expect(summaryText()).toContain('ERROR batch-n interrupted (run 1) by an uncaught error: lost promise');
  });

  it('a thrown non-Error is named too', async () => {
    const guard = guardOf();
    void guard.run(async () => {
      await new Promise(() => {});
    }).catch(() => {});
    await tick();
    seam.handlers?.fatal('a string');
    await seam.exit$;
    expect(summaryText()).toContain('by an uncaught error: a string');
  });

  it('not while aborting: an error during the abort is noted, and the abort goes on once (TRAPEXIT\'s `ABORTING -eq 0`)', async () => {
    const guard = guardOf();
    let release!: () => void;
    const exit = interrupt(guard, () => guard.open('E5', window({ restore: () => new Promise((r) => (release = () => r({ ok: true, how: 'x' }))) })));
    await tick(10);
    seam.handlers?.fatal(new Error('late'));
    release();
    expect(await exit).toBe(130);
    expect(seam.exits).toEqual([130]);
    expect(summaryText()).toContain('ERROR an uncaught error while aborting: late');
  });

  it('a throw outside any window prints the abort SUMMARY too (a waiter waits for its marker), exit 130', async () => {
    const guard = guardOf();
    await expect(guard.run(async () => {
      throw new Error('bug');
    })).rejects.toThrow(/interrupted/);
    expect(seam.exits).toEqual([130]);
    expect(summaryText()).toContain('RESTORE: none — everything dirty was put back and verified');
  });

  it('a body that returns while the abort runs does not return as a finished run', async () => {
    const guard = guardOf();
    let go!: () => void;
    const ran = guard.run(() => new Promise<void>((r) => (go = r)));
    await tick();
    seam.handlers?.signal('SIGINT');
    go();
    await expect(ran).rejects.toThrow(/interrupted/);
    expect(seam.exits).toEqual([130]);
  });

  it('only the run\'s own errors abort it: a call that fails or is killed is a result (TRAPEXIT acted in the main shell only)', async () => {
    const guard = guardOf();
    const ran = guard.run(async () => {
      const a = guard.bounded('adb', ['devices']);
      seam.started[0].end({ code: 1, signal: null });
      const b = guard.bounded('adb', ['devices']);
      seam.started[1].end({ code: null, signal: 'SIGKILL' });
      return [(await a).code, (await b).code];
    });
    expect(await ran).toEqual([1, 137]);
    expect(seam.exits).toEqual([]);
  });

  it('a body that throws once the abort has begun (its next probe refused) starts no second abort', async () => {
    const guard = guardOf();
    let release!: () => void;
    let restores = 0;
    const ran = guard.run(async () => {
      guard.open('E5', window({ restore: () => (restores++, new Promise((r) => (release = () => r({ ok: true, how: 'x' })))) }));
      await guard.bounded('node', ['probe.ts'], { secs: 60 });
      await guard.bounded('node', ['next-probe.ts'], { secs: 60 });
    });
    ran.catch(() => {});
    await tick();
    seam.handlers?.signal('SIGINT');
    await tick(30);
    release();
    expect(await seam.exit$).toBe(130);
    await tick(10);
    expect([restores, seam.exits]).toEqual([1, [130]]);
    expect(text(join(out, 'steps.log')).match(/ERROR batch-n interrupted/g)).toHaveLength(1);
  });

  it('once aborting, no window opens and no probe starts', async () => {
    const guard = guardOf();
    let release!: () => void;
    const exit = interrupt(guard, () => guard.open('E5', window({ restore: () => new Promise((r) => (release = () => r({ ok: true, how: 'x' }))) })));
    await tick(10);
    expect(() => guard.open('W', window())).toThrow(/no window opens while the run is being stopped/);
    await expect(guard.bounded('adb', ['devices'])).rejects.toThrow(/not started: the run is being stopped/);
    release();
    await exit;
  });
});

describe('the abort SUMMARY (batch-12): INTERRUPTED, the finished blocks judged device-free, the cleanup line, through words.ts', () => {
  it('a block whose records are complete is judged now with a detached call; one cut inside its window, or incomplete, is INTERRUPTED', async () => {
    const guard = guardOf([
      block('kf', { complete: () => true, judge: async (run) => (await run('node', ['judge', 'kf live verdict: PASS'], { secs: 5 })).out.trim().split('\n') }),
      block('lvd62', { complete: () => false, linesSoFar: () => ['lv-d62 main drop: OBSERVED 3/3'] }),
      block('E5', { complete: () => true, linesSoFar: () => ['E5 a verdict: PASS'] }),
    ]);
    const exit = interrupt(guard, () => guard.open('E5', window({ block: 'E5', cleanup: 'E5 cleanup', restore: putBack('the lab state read back, no chooser') })));
    // The judge's detached call ends when it is told: answer it.
    for (let i = 0; i < 50 && seam.started.length === 0; i++) await tick(5);
    seam.started[0].end({ code: 0, signal: null });
    expect(await exit).toBe(130);
    expect(summaryText().split('\n').slice(4, 11)).toEqual([
      'kf live verdict: PASS',
      '(before the interrupt) lv-d62 main drop: OBSERVED 3/3',
      'lvd62: INTERRUPTED — its records are not complete, not judged (rerun ONLY=lvd62)',
      '(before the interrupt) E5 a verdict: PASS',
      'E5: INTERRUPTED — its records are not complete, not judged (rerun ONLY=E5)',
      'E5 cleanup: OK — the lab state read back, no chooser (verified by the abort)',
      'RESTORE: none — everything dirty was put back and verified',
    ]);
  });

  it('the cleanup line of a restore that failed: ERROR, or the outcome\'s own FAIL (a lab default left)', async () => {
    const guard = guardOf([block('E5'), block('W')]);
    await interrupt(guard, () => {
      guard.open('E5', window({ block: 'E5', cleanup: 'E5 cleanup', restore: async () => ({ ok: false, why: 'mAlways=true', verdict: 'FAIL' }) }));
      guard.open('W', window({ block: 'W', cleanup: 'W cleanup', restore: async () => ({ ok: false, why: 'adb unreachable' }) }));
    });
    const s = summaryText();
    expect(s).toContain('E5 cleanup: FAIL — mAlways=true (the abort)');
    expect(s).toContain('W cleanup: ERROR — adb unreachable (the abort)');
  });

  it('a window with no cleanup label adds no cleanup line', async () => {
    const guard = guardOf([block('E5')]);
    await interrupt(guard, () => guard.open('E5', window({ block: 'E5' })));
    expect(summaryText()).not.toMatch(/by the abort\)|\(the abort\)/);
  });

  it('a judge that throws, or a complete() that throws, leaves the block INTERRUPTED and names why', async () => {
    const guard = guardOf([
      block('kf', { complete: () => true, judge: async () => {
        throw new Error('analyze.txt missing');
      } }),
      block('T6', { complete: () => {
        throw new Error('no dir');
      } }),
    ]);
    await interrupt(guard);
    const s = summaryText();
    expect(s).toContain('kf: INTERRUPTED — its records are not complete, not judged (rerun ONLY=kf)');
    expect(s).toContain('ERROR kf not judged by the abort: analyze.txt missing');
    expect(s).toContain('T6: INTERRUPTED');
  });

  it('a judge that never settles is bounded (judgeSecs)', async () => {
    const guard = new AbortGuard({
      name: 'batch-n', runId: '1', fs: nodeFs, log, seam, restoreFile: restoreFile(), clock, graceMs: 5, judgeSecs: 0.02,
      head: () => ({ checkout: CHECKOUT, labs: [], protectedLines: [] }),
      blocks: [block('kf', { complete: () => true, judge: () => new Promise(() => {}) })],
    });
    await interrupt(guard);
    expect(summaryText()).toContain('ERROR kf not judged by the abort: its judge passed its bound (0.02 s)');
  });

  it('the protected-key lines are kept, after the blocks', async () => {
    const guard = guardOf([block('kf')], { head: () => ({ checkout: CHECKOUT, labs: [], protectedLines: ['finportal: OK — unchanged'] }) });
    await interrupt(guard);
    expect(summaryText().split('\n').slice(4, 6)).toEqual(['finportal: OK — unchanged', 'RESTORE: none — everything dirty was put back and verified']);
  });

  it('a head() that throws still gives a SUMMARY, its checkout line an ERROR', async () => {
    const guard = guardOf([], { head: () => {
      throw new Error('checkout.txt gone');
    } });
    await interrupt(guard);
    expect(summaryText().split('\n')).toEqual([
      '======== SUMMARY',
      'ERROR the checkout line is not known (checkout.txt gone)',
      'INTERRUPTED: batch-n run 1 was interrupted at 09:44:26',
      'RESTORE: none — everything dirty was put back and verified',
      '09:44:26 ERROR batch-n interrupted (run 1) by SIGINT',
      '======== SUMMARY end (run 1, INTERRUPTED)',
      '',
    ]);
  });

  it('everything durable before the terminal: the RESTORE file and summary.txt exist when the terminal gets the SUMMARY (a tty paused with Ctrl-S blocks only that write)', async () => {
    const seen: boolean[] = [];
    log = StepLog.open(nodeFs, {
      name: 'batch-n', runId: '2', blocks: ['E5'], outFile: join(out, 'meta', 'b.out'), stepsFile: join(out, 'steps.log'), summaryFile: join(out, 'meta', 'summary.txt'), clock,
      terminal: (t) => {
        if (t.startsWith('======== SUMMARY')) seen.push(existsSync(restoreFile()), summaryText().includes('SUMMARY end'));
      },
    });
    const guard = guardOf([block('E5')]);
    await interrupt(guard, () => guard.open('E5', window({ restore: async () => ({ ok: false, why: 'x' }) })));
    expect(seen).toEqual([true, true]);
  });
});

describe('an abort that fails itself still exits 130', () => {
  it('its SUMMARY cannot be written (summary.txt a folder): the failure said on stderr, exit 130', async () => {
    mkdirSync(join(out, 'meta', 'blocked'));
    log = StepLog.open(nodeFs, { name: 'batch-n', runId: '3', blocks: ['E5'], outFile: join(out, 'meta', 'c.out'), stepsFile: join(out, 'steps.log'), summaryFile: join(out, 'meta', 'blocked'), clock, terminal: () => {} });
    const said: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((t) => (said.push(String(t)), true));
    try {
      expect(await interrupt(guardOf([block('E5')]))).toBe(130);
    } finally {
      write.mockRestore();
    }
    expect(said.join('')).toMatch(/^batch-n: the abort failed: EISDIR/);
  });
});

describe('finish — the normal end writes RESTORE for any window still dirty (batch-12: "ended … with state not provably put back")', () => {
  it('a window left open: its hand lines appended under an "ended at" header; returned for the SUMMARY; the windows cleared', async () => {
    const guard = guardOf();
    await guard.run(async () => {
      guard.open('E5', window());
      guard.open('WT', window({ hand: ['lvd62: git worktree remove --force wt'] }));
    });
    const written = guard.finish();
    expect(written).toEqual(['batch-n run 1 ended at 2026-11-04 09:44:26; state to put back by hand:', 'E5 (Android): node e5.ts --restore', 'lvd62: git worktree remove --force wt']);
    expect(text(restoreFile())).toBe(`${written.join('\n')}\n`);
    expect(text(join(out, 'steps.log'))).toContain(`ERROR state not provably put back — the hand commands are in ${restoreFile()}`);
    expect(guard.finish()).toEqual(written);
    expect(text(restoreFile())).toBe(`${written.join('\n')}\n`);
  });

  it('nothing open: nothing written, no file', async () => {
    const guard = guardOf();
    await guard.run(async () => {
      guard.open('E5', window());
      guard.close('E5');
    });
    expect(guard.finish()).toEqual([]);
    expect(existsSync(restoreFile())).toBe(false);
    expect(text(join(out, 'steps.log'))).not.toContain('ERROR');
  });

  it('an interrupt after the end\'s RESTORE: the abort SUMMARY shows the end\'s lines too (RESTORE is appended, never overwritten)', async () => {
    const guard = guardOf();
    await guard.run(async () => guard.open('E5', window()));
    guard.finish();
    await interrupt(guard);
    expect(summaryText()).toContain(`RESTORE: state not provably put back — ${restoreFile()}:\nbatch-n run 1 ended at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n`);
  });
});

describe('open and close — a dirty window from before its first change until a verified restore', () => {
  it('a window opened twice, one with no hand lines, or closing one not open: a programming error', () => {
    const guard = guardOf();
    guard.open('E5', window());
    expect(() => guard.open('E5', window())).toThrow(/E5 is open already/);
    expect(() => guard.open('W', window({ hand: [] }))).toThrow(/W: a window needs its hand lines/);
    expect(() => guard.close('W')).toThrow(/W is not open/);
    expect(() => guard.open('X', window({ cleanup: 'X cleanup' }))).toThrow(/X: a cleanup line needs the block it belongs to/);
  });

  it('opened over an existing state file: marked dirty, its other fields kept — a window reopened over a restore that had cleared it (batch-11\'s reinstall after the restore) reads dirty again', () => {
    const state = join(out, 'state.json');
    writeFileSync(state, '{"dirty":false,"before":{"k":1}}');
    guardOf().open('E5', window({ stateFile: state }));
    expect(JSON.parse(text(state))).toEqual({ dirty: true, before: { k: 1 } });
  });
});

describe('markDirty — the state-file protocol: dirty until a verified restore clears it', () => {
  it('an object: dirty set true, every other field kept, replaced whole (no leftover temp file)', () => {
    const state = join(out, 'state.json');
    writeFileSync(state, '{"dirty":false,"a":[1,2]}');
    expect(markDirty(nodeFs, state)).toBe('marked');
    expect(JSON.parse(text(state))).toEqual({ dirty: true, a: [1, 2] });
    expect(nodeFs.list(out).filter((n) => n.startsWith('state.json'))).toEqual(['state.json']);
  });

  it('missing: nothing written (the probe has recorded no before-state yet)', () => {
    expect(markDirty(nodeFs, join(out, 'none.json'))).toBe('missing');
    expect(existsSync(join(out, 'none.json'))).toBe(false);
  });

  it('unreadable (cut short, no object): left as it is — evidence, and already not clean', () => {
    for (const [name, body] of [['cut.json', '{"dirty":fa'], ['list.json', '[1]'], ['null.json', 'null'], ['number.json', '7'], ['string.json', '"dirty"']]) {
      writeFileSync(join(out, name), body);
      expect(markDirty(nodeFs, join(out, name))).toBe('unreadable');
      expect(text(join(out, name))).toBe(body);
    }
  });
});
