import { describe, expect, it } from 'vitest';
import { ciede2000, deltaEHex, hexToRgb, rgbToHex, srgbToLab, type Lab } from '../../src/verify/ciede2000.js';

/**
 * Reference values from Sharma, Wu & Dalal (2005), "The CIEDE2000
 * Color-Difference Formula: Implementation Notes, Supplementary Test Data,
 * and Mathematical Observations" — the published supplementary test pairs
 * (numbers below are the paper's, cross-checked against the superrepo's
 * verified scripts/color-parity.py on 2026-08-14). The selection covers the
 * formula's branchy parts: the rotation term (blue region, h' near 275°),
 * the hue-difference wrap (|h1'-h2'| > 180°), the mean-hue wrap, and the
 * G/a'-adjustment at near-neutral chroma.
 */
const SHARMA_PAIRS: { lab1: Lab; lab2: Lab; expected: number; note: string }[] = [
  // Pair 1: blue region — rotation term Rt active.
  { lab1: [50.0, 2.6772, -79.7751], lab2: [50.0, 0.0, -82.7485], expected: 2.0425, note: 'pair 1 (rotation term)' },
  // Pair 2: blue region, larger a' spread.
  { lab1: [50.0, 3.1571, -77.2803], lab2: [50.0, 0.0, -82.7485], expected: 2.8615, note: 'pair 2 (rotation term)' },
  // Pair 7: one neutral sample (C'=0) — the dhp/hbp zero-chroma branch.
  { lab1: [50.0, 0.0, 0.0], lab2: [50.0, -1.0, 2.0], expected: 2.3669, note: 'pair 7 (zero chroma)' },
  // Pair 9 vs 11: near-opposite hues straddling the 180° wrap — the sign of
  // the tiny b component flips which dhp branch runs.
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.0009], expected: 7.1792, note: 'pair 9 (hue wrap -)' },
  { lab1: [50.0, 2.49, -0.001], lab2: [50.0, -2.49, 0.0011], expected: 7.2195, note: 'pair 11 (hue wrap +)' },
  // Pair 13/15: the mean-hue (hbp) wrap branches.
  { lab1: [50.0, -0.001, 2.49], lab2: [50.0, 0.0009, -2.49], expected: 4.8045, note: 'pair 13 (mean-hue wrap)' },
  { lab1: [50.0, -0.001, 2.49], lab2: [50.0, 0.0011, -2.49], expected: 4.7461, note: 'pair 15 (mean-hue wrap)' },
  // Pair 17: a large, unambiguous difference — magnitude sanity.
  { lab1: [50.0, 2.5, 0.0], lab2: [73.0, 25.0, -18.0], expected: 27.1492, note: 'pair 17 (large delta)' },
  // Pair 24: calibrated to exactly 1.0 — the CIEDE2000 design point.
  { lab1: [50.0, 2.5, 0.0], lab2: [50.0, 3.2592, 0.335], expected: 1.0, note: 'pair 24 (unit delta)' },
  // Pair 25: a real (green) color pair, no near-degenerate components.
  { lab1: [60.2574, -34.0099, 36.2677], lab2: [60.4626, -34.1751, 39.4387], expected: 1.2644, note: 'pair 25 (green)' },
];

describe('ciede2000 — Sharma et al. (2005) reference pairs', () => {
  for (const { lab1, lab2, expected, note } of SHARMA_PAIRS) {
    it(`${note}: dE00 = ${expected}`, () => {
      expect(ciede2000(lab1, lab2)).toBeCloseTo(expected, 3);
    });
  }

  it('is symmetric (pairs 7/8 of the test set are each other reversed)', () => {
    expect(ciede2000([50, 0, 0], [50, -1, 2])).toBeCloseTo(ciede2000([50, -1, 2], [50, 0, 0]), 10);
  });

  it('is zero for identical colors', () => {
    expect(ciede2000([83.2284, 0.7343, -1.9789], [83.2284, 0.7343, -1.9789])).toBe(0);
  });
});

describe('deltaEHex — the live-validated pairs', () => {
  it('reproduces the real 2026-08-13 bug: dE00(#CFCFD3, #FDFDFD) = 10.19', () => {
    // Measured on device 2026-08-14 (reverted own-transfer build): Android
    // card sampled #CFCFD3 (base.color4) where iOS had #FDFDFD (base.color1).
    // Over the primary a-vs-i tolerance (8), UNDER the default vs-contract
    // axis (12) — the number every tolerance in the loop is calibrated to.
    const de = deltaEHex('#CFCFD3', '#FDFDFD');
    expect(Math.abs(de - 10.19)).toBeLessThanOrEqual(0.05);
  });

  it('the fixed build measured dE 0.00 (same hex on both platforms)', () => {
    expect(deltaEHex('#FDFDFD', '#FDFDFD')).toBe(0);
  });
});

describe('color conversion primitives', () => {
  it('hexToRgb / rgbToHex round-trip, case-insensitive input, uppercase output', () => {
    expect(hexToRgb('#CFCFD3')).toEqual([0xcf, 0xcf, 0xd3]);
    expect(hexToRgb('#cfcfd3')).toEqual([0xcf, 0xcf, 0xd3]);
    expect(rgbToHex([0xcf, 0xcf, 0xd3])).toBe('#CFCFD3');
    expect(rgbToHex([0, 8, 255])).toBe('#0008FF');
  });

  it('srgbToLab: white is L=100 a=b~0, black is L=0', () => {
    const [lw, aw, bw] = srgbToLab(255, 255, 255);
    expect(lw).toBeCloseTo(100, 2);
    expect(aw).toBeCloseTo(0, 2);
    expect(bw).toBeCloseTo(0, 2);
    const [lb] = srgbToLab(0, 0, 0);
    expect(lb).toBeCloseTo(0, 4);
  });

  it('srgbToLab matches the Python port for the bug hex (#CFCFD3 → 83.2284, 0.7343, -1.9789)', () => {
    const [l, a, b] = srgbToLab(0xcf, 0xcf, 0xd3);
    expect(l).toBeCloseTo(83.2284, 3);
    expect(a).toBeCloseTo(0.7343, 3);
    expect(b).toBeCloseTo(-1.9789, 3);
  });
});
