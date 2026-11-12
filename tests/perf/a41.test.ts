import { describe, expect, it } from 'vitest';
import {
  A41_CHILD_NAMES,
  A41_CHILDREN,
  baselineCell,
  CADENCES,
  coverIdsOf,
  coverUp,
  movingTally,
  cadenceJudgement,
  classesOf,
  encodeRects,
  foregroundOk,
  snapshotRootLabel,
  WAITED_GAP_MIN_MS,
  WAITED_GAP_MS,
  hitTargetsOf,
  hitVerdict,
  movedTrial,
  namedBy,
  parseDescribePoint,
  rectKey,
  reportOf,
  spreadOf,
  summaryLines,
  traceIds,
  tenths,
  wrongSettle,
  type A41Report,
  type CadencePass,
  type ChildSpec,
  type GoldenResultLike,
  type HitResult,
  type HitTarget,
  type Trial,
} from '../../scripts/perf/a41.js';

// a41.ts: the device-free arithmetic of the A41b/A41c probe — the hit-test targets from the golden's JSON, idb's
// describe-point parsed and judged, the medians, the settle trace's equality classes and the cadence judgement, the
// summary's lines. No device: every input is written here by hand.

const tap = (target: string, kind: string, calls: string[], mismatch?: string) => ({ target, verb: 'tap', kind, calls, ...(mismatch !== undefined && { mismatch }), says: `says ${target}` });

describe('hitTargetsOf — the false-Tapped idb taps the golden lists, and the open controls beside them', () => {
  const results: GoldenResultLike[] = [
    {
      recording: 'ios-iphone17-ios27/blur-menu.idb.json',
      checks: [
        tap('A', 'Tapped', ['idb ui tap 201 142'], 'expected refused'),
        tap('C', 'refused', [], 'expected refused'),
        tap('K', 'Tapped', ['idb ui tap 201 412']),
        { target: 'K', verb: 'colour', kind: 'PASS', calls: [] },
      ],
    },
    // The same cell under WDA: never a target, whatever it says.
    { recording: 'ios-iphone17-ios27/blur-menu.wda.json', checks: [tap('A', 'Tapped', ['idb ui tap 201 142'], 'expected refused')] },
    // Android: never.
    { recording: 'android-averi_lab-api33/blur-menu.xml', checks: [tap('A', 'Tapped', ['adb shell input tap 1 2'], 'expected refused')] },
    { recording: 'ios-iphone17-ios27/scroll-bounded-footer.idb.json', checks: [tap('O', 'Tapped', ['idb ui tap 201 670'], 'expected R-outside-sv')] },
    // A cell with no false Tapped: its open taps are no control, unless the cell is a named control cell.
    { recording: 'ios-iphone17-ios27/open.idb.json', checks: [tap('A', 'Tapped', ['idb ui tap 100 100'])] },
    { recording: 'ios-iphone17-ios27/blur-menu-unhidden.idb.json', checks: [tap('A', 'refused', []), tap('W', 'Tapped', ['idb ui tap 201 480'])] },
    { recording: 'ios-rn-iphone17-ios27/rn-banner.idb.json', checks: [tap('T', 'Tapped', ['idb ui tap 201 142.5'], 'expected refused')] },
  ];

  it('takes every idb tap that says Tapped where the truth refuses, at the point it struck, then the controls', () => {
    const t = hitTargetsOf(results);
    expect(t.map((x) => `${x.kind} ${x.app} ${x.id} ${x.point.x},${x.point.y}`)).toEqual([
      'false-tapped native lab.blur-menu.A 201,142',
      'false-tapped native lab.scroll-bounded-footer.O 201,670',
      'false-tapped react-native lab.rn-banner.T 201,142.5',
      'control native lab.blur-menu.K 201,412',
      'control native lab.blur-menu-unhidden.W 201,480',
    ]);
    expect(t[0]).toEqual({ kind: 'false-tapped', app: 'native', run: 'ios-iphone17-ios27', cell: 'blur-menu', target: 'A', id: 'lab.blur-menu.A', point: { x: 201, y: 142 }, says: 'says A' });
  });

  it('the control cells are a parameter: none named, only the false targets\' own cells give controls', () => {
    expect(hitTargetsOf(results, []).filter((x) => x.kind === 'control').map((x) => x.id)).toEqual(['lab.blur-menu.K']);
  });

  it('a Tapped mismatch whose calls hold no idb tap is said, never guessed', () => {
    expect(() => hitTargetsOf([{ recording: 'ios-iphone17-ios27/x.idb.json', checks: [tap('A', 'Tapped', [], 'm')] }])).toThrow('lab.x.A: its golden check sent no idb ui tap');
  });
});

describe('parseDescribePoint — `idb ui describe-point X Y --json`', () => {
  const el = { type: 'Button', AXLabel: 'Target K', AXUniqueId: 'lab.blur-menu.K', frame: { x: 51, y: 380, width: 300, height: 64 } };
  it('reads the one element, as an object or a one-element list', () => {
    const want = { type: 'Button', label: 'Target K', id: 'lab.blur-menu.K', frame: { x: 51, y: 380, width: 300, height: 64 } };
    expect(parseDescribePoint(JSON.stringify(el))).toEqual(want);
    expect(parseDescribePoint(`${JSON.stringify([el])}\n`)).toEqual(want);
  });
  it('empty strings and missing keys are null', () => {
    expect(parseDescribePoint('{"type":"Other","AXLabel":"","AXUniqueId":null}')).toEqual({ type: 'Other', label: null, id: null, frame: null });
  });
  it('no JSON, or no element in it: throws naming what it got', () => {
    expect(() => parseDescribePoint('garbage')).toThrow('describe-point: not JSON: garbage');
    expect(() => parseDescribePoint('[]')).toThrow('describe-point: no element in []');
  });
});

describe('namedBy / hitVerdict — does the hit test name the target?', () => {
  const target = { id: 'lab.c.A', frame: { x: 0, y: 100, width: 300, height: 64 } };
  it('by its id; an unidentified element inside its frame (a label within it); something else; the app or nothing', () => {
    expect(namedBy({ type: 'Button', label: 'x', id: 'lab.c.A', frame: null }, target)).toBe('target');
    expect(namedBy({ type: 'StaticText', label: 'Target A', id: null, frame: { x: 10, y: 110, width: 100, height: 20 } }, target)).toBe('inside-target');
    expect(namedBy({ type: 'StaticText', label: 'Target A', id: null, frame: { x: 10, y: 90, width: 100, height: 20 } }, target)).toBe('other');
    expect(namedBy({ type: 'StaticText', label: 'x', id: null, frame: { x: 10, y: 110, width: 100, height: 20 } }, { id: 'lab.c.A' })).toBe('other');
    expect(namedBy({ type: 'Button', label: 'W', id: 'lab.c.W', frame: { x: 10, y: 110, width: 100, height: 20 } }, target)).toBe('other');
    expect(namedBy({ type: 'Application', label: ' ', id: null, frame: { x: 0, y: 0, width: 402, height: 874 } }, target)).toBe('nothing');
    expect(namedBy(undefined, target)).toBe('nothing');
  });

  const t = (kind: HitTarget['kind']): HitTarget => ({ kind, app: 'native', run: 'ios-x', cell: 'c', target: 'A', id: 'lab.c.A', point: { x: 1, y: 2 }, says: '' });
  const r = (kind: HitTarget['kind'], named: string[], error?: string): HitResult => ({
    target: t(kind),
    cli: named.map((n) => ({ ms: 100, named: n as never })),
    helper: error === undefined ? [] : [{ ms: 5, error }],
  });
  it('a false-Tapped target: sound when no probe names it; unsound when one does; unproven on an error or none', () => {
    expect(hitVerdict(r('false-tapped', ['other', 'nothing']))).toBe('sound');
    expect(hitVerdict(r('false-tapped', ['other', 'inside-target']))).toBe('unsound');
    expect(hitVerdict(r('false-tapped', ['other'], 'timed out'))).toBe('unproven');
    expect(hitVerdict(r('false-tapped', []))).toBe('unproven');
    expect(hitVerdict({ ...r('false-tapped', ['other']), skipped: 'not installed' })).toBe('unproven');
  });
  it('a control: open when every probe names it; a false refusal when one does not', () => {
    expect(hitVerdict(r('control', ['target', 'inside-target']))).toBe('open');
    expect(hitVerdict(r('control', ['target', 'other']))).toBe('false-refusal');
    expect(hitVerdict(r('control', ['target'], 'x'))).toBe('unproven');
  });
});

describe('spreadOf / baselineCell — the medians', () => {
  it('n, median and range; none for no number', () => {
    expect(spreadOf([3, 1, 2, 10])).toEqual({ n: 4, median: 2.5, min: 1, max: 10 });
    expect(spreadOf([])).toBeUndefined();
  });
  it("a baseline scenario: its first repeat apart (a fresh server's one-time costs), the warm spread over the ok rest", () => {
    const runs = [
      { repeat: 1, status: 'ok', wallMs: 9000 },
      { repeat: 2, status: 'ok', wallMs: 400 },
      { repeat: 3, status: 'failed', wallMs: 50 },
      { repeat: 4, status: 'ok', wallMs: 600 },
    ];
    expect(baselineCell(runs)).toEqual({ first: 9000, warm: { n: 2, median: 500, min: 400, max: 600 }, failed: 1 });
    expect(baselineCell([{ repeat: 1, status: 'failed', wallMs: 1 }])).toEqual({ failed: 1 });
  });
});

describe('the settle trace: rects as equality classes (the d35 fixture\'s encoding) and the wrong settle', () => {
  const R = (y: number) => rectKey({ x: 0, y, width: 10, height: 10 });
  it('encodes a read sequence that decodes back to the same classes', () => {
    const perRead: Record<string, string>[] = [{ a: R(1), b: R(5) }, { a: R(1) }, { a: R(2), b: R(5) }, { a: R(1), b: R(6) }, { a: R(1), b: R(6) }];
    const rects = encodeRects(perRead);
    expect(rects).toEqual({ a: '+.+(0).', b: '+-(0)+.' });
    expect(classesOf({ reads: perRead.map((_, i) => [i, i + 1] as [number, number]), rects })).toEqual([
      { a: 0, b: 0 },
      { a: 0 },
      { a: 1, b: 0 },
      { a: 0, b: 1 },
      { a: 0, b: 1 },
    ]);
  });
  it('a token count that is not the read count is refused', () => {
    expect(() => classesOf({ reads: [[0, 1]], rects: { a: '+.' } })).toThrow('a: 2 tokens for 1 reads');
  });
  it('a trial moved when some id holds two rects; a settle is wrong when a later read has the id at another rect', () => {
    const reads: [number, number][] = [[0, 1], [1, 2], [2, 3]];
    expect(movedTrial({ reads, rects: { a: '+..', b: '+-(0)' } })).toBe(false);
    expect(movedTrial({ reads, rects: { a: '+.+' } })).toBe(true);
    const classes: Record<string, number>[] = [{ a: 0 }, { a: 0 }, {}, { a: 1 }];
    expect(wrongSettle(classes, 'a', 1)).toBe(true);
    expect(wrongSettle(classes, 'a', 3)).toBe(false);
    expect(wrongSettle([{ a: 0 }, {}, { a: 0 }] as Record<string, number>[], 'a', 0)).toBe(false);
  });
});

describe('traceIds / tenths — what a trace keeps of one read', () => {
  const node = (identifier: string | null, label: string | null, y: number, children: unknown[] = []) => ({ role: 'other', label, identifier, value: null, rect: { x: 0, y, width: 10, height: 5 }, children });
  it('every lab.* identifier, and the labels a motion names for rows its source lists without one; the last node wins', () => {
    const tree = node(null, null, 0, [node('lab.c.A', 'Target A', 1), node(null, 'Row 3', 2, [node(null, 'Row 4', 3)]), node('other.id', 'Row 5', 4), node('lab.c.A', null, 9), node(null, 'Title', 6)]);
    expect(traceIds(tree as never, /^Row \d+$/)).toEqual({ 'lab.c.A': '0,9,10,5', 'label:Row 3': '0,2,10,5', 'label:Row 4': '0,3,10,5' });
    expect(traceIds(tree as never)).toEqual({ 'lab.c.A': '0,9,10,5' });
  });
  it('times at 0.1 ms', () => {
    expect(tenths(364.4567)).toBe(364.5);
    expect(tenths(-0.04)).toBe(-0);
  });
});

describe('cadenceJudgement — shorten to 300 only on 0 wrong in ≥ 60 judged settles, every motion seen moving ≥ 15 times', () => {
  const pass = (o: Partial<CadencePass> = {}): CadencePass => ({ pollMs: 300, settles: { M1a: 90 }, wrong: [], moving: 70, censored: 5, judged: 65, wrongJudged: 0, ...o });
  const judge = (moving: Record<string, number>, short: CadencePass, trials = 60) => cadenceJudgement({ trials, moving, short });
  it('shorten: 0 wrong in 65 judged, every motion moving ≥ 15', () => {
    expect(judge({ M1a: 20, M2: 15 }, pass())).toEqual({ verdict: 'shorten', why: '0 wrong in 65 moving, uncensored settles over 60 trials at 300 ms; moving trials M1a 20, M2 15' });
  });
  it('keep: any wrong settle at 300, judged or censored', () => {
    expect(judge({ M1a: 20 }, pass({ wrong: ['M1a#3 lab.x @2'] }))).toEqual({ verdict: 'keep', why: '1 wrong settles at 300 ms (M1a#3 lab.x @2)' });
  });
  it('unproven: under 60 judged settles (censored and static ones do not count), a motion moving under 15 times, no trial', () => {
    expect(judge({ M1a: 20 }, pass({ judged: 59 }))).toEqual({ verdict: 'unproven', why: '0 wrong in 59 moving, uncensored settles over 60 trials at 300 ms: under 60 judged; moving trials M1a 20' });
    expect(judge({ M1a: 20 }, pass({ judged: 60 })).verdict).toBe('shorten');
    expect(judge({ M1a: 20, M2: 14 }, pass())).toEqual({ verdict: 'unproven', why: 'a motion seen moving fewer than 15 times: M1a 20, M2 14' });
    expect(judge({}, pass(), 0)).toEqual({ verdict: 'unproven', why: 'no trial recorded' });
  });
  it('movingTally: per motion, the trials that moved', () => {
    const t = (motion: string, a: string): Trial => ({ motion, cell: 'c', trial: 0, trigger: [0, 1], appMoved: null, reads: [[1, 2], [2, 3]], rects: { a } });
    expect(movingTally([t('M1', '+.'), t('M1', '++'), t('M2', '++')])).toEqual({ M1: 1, M2: 1 });
  });
});

describe('coverIdsOf / coverUp — a hit-test cell is probed only with its cover up', () => {
  const capture = [{ AXUniqueId: null }, { AXUniqueId: 'lab.rn-banner.T.cover' }, { AXUniqueId: 'lab.rn-banner.T' }, { AXUniqueId: 'lab.rn-banner.continue' }, { AXUniqueId: 'lab.other.x' }];
  it("the cell's non-target ids its recorded idb capture lists; none for a cell whose cover idb does not list", () => {
    expect(coverIdsOf(capture, 'rn-banner')).toEqual(['lab.rn-banner.T.cover', 'lab.rn-banner.continue']);
    expect(coverIdsOf([{ AXUniqueId: 'lab.blur-menu.A' }, { AXUniqueId: 'lab.blur-menu.K' }], 'blur-menu')).toEqual([]);
  });
  it("up: the lab ready and every cover id listed; else why not", () => {
    const listed = [{ AXUniqueId: 'lab.rn-banner.T.cover' }];
    expect(coverUp({ ready: true, listed, coverIds: ['lab.rn-banner.T.cover'] })).toEqual({ up: true, how: 'ready; lab.rn-banner.T.cover listed' });
    expect(coverUp({ ready: true, listed: [], coverIds: [] })).toEqual({ up: true, how: 'ready (idb lists no cover here)' });
    expect(coverUp({ ready: true, listed: [], coverIds: ['lab.rn-banner.T.cover'] })).toEqual({ up: false, how: 'describe-all lists no lab.rn-banner.T.cover' });
    expect(coverUp({ ready: false, listed, coverIds: ['lab.rn-banner.T.cover'] })).toEqual({ up: false, how: 'the lab never said ready' });
  });
});

describe('A41_CHILDREN — one table for the probe, the batch and the report', () => {
  it('each child once, its file, its part; the probe modes each a child', () => {
    expect(A41_CHILD_NAMES).toEqual(['baseline-idb', 'hit-test', 'baseline-wda', 'wda-cold', 'auto-tap', 'cadence']);
    expect(new Set(A41_CHILD_NAMES.map((n) => A41_CHILDREN[n].file)).size).toBe(6);
    expect(A41_CHILD_NAMES.map((n) => (A41_CHILDREN[n] as ChildSpec).mode).filter((m) => m !== undefined)).toEqual(['hit-test', 'wda-cold', 'auto-tap', 'cadence']);
    expect(CADENCES[0]).toBe(300);
  });
});

describe('summaryLines — the short summary', () => {
  const sp = (median: number, n = 7) => ({ n, median, min: median - 1, max: median + 1 });
  const pass = (pollMs: number, judged: number): CadencePass => ({ pollMs, settles: { M1a: 4, M1b: 50, M2: 30 }, wrong: [], moving: 40, censored: 5, judged, wrongJudged: 0 });
  const full: A41Report = {
    meta: { commit: 'abcdef1234', device: 'averi-lab iPhone 17 simulator, iOS 27.0', generated: '2026-11-12T10:00:00.000Z' },
    missing: [],
    table: [
      { scenario: 'tap', idb: { warm: sp(474), first: 900, failed: 0 }, wda: { warm: sp(520), first: 9000, failed: 0 } },
      { scenario: 'fill', idb: { failed: 2 }, wda: { warm: sp(1700), failed: 0 } },
    ],
    wdaCold: { coldRead: sp(6000, 5), warmRead: sp(400, 5), failed: 0 },
    autoTap: {
      launch: sp(1200, 5), relaunch: sp(800, 5), firstCold: sp(7000, 5), firstWdaUp: sp(900, 5), warmCatalog: sp(600, 5), warm: sp(500, 10),
      firstWaited: sp(1000, 5), waitedGap: sp(4010, 5),
      firstTaps: { ok: 5, n: 5 }, waitedTaps: { ok: 4, n: 5 }, foreground: { ok: 5, n: 5, clearState: 1, seen: [] },
      fellBack: 0, paidPush: 0, catalogUnsettled: 0, failed: 0,
    },
    cadence: { trials: 60, moving: { M1a: 20, M1b: 20, M2: 20 }, passes: [pass(300, 35), pass(500, 33)], judgement: { verdict: 'unproven', why: 'w' } },
    hitTest: {
      rows: [],
      counts: { falseTapped: 15, sound: 12, unsound: 3, unprovenFalse: 0, controls: 10, open: 9, falseRefusal: 1, unprovenControls: 0 },
      cli: sp(180, 75),
      helper: sp(30, 75),
    },
  };
  it('the table with n, launch_app, the A41b acceptance numbers, the cadence and the A41c counts', () => {
    const lines = summaryLines(full);
    expect(lines).toContain('tap | idb 474 ms (n 7, 473–475; first 900) | wda 520 ms (n 7, 519–521; first 9000) | wda−idb +46 ms');
    expect(lines).toContain('fill | idb — (2 failed) | wda 1700 ms (n 7, 1699–1701) | wda−idb —');
    expect(lines).toContain('auto, launch_app: 1200 ms (n 5, 1199–1201) (WDA stopped); relaunch: 800 ms (n 5, 799–801) (WDA up)');
    expect(lines).toContain(
      "WDA tap median within 100 ms of idb's, one-sided (WDA no more than 100 ms slower; faster always passes): yes (wda−idb +46 ms)",
    );
    // (a): 7000 − 600 = 6400 against max(0, 6000 − 1200) + 500 = 5300.
    expect(lines).toContain('first tap after launch_app (a, at once; information, not judged): first − warm 7000 − 600 = 6400 ms; WDA cold start 6000 ms against launch_app 1200 ms; first tap ok 5/5');
    expect(lines).toContain('first tap after launch_app (b, ≥ 3.5 s after it started) ≤ the same tap warm + 500 ms: yes (1000 vs 600 + 500); first tap ok 4/5');
    expect(lines).toContain('foreground after launch ok 5/5 (1 clearState; n ≥ 5 with one: yes)');
    expect(lines).toContain('auto, the same first tap 4010 ms (n 5, 4009–4011) after launch_app started (no read before it): 1000 ms (n 5, 999–1001)');
    expect(lines).toContain('A41b acceptance');
    expect(lines).toContain(
      'at 300 ms: 0 wrong in 35 moving, uncensored settles over 60 trials — of 84 settles (M1a 4, M1b 50, M2 30), 40 of moving ids, 5 censored (< 500 ms of reads after), 0 wrong in all',
    );
    expect(lines).toContain("auto, WDA's bring-up in the first tap (first − first with WDA up): +6100 ms");
    expect(lines).toContain('cadence: unproven — w');
    expect(lines).toContain('false-Tapped targets: 15 — sound 12, unsound 3, unproven 0');
    expect(lines).toContain('controls (truly open): 10 — open 9, false refusals 1, unproven 0');
    expect(lines).toContain('describe-point latency: CLI 180 ms (n 75), helper 30 ms (n 75)');
    expect(lines.some((l) => l.startsWith('auto, left out'))).toBe(false);
    expect(lines.some((l) => l.startsWith('WDA was built'))).toBe(false);
  });
  it('"within 100 ms" is one way: WDA 150 ms faster passes, 101 ms slower does not', () => {
    const table = (wda: number) => [{ scenario: 'tap', idb: { warm: sp(700), failed: 0 }, wda: { warm: sp(wda), failed: 0 } }];
    const line = (wda: number) => summaryLines({ ...full, table: table(wda) }).find((l) => l.startsWith('WDA tap median'));
    expect(line(550)).toMatch(/: yes \(wda−idb −150 ms\)$/);
    expect(line(801)).toMatch(/: no \(wda−idb \+101 ms\)$/);
  });
  it('an auto step that fell back to idb makes the first-tap acceptance unproven; what was left out is said', () => {
    const lines = summaryLines({ ...full, autoTap: { ...full.autoTap!, fellBack: 2, paidPush: 2, catalogUnsettled: 1, failed: 1 } });
    // Only leg (b) judges; leg (a) is information and carries no verdict.
    expect(lines.filter((l) => l.includes("unproven (2 auto steps fell back to idb: not WDA's taps)"))).toHaveLength(1);
    expect(lines.find((l) => l.includes('(b, '))).toContain("unproven (2 auto steps fell back to idb: not WDA's taps)");
    expect(lines).toContain('auto, left out: 2 fell back to idb; 2 warm taps paid the push; 1 warm catalog taps on an unsettled catalog; 1 sessions with a failed step');
  });
  it('leg (a) is information only: its numbers, a dash for a part not measured, never a yes or no', () => {
    const a = (r: A41Report) => summaryLines(r).find((l) => l.includes('(a, at once'));
    expect(a(full)).not.toMatch(/: (yes|no|unproven) /);
    expect(a({ ...full, wdaCold: undefined, autoTap: { ...full.autoTap!, firstCold: undefined } })).toBe(
      'first tap after launch_app (a, at once; information, not judged): first − warm — − 600 = — ms; WDA cold start — ms against launch_app 1200 ms; first tap ok 5/5',
    );
  });
  it('leg (b) at warm + 500 exactly passes; the foreground says what was read instead, and needs n ≥ 5 with a clearState', () => {
    const b = (w: number) => summaryLines({ ...full, autoTap: { ...full.autoTap!, firstWaited: sp(w, 5) } }).find((l) => l.includes('(b, '));
    expect(b(1100)).toMatch(/: yes \(1100 vs 600 \+ 500\)/);
    expect(b(1101)).toMatch(/: no \(1101 vs 600 \+ 500\)/);
    expect(summaryLines({ ...full, autoTap: { ...full.autoTap!, firstWaited: undefined } }).find((l) => l.includes('(b, '))).toMatch(/: not measured; first tap ok 4\/5$/);
    expect(summaryLines({ ...full, autoTap: { ...full.autoTap!, waitedGap: undefined } }).find((l) => l.includes('(b, '))).toMatch(/: not measured;/);
    // A gap under 3.5 s did not give WDA's start its time: unproven, whatever the tap took.
    const gapped = (min: number) =>
      summaryLines({ ...full, autoTap: { ...full.autoTap!, waitedGap: { n: 5, median: 4000, min, max: 4100 } } }).find((l) => l.includes('(b, '));
    expect(gapped(3499)).toMatch(/: unproven \(a tap 3499 ms after launch_app started, under 3500\); first tap ok 4\/5$/);
    expect(gapped(3500)).toMatch(/: yes \(1000 vs 600 \+ 500\)/);
    const front = (f: NonNullable<A41Report['autoTap']>['foreground']) =>
      summaryLines({ ...full, autoTap: { ...full.autoTap!, foreground: f } }).find((l) => l.startsWith('foreground after launch'));
    expect(front({ ok: 4, n: 5, clearState: 1, seen: ['Contacts / com.apple.MobileAddressBook'] })).toBe(
      'foreground after launch ok 4/5 (1 clearState; n ≥ 5 with one: no) — read instead: Contacts / com.apple.MobileAddressBook',
    );
    expect(front({ ok: 5, n: 5, clearState: 0, seen: [] })).toMatch(/\(0 clearState; n ≥ 5 with one: no\)$/);
    expect(front({ ok: 4, n: 4, clearState: 1, seen: [] })).toMatch(/: no\)$/);
    expect(front({ ok: 0, n: 0, clearState: 0, seen: [] })).toMatch(/: not measured\)$/);
  });
  it('a run that built WDA says so', () => {
    expect(summaryLines({ ...full, wdaBuilt: true })).toContain("WDA was built in this run: baseline-wda's first repeat and the run's length include the build");
    expect(summaryLines({ ...full, wdaBuilt: false }).some((l) => l.startsWith('WDA was built'))).toBe(false);
  });
  it('a part not measured is said as missing, never as a number', () => {
    const lines = summaryLines({ ...full, wdaCold: undefined, autoTap: undefined, cadence: undefined, hitTest: undefined, missing: ['wda-cold.json', 'cadence-trace.json'] });
    expect(lines).toContain('MISSING: wda-cold.json, cadence-trace.json');
    expect(lines).toContain('first tap after launch_app: not measured');
    expect(lines).toContain('cadence: not measured');
    expect(lines).toContain('A41c: not measured');
  });
});

describe('reportOf — the probe\'s files summed', () => {
  const ok = (ms: number, extra: Record<string, unknown> = {}) => ({ ms, ok: true, reply: 'r', ...extra });
  const base = (tree: string, tapMs: number[]) => ({
    meta: { described: 'averi-lab iPhone 17 simulator, iOS 27.0', commit: { head: 'feedface00' } },
    scenarios: [{ id: 'tap', runs: tapMs.map((wallMs, i) => ({ repeat: i + 1, status: 'ok', wallMs })) }, { id: 'tree', runs: [] }],
    tree,
  });
  const target = (kind: HitTarget['kind'], id: string): HitTarget => ({ kind, app: 'native', run: 'ios-x', cell: 'c', target: id.slice(-1), id, point: { x: 1, y: 2 }, says: '' });
  const hit = (id: string | null, type = 'Button') => ({ type, label: 'L', id, frame: null });

  it('the table, WDA cold start, the auto taps, the hit counts and latencies; meta from the files', () => {
    const r = reportOf(
      {
        baselineIdb: base('idb', [900, 400, 500, 600]),
        baselineWda: { ...base('wda', [9000, 450, 550]), meta: {} },
        wdaCold: { runs: [{ repeat: 1, cold: ok(6000), warm: ok(400) }, { repeat: 2, cold: { ms: 5, ok: false, reply: 'ERROR' }, warm: ok(300) }, { repeat: 3, error: 'select_device failed' }] },
        autoTap: {
          runs: [
            {
              repeat: 1, launch: ok(1200), firstCold: ok(7000), openSettled: true, warm: [ok(500), ok(520)], relaunch: ok(800), firstWdaUp: ok(900), catalogSettled: true, warmCatalog: ok(600),
              waitedLaunch: ok(1900), waitedGapMs: 4001, firstWaited: ok(1050),
              foreground: { clearState: true, expected: { label: 'AveriLab', bundle: 'dev.averi.lab' }, launch: ok(2500), label: 'AveriLab', bundle: 'dev.averi.lab' },
            },
            {
              repeat: 2,
              launch: ok(1000),
              firstCold: ok(8000, { fellBack: true }),
              openSettled: true,
              warm: [ok(480), { ms: 1, ok: false, reply: 'ERROR' }, ok(10, { fellBack: true })],
              firstWdaUp: ok(1000),
              catalogSettled: false,
              warmCatalog: ok(5000),
              waitedError: 'select_device failed',
              foreground: { clearState: false, expected: { label: 'AveriLab', bundle: 'dev.averi.lab' }, launch: ok(1900), label: 'Contacts', bundle: 'com.apple.MobileAddressBook' },
            },
            // The open cell never seen: its warm taps paid the push, left out.
            { repeat: 3, openSettled: false, warm: [ok(3000), ok(3100)], catalogSettled: false },
          ],
        },
        hitTest: {
          helperReady: true,
          results: [
            { target: target('false-tapped', 'lab.c.A'), cli: [{ ms: 200, named: 'other', hit: hit('lab.c.W') }], helper: [{ ms: 30, named: 'other', hit: hit(null, 'Other') }] },
            { target: target('false-tapped', 'lab.c.B'), cli: [{ ms: 100, named: 'target', hit: hit('lab.c.B') }], helper: [{ ms: 5, error: 'boom' }] },
            { target: target('control', 'lab.c.K'), cli: [{ ms: 300, named: 'target', hit: hit('lab.c.K') }], helper: [] },
            { target: target('control', 'lab.c.W'), cli: [], helper: [], skipped: 'unproven (cover not up): the lab never said ready' },
          ],
        },
      },
      ['cadence-trace.json'],
      '2026-11-12T00:00:00.000Z',
      true,
    );
    expect(r.meta).toEqual({ commit: 'feedface00', device: 'averi-lab iPhone 17 simulator, iOS 27.0', generated: '2026-11-12T00:00:00.000Z' });
    expect(r.missing).toEqual(['cadence-trace.json']);
    expect(r.wdaBuilt).toBe(true);
    expect(r.table.map((x) => x.scenario)).toEqual(['tree', 'tap', 'fill', 'scroll', 'ensure-cold', 'ensure-warm']);
    expect(r.table[1]).toEqual({ scenario: 'tap', idb: { first: 900, warm: { n: 3, median: 500, min: 400, max: 600 }, failed: 0 }, wda: { first: 9000, warm: { n: 2, median: 500, min: 450, max: 550 }, failed: 0 } });
    expect(r.table[2]).toEqual({ scenario: 'fill', idb: { failed: 0 }, wda: { failed: 0 } });
    expect(r.wdaCold).toEqual({ coldRead: { n: 1, median: 6000, min: 6000, max: 6000 }, warmRead: { n: 2, median: 350, min: 300, max: 400 }, failed: 2 });
    expect(r.autoTap).toEqual({
      launch: { n: 2, median: 1100, min: 1000, max: 1200 },
      relaunch: { n: 1, median: 800, min: 800, max: 800 },
      // The fell-back first tap (8000) and warm tap (10) are idb's: left out of WDA's spreads.
      firstCold: { n: 1, median: 7000, min: 7000, max: 7000 },
      firstWdaUp: { n: 2, median: 950, min: 900, max: 1000 },
      // Run 2's catalog was not seen settled: its 5000 is left out.
      warmCatalog: { n: 1, median: 600, min: 600, max: 600 },
      warm: { n: 3, median: 500, min: 480, max: 520 },
      firstWaited: { n: 1, median: 1050, min: 1050, max: 1050 },
      waitedGap: { n: 1, median: 4001, min: 4001, max: 4001 },
      // Run 2's fell-back first tap claimed the tap all the same: the app was in front.
      firstTaps: { ok: 2, n: 2 },
      waitedTaps: { ok: 1, n: 1 },
      foreground: { ok: 1, n: 2, clearState: 1, seen: ['Contacts / com.apple.MobileAddressBook'] },
      fellBack: 2,
      paidPush: 2,
      catalogUnsettled: 1,
      failed: 1, // run 2 (its failed warm tap and its waited leg's error) — counted once
    });
    expect(r.cadence).toBeUndefined();
    expect(r.hitTest!.counts).toEqual({ falseTapped: 2, sound: 1, unsound: 0, unprovenFalse: 1, controls: 2, open: 1, falseRefusal: 0, unprovenControls: 1 });
    expect(r.hitTest!.cli).toEqual({ n: 3, median: 200, min: 100, max: 300 });
    expect(r.hitTest!.helper).toEqual({ n: 1, median: 30, min: 30, max: 30 });
    expect(r.hitTest!.rows[0]).toEqual({ kind: 'false-tapped', id: 'lab.c.A', point: { x: 1, y: 2 }, verdict: 'sound', named: ['cli lab.c.W', 'helper Other "L"'], rules: ['other', 'other'], cliMs: 200, helperMs: 30 });
    expect(r.hitTest!.rows[1].named).toEqual(['cli lab.c.B', 'helper error: boom']);
    expect(r.hitTest!.rows[1].rules).toEqual(['target', 'error']);
    expect(r.hitTest!.rows[3]).toEqual({ kind: 'control', id: 'lab.c.W', point: { x: 1, y: 2 }, verdict: 'unproven', named: [], rules: [], skipped: 'unproven (cover not up): the lab never said ready' });
  });

  it('the cadence: trials, moving per motion, the passes, the judgement at CADENCES[0]; no build read, no wdaBuilt', () => {
    const t = (motion: string, rects: Record<string, string>): Trial => ({ motion, cell: 'c', trial: 0, trigger: [0, 1], appMoved: null, reads: [[1, 2], [2, 3]], rects });
    const trials = [t('M1', { a: '+.' }), ...Array.from({ length: 15 }, () => t('M1', { a: '++' }))];
    const p = (pollMs: number, wrong: string[]): CadencePass => ({ pollMs, settles: { M1: 2 }, wrong, moving: 1, censored: 0, judged: 1, wrongJudged: 0 });
    // The 500 ms pass's wrong settle does not decide; the 300's would.
    const passes = [p(500, ['M1#0 a @0']), p(300, [])];
    const r = reportOf({ cadence: { trials, passes } }, [], 'g');
    const why = '0 wrong in 1 moving, uncensored settles over 16 trials at 300 ms: under 60 judged; moving trials M1 15';
    expect(r.cadence).toEqual({ trials: 16, moving: { M1: 15 }, passes, judgement: { verdict: 'unproven', why } });
    expect('wdaBuilt' in r).toBe(false);
  });
});

describe('the foreground leg (A41b review r1): which app the first read after a launch was', () => {
  const expected = { label: 'AveriLab', bundle: 'dev.averi.lab' };
  it('snapshotRootLabel: the root\'s label from ui_snapshot\'s JSON, a note after it ignored; none for an error or no label', () => {
    const json = JSON.stringify({ role: 'container', label: 'AveriLab', children: [{ role: 'button', label: 'open', children: [] }] }, null, 2);
    expect(snapshotRootLabel(json)).toBe('AveriLab');
    expect(snapshotRootLabel(`${json}\n⚠ a note`)).toBe('AveriLab');
    expect(snapshotRootLabel(JSON.stringify({ role: 'container', label: null, children: [] }, null, 2))).toBeUndefined();
    expect(snapshotRootLabel('ERROR {\n}')).toBeUndefined();
    expect(snapshotRootLabel('no json here')).toBeUndefined();
    expect(snapshotRootLabel('{ not json\n}')).toBeUndefined();
  });
  it('foregroundOk: the lab\'s label AND bundle, and no error', () => {
    expect(foregroundOk({ clearState: false, expected, label: 'AveriLab', bundle: 'dev.averi.lab' })).toBe(true);
    expect(foregroundOk({ clearState: false, expected, label: 'AveriLab', bundle: 'com.apple.springboard' })).toBe(false);
    expect(foregroundOk({ clearState: false, expected, label: 'Contacts', bundle: 'dev.averi.lab' })).toBe(false);
    expect(foregroundOk({ clearState: false, expected, label: 'AveriLab', bundle: 'dev.averi.lab', error: 'x' })).toBe(false);
  });
  it('the waited leg starts its tap at least 3.5 s after launch_app started, the least gap it is judged on', () => {
    expect(WAITED_GAP_MIN_MS).toBe(3500);
    expect(WAITED_GAP_MS).toBeGreaterThanOrEqual(WAITED_GAP_MIN_MS);
  });
});

