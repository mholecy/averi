import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/adapters/types.js';
import { CAROUSEL_CASES, CUT_TOLERANCE_PX, D68_SPREAD, hedgedCeiling, hookSwipes, LAB_CAROUSEL, preDrag, preDragOrSkip, preDragStroke, SwipeHook, UNAIMABLE_LEGS, type SwipeEntry } from '../../scripts/truth/live-carousel.js';
import { TOUCH_SLACK } from '../../scripts/truth/truth.js';
import { judged, rejudge, rejudgedResults, selectCases, summarize, type Case, type RunRecord } from '../../scripts/truth/live-cases.js';
import type { LabState } from '../../scripts/truth/schema.js';

/**
 * The carousel group (T7a; scripts/truth/live-carousel.ts), no device: the drop hook and the pre-drag over recorder
 * fakes, and every case's judge over the group's synthetic record (tests/fixtures/live-android-carousel-d68-d59-synthetic.json:
 * the D68 and D59 live checks' replies and app states, its `note` says what is synthesized) and over that record bent
 * where a judge must say no — batch-9's false "fully visible" (D62), batch-11's strokes below the band (D59b),
 * batch-10's hedged bound (ADR 0021's D68 residual).
 */

const FIXTURE = 'tests/fixtures/live-android-carousel-d68-d59-synthetic.json';
const RECORD = JSON.parse(readFileSync(new URL(`../../${FIXTURE}`, import.meta.url), 'utf8')) as RunRecord;
type Recorded = RunRecord['results'][number];
const recorded = (id: string): Recorded => structuredClone(RECORD.results.find((r) => r.id === id)!);
const B10 = JSON.parse(readFileSync(new URL('../fixtures/d68-b10-recycler-convergence.json', import.meta.url), 'utf8')) as { runs: { reply: string }[] };
const B11 = JSON.parse(readFileSync(new URL('../fixtures/d59b-b11-strokes.json', import.meta.url), 'utf8')) as {
  records: { leg: string; cell: string; swipes: { from: Point; to: Point; durationMs: number }[]; reply: string }[];
};
/** Batch-9's false pass (backlog D62): C 372 px past the clip. */
const D62_FALSE_PASS = "Element id:lab.carousel-recycler-free.C fully visible after 2 swipes; its right edge lies on its scroll container's (66,380 948x234), and a probe swipe toward it moved nothing — nothing of it is cut there";

const CASES = await selectCases({ platform: 'android', app: 'native', groups: ['carousel'] });
const caseOf = (id: string): Case => CASES.find((c) => c.id === id)!;
/** One recorded case judged by this checkout's judge. */
const verdictOf = (r: Recorded) => judged(caseOf(r.id), { ...r, state: r.state! });
/** `s` with C laid at app x `x` (948 wide, the clip's). */
const withC = (s: LabState, x: number): LabState => ({ ...s, frames: { ...s.frames, C: { x, y: 380, width: 948, height: 234 } } });

describe('SwipeHook and hookSwipes: averi\'s strokes logged, the Nth dropped and resolved as drawn', () => {
  const recorder = () => {
    const sent: string[] = [];
    const waited: number[] = [];
    const adapter = { swipe: async (from: Point, to: Point, ms?: number) => void sent.push(`${from.x},${from.y}→${to.x},${to.y}/${ms ?? '-'}`) };
    const hook = new SwipeHook();
    hookSwipes(adapter, hook, async (ms) => void waited.push(ms));
    return { adapter, hook, sent, waited };
  };
  const p = (x: number): Point => ({ x, y: 497 });

  it('disarmed: every stroke sent, nothing logged', async () => {
    const { adapter, hook, sent, waited } = recorder();
    await adapter.swipe(p(824), p(256), 300);
    expect(sent).toEqual(['824,497→256,497/300']);
    expect(waited).toEqual([]);
    expect(hook.disarm()).toEqual([]);
  });

  it('armed with dropSwipe 2: stroke 2 not sent, waited its duration (or 300 ms with none); every stroke logged; disarm returns the log and stops logging', async () => {
    const { adapter, hook, sent, waited } = recorder();
    hook.arm(2);
    await adapter.swipe(p(256), p(824), 649);
    await adapter.swipe(p(256), p(486), 500);
    await adapter.swipe(p(256), p(376));
    expect(sent).toEqual(['256,497→824,497/649', '256,497→376,497/-']);
    expect(waited).toEqual([500]);
    const log: SwipeEntry[] = hook.disarm();
    expect(log).toEqual([
      { from: p(256), to: p(824), durationMs: 649, dropped: false },
      { from: p(256), to: p(486), durationMs: 500, dropped: true },
      { from: p(256), to: p(376), dropped: false },
    ]);
    await adapter.swipe(p(1), p(2));
    expect(hook.disarm()).toEqual([]);
    expect(sent).toHaveLength(3);
    hook.arm(1);
    await adapter.swipe(p(5), p(6));
    expect(waited).toEqual([500, 300]);
    expect(sent).toHaveLength(3);
  });

  it('armed with no drop: each stroke sent and logged; a re-arm starts the count again', async () => {
    const { adapter, hook, sent } = recorder();
    hook.arm();
    await adapter.swipe(p(1), p(2), 10);
    hook.arm(1);
    await adapter.swipe(p(3), p(4), 10);
    expect(sent).toEqual(['1,497→2,497/10']);
    expect(hook.disarm()).toEqual([{ from: p(3), to: p(4), durationMs: 10, dropped: true }]);
  });
});

describe('preDrag: the probes\' 440-px, 1-s drag left on the carousel, then the state the calls start from', () => {
  const launch = recorded('lv-d62-control').preDrag!.launch;

  it('the stroke the probes drew: `input swipe 872 497 432 497 1000` on the lab\'s clip', () => {
    expect(preDragStroke(LAB_CAROUSEL, 440)).toEqual({ from: { x: 872, y: 497 }, to: { x: 432, y: 497 }, durationMs: 1000 });
  });

  it('draws it on the launch\'s clip, waits for it to settle, and returns the state after it with the stroke and the launch', async () => {
    const strokes: string[] = [];
    const waits: number[] = [];
    const after = recorded('lv-d62-control').launched;
    const lab = { swipe: async (f: Point, t: Point, ms: number) => void strokes.push(`${f.x},${f.y}→${t.x},${t.y}/${ms}`), state: async () => after };
    const done = await preDrag(lab, launch, 440, async (ms) => void waits.push(ms));
    expect(strokes).toEqual(['872,497→432,497/1000']);
    expect(waits).toEqual([1200]);
    expect(done).toEqual({ preDrag: { from: { x: 872, y: 497 }, to: { x: 432, y: 497 }, durationMs: 1000, launch }, launched: after });
  });

  it('refuses a launch with no carousel, and a state after it of another cell (or none) — nothing judged on a lab that left', async () => {
    const lab = (s: LabState | undefined) => ({ swipe: async () => undefined, state: async () => s });
    const { carousel: _c, ...noCarousel } = launch.scrollViews!;
    await expect(preDrag(lab(launch), { ...launch, scrollViews: noCarousel }, 440, async () => undefined)).rejects.toThrow(/no carousel scroll view/);
    await expect(preDrag(lab({ ...launch, cell: 'carousel-lazy-free' }), launch, 440, async () => undefined)).rejects.toThrow(/reports cell carousel-lazy-free/);
    await expect(preDrag(lab(undefined), launch, 440, async () => undefined)).rejects.toThrow(/reports no state/);
  });

  it('preDragOrSkip: a pre-drag that throws (the lab left, adb failed) is the case\'s SKIP with the reason, never the whole run thrown out', async () => {
    const failing = { swipe: async () => Promise.reject(new Error('adb: device offline')), state: async () => launch };
    expect(await preDragOrSkip(failing, launch, 440, async () => undefined)).toEqual({ skip: 'the pre-drag failed: adb: device offline' });
    const gone = { swipe: async () => undefined, state: async () => undefined };
    expect(await preDragOrSkip(gone, launch, 440, async () => undefined)).toEqual({ skip: `the pre-drag failed: cell ${launch.cell}: after the pre-drag the app reports no state` });
    const after = recorded('lv-d62-control').launched;
    const fine = { swipe: async () => undefined, state: async () => after };
    expect(await preDragOrSkip(fine, launch, 440, async () => undefined)).toMatchObject({ launched: after, preDrag: { durationMs: 1000 } });
  });
});

describe('selectCases: the carousel group, Android and the native app only, never by default', () => {
  it('its eight cases, in order, when asked', () => {
    expect(CASES.map((c) => c.id)).toEqual(['lv-d62-control', 'lv-d62-drop', 'lv-d68-launch', 'lv-d59b-lazy', 'lv-d59b-recycler', 'd52-e2', 'd37-snap-lazy', 'd37-snap-recycler']);
    expect(CASES.every((c) => c.group === 'carousel')).toBe(true);
    expect(caseOf('lv-d62-drop')).toMatchObject({ preDrag: 440, reads: { swipes: { drop: 2 } } });
    expect(caseOf('lv-d62-control').reads?.swipes).toBe(true);
  });

  it('a premise SKIP fails the run on lv-d62-control and lv-d62-drop alone (skipFails: the harness broke), never elsewhere', () => {
    expect(CASES.filter((c) => c.skipFails === true).map((c) => c.id)).toEqual(['lv-d62-control', 'lv-d62-drop']);
    for (const id of ['lv-d62-control', 'lv-d62-drop']) {
      const r = recorded(id);
      r.launched = withC(r.launched, 66);
      const verdict = verdictOf(r);
      expect(verdict.outcome).toBe('SKIP');
      const { exitCode, lines } = summarize({ platform: 'android', sources: ['uiautomator'], results: [{ source: 'uiautomator', c: caseOf(id), verdict, replies: r.replies }], side: 'this checkout' });
      expect(exitCode).toBe(1);
      expect(lines).toContain(`SKIPPED where a skip proves nothing — the run fails: uiautomator ${id}`);
    }
    const lazy = recorded('lv-d59b-lazy');
    const verdict = verdictOf({ ...lazy, swipes: undefined });
    expect(verdict.outcome).toBe('SKIP');
    expect(summarize({ platform: 'android', sources: ['uiautomator'], results: [{ source: 'uiautomator', c: caseOf('lv-d59b-lazy'), verdict, replies: lazy.replies }], side: 'this checkout' }).exitCode).toBe(0);
  });

  it('none by default, none on iOS, none for the React Native app', async () => {
    expect((await selectCases({ platform: 'android', app: 'native', groups: ['forms'] })).some((c) => c.group === 'carousel')).toBe(false);
    expect(await selectCases({ platform: 'ios', app: 'native', groups: ['carousel'] })).toEqual([]);
    expect(await selectCases({ platform: 'android', app: 'react-native', groups: ['carousel'] })).toEqual([]);
    expect(CAROUSEL_CASES).toHaveLength(8);
  });
});

describe('the group\'s record rejudged: every case ok', () => {
  it('live.ts --rejudge in process: 8 cases, 8 ok, exit 0, nothing accepted', async () => {
    const { lines, exitCode } = await rejudge(RECORD, FIXTURE, { groups: ['carousel'] });
    expect(exitCode).toBe(0);
    expect(lines[1]).toBe('# Live golden: 8 cases, 8 ok, 0 loud, 0 mismatches (0 not known), 0 skipped');
    expect(lines.some((l) => l.startsWith('Accepted under'))).toBe(false);
  });

  it.each([
    ['lv-d62-control', /^unaimable, C cut L 0 R 19: /],
    ['lv-d62-drop', /^maxSwipes-hedged, C cut L 0 R 20: /],
    ['lv-d68-launch', /^unaimable, C cut L 0 R 22: /],
    ['lv-d59b-lazy', /^unfit, C cut L 2 R 0: /],
    ['lv-d59b-recycler', /^unaimable, /],
    ['d52-e2', /^unfit, C cut L 33 R 0: /],
    ['d37-snap-lazy', /^at rest on C \(index 1\), the first read lists C at x 66 w 948$/],
    ['d37-snap-recycler', /^at rest on C \(index 1\), the first read lists C at x 66 w 948$/],
  ] as const)('%s', (id, why) => {
    const v = verdictOf(recorded(id));
    expect(v.outcome).toBe('ok');
    expect(v.why).toMatch(why);
  });
});

describe('the hard check: never "fully visible" while C is cut (lv-d62, D68, D52, D59b alike)', () => {
  it.each(['lv-d62-control', 'lv-d62-drop', 'lv-d68-launch', 'lv-d59b-lazy', 'lv-d59b-recycler', 'd52-e2'])('%s: batch-9\'s false pass with C 372 px past the clip is a MISMATCH; with C whole, ok', (id) => {
    const r = recorded(id);
    r.replies = [D62_FALSE_PASS];
    r.state = withC(r.state!, 438);
    expect(verdictOf(r)).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut', kind: 'visible' });
    expect(verdictOf(r).why).toMatch(/^"fully visible" while C cut L 0 R 372 /);
    r.state = withC(r.state, 66);
    expect(verdictOf(r)).toMatchObject({ outcome: 'ok' });
    r.state = withC(r.state, 64);
    expect(verdictOf(r).outcome).toBe('ok');
    r.state = withC(r.state, 63);
    expect(verdictOf(r).outcome).toBe('MISMATCH');
  });

  it('before any premise: a pre-drag that left C whole, a drop that did not happen — the false claim still a MISMATCH; C not laid out counts as cut', () => {
    const r = recorded('lv-d62-drop');
    r.replies = [D62_FALSE_PASS];
    r.launched = withC(r.launched, 66);
    r.swipes = [];
    expect(verdictOf(r).outcome).toBe('MISMATCH');
    r.state = { ...r.state!, frames: {} };
    expect(verdictOf(r)).toMatchObject({ outcome: 'MISMATCH', why: expect.stringMatching(/while C not laid out/) });
  });

  it('no carousel clip reported (after the calls, or before them on a pre-drag case): SKIP, never a MISMATCH — whatever the reply', () => {
    for (const id of ['lv-d62-control', 'lv-d68-launch', 'd52-e2']) {
      const r = recorded(id);
      r.replies = [D62_FALSE_PASS];
      r.state = withC(r.state!, 438);
      const { carousel: _c, ...rest } = r.state.scrollViews!;
      expect(verdictOf({ ...r, state: { ...r.state, scrollViews: rest } })).toMatchObject({ outcome: 'SKIP', why: 'the lab reported no carousel clip' });
      expect(verdictOf({ ...r, state: { ...r.state, scrollViews: undefined } })).toMatchObject({ outcome: 'SKIP', why: 'the lab reported no carousel clip' });
    }
    const control = recorded('lv-d62-control');
    control.replies = [D62_FALSE_PASS];
    control.state = withC(control.state!, 438);
    expect(verdictOf({ ...control, launched: { ...control.launched, scrollViews: {} } })).toMatchObject({ outcome: 'SKIP', why: 'the lab reported no carousel clip' });
  });

  it('CUT_TOLERANCE_PX is truth.ts\'s TOUCH_SLACK', () => {
    expect(CUT_TOLERANCE_PX).toBe(TOUCH_SLACK);
  });

  it('the summary: a fully-cut MISMATCH no KNOWN explains fails the run', () => {
    const r = recorded('lv-d62-control');
    r.replies = [D62_FALSE_PASS];
    r.state = withC(r.state!, 438);
    const c = caseOf(r.id);
    const { exitCode, lines } = summarize({ platform: 'android', sources: ['uiautomator'], results: [{ source: 'uiautomator', c, verdict: verdictOf(r), replies: r.replies }], side: 'this checkout' });
    expect(exitCode).toBe(1);
    expect(lines[1]).toMatch(/1 mismatches \(1 not known\)/);
  });
});

describe('lv-d62 and D68: the hedged bound accepted and counted where unaimable is expected; the drop leg expects the bound', () => {
  it.each(['lv-d62-control', 'lv-d68-launch', 'lv-d59b-recycler'])('%s: batch-10\'s hedged maxSwipes is ok, accepted under ADR 0021\'s D68 residual', (id) => {
    const r = recorded(id);
    r.replies = [B10.runs[0].reply];
    expect(verdictOf(r)).toMatchObject({ outcome: 'ok', accepted: D68_SPREAD });
  });

  it('the summary counts them against the runs of the cases that accept them', async () => {
    const record = structuredClone(RECORD);
    const control = record.results.find((r) => r.id === 'lv-d62-control')!;
    control.replies = [B10.runs[0].reply];
    record.results.push({ ...structuredClone(recorded('lv-d62-control')) });
    const results = await rejudgedResults(record, { groups: ['carousel'] });
    const { lines, exitCode } = summarize({ platform: 'android', sources: ['uiautomator'], results, side: 'this checkout' });
    expect(exitCode).toBe(0);
    expect(lines).toContain(`Accepted under ${D68_SPREAD.residual}: 1 of 2 judged run(s) of lv-d62-control`);
  });

  it('two residuals in one run are counted apart, each by its id', () => {
    const other = { id: 'other', residual: 'residual:another' };
    const row = (id: string, accepted: { id: string; residual: string }) => ({ source: 'uiautomator' as const, c: caseOf(id), verdict: { outcome: 'ok' as const, why: '', accepted }, replies: [] });
    const { lines } = summarize({ platform: 'android', sources: ['uiautomator'], results: [row('lv-d62-control', D68_SPREAD), row('lv-d68-launch', other)], side: 'this checkout' });
    expect(lines).toContain(`Accepted under ${D68_SPREAD.residual}: 1 of 1 judged run(s) of lv-d62-control`);
    expect(lines).toContain('Accepted under residual:another: 1 of 1 judged run(s) of lv-d68-launch');
  });

  it('a kind neither expected nor accepted is LOUD (`carousel-kind`), never a MISMATCH: the drop leg ending unaimable, the control ending stuck', () => {
    const drop = recorded('lv-d62-drop');
    drop.replies = recorded('lv-d62-control').replies;
    expect(verdictOf(drop)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', kind: 'refused' });
    expect(verdictOf(drop).why).toMatch(/^unaimable, not maxSwipes-hedged: /);
    const control = recorded('lv-d62-control');
    control.replies = [B11.records[0].reply];
    expect(verdictOf(control)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
    expect(verdictOf(control).why).toMatch(/^other, not unaimable: /);
  });

  it('the premises: C cut before the call (else SKIP); the drop leg\'s stroke 2 dropped and every sent stroke taken by the app (else SKIP)', () => {
    const control = recorded('lv-d62-control');
    control.launched = withC(control.launched, 66);
    expect(verdictOf(control)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/^C not cut before the call \(C cut L 0 R 0\)/) });
    const drop = recorded('lv-d62-drop');
    expect(verdictOf({ ...drop, swipes: undefined })).toMatchObject({ outcome: 'SKIP', why: 'no stroke log: the drop unshown' });
    expect(verdictOf({ ...drop, swipes: drop.swipes!.map((s) => ({ ...s, dropped: false })) })).toMatchObject({ outcome: 'SKIP', why: 'the call drew 6 stroke(s): no stroke 2 dropped' });
    expect(verdictOf({ ...drop, swipes: drop.swipes!.slice(0, 1) }).why).toBe('the call drew 1 stroke(s): no stroke 2 dropped');
    const lost = { ...drop, state: { ...drop.state!, strokes: drop.state!.strokes!.slice(0, -1) } };
    expect(verdictOf(lost)).toMatchObject({ outcome: 'SKIP', why: 'the app took 4 carousel stroke(s) of the 5 sent: the drop not shown to hold' });
    const doubled = { ...drop, state: { ...drop.state!, strokes: [...drop.state!.strokes!, drop.state!.strokes!.at(-1)!] } };
    expect(verdictOf(doubled)).toMatchObject({ outcome: 'SKIP', why: 'the app took 6 carousel stroke(s) of the 5 sent: the drop not shown to hold' });
  });

  it('D62\'s retry: the stroke after the dropped one is the same reveal sent again (± CUT_TOLERANCE_PX a point) — none seen is LOUD `no-retry`', () => {
    const drop = recorded('lv-d62-drop');
    expect(drop.swipes![2]).toMatchObject({ from: drop.swipes![1].from, to: drop.swipes![1].to, dropped: false });
    expect(verdictOf(drop).outcome).toBe('ok');
    const shift = (dx: number, dy: number, end: 'from' | 'to') => {
      const r = recorded('lv-d62-drop');
      const p = r.swipes![2][end];
      r.swipes![2] = { ...r.swipes![2], [end]: { x: p.x + dx, y: p.y + dy } };
      return verdictOf(r);
    };
    expect(shift(2, 0, 'to').outcome).toBe('ok');
    expect(shift(0, -2, 'from').outcome).toBe('ok');
    expect(shift(3, 0, 'to')).toMatchObject({ outcome: 'LOUD', cls: 'no-retry', why: expect.stringMatching(/^no retry seen: stroke 3 is not the dropped reveal sent again/) });
    expect(shift(0, 3, 'from').cls).toBe('no-retry');
    expect(shift(-3, 0, 'from').cls).toBe('no-retry');
    expect(shift(0, -3, 'to').cls).toBe('no-retry');
    const last = recorded('lv-d62-drop');
    last.swipes = last.swipes!.slice(0, 2);
    last.state = { ...last.state!, strokes: last.state!.strokes!.slice(0, 2) };
    expect(verdictOf(last)).toMatchObject({ outcome: 'LOUD', cls: 'no-retry', why: expect.stringMatching(/^no retry seen: no stroke after the dropped one/) });
  });
});

describe('D59b: every stroke inside the carousel\'s band, which takes one at least; D59 and D52: unfit, the axis said as the tree told it', () => {
  it('batch-11\'s strokes at the page centre (y 1110, below the band 380–614) are LOUD `off-band`, whatever the reply', () => {
    for (const id of ['lv-d59b-lazy', 'lv-d59b-recycler']) {
      const r = recorded(id);
      const b11 = B11.records.find((x) => x.leg === 'averi' && x.cell === r.state!.cell)!;
      r.swipes = b11.swipes.map((s) => ({ ...s, dropped: false }));
      expect(verdictOf(r)).toMatchObject({ outcome: 'LOUD', cls: 'off-band' });
      expect(verdictOf(r).why).toMatch(/^2 of 2 stroke\(s\) drawn outside the carousel's band y 380–614 \(e\.g\. \(864,1110\)→\(216,1110\)\)/);
    }
  });

  it('a stroke ending a pixel past the band is off it; the band\'s own edges are inside', () => {
    const r = recorded('lv-d59b-lazy');
    r.swipes = [{ from: { x: 824, y: 380 }, to: { x: 256, y: 614 }, dropped: false }];
    expect(verdictOf(r).outcome).toBe('ok');
    r.swipes = [{ from: { x: 824, y: 379 }, to: { x: 256, y: 497 }, dropped: false }];
    expect(verdictOf(r).cls).toBe('off-band');
    r.swipes = [{ from: { x: 824, y: 497 }, to: { x: 256, y: 615 }, dropped: false }];
    expect(verdictOf(r).cls).toBe('off-band');
  });

  it('strokes in the band the carousel did not take are LOUD; no stroke log is SKIP', () => {
    const r = recorded('lv-d59b-recycler');
    r.state = { ...r.state!, strokes: [] };
    expect(verdictOf(r)).toMatchObject({ outcome: 'LOUD', cls: 'off-band', why: expect.stringMatching(/^the carousel took no stroke: /) });
    expect(verdictOf({ ...recorded('lv-d59b-lazy'), swipes: undefined })).toMatchObject({ outcome: 'SKIP', why: 'no stroke log: the band unjudged' });
  });

  it('lv-d59b-lazy\'s unfit must say the inferred axis; d52-e2\'s must not, within 3 swipes', () => {
    const lazy = recorded('lv-d59b-lazy');
    const e2 = recorded('d52-e2');
    [lazy.replies, e2.replies] = [e2.replies, lazy.replies];
    expect(verdictOf(lazy)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', why: expect.stringMatching(/^unfit without the inferred-axis clause/) });
    expect(verdictOf(e2)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', why: expect.stringMatching(/^unfit with the inferred-axis clause/) });
    const slow = recorded('d52-e2');
    slow.replies = [slow.replies[0].replace('failed after 3 swipes', 'failed after 4 swipes')];
    expect(verdictOf(slow)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', why: expect.stringMatching(/^unfit after 4 swipes, more than 3/) });
    const two = recorded('d52-e2');
    two.replies = [two.replies[0].replace('failed after 3 swipes', 'failed after 2 swipes')];
    expect(verdictOf(two).outcome).toBe('ok');
  });
});

describe('D37: the first read after a stroke on a snapping pager lists C where it comes to rest', () => {
  const snap = (rect: { x: number; width: number } | undefined, cell = 'carousel-lazy') =>
    JSON.stringify(rect === undefined ? [] : [{ role: 'other', identifier: `lab.${cell}.C`, label: null, rect: { ...rect, y: 380, height: 234 } }], null, 2);
  const at = (r: Recorded, index: number, offset: number): Recorded => ({ ...r, state: { ...r.state!, offsets: { ...r.state!.offsets, carousel: offset, 'carousel.index': index } } });

  it('at rest on C: C listed at the clip (± 2 px) is ok; anywhere else, or absent, a MISMATCH `unsettled-read`', () => {
    const r = recorded('d37-snap-lazy');
    for (const [x, width, outcome] of [[68, 946, 'ok'], [69, 948, 'MISMATCH'], [66, 945, 'MISMATCH'], [300, 714, 'MISMATCH']] as const) {
      expect(verdictOf({ ...r, replies: [r.replies[0], snap({ x, width })] }).outcome).toBe(outcome);
    }
    expect(verdictOf({ ...r, replies: [r.replies[0], snap(undefined)] })).toMatchObject({ outcome: 'MISMATCH', cls: 'unsettled-read', why: 'at rest on C (index 1), but the first read lists C absent, not at the clip x 66 w 948' });
  });

  it('at rest on card 0 or 2: C absent or wholly outside the clip on that side is ok; inside it, a MISMATCH', () => {
    const r = recorded('d37-snap-recycler');
    const cell = 'carousel-recycler';
    expect(verdictOf({ ...at(r, 0, 0), replies: [r.replies[0], snap(undefined, cell)] }).outcome).toBe('ok');
    expect(verdictOf({ ...at(r, 0, 0), replies: [r.replies[0], snap({ x: 1012, width: 68 }, cell)] }).outcome).toBe('ok');
    expect(verdictOf({ ...at(r, 0, 0), replies: [r.replies[0], snap({ x: 1011, width: 69 }, cell)] }).outcome).toBe('MISMATCH');
    expect(verdictOf({ ...at(r, 2, 1896), replies: [r.replies[0], snap({ x: 0, width: 68 }, cell)] }).outcome).toBe('ok');
    expect(verdictOf({ ...at(r, 2, 1896), replies: [r.replies[0], snap({ x: 0, width: 69 }, cell)] })).toMatchObject({ outcome: 'MISMATCH', why: 'at rest on card 2, but the first read lists C at x 0 w 69, inside the clip' });
  });

  it('SKIP when the premises fail: still moving (no whole card), no resting index, no stroke taken, another clip; LOUD when the swipe or the read failed', () => {
    const r = recorded('d37-snap-lazy');
    expect(verdictOf(at(r, 1, 951)).outcome).toBe('SKIP');
    expect(verdictOf(at(r, 1, 950)).outcome).toBe('ok');
    expect(verdictOf(at(r, 1, 946)).outcome).toBe('ok');
    expect(verdictOf(at(r, 1, 945)).outcome).toBe('SKIP');
    const { 'carousel.index': _i, ...noIndex } = r.state!.offsets!;
    expect(verdictOf({ ...r, state: { ...r.state!, offsets: noIndex } })).toMatchObject({ outcome: 'SKIP', why: 'the app wrote no carousel.index or offset' });
    expect(verdictOf({ ...r, state: { ...r.state!, strokes: [] } })).toMatchObject({ outcome: 'SKIP', why: 'the pager took no stroke' });
    expect(verdictOf({ ...r, launched: { ...r.launched, scrollViews: { carousel: { ...LAB_CAROUSEL, y: 400 } } } }).outcome).toBe('SKIP');
    expect(verdictOf({ ...r, replies: ['ERROR Swipe failed', r.replies[1]] })).toMatchObject({ outcome: 'LOUD', why: 'the swipe failed: ERROR Swipe failed' });
    expect(verdictOf({ ...r, replies: [r.replies[0], 'ERROR no tree'] })).toMatchObject({ outcome: 'LOUD', why: expect.stringMatching(/^no snapshot: /) });
  });

  it('its stroke: across 60 % of the lab\'s clip at its middle, forward, 300 ms; then ui_snapshot of C', () => {
    expect(caseOf('d37-snap-lazy').calls).toEqual([
      { tool: 'swipe', args: { fromX: 824, fromY: 497, toX: 256, toY: 497, durationMs: 300 } },
      { tool: 'ui_snapshot', args: { filter: 'id:"lab.carousel-lazy.C"' } },
    ]);
  });
});

describe('the hedged ceiling: a run whose every judged unaimable leg ends hedged maxSwipes fails (a D68 revert), ADR 0021\'s measured ~3 in 10 named', () => {
  const HEDGED = B10.runs[0].reply;
  const legsRecord = (hedged: readonly string[], ids: readonly string[] = UNAIMABLE_LEGS): RunRecord => ({
    platform: 'android',
    side: 'this checkout',
    results: ids.map((id) => ({ ...recorded(id), ...(hedged.includes(id) && { replies: [HEDGED] }) })),
  });
  const run = async (record: RunRecord) => summarize({ platform: 'android', sources: ['uiautomator'], results: await rejudgedResults(record, { groups: ['carousel'] }), side: record.side });

  it('the legs: lv-d62-control, lv-d68-launch, lv-d59b-recycler', () => {
    expect(UNAIMABLE_LEGS).toEqual(['lv-d62-control', 'lv-d68-launch', 'lv-d59b-recycler']);
  });

  it('a D68-revert record (all three hedged): exit 1, MISMATCH-class, "hedged 3 of 3", the measured ~3 in 10 and the 2.7 % chance named', async () => {
    const { exitCode, lines } = await run(legsRecord(UNAIMABLE_LEGS));
    expect(exitCode).toBe(1);
    const line = lines.find((l) => l.includes('hedged 3 of 3'));
    expect(line).toMatch(/^MISMATCH \(hedged ceiling\): hedged 3 of 3 judged unaimable leg\(s\)/);
    expect(line).toMatch(/ADR 0021/);
    expect(line).toMatch(/~3 in 10 \(batch-10 runs 0, 5, 6\)/);
    expect(line).toMatch(/all 3 hedged by chance is about 2\.7 %/);
    expect(line).toMatch(/the 3 planned runs \(9 legs\) make chance negligible/);
    expect(line).not.toMatch(/20 %/);
  });

  it('2 of 3 hedged: accepted, exit 0, "hedged 2 of 3"; none hedged: "hedged 0 of 3"', async () => {
    const two = await run(legsRecord(['lv-d62-control', 'lv-d59b-recycler']));
    expect(two.exitCode).toBe(0);
    expect(two.lines).toContain('Hedged ceiling: hedged 2 of 3 judged unaimable leg(s) — within ADR 0021\'s measured ~3 in 10');
    const none = await run(legsRecord([]));
    expect(none.exitCode).toBe(0);
    expect(none.lines).toContain('Hedged ceiling: hedged 0 of 3 judged unaimable leg(s) — within ADR 0021\'s measured ~3 in 10');
  });

  it('more runs: 4 of 4 hedged fails (about 0.81 %); 5 of 6 passes', async () => {
    const four = legsRecord(UNAIMABLE_LEGS, [...UNAIMABLE_LEGS, 'lv-d68-launch']);
    expect((await run(four)).exitCode).toBe(1);
    expect((await run(four)).lines.some((l) => l.includes('all 4 hedged by chance is about 0.81 %'))).toBe(true);
    const six = legsRecord(UNAIMABLE_LEGS, [...UNAIMABLE_LEGS, ...UNAIMABLE_LEGS]);
    six.results[5].replies = recorded('lv-d59b-recycler').replies;
    const r = await run(six);
    expect(r.exitCode).toBe(0);
    expect(r.lines.some((l) => l.includes('hedged 5 of 6'))).toBe(true);
  });

  it('fewer than 3 judged legs: LOUD, no pass claimed, the exit untouched — even all hedged; a SKIPped leg is not judged', async () => {
    const two = await run(legsRecord(['lv-d62-control', 'lv-d68-launch'], ['lv-d62-control', 'lv-d68-launch']));
    expect(two.exitCode).toBe(0);
    expect(two.lines[1]).toBe('# Live golden: 2 cases, 2 ok, 1 loud, 0 mismatches (0 not known), 0 skipped');
    expect(two.lines).toContain('LOUD (hedged ceiling): hedged 2 of 2 judged unaimable leg(s) — fewer than 3 judged, the ceiling unjudged (no pass claimed)');
    const skipped = legsRecord(UNAIMABLE_LEGS);
    skipped.results[2].swipes = undefined;
    const r = await run(skipped);
    expect(r.lines).toContain('LOUD (hedged ceiling): hedged 2 of 2 judged unaimable leg(s) — fewer than 3 judged, the ceiling unjudged (no pass claimed)');
    expect(r.exitCode).toBe(0);
  });

  it('every leg selected but SKIPped: "hedged 0 of 0", LOUD, counted in the tally, the exit untouched by it', async () => {
    const skipped = legsRecord([], ['lv-d68-launch', 'lv-d59b-recycler']);
    for (const r of skipped.results) r.state = { ...r.state!, scrollViews: {} };
    const r = await run(skipped);
    expect(r.lines).toContain('LOUD (hedged ceiling): hedged 0 of 0 judged unaimable leg(s) — fewer than 3 judged, the ceiling unjudged (no pass claimed)');
    expect(r.lines[1]).toBe('# Live golden: 2 cases, 0 ok, 1 loud, 0 mismatches (0 not known), 2 skipped');
    expect(r.exitCode).toBe(0);
  });

  it('3 judged: no LOUD added to the tally', async () => {
    const r = await run(legsRecord(['lv-d62-control']));
    expect(r.lines[1]).toBe('# Live golden: 3 cases, 3 ok, 0 loud, 0 mismatches (0 not known), 0 skipped');
  });

  it('no leg in the run (another group, or --cases without them): no ceiling line', async () => {
    const r = await run({ platform: 'android', side: 'this checkout', results: [recorded('d52-e2')] });
    expect(r.lines.some((l) => /hedged ceiling|Hedged ceiling/.test(l))).toBe(false);
  });

  it('a --side run (a calibration, a revert on purpose) prints the count, held to nothing', async () => {
    const r = await run({ ...legsRecord(UNAIMABLE_LEGS), side: '<cal>/differential-cal-0eab7789' });
    expect(r.exitCode).toBe(0);
    expect(r.lines).toContain('Hedged ceiling: hedged 3 of 3 judged unaimable leg(s) — a --side run, a calibration: not held');
  });

  it('hedgedCeiling, pure: counts only the legs, and only judged ones; the residual by its id, not its words', () => {
    const row = (id: string, outcome: 'ok' | 'SKIP' | 'LOUD', hedged: boolean) => ({ c: { id }, verdict: { outcome, ...(hedged && { accepted: D68_SPREAD }) } });
    const reworded = { c: { id: 'lv-d62-control' }, verdict: { outcome: 'ok' as const, accepted: { ...D68_SPREAD, residual: 'other words' } } };
    expect(hedgedCeiling([reworded, row('lv-d68-launch', 'ok', true), row('lv-d59b-recycler', 'ok', true)], true)).toMatchObject({ fails: true, hedged: 3 });
    const other = { c: { id: 'lv-d62-control' }, verdict: { outcome: 'ok' as const, accepted: { ...D68_SPREAD, id: 'another' } } };
    expect(hedgedCeiling([other, row('lv-d68-launch', 'ok', true), row('lv-d59b-recycler', 'ok', true)], true)).toMatchObject({ fails: false, hedged: 2 });
    expect(hedgedCeiling([row('lv-d62-control', 'SKIP', false)], true)).toMatchObject({ loud: true, judged: 0 });
    expect(hedgedCeiling([row('d52-e2', 'ok', false)], true)).toMatchObject({ loud: false, lines: [] });
    expect(hedgedCeiling([row('lv-d62-control', 'ok', true), row('lv-d68-launch', 'ok', true), row('lv-d59b-recycler', 'LOUD', false), row('lv-d62-drop', 'ok', false)], true)).toMatchObject({ fails: false, hedged: 2, judged: 3 });
    expect(hedgedCeiling([row('lv-d62-control', 'ok', true), row('lv-d68-launch', 'ok', true), row('lv-d59b-recycler', 'ok', true), row('lv-d62-drop', 'ok', false)], true)).toMatchObject({ fails: true, hedged: 3, judged: 3 });
    expect(hedgedCeiling([row('lv-d62-control', 'ok', true), row('lv-d68-launch', 'ok', true), row('lv-d59b-recycler', 'SKIP', false)], true)).toMatchObject({ fails: false, hedged: 2, judged: 2 });
  });
});
