import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Point } from '../../src/adapters/types.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { CAROUSEL_CASES, CUT_TOLERANCE_PX, D68_SPREAD, hedgedCeiling, hookSwipes, judgeFully, LAB_CAROUSEL, NO_CLIP, preDrag, preDragOrSkip, preDragStroke, SwipeHook, UNAIMABLE_LEGS, type SwipeEntry } from '../../scripts/truth/live-carousel.js';
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

  it('armed to shorten stroke 1 to 90 px: sent along its own line that far, in its own time; logged with what it drew and what was sent; the rest as drawn', async () => {
    const { adapter, hook, sent, waited } = recorder();
    hook.arm([2], { stroke: 1, px: 90 });
    await adapter.swipe(p(824), p(682), 300);
    await adapter.swipe(p(824), p(588), 300);
    await adapter.swipe(p(824), p(588), 300);
    expect(sent).toEqual(['824,497→734,497/300', '824,497→588,497/300']);
    expect(waited).toEqual([300]);
    expect(hook.disarm()).toEqual([
      { from: p(824), to: p(682), durationMs: 300, dropped: false, sentTo: p(734) },
      { from: p(824), to: p(588), durationMs: 300, dropped: true },
      { from: p(824), to: p(588), durationMs: 300, dropped: false },
    ]);
    hook.arm();
    await adapter.swipe(p(824), p(682), 300);
    expect(sent.at(-1)).toBe('824,497→682,497/300');
  });

  it('a shortening never lengthens: a stroke already within its px goes as drawn, nothing marked; along either axis, rounded', async () => {
    const { adapter, hook, sent } = recorder();
    hook.arm(undefined, { stroke: 1, px: 90 });
    await adapter.swipe(p(824), p(780), 300);
    expect(sent).toEqual(['824,497→780,497/300']);
    expect(hook.disarm()).toEqual([{ from: p(824), to: p(780), durationMs: 300, dropped: false }]);
    hook.arm(undefined, { stroke: 1, px: 50 });
    await adapter.swipe({ x: 100, y: 100 }, { x: 130, y: 140 }, 300);
    await adapter.swipe({ x: 100, y: 100 }, { x: 160, y: 180 }, 300);
    expect(sent.slice(1)).toEqual(['100,100→130,140/300', '100,100→160,180/300']);
    expect(hook.disarm()[0]).not.toHaveProperty('sentTo');
    hook.arm(undefined, { stroke: 1, px: 50 });
    await adapter.swipe({ x: 100, y: 100 }, { x: 160, y: 180 }, 300);
    expect(sent.at(-1)).toBe('100,100→130,140/300');
    hook.arm(undefined, { stroke: 1, px: 5 });
    await adapter.swipe({ x: 0, y: 0 }, { x: 10, y: 10 }, 300);
    expect(sent.at(-1)).toBe('0,0→4,4/300');
  });

  it('armed with a drop of strokes 2 and 3: neither sent, both marked, stroke 4 sent', async () => {
    const { adapter, hook, sent } = recorder();
    hook.arm([2, 3]);
    for (const x of [100, 200, 300, 400]) await adapter.swipe(p(x), p(x + 1), 300);
    expect(sent).toEqual(['100,497→101,497/300', '400,497→401,497/300']);
    expect(hook.disarm().map((e) => e.dropped)).toEqual([false, true, true, false]);
  });

  it('armed with a drop of 2: stroke 2 not sent, waited its duration (or 300 ms with none); every stroke logged; disarm returns the log and stops logging', async () => {
    const { adapter, hook, sent, waited } = recorder();
    hook.arm([2]);
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
    hook.arm([1]);
    await adapter.swipe(p(5), p(6));
    expect(waited).toEqual([500, 300]);
    expect(sent).toHaveLength(3);
  });

  it('armed with no drop: each stroke sent and logged; a re-arm starts the count again', async () => {
    const { adapter, hook, sent } = recorder();
    hook.arm();
    await adapter.swipe(p(1), p(2), 10);
    hook.arm([1]);
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
  it('its eleven cases, in order, when asked', () => {
    expect(CASES.map((c) => c.id)).toEqual(['lv-d62-control', 'lv-d62-drop', 'lv-d62-short', 'lv-d62-drop-two', 'lv-t12-drop-first', 'lv-d68-launch', 'lv-d59b-lazy', 'lv-d59b-recycler', 'd52-e2', 'd37-snap-lazy', 'd37-snap-recycler']);
    expect(CASES.every((c) => c.group === 'carousel')).toBe(true);
    expect(caseOf('lv-d62-drop')).toMatchObject({ preDrag: 440, reads: { swipes: { drop: [2] } } });
    expect(caseOf('lv-d62-short')).toMatchObject({ preDrag: 440, reads: { swipes: { drop: [2], shorten: { stroke: 1, px: 90 } } } });
    expect(caseOf('lv-t12-drop-first')).toMatchObject({ preDrag: 440, reads: { swipes: { drop: [1] } } });
    expect(caseOf('lv-d62-control').reads?.swipes).toEqual({});
  });

  it('a premise SKIP fails the run on the lv-d62 legs alone (skipFails: the harness broke), never elsewhere', () => {
    expect(CASES.filter((c) => c.skipFails === true).map((c) => c.id)).toEqual(['lv-d62-control', 'lv-d62-drop', 'lv-d62-short', 'lv-d62-drop-two', 'lv-t12-drop-first']);
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
    expect(CAROUSEL_CASES).toHaveLength(11);
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

describe('lv-d62-short: the recorded shape in both device states seen, a probe that carries 94 px or less of its 142, then a held reveal (T11)', () => {
  /** The case's judge over a drop leg's record with the app's first carousel stroke since the call carrying `carry`. */
  const shortRecord = (carry: number) => {
    const r = recorded('lv-d62-drop');
    const [probe, ...rest] = r.state!.strokes!.filter((s) => s.view === 'carousel' && s.at > (r.launched.strokes ?? []).reduce((m, x) => Math.max(m, x.at), 0));
    const others = rest.map((s) => ({ ...s }));
    r.state = { ...r.state!, strokes: [...(r.launched.strokes ?? []), { ...probe, to: probe.from + carry }, ...others] };
    r.swipes = r.swipes!.map((s, i) => (i === 0 ? { ...s, sentTo: { x: s.from.x - 90, y: s.from.y } } : s));
    return r;
  };
  const judged = (r: ReturnType<typeof shortRecord>) => caseOf('lv-d62-short').judge(r.state!, r.replies, r.source, r.launched, r.after, { swipes: r.swipes });
  it('a probe that carried 94 px: the premise held, maxSwipes hedged is ok', () => {
    expect(judged(shortRecord(94))).toMatchObject({ outcome: 'ok' });
  });
  it('a probe that carried 95: SKIP, the shape not reproduced — the case proves nothing, and its SKIP fails the run', () => {
    expect(judged(shortRecord(95))).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/carried 95 px, over the 94 .* not reproduced/) });
  });
  it('the premise reads the carry in either direction, and names a call whose probe the app never logged', () => {
    const r = shortRecord(-95);
    expect(judged(r)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/carried 95 px/) });
    expect(judged(shortRecord(-94)).outcome).not.toBe('SKIP');
    const none = shortRecord(80);
    none.state = { ...none.state!, strokes: none.launched.strokes ?? [] };
    expect(judged(none)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/the probe carried no px, over the 94 .* not reproduced/) });
  });

  it('the false claim is a MISMATCH whatever the carry, ahead of any premise', () => {
    for (const carry of [90, 200]) {
      const r = shortRecord(carry);
      r.replies = [D62_FALSE_PASS];
      r.state = withC(r.state!, 438);
      expect(judged(r)).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
    }
  });
  it('a fix that stops `unaimable` is honest too, ok; the hedge on two held reveals is LOUD: not what this case drew', () => {
    const r = shortRecord(80);
    r.replies = ["ERROR scroll_until id:lab.carousel-recycler-free.C stopped after 5 swipes, without swiping further — more swipes are unlikely to help"];
    expect(judged(r).outcome).toBe('ok');
    r.replies = [`Element id:lab.carousel-recycler-free.C ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], flush: { edge: 'right', container: LAB_CAROUSEL, checked: false, why: 'held', revealed: 55 } })}`];
    expect(judged(r)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
  });
});

describe('lv-d62-drop-two: two reveals dropped, the hedge with C cut, then "calling again tells" in the cut direction (T11)', () => {
  const HEDGE = `Element id:lab.carousel-recycler-free.C ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], flush: { edge: 'right', container: LAB_CAROUSEL, checked: false, why: 'held', revealed: 136 } })}`;
  const SECOND = 'ERROR scroll_until id:lab.carousel-recycler-free.C failed after 6 swipes (maxSwipes) — … so it may still be cut there; raise maxSwipes or timeoutMs';
  const dropped = (d: boolean) => ({ from: { x: 824, y: 497 }, to: { x: 682, y: 497 }, durationMs: 300, dropped: d });
  const at = 100;
  const run = (over: { replies?: string[]; second?: { from: number; to: number } | null; swipes?: boolean[]; cutAtHedge?: boolean; wholeAtEnd?: boolean; noAfter?: true; log?: { swipes?: SwipeEntry[] } } = {}) => {
    const launched = withC(recorded('lv-d62-drop').launched, 578);
    const base = launched.strokes ?? [];
    const proof = { view: 'carousel', from: 436, to: 572, at };
    const hedged = { ...withC(launched, over.cutAtHedge === false ? 66 : 442), strokes: [...base, proof] };
    const next = over.second === null ? [] : [{ view: 'carousel', ...(over.second ?? { from: 572, to: 772 }), at: at + 5 }];
    const state = { ...withC(launched, over.wholeAtEnd === true ? 66 : 242), strokes: [...base, proof, ...next] };
    const log = 'log' in over ? over.log : { swipes: (over.swipes ?? [false, true, true, false]).map(dropped) };
    return caseOf('lv-d62-drop-two').judge(state, over.replies ?? [HEDGE, SECOND], 'uiautomator', launched, over.noAfter === true ? [] : [hedged], log);
  };
  it('the hedge with C cut, then the second call\'s first stroke moves C: ok', () => {
    expect(run()).toMatchObject({ outcome: 'ok' });
  });
  it('the old rule\'s "nothing of it is cut" on the first call with C cut: MISMATCH', () => {
    expect(run({ replies: [D62_FALSE_PASS, SECOND] })).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
  });
  it('the first call\'s claim is judged on the state it left: cut there, whole by the end of the second call, still a MISMATCH', () => {
    expect(run({ replies: [D62_FALSE_PASS, SECOND], wholeAtEnd: true })).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
  });
  it('the second call reading `checked` with C still cut: MISMATCH (T12\'s shape, a first probe not taken)', () => {
    expect(run({ replies: [HEDGE, D62_FALSE_PASS], second: { from: 572, to: 572 } })).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
  });
  it('the second call\'s stroke did not move C, or none was logged, with no claim: LOUD, the promise not shown', () => {
    expect(run({ second: { from: 572, to: 573 } })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
    expect(run({ second: null })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
  });
  it('no hedge on the first call: LOUD; a premise not shown: SKIP', () => {
    expect(run({ replies: [SECOND, SECOND] })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
    expect(run({ cutAtHedge: false })).toMatchObject({ outcome: 'SKIP' });
    expect(run({ swipes: [false, true, false, false] })).toMatchObject({ outcome: 'SKIP' });
  });

  it('T13: each verdict carries the app and the first reply\'s kind, and says why', () => {
    expect(run()).toMatchObject({ outcome: 'ok', kind: 'visible', app: expect.stringMatching(/^C cut L 0 R \d+; offset /), why: `hedged with C cut L 0 R 376; the second call moved C 572→772: ${SECOND}` });
    expect(run({ replies: [D62_FALSE_PASS, SECOND] }).why).toBe(`"fully visible" while C cut L 0 R 376: ${D62_FALSE_PASS}`);
    expect(run({ cutAtHedge: false }).why).toBe('C whole after the first call (C cut L 0 R 0): no cut to tell');
    expect(run({ replies: [SECOND, SECOND] }).why).toBe(`no hedge on the first call, C cut L 0 R 376: ${SECOND}`);
    expect(run({ second: { from: 572, to: 573 } }).why).toBe(`the second call's first stroke did not move C: ${SECOND}`);
    expect(run({ second: null }).why).toBe(`the second call's first stroke was not logged: ${SECOND}`);
  });

  it('T13: a second stroke that moved C CUT_TOLERANCE_PX is no move; one past it is', () => {
    expect(run({ second: { from: 572, to: 572 + CUT_TOLERANCE_PX } })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
    expect(run({ second: { from: 572, to: 573 + CUT_TOLERANCE_PX } })).toMatchObject({ outcome: 'ok' });
  });

  it('T13: no state after the first call, or a log that lacks strokes 2 and 3 dropped (stroke 2 kept, too few strokes, no strokes, no log): SKIP, never thrown', () => {
    expect(run({ noAfter: true })).toMatchObject({ outcome: 'SKIP', why: NO_CLIP });
    expect(run({ swipes: [false, false, true, false] })).toMatchObject({ outcome: 'SKIP', why: 'strokes 2 and 3 not both dropped' });
    for (const swipes of [[false], [false, true]]) expect(run({ swipes })).toMatchObject({ outcome: 'SKIP', why: 'strokes 2 and 3 not both dropped' });
    expect(run({ log: {} })).toMatchObject({ outcome: 'SKIP', why: 'strokes 2 and 3 not both dropped' });
    expect(run({ log: undefined })).toMatchObject({ outcome: 'SKIP', why: 'strokes 2 and 3 not both dropped' });
  });
});

describe('lv-t12-drop-first: the first probe after the pre-drag dropped (T12)', () => {
  /** lv-d62-drop's record as lv-t12-drop-first: its first stroke dropped, the strokes after it sent. */
  const dropFirst = (strokes: readonly { from: number; to: number }[]): Recorded => {
    const r = { ...recorded('lv-d62-drop'), id: 'lv-t12-drop-first' };
    r.swipes = strokes.map((s, i) => ({ from: { x: s.from, y: 497 }, to: { x: s.to, y: 497 }, dropped: i === 0 }));
    return r;
  };
  it('the false claim (base: one held probe read `checked`) is a MISMATCH before any premise', () => {
    const r = dropFirst([{ from: 824, to: 682 }]);
    r.replies = [D62_FALSE_PASS];
    r.state = withC(r.state!, 438);
    expect(verdictOf(r)).toMatchObject({ outcome: 'MISMATCH', cls: 'fully-cut' });
  });
});

describe('the hard check: never "fully visible" while C is cut (lv-d62, D68, D52, D59b alike)', () => {
  it('T11: the hedge on two held reveals with C cut is no claim: LOUD, not what the case was built for, never fully-cut', () => {
    const r = recorded('lv-d62-drop');
    r.replies = [`Element id:lab.carousel-recycler-free.C ${describeScrollResult({ swipes: 3, visible: 1, clipped: [], flush: { edge: 'right', container: LAB_CAROUSEL, checked: false, why: 'held', revealed: 55 } })}`];
    r.state = withC(r.state!, 532);
    expect(verdictOf(r)).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind' });
  });

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

  it('T13: the premises read off a state or launch that lacks them — SKIP, never thrown — each saying why; a failed swipe or read LOUD as a kind', () => {
    const r = recorded('d37-snap-lazy');
    expect(verdictOf({ ...r, launched: { ...r.launched, scrollViews: undefined } })).toMatchObject({ outcome: 'SKIP', why: 'the clip is undefined, not the lab\'s {"x":66,"y":380,"width":948,"height":234} the stroke was drawn for' });
    expect(verdictOf({ ...r, state: { ...r.state!, offsets: undefined } })).toMatchObject({ outcome: 'SKIP', why: 'the app wrote no carousel.index or offset' });
    const { carousel: _o, ...noOffset } = r.state!.offsets!;
    expect(verdictOf({ ...r, state: { ...r.state!, offsets: noOffset } })).toMatchObject({ outcome: 'SKIP', why: 'the app wrote no carousel.index or offset' });
    expect(verdictOf(at(r, 1, 951)).why).toBe('the resting offset 951 is no whole card (948): still moving at the read');
    expect(verdictOf({ ...r, replies: ['ERROR Swipe failed', r.replies[1]] })).toMatchObject({ cls: 'carousel-kind' });
    expect(verdictOf({ ...r, replies: [r.replies[0], 'ERROR no tree'] })).toMatchObject({ cls: 'carousel-kind', kind: 'refused' });
    expect(verdictOf({ ...r, replies: [r.replies[0]] })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', kind: 'other', why: 'no snapshot: ' });
  });

  it('T13: C found by its id among the nodes listed, not the first node; the words of a card-0 ok and a card-2 MISMATCH', () => {
    const r = recorded('d37-snap-lazy');
    const both = JSON.stringify([{ role: 'other', identifier: 'lab.carousel-lazy.B', label: null, rect: { x: 300, y: 380, width: 948, height: 234 } }, { role: 'other', identifier: 'lab.carousel-lazy.C', label: null, rect: { x: 66, y: 380, width: 948, height: 234 } }], null, 2);
    expect(verdictOf({ ...r, replies: [r.replies[0], both] }).outcome).toBe('ok');
    const rec = recorded('d37-snap-recycler');
    expect(verdictOf({ ...at(rec, 0, 0), replies: [rec.replies[0], snap(undefined, 'carousel-recycler')] }).why).toBe('at rest on card 0, the first read lists C absent');
    expect(verdictOf({ ...at(rec, 2, 1896), replies: [rec.replies[0], snap({ x: 0, width: 69 }, 'carousel-recycler')] }).cls).toBe('unsettled-read');
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

/**
 * T13: what the mutation run (scripts/mutation/scope.json) found no test holding — the cases as the device runs them
 * (the case table's toStrictEqual and the `says` test pin the case data itself: a changed case fails here first, by
 * design), each premise's guard against a state or log that lacks what it reads, and the words of every verdict.
 */
describe('the carousel group\'s cases and verdicts, held (T13)', () => {
  const C = (cell: string, direction: 'left' | 'right') => ({ tool: 'scroll_until', args: { selector: `id:lab.${cell}.C`, direction, fully: true } });
  const READS = { swipes: {}, late: false };
  /** `judge` on `r`'s record with no stroke log at all, or with `replies` in place of its own. */
  const judgeWithoutLog = (judge: Case['judge'], r: Recorded, replies: string[] = r.replies) => judge(r.state!, replies, r.source, r.launched, r.after, undefined);

  it('each scroll_until case: its cell, its pre-drag, what it reads and drops, whether its SKIP fails the run, its calls', () => {
    const shown = CAROUSEL_CASES.filter((c) => !c.id.startsWith('d37-')).map(({ id, cell, preDrag: px, reads, skipFails, calls }) => ({ id, cell, preDrag: px, reads, skipFails, calls }));
    expect(shown).toStrictEqual([
      { id: 'lv-d62-control', cell: 'carousel-recycler-free', preDrag: 440, reads: READS, skipFails: true, calls: [C('carousel-recycler-free', 'left')] },
      { id: 'lv-d62-drop', cell: 'carousel-recycler-free', preDrag: 440, reads: { swipes: { drop: [2] }, late: false }, skipFails: true, calls: [C('carousel-recycler-free', 'left')] },
      { id: 'lv-d62-short', cell: 'carousel-recycler-free', preDrag: 440, reads: { swipes: { drop: [2], shorten: { stroke: 1, px: 90 } }, late: false }, skipFails: true, calls: [C('carousel-recycler-free', 'left')] },
      { id: 'lv-d62-drop-two', cell: 'carousel-recycler-free', preDrag: 440, reads: { swipes: { drop: [2, 3] }, betweenCalls: true, late: false }, skipFails: true, calls: [C('carousel-recycler-free', 'left'), C('carousel-recycler-free', 'left')] },
      { id: 'lv-t12-drop-first', cell: 'carousel-recycler-free', preDrag: 440, reads: { swipes: { drop: [1] }, late: false }, skipFails: true, calls: [C('carousel-recycler-free', 'left')] },
      { id: 'lv-d68-launch', cell: 'carousel-recycler-free', preDrag: undefined, reads: READS, skipFails: undefined, calls: [C('carousel-recycler-free', 'right')] },
      { id: 'lv-d59b-lazy', cell: 'carousel-lazy-free', preDrag: undefined, reads: READS, skipFails: undefined, calls: [C('carousel-lazy-free', 'right')] },
      { id: 'lv-d59b-recycler', cell: 'carousel-recycler-free', preDrag: undefined, reads: READS, skipFails: undefined, calls: [C('carousel-recycler-free', 'right')] },
      { id: 'd52-e2', cell: 'carousel-in-list', preDrag: 440, reads: READS, skipFails: undefined, calls: [C('carousel-in-list', 'left')] },
    ]);
  });

  it('each case says what it stands for, its decision first; D37\'s names its pager', () => {
    expect(Object.fromEntries(CAROUSEL_CASES.map((c) => [c.id, c.says.slice(0, c.says.indexOf(':') + 1)]))).toEqual({
      'lv-d62-control': 'D62/D68 control:',
      'lv-d62-drop': 'D62:',
      'lv-d62-short': 'T11:',
      'lv-d62-drop-two': 'T11:',
      'lv-t12-drop-first': 'T12:',
      'lv-d68-launch': 'D68:',
      'lv-d59b-lazy': 'D59b/D59:',
      'lv-d59b-recycler': 'D59b/D68:',
      'd52-e2': 'D52 E2:',
      'd37-snap-lazy': 'D37:',
      'd37-snap-recycler': 'D37:',
    });
    for (const c of CAROUSEL_CASES) expect(c.says.length).toBeGreaterThan(c.says.indexOf(':') + 20);
    expect(caseOf('d37-snap-lazy').says).toContain('on the snapping LazyRow pager');
    expect(caseOf('d37-snap-recycler').says).toContain('on the snapping RecyclerView pager');
  });

  it('a verdict\'s app: C against the clip, the offset, the resting card and the carousel strokes since the call — none of another view; ? and - when unwritten', () => {
    const r = recorded('lv-d62-control');
    expect(verdictOf(r).app).toBe('C cut L 0 R 19; offset 929, index 1; 6 carousel stroke(s) since the call');
    r.state = { ...r.state!, strokes: [...r.state!.strokes!, { view: 'page', from: 0, to: 40, at: 1793893750 }] };
    expect(verdictOf(r).app).toBe('C cut L 0 R 19; offset 929, index 1; 6 carousel stroke(s) since the call');
    expect(verdictOf({ ...r, state: { ...r.state, offsets: undefined } }).app).toBe('C cut L 0 R 19; offset ?, index -; 6 carousel stroke(s) since the call');
  });

  it('the pre-drag cases skip when C was whole before the call (lv-d62-short, lv-t12-drop-first, d52-e2 too)', () => {
    for (const id of ['lv-d62-short', 'lv-t12-drop-first', 'd52-e2']) {
      const r = { ...recorded(id === 'd52-e2' ? 'd52-e2' : 'lv-d62-drop'), id };
      r.launched = withC(r.launched, 66);
      expect(verdictOf(r)).toMatchObject({ outcome: 'SKIP', why: expect.stringMatching(/^C not cut before the call \(C cut L 0 R 0\)/) });
    }
  });

  it('a case with neither a pre-drag nor a band asks nothing of the launch: no clip there, or C whole there, still judged', () => {
    const r = recorded('lv-d68-launch');
    expect(verdictOf({ ...r, launched: { ...r.launched, scrollViews: {} } })).toMatchObject({ outcome: 'ok' });
    expect(verdictOf({ ...r, launched: withC(r.launched, 66) })).toMatchObject({ outcome: 'ok' });
    const lazy = recorded('lv-d59b-lazy');
    expect(verdictOf({ ...lazy, launched: { ...lazy.launched, scrollViews: {} } })).toMatchObject({ outcome: 'SKIP', why: NO_CLIP });
  });

  it('a premise read with no log at all: SKIP, never thrown', () => {
    const drop = recorded('lv-d62-drop');
    expect(judgeWithoutLog(caseOf('lv-d62-drop').judge, drop)).toMatchObject({ outcome: 'SKIP', why: 'no stroke log: the drop unshown' });
    const lazy = recorded('lv-d59b-lazy');
    expect(judgeWithoutLog(caseOf('lv-d59b-lazy').judge, lazy)).toMatchObject({ outcome: 'SKIP', why: 'no stroke log: the band unjudged' });
  });

  it('the words of an ok verdict: fully visible with C whole; a kind accepted under its residual', () => {
    const whole = recorded('lv-d68-launch');
    whole.replies = [D62_FALSE_PASS];
    whole.state = withC(whole.state!, 66);
    expect(verdictOf(whole).why).toBe(`fully visible, and C whole in the app: ${D62_FALSE_PASS}`);
    const hedged = recorded('lv-d62-control');
    hedged.replies = recorded('lv-d62-drop').replies;
    expect(verdictOf(hedged)).toMatchObject({ outcome: 'ok', accepted: D68_SPREAD });
    expect(verdictOf(hedged).why).toMatch(/^maxSwipes-hedged, accepted and counted \(residual:ADR 0021 D68 — the room left at the bound within a pixel of the least carry keeps maxSwipes, hedged: .*\), C cut L 0 R 19: ERROR scroll_until /);
  });

  it('lv-t12-drop-first: its first stroke dropped and sent again, then the hedged bound or `unaimable` ok — any other kind LOUD, naming both', () => {
    const drop = recorded('lv-d62-drop');
    const r = { ...drop, id: 'lv-t12-drop-first', swipes: [{ ...drop.swipes![0], dropped: true }, { ...drop.swipes![0] }, ...drop.swipes!.slice(2)] };
    expect(verdictOf(r)).toMatchObject({ outcome: 'ok' });
    expect(verdictOf({ ...r, replies: recorded('lv-d62-control').replies })).toMatchObject({ outcome: 'ok' });
    const stuck = 'ERROR scroll_until id:lab.carousel-recycler-free.C failed after 6 swipes — element is on screen but did not move';
    expect(verdictOf({ ...r, replies: [stuck] })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', why: `other, not maxSwipes-hedged or unaimable: ${stuck}` });
  });

  it('an unfit case that asks nothing of the axis takes either; one that names no count, none asked of it; one that asks a count names it', () => {
    const r = recorded('d52-e2');
    const uncounted = r.replies[0].replace('failed after 3 swipes', 'failed');
    const judge = judgeFully({ kinds: ['unfit'] });
    expect(judgeWithoutLog(judge, r, [uncounted])).toMatchObject({ outcome: 'ok' });
    expect(judgeWithoutLog(judge, r, recorded('lv-d59b-lazy').replies)).toMatchObject({ outcome: 'ok' });
    expect(judgeWithoutLog(judgeFully({ kinds: ['unaimable'], inferred: true }), r, recorded('lv-d62-control').replies)).toMatchObject({ outcome: 'ok' });
    expect(verdictOf({ ...r, replies: [uncounted] })).toMatchObject({ outcome: 'LOUD', cls: 'carousel-kind', why: `unfit after ? swipes, more than 3: ${uncounted.slice(0, 220)}` });
  });

  it('preDrag refuses a launch that reports no scroll views at all', async () => {
    const launch = recorded('lv-d62-control').preDrag!.launch;
    const lab = { swipe: async () => undefined, state: async () => launch };
    await expect(preDrag(lab, { ...launch, scrollViews: undefined }, 440, async () => undefined)).rejects.toThrow(/reports no carousel scroll view to pre-drag/);
  });

  it('no-retry names both strokes', () => {
    const r = recorded('lv-d62-drop');
    r.swipes![2] = { ...r.swipes![2], to: { x: 489, y: 497 } };
    expect(verdictOf(r).why).toMatch(/^no retry seen: stroke 3 is not the dropped reveal sent again \(\(256,497\)→\(489,497\), not \(256,497\)→\(486,497\)\): ERROR /);
  });
});
