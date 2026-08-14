import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import {
  compareColorParity,
  colorParityVerdict,
  contractHasColorAnchors,
  evaluateColorAssert,
  formatColorParity,
  normalizeHex,
  patchRegions,
  sampleDominant,
  scaledRegion,
  type ColorCapture,
} from '../../src/verify/color-parity.js';
import { parseLayoutContract, type LayoutContract } from '../../src/verify/layout-contract.js';

/**
 * Synthetic in-memory captures modeled on the live-validated 2026-08-14 run:
 * flat-color "cards" painted into pngjs buffers (the same approach as the
 * superrepo's fixture generator — nothing binary is committed). The
 * validation target is the real 2026-08-13 bug: android #CFCFD3 where iOS
 * had #FDFDFD must FAIL with dE00 = 10.19 on the a-vs-i axis.
 */

const GREY = '#CFCFD3'; // base.color4 — the bug
const WHITE = '#FDFDFD'; // base.color1 — correct
const BG = '#F1F3F5';

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

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function paint(png: PNG, x: number, y: number, w: number, h: number, hex: string, alpha = 255): void {
  const [r, g, b] = rgb(hex);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const o = (yy * png.width + xx) << 2;
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = alpha;
    }
  }
}

function img(width: number, height: number, bg = BG): PNG {
  const png = new PNG({ width, height });
  paint(png, 0, 0, width, height, bg);
  return png;
}

const contract = (json: unknown): LayoutContract => parseLayoutContract(JSON.stringify(json));

/** One card per platform, same tree geometry, per-platform fill. */
function capturePair(androidFill: string, iosFill: string): Record<'android' | 'ios', ColorCapture> {
  // android: 1:1 (root 200 px, png 200 px); ios: 2x (root 100 pt, png 200 px)
  const androidTree = root(200, 400, [leaf('card', 20, 20, 100, 60)]);
  const androidPng = img(200, 400);
  paint(androidPng, 20, 20, 100, 60, androidFill);
  const iosTree = root(100, 200, [leaf('card', 10, 10, 50, 30)]);
  const iosPng = img(200, 400);
  paint(iosPng, 20, 20, 100, 60, iosFill);
  return {
    android: { tree: androidTree, png: androidPng },
    ios: { tree: iosTree, png: iosPng },
  };
}

const cardContract = (extra: Record<string, unknown> = {}): LayoutContract =>
  contract({ screen: 'payment.form', anchors: [{ id: 'card', bg: WHITE, ...extra }] });

describe('compareColorParity — the live-validated semantics', () => {
  it('the real 2026-08-13 bug FAILS: android #CFCFD3 vs ios #FDFDFD → dE(a,i) 10.19 > 8', () => {
    const r = compareColorParity(cardContract(), capturePair(GREY, WHITE));
    expect(r.pass).toBe(false);
    const row = r.rows[0];
    expect(row.android?.hex).toBe(GREY);
    expect(row.ios?.hex).toBe(WHITE);
    expect(row.verdict).toBe('FAIL');
    expect(row.deAi).toBeDefined();
    expect(Math.abs((row.deAi as number) - 10.19)).toBeLessThanOrEqual(0.05);
    // ONE finding only: 10.19 is over the primary axis (8) but UNDER the
    // 1.5x contract axis (12) — android-vs-contract must NOT fire.
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ anchor: 'card', comparison: 'android-vs-ios', limit: 8 });
    const out = formatColorParity(r);
    expect(out).toContain('android-vs-ios dE 10.19 > 8.00 (android #CFCFD3, ios #FDFDFD)');
    expect(out).toContain('re-sampled color after the token edit'); // dispatch-then-re-measure close
    expect(colorParityVerdict(r)).toBe('color parity: 1 COLOR DELTA(S) OVER TOLERANCE');
  });

  it('the fixed build PASSES: both #FDFDFD → dE 0.00 on every axis', () => {
    const r = compareColorParity(cardContract(), capturePair(WHITE, WHITE));
    expect(r.pass).toBe(true);
    expect(r.rows[0]).toMatchObject({ verdict: 'OK', deAi: 0, deAc: 0, deIc: 0 });
    expect(colorParityVerdict(r)).toBe(
      'color parity: WITHIN TOLERANCE (dE 8.00 / contract 12.00) on all 1 anchor(s).',
    );
  });

  it('derives scale per platform from png width / tree root width (live: android 1.000, ios 3.000)', () => {
    // The measured 2026-08-14 payment-form values: android 1080 px root with
    // a 1080 px png; ios 402 pt root with a 1206 px png.
    const captures: Record<'android' | 'ios', ColorCapture> = {
      android: (() => {
        const png = img(1080, 60);
        paint(png, 100, 10, 300, 40, WHITE);
        return { tree: root(1080, 2400, [leaf('card', 100, 10, 300, 40)]), png };
      })(),
      ios: (() => {
        const png = img(1206, 180);
        paint(png, 300, 30, 900, 120, WHITE);
        return { tree: root(402, 874, [leaf('card', 100, 10, 300, 40)]), png };
      })(),
    };
    const r = compareColorParity(cardContract(), captures);
    expect(r.stats.find((s) => s.platform === 'android')?.scale).toBeCloseTo(1.0, 3);
    expect(r.stats.find((s) => s.platform === 'ios')?.scale).toBeCloseTo(3.0, 3);
    expect(r.pass).toBe(true);
    const out = formatColorParity(r);
    expect(out).toContain('android: png 1080x60  root 1080  scale 1.000');
    expect(out).toContain('ios: png 1206x180  root 402  scale 3.000');
  });

  it('dominant (mode) sampling is immune to glyph noise — a mean would be dragged dark', () => {
    const captures = capturePair(WHITE, WHITE);
    // Scatter dark "glyph" rows over ~25% of the android card.
    const png = captures.android.png as PNG;
    for (let y = 30; y < 70; y += 8) paint(png, 30, y, 80, 2, '#1A1A1A');
    const r = compareColorParity(cardContract(), captures);
    expect(r.rows[0].android?.hex).toBe(WHITE);
    expect(r.rows[0].verdict).toBe('OK');
  });

  it('sample: "patches" samples 4 corners + center and survives a busy center', () => {
    const captures = capturePair(WHITE, WHITE);
    // A center blob large enough to win a whole-region mode on android...
    paint(captures.android.png as PNG, 45, 35, 55, 32, '#3F3F50');
    const dominant = compareColorParity(cardContract(), captures);
    expect(dominant.rows[0].verdict).toBe('FAIL'); // proves the blob dominates
    // ...but the corner patches still see the card fill.
    const patches = compareColorParity(cardContract({ sample: 'patches' }), captures);
    expect(patches.rows[0].android?.hex).toBe(WHITE);
    expect(patches.rows[0].verdict).toBe('OK');
  });

  it('anchors without bg are compared platform-to-platform only', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card', sample: 'dominant' }] });
    const r = compareColorParity(c, capturePair(GREY, WHITE));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].comparison).toBe('android-vs-ios');
    expect(r.rows[0].deAc).toBeUndefined();
    expect(r.rows[0].deIc).toBeUndefined();
  });

  it('a token-named bg is SKIPPED with a note — token resolution stays in the superrepo layer', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card', bg: 'base.color1' }] });
    const r = compareColorParity(c, capturePair(WHITE, WHITE));
    expect(r.rows[0].deAc).toBeUndefined();
    expect(r.rows[0].deAi).toBe(0); // a-vs-i still runs
    expect(r.notes.some((note) => note.includes('token names resolve in the superrepo layer'))).toBe(true);
    expect(formatColorParity(r)).toContain("contract 'base.color1' is a token name");
  });

  it('#RRGGBBAA contract values drop the alpha', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card', bg: '#fdfdfd85' }] });
    const r = compareColorParity(c, capturePair(WHITE, WHITE));
    expect(r.rows[0].deAc).toBe(0);
    expect(r.pass).toBe(true);
  });

  it('a bg that is neither hex nor token is bad input — throws, never guesses', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card', bg: 'white-ish' }] });
    expect(() => compareColorParity(c, capturePair(WHITE, WHITE))).toThrow(/neither #RRGGBB/);
    const numeric = contract({ screen: 's', anchors: [{ id: 'card', bg: 16711680 }] });
    expect(() => compareColorParity(numeric, capturePair(WHITE, WHITE))).toThrow(/must be a/);
  });

  it('an unknown sample mode is bad input', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card', bg: WHITE, sample: 'average' }] });
    expect(() => compareColorParity(c, capturePair(WHITE, WHITE))).toThrow(/unknown sample mode/);
  });
});

describe('compareColorParity — themes', () => {
  it('dark theme uses bg_dark; an anchor with only bg gets vs-contract skipped with a note', () => {
    const c = contract({
      screen: 's',
      anchors: [
        { id: 'card', bg: WHITE, bg_dark: '#363644' },
        { id: 'pill', bg: WHITE },
      ],
    });
    const captures = {
      android: (() => {
        const png = img(200, 400, '#121212');
        paint(png, 20, 20, 100, 60, '#363644');
        paint(png, 20, 100, 100, 40, '#363644');
        return {
          tree: root(200, 400, [leaf('card', 20, 20, 100, 60), leaf('pill', 20, 100, 100, 40)]),
          png,
        };
      })(),
    };
    const r = compareColorParity(c, captures, { theme: 'dark', toleranceDe: 6 });
    expect(r.theme).toBe('dark');
    expect(r.rows[0]).toMatchObject({ deAc: 0, verdict: 'OK' });
    expect(r.rows[1].deAc).toBeUndefined();
    expect(r.notes.some((note) => note.includes('no bg_dark in contract'))).toBe(true);
  });
});

describe('compareColorParity — missing anchors and off-png rects', () => {
  it('an id absent from one tree is MISSING on that platform, still sampled on the other', () => {
    const captures = capturePair(WHITE, WHITE);
    (captures.ios.tree.children[0] as UiNode).identifier = 'something_else';
    const r = compareColorParity(cardContract(), captures);
    expect(r.pass).toBe(false); // missing fails the run...
    expect(r.findings).toEqual([]); // ...but is not a color finding
    expect(r.missing).toEqual([{ id: 'card', absent: { ios: 'no id in tree' } }]);
    expect(r.rows[0].android?.hex).toBe(WHITE);
    expect(r.rows[0].deAc).toBe(0); // vs-contract still ran for android
    const out = formatColorParity(r);
    expect(out).toContain('MISSING ANCHORS — these are not color findings yet');
    expect(out).toContain('accessibility.md §2');
  });

  it('a rect fully outside the png is MISSING (off-screen in this capture)', () => {
    const captures = capturePair(WHITE, WHITE);
    (captures.android.tree.children[0] as UiNode).rect = { x: 20, y: 500, width: 100, height: 60 };
    const r = compareColorParity(cardContract(), captures);
    expect(r.missing).toEqual([{ id: 'card', absent: { android: 'rect outside png (off-screen)' } }]);
    expect(formatColorParity(r)).toContain('rect outside png (off-screen)');
  });

  it('absent everywhere renders a MISSING row and nothing is compared', () => {
    const captures = capturePair(WHITE, WHITE);
    const c = contract({ screen: 's', anchors: [{ id: 'ghost', bg: WHITE }] });
    const r = compareColorParity(c, captures);
    expect(r.rows[0].verdict).toBe('MISSING');
    expect(formatColorParity(r)).toContain('ghost');
    expect(formatColorParity(r)).toContain('MISSING on android (no id in tree) + ios (no id in tree)');
    expect(colorParityVerdict(r)).toBe('color parity: 1 MISSING anchor(s)');
  });

  it('a rect clipped >40% off-png is clamped, sampled, and flagged — never silently dropped', () => {
    const captures = capturePair(WHITE, WHITE);
    // Push half the android card below the png bottom edge: 100x60 rect with
    // only 100x24 remaining on-png → 60% clipped.
    (captures.android.tree.children[0] as UiNode).rect = { x: 20, y: 376, width: 100, height: 60 };
    paint(captures.android.png as PNG, 20, 376, 100, 24, WHITE);
    const r = compareColorParity(cardContract(), captures);
    expect(r.rows[0].android?.hex).toBe(WHITE);
    expect(r.notes.some((note) => note.includes("dominant may be a neighbor's fill"))).toBe(true);
  });
});

describe('compareColorParity — single-platform runs', () => {
  it('at defaults the real bug is MISSED on the contract axis (10.19 < 12) — and the output says so', () => {
    const captures = capturePair(GREY, WHITE);
    const r = compareColorParity(cardContract(), { android: captures.android });
    expect(r.platforms).toEqual(['android']);
    expect(r.rows[0].deAc).toBeDefined();
    expect(Math.abs((r.rows[0].deAc as number) - 10.19)).toBeLessThanOrEqual(0.05);
    expect(r.pass).toBe(true); // 10.19 < 12: the documented single-platform blind spot
    const out = formatColorParity(r);
    expect(out).toContain('ios: (not provided');
    expect(out).toContain('consider tolerance_de: 6');
  });

  it('tolerance_de: 6 from the contract closes the blind spot (contract axis 9 < 10.19)', () => {
    const captures = capturePair(GREY, WHITE);
    const c = contract({ screen: 's', tolerance_de: 6, anchors: [{ id: 'card', bg: WHITE }] });
    const r = compareColorParity(c, { android: captures.android });
    expect(r.toleranceDe).toBe(6);
    expect(r.contractToleranceDe).toBe(9);
    expect(r.pass).toBe(false);
    expect(r.findings[0]).toMatchObject({ comparison: 'android-vs-contract' });
    expect(formatColorParity(r)).not.toContain('consider tolerance_de: 6'); // hint only when tol > 6
  });

  it('an anchor with no usable target on a single-platform run is noted, verdict "—"', () => {
    const c = contract({ screen: 's', anchors: [{ id: 'card' }] });
    const r = compareColorParity(c, { android: capturePair(WHITE, WHITE).android });
    expect(r.rows[0].verdict).toBe('—');
    expect(r.notes.some((note) => note.includes('nothing to compare'))).toBe(true);
  });
});

describe('compareColorParity — failing closed', () => {
  it('throws on a tree with no usable width (never a vacuous pass)', () => {
    const captures = capturePair(WHITE, WHITE);
    captures.android.tree = n({ children: [n({ identifier: 'card' })] }); // all rects 0-sized
    expect(() => compareColorParity(cardContract(), captures)).toThrow(/no usable width/);
  });

  it('throws on a degenerate screenshot and on an invalid tolerance_de', () => {
    const captures = capturePair(WHITE, WHITE);
    captures.android.png = { width: 0, height: 0, data: Buffer.alloc(0) };
    expect(() => compareColorParity(cardContract(), captures)).toThrow(/degenerate dimensions/);
    const c = contract({ screen: 's', tolerance_de: -1, anchors: [{ id: 'card', bg: WHITE }] });
    expect(() => compareColorParity(c, capturePair(WHITE, WHITE))).toThrow(/tolerance_de/);
    expect(() => compareColorParity(cardContract(), {})).toThrow(/no platform capture/);
  });

  it('flags an insane scale and a filtered tree in the stats line', () => {
    const captures = capturePair(WHITE, WHITE);
    // png 200 wide but root claims 25 → scale 8, outside [0.5, 4].
    captures.android.tree = root(25, 400, [leaf('card', 2, 2, 12, 8)], 5);
    const r = compareColorParity(cardContract(), captures);
    const out = formatColorParity(r);
    expect(out).toContain('! scale outside [0.5, 4]');
    expect(out).toContain('! FILTERED tree');
  });

  it('notes alpha<255 pixels (alpha ignored, RGB used as stored)', () => {
    const captures = capturePair(WHITE, WHITE);
    paint(captures.android.png as PNG, 0, 0, 4, 4, BG, 128);
    const r = compareColorParity(cardContract(), captures);
    expect(r.stats.find((s) => s.platform === 'android')?.translucent).toBe(true);
    expect(formatColorParity(r)).toContain('! alpha<255 pixels present');
  });

  it('warns when the dominant bucket covers under 40% of the region (busy content)', () => {
    const captures = capturePair(WHITE, WHITE);
    const png = captures.android.png as PNG;
    // Four equal vertical stripes → winning bucket share 25%.
    paint(png, 20, 20, 25, 60, '#FF0000');
    paint(png, 45, 20, 25, 60, '#00FF00');
    paint(png, 70, 20, 25, 60, '#0000FF');
    paint(png, 95, 20, 25, 60, '#FFFF00');
    const r = compareColorParity(cardContract(), captures);
    expect(r.notes.some((note) => note.includes('dominant bucket covers only'))).toBe(true);
  });
});

describe('contractHasColorAnchors', () => {
  it('true only when an anchor opts in via bg / bg_dark / sample', () => {
    expect(contractHasColorAnchors(cardContract())).toBe(true);
    expect(contractHasColorAnchors(contract({ screen: 's', anchors: [{ id: 'a', bg_dark: '#363644' }] }))).toBe(true);
    expect(contractHasColorAnchors(contract({ screen: 's', anchors: [{ id: 'a', sample: 'patches' }] }))).toBe(true);
    expect(contractHasColorAnchors(contract({ screen: 's', anchors: [{ id: 'a', x: 24, w: 345 }] }))).toBe(false);
  });
});

describe('sampling primitives', () => {
  it('scaledRegion applies the 12% inset and reports the clipped fraction', () => {
    const png = img(200, 200);
    const got = scaledRegion({ x: 10, y: 10, width: 100, height: 50 }, 1, png);
    expect(got).toBeDefined();
    // inset: floor(100*0.12)=12 horizontally, floor(50*0.12)=6 vertically
    expect(got?.region).toEqual({ x0: 22, y0: 16, x1: 98, y1: 54 });
    expect(got?.clipped).toBe(0);
    // fully off-png → undefined
    expect(scaledRegion({ x: 0, y: 300, width: 10, height: 10 }, 1, png)).toBeUndefined();
    // tiny region: inset never empties it
    const tiny = scaledRegion({ x: 0, y: 0, width: 2, height: 2 }, 1, png);
    expect(tiny?.region).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });

  it('patchRegions yields 5 patches inside the region', () => {
    const patches = patchRegions({ x0: 0, y0: 0, x1: 100, y1: 100 });
    expect(patches).toHaveLength(5);
    for (const p of patches) {
      expect(p.x1 - p.x0).toBe(9);
      expect(p.y1 - p.y0).toBe(9);
      expect(p.x0).toBeGreaterThanOrEqual(0);
      expect(p.y1).toBeLessThanOrEqual(100);
    }
  });

  it('sampleDominant returns the MEAN of the winning bucket, not the bucket corner', () => {
    // Two colors in the SAME 4-bit bucket (0xF_): #F0F0F0 and #FEFEFE — the
    // mean is their average, which no bucket-corner scheme would produce.
    const png = img(10, 10, '#F0F0F0');
    paint(png, 0, 0, 10, 5, '#FEFEFE');
    const s = sampleDominant(png, [{ x0: 0, y0: 0, x1: 10, y1: 10 }]);
    expect(s?.share).toBe(1);
    expect(s?.rgb).toEqual([247, 247, 247]); // round((240+254)/2)
  });

  it('sampleDominant returns undefined for an empty region set', () => {
    expect(sampleDominant(img(4, 4), [])).toBeUndefined();
  });
});

describe('evaluateColorAssert (the `color` assert primitive)', () => {
  const tree = root(200, 400, [leaf('card', 20, 20, 100, 60)]);
  const rect = { x: 20, y: 20, width: 100, height: 60 };
  const shot = (fill: string): PNG => {
    const png = img(200, 400);
    paint(png, 20, 20, 100, 60, fill);
    return png;
  };

  it('passes on a matching fill and reports the numbers', () => {
    const { pass, detail } = evaluateColorAssert(rect, { expected: WHITE }, tree, shot(WHITE));
    expect(pass).toBe(true);
    expect(detail).toContain('sampled #FDFDFD (dominant, 100% of region) vs expected #FDFDFD');
    expect(detail).toContain('dE00 0.00 ≤ 8');
    expect(detail).toContain('scale 1.000');
  });

  it('the default deltaE (8) CATCHES the real bug — 10.19 compared directly, no 1.5x slack', () => {
    const { pass, detail } = evaluateColorAssert(rect, { expected: WHITE }, tree, shot(GREY));
    expect(pass).toBe(false);
    expect(detail).toMatch(/sampled #CFCFD3 .* dE00 10\.1[5-9] > 8/);
  });

  it('respects an explicit deltaE and drops alpha from #RRGGBBAA', () => {
    expect(evaluateColorAssert(rect, { expected: WHITE, deltaE: 11 }, tree, shot(GREY)).pass).toBe(true);
    expect(evaluateColorAssert(rect, { expected: '#fdfdfd85' }, tree, shot(WHITE)).pass).toBe(true);
  });

  it('sample: "patches" survives a busy center', () => {
    const png = shot(WHITE);
    paint(png, 45, 35, 55, 32, '#3F3F50');
    expect(evaluateColorAssert(rect, { expected: WHITE }, tree, png).pass).toBe(false);
    expect(evaluateColorAssert(rect, { expected: WHITE, sample: 'patches' }, tree, png).pass).toBe(true);
  });

  it('fails closed on an off-screen rect', () => {
    const { pass, detail } = evaluateColorAssert(
      { x: 20, y: 500, width: 100, height: 60 },
      { expected: WHITE },
      tree,
      shot(WHITE),
    );
    expect(pass).toBe(false);
    expect(detail).toContain('outside the screenshot');
    expect(detail).toContain('failing closed');
  });

  it('fails closed when the screen width cannot be inferred (never a vacuous pass)', () => {
    const zeroTree = n({ children: [n({ identifier: 'card' })] });
    const { pass, detail } = evaluateColorAssert(rect, { expected: WHITE }, zeroTree, shot(WHITE));
    expect(pass).toBe(false);
    expect(detail).toContain('screen width could not be inferred');
    expect(detail).not.toContain('NaN');
  });

  it('flags heavy clipping in the detail but still samples', () => {
    const clippedRect = { x: 20, y: 376, width: 100, height: 60 }; // 60% below the png
    const png = img(200, 400);
    paint(png, 20, 376, 100, 24, WHITE);
    const { pass, detail } = evaluateColorAssert(clippedRect, { expected: WHITE }, tree, png);
    expect(pass).toBe(true);
    expect(detail).toContain("may be a neighbor's fill");
  });
});

describe('PNG decode conformance (the pipeline decoder = pngjs)', () => {
  // Ported from the Python script's self-test (f2): hardcoded filtered bytes,
  // expected pixels computed BY HAND from the PNG spec (2x5 RGB, one row per
  // filter type 0-4). Independent of any encoder — a shared filter-arithmetic
  // bug cannot cancel out. This pins the decode path both asserts and verify
  // sample through, plus our RGBA-normalization assumption (pngjs expands
  // RGB to RGBA with alpha 255).
  it('decodes the hand-computed filtered bytes to the spec-derived pixels', async () => {
    const { deflateSync } = await import('node:zlib');
    const crc32 = (buf: Buffer): number => {
      let c = ~0;
      for (const byte of buf) {
        c ^= byte;
        for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
      }
      return ~c >>> 0;
    };
    const chunk = (type: string, payload: Buffer): Buffer => {
      const body = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(payload.length);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(crc32(body));
      return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0); // width
    ihdr.writeUInt32BE(5, 4); // height
    ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, no interlace
    const filtered = Buffer.from([
      0, 10, 20, 30, 40, 50, 60, // None
      1, 1, 2, 3, 4, 5, 6, // Sub
      2, 100, 100, 100, 200, 200, 200, // Up
      3, 10, 10, 10, 10, 10, 10, // Average
      4, 5, 5, 5, 5, 5, 5, // Paeth
    ]);
    const bytes = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(filtered)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const expectedRgb = [
      10, 20, 30, 40, 50, 60,
      1, 2, 3, 5, 7, 9,
      101, 102, 103, 205, 207, 209,
      60, 61, 61, 142, 144, 145,
      65, 66, 66, 147, 149, 150,
    ];
    const decoded = PNG.sync.read(bytes);
    expect([decoded.width, decoded.height]).toEqual([2, 5]);
    const got: number[] = [];
    for (let px = 0; px < 10; px++) {
      got.push(decoded.data[px * 4], decoded.data[px * 4 + 1], decoded.data[px * 4 + 2]);
      expect(decoded.data[px * 4 + 3]).toBe(255); // RGB expanded to opaque RGBA
    }
    expect(got).toEqual(expectedRgb);
  });
});

describe('normalizeHex', () => {
  it('uppercases and drops alpha', () => {
    expect(normalizeHex('#fdfdfd')).toBe('#FDFDFD');
    expect(normalizeHex('#f2f7ff85')).toBe('#F2F7FF');
  });
});
