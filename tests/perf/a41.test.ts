import { describe, expect, it } from 'vitest';
import {
  baselineCell,
  cadenceJudgement,
  classesOf,
  encodeRects,
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
    expect(t[0]).toEqual({ kind: 'false-tapped', app: 'native', cell: 'blur-menu', target: 'A', id: 'lab.blur-menu.A', point: { x: 201, y: 142 }, says: 'says A' });
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

  const t = (kind: HitTarget['kind']): HitTarget => ({ kind, app: 'native', cell: 'c', target: 'A', id: 'lab.c.A', point: { x: 1, y: 2 }, says: '' });
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

describe('cadenceJudgement — shorten WDA\'s settle to 300 only on 0 wrong settles, every motion seen moving ≥ 15 times', () => {
  const trials = (perMotion: Record<string, number>, moved = true) => Object.entries(perMotion).flatMap(([motion, n]) => Array.from({ length: n }, () => ({ motion, moved })));
  const at300 = (wrong: string[], settles = 10) => ({ pollMs: 300, settles: { M1a: settles }, wrong });
  it('shorten: 0 wrong, every motion moving ≥ 15', () => {
    expect(cadenceJudgement({ trials: trials({ M1a: 20, M2: 15 }), at300: at300([]) })).toEqual({ verdict: 'shorten', why: '0 wrong settles in 10 at 300 ms; moving trials M1a 20, M2 15' });
  });
  it('keep: a wrong settle at 300', () => {
    expect(cadenceJudgement({ trials: trials({ M1a: 20 }), at300: at300(['M1a#3 lab.x @2']) }).verdict).toBe('keep');
  });
  it('unproven: a motion seen moving under 15 times, or no settle at all', () => {
    const few = [...trials({ M1a: 20 }), ...trials({ M2: 14 }), ...trials({ M2: 6 }, false)];
    expect(cadenceJudgement({ trials: few, at300: at300([]) })).toEqual({ verdict: 'unproven', why: 'a motion seen moving fewer than 15 times: M1a 20, M2 14' });
    expect(cadenceJudgement({ trials: trials({ M1a: 20 }), at300: at300([], 0) }).verdict).toBe('unproven');
    expect(cadenceJudgement({ trials: [], at300: at300([]) }).verdict).toBe('unproven');
  });
});

describe('summaryLines — the short summary', () => {
  const sp = (median: number, n = 7) => ({ n, median, min: median - 1, max: median + 1 });
  const full: A41Report = {
    meta: { commit: 'abcdef1234', device: 'averi-lab iPhone 17 simulator, iOS 27.0', generated: '2026-11-12T10:00:00.000Z' },
    missing: [],
    table: [
      { scenario: 'tap', idb: { warm: sp(474), first: 900, failed: 0 }, wda: { warm: sp(520), first: 9000, failed: 0 } },
      { scenario: 'fill', idb: { failed: 2 }, wda: { warm: sp(1700), failed: 0 } },
    ],
    wdaCold: { coldRead: sp(6000, 5), warmRead: sp(400, 5), failed: 0 },
    autoTap: { firstCold: sp(7000, 5), firstWdaUp: sp(900, 5), warm: sp(500, 10), fellBack: 0, failed: 0 },
    cadence: { trials: 60, moving: { M1a: 20, M1b: 20, M2: 20 }, passes: [{ pollMs: 300, settles: { M1a: 4, M1b: 50, M2: 30 }, wrong: [] }, { pollMs: 500, settles: { M1a: 3, M1b: 50, M2: 30 }, wrong: [] }], judgement: { verdict: 'shorten', why: 'w' } },
    hitTest: {
      rows: [],
      counts: { falseTapped: 15, sound: 12, unsound: 3, unprovenFalse: 0, controls: 10, open: 9, falseRefusal: 1, unprovenControls: 0 },
      cli: sp(180, 75),
      helper: sp(30, 75),
    },
  };
  it('the table with n, the A41b acceptance numbers, the cadence and the A41c counts', () => {
    const lines = summaryLines(full);
    expect(lines).toContain('tap | idb 474 ms (n 7, 473–475; first 900) | wda 520 ms (n 7, 519–521; first 9000) | wda−idb +46 ms');
    expect(lines).toContain('fill | idb — (2 failed) | wda 1700 ms (n 7, 1699–1701) | wda−idb —');
    expect(lines).toContain('WDA tap median within 100 ms of idb: yes (+46 ms)');
    expect(lines).toContain('first tap after launch_app ≤ warm tap + 500 ms: no (7000 vs 500 + 500)');
    expect(lines).toContain('wrong settles at 300 ms: 0 in 84 settles (M1a 4, M1b 50, M2 30)');
    expect(lines).toContain('cadence: shorten — w');
    expect(lines).toContain('false-Tapped targets: 15 — sound 12, unsound 3, unproven 0');
    expect(lines).toContain('controls (truly open): 10 — open 9, false refusals 1, unproven 0');
    expect(lines).toContain('describe-point latency: CLI 180 ms (n 75), helper 30 ms (n 75)');
  });
  it('"within 100 ms" is either way: WDA 150 ms faster is not within', () => {
    const table = [{ scenario: 'tap', idb: { warm: sp(700), failed: 0 }, wda: { warm: sp(550), failed: 0 } }];
    expect(summaryLines({ ...full, table })).toContain('WDA tap median within 100 ms of idb: no (−150 ms)');
  });
  it('a part not measured is said as missing, never as a number', () => {
    const lines = summaryLines({ ...full, wdaCold: undefined, autoTap: undefined, cadence: undefined, hitTest: undefined, missing: ['wda-cold.json', 'cadence-trace.json'] });
    expect(lines).toContain('MISSING: wda-cold.json, cadence-trace.json');
    expect(lines).toContain('first tap after launch_app ≤ warm tap + 500 ms: not measured');
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
  const target = (kind: HitTarget['kind'], id: string): HitTarget => ({ kind, app: 'native', cell: 'c', target: id.slice(-1), id, point: { x: 1, y: 2 }, says: '' });
  const hit = (id: string | null, type = 'Button') => ({ type, label: 'L', id, frame: null });

  it('the table, WDA cold start, the auto taps, the hit counts and latencies; meta from the files', () => {
    const r = reportOf(
      {
        baselineIdb: base('idb', [900, 400, 500, 600]),
        baselineWda: { ...base('wda', [9000, 450, 550]), meta: {} },
        wdaCold: { runs: [{ repeat: 1, cold: ok(6000), warm: ok(400) }, { repeat: 2, cold: { ms: 5, ok: false, reply: 'ERROR' }, warm: ok(300) }, { repeat: 3, error: 'select_device failed' }] },
        autoTap: {
          runs: [
            { repeat: 1, launch: ok(1), firstCold: ok(7000), warm: [ok(500), ok(520)], relaunch: ok(1), firstWdaUp: ok(900) },
            { repeat: 2, launch: ok(1), firstCold: ok(8000, { fellBack: true }), warm: [ok(480), { ms: 1, ok: false, reply: 'ERROR' }], firstWdaUp: ok(1000) },
          ],
        },
        hitTest: {
          helperReady: true,
          results: [
            { target: target('false-tapped', 'lab.c.A'), cli: [{ ms: 200, named: 'other', hit: hit('lab.c.W') }], helper: [{ ms: 30, named: 'other', hit: hit(null, 'Other') }] },
            { target: target('false-tapped', 'lab.c.B'), cli: [{ ms: 100, named: 'target', hit: hit('lab.c.B') }], helper: [{ ms: 5, error: 'boom' }] },
            { target: target('control', 'lab.c.K'), cli: [{ ms: 300, named: 'target', hit: hit('lab.c.K') }], helper: [] },
            { target: target('control', 'lab.c.W'), cli: [], helper: [], skipped: 'not installed' },
          ],
        },
      },
      ['cadence-trace.json'],
      '2026-11-12T00:00:00.000Z',
    );
    expect(r.meta).toEqual({ commit: 'feedface00', device: 'averi-lab iPhone 17 simulator, iOS 27.0', generated: '2026-11-12T00:00:00.000Z' });
    expect(r.missing).toEqual(['cadence-trace.json']);
    expect(r.table.map((x) => x.scenario)).toEqual(['tree', 'tap', 'fill', 'scroll', 'ensure-cold', 'ensure-warm']);
    expect(r.table[1]).toEqual({ scenario: 'tap', idb: { first: 900, warm: { n: 3, median: 500, min: 400, max: 600 }, failed: 0 }, wda: { first: 9000, warm: { n: 2, median: 500, min: 450, max: 550 }, failed: 0 } });
    expect(r.table[2]).toEqual({ scenario: 'fill', idb: { failed: 0 }, wda: { failed: 0 } });
    expect(r.wdaCold).toEqual({ coldRead: { n: 1, median: 6000, min: 6000, max: 6000 }, warmRead: { n: 2, median: 350, min: 300, max: 400 }, failed: 2 });
    expect(r.autoTap).toEqual({
      firstCold: { n: 2, median: 7500, min: 7000, max: 8000 },
      firstWdaUp: { n: 2, median: 950, min: 900, max: 1000 },
      warm: { n: 3, median: 500, min: 480, max: 520 },
      fellBack: 1,
      failed: 1,
    });
    expect(r.cadence).toBeUndefined();
    expect(r.hitTest!.counts).toEqual({ falseTapped: 2, sound: 1, unsound: 0, unprovenFalse: 1, controls: 2, open: 1, falseRefusal: 0, unprovenControls: 1 });
    expect(r.hitTest!.cli).toEqual({ n: 3, median: 200, min: 100, max: 300 });
    expect(r.hitTest!.helper).toEqual({ n: 1, median: 30, min: 30, max: 30 });
    expect(r.hitTest!.rows[0]).toEqual({ kind: 'false-tapped', id: 'lab.c.A', point: { x: 1, y: 2 }, verdict: 'sound', named: ['cli lab.c.W', 'helper Other "L"'], cliMs: 200, helperMs: 30 });
    expect(r.hitTest!.rows[1].named).toEqual(['cli lab.c.B', 'helper error: boom']);
    expect(r.hitTest!.rows[3]).toEqual({ kind: 'control', id: 'lab.c.W', point: { x: 1, y: 2 }, verdict: 'unproven', named: [], skipped: 'not installed' });
  });

  it('the cadence: trials, moving per motion, the passes, the judgement at 300', () => {
    const t = (motion: string, rects: Record<string, string>): Trial => ({ motion, cell: 'c', trial: 0, trigger: [0, 1], appMoved: null, reads: [[1, 2], [2, 3]], rects });
    const trials = [t('M1', { a: '+.' }), t('M1', { a: '++' })];
    const passes = [{ pollMs: 300, settles: { M1: 2 }, wrong: [] }, { pollMs: 500, settles: { M1: 2 }, wrong: [] }];
    const r = reportOf({ cadence: { trials, passes } }, [], 'g');
    expect(r.cadence).toEqual({ trials: 2, moving: { M1: 1 }, passes, judgement: { verdict: 'unproven', why: 'a motion seen moving fewer than 15 times: M1 1' } });
  });
});
