import { describe, expect, it } from 'vitest';
import { type Case, rejudge, type RunRecord, selectCases, summarize, THIS_CHECKOUT } from '../../scripts/truth/live-cases.js';
import type { FocusRead } from '../../scripts/truth/lab-device.js';
import type { LiveVerdict } from '../../scripts/truth/live-visibility.js';
import { runCase, type CaseRig } from '../../scripts/truth/run-case.js';
import type { LabState } from '../../scripts/truth/schema.js';
import { FakeAndroidLab, FakeLab } from '../helpers/fake-lab.js';

/**
 * One case on one tree source (scripts/truth/run-case.ts), through its interface: a fake lab, a fake tool call, a fake
 * pause, all logging into one list, so a test reads the case's whole cycle in order. No real sleeps, no device.
 */

const read = (focus: string, extra: Partial<LabState> = {}): LabState => ({ cell: 'c', ready: true, screen: { x: 0, y: 0, width: 402, height: 874 }, scale: 3, frames: {}, events: [], focus, ...extra });
const OK: LiveVerdict = { outcome: 'ok', why: 'held' };

const aCase = (over: Partial<Case> = {}): Case => ({
  id: 'x1',
  group: 'forms',
  cell: 'c',
  says: 'a synthesized case',
  calls: [{ tool: 'tap', args: { selector: 'id:a' } }],
  judge: () => OK,
  ...over,
});

/** The rest of a rig around a lab: its tool call answers `replies` in turn, and the clock starts at 1000 s. */
function rigOver(lab: FakeLab | FakeAndroidLab, replies: readonly string[] = ['Tapped a'], over: Partial<CaseRig> = {}): CaseRig {
  let answered = 0;
  return {
    lab,
    callTool: async (call, config) => {
      lab.log.push(`call ${call.tool} under ${config}`);
      return replies[answered++] ?? 'no reply scripted';
    },
    configFor: async (source, c) => `${source}-${c.id}.yaml`,
    swipes: { arm: (drop, shorten) => void lab.log.push(shorten === undefined ? `arm ${drop}` : `arm ${drop} shorten ${shorten.stroke} ${shorten.px}`), disarm: () => (lab.log.push('disarm'), []) },
    pause: async (ms) => void lab.log.push(`pause ${ms}`),
    now: () => 1_000_000,
    ...over,
  };
}

describe('runCase: launch, calls, a pause, the state', () => {
  it('a plain case: launched, called under its config, read 800 ms after, and its record', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const run = await runCase(aCase(), 'idb', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.verdict).toEqual(OK);
    expect(run.record).toStrictEqual({ source: 'idb', id: 'x1', replies: ['Tapped a'], launched: read('launch'), after: [], state: { ...read('final'), readAt: 1000 } });
  });
});

describe('runCase: the reads a case declares', () => {
  const NOT: LiveVerdict = { outcome: 'LOUD', why: 'not held' };
  const threeCalls = [{ tool: 'tap', args: {} }, { tool: 'tap', args: {} }, { tool: 'tap', args: {} }] as Case['calls'];

  it('no declaration: no read between the calls, no strokes logged', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const run = await runCase(aCase({ calls: threeCalls }), 'idb', rigOver(lab, ['1', '2', '3']));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'call tap under idb-x1.yaml', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.record.after).toEqual([]);
    expect(run.record).not.toHaveProperty('swipes');
  });

  it('betweenCalls: the app read between the calls, not after the last, kept in order and unstamped', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('one'), read('two'), read('final')] });
    const run = await runCase(aCase({ calls: threeCalls, reads: { betweenCalls: true } }), 'idb', rigOver(lab, ['1', '2', '3']));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'state', 'call tap under idb-x1.yaml', 'state', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.record.after).toEqual([read('one'), read('two')]);
    expect(run.record.state).toEqual({ ...read('final'), readAt: 1000 });
  });

  it('swipes: the hook armed with the case\'s drop around its calls, what it logged in the record and handed to the judge', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const stroke = { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, dropped: true };
    let logged: unknown;
    const c = aCase({ reads: { swipes: { drop: [2] } }, judge: (_s, _r, _so, _l, _a, log) => ((logged = log), OK) });
    const run = await runCase(c, 'uiautomator', rigOver(lab, ['1'], { swipes: { arm: (d) => void lab.log.push(`arm ${d}`), disarm: () => (lab.log.push('disarm'), [stroke]) } }));
    expect(lab.log).toEqual(['launch c', 'arm 2', 'call tap under uiautomator-x1.yaml', 'disarm', 'pause 800', 'state']);
    expect(run.record.swipes).toEqual([stroke]);
    expect(logged).toEqual({ swipes: [stroke] });
  });

  it('swipes: a shortening declared beside the drop reaches the hook', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    await runCase(aCase({ reads: { swipes: { drop: [2], shorten: { stroke: 1, px: 90 } } } }), 'uiautomator', rigOver(lab, ['1']));
    expect(lab.log).toContain('arm 2 shorten 1 90');
  });

  it('swipes: a call that throws still disarms the hook, and the case throws', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const rig = rigOver(lab, [], { callTool: async () => Promise.reject(new Error('the server is gone')) });
    await expect(runCase(aCase({ reads: { swipes: {} } }), 'uiautomator', rig)).rejects.toThrow('the server is gone');
    expect(lab.log).toEqual(['launch c', 'arm undefined', 'disarm']);
  });

  it('swipes without a drop: the hook armed with none', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    await runCase(aCase({ reads: { swipes: {} } }), 'uiautomator', rigOver(lab));
    expect(lab.log).toContain('arm undefined');
  });

  it('a first read not ok: read again 3 s later, stamped, kept; the later read judged', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), read('late')] });
    const c = aCase({ judge: (s) => (s.focus === 'late' ? OK : NOT) });
    const run = await runCase(c, 'idb', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state', 'pause 3000', 'state']);
    expect(run.record.late).toEqual({ ...read('late'), readAt: 1000 });
    expect(run.verdict).toEqual({ outcome: 'ok', why: 'held (only 3 s later; first read: not held)' });
  });

  it('a late read that finds no state: none kept, the first verdict stands', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), undefined] });
    const run = await runCase(aCase({ judge: () => NOT }), 'idb', rigOver(lab));
    expect(run.verdict).toEqual(NOT);
    expect(run.record).not.toHaveProperty('late');
  });

  it('a first read ok: no late read', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), read('late')] });
    const run = await runCase(aCase(), 'idb', rigOver(lab));
    expect(lab.log).not.toContain('pause 3000');
    expect(run.record).not.toHaveProperty('late');
  });

  it('late: false: never read again, not ok or not', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), read('late')] });
    const run = await runCase(aCase({ reads: { late: false }, judge: () => NOT }), 'idb', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.verdict).toEqual(NOT);
    expect(run.record).not.toHaveProperty('late');
  });

  it('the first verdict is asked over the reads as a late read would be judged: the swipes reach the judge that decides', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), read('late')] });
    const stroke = { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, dropped: false };
    const c = aCase({ reads: { swipes: {} }, judge: (_s, _r, _so, _l, _a, log) => (log?.swipes?.length === 1 ? OK : NOT) });
    await runCase(c, 'uiautomator', rigOver(lab, ['1'], { swipes: { arm: () => undefined, disarm: () => [stroke] } }));
    expect(lab.log).not.toContain('pause 3000');
  });
});

describe('runCase: before the calls', () => {
  const up = (focus: string) => read(focus, { keyboard: { visible: true } } as Partial<LabState>);
  const carousel = { x: 66, y: 380, width: 948, height: 234 };

  it('warmUp: one snapshot under the case\'s config before the launch; an ok reply is not kept', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const notes: string[] = [];
    const run = await runCase(aCase({ warmUp: true }), 'idb', rigOver(lab, ['bare snapshot', 'Tapped a'], { note: (l) => void notes.push(l) }));
    expect(lab.log).toEqual(['call ui_snapshot under idb-x1.yaml', 'launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.record.replies).toEqual(['Tapped a']);
    expect(run.record).not.toHaveProperty('warmUpError');
    expect(notes).toEqual([]);
  });

  it('warmUp asks for the case\'s home element', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const asked: unknown[] = [];
    await runCase(aCase({ warmUp: true, calls: [] }), 'idb', rigOver(lab, [], { callTool: async (call) => (asked.push(call), 'ok') }));
    expect(asked).toEqual([{ tool: 'ui_snapshot', args: { filter: 'id:"lab.c.home"' } }]);
  });

  it('warmUp that failed: said once in its first line, kept whole in the record, the case goes on', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const notes: string[] = [];
    const run = await runCase(aCase({ warmUp: true }), 'wda', rigOver(lab, ['ERROR: no WDA\nits detail', 'Tapped a'], { note: (l) => void notes.push(l) }));
    expect(notes).toEqual(['wda x1 warm-up failed: ERROR: no WDA']);
    expect(run.record.warmUpError).toBe('ERROR: no WDA\nits detail');
    expect(run.record.replies).toEqual(['Tapped a']);
  });

  it('keyboard, none at launch: SKIP before any call, the same record shape with nothing read, the warm-up\'s failure kept (iOS\'s words)', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const why = 'no soft keyboard at launch (the simulator saw HID typing; see IosLab.launch)';
    const run = await runCase(aCase({ keyboard: true, warmUp: true }), 'idb', rigOver(lab, ['ERROR: down']));
    expect(lab.log).toEqual(['call ui_snapshot under idb-x1.yaml', 'launch c']);
    expect(run.verdict).toEqual({ outcome: 'SKIP', why });
    expect(run.record).toEqual({ source: 'idb', id: 'x1', skip: why, replies: [], launched: read('launch'), after: [], state: undefined, warmUpError: 'ERROR: down' });
  });

  it('keyboard, none at launch on Android: its own words', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch') });
    const run = await runCase(aCase({ keyboard: true }), 'uiautomator', rigOver(lab));
    expect(run.verdict).toEqual({ outcome: 'SKIP', why: 'no IME at launch' });
  });

  it('warmUp that failed with no note given: the case goes on, nothing said', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const run = await runCase(aCase({ warmUp: true }), 'idb', rigOver(lab, ['ERROR: down', 'Tapped a']));
    expect(run.verdict).toEqual(OK);
  });

  it('keyboard up: the case runs', async () => {
    const lab = new FakeLab({ launched: up('launch'), states: [read('final')] });
    const run = await runCase(aCase({ keyboard: true }), 'idb', rigOver(lab));
    expect(run.verdict).toEqual(OK);
  });

  it('preDrag on Android: the raw stroke after the launch, the settle through the injected pause, `launched` the state after it', async () => {
    const launch = read('launch', { scrollViews: { carousel } } as Partial<LabState>);
    const dragged = read('dragged');
    const lab = new FakeAndroidLab({ launched: launch, states: [{ ...dragged }, read('final')] });
    const run = await runCase(aCase({ preDrag: 440 }), 'uiautomator', rigOver(lab));
    expect(lab.log.map((l) => l.split(' ')[0])).toEqual(['launch', 'raw', 'pause', 'state', 'call', 'pause', 'state']);
    expect(lab.log.filter((l) => l.startsWith('pause'))).toEqual(['pause 1200', 'pause 800']);
    expect(run.record.launched).toEqual(dragged);
    expect(run.record.preDrag?.launch).toEqual(launch);
  });

  it('preDrag that fails: the case\'s SKIP with the reason, never the run thrown out', async () => {
    const launch = read('launch', { scrollViews: { carousel } } as Partial<LabState>);
    const lab = new FakeAndroidLab({ launched: launch, swipeFails: new Error('adb gone') });
    const run = await runCase(aCase({ preDrag: 440 }), 'uiautomator', rigOver(lab));
    expect(run.verdict).toEqual({ outcome: 'SKIP', why: 'the pre-drag failed: adb gone' });
    expect(run.record.launched).toEqual(launch);
    expect(run.record).not.toHaveProperty('preDrag');
  });

  it('preDrag on a lab with no raw swipe (iOS): SKIP, the launch done, no call', async () => {
    const lab = new FakeLab({ launched: read('launch') });
    const run = await runCase(aCase({ preDrag: 440 }), 'idb', rigOver(lab));
    expect(lab.log).toEqual(['launch c']);
    expect(run.verdict).toEqual({ outcome: 'SKIP', why: "a pre-drag is the Android lab's only" });
  });

  it('measuresPanel on Android: the panel read after the launch and again on the final state', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], touchable: ['at launch', 'after calls'] });
    const run = await runCase(aCase({ measuresPanel: true }), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'guard', 'imeTouchable', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state', 'guard', 'imeTouchable']);
    expect(run.record.launched.imeTouchable).toBe('at launch');
    expect(run.record.state?.imeTouchable).toBe('after calls');
  });

  it('measuresPanel: a read that fails is said through the note and kept as its error; a refused device throws', async () => {
    const notes: string[] = [];
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], touchable: [new Error('no dumpsys')] });
    const run = await runCase(aCase({ measuresPanel: true }), 'uiautomator', rigOver(lab, ['Tapped a'], { note: (l) => void notes.push(l) }));
    expect(notes).toEqual(['the IME region read failed: no dumpsys', 'the IME region read failed: no dumpsys']);
    expect(run.record.launched.imeTouchable).toEqual({ error: 'no dumpsys' });
    const refused = new FakeAndroidLab({ launched: read('launch'), guardFails: new Error('not the lab') });
    await expect(runCase(aCase({ measuresPanel: true }), 'uiautomator', rigOver(refused))).rejects.toThrow('not the lab');
  });

  it('measuresPanel on a lab with none (iOS): no panel read', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const run = await runCase(aCase({ measuresPanel: true }), 'idb', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.record.launched).not.toHaveProperty('imeTouchable');
  });
});

describe('runCase: the rig\'s defaults', () => {
  it('no clock given: readAt is the host\'s, in seconds', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final')] });
    const { now: _now, ...rig } = rigOver(lab);
    const before = Date.now() / 1000;
    const run = await runCase(aCase(), 'idb', rig);
    expect(run.record.state?.readAt).toBeGreaterThanOrEqual(before);
    expect(run.record.state?.readAt).toBeLessThanOrEqual(Date.now() / 1000);
  });
});

describe('runCase: after the calls', () => {
  const NOT: LiveVerdict = { outcome: 'MISMATCH', why: 'claimed' };

  it('not ok with keepShot: one screenshot once judged, named by source, case and clock, after the late read', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first'), read('late')] });
    const kept: [string, string][] = [];
    await runCase(aCase({ judge: () => NOT }), 'idb', rigOver(lab, ['r'], { keepShot: async (name, png) => void kept.push([name, png.toString()]) }));
    expect(lab.log.slice(-3)).toEqual(['pause 3000', 'state', 'screenshot']);
    expect(kept).toEqual([['idb-x1-1000000.png', 'fake png']]);
  });

  it('not ok, no keepShot: no screenshot', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first')] });
    await runCase(aCase({ judge: () => NOT }), 'idb', rigOver(lab));
    expect(lab.log).not.toContain('screenshot');
  });

  it('ok with keepShot: no screenshot', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('first')] });
    await runCase(aCase(), 'idb', rigOver(lab, ['r'], { keepShot: async () => undefined }));
    expect(lab.log).not.toContain('screenshot');
  });

  it('every key a case can read reaches the record, in the order a recorded file keeps them', async () => {
    const launch = read('launch', { scrollViews: { carousel: { x: 66, y: 380, width: 948, height: 234 } } } as Partial<LabState>);
    const lab = new FakeAndroidLab({ launched: launch, states: [read('dragged'), read('first'), read('late')] });
    const stroke = { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, dropped: false };
    const rig = rigOver(lab, ['ERROR: down', 'Tapped a'], { swipes: { arm: () => undefined, disarm: () => [stroke] } });
    const run = await runCase(aCase({ warmUp: true, preDrag: 440, reads: { swipes: {} }, judge: () => NOT }), 'uiautomator', rig);
    expect(Object.keys(run.record)).toEqual(['source', 'id', 'replies', 'launched', 'after', 'state', 'late', 'warmUpError', 'preDrag', 'swipes']);
  });

  it('a SKIP\'s record keeps the same order, `skip` right after `id`, by bytes', async () => {
    const lab = new FakeLab({ launched: read('launch') });
    const run = await runCase(aCase({ keyboard: true, warmUp: true }), 'idb', rigOver(lab, ['ERROR: down']));
    expect(Object.keys(run.record)).toEqual(['source', 'id', 'skip', 'replies', 'launched', 'after', 'state', 'warmUpError']);
    expect(JSON.stringify(run.record)).toBe(
      `{"source":"idb","id":"x1","skip":"no soft keyboard at launch (the simulator saw HID typing; see IosLab.launch)","replies":[],"launched":${JSON.stringify(read('launch'))},"after":[],"warmUpError":"ERROR: down"}`,
    );
  });

  it('a SKIP takes no screenshot', async () => {
    const lab = new FakeLab({ launched: read('launch') });
    await runCase(aCase({ keyboard: true }), 'idb', rigOver(lab, ['r'], { keepShot: async () => undefined }));
    expect(lab.log).toEqual(['launch c']);
  });
});
describe('runCase: no first state, the app wrote none (T10)', () => {
  const NO_STATE: LiveVerdict = { outcome: 'LOUD', cls: 'no-state', why: 'no first state for x1: the app wrote none after the calls' };
  /** A judge that reads its state, as every judge does: handed none, it would throw a TypeError. */
  const reads: Case['judge'] = (s) => (s.events.length === 0 ? OK : { outcome: 'MISMATCH', why: 'fired' });

  it('a LOUD failure named with the case\'s id, the judge never asked, no late read, the record with no state', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [undefined, read('late')] });
    const run = await runCase(aCase({ judge: reads }), 'idb', rigOver(lab));
    expect(run.verdict).toEqual(NO_STATE);
    expect(lab.log).toEqual(['launch c', 'call tap under idb-x1.yaml', 'pause 800', 'state']);
    expect(run.record).toStrictEqual({ source: 'idb', id: 'x1', replies: ['Tapped a'], launched: read('launch'), after: [], state: undefined });
  });

  it('not ok, so its screenshot is kept', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [undefined] });
    const kept: string[] = [];
    await runCase(aCase({ judge: reads }), 'idb', rigOver(lab, ['r'], { keepShot: async (name) => void kept.push(name) }));
    expect(lab.log.at(-1)).toBe('screenshot');
    expect(kept).toEqual(['idb-x1-1000000.png']);
  });

  it('measuresPanel: no second panel read, there is no state to keep it on', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [undefined], touchable: ['at launch', 'after calls'] });
    const run = await runCase(aCase({ measuresPanel: true, judge: reads }), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'guard', 'imeTouchable', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state']);
    expect(run.verdict.cls).toBe('no-state');
  });

  it('the focus is still read after the calls, and a chooser left in front still dropped', async () => {
    const front = (c: string): FocusRead => ({ window: `  mFocusedApp=ActivityRecord{1 u0 ${c}} t1}\n`, activities: `    * Hist  #0: ActivityRecord{1 u0 ${c}} t1}\n` });
    const LAB = front('dev.averi.lab/.MainActivity');
    const CHOOSER = front('android/com.android.internal.app.ResolverActivity');
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [undefined], focus: [LAB, CHOOSER, LAB] });
    const run = await runCase(aCase({ reads: { focus: true }, judge: reads }), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'focus', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state', 'focus', 'back', 'focus']);
    expect(run.record.focus).toEqual({ before: LAB, between: [], after: CHOOSER, teardown: LAB });
    expect(run.verdict.cls).toBe('no-state');
  });

  it('the run goes on: the next case on the same rig runs and is judged', async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [undefined, read('next')] });
    const rig = rigOver(lab, ['1', '2']);
    expect((await runCase(aCase({ judge: reads }), 'idb', rig)).verdict).toEqual(NO_STATE);
    const next = await runCase(aCase({ id: 'x2', judge: reads }), 'idb', rig);
    expect(next.verdict).toEqual(OK);
    expect(next.record.state).toEqual({ ...read('next'), readAt: 1000 });
  });

  it('the summary counts it loud and the run fails on it, named; the record rejudged says the same', async () => {
    const [b1] = await selectCases({ platform: 'ios', app: 'native', groups: ['forms'], only: ['b1'] });
    const [b3] = await selectCases({ platform: 'ios', app: 'native', groups: ['forms'], only: ['b3'] });
    const lab = new FakeLab({ launched: read('launch'), states: [undefined] });
    const run = await runCase(b1, 'idb', rigOver(lab, ['Tapped']));
    const why = 'no first state for b1: the app wrote none after the calls';
    expect(run.verdict).toEqual({ outcome: 'LOUD', cls: 'no-state', why });
    // A skipped case beside it, which fails nothing: the exit code is the missing state's.
    const skipped = { verdict: { outcome: 'SKIP', why: 'no IME at launch' } as LiveVerdict, record: { source: 'idb' as const, id: 'b3', skip: 'no IME at launch', replies: [], launched: read('launch'), after: [], state: undefined } };
    const live = summarize({ platform: 'ios', sources: ['idb'], side: THIS_CHECKOUT, results: [{ source: 'idb', c: b1, verdict: run.verdict, replies: run.record.replies }, { source: 'idb', c: b3, verdict: skipped.verdict, replies: [] }] });
    expect(live.lines[1]).toBe('# Live golden: 2 cases, 0 ok, 1 loud, 0 mismatches (0 not known), 1 skipped');
    expect(live.lines).toContain(`- LOUD (no-state) b1 ${b1.cell}: ${b1.says} — ${why}`);
    expect(live.lines).toContain('NO FIRST STATE — the app wrote none, the run fails: idb b1');
    expect(live.exitCode).toBe(1);
    // The record as --record writes it (JSON drops the undefined state), judged again: the same verdict, no throw.
    const record: RunRecord = JSON.parse(JSON.stringify({ platform: 'ios', side: THIS_CHECKOUT, results: [run.record, skipped.record] }));
    const again = await rejudge(record, 'r.json', { groups: ['forms'] });
    expect(again.lines.slice(1)).toEqual(live.lines.slice(1));
    expect(again.exitCode).toBe(1);
  });

  it('a --side run (a calibration, held to no KNOWN entry) fails on it too: the lab app is broken whatever averi drove it', () => {
    const results = [{ source: 'idb' as const, c: aCase(), verdict: { outcome: 'LOUD', cls: 'no-state', why: 'no first state for x1: the app wrote none after the calls' } as LiveVerdict, replies: ['r'] }];
    const { lines, exitCode } = summarize({ platform: 'ios', sources: ['idb'], side: '<cal>/side-checkout', results });
    expect(lines).toContain('NO FIRST STATE — the app wrote none, the run fails: idb x1');
    expect(exitCode).toBe(1);
  });

  it('without such a case the run does not fail: a SKIP and a plain LOUD stay as they were', () => {
    const c = aCase();
    const results = [{ source: 'idb' as const, c, verdict: { outcome: 'LOUD', cls: 'not-reached', why: 'honest' } as LiveVerdict, replies: ['r'] }, { source: 'idb' as const, c, verdict: { outcome: 'SKIP', why: 's' } as LiveVerdict, replies: [] }];
    const { lines, exitCode } = summarize({ platform: 'ios', sources: ['idb'], side: THIS_CHECKOUT, results });
    expect(lines.join('\n')).not.toContain('NO FIRST STATE');
    expect(exitCode).toBe(0);
  });

  it("T7b's first state with no cell (a fresh process writes `cell: \"\"`) is a state: the judge is asked", async () => {
    const lab = new FakeLab({ launched: read('launch'), states: [read('final', { cell: '' })] });
    let judgedCell: string | undefined;
    const run = await runCase(aCase({ judge: (s) => ((judgedCell = s.cell), OK) }), 'idb', rigOver(lab));
    expect(judgedCell).toBe('');
    expect(run.verdict).toEqual(OK);
  });
});

describe('runCase: the focus reads and the launcher start (the chooser group, T7b)', () => {
  /** A focus read naming `focused` in front, its records the stack. */
  const front = (focused: string, ...below: string[]): FocusRead => ({
    window: `  mFocusedApp=ActivityRecord{1 u0 ${focused}} t1}\n`,
    activities: [focused, ...below].map((c) => `    * Hist  #0: ActivityRecord{1 u0 ${c}} t1}\n`).join(''),
  });
  const LAB = front('dev.averi.lab/.MainActivity');
  const HOME = front('launcher/.Home');
  const CHOOSER = front('android/com.android.internal.app.ResolverActivity', 'dev.averi.lab/.MainActivity');
  const twoCalls = [{ tool: 'open_deep_link', args: {} }, { tool: 'launch_app', args: {} }] as Case['calls'];

  it('focus: read before the calls, between them, and after the final state; kept in the record, handed to the judge', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [LAB, CHOOSER, LAB] });
    let logged: unknown;
    const c = aCase({ calls: twoCalls, reads: { focus: true, late: false }, judge: (_s, _r, _so, _l, _a, log) => ((logged = log), OK) });
    const run = await runCase(c, 'uiautomator', rigOver(lab, ['1', '2']));
    expect(lab.log).toEqual(['launch c', 'focus', 'call open_deep_link under uiautomator-x1.yaml', 'focus', 'call launch_app under uiautomator-x1.yaml', 'pause 800', 'state', 'focus']);
    expect(run.record.focus).toEqual({ before: LAB, between: [CHOOSER], after: LAB });
    expect(logged).toEqual({ focus: { before: LAB, between: [CHOOSER], after: LAB } });
    expect(Object.keys(run.record)).toEqual(['source', 'id', 'replies', 'launched', 'after', 'state', 'focus']);
  });

  it('focus: the chooser left in front after the calls is dropped with one BACK, after the verdict and its screenshot, and read again', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [LAB, CHOOSER, LAB] });
    const NOT: LiveVerdict = { outcome: 'MISMATCH', why: 'x' };
    const notes: string[] = [];
    const run = await runCase(aCase({ reads: { focus: true, late: false }, judge: () => NOT }), 'uiautomator', rigOver(lab, ['1'], { keepShot: async () => undefined, note: (l) => void notes.push(l) }));
    expect(lab.log).toEqual(['launch c', 'focus', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state', 'focus', 'screenshot', 'back', 'focus']);
    expect(run.record.focus).toEqual({ before: LAB, between: [], after: CHOOSER, teardown: LAB });
    expect(run.verdict).toEqual(NOT);
    // Dropped: nothing said.
    expect(notes).toEqual([]);
  });

  it('focus: a chooser on the stack but not in front, or no chooser, or an unread read: no BACK', async () => {
    for (const after of [front('dev.averi.lab/.MainActivity', 'android/com.android.internal.app.ResolverActivity'), LAB, { error: 'offline' }]) {
      const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [LAB, after] });
      const run = await runCase(aCase({ reads: { focus: true, late: false } }), 'uiautomator', rigOver(lab));
      expect(lab.log).not.toContain('back');
      expect(run.record.focus).toEqual({ before: LAB, between: [], after });
    }
  });

  it('focus: a chooser still in front after the BACK is said through the note', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [LAB, CHOOSER, CHOOSER] });
    const notes: string[] = [];
    await runCase(aCase({ reads: { focus: true, late: false } }), 'uiautomator', rigOver(lab, ['1'], { note: (l) => void notes.push(l) }));
    expect(notes).toEqual(['uiautomator x1: the chooser is still in front after one BACK (android/com.android.internal.app.ResolverActivity)']);
  });

  it('fromLauncher: the lab sent to the launcher after the launch, before the first focus read and the calls; the HOME read it answers kept first in the focus reads', async () => {
    const home = { resolved: 'priority=0\nlauncher/.Home\n' };
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [HOME, LAB], home });
    let logged: unknown;
    const run = await runCase(aCase({ fromLauncher: true, reads: { focus: true, late: false }, judge: (_s, _r, _so, _l, _a, log) => ((logged = log), OK) }), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'toLauncher', 'focus', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state', 'focus']);
    expect(run.record.launched).toEqual(read('launch'));
    expect(run.record.focus).toEqual({ home, before: HOME, between: [], after: LAB });
    expect(Object.keys(run.record.focus!)).toEqual(['home', 'before', 'between', 'after']);
    expect(logged).toEqual({ focus: { home, before: HOME, between: [], after: LAB } });
  });

  it('fromLauncher without reads.focus: the focus is read all the same (its premise is the read before the calls)', async () => {
    const home = { resolved: 'priority=0\nlauncher/.Home\n' };
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [HOME, LAB], home });
    const run = await runCase(aCase({ fromLauncher: true }), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'toLauncher', 'focus', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state', 'focus']);
    expect(run.record.focus).toEqual({ home, before: HOME, between: [], after: LAB });
  });

  it('no launcher start: no HOME read in the focus reads', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [LAB] });
    const run = await runCase(aCase({ reads: { focus: true, late: false } }), 'uiautomator', rigOver(lab));
    expect(run.record.focus).not.toHaveProperty('home');
  });

  it('fromLauncher or focus on a lab with neither (iOS): SKIP, the launch done, no call', async () => {
    for (const [over, why] of [
      [{ fromLauncher: true }, "a start from the launcher is the Android lab's only"],
      [{ reads: { focus: true } }, "a focus read is the Android lab's only"],
    ] as const) {
      const lab = new FakeLab({ launched: read('launch') });
      const run = await runCase(aCase(over), 'idb', rigOver(lab));
      expect(lab.log).toEqual(['launch c']);
      expect(run.verdict).toEqual({ outcome: 'SKIP', why });
      expect(run.record).not.toHaveProperty('focus');
    }
  });

  it('no focus declared on Android: no focus read, no BACK', async () => {
    const lab = new FakeAndroidLab({ launched: read('launch'), states: [read('final')], focus: [CHOOSER] });
    const run = await runCase(aCase(), 'uiautomator', rigOver(lab));
    expect(lab.log).toEqual(['launch c', 'call tap under uiautomator-x1.yaml', 'pause 800', 'state']);
    expect(run.record).not.toHaveProperty('focus');
  });
});
