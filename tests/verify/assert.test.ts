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

describe('exact-text misses hint at a combined accessibility element', () => {
  // Measured 2026-08-26: the same assert passed on Android and failed on iOS,
  // because iOS `.accessibilityElement(children: .combine)` collapses a tile's
  // two Texts into one label. Nothing EQUALS the expected string, so the
  // failure reads as a missing feature until someone dumps the tree.
  function combinedTileFake() {
    resetLayout();
    return new FakeAdapter(
      {
        filters: screen(
          el({
            role: 'button',
            identifier: 'transactions.filter.type_tile',
            label: 'Select transaction type, 1 of 13 selected',
          }),
        ),
      },
      'filters',
    );
  }

  it('names the containing node and the portable form when a spec-level text finds nothing', async () => {
    const result = await new Verifier(combinedTileFake(), FAST).assert({
      element: { text: '1 of 13 selected' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('no node has this exact text');
    expect(result.detail).toContain('id=transactions.filter.type_tile');
    expect(result.detail).toContain('Select transaction type, 1 of 13 selected');
    expect(result.detail).toContain('use match:');
  });

  it('hints the same way when the element was found but its content was longer', async () => {
    const result = await new Verifier(combinedTileFake(), FAST).assert({
      element: { id: 'transactions.filter.type_tile' },
      text: '1 of 13 selected',
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('element found but content was');
    expect(result.detail).toContain('no node has this exact text');
  });

  it('escapes regex punctuation in the suggested match, so the hint can be pasted as-is', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { total: screen(el({ role: 'text', label: 'Total (incl. fees): 1,250.00 MDL' })) },
      'total',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { text: '1,250.00 MDL' } });
    expect(result.detail).toContain('use match: "1,250\\\\.00 MDL"');
  });

  it('stays quiet for a substring INSIDE a token — a value bug is not a combined element', async () => {
    // The dangerous shape: "9.99" occurs in "19.99", so plain containment
    // would blame iOS element combining for a real price bug AND recommend an
    // unanchored match: "9\\.99" that PASSES against "19.99" — turning a
    // correctly failing assert into a wrongly passing one.
    resetLayout();
    const fake = new FakeAdapter({ p: screen(el({ role: 'text', identifier: 'price', label: '19.99' })) }, 'p');
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'price' }, text: '9.99' });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found but content was: "19.99"');
    expect(result.detail).not.toContain('CONTAIN it');
  });

  it('stays quiet for an off-by-one that merely shares a suffix', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { t: screen(el({ role: 'text', identifier: 'count', label: '11 of 13 selected' })) },
      't',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'count' }, text: '1 of 13 selected' });
    expect(result.detail).not.toContain('CONTAIN it');
  });

  it('does not explain an id-addressed miss with an unrelated node elsewhere on screen', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        s: screen(
          el({ role: 'text', identifier: 'header', label: 'Filters, 1 of 13 selected' }),
          el({ role: 'text', identifier: 'footer', label: 'Nothing here' }),
        ),
      },
      's',
    );
    // The spec matched `footer`, so `header` is not an explanation for it.
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'footer' },
      text: '1 of 13 selected',
    });
    expect(result.pass).toBe(false);
    expect(result.detail).not.toContain('CONTAIN it');
  });

  it.each([
    ['$9.99', 'a currency prefix'],
    ['9.99%', 'a format suffix'],
  ])('stays quiet for %s (%s) — the advice would wave the regression through', async (label) => {
    resetLayout();
    const fake = new FakeAdapter({ p: screen(el({ role: 'text', identifier: 'v', label })) }, 'p');
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'v' }, text: '9.99' });
    expect(result.pass).toBe(false);
    expect(result.detail).not.toContain('CONTAIN it');
  });

  it('still hints for the separators a combined label actually joins on', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        p: screen(
          el({ role: 'text', identifier: 'dash', label: 'Filters – 1 of 13 selected' }),
          el({ role: 'text', identifier: 'space', label: 'Filters 1 of 13 selected' }),
        ),
      },
      'p',
    );
    const verifier = new Verifier(fake, FAST);
    for (const id of ['dash', 'space']) {
      const result = await verifier.assert({ element: { id }, text: '1 of 13 selected' });
      expect(result.detail).toContain('CONTAIN it');
    }
  });

  it('stays quiet when the string is genuinely absent — no hint to invent', async () => {
    const result = await new Verifier(dashboardFake(), FAST).assert({ element: { text: 'Nowhere' } });
    expect(result.detail).toBe('not found within 100ms');
  });

  it('does not hint for a failing `match` — a regex already asks the containment question', async () => {
    const result = await new Verifier(combinedTileFake(), FAST).assert({
      element: { id: 'transactions.filter.type_tile' },
      match: '^99 of',
    });
    expect(result.pass).toBe(false);
    expect(result.detail).not.toContain('no node has this exact text');
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

describe('ocr asserts (what the element RENDERS)', () => {
  const CARD = { x: 100, y: 200, width: 800, height: 100 };
  /** Stands in for the Swift recognizer; the real one needs a toolchain. */
  const engine = (text: string | undefined, h = 30) => ({
    recognize: async (_png: Buffer, regions: { id: string }[]) =>
      regions.map((r) => ({
        id: r.id,
        lines: text === undefined ? [] : [{ text, confidence: 1, x: 0, y: 0, w: 200, h }],
      })),
  });
  const cardFake = () => {
    resetLayout();
    const fake = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: { ...CARD } })) }, 'detail');
    fake.nextScreenshot = png(1000, 320);
    return fake;
  };

  it('passes on the rendered string and says what it read', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    expect(result.description).toContain('renders text "CONTINUE"');
    expect(result.detail).toContain('read "CONTINUE"');
  });

  /**
   * The 2026-08-26 follow-up: the crop is scaled by the DEVICE screen, not by
   * whatever the tree's widest rect happens to be
   * (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md). The
   * tree here is the shape that fails closed in 0.5.0 — a rect-less root over
   * an inset, oversized node, with an off-screen scrim for company — and the
   * assert now reads the element anyway.
   */
  const sheetFake = () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        detail: {
          role: 'container',
          label: null,
          identifier: null,
          value: null,
          rect: { x: 0, y: 0, width: 0, height: 0 },
          children: [
            node({ identifier: 'card', rect: { ...CARD } }),
            node({ identifier: 'wide', rect: { x: 16, y: 0, width: 1400, height: 2000 } }),
            node({ identifier: 'scrim', rect: { x: -1000, y: -2000, width: 3000, height: 6000 } }),
          ],
        },
      },
      'detail',
    );
    fake.nextScreenshot = png(1000, 320);
    // Asked for explicitly: this tree has no root rect to derive it from, which
    // is the whole point of the case.
    fake.viewportSize = { width: 1000, height: 2000 };
    return fake;
  };

  it('scales the crop by the device screen, so a tree that cannot describe one no longer fails closed', async () => {
    const verifier = new Verifier(sheetFake(), { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    // The tree disagrees with the device, and the assert says which it used.
    expect(result.detail).toMatch(/1000x2000 DEVICE screen; the tree reads 1416 \(content width\)/);
  });

  it('…and the same tree WITHOUT a device screen still fails closed, as 0.5.0 does', async () => {
    const fake = sheetFake();
    fake.viewport = async () => {
      throw new Error('idb describe: no such device');
    };
    const verifier = new Verifier(fake, { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/CONTENT width.*failing closed, rendered text unchecked/);
  });

  it('still reads the tree when the device will not report a screen — a failed read is not a failed assert', async () => {
    const fake = cardFake();
    fake.viewport = async () => {
      throw new Error('idb describe: no such device');
    };
    const verifier = new Verifier(fake, { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('read "CONTINUE"');
  });

  it('fails on drift and quotes both sides', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engine('0.00') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'Enter amount' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('read "0.00"');
    expect(result.detail).toContain('vs expected "Enter amount"');
  });

  it('checks rendered ink height in % of screen width (screen 1000 wide, png 1000 → 30px = 3.00%)', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engine('CONTINUE', 30) });
    const ok = await verifier.assert({ element: { id: 'card' }, ocr: { heightPct: 3.0 } });
    expect(ok.pass).toBe(true);
    expect(ok.detail).toContain('ink height 3.00% of width');

    const tooBig = new Verifier(cardFake(), { ...FAST, ocrEngine: engine('CONTINUE', 41) });
    const bad = await tooBig.assert({ element: { id: 'card' }, ocr: { heightPct: 3.0 } });
    expect(bad.pass).toBe(false);
  });

  it('fails closed when the recognizer read nothing — unread is not verified-as-empty', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engine(undefined) });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('failing closed');
  });

  it('fails closed when the recognizer itself throws, naming the reason', async () => {
    const engineThrows = { recognize: async () => { throw new Error('swiftc not found'); } };
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engineThrows });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('swiftc not found');
  });

  it('a missing element times out like every other assert', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'ghost' }, ocr: { text: 'CONTINUE' } });
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

  it('reads the device screen ONCE per Verifier, however many pixel asserts run', async () => {
    const fake = cardFake('#FDFDFD');
    let viewports = 0;
    fake.viewport = async () => {
      viewports++;
      return { width: 1000, height: 2000 };
    };
    const verifier = new Verifier(fake, FAST);
    await verifier.assertAll([
      { element: { id: 'card' }, color: { expected: '#FDFDFD' } },
      { element: { id: 'card' }, color: { expected: '#FDFDFD' } },
      { element: { id: 'card' }, absent: true, timeout: '10ms' },
    ]);
    expect(viewports).toBe(1);
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

  it('accepts the documented ocr shapes and rejects the vacuous ones', () => {
    expect(assertSpecSchema.parse({ element: { id: 'x' }, ocr: { text: 'CONTINUE' } })).toBeDefined();
    expect(
      assertSpecSchema.parse({ element: { id: 'x' }, ocr: { match: '^\\d+$', heightPct: 3.8, tolerancePct: 5 } }),
    ).toBeDefined();
    // An empty ocr spec could never fail, and text+match is two questions.
    expect(() => assertSpecSchema.parse({ element: { id: 'x' }, ocr: {} })).toThrow(/at least one of/);
    expect(() =>
      assertSpecSchema.parse({ element: { id: 'x' }, ocr: { text: 'a', match: 'a' } }),
    ).toThrow(/text OR match/);
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
