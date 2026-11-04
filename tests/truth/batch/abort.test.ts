import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbortGuard, JUDGE_BUDGET_SECS, markDirty, type AbortBlock, type WindowSpec } from '../../../scripts/truth/batch/abort.js';
import { MAX_SECS } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs, type BatchFs } from '../../../scripts/truth/batch/io.js';
import type { Ended, KillResult, ProcessSeam, Started } from '../../../scripts/truth/batch/proc.js';
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
    const exited = new Promise<Ended>((r) => (end = r));
    const pid = this.nextPid++;
    this.started.push({ cmd, args, end: (e) => (this.ended.add(pid), end(e)) });
    this.events.push(`start ${cmd} ${args.join(' ')}`);
    return { pid, exited, closed: exited.then(() => {}), out: () => (args[0] === 'judge' ? `${args[1]}\n` : ''), err: () => '', release: () => {} };
  }
  /** Every kill throws `kill EPERM`, as one did under load (review round 2). */
  killThrows = false;
  /** The groups whose kills (and probes) throw `kill EPERM`. */
  readonly refusePids = new Set<number>();
  readonly ended = new Set<number>();
  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult {
    if (this.killThrows || this.refusePids.has(pid)) {
      if (signal !== 0) this.events.push(`${signal} -${pid}`);
      throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    }
    if (signal === 0) return this.ended.has(pid) ? 'gone' : 'sent';
    this.events.push(`${signal} -${pid}`);
    if (signal === 'SIGTERM' && this.stubborn) return 'sent';
    this.started[pid - 100]?.end({ code: null, signal });
    return 'sent';
  }
  install(handlers: { signal(name: NodeJS.Signals): void; fatal(error: unknown): void }): void {
    this.handlers = handlers;
    this.installs++;
  }
  exit(code: number): void {
    this.exits.push(code);
    this.exited(code);
  }
  readonly said: string[] = [];
  stderr(text: string): void {
    this.said.push(text);
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
  over: { head?: () => { checkout: string; labs: string[]; protectedLines: string[] }; graceMs?: number; installSecs?: number; clock?: () => Date; judgeBudgetSecs?: number; fs?: BatchFs } = {},
) {
  return new AbortGuard({
    name: 'batch-n',
    runId: '1',
    fs: over.fs ?? nodeFs,
    log,
    seam,
    restoreFile: restoreFile(),
    judgeBudgetSecs: over.judgeBudgetSecs,
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
    expect(seam.events).toEqual(['start adb install a.apk', 'SIGTERM -100', 'SIGKILL -100', 'SIGKILL -100']);
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
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n');
  });

  it('a restore that never settles is bounded by the window\'s secs: not put back, and the abort goes on', async () => {
    const guard = guardOf();
    await interrupt(guard, () => guard.open('E5', window({ secs: 0.02, restore: () => new Promise(() => {}) })));
    expect(summaryText()).toContain('ERROR E5 not provably put back: its restore passed its bound (0.02 s) and was stopped there');
    expect(seam.exits).toEqual([130]);
  });

  it('a restore stopped at its bound cannot start its next step (review round 2)', async () => {
    const guard = guardOf();
    await interrupt(guard, () =>
      guard.open('E5', window({ secs: 0.03, restore: async (run) => {
        await run('node', ['slow-step.ts'], { secs: 60 });
        await run('node', ['second-step.ts'], { secs: 60 });
        return { ok: true, how: 'both steps' };
      } })),
    );
    await tick(20);
    expect(seam.events.filter((e) => e.startsWith('start'))).toEqual(['start node slow-step.ts']);
    expect(summaryText()).toContain('ERROR E5 not provably put back: its restore passed its bound (0.03 s) and was stopped there');
  });

  it('a restore stopped at its bound: the detached calls it started are ended, each its group; the RESTORE says it was stopped part-way (review round 1)', async () => {
    const guard = guardOf();
    await interrupt(guard, () =>
      guard.open('E5', window({ secs: 0.03, restore: async (run) => {
        await run('adb', ['install', '-r', 'a.apk']);
        return { ok: true, how: 'never' };
      } })),
    );
    expect(seam.events.slice(0, 3)).toEqual(['start adb install -r a.apk', 'SIGTERM -100', 'SIGKILL -100']);
    expect(text(restoreFile()).split('\n').slice(1, 3)).toEqual([
      "E5: its restore was stopped at its bound (0.03 s), part-way — check the state it left before the hand commands below",
      'E5 (Android): node e5.ts --restore',
    ]);
  });

  it('a restore that says done while its state file is still dirty is not put back (batch-12: state_of after the restore)', async () => {
    const state = join(out, 'state.json');
    const guard = guardOf();
    await interrupt(guard, () => {
      guard.open('E5', window({ stateFile: state }));
      writeFileSync(state, '{"dirty":true,"before":"x"}');
    });
    expect(summaryText()).toContain(`ERROR E5 not provably put back: its restore said done, but ${state} is dirty`);
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n');
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
    expect(seam.events.slice(0, 3)).toEqual(['start node probe.ts', 'SIGTERM -100', 'SIGKILL -100']);
    expect(seam.events.indexOf('restore E5')).toBeGreaterThan(2);
    expect(text(join(out, 'steps.log'))).toContain('NOTE 1 running call(s) stopped, each its whole process group');
  });
});

describe('the abort leaves no timer behind: the runner can end on its own (review round 1)', () => {
  it('a restore and a judge settled in time: every bound\'s timer cleared', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const guard = guardOf([block('kf', { complete: () => true })]);
      void guard.run(async () => {
        guard.open('E5', window());
        await new Promise(() => {});
      }).catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      seam.handlers?.signal('SIGINT');
      for (let i = 0; i < 20 && seam.exits.length === 0; i++) await vi.advanceTimersByTimeAsync(1);
      expect(seam.exits).toEqual([130]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a group kill that throws EPERM stops no restore (review round 2, BLOCKER)', () => {
  it('every kill throws: the probe not proven stopped, said; every window still put back; exit 130; nothing unhandled', async () => {
    seam.killThrows = true;
    const restored: string[] = [];
    const guard = guardOf();
    expect(await interrupt(guard, () => {
      guard.open('A', window({ restore: async () => (restored.push('A'), { ok: true, how: 'a' }) }));
      guard.open('B', window({ restore: async () => (restored.push('B'), { ok: true, how: 'b' }) }));
      void guard.bounded('node', ['probe.ts'], { secs: 60 });
    })).toBe(130);
    expect(restored).toEqual(['B', 'A']);
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\ngroup 100 may still be running: kill -9 -100, then check the state of A, B\n');
    expect(summaryText()).not.toContain('RESTORE: none');
    const steps = text(join(out, 'steps.log'));
    expect(steps).toContain('ERROR a kill not delivered: SIGTERM to group 100: EPERM — group 100 may still be running');
    expect(steps).toContain('ERROR a kill not delivered: SIGKILL to group 100: EPERM — group 100 may still be running');
    expect(seam.said).toEqual([]);
  });

  it('a restore past its bound whose kill was not delivered: "may still be running", its group line first, no "stopped part-way" (review round 3)', async () => {
    seam.refusePids.add(100);
    let judged = 0;
    const guard = guardOf([block('kf', { complete: () => true, judge: async () => (judged++, ['kf: PASS']) })]);
    await interrupt(guard, () =>
      guard.open('E5', window({ secs: 0.03, restore: async (run) => {
        await run('adb', ['install', '-r', 'a.apk']);
        return { ok: true, how: 'never' };
      } })),
    );
    expect(judged).toBe(0);
    expect(text(restoreFile())).toBe("batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\ngroup 100 may still be running: kill -9 -100, then check E5's state\nE5 (Android): node e5.ts --restore\n");
    expect(summaryText()).toContain('ERROR E5 not provably put back: its restore passed its bound (0.03 s) and may still be running');
  });

  it('a judge past the budget whose kill was not delivered: its group line in RESTORE too, after the judging', async () => {
    seam.refusePids.add(100);
    const guard = guardOf([block('kf', { complete: () => true, judge: (run) => run('node', ['analyze.ts'], { secs: 60 }).then(() => ['kf: PASS']) })], { judgeBudgetSecs: 0.03 });
    await interrupt(guard);
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\ngroup 100 may still be running: kill -9 -100, then check the judge of kf (device-free)\n');
    expect(summaryText()).toContain(`RESTORE: state not provably put back — ${restoreFile()}:`);
  });

  it('the normal path: a SIGKILL after a leader\'s end not delivered is an ERROR line at once, and the end\'s RESTORE has its group line (review round 3)', async () => {
    seam.refusePids.add(100);
    const guard = guardOf();
    await guard.run(async () => {
      const r = guard.bounded('adb', ['devices']);
      await tick();
      seam.started[0].end({ code: 0, signal: null });
      expect(await r).toMatchObject({ code: 0 });
    });
    expect(text(join(out, 'steps.log'))).toContain('ERROR a kill not delivered: SIGKILL to group 100: EPERM — group 100 may still be running');
    expect(guard.finish()).toEqual(['batch-n run 1 ended at 2026-11-04 09:44:26; state to put back by hand:', "group 100 may still be running: kill -9 -100, then check the device's state"]);
  });

  it('…with a window still open at the end, its group line names that window', async () => {
    seam.refusePids.add(100);
    const guard = guardOf();
    await guard.run(async () => {
      const r = guard.bounded('adb', ['devices']);
      await tick();
      seam.started[0].end({ code: 0, signal: null });
      await r;
      guard.open('E5', window());
    });
    expect(guard.finish()).toEqual(['batch-n run 1 ended at 2026-11-04 09:44:26; state to put back by hand:', "group 100 may still be running: kill -9 -100, then check E5's state", 'E5 (Android): node e5.ts --restore']);
  });

  it('…and when the run is interrupted instead, the abort\'s RESTORE has it, naming the window open then', async () => {
    seam.refusePids.add(100);
    const guard = guardOf();
    let opened = false;
    const ran = guard.run(async () => {
      const r = guard.bounded('adb', ['devices']);
      await tick();
      seam.started[0].end({ code: 0, signal: null });
      await r;
      guard.open('E5', window());
      opened = true;
      await new Promise(() => {});
    });
    ran.catch(() => {});
    for (let i = 0; i < 100 && !opened; i++) await tick(5);
    seam.handlers?.signal('SIGINT');
    expect(await seam.exit$).toBe(130);
    expect(text(restoreFile())).toBe("batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\ngroup 100 may still be running: kill -9 -100, then check E5's state\n");
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
    expect(s).toContain('kf: INTERRUPTED — not judged (its judge failed: analyze.txt missing; rerun ONLY=kf)');
    expect(s).toContain('ERROR kf not judged by the abort: analyze.txt missing');
    expect(s).toContain('T6: INTERRUPTED');
  });

  it('the judges share one budget (review round 1): a judge that never settles spends it, its calls are stopped, and the blocks after it are not judged', async () => {
    let judged = 0;
    const guard = guardOf(
      [
        block('kf', { complete: () => true, judge: (run) => (judged++, run('node', ['analyze.ts'], { secs: 60 }).then(() => ['kf: PASS'])) }),
        block('T6', { complete: () => true, judge: async () => (judged++, ['T6 verdict: PASS']) }),
      ],
      { judgeBudgetSecs: 0.05 },
    );
    await interrupt(guard);
    const s = summaryText();
    expect(s).toContain("kf: INTERRUPTED — not judged (the abort's judging budget of 0.05 s was spent; rerun ONLY=kf)");
    expect(s).toContain("T6: INTERRUPTED — not judged (the abort's judging budget of 0.05 s was spent; rerun ONLY=T6)");
    expect(judged).toBe(1);
    expect(seam.events).toEqual(['start node analyze.ts', 'SIGTERM -100', 'SIGKILL -100', 'SIGKILL -100']);
  });

  it('the judging budget is 120 s unless given', () => {
    expect(JUDGE_BUDGET_SECS).toBe(120);
  });

  it('once a restore passed its bound, no block is judged: the abort has taken long already', async () => {
    let judged = 0;
    const guard = guardOf([block('kf', { complete: () => true, judge: async () => (judged++, ['kf: PASS']) })]);
    await interrupt(guard, () => guard.open('E5', window({ secs: 0.02, restore: () => new Promise(() => {}) })));
    expect(judged).toBe(0);
    expect(summaryText()).toContain('kf: INTERRUPTED — not judged (a restore passed its bound, so the abort judges nothing more; rerun ONLY=kf)');
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
    expect(await interrupt(guardOf([block('E5')]))).toBe(130);
    expect(seam.said.join('')).toMatch(/^batch-n: the abort failed: EISDIR/);
  });

  it('the log failing (ENOSPC, the out folder gone) stops no restore: every window put back, RESTORE written, exit 130 (review round 1)', async () => {
    let broken = false;
    const flaky: BatchFs = { ...nodeFs, append: (p, t) => {
      if (broken && p !== restoreFile()) throw new Error('ENOSPC: no space left on device');
      nodeFs.append(p, t);
    } };
    log = StepLog.open(flaky, { name: 'batch-n', runId: '4', blocks: ['E5'], outFile: join(out, 'meta', 'd.out'), stepsFile: join(out, 'steps.log'), summaryFile: join(out, 'meta', 'summary.txt'), clock, terminal: () => {} });
    const restored: string[] = [];
    const guard = guardOf([block('E5')], { fs: flaky });
    expect(await interrupt(guard, () => {
      guard.open('A', window({ restore: async () => (restored.push('A'), { ok: false, why: 'x', hand: ['A: by hand'] }) }));
      guard.open('B', window({ restore: async () => (restored.push('B'), { ok: true, how: 'y' }) }));
      broken = true;
    })).toBe(130);
    expect(restored).toEqual(['B', 'A']);
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nA: by hand\n');
  });

  it('only RESTORE cannot be written: stderr carries its lines, and the SUMMARY still lists them', async () => {
    const flaky: BatchFs = { ...nodeFs, append: (p, t) => {
      if (p === restoreFile()) throw new Error('EACCES');
      nodeFs.append(p, t);
    } };
    const guard = guardOf([block('E5')], { fs: flaky });
    await interrupt(guard, () => guard.open('A', window({ restore: async () => ({ ok: false, why: 'x', hand: ['A: by hand'] }) })));
    expect(seam.said.join('')).toContain('A: by hand');
    expect(summaryText()).toContain(`RESTORE: state not provably put back — ${restoreFile()}:\nbatch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nA: by hand\n`);
  });

  it('the normal end\'s RESTORE that cannot be written throws to the runner: no abort is running to say it', async () => {
    const flaky: BatchFs = { ...nodeFs, append: (p, t) => {
      if (p === restoreFile()) throw new Error('EACCES');
      nodeFs.append(p, t);
    } };
    const guard = guardOf([block('E5')], { fs: flaky });
    await guard.run(async () => guard.open('A', window()));
    expect(() => guard.finish()).toThrow(/EACCES/);
    expect(seam.said).toEqual([]);
  });

  it('RESTORE itself cannot be written: its hand lines go to stderr once, the last place left', async () => {
    let broken = false;
    const flaky: BatchFs = { ...nodeFs, append: (p, t) => {
      if (broken) throw new Error('EROFS');
      nodeFs.append(p, t);
    } };
    log = StepLog.open(flaky, { name: 'batch-n', runId: '5', blocks: ['E5'], outFile: join(out, 'meta', 'e.out'), stepsFile: join(out, 'steps.log'), clock, terminal: () => {} });
    const guard = guardOf([block('E5')], { fs: flaky });
    await interrupt(guard, () => {
      guard.open('A', window({ restore: async () => ({ ok: false, why: 'x', hand: ['A: by hand'] }) }));
      broken = true;
    });
    const said = seam.said.join('');
    expect(said).toContain(`batch-n: ${restoreFile()} could not be written (EROFS):\nbatch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nA: by hand\n`);
    expect(said.match(/state to put back by hand:/g)).toHaveLength(1);
    expect(said.match(/A: by hand/g)).toHaveLength(1);
    expect(seam.exits).toEqual([130]);
  });

  it('a window whose put-back throws past its restore (its state file cannot be read) does not stop the next window', async () => {
    const restored: string[] = [];
    let boom = false;
    const guard = guardOf([block('E5')], { fs: { ...nodeFs, exists: (p) => {
      if (boom && p.endsWith('boom.json')) throw new Error('EACCES');
      return nodeFs.exists(p);
    } } });
    await interrupt(guard, () => {
      guard.open('A', window({ restore: async () => (restored.push('A'), { ok: true, how: 'a' }) }));
      guard.open('B', window({ stateFile: join(out, 'boom.json'), restore: async () => (restored.push('B'), { ok: true, how: 'b' }) }));
      boom = true;
    });
    expect(restored).toEqual(['B', 'A']);
    expect(summaryText()).toContain('ERROR B not provably put back: its put-back failed: EACCES');
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n');
  });
});

describe('the body keeps running during the abort: its close() and finish() empty no window (review round 1, MAJOR)', () => {
  const bodyThen = (guard: AbortGuard, after: () => void) => async () => {
    guard.open('E5', window({ restore: async () => ({ ok: false, why: 'check exit 3' }) }));
    await guard.bounded('node', ['probe.ts'], { secs: 60 });
    after();
  };

  it('close() in the body after its probe was stopped: a NOTE, no throw; the window still put back by the abort, RESTORE under the interrupted header', async () => {
    const guard = guardOf();
    let threw: unknown;
    await interrupt(guard, bodyThen(guard, () => {
      try {
        guard.close('E5');
      } catch (e) {
        threw = e;
      }
    }));
    expect(threw).toBeUndefined();
    expect(text(restoreFile())).toBe('batch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n');
    expect(text(join(out, 'steps.log'))).toContain('NOTE close(E5) ignored: the abort is putting the windows back');
  });

  it('finish() in the body after its probe was stopped: a NOTE, nothing more written as "ended", the lines so far returned; the abort writes the window', async () => {
    const guard = guardOf();
    let returned: string[] = [];
    const ended = ['batch-n run 1 ended at 2026-11-04 09:44:26; state to put back by hand:', 'W: by hand'];
    await interrupt(guard, async () => {
      guard.open('W', window({ hand: ['W: by hand'] }));
      expect(guard.finish()).toEqual(ended);
      await bodyThen(guard, () => (returned = guard.finish()))();
    });
    expect(returned).toEqual(ended);
    expect(text(restoreFile())).toBe(`${ended.join('\n')}\nbatch-n run 1 interrupted at 2026-11-04 09:44:26; state to put back by hand:\nE5 (Android): node e5.ts --restore\n`);
    expect(text(join(out, 'steps.log'))).toContain('NOTE finish() ignored: the abort is putting the windows back');
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
  it('a window opened twice, one with no hand lines, closing one not open, a cleanup line with no wanted block: a programming error', async () => {
    const guard = guardOf();
    await guard.run(async () => {
      guard.open('E5', window());
      expect(() => guard.open('E5', window())).toThrow(/E5 is open already/);
      expect(() => guard.open('W', window({ hand: [] }))).toThrow(/W: a window needs its hand lines/);
      expect(() => guard.close('W')).toThrow(/W is not open/);
      expect(() => guard.open('X', window({ cleanup: 'X cleanup' }))).toThrow(/X: a cleanup line needs a wanted block \(none given; wanted: kf, E5\)/);
      expect(() => guard.open('Y', window({ cleanup: 'Y cleanup', block: 'lvd62' }))).toThrow(/Y: a cleanup line needs a wanted block \(lvd62; wanted: kf, E5\)/);
      for (const secs of [0, -1, Number.NaN, MAX_SECS + 1]) expect(() => guard.open('S', window({ secs }))).toThrow(new RegExp(`S: a restore bound of ${secs} s: more than 0 and at most ${MAX_SECS} s is needed`));
      guard.open('M', window({ secs: MAX_SECS }));
    });
  });

  it('a window opened before run() installed the abort: refused — nothing would put it back (review round 1)', () => {
    expect(() => guardOf().open('E5', window())).toThrow(/E5: the abort is not installed yet — open windows inside run\(\)/);
  });

  it('opened over an existing state file: marked dirty, its other fields kept — a window reopened over a restore that had cleared it (batch-11\'s reinstall after the restore) reads dirty again', async () => {
    const state = join(out, 'state.json');
    writeFileSync(state, '{"dirty":false,"before":{"k":1}}');
    const guard = guardOf();
    await guard.run(async () => guard.open('E5', window({ stateFile: state })));
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
