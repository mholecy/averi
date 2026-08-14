import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSpecSchema, readTreeWithRetry, scanForCrashes, Verifier } from '../../src/verify/assert.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

const FAST = { pollMs: 5, timeoutMs: 100 };

function dashboardFake() {
  resetLayout();
  return new FakeAdapter(
    {
      dashboard: screen(
        el({ identifier: 'dashboard_root' }),
        el({ role: 'text', label: 'Accounts' }),
        el({ role: 'text', identifier: 'balance', value: '1,250.00' }),
      ),
    },
    'dashboard',
  );
}

function png(width: number, height: number, paint: (png: PNG) => void = () => {}): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  paint(image);
  return PNG.sync.write(image);
}

describe('element asserts', () => {
  it('exists passes and absent fails for a present element', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'dashboard_root' } })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'dashboard_root' }, absent: true })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('still visible'),
    });
  });

  it('absent passes for a node that is in the tree but outside the viewport (iOS keeps off-screen nodes)', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        form: screen(
          el({ identifier: 'amount_input', role: 'textfield' }),
          // iOS-style lingering node: still in the tree, pushed off-viewport
          node({ role: 'text', label: 'Required', rect: { x: 0, y: 2500, width: 100, height: 20 } }),
        ),
      },
      'form',
    );
    const verifier = new Verifier(fake, FAST);
    expect(await verifier.assert({ element: { text: 'Required' }, absent: true })).toMatchObject({
      pass: true,
      detail: expect.stringContaining('none intersect the viewport'),
    });
    // and the inverse guard: a visible node must fail the absent assert
    expect(await verifier.assert({ element: { id: 'amount_input' }, absent: true })).toMatchObject({ pass: false });
  });

  it('error asserts check the node error attribute and report the actual error on mismatch', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        form: screen(
          el({ identifier: 'amount_input', role: 'textfield', error: 'Value is too small' }),
          el({ identifier: 'note_input', role: 'textfield' }),
        ),
      },
      'form',
    );
    const verifier = new Verifier(fake, FAST);
    expect(
      await verifier.assert({ element: { id: 'amount_input' }, error: 'Value is too small' }),
    ).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'amount_input' }, error: 'Required' })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('"Value is too small"'),
    });
    expect(await verifier.assert({ element: { id: 'note_input' }, error: 'Required' })).toMatchObject({
      pass: false,
    });
  });

  it('absent passes and exists fails (with timeout detail) for a missing element', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'error_banner' }, absent: true })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'error_banner' } })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('not found within'),
    });
  });

  it('text and match check label/value; mismatch reports what was actually there', async () => {
    const verifier = new Verifier(dashboardFake(), FAST);
    expect(await verifier.assert({ element: { id: 'balance' }, text: '1,250.00' })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'balance' }, match: '\\d+,\\d{3}' })).toMatchObject({ pass: true });
    expect(await verifier.assert({ element: { id: 'balance' }, text: '9,999.99' })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('"1,250.00"'),
    });
  });
});

describe('rect asserts (geometry vs Figma-frame values)', () => {
  // screen() root is 1000 wide at x=0 → screen width 1000; frameWidth 500
  // makes the card's expected values exactly half the measured pixels.
  const cardFake = () => {
    resetLayout();
    return new FakeAdapter(
      {
        detail: screen(node({ identifier: 'card', rect: { x: 100, y: 200, width: 800, height: 100 } })),
      },
      'detail',
    );
  };

  it('passes when x/w/h match in % of screen width, with the deltas in the detail', async () => {
    const verifier = new Verifier(cardFake(), FAST);
    const result = await verifier.assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 },
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('screen width 1000');
  });

  it('fails on an over-tolerance h and reports the measured numbers', async () => {
    const verifier = new Verifier(cardFake(), FAST);
    const result = await verifier.assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 70, frameWidth: 500 }, // 14% expected vs 10% measured → -4%
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/h .* OVER/);
  });

  it('y is measured and reported but never fails the assert', async () => {
    const verifier = new Verifier(cardFake(), FAST);
    const result = await verifier.assert({
      element: { id: 'card' },
      rect: { x: 50, y: 10, w: 400, frameWidth: 500 }, // y expected 2% vs measured 20%
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('(measured only, never fails)');
  });

  it('fails with a timeout detail when the element never appears', async () => {
    const verifier = new Verifier(cardFake(), FAST);
    const result = await verifier.assert({ element: { id: 'ghost' }, rect: { x: 1, frameWidth: 500 } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not found within');
  });
});

describe('color asserts (fill vs expected hex, CIEDE2000)', () => {
  // screen() root is 1000 wide at x=0 and the fake png is 1000 wide → scale 1.
  const CARD = { x: 100, y: 200, width: 800, height: 100 };
  const fill = (p: PNG, hex: string, rect = CARD): void => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
        const o = (y * p.width + x) << 2;
        p.data[o] = r;
        p.data[o + 1] = g;
        p.data[o + 2] = b;
        p.data[o + 3] = 255;
      }
    }
  };
  const cardFake = (hex: string) => {
    resetLayout();
    const fake = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: { ...CARD } })) }, 'detail');
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, hex));
    return fake;
  };

  it('passes on a matching fill and reports the sampled hex, dE and scale', async () => {
    const verifier = new Verifier(cardFake('#FDFDFD'), FAST);
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.description).toContain('fill within dE00 8 of #FDFDFD');
    expect(result.detail).toContain('sampled #FDFDFD (dominant, 100% of region)');
    expect(result.detail).toContain('scale 1.000');
  });

  it('the default deltaE (8) catches the real 2026-08-13 bug: #CFCFD3 where #FDFDFD was expected', async () => {
    const verifier = new Verifier(cardFake('#CFCFD3'), FAST);
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/sampled #CFCFD3 .* dE00 10\.1[5-9] > 8/);
  });

  it('respects an explicit deltaE, drops #RRGGBBAA alpha, and names the theme annotation', async () => {
    const verifier = new Verifier(cardFake('#CFCFD3'), FAST);
    const loose = await verifier.assert({
      element: { id: 'card' },
      color: { expected: '#fdfdfd85', deltaE: 11, theme: 'light' },
    });
    expect(loose.pass).toBe(true);
    expect(loose.description).toContain('dE00 11 of #FDFDFD (light theme)');
  });

  it('samples a STABLE screenshot (at least two captures compared) via adapter.screenshot()', async () => {
    const fake = cardFake('#FDFDFD');
    const verifier = new Verifier(fake, FAST);
    await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(fake.screenshots.length).toBeGreaterThanOrEqual(2);
  });

  it('fails with a timeout detail when the element never appears (no screenshot burned)', async () => {
    const fake = cardFake('#FDFDFD');
    const verifier = new Verifier(fake, FAST);
    const result = await verifier.assert({ element: { id: 'ghost' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not found within');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('fails closed (with the decode error) when the screenshot is not decodable', async () => {
    const fake = cardFake('#FDFDFD');
    fake.nextScreenshot = Buffer.from('not a png');
    const verifier = new Verifier(fake, FAST);
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('screenshot PNG decode failed');
  });
});

describe('transient UI-tree read failures', () => {
  const NULL_ROOT = 'uiautomator dump returned no XML: ERROR: null root node returned by UiTestAutomationBridge.';

  const failingTree = (fake: FakeAdapter, failures: number) => {
    const orig = fake.uiTree.bind(fake);
    let remaining = failures;
    fake.uiTree = async () => {
      if (remaining-- > 0) throw new Error(NULL_ROOT);
      return orig();
    };
  };

  it('an exists assert keeps polling through failed reads and passes once the tree is back', async () => {
    const fake = dashboardFake();
    failingTree(fake, 3);
    const [result] = await new Verifier(fake, FAST).assertAll([{ element: { id: 'dashboard_root' } }]);
    expect(result.pass).toBe(true);
  });

  it('a persistently unreadable tree fails on timeout with the read error in the detail', async () => {
    const fake = dashboardFake();
    failingTree(fake, Number.POSITIVE_INFINITY);
    const [result] = await new Verifier(fake, FAST).assertAll([{ element: { id: 'dashboard_root' } }]);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/last UI tree read failed: uiautomator dump returned no XML/);
  });

  it('an absent assert never treats an unreadable tree as proof of absence', async () => {
    const fake = dashboardFake();
    failingTree(fake, Number.POSITIVE_INFINITY);
    const [result] = await new Verifier(fake, FAST).assertAll([
      { element: { id: 'dashboard_root' }, absent: true },
    ]);
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/could not verify.*last UI tree read failed/);
  });
});

describe('screenshot baseline asserts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates the baseline on first run, passes on identical rerun', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    const first = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(first).toMatchObject({ pass: true, detail: expect.stringContaining('baseline created') });
    expect(await readFile(join(dir, 'android', 'dash.png'))).toBeDefined();

    const second = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(second).toMatchObject({ pass: true, detail: '0.00% of pixels differ' });
  });

  it('fails when the diff exceeds the threshold and reports the ratio', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    await verifier.assert({ screenshot: { baseline: 'dash' } });

    // paint the bottom half black → 50% diff
    fake.nextScreenshot = png(50, 50, (p) => p.data.fill(0, p.data.length / 2));
    const result = await verifier.assert({ screenshot: { baseline: 'dash', threshold: 0.1 } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/^5\d\.\d+% of pixels differ|^50\.00%/);
  });

  it('fails on size mismatch with both sizes in the detail', async () => {
    const fake = dashboardFake();
    fake.nextScreenshot = png(50, 50);
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    await verifier.assert({ screenshot: { baseline: 'dash' } });

    fake.nextScreenshot = png(40, 50);
    const result = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(result).toMatchObject({ pass: false, detail: 'size mismatch: baseline 50x50, current 40x50' });
  });
});

describe('assertSpecSchema', () => {
  it('rejects absent combined with text or error', () => {
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, absent: true, text: 'y' })).toThrow();
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, absent: true, error: 'y' })).toThrow();
  });

  it('accepts the documented shapes', () => {
    expect(assertSpecSchema.parse({ element: { id: 'x' } })).toBeDefined();
    expect(assertSpecSchema.parse({ element: { id: 'x' }, error: 'Required' })).toBeDefined();
    expect(assertSpecSchema.parse({ screenshot: { baseline: 'home', threshold: 0.02 } })).toBeDefined();
    expect(
      assertSpecSchema.parse({
        element: { id: 'x' },
        rect: { x: 24, y: 106, w: 345, h: 129, frameWidth: 393, tolerancePct: 2.0 },
      }),
    ).toBeDefined();
  });

  it('rect requires frameWidth (no anchor-w fallback for a single anchor) and at least one field', () => {
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, rect: { x: 24 } })).toThrow();
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, rect: { frameWidth: 393 } })).toThrow();
  });

  it('rejects a y-only rect — it could never fail (y is measured but not a failure source)', () => {
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, rect: { y: 180, frameWidth: 393 } })).toThrow(
      /y alone can never fail/,
    );
  });

  it('accepts the documented color shapes', () => {
    expect(assertSpecSchema.parse({ element: { id: 'x' }, color: { expected: '#FDFDFD' } })).toBeDefined();
    expect(
      assertSpecSchema.parse({
        element: { id: 'x' },
        color: { expected: '#FDFDFD85', deltaE: 8, sample: 'patches', theme: 'dark' },
      }),
    ).toBeDefined();
  });

  it('color requires expected as hex — a token name surfaces the resolve-upstream message', () => {
    // Zod's union heuristic surfaces regex/custom issues from the color
    // branch (the messages worth reading), so a token name or short hex
    // shows the fix, not elementAssert's "unrecognized key 'color'".
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, color: { expected: 'base.color1' } })).toThrow(
      /token names resolve in the superrepo layer/,
    );
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, color: { expected: '#FFF' } })).toThrow(
      /#RRGGBB/,
    );
    // Structural misses still reject (zod falls back to a generic union error
    // for pure invalid_type/enum issues — same behavior class as rect).
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, color: {} })).toThrow();
    expect(() =>
      assertSpecSchema.parse({ element: { id: 'x' }, color: { expected: '#FDFDFD', sample: 'average' } }),
    ).toThrow();
  });
});

describe('readTreeWithRetry', () => {
  it('absorbs transient read failures (uiautomator null root) and returns the tree', async () => {
    const fake = dashboardFake();
    const orig = fake.uiTree.bind(fake);
    let failures = 3;
    fake.uiTree = async () => {
      if (failures-- > 0) throw new Error('null root node returned by UiTestAutomationBridge');
      return orig();
    };
    const tree = await readTreeWithRetry(fake, 5, 1);
    expect(tree.children.length).toBeGreaterThan(0);
    expect(failures).toBe(-1); // succeeded on the 4th attempt
  });

  it('throws after the last attempt, naming the attempt count and the underlying error', async () => {
    const fake = dashboardFake();
    fake.uiTree = async () => {
      throw new Error('null root node');
    };
    await expect(readTreeWithRetry(fake, 3, 1)).rejects.toThrow(/after 3 attempts: null root node/);
  });
});

describe('scanForCrashes', () => {
  it('extracts Android fatal exceptions with trailing stack context', () => {
    const lines = [
      '07-08 11:00:00.000  1234  1234 I ActivityManager: ok line',
      '07-08 11:00:01.000  5678  5678 E AndroidRuntime: FATAL EXCEPTION: main',
      '07-08 11:00:01.001  5678  5678 E AndroidRuntime: java.lang.NullPointerException',
      '07-08 11:00:01.002  5678  5678 E AndroidRuntime:   at md.bank.app.MainActivity.onCreate',
    ];
    const excerpt = scanForCrashes(lines, 'android');
    expect(excerpt[0]).toContain('FATAL EXCEPTION');
    expect(excerpt).toHaveLength(3);
  });

  it('detects iOS uncaught exceptions and returns nothing for clean logs', () => {
    expect(scanForCrashes(['Terminating app due to uncaught exception NSRangeException'], 'ios')).toHaveLength(1);
    expect(scanForCrashes(['all quiet', 'nothing to see'], 'ios')).toHaveLength(0);
  });
});

/**
 * The four asserts share one polling primitive but deliberately DISAGREE on
 * how a timeout is explained. Nothing pinned that disagreement, so collapsing
 * the loops could have silently inverted it — these lock it down.
 */
describe('timeout-detail precedence (shared poll, per-assert wording)', () => {
  /** Sees the element for the first read, then can no longer produce a tree. */
  function seesThenBlinds(): FakeAdapter {
    resetLayout();
    const fake = new FakeAdapter(
      { dashboard: screen(el({ identifier: 'amount', role: 'text', value: 'WRONG' })) },
      'dashboard',
    );
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (reads++ > 0) throw new Error('null root node');
      return real();
    };
    return fake;
  }

  it('an element assert prefers the READ ERROR — a tree it never read explains the miss', async () => {
    const result = await new Verifier(seesThenBlinds(), FAST).assert({
      element: { id: 'amount' },
      text: '100.00',
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('last UI tree read failed');
    expect(result.detail).not.toContain('element found but');
  });

  it('a rect assert prefers the MEASUREMENT — it did read the tree, and the numbers are the finding', async () => {
    const result = await new Verifier(seesThenBlinds(), FAST).assert({
      element: { id: 'amount' },
      rect: { x: 999, frameWidth: 393 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('vs contract');
    expect(result.detail).not.toContain('last UI tree read failed');
  });

  it('an unreadable tree is never evidence of absence', async () => {
    const fake = seesThenBlinds();
    fake.uiTree = async () => {
      throw new Error('null root node');
    };
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'gone' }, absent: true });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('could not verify');
  });
});

describe('poll cadence and preconditions', () => {
  it('a passing assert reads the tree exactly once — no wasted device round trip', async () => {
    const fake = dashboardFake();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      reads++;
      return real();
    };
    expect(await new Verifier(fake, FAST).assert({ element: { id: 'dashboard_root' } })).toMatchObject({
      pass: true,
    });
    expect(reads).toBe(1);
  });

  it('absent reads the viewport once, and a viewport failure THROWS rather than passing', async () => {
    const counted = dashboardFake();
    let viewports = 0;
    counted.viewport = async () => {
      viewports++;
      return { width: 1000, height: 2000 };
    };
    await new Verifier(counted, FAST).assert({ element: { id: 'dashboard_root' }, absent: true });
    expect(viewports).toBe(1);

    const broken = dashboardFake();
    broken.viewport = async () => {
      throw new Error('adb: device offline');
    };
    // Absence without a reference frame is meaningless — it must not come back
    // as a tidy failing assert.
    await expect(
      new Verifier(broken, FAST).assert({ element: { id: 'nope' }, absent: true }),
    ).rejects.toThrow(/device offline/);
  });
});

describe('rect and color asserts report an unreadable tree at timeout', () => {
  /** Never produces a tree — the `detail ?? notFound(readError)` branch. */
  function blind() {
    const fake = dashboardFake();
    fake.uiTree = async () => {
      throw new Error('null root node');
    };
    return fake;
  }

  it('a rect assert names the read failure when it never saw the element', async () => {
    const result = await new Verifier(blind(), FAST).assert({
      element: { id: 'card' },
      rect: { x: 24, frameWidth: 393 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not found within');
    expect(result.detail).toContain('last UI tree read failed: null root node');
  });

  it('a color assert names the read failure too', async () => {
    const result = await new Verifier(blind(), FAST).assert({
      element: { id: 'card' },
      color: { expected: '#FFFFFF' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('last UI tree read failed: null root node');
  });
});
