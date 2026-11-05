import { describe, expect, it, vi } from 'vitest';
import { boundFor, Calls, codeOf, EPERM_RETRY_MS, execOf, KEEPS_GROUP, keepsGroup, MAX_SECS, NOT_STARTED, TIMED_OUT, undeliveredText, type Undelivered } from '../../../scripts/truth/batch/bounded.js';
import { nodeFs } from '../../../scripts/truth/batch/io.js';
import type { Ended, KillResult, ProcessSeam, StartOptions, Started } from '../../../scripts/truth/batch/proc.js';

// scripts/truth/batch/bounded.ts over a fake process seam: which bound a device call gets, what its exit code says,
// when a call's process group is sent SIGTERM and SIGKILL, and when its result comes. No process is started here; the
// real groups (a grandchild gone after a timeout, or after its leader exited) are tests/truth/batch/bounded-proc.test.ts.

/** One fake call: its leader ends when `end` is called, or — unless stubborn — when its group gets SIGTERM or SIGKILL. */
interface FakeCall {
  cmd: string;
  args: readonly string[];
  pid: number;
  end(e: Ended): void;
  /** Its pipes close: with the leader's end, unless the seam holds them (a grandchild keeps them open). */
  close(): void;
  stubbornToTerm: boolean;
  released: boolean;
  ended: boolean;
  /** Something of its group outlives its leader (a daemon): a signal-0 probe then answers 'sent', else 'gone'. */
  groupLeft: boolean;
}

class FakeSeam implements ProcessSeam {
  readonly calls: FakeCall[] = [];
  readonly kills: string[] = [];
  readonly options: StartOptions[] = [];
  /** Calls started from now on ignore SIGTERM (a grandchild that traps it); SIGKILL ends them. */
  stubborn = false;
  /** Calls started from now on keep their pipes open after their leader ends, until their group gets SIGKILL. */
  holdPipes = false;
  /** Calls started from now on keep their pipes open whatever happens (a grandchild in another group holds them). */
  holdPipesForEver = false;
  /** The next start fails as an unknown command does. */
  failNext = false;
  /** Calls started from now on leave something running in their group after their leader ends. */
  leaveGroup = false;
  /** The signal-0 probes asked (`kill(-pid, 0)`: does the group still exist?). */
  readonly probes: string[] = [];
  /** How killGroup fails, when it does: per signal, the answers to give in turn (then 'sent'); 'throw' throws EPERM. */
  refuse: Partial<Record<NodeJS.Signals, ('throw' | KillResult)[]>> = {};
  private nextPid = 100;

  start(cmd: string, args: readonly string[], options: StartOptions): Started {
    this.options.push(options);
    if (this.failNext) {
      this.failNext = false;
      return { pid: undefined, exited: Promise.resolve({ code: null, signal: null, error: `spawn ${cmd} ENOENT` }), closed: Promise.resolve(), out: () => '', err: () => '', release: () => {} };
    }
    let end!: (e: Ended) => void;
    let close!: () => void;
    const exited = new Promise<Ended>((resolve) => (end = resolve));
    const closed = new Promise<void>((resolve) => (close = resolve));
    const [hold, forEver] = [this.holdPipes, this.holdPipesForEver];
    const call: FakeCall = {
      cmd,
      args,
      pid: this.nextPid++,
      end: (e) => {
        call.ended = true;
        end(e);
        if (!hold && !forEver) close();
      },
      close: () => {
        if (!forEver) close();
      },
      stubbornToTerm: this.stubborn,
      released: false,
      ended: false,
      groupLeft: this.leaveGroup,
    };
    this.calls.push(call);
    return { pid: call.pid, exited, closed, out: () => `out of ${cmd}`, err: () => `err of ${cmd}`, release: () => (call.released = true) };
  }

  killGroup(pid: number, signal: NodeJS.Signals | 0): KillResult {
    if (signal === 0) {
      this.probes.push(`0 -${pid}`);
      const c = this.calls.find((x) => x.pid === pid);
      return c !== undefined && c.ended && !c.groupLeft ? 'gone' : 'sent';
    }
    this.kills.push(`${signal} -${pid}`);
    const answer = this.refuse[signal]?.shift();
    if (answer === 'throw') throw Object.assign(new Error('kill EPERM'), { code: 'EPERM' });
    if (answer !== undefined && answer !== 'sent') return answer;
    const call = this.calls.find((c) => c.pid === pid);
    if (call === undefined) return 'sent';
    if (signal === 'SIGKILL') call.close();
    if (signal === 'SIGTERM' && call.stubbornToTerm) return 'sent';
    call.end({ code: null, signal });
    return 'sent';
  }

  install(): void {}
  exit(): void {}
  stderr(): void {}
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('boundFor — every device call bounded, by tool (batch-7\'s `bounded`, batch-11\'s per-tool wrappers)', () => {
  it('xcrun: simctl boot and bootstatus 300 s, simctl install the install bound, anything else 120 s (batch-11.sh:224)', () => {
    expect(boundFor('xcrun', ['simctl', 'boot', 'U'])).toBe(300);
    expect(boundFor('xcrun', ['simctl', 'bootstatus', 'U', '-b'])).toBe(300);
    expect(boundFor('xcrun', ['simctl', 'install', 'U', 'a.app'])).toBe(600);
    expect(boundFor('xcrun', ['simctl', 'install', 'U', 'a.app'], 900)).toBe(900);
    expect(boundFor('xcrun', ['simctl', 'spawn', 'U', 'defaults', 'read', 'd'])).toBe(120);
    expect(boundFor('xcrun', ['boot'])).toBe(120);
    expect(boundFor('xcrun', ['devicectl', 'boot'])).toBe(120);
    expect(boundFor('xcrun', [])).toBe(120);
  });

  it('idb 60 s (batch-11.sh:225)', () => {
    expect(boundFor('idb', ['ui', 'describe-all'])).toBe(60);
  });

  it('adb: install or uninstall anywhere in its words the install bound (batch-12\'s B_INSTALL), anything else 120 s (batch-11.sh:226)', () => {
    expect(boundFor('adb', ['-s', 'emulator-5554', 'install', '-r', 'a.apk'])).toBe(600);
    expect(boundFor('adb', ['-s', 'emulator-5554', 'uninstall', 'dev.averi.lab'], 450)).toBe(450);
    expect(boundFor('adb', ['-s', 'emulator-5554', 'shell', 'pm', 'path', 'dev.averi.lab'])).toBe(120);
    expect(boundFor('adb', ['shell', 'cmd', 'package', 'install-existing', 'x'])).toBe(120);
  });

  it('git 30 s, whatever it is asked (T2 S3: the preconditions read a local repo, never the network)', () => {
    expect(boundFor('git', ['-C', 'repo', 'merge-base', '--is-ancestor', 'abc1234', 'HEAD'])).toBe(30);
    expect(boundFor('git', ['install'], 900)).toBe(30);
    expect(boundFor('/usr/bin/git', [])).toBe(30);
  });

  it('by the command\'s base name: a full path to the tool is the tool', () => {
    expect(boundFor('/usr/bin/xcrun', ['simctl', 'boot', 'U'])).toBe(300);
    expect(boundFor('/opt/sdk/platform-tools/adb', ['devices'])).toBe(120);
  });

  it('any other command has no bound of its own: its caller names one', () => {
    expect(boundFor('node', ['live.ts'])).toBeUndefined();
    expect(boundFor('xcrun-like', [])).toBeUndefined();
    expect(boundFor('node', ['install'])).toBeUndefined();
  });
});

describe('codeOf — a call\'s exit code as the shell gave it (batch-7: exit 142 is "a failed call like any other")', () => {
  it('its own code; 128 + the signal\'s number when a signal ended it', () => {
    expect([codeOf({ code: 0, signal: null }, false), codeOf({ code: 3, signal: null }, false)]).toEqual([0, 3]);
    expect([codeOf({ code: null, signal: 'SIGKILL' }, false), codeOf({ code: null, signal: 'SIGTERM' }, false), codeOf({ code: null, signal: 'SIGINT' }, false)]).toEqual([137, 143, 130]);
  });

  it('past its bound 142 (128 + SIGALRM, perl alarm\'s code), whatever signal the group was ended with', () => {
    expect(TIMED_OUT).toBe(142);
    expect([codeOf({ code: null, signal: 'SIGKILL' }, true), codeOf({ code: 0, signal: null }, true)]).toEqual([142, 142]);
  });

  it('not started (no such command) 127, as `exec … or exit 127`', () => {
    expect(NOT_STARTED).toBe(127);
    expect(codeOf({ code: null, signal: null, error: 'spawn x ENOENT' }, false)).toBe(127);
  });

  it('neither a code nor a signal: 1, a failure, never 0', () => {
    expect(codeOf({ code: null, signal: null }, false)).toBe(1);
  });
});

describe('Calls.bounded — a call in a process group of its own, ended whole past its bound', () => {
  it('a call that ends in time: its code and output; then SIGKILL to its group, so nothing it started outlives it (review round 1)', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    const r = calls.bounded('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toEqual({ code: 0, timedOut: false, signal: null, out: 'out of adb', err: 'err of adb' });
    expect(seam.kills).toEqual(['SIGKILL -100']);
  });

  it('past its bound: SIGTERM to its whole group (-pid), then SIGKILL to the group even when the leader died of the TERM — a grandchild may trap it (backlog T2 S2: the grandchild gone)', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 30 });
    const r = await calls.bounded('node', ['probe.ts'], { secs: 0.02 });
    expect(r).toMatchObject({ code: TIMED_OUT, timedOut: true, signal: 'SIGTERM' });
    expect(seam.kills.slice(0, 2)).toEqual(['SIGTERM -100', 'SIGKILL -100']);
  });

  it('a group that ignores SIGTERM: SIGKILL after the grace, and the result waits for it', async () => {
    const seam = new FakeSeam();
    seam.stubborn = true;
    const calls = new Calls(seam, { graceMs: 30 });
    const started = Date.now();
    const r = await calls.bounded('node', ['probe.ts'], { secs: 0.02 });
    expect(r).toMatchObject({ code: TIMED_OUT, timedOut: true, signal: 'SIGKILL' });
    expect(seam.kills.slice(0, 2)).toEqual(['SIGTERM -100', 'SIGKILL -100']);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it('the bound is in seconds: a call ended at 10 ms of a 0.2 s bound was in time, and no SIGTERM ever follows', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 10 });
    const r = calls.bounded('node', ['x'], { secs: 0.2 });
    await tick(10);
    seam.calls[0].end({ code: 1, signal: null });
    expect(await r).toMatchObject({ code: 1, timedOut: false });
    await tick(250);
    expect(seam.kills).toEqual(['SIGKILL -100']);
  });

  it('a leader that ended before its bound, its pipes held past the bound: its own code, never 142 (review round 1: the race)', async () => {
    const seam = new FakeSeam();
    seam.holdPipesForEver = true;
    const calls = new Calls(seam, { graceMs: 5, closeGraceMs: 60 });
    const r = calls.bounded('node', ['x'], { secs: 0.02, keepGroup: true });
    await tick();
    seam.calls[0].end({ code: 4, signal: null });
    expect(await r).toMatchObject({ code: 4, timedOut: false });
    expect(seam.kills).toEqual([]);
  });

  it('pipes a grandchild holds open: let go after the close grace, the result what was read (backlog T2 S2)', async () => {
    const seam = new FakeSeam();
    seam.holdPipesForEver = true;
    const calls = new Calls(seam, { closeGraceMs: 30 });
    const started = Date.now();
    const r = calls.bounded('node', ['x'], { secs: 5 });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toMatchObject({ code: 0, out: 'out of node' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    expect(seam.calls[0].released).toBe(true);
  });

  it('pipes held by a grandchild in its group close with the SIGKILL: no close grace waited', async () => {
    const seam = new FakeSeam();
    seam.holdPipes = true;
    const calls = new Calls(seam, { closeGraceMs: 2000 });
    const started = Date.now();
    const r = calls.bounded('node', ['x'], { secs: 5 });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('keepGroup (idb_companion, a daemon the call starts on purpose): no SIGKILL once the leader ended; stopAll leaves it, stopKept ends it (code review: the companion lives through the restores)', async () => {
    const seam = new FakeSeam();
    seam.leaveGroup = true;
    const calls = new Calls(seam, { graceMs: 5 });
    const r = calls.bounded('node', ['companion.js'], { secs: 5, keepGroup: true });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toMatchObject({ code: 0 });
    expect(seam.kills).toEqual([]);
    expect(await calls.stopAll()).toEqual({ stopped: 0, notSent: [] });
    expect(seam.kills).toEqual([]);
    expect(await calls.stopKept()).toEqual({ stopped: 1, notSent: [] });
    expect(seam.kills).toEqual(['SIGTERM -100', 'SIGKILL -100']);
  });

  it('a device tool takes its own bound when none is given; another command without one is refused before it starts', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    await expect(calls.bounded('node', ['live.ts'])).rejects.toThrow(/node: no bound/);
    await expect(calls.bounded('node', ['live.ts'], { secs: 0 })).rejects.toThrow(/node: no bound/);
    await expect(calls.bounded('node', ['live.ts'], { secs: Number.NaN })).rejects.toThrow(/node: no bound/);
    expect(seam.calls).toEqual([]);
  });

  it(`a bound above MAX_SECS is refused: setTimeout would overflow and fire at once (review round 1); MAX_SECS itself is taken`, async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    expect(MAX_SECS * 1000).toBeLessThan(2 ** 31);
    await expect(calls.bounded('node', ['x'], { secs: MAX_SECS + 1 })).rejects.toThrow(new RegExp(`node: a bound of ${MAX_SECS + 1} s is above ${MAX_SECS} s`));
    expect(seam.calls).toEqual([]);
    const r = calls.bounded('node', ['x'], { secs: MAX_SECS });
    await tick(20);
    expect(seam.kills).toEqual([]);
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toMatchObject({ code: 0, timedOut: false });
  });

  it('the call\'s folder and env reach the seam; its log is opened through the fs seam (io.ts) and handed over as an fd (code review: io.ts the only fs seam)', async () => {
    const seam = new FakeSeam();
    const opened: string[] = [];
    const calls = new Calls(seam, { fs: { ...nodeFs, withAppend: (path, use) => (opened.push(path), use(7)) } });
    const r = calls.bounded('adb', ['devices'], { cwd: 'the-dir', env: { A: '1' }, log: 'the.log' });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect(opened).toEqual(['the.log']);
    expect(seam.options).toEqual([{ cwd: 'the-dir', env: { A: '1' }, logFd: 7 }]);
  });

  it('with no log: the folder and env reach the seam, and no fd', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    const r = calls.bounded('adb', ['devices'], { cwd: 'the-dir', env: { A: '1' } });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect(seam.options).toStrictEqual([{ cwd: 'the-dir', env: { A: '1' } }]);
  });

  it('a log that cannot be opened: 127 and why, as a command that cannot start; nothing started', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { fs: { ...nodeFs, withAppend: () => {
      throw new Error('ENOENT: no such folder');
    } } });
    expect(await calls.bounded('adb', ['devices'], { log: 'x/the.log' })).toEqual({ code: NOT_STARTED, timedOut: false, signal: null, out: '', err: 'ENOENT: no such folder' });
    expect(seam.calls).toEqual([]);
  });

  it('a detached call past its bound is ended too: 142, its group SIGTERMed and SIGKILLed', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    expect(await calls.detached('node', ['restore.ts'], { secs: 0.01 })).toMatchObject({ code: TIMED_OUT, timedOut: true });
    expect(seam.kills.slice(0, 2)).toEqual(['SIGTERM -100', 'SIGKILL -100']);
  });

  it('the install bound is the one Calls was given (batch-12\'s B_INSTALL)', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { installSecs: 0.02, graceMs: 5 });
    expect(await calls.bounded('adb', ['install', 'a.apk'])).toMatchObject({ code: TIMED_OUT });
  });

  it('a command that cannot start: 127 and why, as `exec … or exit 127`; nothing to kill', async () => {
    const seam = new FakeSeam();
    seam.failNext = true;
    const calls = new Calls(seam);
    expect(await calls.bounded('no-such-tool', [], { secs: 1 })).toEqual({ code: NOT_STARTED, timedOut: false, signal: null, out: '', err: 'spawn no-such-tool ENOENT' });
    expect(seam.kills).toEqual([]);
  });
});

describe('a call leaves no timer behind: the runner can end on its own (review round 1)', () => {
  it('a call in time, one past its bound, one whose pipes closed with its end: every timer cleared', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const seam = new FakeSeam();
      const calls = new Calls(seam, { graceMs: 50, closeGraceMs: 50 });
      const inTime = calls.bounded('adb', ['devices']);
      await vi.advanceTimersByTimeAsync(0);
      seam.calls[0].end({ code: 0, signal: null });
      await vi.advanceTimersByTimeAsync(0);
      await inTime;
      expect(vi.getTimerCount()).toBe(0);
      const late = calls.bounded('node', ['x'], { secs: 0.01 });
      await vi.advanceTimersByTimeAsync(20);
      await late;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Calls.stopAll — the abort stops every running probe, its whole group, but never a detached restore (batch-11: the second Ctrl-C killed the restore)', () => {
  it('bounded calls running: SIGTERM then SIGKILL to each group; detached ones untouched', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 10 });
    const probe = calls.bounded('node', ['probe.ts'], { secs: 60 });
    const restore = calls.detached('node', ['restore.ts'], { secs: 60 });
    await tick();
    expect(await calls.stopAll()).toEqual({ stopped: 1, notSent: [] });
    expect(await probe).toMatchObject({ signal: 'SIGTERM', timedOut: false });
    expect(seam.kills.filter((k) => k.endsWith('-101'))).toEqual([]);
    expect(seam.kills.slice(0, 2)).toEqual(['SIGTERM -100', 'SIGKILL -100']);
    seam.calls[1].end({ code: 0, signal: null });
    expect(await restore).toMatchObject({ code: 0 });
  });

  it('a probe that ignores SIGTERM is killed after the grace', async () => {
    const seam = new FakeSeam();
    seam.stubborn = true;
    const calls = new Calls(seam, { graceMs: 20 });
    const probe = calls.bounded('node', ['probe.ts'], { secs: 60 });
    await tick();
    await calls.stopAll();
    expect(await probe).toMatchObject({ signal: 'SIGKILL' });
  });

  it('a call that ended before the abort is not stopped again', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    const probe = calls.bounded('node', ['probe.ts'], { secs: 60 });
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await probe;
    const before = [...seam.kills];
    expect((await calls.stopAll()).stopped).toBe(0);
    expect(seam.kills).toEqual(before);
    expect(seam.probes).toEqual([]);
  });

  it('once stopping, no new bounded call starts (the run\'s body must not go on to its next probe); a detached one still does', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    await calls.stopAll();
    await expect(calls.bounded('adb', ['devices'])).rejects.toThrow(/adb not started: the run is being stopped/);
    const restore = calls.detached('adb', ['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
    await tick();
    expect(seam.calls.map((c) => c.cmd)).toEqual(['adb']);
    seam.calls[0].end({ code: 0, signal: null });
    expect(await restore).toMatchObject({ code: 0 });
  });

  it('a timed-out call that ended is no longer running for stopAll', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    await calls.bounded('node', ['x'], { secs: 0.01 });
    seam.kills.length = 0;
    expect((await calls.stopAll()).stopped).toBe(0);
    expect(seam.kills).toEqual([]);
  });
});

describe('Calls.scope — the detached calls of one restore, stopped together when the restore passes its bound (review round 1)', () => {
  it('stop ends the groups of the scope\'s calls still running; another scope\'s, and stopAll, leave them', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    const [a, b] = [calls.scope(), calls.scope()];
    const ra = a.run('node', ['restore-a.ts'], { secs: 60 });
    const rb = b.run('node', ['restore-b.ts'], { secs: 60 });
    await tick();
    expect((await calls.stopAll()).stopped).toBe(0);
    expect((await a.stop()).stopped).toBe(1);
    expect(await ra).toMatchObject({ signal: 'SIGTERM' });
    expect(seam.kills.filter((k) => k.endsWith('-101'))).toEqual([]);
    seam.calls[1].end({ code: 0, signal: null });
    expect(await rb).toMatchObject({ code: 0 });
    expect((await b.stop()).stopped).toBe(0);
  });

  it('a scope\'s call starts while the run is being stopped: it is a restore\'s', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    await calls.stopAll();
    const s = calls.scope();
    const r = s.run('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toMatchObject({ code: 0 });
  });
});

describe('a group kill that is not delivered never rejects (review round 2, BLOCKER: `kill EPERM` under load left nothing put back)', () => {
  it('EPERM once: tried again EPERM_RETRY_MS later, then sent', async () => {
    const seam = new FakeSeam();
    seam.refuse = { SIGKILL: [{ notSent: 'EPERM' }] };
    const calls = new Calls(seam);
    const r = calls.bounded('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    const started = Date.now();
    expect(await r).toMatchObject({ code: 0 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(EPERM_RETRY_MS - 5);
    expect(seam.kills).toEqual(['SIGKILL -100', 'SIGKILL -100']);
    expect(calls.unproven().map(undeliveredText)).toEqual([]);
  });

  it('the SIGKILL after the leader\'s end refused twice, or thrown: the probe\'s result as ever, the refusal kept as unproven', async () => {
    for (const answer of [{ notSent: 'EPERM' }, 'throw'] as const) {
      const seam = new FakeSeam();
      seam.refuse = { SIGKILL: [answer, answer] };
      const calls = new Calls(seam);
      const r = calls.bounded('adb', ['devices']);
      await tick();
      seam.calls[0].end({ code: 3, signal: null });
      expect(await r).toMatchObject({ code: 3, timedOut: false });
      expect(calls.unproven().map(undeliveredText)).toEqual(['SIGKILL to group 100: EPERM']);
    }
  });

  it('a kill that throws something unreadable (its `code` getter throws too) is still a refusal, never a rejection', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    seam.killGroup = () => {
      throw Object.defineProperty({}, 'code', { get: () => { throw new Error('broken'); } });
    };
    const r = calls.bounded('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    expect(await r).toMatchObject({ code: 0 });
    expect(calls.unproven().map(undeliveredText)).toEqual(['SIGKILL to group 100: an error that cannot be read']);
  });

  it('any other refusal is not retried, and kept', async () => {
    const seam = new FakeSeam();
    seam.refuse = { SIGKILL: [{ notSent: 'EINVAL' }] };
    const calls = new Calls(seam);
    const r = calls.bounded('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect(seam.kills).toEqual(['SIGKILL -100']);
    expect(calls.unproven().map(undeliveredText)).toEqual(['SIGKILL to group 100: EINVAL']);
  });

  it('stopAll with every kill thrown or refused: it resolves, naming what was not sent', async () => {
    const seam = new FakeSeam();
    seam.refuse = { SIGTERM: ['throw', 'throw'], SIGKILL: [{ notSent: 'EPERM' }, { notSent: 'EPERM' }] };
    const calls = new Calls(seam, { graceMs: 5 });
    void calls.bounded('node', ['probe.ts'], { secs: 60 });
    await tick();
    const { stopped, notSent } = await calls.stopAll();
    expect([stopped, notSent.map(undeliveredText)]).toEqual([1, ['SIGTERM to group 100: EPERM', 'SIGKILL to group 100: EPERM']]);
  });

  it('scope.stop with its kills refused: it resolves too', async () => {
    const seam = new FakeSeam();
    seam.refuse = { SIGTERM: ['throw', 'throw'], SIGKILL: ['throw', 'throw'] };
    const calls = new Calls(seam, { graceMs: 5 });
    const s = calls.scope();
    void s.run('node', ['restore.ts'], { secs: 60 });
    await tick();
    expect((await s.stop()).notSent).toHaveLength(2);
  });

  it('a group already gone at its SIGTERM gets no SIGKILL', async () => {
    const seam = new FakeSeam();
    seam.refuse = { SIGTERM: ['gone'] };
    const calls = new Calls(seam, { graceMs: 5 });
    void calls.bounded('node', ['probe.ts'], { secs: 60 });
    await tick();
    expect(await calls.stopAll()).toEqual({ stopped: 1, notSent: [] });
    expect(seam.kills).toEqual(['SIGTERM -100']);
  });
});

describe('a stopped scope starts nothing more (review round 2): its restore, stopped at its bound, cannot go on to its next step', () => {
  it('after stop, the scope\'s run throws, as a probe does once the run is stopping', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    const s = calls.scope();
    await s.stop();
    await expect(s.run('adb', ['devices'])).rejects.toThrow(/adb not started: its restore or judge was stopped at its bound/);
    expect(seam.calls).toEqual([]);
  });
});

describe('keepsGroup — which tools start a daemon in their own group (review round 2)', () => {
  it('idb keeps its group; adb, xcrun, the emulator (no batch starts it through bounded) and anything else do not', () => {
    expect([keepsGroup('idb'), keepsGroup('/opt/sdk/emulator/emulator'), keepsGroup('adb'), keepsGroup('xcrun'), keepsGroup('node')]).toEqual([true, false, false, false, false]);
    expect(Object.keys(KEEPS_GROUP).sort()).toEqual(['adb', 'idb', 'xcrun']);
    for (const tool of ['idb', 'adb', 'xcrun']) expect(KEEPS_GROUP[tool].why.length).toBeGreaterThan(20);
  });

  it('an idb call keeps its group unless it says otherwise; an adb call does not', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam);
    for (const [cmd, call] of [['idb', {}], ['idb', { keepGroup: false }], ['adb', {}]] as const) {
      const r = calls.bounded(cmd, ['x'], call);
      await tick();
      seam.calls.at(-1)?.end({ code: 0, signal: null });
      await r;
    }
    expect(seam.kills).toEqual(['SIGKILL -101', 'SIGKILL -102']);
  });
});

describe('a kept group is checked before it is kept and before it is killed (review round 3, MAJOR: a reused id SIGKILLed)', () => {
  it('a kept call whose group is empty once its leader ended (an idb call that started no companion) is not kept: stopKept signals nothing', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    const r = calls.bounded('idb', ['ui', 'describe-all']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect(seam.probes).toEqual(['0 -100']);
    expect(await calls.stopKept()).toEqual({ stopped: 0, notSent: [] });
    expect(seam.kills).toEqual([]);
    expect(seam.probes).toEqual(['0 -100']);
  });

  it('a kept group that ended before the abort (its daemon gone since) is dropped at stopKept, never signalled', async () => {
    const seam = new FakeSeam();
    seam.leaveGroup = true;
    const calls = new Calls(seam, { graceMs: 5 });
    const r = calls.bounded('idb', ['connect', 'U']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    seam.calls[0].groupLeft = false;
    expect(await calls.stopKept()).toEqual({ stopped: 0, notSent: [] });
    expect(seam.kills).toEqual([]);
    expect(seam.probes).toEqual(['0 -100', '0 -100']);
    // Dropped: a second stop does not ask about it again.
    await calls.stopKept();
    expect(seam.probes).toEqual(['0 -100', '0 -100']);
  });

  it('each new call first drops the kept groups gone since: an id taken again by another group before the abort is never signalled (review round 4)', async () => {
    const seam = new FakeSeam();
    seam.leaveGroup = true;
    const calls = new Calls(seam, { graceMs: 5 });
    const kept = calls.bounded('idb', ['connect', 'U']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await kept;
    seam.calls[0].groupLeft = false; // the daemon died
    const next = calls.bounded('adb', ['devices']);
    await tick();
    expect(seam.probes).toEqual(['0 -100', '0 -100']);
    seam.calls[0].groupLeft = true; // another group took id 100
    // Dropped for good: a later call does not ask about it again.
    const third = calls.bounded('adb', ['devices']);
    await tick();
    expect(seam.probes).toEqual(['0 -100', '0 -100']);
    seam.calls[2].end({ code: 0, signal: null });
    await third;
    await calls.stopAll();
    await calls.stopKept();
    expect(seam.kills.filter((k) => k.endsWith(' -100'))).toEqual([]);
    seam.calls[1].end({ code: 0, signal: null });
    await next;
  });

  it('a group whose probe is refused (EPERM) is not taken for gone: kept, and stopped at the abort', async () => {
    const seam = new FakeSeam();
    const calls = new Calls(seam, { graceMs: 5 });
    seam.killGroup = ((orig) => (pid: number, signal: NodeJS.Signals | 0) => (signal === 0 ? { notSent: 'EPERM' } : orig(pid, signal)))(seam.killGroup.bind(seam));
    const r = calls.bounded('idb', ['connect', 'U']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    expect((await calls.stopKept()).stopped).toBe(1);
    expect(seam.kills).toEqual(['SIGTERM -100', 'SIGKILL -100']);
  });
});

describe('stopKept(owner) — a block ends its own kept groups (final check)', () => {
  it('only the groups its calls were kept with; stopKept() all the others; a group stopped is not stopped again', async () => {
    const seam = new FakeSeam();
    seam.leaveGroup = true;
    const calls = new Calls(seam, { graceMs: 5 });
    for (const owner of ['kf', 'T6', undefined]) {
      const r = calls.bounded('idb', ['connect', 'U'], { owner });
      await tick();
      seam.calls.at(-1)?.end({ code: 0, signal: null });
      await r;
    }
    expect(await calls.stopKept('kf')).toEqual({ stopped: 1, notSent: [] });
    expect(seam.kills).toEqual(['SIGTERM -100', 'SIGKILL -100']);
    expect(await calls.stopKept('kf')).toEqual({ stopped: 0, notSent: [] });
    expect(await calls.stopKept()).toEqual({ stopped: 2, notSent: [] });
    expect(seam.kills.slice(2).sort()).toEqual(['SIGKILL -101', 'SIGKILL -102', 'SIGTERM -101', 'SIGTERM -102']);
  });
});

describe('undelivered kills are reported where they happen (review round 3)', () => {
  it('each one, as it happens, to onUndelivered — with the scope\'s owner when a scope\'s', async () => {
    const seen: Undelivered[] = [];
    const seam = new FakeSeam();
    seam.refuse = { SIGKILL: [{ notSent: 'EINVAL' }, { notSent: 'EINVAL' }] };
    const calls = new Calls(seam, { graceMs: 5, onUndelivered: (u) => seen.push(u) });
    const r = calls.bounded('adb', ['devices']);
    await tick();
    seam.calls[0].end({ code: 0, signal: null });
    await r;
    const s = calls.scope("E5's state");
    void s.run('node', ['restore.ts'], { secs: 60 });
    await tick();
    await s.stop();
    expect(seen).toStrictEqual([{ pid: 100, signal: 'SIGKILL', why: 'EINVAL' }, { pid: 101, signal: 'SIGKILL', why: 'EINVAL', owner: "E5's state" }]);
    expect(calls.unproven()).toEqual(seen);
  });
});

describe("execOf — a Run as lab-device.ts's Exec, for its guards (ios-domains.ts's, shared since T2 S5)", () => {
  it('exit 0: the stdout; any other exit: a throw naming the call and its exit, as execFile rejects', async () => {
    const seen: string[] = [];
    const exec = execOf(async (cmd, args) => {
      seen.push(`${cmd} ${args.join(' ')}`);
      return args[0] === 'ok' ? { code: 0, timedOut: false, signal: null, out: 'averi_lab\n', err: '' } : { code: 1, timedOut: false, signal: null, out: '', err: 'error: no devices\nmore' };
    });
    expect(await exec('adb', ['ok'])).toEqual({ stdout: 'averi_lab\n' });
    await expect(exec('adb', ['-s', 'x', 'emu'])).rejects.toThrow(/^adb -s x emu: exit 1 error: no devices$/);
    expect(seen).toEqual(['adb ok', 'adb -s x emu']);
  });
});
