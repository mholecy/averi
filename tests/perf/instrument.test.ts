import type { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { sleep } from '../../src/util/sleep.js';
import { classify, Recorder, recordingExecFile, recordingFetch, recordingSetTimeout } from '../../scripts/perf/instrument.js';

// instrument.ts: the baseline's wrappers over the process boundary (child_process.execFile, fetch) and averi's sleep
// (setTimeout called from src/util/sleep.ts). Each wrapper is checked over a fake of what it wraps and a hand-moved
// clock: it passes everything through unchanged, and records into the recorder only while a window is open.

/** A clock the test moves. */
function clock() {
  let t = 0;
  return { now: () => t, set: (ms: number) => void (t = ms) };
}

describe('classify — which device a command talks to, and the words it is grouped by', () => {
  it('drops adb\'s -s serial and keeps the first three words', () => {
    expect(classify('adb', ['-s', 'emulator-5554', 'shell', 'input', 'text', 'J'])).toEqual({ kind: 'adb', label: 'adb shell input text' });
    expect(classify('adb', ['-s', 'emulator-5554', 'exec-out', 'uiautomator', 'dump', '/dev/tty'])).toEqual({ kind: 'adb', label: 'adb exec-out uiautomator dump' });
  });
  it('splits a shell command given as one string into its words', () => {
    expect(classify('adb', ['-s', 'emulator-5554', 'shell', 'dumpsys input_method | grep -m1 -w mInputShown'])).toEqual({ kind: 'adb', label: 'adb shell dumpsys input_method' });
  });
  it('names simctl through xcrun, and drops a simulator udid and idb\'s --udid', () => {
    expect(classify('xcrun', ['simctl', 'io', 'D8DACDE6-6352-437C-AA22-86FB06275C3F', 'screenshot', '/tmp/x.png'])).toEqual({ kind: 'simctl', label: 'simctl io screenshot' });
    expect(classify('idb', ['ui', 'describe-all', '--json', '--udid', 'D8DACDE6-6352-437C-AA22-86FB06275C3F'])).toEqual({ kind: 'idb', label: 'idb ui describe-all' });
  });
  it('calls anything else a host process, by its file name', () => {
    expect(classify('/var/folders/x/averi-ocr/recognizer-ab12', [])).toEqual({ kind: 'host', label: 'recognizer-ab12' });
    expect(classify('xcrun', ['swiftc', '--version'])).toEqual({ kind: 'host', label: 'xcrun swiftc' });
  });
});

type Callback = (err: Error | null, stdout: Buffer, stderr: Buffer) => void;

describe('recordingExecFile', () => {
  /** A fake execFile that answers when the test says, and remembers what it was asked. */
  function fakeExecFile() {
    const asked: unknown[][] = [];
    let answer: Callback | undefined;
    const child = { pid: 1 };
    const fn = ((...args: unknown[]) => {
      asked.push(args);
      answer = args.at(-1) as Callback;
      return child;
    }) as unknown as typeof execFile;
    return { fn, asked, child, answer: (err: Error | null) => answer!(err, Buffer.from('out'), Buffer.from('')) };
  }

  it('records a call inside a window with its start, end and outcome, and passes the arguments and the answer through', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    const fake = fakeExecFile();
    const wrapped = recordingExecFile(fake.fn, rec);
    const got: unknown[] = [];
    rec.begin();
    c.set(10);
    const child = (wrapped as unknown as (...a: unknown[]) => unknown)('adb', ['-s', 'e', 'shell', 'input', 'tap', '1', '2'], { timeout: 5 }, (...a: unknown[]) => got.push(a));
    c.set(70);
    fake.answer(null);
    expect(child).toBe(fake.child);
    expect(fake.asked[0].slice(0, 3)).toEqual(['adb', ['-s', 'e', 'shell', 'input', 'tap', '1', '2'], { timeout: 5 }]);
    expect(got).toEqual([[null, Buffer.from('out'), Buffer.from('')]]);
    expect(rec.end().calls).toEqual([{ kind: 'adb', label: 'adb shell input tap', startMs: 10, endMs: 70, ok: true }]);
  });

  it('records a failed call as not ok, and nothing outside a window', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    const fake = fakeExecFile();
    const wrapped = recordingExecFile(fake.fn, rec) as unknown as (...a: unknown[]) => unknown;
    wrapped('adb', ['devices'], () => undefined);
    fake.answer(null);
    rec.begin();
    wrapped('idb', ['ui', 'tap', '1', '2'], () => undefined);
    fake.answer(new Error('boom'));
    expect(rec.end().calls).toEqual([{ kind: 'idb', label: 'idb ui tap', startMs: 0, endMs: 0, ok: false }]);
  });
});

describe('Recorder — a window is a copy, closed at its end', () => {
  it('ends a call still open at the window\'s end there, marked pending, and a late answer does not change what was returned', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    rec.begin();
    c.set(10);
    const done = rec.call('adb', 'adb exec-out uiautomator dump');
    c.set(50);
    const window = rec.end();
    c.set(90);
    done(true);
    expect(window.calls).toEqual([{ kind: 'adb', label: 'adb exec-out uiautomator dump', startMs: 10, endMs: 50, ok: false, pending: true }]);
    rec.begin();
    expect(rec.end().calls).toEqual([]);
  });

  it('keeps a late-firing sleep out of the window it was returned in', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    rec.begin();
    const fired = rec.sleep(500, 'src/ui-tree/read-tree.ts:306');
    c.set(100);
    const window = rec.end();
    c.set(500);
    fired();
    expect(window.sleeps).toEqual([{ ms: 500, caller: 'src/ui-tree/read-tree.ts:306', startMs: 0, endMs: 100 }]);
  });
});

describe('recordingFetch', () => {
  it('records a WebDriverAgent request by method and path, the session id and query dropped', async () => {
    const c = clock();
    const rec = new Recorder(c.now);
    const wrapped = recordingFetch(async () => (c.set(40), new Response('{}')), rec);
    rec.begin();
    c.set(5);
    const r = await wrapped('http://127.0.0.1:8120/session/AB-12/source?format=json', { method: 'GET' });
    expect(await r.text()).toBe('{}');
    expect(rec.end().calls).toEqual([{ kind: 'wda', label: 'wda GET /session/:id/source', startMs: 5, endMs: 40, ok: true }]);
  });

  it('records a rejected request as not ok and rethrows', async () => {
    const rec = new Recorder(clock().now);
    const wrapped = recordingFetch(async () => Promise.reject(new Error('ECONNREFUSED')), rec);
    rec.begin();
    await expect(wrapped('http://127.0.0.1:8120/status')).rejects.toThrow('ECONNREFUSED');
    expect(rec.end().calls).toEqual([{ kind: 'wda', label: 'wda GET /status', startMs: 0, endMs: 0, ok: false }]);
  });
});

describe('recordingSetTimeout — averi\'s sleeps, told by the frame that set the timer', () => {
  const SLEEP_STACK = [
    'Error',
    '    at globalThis.setTimeout (/r/scripts/perf/instrument.ts:1:1)',
    '    at <anonymous> (/r/src/util/sleep.ts:3:28)',
    '    at new Promise (<anonymous>)',
    '    at sleep (/r/src/util/sleep.ts:3:3)',
    '    at pollTree (/r/src/ui-tree/read-tree.ts:306:11)',
  ].join('\n');
  const OTHER_STACK = ['Error', '    at globalThis.setTimeout (/r/scripts/perf/instrument.ts:1:1)', '    at Timeout (/r/node_modules/@modelcontextprotocol/sdk/x.js:1:1)'].join('\n');

  it('records a sleep with its length and its caller, ending when it fires, and still fires it', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    const fired: string[] = [];
    let pending: (() => void) | undefined;
    const fakeSetTimeout = ((fn: () => void) => ((pending = fn), 7)) as unknown as typeof setTimeout;
    const wrapped = recordingSetTimeout(fakeSetTimeout, rec, () => SLEEP_STACK);
    rec.begin();
    c.set(100);
    expect(wrapped(() => fired.push('slept'), 500)).toBe(7);
    c.set(603);
    pending!();
    expect(fired).toEqual(['slept']);
    expect(rec.end().sleeps).toEqual([{ ms: 500, caller: 'src/ui-tree/read-tree.ts:306', startMs: 100, endMs: 603 }]);
  });

  it('leaves every other timer unrecorded, and a sleep still pending at the end of the window ends there', () => {
    const c = clock();
    const rec = new Recorder(c.now);
    const stacks = [OTHER_STACK, SLEEP_STACK];
    const wrapped = recordingSetTimeout((() => 1) as unknown as typeof setTimeout, rec, () => stacks.shift()!);
    rec.begin();
    wrapped(() => undefined, 30_000);
    c.set(20);
    wrapped(() => undefined, 250);
    c.set(90);
    expect(rec.end().sleeps).toEqual([{ ms: 250, caller: 'src/ui-tree/read-tree.ts:306', startMs: 20, endMs: 90 }]);
  });

  it('attributes a real sleep() to its caller off a real V8 stack — the frame right after src/util/sleep.ts', async () => {
    vi.useFakeTimers();
    const saved = globalThis.setTimeout;
    try {
      const rec = new Recorder(() => Date.now());
      globalThis.setTimeout = recordingSetTimeout(saved, rec);
      rec.begin();
      const slept = sleep(250);
      await vi.advanceTimersByTimeAsync(250);
      await slept;
      const { sleeps } = rec.end();
      expect(sleeps).toHaveLength(1);
      expect(sleeps[0]).toMatchObject({ ms: 250 });
      expect(sleeps[0].endMs - sleeps[0].startMs).toBe(250);
      // This file has no /src/ in its path, so the caller is named by its whole path.
      expect(sleeps[0].caller).toMatch(/[/\\]tests[/\\]perf[/\\]instrument\.test\.ts:\d+$/);
    } finally {
      globalThis.setTimeout = saved;
      vi.useRealTimers();
    }
  });
});
