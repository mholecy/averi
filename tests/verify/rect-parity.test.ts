import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import type { UiNode } from '../../src/adapters/types.js';
import {
  compareRectParity,
  evaluateRectAssert,
  formatRectParity,
  rectParityVerdict,
} from '../../src/verify/rect-parity.js';
import { inferScreenWidth } from '../../src/ui-tree/geometry.js';
import { parseLayoutContract, type LayoutContract } from '../../src/verify/layout-contract.js';

/**
 * Synthetic fixtures modeled on the 2026 card run: figma frame 393,
 * android at 1080 px (scale ~2.748), ios at 393 pt (1:1). The real bugs the
 * Python script caught — a 46-vs-24pt margin and a 1.81-vs-1.60 aspect —
 * are ported as cases below and must FAIL at 2% tolerance.
 */

const S = 1080 / 393;
const px = (v: number): number => Math.round(v * S);

const n = (partial: Partial<UiNode>): UiNode => ({
  role: 'other',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 0, height: 0 },
  children: [],
  ...partial,
});

const root = (width: number, height: number, children: UiNode[], x = 0): UiNode =>
  n({ role: 'container', rect: { x, y: 0, width, height }, children });

const leaf = (id: string, x: number, y: number, w: number, h: number): UiNode =>
  n({ identifier: id, rect: { x, y, width: w, height: h } });

const contract = (): LayoutContract => ({
  screen: 'test.screen',
  tolerance_pct: 2.0,
  figma_frame_width: 393,
  anchors: [
    { id: 'header', x: 24, y: 100, w: 345, h: 60 },
    { id: 'card', x: 24, y: 180, w: 345, h: 129 },
  ],
});

/** Pixel-perfect android tree: every anchor at the figma value scaled by 1080/393. */
const androidTree = (): UiNode =>
  root(1080, 2400, [
    leaf('header', px(24), px(100), px(345), px(60)),
    leaf('card', px(24), px(180), px(345), px(129)),
  ]);

const iosTree = (): UiNode =>
  root(393, 852, [leaf('header', 24, 100, 345, 60), leaf('card', 24, 180, 345, 129)]);

const findAnchorRect = (tree: UiNode, id: string): UiNode => {
  const hit = tree.children.find((c) => c.identifier === id);
  if (!hit) throw new Error(`fixture has no ${id}`);
  return hit;
};

describe('compareRectParity — normalization and width inference', () => {
  it('matched geometry across different screen widths passes (all deltas in % of width)', () => {
    const r = compareRectParity(contract(), { android: androidTree(), ios: iosTree() });
    expect(r.findings).toEqual([]);
    expect(r.missing).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.tolerancePct).toBe(2.0);
  });

  it('screen width comes from the widest rect in the WHOLE tree, not from id-bearing nodes', () => {
    // id-bearing nodes end at 66 + 948 = 1014 px; only the id-less root spans 1080.
    const r = compareRectParity(contract(), { android: androidTree(), ios: iosTree() });
    expect(r.widths).toEqual([
      { platform: 'android', width: 1080, reliable: true },
      { platform: 'ios', width: 393, reliable: true },
    ]);
    expect(inferScreenWidth(androidTree())).toEqual({ width: 1080, reliable: true });
  });

  it('flags a filtered tree (widest rect starts inset) as unreliable, with a warning in the output', () => {
    const filtered = root(1000, 2400, [leaf('header', px(24), px(100), px(345), px(60))], 40);
    const r = compareRectParity(
      { screen: 't', figma_frame_width: 393, anchors: [{ id: 'header', x: 24 }] },
      { android: filtered },
    );
    expect(r.widths[0].reliable).toBe(false);
    const out = formatRectParity(r);
    expect(out).toContain('CONTENT width');
    expect(out).toContain('app.ios.treeSource: wda'); // names the real remediation
  });

  it('falls back to the widest anchor w when figma_frame_width is not declared', () => {
    const c = contract();
    delete c.figma_frame_width;
    const r = compareRectParity(c, { android: androidTree(), ios: iosTree() });
    expect(r.frameWidth).toBe(345);
  });

  it('single-platform + no normalizable frame width throws instead of a vacuous pass', () => {
    // No figma_frame_width, no anchor w → frameWidth 0 → with one platform
    // NOTHING would be compared; "WITHIN TOLERANCE" would be a lie.
    const c: LayoutContract = { screen: 't', anchors: [{ id: 'header', x: 24 }] };
    expect(() => compareRectParity(c, { android: androidTree() })).toThrow(/figma_frame_width/);
  });

  it('two-platform + no frame width still compares android-vs-ios (no throw)', () => {
    const c: LayoutContract = { screen: 't', anchors: [{ id: 'pill', x: 24 }] };
    const android = root(1080, 2400, [leaf('pill', px(24), 300, px(345), px(60))]);
    const ios = root(393, 852, [leaf('pill', 44, 110, 345, 60)]); // x 11.2% vs android 6.1%
    const r = compareRectParity(c, { android, ios });
    expect(r.frameWidth).toBe(0);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ anchor: 'pill', field: 'x', comparison: 'android-vs-ios' });
  });
});

describe('compareRectParity — finding semantics', () => {
  it('a 46-vs-24pt margin FAILS at 2% tolerance (the card-run bug)', () => {
    const android = androidTree();
    findAnchorRect(android, 'card').rect.x = px(46); // 46pt margin instead of 24
    const r = compareRectParity(contract(), { android, ios: iosTree() });
    expect(r.pass).toBe(false);
    const x = r.findings.filter((f) => f.anchor === 'card' && f.field === 'x');
    expect(x.map((f) => f.comparison).sort()).toEqual(['android-vs-contract', 'android-vs-ios']);
    for (const f of x) expect(f.delta).toBeCloseTo(5.6, 1);
    expect(x[0].android).toBe(px(46)); // findings carry the measured numbers
    expect(x[0].contract).toBe(24);
  });

  it('a 1.81-vs-1.60 aspect ratio FAILS at 2% tolerance even without contract h', () => {
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors: [{ id: 'card', x: 24, w: 345 }] };
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]); // 948/524 = 1.809
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]); // 345/216 = 1.597
    const r = compareRectParity(c, { android, ios });
    const aspect = r.findings.find((f) => f.field === 'aspect');
    expect(aspect).toBeDefined();
    expect(aspect).toMatchObject({ anchor: 'card', comparison: 'android-vs-ios' });
    expect(aspect?.delta).toBeCloseTo(11.7, 1);
    expect(formatRectParity(r)).toContain('<-- ASPECT');
  });

  // ---- the 2026-08-27 finding: the derived aspect row fired on correct code,
  // and omitting `h` — the only tool a contract author had — did not reach it.

  it('aspect: false silences the shape row for an anchor whose height the platforms derive differently', () => {
    // Measured: Android's a11y touch-target floor inflates the section header's
    // node box to 48dp; iOS pads out and back in, so its box stays 44pt. The
    // contract omits `h` for that reason, and the aspect row failed anyway at
    // +10.73% against code that was correct.
    const anchors = [{ id: 'section', x: 24, w: 345, aspect: false }];
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors };
    const android = root(1080, 2400, [leaf('section', px(24), 300, px(345), 132)]); // 948/132 = 7.182
    const ios = root(402, 852, [leaf('section', 24, 110, 354, 44)]); //             354/44  = 8.045
    const r = compareRectParity(c, { android, ios });
    expect(r.findings.filter((f) => f.field === 'aspect')).toEqual([]);
    // The ratios are still measured and printed — "diff the numbers, not the
    // verdict" — but there is no spread: incomparable ratios have no distance.
    const aspectRow = r.entries.find((e) => e.kind === 'field' && e.field === 'aspect');
    expect(aspectRow).toMatchObject({ android: 948 / 132, ios: 354 / 44, aspectOptOut: true });
    expect(aspectRow?.kind === 'field' && aspectRow.dAi).toBeUndefined();
    const out = formatRectParity(r);
    expect(out).toContain('7.182');
    expect(out).toContain('8.045');
    expect(out).toContain('opt-out');
    expect(out).not.toContain('<-- ASPECT');
  });

  it('THE NEGATIVE HALF: omitting h alone does NOT silence it — the 1.81-vs-1.60 bug still fails', () => {
    // The distinction the opt-out exists to draw. Omission means "I did not pin
    // this side"; only `aspect: false` means "I diagnosed it as incomparable".
    // A fix that conflated them would disable the check rather than narrow it.
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors: [{ id: 'card', x: 24, w: 345 }] };
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]);
    const r = compareRectParity(c, { android, ios });
    expect(r.findings.find((f) => f.field === 'aspect')?.delta).toBeCloseTo(11.7, 1);
  });

  it('aspect: true is not an opt-out — only an explicit false is', () => {
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      anchors: [{ id: 'card', x: 24, w: 345, aspect: true }],
    };
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]);
    expect(compareRectParity(c, { android, ios }).findings.some((f) => f.field === 'aspect')).toBe(true);
  });

  it('tolerance_aspect_pct is a SEPARATE threshold and defaults to tolerance_pct', () => {
    const anchors = [{ id: 'card', x: 24, w: 345 }];
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]); // 11.71% spread
    // Default: unchanged behaviour, the shape bug still fails at 2%.
    const dflt: LayoutContract = { screen: 't', figma_frame_width: 393, anchors };
    expect(compareRectParity(dflt, { android, ios }).findings.some((f) => f.field === 'aspect')).toBe(true);
    // Widening only the aspect knob leaves the width tolerance where it was.
    const loose: LayoutContract = { ...dflt, tolerance_aspect_pct: 15 };
    const r = compareRectParity(loose, { android, ios });
    expect(r.findings.some((f) => f.field === 'aspect')).toBe(false);
    expect(r.tolerancePct).toBe(2.0);
  });

  it('PRINTS the threshold it ENFORCED — a differing aspect tolerance appears everywhere', () => {
    // The file's own rule: the number a description prints is always the number
    // the check enforces. Once aspect can be judged at a different threshold, a
    // single printed number is a lie about one of the two.
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 15,
      anchors: [{ id: 'card', x: 24, w: 345 }],
    };
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]); // 11.71% spread, under 15
    const r = compareRectParity(c, { android, ios });
    expect(r.aspectTolerancePct).toBe(15);
    expect(formatRectParity(r)).toContain('aspect: 15.00% ratio spread');
    // An aspect-only finding quotes the aspect threshold, never the width one.
    // The measured section-header shape: x, w and h all within tolerance, only
    // the derived ratio over — so a headline naming 2.00% would name a
    // threshold that judged nothing here.
    const only: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 5,
      anchors: [{ id: 'section', x: 24, w: 345 }],
    };
    const a2 = root(1080, 2400, [leaf('section', px(24), 300, 948, 132)]);
    const i2 = root(402, 852, [leaf('section', 24, 110, 354, 44)]); // 10.73% spread
    const aspectOnly = compareRectParity(only, { android: a2, ios: i2 });
    expect(aspectOnly.findings.map((f) => f.field)).toEqual(['aspect']);
    expect(rectParityVerdict(aspectOnly)).toContain('OVER 5.00% ratio spread');
    expect(rectParityVerdict(aspectOnly)).not.toContain('2.00%');
    expect(formatRectParity(aspectOnly)).toContain('OVER 5.00% ratio spread');
  });

  it('names BOTH thresholds when findings were judged at each', () => {
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 5,
      anchors: [{ id: 'card', x: 24, w: 345 }],
    };
    const android = root(1080, 2400, [leaf('card', px(46), 300, px(345), 524)]); // x is 5.6% off
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]); // aspect 11.71% off
    const v = rectParityVerdict(compareRectParity(c, { android, ios }));
    expect(v).toContain('2.00% of width / 5.00% ratio spread');
  });

  it('stays on ONE number while the two tolerances agree — existing reports are unchanged', () => {
    const c = contract();
    const r = compareRectParity(c, { android: androidTree(), ios: iosTree() });
    expect(r.aspectTolerancePct).toBe(r.tolerancePct);
    expect(formatRectParity(r)).not.toContain('ratio spread');
    expect(rectParityVerdict(r)).toContain('WITHIN TOLERANCE (2.00%)');
  });

  it('does NOT announce an aspect tolerance that judged nothing', () => {
    // A threshold quoted in a report is a claim that it was applied. Every
    // anchor here is opted out, so the aspect tolerance is vacuous — naming it
    // would describe a check that did not happen.
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 15,
      anchors: [{ id: 'section', x: 24, w: 345, aspect: false }],
    };
    const android = root(1080, 2400, [leaf('section', px(24), 300, 948, 132)]);
    const ios = root(402, 852, [leaf('section', 24, 110, 354, 44)]);
    const r = compareRectParity(c, { android, ios });
    expect(r.pass).toBe(true);
    expect(formatRectParity(r)).not.toContain('15.00%');
    expect(rectParityVerdict(r)).toBe('rect parity: WITHIN TOLERANCE (2.00%) on all 1 anchor(s).');
  });

  it('qualifies the width number once a second threshold is in play', () => {
    // With two thresholds live, a bare "OVER 2.00%" leaves the reader to guess
    // which quantity it bounds.
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 15,
      anchors: [{ id: 'card', x: 24, w: 345 }],
    };
    const android = root(1080, 2400, [leaf('card', px(46), 300, px(345), 524)]); // x off by 5.6%
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 524 / (1080 / 393))]); // aspect matches
    const v = rectParityVerdict(compareRectParity(c, { android, ios }));
    // The aspect row WAS judged here (it simply passed), so two thresholds are
    // live and the width number says which quantity it bounds.
    expect(v).toContain('OVER 2.00% of width');
    expect(v).not.toContain('ratio spread');
  });

  it('rejects a tolerance_aspect_pct that is not a positive number, naming the field', () => {
    const c: LayoutContract = {
      screen: 't',
      figma_frame_width: 393,
      tolerance_aspect_pct: 0,
      anchors: [{ id: 'card', x: 24, w: 345 }],
    };
    const android = root(1080, 2400, [leaf('card', px(24), 300, px(345), 524)]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 216)]);
    expect(() => compareRectParity(c, { android, ios })).toThrow(/tolerance_aspect_pct/);
  });

  it('absolute y is NEVER a finding source — both anchors shifted 10% stay a pass', () => {
    const android = androidTree();
    for (const id of ['header', 'card']) findAnchorRect(android, id).rect.y += 108; // 10% of 1080
    const r = compareRectParity(contract(), { android, ios: iosTree() });
    expect(r.pass).toBe(true);
    expect(r.findings).toEqual([]);
    // ...but y is still measured and shown in the rows:
    const yRow = r.entries.find((e) => e.kind === 'field' && e.anchor === 'header' && e.field === 'y');
    expect(yRow?.kind === 'field' && yRow.dAc).toBeCloseTo(10.0, 1);
  });

  it('vertical position IS judged via gap-to-previous — one anchor shifted 5% is a gap finding', () => {
    const android = androidTree();
    findAnchorRect(android, 'card').rect.y += 54; // 5% of 1080
    const r = compareRectParity(contract(), { android, ios: iosTree() });
    expect(r.pass).toBe(false);
    expect(r.findings.some((f) => f.field === 'y')).toBe(false);
    const gaps = r.findings.filter((f) => f.field === 'gap');
    expect(gaps.map((f) => f.comparison).sort()).toEqual(['android-vs-contract', 'android-vs-ios']);
    for (const f of gaps) {
      expect(f.anchor).toBe('header -> card');
      expect(f.delta).toBeCloseTo(5.0, 1);
    }
  });

  it('omitted contract fields are compared platform-to-platform only', () => {
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors: [{ id: 'pill' }] };
    const android = root(1080, 2400, [leaf('pill', px(24), 300, px(345), px(60))]);
    const ios = root(393, 852, [leaf('pill', 44, 110, 345, 60)]); // x 11.2% vs android 6.1%
    const r = compareRectParity(c, { android, ios });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ anchor: 'pill', field: 'x', comparison: 'android-vs-ios' });
    expect(r.findings[0].contract).toBeUndefined();
    expect(r.findings.some((f) => f.comparison.includes('contract'))).toBe(false);
  });

  it('skips the aspect comparison when either ratio is degenerate (zero width or height)', () => {
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors: [{ id: 'divider' }] };
    const android = root(1080, 2400, [leaf('divider', px(24), 300, 0, px(60))]); // zero width → ratio 0
    const ios = root(393, 852, [leaf('divider', 24, 110, 345, 60)]);
    const r = compareRectParity(c, { android, ios });
    expect(r.entries.some((e) => e.kind === 'field' && e.field === 'aspect')).toBe(false);
    expect(r.findings.every((f) => Number.isFinite(f.delta))).toBe(true);
  });

  it('respects contract tolerance_pct default (2.0) and the option override', () => {
    const c = contract();
    delete c.tolerance_pct;
    const android = androidTree();
    findAnchorRect(android, 'card').rect.x = px(46);
    expect(compareRectParity(c, { android, ios: iosTree() }).tolerancePct).toBe(2.0);
    const loose = compareRectParity(c, { android, ios: iosTree() }, { tolerancePct: 10 });
    expect(loose.pass).toBe(true); // 5.6% < 10%
  });
});

describe('compareRectParity — missing anchors and duplicates', () => {
  const threeAnchorContract = (): LayoutContract => ({
    screen: 't',
    figma_frame_width: 393,
    anchors: [
      { id: 'a', x: 24, y: 100, w: 345, h: 60 },
      { id: 'b', x: 24, y: 180, w: 345, h: 60 },
      { id: 'c', x: 24, y: 560, w: 345, h: 60 },
    ],
  });

  it('a MISSING anchor fails the run separately and RESETS the gap chain', () => {
    const android = root(1080, 2400, [
      leaf('a', px(24), px(100), px(345), px(60)),
      leaf('b', px(24), px(180), px(345), px(60)),
      leaf('c', px(24), px(560) + 54, px(345), px(60)), // 5% off — would be a gap finding without the reset
    ]);
    const ios = root(393, 852, [leaf('a', 24, 100, 345, 60), leaf('c', 24, 560, 345, 60)]); // no b
    const r = compareRectParity(threeAnchorContract(), { android, ios });
    expect(r.missing).toEqual([{ id: 'b', absentOn: ['ios'] }]);
    expect(r.pass).toBe(false);
    expect(r.findings).toEqual([]); // missing is a failure but NOT a parity delta
    expect(r.entries.filter((e) => e.kind === 'field' && e.field === 'gap')).toEqual([]);
    const out = formatRectParity(r);
    expect(out).toContain('MISSING on ios');
    expect(out).toContain('MISSING ANCHORS — these are not parity findings yet');
    expect(out).toContain('accessibility.md §2'); // the three-cause explanation
  });

  it('first occurrence of a duplicated id wins', () => {
    const c: LayoutContract = { screen: 't', figma_frame_width: 393, anchors: [{ id: 'card', x: 24, w: 345 }] };
    const android = root(1080, 2400, [
      leaf('card', px(24), 300, px(345), px(60)),
      leaf('card', 500, 900, 100, 100), // garbage duplicate must be ignored
    ]);
    const ios = root(393, 852, [leaf('card', 24, 110, 345, 60)]);
    expect(compareRectParity(c, { android, ios }).pass).toBe(true);
  });
});

describe('compareRectParity — single-platform mode', () => {
  it('compares platform-vs-contract only; anchors with no contract fields are skipped with a note', () => {
    const c = contract();
    c.anchors.push({ id: 'footer' });
    const android = androidTree();
    android.children.push(leaf('footer', 0, 2200, 1080, 100));
    const r = compareRectParity(c, { android });
    expect(r.platforms).toEqual(['android']);
    expect(r.pass).toBe(true);
    expect(r.skipped).toEqual(['footer']);
    expect(r.entries.some((e) => e.kind === 'skipped' && e.anchor === 'footer')).toBe(true);
    expect(r.entries.some((e) => e.kind === 'field' && e.field === 'aspect')).toBe(false);
    const out = formatRectParity(r);
    expect(out).toContain('a-vs-c');
    expect(out).not.toContain('i-vs-c');
    expect(out).toContain('skipped — no contract fields');
    // The verdict must not count skipped anchors as compared:
    expect(rectParityVerdict(r)).toBe('rect parity: WITHIN TOLERANCE (2.00%) on 2 anchor(s) (1 skipped).');
  });

  it('single-platform findings never claim a cross-platform comparison', () => {
    const android = androidTree();
    findAnchorRect(android, 'card').rect.x = px(46);
    const r = compareRectParity(contract(), { android });
    expect(r.pass).toBe(false);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ anchor: 'card', field: 'x', comparison: 'android-vs-contract' });
  });
});

describe('formatRectParity / rectParityVerdict', () => {
  it('renders the fixed-width table with gap^ and aspect rows and a pass verdict', () => {
    const r = compareRectParity(contract(), { android: androidTree(), ios: iosTree() });
    const out = formatRectParity(r);
    expect(out).toContain('screen: test.screen   tolerance: 2.00% of screen width');
    expect(out).toContain('widths: android 1080   ios 393   figma frame 393');
    expect(out).toMatch(/anchor\s+field\s+figma\s+android\s+ios\s+a-vs-c\s+i-vs-c\s+a-vs-i/);
    expect(out).toContain('gap^');
    expect(out).toContain('aspect');
    expect(out).toContain('rect parity: WITHIN TOLERANCE (2.00%) on all 2 anchor(s).');
    expect(rectParityVerdict(r)).toBe('rect parity: WITHIN TOLERANCE (2.00%) on all 2 anchor(s).');
  });

  it('renders findings with their numbers and the dispatch-then-re-measure close', () => {
    const android = androidTree();
    findAnchorRect(android, 'card').rect.x = px(46);
    const r = compareRectParity(contract(), { android, ios: iosTree() });
    const out = formatRectParity(r);
    expect(out).toContain('2 DELTA(S) OVER 2.00% — each is a code-fix finding carrying its numbers:');
    expect(out).toMatch(/card x: android-vs-contract \+5\.5\d% of width \(android 126\.0, ios 24\.0, contract 24\)/);
    expect(out).toContain('Dispatch these to the implementers verbatim, then RE-MEASURE');
    expect(rectParityVerdict(r)).toBe('rect parity: 2 DELTA(S) OVER 2.00%');
  });

  it('counts missing anchors in the verdict', () => {
    const ios = iosTree();
    ios.children.pop(); // drop card
    const r = compareRectParity(contract(), { android: androidTree(), ios });
    expect(rectParityVerdict(r)).toBe('rect parity: 1 MISSING anchor(s)');
  });
});

describe('parseLayoutContract', () => {
  it('accepts the documented format and carries per-anchor fields geometry never reads (bg, sample) plus unknown ones (_note)', () => {
    const parsed = parseLayoutContract(
      JSON.stringify({
        _comment: 'x',
        screen: 's',
        figma_frame_width: 393,
        tolerance_pct: 2.0,
        anchors: [{ id: 'a', x: 24, w: 345, bg: '#fff', bg_dark: '#000', sample: [1, 2], _note: 'n' }],
      }),
    );
    expect(parsed.anchors[0]).toMatchObject({ id: 'a', x: 24, w: 345 });
  });

  it('rejects a contract without anchors, an anchor without id, and invalid JSON — naming the source', () => {
    expect(() => parseLayoutContract('{"screen":"s","anchors":[]}', 'c.json')).toThrow(/c\.json/);
    expect(() => parseLayoutContract('{"anchors":[{"x":1}]}')).toThrow(/id/);
    expect(() => parseLayoutContract('not json', 'c.json')).toThrow(/c\.json: not valid JSON/);
  });
});

describe('evaluateRectAssert (the `rect` assert primitive)', () => {
  it('passes on matching geometry and reports every delta as a number', () => {
    const tree = androidTree();
    const { pass, detail } = evaluateRectAssert(
      findAnchorRect(tree, 'card').rect,
      { x: 24, y: 180, w: 345, h: 129, frameWidth: 393 },
      tree,
    );
    expect(pass).toBe(true);
    expect(detail).toMatch(/x 66\.0 vs contract 24 → Δ[+-]0\.0\d%/);
    expect(detail).toContain('screen width 1080');
  });

  it('fails on an over-tolerance w/h and marks the offending field OVER', () => {
    const tree = androidTree();
    const { pass, detail } = evaluateRectAssert(
      findAnchorRect(tree, 'card').rect,
      { h: 100, frameWidth: 393 }, // measured 32.9% vs 25.4% → +7.4%
      tree,
    );
    expect(pass).toBe(false);
    expect(detail).toMatch(/h .* OVER/);
  });

  it('y is measured and reported but never fails', () => {
    const tree = androidTree();
    const { pass, detail } = evaluateRectAssert(
      findAnchorRect(tree, 'card').rect,
      { x: 24, y: 1, frameWidth: 393 }, // y wildly off
      tree,
    );
    expect(pass).toBe(true);
    expect(detail).toContain('(measured only, never fails)');
  });

  it('flags an unreliable (filtered) screen width in the detail', () => {
    const tree = root(1000, 2400, [leaf('card', 100, 200, 800, 100)], 40);
    const { detail } = evaluateRectAssert(
      findAnchorRect(tree, 'card').rect,
      { x: 24, frameWidth: 393 },
      tree,
    );
    expect(detail).toContain('UNRELIABLE');
  });

  it('fails closed when the screen width cannot be inferred (all-zero rects, the idb 0x0 root)', () => {
    const tree = n({ children: [leaf('card', 0, 0, 0, 0)] }); // every rect 0-sized
    const { pass, detail } = evaluateRectAssert(
      findAnchorRect(tree, 'card').rect,
      { x: 24, frameWidth: 393 },
      tree,
    );
    expect(pass).toBe(false);
    expect(detail).toContain('screen width could not be inferred');
    expect(detail).not.toContain('NaN'); // never a vacuous ΔNaN% pass
  });
});

/**
 * Rect parity keeps deriving its denominator from the TREE — `% of screen
 * width` is compared against a Figma FRAME, i.e. the app's canvas, which under
 * split view is the window and not the device screen
 * (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md). But it
 * shares `inferScreenWidth` with the png scale, so the geometry hardening
 * moved its numbers, and review 2026-08-27 rightly asked for that in a test
 * rather than in prose: on an iOS sheet the width was 804 with an UNRELIABLE
 * banner, and it is now the window's own 402.
 */
describe('rect parity on the iOS filter-sheet shape', () => {
  it('normalizes by the window (402), not by the scrims\' extent (804)', async () => {
    const tree = parseWdaSourceValue(
      JSON.parse(await readFile(new URL('../fixtures/wda-source-filter-sheet.json', import.meta.url), 'utf8')),
    );
    expect(inferScreenWidth(tree)).toEqual({ width: 402, reliable: true });

    // apply_button x=208 of a 402pt screen is 51.7%; against 804 it read 25.9%
    // and a contract authored at ~52% would have hard-FAILED on a correct app.
    const { pass, detail } = evaluateRectAssert(
      { x: 208, y: 791, width: 176, height: 44 },
      { x: 208, w: 176, frameWidth: 402 },
      tree,
    );
    expect(pass).toBe(true);
    expect(detail).toContain('screen width 402');
    expect(detail).not.toContain('UNRELIABLE');
  });
});
