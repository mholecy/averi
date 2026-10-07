import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSpecSchema, scanForCrashes, Verifier } from '../../src/verify/assert.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';
import { KEYBOARD_ROLE } from '../../src/adapters/types.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { captureFrame, STABILITY_DELAY_MS } from '../../src/verify/capture.js';

// The one sleep owner (util/sleep.ts) is recorded, not waited on
// (tests/helpers/sleep-recorder.ts): since 2026-10-05 the stability delay
// is capture.ts's constant and no option of the Verifier's, so this file
// cannot buy speed with a small `pollMs` any more — it pins the DELAY
// SEQUENCE instead. The deadline tests fake the Date; the recorder moves it.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Poll interval only (2026-10-05) — the stability delay is not this file's to set. */
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

  it('absent uses the ONE viewport rule the engine\'s detect uses (absentFromViewport): in the tree but off-screen is absent, on-screen is not', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        s: screen(
          node({ identifier: 'card_face', rect: { x: 0, y: -300, width: 100, height: 100 } }), // iOS keeps it, scrolled above the top
          el({ identifier: 'row_0' }),
        ),
      },
      's',
    );
    const verifier = new Verifier(fake, FAST);
    expect(await verifier.assert({ element: { id: 'card_face' }, absent: true })).toMatchObject({
      pass: true,
      detail: '1 node(s) in tree but none intersect the viewport',
    });
    expect(await verifier.assert({ element: { id: 'row_0' }, absent: true })).toMatchObject({
      pass: false,
      detail: expect.stringContaining('still visible'),
    });
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
      // The hint's full sentence, byte-for-byte — text-hint.ts moved to verify/
      // on 2026-10-04 and this wording is the thing that must not drift.
      expect(result.detail).toContain('no node has this exact text, but 1 node(s) CONTAIN it as a whole segment:');
      expect(result.detail).toContain(
        '(iOS combines a container\'s children into one accessibility element — use match: "1 of 13 selected" for a cross-platform assert)',
      );
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

  // The false pass of the 2026-10-07 parity review (P1): a tree whose content
  // starts inset reads its CONTENT width (384) as the screen's, which turns a
  // real -4.2 % `w` delta on a 402-pt screen into +0.06 %.
  it('fails closed on a CONTENT width instead of passing with a caveat in the detail', async () => {
    const fake = new FakeAdapter(
      {
        s: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 0, height: 0 },
          children: [
            node({
              rect: { x: 16, y: 100, width: 368, height: 600 },
              children: [node({ identifier: 'card', rect: { x: 16, y: 120, width: 368, height: 100 } })],
            }),
          ],
        }),
      },
      's',
    );
    fake.viewportSize = { width: 402, height: 874 };
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 16, w: 385, frameWidth: 402 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/CONTENT width.*failing closed, geometry unchecked/);
  });

  it('the device screen witnesses the width: a window wider than the screen fails closed', async () => {
    const fake = cardFake();
    fake.viewportSize = { width: 400, height: 800 }; // the tree's window is 1000 wide
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 }, // passes against the tree's 1000
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(
      /the 400x800 device screen is 400 on the short side a portrait window faces .*; failing closed, geometry unchecked$/,
    );
  });

  it('a failed device read degrades to the tree\'s width, saying so — not a failed assert', async () => {
    const fake = cardFake();
    fake.viewport = async () => {
      throw new Error('adb: device offline');
    };
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 },
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('screen width 1000 (window width from the UI tree alone');
  });

  /**
   * The parity code review's A3 (2026-10-07): `viewport()` is memoized, so a
   * screen changed after the first read (`wm size`, an unfold) refused until
   * the server restarted (device check row 18c). Before a wider-than-screen
   * refusal the assert re-reads the screen ONCE, bypassing the memo.
   */
  it('a screen changed since the memoized read: the one fresh re-read lifts the refusal', async () => {
    const fake = cardFake();
    const reads: (boolean | undefined)[] = [];
    fake.viewport = async (opts?: { fresh?: boolean }) => {
      reads.push(opts?.fresh);
      return opts?.fresh === true ? { width: 1000, height: 2000 } : { width: 400, height: 800 };
    };
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 },
    });
    expect(result.pass).toBe(true);
    expect(result.detail).toMatch(/; screen width 1000$/);
    expect(reads).toEqual([undefined, true]);
  });

  it('re-reads at most once per assert, and a refusal that survives says the screen was read again', async () => {
    const fake = cardFake();
    let fresh = 0;
    let rounds = 0;
    fake.viewport = async (opts?: { fresh?: boolean }) => {
      if (opts?.fresh === true) fresh++;
      return { width: 400, height: 800 };
    };
    const uiTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      rounds++;
      return uiTree();
    };
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 },
    });
    expect(result.pass).toBe(false);
    expect(rounds).toBeGreaterThan(1);
    expect(fresh).toBe(1);
    expect(result.detail).toMatch(
      /the 400x800 device screen is 400 on the short side .* — the device screen was read again just before this refusal, so the size above is the one it reports now, not a stale read; failing closed, geometry unchecked$/,
    );
  });

  it('a re-read that fails keeps the refusal and says a changed screen cannot be ruled out', async () => {
    const fake = cardFake();
    fake.viewport = async (opts?: { fresh?: boolean }) => {
      if (opts?.fresh === true) throw new Error('adb: device offline');
      return { width: 400, height: 800 };
    };
    const result = await new Verifier(fake, FAST).assert({
      element: { id: 'card' },
      rect: { x: 50, w: 400, h: 50, frameWidth: 500 },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/a fresh read of the device screen failed \(adb: device offline\), so a screen changed since the first read .* cannot be ruled out; re-run/);
  });

  it('a window that fits the memoized screen never pays a fresh read', async () => {
    const fake = cardFake();
    const reads: (boolean | undefined)[] = [];
    fake.viewport = async (opts?: { fresh?: boolean }) => {
      reads.push(opts?.fresh);
      return { width: 1000, height: 2000 };
    };
    await new Verifier(fake, FAST).assert({ element: { id: 'card' }, rect: { x: 50, w: 400, h: 50, frameWidth: 500 } });
    expect(reads).toEqual([undefined]);
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

  /**
   * The rect-off-the-png sentence (verify/text-parity.ts `ocrRegionForRect`,
   * worded through ui-tree/geometry.ts `rectText` since 2026-10-06) was
   * pinned nowhere: a change to the shared rect wording reached it
   * unnoticed. Pinned exactly here, at the surface an agent reads.
   */
  it('an element whose rect lands off the screenshot fails closed and says where the rect was', async () => {
    resetLayout();
    const below = { x: 100, y: 500, width: 800, height: 100 };
    const fake = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: below })) }, 'detail');
    fake.nextScreenshot = png(1000, 320);
    const result = await new Verifier(fake, { ...FAST, ocrEngine: engine('CONTINUE') }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'element rect 100,500 800x100 scaled by 1.000 leaves nothing on-screen; failing closed, rendered text unchecked',
    );
  });

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

  it('fails with a timeout detail when the element never appears (no screenshot burned)', async () => {
    const fake = cardFake();
    const verifier = new Verifier(fake, { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'ghost' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not found within');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('fails closed (with the decode error) when the screenshot is not decodable', async () => {
    const fake = cardFake();
    fake.nextScreenshot = Buffer.from('not a png');
    const verifier = new Verifier(fake, { ...FAST, ocrEngine: engine('CONTINUE') });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/screenshot PNG decode failed: .*; failing closed, rendered text unchecked/);
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

  /**
   * The caveats a sample carries are worded ONCE, in color-parity.ts
   * (`sampleCaveats`), for the table row and this assert alike — since
   * 63e4ca4 the assert prints the table's fuller wording, recovery step
   * included. Pinned here at the assert, exactly, because this is the surface
   * a caller reads.
   */
  it('names a clipped sample and a busy one in the table\'s own words, recovery step included', async () => {
    // Clipped: the card hangs 60% below a 320px-tall png (y 280..380).
    const hanging = { x: 100, y: 280, width: 800, height: 100 };
    resetLayout();
    const clipped = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: hanging })) }, 'detail');
    clipped.nextScreenshot = png(1000, 320, (p) => fill(p, '#FDFDFD', { ...hanging, height: 40 }));
    const a = await new Verifier(clipped, FAST).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(a.pass).toBe(true);
    expect(a.detail).toContain(
      "clipped 60% off-png — the remaining sliver's dominant may be a neighbor's fill; scroll it fully on-screen and re-run to trust this row",
    );

    // Busy: three equal bands in three 4-bit buckets across the inset region
    // (x 196..804), so the winning bucket covers a third.
    const busy = cardFake('#FDFDFD');
    busy.nextScreenshot = png(1000, 320, (p) => {
      fill(p, '#FDFDFD', { x: 100, y: 200, width: 299, height: 100 });
      fill(p, '#3F3F50', { x: 399, y: 200, width: 203, height: 100 });
      fill(p, '#A0C040', { x: 602, y: 200, width: 298, height: 100 });
    });
    const b = await new Verifier(busy, FAST).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(b.detail).toContain(
      'dominant bucket covers only 33% of the region — busy content; consider sample: "patches" or a tighter anchor',
    );
  });

  it('measures the FIRST of duplicate matches — the rect-parity duplicate-id rule, owned by the pixel poll', async () => {
    resetLayout();
    const second = { x: 100, y: 20, width: 800, height: 100 };
    const fake = new FakeAdapter(
      { detail: screen(node({ identifier: 'card', rect: { ...CARD } }), node({ identifier: 'card', rect: second })) },
      'detail',
    );
    fake.nextScreenshot = png(1000, 320, (p) => {
      fill(p, '#FDFDFD');
      fill(p, '#CFCFD3', second);
    });
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('sampled #FDFDFD');
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
    // The default threshold is 1% of pixels (0.01), and the description says so.
    expect(first.description).toBe('screenshot matches baseline "dash" (threshold 1%)');

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

  it('diffs and baselines the SETTLED frame, never the first capture (verify/capture.ts, since 2026-10-04)', async () => {
    // A screen mid-animation: two different frames, then it holds still.
    // Until 2026-10-04 this assert took one bare screenshot — the first,
    // mid-animation one — so the baseline it wrote and the frame it later
    // diffed were both coin tosses. It now goes through captureFrame's
    // stability wait like every other pixel reading.
    const movingA = png(50, 50, (p) => p.data.fill(0, 0, p.data.length / 4));
    const movingB = png(50, 50, (p) => p.data.fill(0, 0, p.data.length / 2));
    const settled = png(50, 50);
    const fake = dashboardFake();
    const frames = [movingA, movingB, settled, settled];
    let i = 0;
    fake.screenshot = async () => {
      const shot = frames[Math.min(i++, frames.length - 1)];
      fake.screenshots.push(shot);
      return shot;
    };
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    const first = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(first).toMatchObject({ pass: true, detail: expect.stringContaining('baseline created') });
    // movingA, movingB, settled, settled — the capture that confirmed stability is the one stored.
    // ...then, since 2026-10-06, the four captures of the baseline confirmation window (capture.ts).
    expect(fake.screenshots).toHaveLength(8);
    expect((await readFile(join(dir, 'android', 'dash.png'))).equals(settled)).toBe(true);
    // The wait between captures is capture.ts's 300 ms, not the Verifier's
    // pollMs (FAST: 5) — one budget, whoever calls (2026-10-05).
    // The window adds its one 300 ms wait (2026-10-06).
    expect(sleeps).toEqual([...Array(3).fill(STABILITY_DELAY_MS), 300]);

    // The same still screen on a rerun is a 0% diff against the settled baseline: two identical captures.
    const second = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(second).toMatchObject({ pass: true, detail: '0.00% of pixels differ' });
    expect(fake.screenshots).toHaveLength(10);
  });
});

describe('screenshot baseline asserts — a frame that did not settle is never a verdict (2026-10-05)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** A screen that never holds still: every capture differs from the last. */
  const neverSettling = () => {
    const fake = dashboardFake();
    let i = 0;
    fake.screenshot = async () => {
      const shot = png(50, 50, (p) => (p.data[0] = i++ % 256));
      fake.screenshots.push(shot);
      return shot;
    };
    return fake;
  };

  it('refuses to CREATE a baseline from a screen that never settled, naming the budget it spent', async () => {
    const fake = neverSettling();
    const verifier = new Verifier(fake, { ...FAST, baselineDir: dir });
    const result = await verifier.assert({ screenshot: { baseline: 'dash' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'baseline not created: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run (a baseline of a moving screen would fail every later run)',
    );
    // The full budget was spent looking (6 captures, 5 waits) and nothing was written.
    expect(fake.screenshots).toHaveLength(6);
    expect(sleeps).toEqual(Array(5).fill(STABILITY_DELAY_MS));
    await expect(readFile(join(dir, 'android', 'dash.png'))).rejects.toThrow();
  });

  it('an unsettled DIFF still compares the last frame and keeps its verdict, carrying the ⚠ frame note (2026-10-05, review)', async () => {
    const still = dashboardFake();
    still.nextScreenshot = png(50, 50);
    await new Verifier(still, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });

    // A caret blinking in one pixel: never two identical captures, but every
    // frame is within the threshold of the baseline — the threshold exists
    // for exactly this, so the diff passes and says what it saw.
    const caret = dashboardFake();
    let i = 0;
    caret.screenshot = async () => {
      const shot = png(50, 50, (p) => (p.data[0] = i++ % 2 === 0 ? 0 : 128));
      caret.screenshots.push(shot);
      return shot;
    };
    const result = await new Verifier(caret, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toBe(
      '0.04% of pixels differ\n⚠ frame: the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run — the last capture is returned as the best available',
    );
    expect(caret.screenshots).toHaveLength(6);
  });

  /**
   * The device case (2026-10-06, docs/bugs/2026-10-06-whole-screen-stability-
   * aliases-a-blinking-caret.md): a caret blinking 500 ms on, 500 ms off, on
   * a device whose screencap takes 650 ms (the Android emulator measured
   * that day). The settled pair lands 950 ms apart — in phase — so the pair
   * alone compares equal, and until this date the assert CREATED a baseline
   * from it. The confirmation window's next captures fall in the other phase.
   */
  const caretDevice = () => {
    const fake = dashboardFake();
    const on = png(50, 50, (p) => p.data.fill(0, 0, 4));
    const off = png(50, 50);
    fake.screenshot = async () => {
      const shot = Date.now() % 1000 < 500 ? on : off;
      fake.screenshots.push(shot);
      vi.setSystemTime(Date.now() + 650);
      return shot;
    };
    return fake;
  };

  it('refuses to CREATE a baseline from a caret screen the settled pair alone would have stored (2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 100 ms into the caret's on-phase.
    vi.setSystemTime(1_000_000_100);
    // The old rule on this very screen: two captures, in phase, settled.
    const pairOnly = await captureFrame(caretDevice());
    expect(pairOnly).toMatchObject({ stability: 'settled', captures: 2 });

    vi.setSystemTime(1_000_000_100);
    resetSleeps();
    const caret = caretDevice();
    const result = await new Verifier(caret, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'baseline not created: the screen did not settle: 4 captures — two consecutive ones matched, then a later confirming capture differed from them — a periodic change such as a blinking caret or a ticking clock, which a matching pair can land in phase with; hide or stop it (unfocus the field, freeze the clock) and re-run (a baseline holding one phase of it would pass or fail every later run by that phase)',
    );
    // The pair (on, on), then the window: on at 2000 ms, off at 2650 ms — refused there.
    expect(caret.screenshots).toHaveLength(4);
    expect(sleeps).toEqual([STABILITY_DELAY_MS, 300]);
    await expect(readFile(join(dir, 'android', 'dash.png'))).rejects.toThrow();
  });

  it('a DIFF against an existing baseline costs what it did: the pair alone, no confirmation window (2026-10-06)', async () => {
    const still = dashboardFake();
    still.nextScreenshot = png(50, 50);
    await new Verifier(still, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000_100);
    resetSleeps();
    const caret = caretDevice();
    const result = await new Verifier(caret, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });
    // In phase, the pair settles and the diff runs on it: two captures, one 300 ms wait. The
    // `⚠ frame:` note stays silent here — the recorded blind spot the bug note names.
    expect(result).toMatchObject({ pass: true, detail: '0.04% of pixels differ' });
    expect(caret.screenshots).toHaveLength(2);
    expect(sleeps).toEqual([STABILITY_DELAY_MS]);
  });
});

describe('the polling asserts and the stability budget (2026-10-05)', () => {
  const CARD = { x: 100, y: 100, width: 800, height: 100 };
  const fill = (p: PNG, hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let y = CARD.y; y < CARD.y + CARD.height; y++) {
      for (let x = CARD.x; x < CARD.x + CARD.width; x++) {
        const o = (y * p.width + x) << 2;
        p.data[o] = r;
        p.data[o + 1] = g;
        p.data[o + 2] = b;
        p.data[o + 3] = 255;
      }
    }
  };
  const cardFake = () => {
    resetLayout();
    return new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: { ...CARD } })) }, 'detail');
  };
  /**
   * The byte offset of a pixel INSIDE the card (its centre; the tree and the
   * png share a scale of 1 here). Since 2026-10-06 the color and ocr asserts
   * judge stability over the element's own region, so an "animation" must
   * move a pixel the assert measures to keep a frame moving: the pixel at
   * (0, 0) these tests painted until then lies outside the card and would
   * now settle — the status-bar clock the change was made for.
   */
  const inCard = (p: PNG) => ((CARD.y + CARD.height / 2) * p.width + CARD.x + CARD.width / 2) << 2;

  it('the stability delay is capture.ts\'s 300 ms whatever pollMs the Verifier was given — one budget for every consumer', async () => {
    const fake = cardFake();
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, '#FDFDFD'));
    // A FlowEngine builds its Verifier with pollMs 500: until 2026-10-05 that
    // became the delay between stability captures, so an assert inside a flow
    // waited 500 where the MCP tool waited 300.
    const verifier = new Verifier(fake, { pollMs: 500, timeoutMs: 100 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(fake.screenshots).toHaveLength(2);
    expect(sleeps).toEqual([STABILITY_DELAY_MS]);
  });

  /**
   * A fake device on a fake clock: a screencap takes 300 ms of virtual time
   * and never returns the same frame twice, the uiautomator dump 1.5 s. The
   * mocked sleep advances the same clock. This is the explorer's 2026-10-05
   * measurement scenario (real Verifier, 3 s timeout, 300 ms poll) replayed
   * deterministically; the real-time figures are on `Verifier.poll`.
   */
  const slowNeverSettling = () => {
    const fake = cardFake();
    let i = 0;
    let treeReads = 0;
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      treeReads += 1;
      vi.setSystemTime(Date.now() + 1500);
      return origTree();
    };
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 300);
      const shot = png(1000, 320, (p) => {
        fill(p, '#FDFDFD');
        p.data[inCard(p)] = i++ % 256;
      });
      fake.screenshots.push(shot);
      return shot;
    };
    return { fake, treeReads: () => treeReads };
  };

  it('a screen that never settles: the deadline, not a moving frame, decides — the capture stops short of it and the failure says the frame never settled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, treeReads } = slowNeverSettling();
    const start = Date.now();
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 3000 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    const elapsed = Date.now() - start;
    expect(result.pass).toBe(false);
    // Before: 4.86 s, 6 captures, 1 evaluation, a verdict ("sampled #…") from a frame nobody knew was moving.
    expect(result.detail).toBe(
      'the screen did not settle: 2 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run; failing closed, color unchecked',
    );
    // Round 1: 1.5 s dump, a capture, one re-capture (600 ms) → 2.4 s; a second re-capture would end at 3.0 s, not taken.
    // Round 2 starts at 2.7 s (inside the deadline — a late element is found by exactly such a round), its dump ends at
    // 4.2 s, and the deadline has passed, so nothing is captured: the overrun is one tree read, never a capture budget.
    expect(elapsed).toBeLessThanOrEqual(3000 + 1500);
    expect(treeReads()).toBe(2);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('a screen that SETTLES in the second round passes — the previous round\'s cost never forbids the next one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake(); // not slowNeverSettling(): its 1.5 s dump leaves no room for a second round
    const start = Date.now();
    let i = 0;
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 300);
      // Moving for the first 3.8 s, then still and the right colour. Each
      // re-capture costs 600 ms on the clock (the 300 ms pause, then a 300 ms
      // screencap), so round 1 (dump 400, captures at 0.7, 1.3, …, 3.7 s)
      // spends its whole budget on the animation and is unsettled; round 2
      // (from 4.0 s) finds the screen still and passes.
      const moving = Date.now() - start < 3800;
      const shot = png(1000, 320, (p) => {
        fill(p, '#FDFDFD');
        if (moving) p.data[inCard(p)] = i++ % 256;
      });
      fake.screenshots.push(shot);
      return shot;
    };
    // The dump must be short enough for two rounds: 400 ms here.
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 400);
      return origTree();
    };
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 6000 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('sampled #FDFDFD');
    expect(fake.screenshots).toHaveLength(8); // 6 in the unsettled round, 2 in the one that passed
  });

  it('when every round is cut before a settled frame could be captured, the failure says the element was FOUND, not "not found"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake } = slowNeverSettling();
    // A dump longer than the whole budget: the element is found, but the
    // round that found it is already past the deadline.
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 4000);
      return origTree();
    };
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 3000 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found, but no time was left within 3000ms to capture a settled frame (the slowest round — a tree read and its captures — took 5500ms here) — raise this assert timeout');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('a round whose first screencap crosses the deadline captures nothing more and says the element was found, no time left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake } = slowNeverSettling();
    // The dump ends 100 ms inside the deadline; the one screencap (300 ms)
    // crosses it, so the stability wait cannot take a second capture — one
    // capture is no verdict on stability and names no capture count.
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 2900 - 1500); // slowNeverSettling's dump adds 1500: ends at 2900
      return origTree();
    };
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 3000 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found, but no time was left within 3000ms to capture a settled frame (the slowest round — a tree read and its captures — took 3200ms here) — raise this assert timeout');
    expect(fake.screenshots).toHaveLength(1);
  });

  it('a settled screen whose assert keeps failing is measured and the measurement is the verdict, within the timeout', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, treeReads } = slowNeverSettling();
    // Still screen: every capture is the same wrong colour.
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 300);
      const shot = png(1000, 320, (p) => fill(p, '#CFCFD3'));
      fake.screenshots.push(shot);
      return shot;
    };
    const start = Date.now();
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 3000 });
    const result = await verifier.assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/sampled #CFCFD3/);
    // Round 1 measures (2.1 s); round 2 starts at 2.4 s, its dump ends past
    // the deadline and nothing is captured — the measured finding stands.
    expect(Date.now() - start).toBeLessThanOrEqual(3000 + 1500);
    expect(treeReads()).toBe(2);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('the ocr assert treats an unsettled frame the same way: a miss, worded as rendered text unchecked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); // only the mocked sleeps move the clock: the full 6-capture budget fits one round
    const fake = cardFake();
    let i = 0;
    fake.screenshot = async () => {
      const shot = png(1000, 320, (p) => (p.data[inCard(p)] = i++ % 256));
      fake.screenshots.push(shot);
      return shot;
    };
    const engine = { recognize: async () => [{ id: 'element', lines: [{ text: 'CONTINUE', box: { x: 0, y: 0, width: 10, height: 10 } }] }] };
    // Round 1's six captures end at 1.5 s; round 2 (from 1.8 s) is cut by the
    // deadline after TWO — and the failure still says six: the most any round
    // took, so a cut round never understates the one that spent the budget.
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 2000, ocrEngine: engine as never });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run; failing closed, rendered text unchecked',
    );
  });

  /**
   * A status-bar clock: the pixel at (0, 0), outside the card, changes on
   * EVERY capture, so no two captures are ever byte-identical; everything
   * else is #FDFDFD. The card's tree is served per read by `rectFor`, so a
   * test can move the element between rounds while every crop stays still.
   */
  const clockScreen = (rectFor: (read: number) => typeof CARD | undefined) => {
    resetLayout();
    const fake = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: { ...CARD } })) }, 'detail');
    const probe = { treeReads: 0 };
    fake.uiTree = async () => {
      probe.treeReads += 1;
      const rect = rectFor(probe.treeReads);
      // undefined: this read's screen has no card at all.
      return rect === undefined ? screen() : screen(node({ identifier: 'card', rect: { ...rect } }));
    };
    let i = 0;
    fake.screenshot = async () => {
      const shot = png(1000, 320, (p) => {
        for (let o = 0; o < p.data.length; o += 4) p.data[o] = p.data[o + 1] = p.data[o + 2] = 0xfd;
        p.data[0] = i++ % 256;
      });
      fake.screenshots.push(shot);
      return shot;
    };
    return { fake, probe };
  };

  it('live content OFF the element does not keep a color assert from settling: the card holds still, and the assert passes once a second read confirms where it is (2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, probe } = clockScreen(() => CARD);
    // Until 2026-10-06 this screen never settled and the assert failed "the
    // screen did not settle: 6 captures …" about pixels it never reads.
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('sampled #FDFDFD');
    // Settled over the card's region only, so the first round is silent (no
    // earlier read to confirm the rect) and the second, whose read agrees,
    // measures: two rounds of a still screen's cost — two captures and one
    // stability wait each — with the poll's pause between them. A first
    // version of this test (review round 1) pinned ONE round: that was the
    // stale-rect window, closed the same day.
    expect(probe.treeReads).toBe(2);
    expect(fake.screenshots).toHaveLength(4);
    expect(sleeps).toEqual([STABILITY_DELAY_MS, 300, STABILITY_DELAY_MS]);
  });

  it('an element that moved between tree reads is not measured on a region-only frame — even though both crops are still — until two reads agree (2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // A slide-in: read 1 puts the card at y 100, every later read at y 150.
    // The screen is #FDFDFD wherever either rect lands, so a crop at the
    // stale rect would sample the right colour — the false pass this guards.
    const moved = { ...CARD, y: 150 };
    const { fake, probe } = clockScreen((read) => (read === 1 ? CARD : moved));
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    // Round 1: no earlier rect, silent. Round 2: the rect changed, a miss.
    // Round 3: two reads agree, measured.
    expect(probe.treeReads).toBe(3);
    expect(fake.screenshots).toHaveLength(6);
  });

  it('an element that moves every round times out on the position-changed sentence, quoting the last two rects (2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, probe } = clockScreen((read) => ({ ...CARD, y: 100 + 10 * read }));
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    // Each round costs 600 ms of virtual time (a 300 ms stability wait, a
    // 300 ms poll pause): rounds 2..5 each find a new rect and miss; round 6
    // reads at 3.0 s, past the deadline, and captures nothing — so the
    // finding is round 5's, reads 4 → 5. Not "not found", not "did not settle".
    expect(probe.treeReads).toBe(6);
    expect(result.detail).toBe(
      'the element moved between tree reads (100,140 800x100 → 100,150 800x100) while only its own region, ' +
        'not the whole screen, held still — the crop may sit where the element was, not where it is; let it come to rest and re-run; ' +
        'failing closed, color unchecked',
    );
    expect(fake.screenshots).toHaveLength(10);
  });

  it('a resize is a move: the same origin with a growing card is never confirmed, and the timeout quotes both sizes (review 2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, probe } = clockScreen((read) => ({ ...CARD, width: 700 + 10 * read }));
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    // The same 600 ms rounds as the moving case above: round 5's finding, reads 4 → 5.
    expect(probe.treeReads).toBe(6);
    expect(result.detail).toBe(
      'the element moved between tree reads (100,100 740x100 → 100,100 750x100) while only its own region, ' +
        'not the whole screen, held still — the crop may sit where the element was, not where it is; let it come to rest and re-run; ' +
        'failing closed, color unchecked',
    );
  });

  it('a poll that ends after ONE region-only round — nothing to confirm it against — says the region held still and there was no time to confirm the position (review 2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, probe } = clockScreen(() => CARD);
    // Round 1 takes its two captures (one 300 ms wait) and ends exactly at
    // the 300 ms deadline, so there is no second round to confirm the rect.
    // A settled frame WAS captured: "no time … to capture a settled frame"
    // would be false, and "not found" falser.
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 300 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'element found and its region held still, but no time was left within 300ms to confirm its position with a second tree read (the slowest round — a tree read and its captures — took 300ms here) — raise this assert timeout or let the screen come to rest',
    );
    expect(probe.treeReads).toBe(1);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('a round CUT after the unconfirmed one decides the wording: the poll ran out before capturing, and the cut sentence says so (review 2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { fake, probe } = clockScreen(() => CARD);
    // Round 1 is unconfirmed and ends at 300 ms, inside a 500 ms deadline;
    // after the 300 ms poll pause, round 2 reads at 600 ms, finds the card,
    // and is past the deadline — it captures nothing. That cut is why the
    // poll ran out, so the cut sentence decides the wording, round cost and all.
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 500 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found, but no time was left within 500ms to capture a settled frame (the slowest round — a tree read and its captures — took 300ms here) — raise this assert timeout');
    expect(probe.treeReads).toBe(2);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('a read that does not find the element breaks the confirmation: found at A, gone, back at A is not two agreeing reads (review 2026-10-06)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // A bottom CTA with the same id at the same rect on consecutive wizard
    // screens, with a read between them that saw neither.
    const { fake, probe } = clockScreen((read) => (read === 2 ? undefined : CARD));
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000 }).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    // Round 1: found, silent. Round 2: not found, no capture. Round 3: found
    // at A again, but the previous read did not have it — silent. Round 4: two
    // consecutive reads agree, measured.
    expect(probe.treeReads).toBe(4);
    expect(fake.screenshots).toHaveLength(6);
  });

  /**
   * The pixel poll's contract (verify/pixel-poll.ts, 2026-10-06): the
   * measurement runs ONLY on a settled, decoded frame. Pinned at the assert
   * surface — the recognizer the ocr assert closes over is the probe, and
   * every frame below would read "CONTINUE" if it were ever handed one.
   */
  const countingEngine = () => {
    const probe = { recognized: 0 };
    const engine = {
      recognize: async (_png: Buffer, regions: { id: string }[]) => {
        probe.recognized += 1;
        return regions.map((r) => ({ id: r.id, lines: [{ text: 'CONTINUE', confidence: 1, x: 0, y: 0, w: 200, h: 30 }] }));
      },
    };
    return { probe, engine };
  };

  it('a moving frame is never measured: no text is recognized and no colour sampled while every capture differs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const moving = () => {
      const fake = cardFake();
      let i = 0;
      fake.screenshot = async () => {
        const shot = png(1000, 320, (p) => {
          fill(p, '#FDFDFD');
          p.data[inCard(p)] = i++ % 256;
        });
        fake.screenshots.push(shot);
        return shot;
      };
      return fake;
    };
    const { probe, engine } = countingEngine();
    const ocr = await new Verifier(moving(), { pollMs: 300, timeoutMs: 2000, ocrEngine: engine }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(ocr.pass).toBe(false);
    expect(ocr.detail).toMatch(/^the screen did not settle: .*; failing closed, rendered text unchecked$/);
    expect(probe.recognized).toBe(0);

    const color = await new Verifier(moving(), { pollMs: 300, timeoutMs: 2000 }).assert({
      element: { id: 'card' },
      color: { expected: '#FDFDFD' },
    });
    expect(color.pass).toBe(false);
    expect(color.detail).toMatch(/^the screen did not settle: .*; failing closed, color unchecked$/);
    expect(color.detail).not.toContain('sampled');
  });

  it('an unjudged frame (one capture, the deadline crossed) is never measured, even when it would pass', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake();
    // A still, correct screen: measured, it would pass. The dump ends 100 ms
    // inside the deadline and the one screencap (300 ms) crosses it.
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 2900);
      return origTree();
    };
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 300);
      const shot = png(1000, 320, (p) => fill(p, '#FDFDFD'));
      fake.screenshots.push(shot);
      return shot;
    };
    const { probe, engine } = countingEngine();
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000, ocrEngine: engine }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found, but no time was left within 3000ms to capture a settled frame (the slowest round — a tree read and its captures — took 3200ms here) — raise this assert timeout');
    expect(fake.screenshots).toHaveLength(1);
    expect(probe.recognized).toBe(0);
  });

  // The load-bearing guard here is the exact detail: without the decode gate
  // the measurement runs and fails earlier than the recognizer (the region
  // builder throws on the missing png), so the verdict reads "OCR failed: …".
  it('an undecodable frame is never measured: the decode error is the verdict and nothing downstream runs', async () => {
    const fake = cardFake();
    fake.nextScreenshot = Buffer.from('not a png');
    const { probe, engine } = countingEngine();
    const result = await new Verifier(fake, { ...FAST, ocrEngine: engine }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/^screenshot PNG decode failed: .*; failing closed, rendered text unchecked$/);
    expect(probe.recognized).toBe(0);
  });

  /**
   * docs/bugs/2026-10-06-pixel-assert-default-timeout-fits-no-round-on-device.md:
   * with the shared 3 s default a color/ocr assert could not pass on the
   * Android emulator even on a still screen. One round there is a 2.7 s
   * uiautomator read plus two 0.65 s screencaps 300 ms apart, and since
   * 4954ab4 the capture honours the deadline (before it, the round overran
   * the 3 s budget by ~1.3 s and that overrun was the only reason it
   * passed). The device numbers below are the ones measured that day; the
   * 1.5 s / 300 ms fakes of `Verifier.poll`'s table are what hid this.
   */
  const deviceTimed = (live: boolean) => {
    const fake = cardFake();
    const origTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 2700);
      return origTree();
    };
    let tick = 0;
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 650);
      const shot = png(1000, 320, (p) => {
        fill(p, '#FDFDFD');
        // A clock or caret OFF the element: the frame settles over the
        // element's region only, so the poll needs a confirming round.
        if (live) p.data[0] = tick++ % 256;
      });
      fake.screenshots.push(shot);
      return shot;
    };
    return fake;
  };

  it('with no timeout configured, a color assert passes on a still screen at device speed (2.7 s read, 0.65 s screencap)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(false);
    const t0 = Date.now();
    const result = await new Verifier(fake).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('sampled #FDFDFD');
    expect(fake.screenshots).toHaveLength(2);
    expect(Date.now() - t0).toBe(4300);
  });

  it('with no timeout configured, a color assert passes at device speed when live content off the element needs the confirming round', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(true);
    const t0 = Date.now();
    const result = await new Verifier(fake).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(fake.screenshots).toHaveLength(4);
    expect(Date.now() - t0).toBe(8900);
  });

  it('an explicit budget smaller than one round still times out, and the sentence names what one round cost', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(false);
    const result = await new Verifier(fake, { timeoutMs: 3000 }).assert({
      element: { id: 'card' },
      color: { expected: '#FDFDFD' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'element found, but no time was left within 3000ms to capture a settled frame (the slowest round — a tree read and its captures — took 3350ms here) — raise this assert timeout',
    );
  });

  it('with no timeout configured, an ocr assert passes on a still screen at device speed too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(false);
    const { probe, engine } = countingEngine();
    const t0 = Date.now();
    const result = await new Verifier(fake, { ocrEngine: engine }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    expect(probe.recognized).toBe(1);
    expect(Date.now() - t0).toBe(4300);
  });

  it('the tree asserts keep the 3 s default — only the pixel asserts pay for a round of captures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // element exists: never found
    expect((await new Verifier(cardFake()).assert({ element: { id: 'ghost' } })).detail).toBe('not found within 3000ms');
    // text content: never found
    const text = await new Verifier(cardFake()).assert({ element: { id: 'ghost' }, text: 'x' });
    expect(text.detail).toBe('not found within 3000ms');
    // rect: never found
    const rect = await new Verifier(cardFake()).assert({ element: { id: 'ghost' }, rect: { x: 100, frameWidth: 1000 } });
    expect(rect.detail).toBe('not found within 3000ms');
    // absent: present the whole time — the poll gives up at 3 s
    const fake = cardFake();
    const t0 = Date.now();
    const absent = await new Verifier(fake, { pollMs: 300 }).assert({ element: { id: 'card' }, absent: true });
    expect(absent.pass).toBe(false);
    expect(Date.now() - t0).toBe(3000);
  });

  it('the timeout sentence quotes the SLOWEST round, not the last one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(true);
    // Round 1: a 3 s read, then the settled pair (0.65 + 0.3 + 0.65) — 4.6 s,
    // settled over the region only, so unconfirmed. Round 2 (after the 300 ms
    // pause): a 0.5 s read, one screencap that crosses the 6 s deadline — cut,
    // 1.15 s. The sentence must name 4600, not 1150.
    const reads = [3000, 500];
    const origTree = FakeAdapter.prototype.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + (reads.shift() ?? 500));
      return origTree();
    };
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 6000 }).assert({
      element: { id: 'card' },
      color: { expected: '#FDFDFD' },
    });
    expect(result.detail).toBe(
      'element found, but no time was left within 6000ms to capture a settled frame (the slowest round — a tree read and its captures — took 4600ms here) — raise this assert timeout',
    );
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

/**
 * docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md:
 * on Android the soft keyboard is a separate window, absent from the tree, so
 * a node under it keeps its at-rest rect — and until this fix a color assert
 * sampled the key faces (#FFFFFF) and an ocr assert read the `?123` key, each
 * reported as the ELEMENT'S. Since 2026-10-06 the pixel poll asks the
 * adapter's keyboard oracle once per round, before any capture
 * (verify/pixel-poll.ts, header). The fake attaches the oracle as a test asks;
 * without one it behaves like iOS — no oracle, nothing queried, nothing
 * changed, which every color/ocr test above pins (e.g. 'passes on a matching
 * fill and reports the sampled hex, dE and scale').
 */
describe('pixel asserts under the Android soft keyboard (2026-10-06)', () => {
  // The device shape, scaled to this file's fixture: a 1000x2000 screen, the
  // card in it, the keyboard docked along the bottom.
  const CARD = { x: 100, y: 200, width: 800, height: 100 };
  const COVERING = { x: 0, y: 250, width: 1000, height: 1750 };
  /** Shown, but below the card: the keyboard is up and the element is not under it. */
  const BELOW = { x: 0, y: 1285, width: 1000, height: 715 };
  /** Flush with the card's bottom edge (y 300): they touch, they share no area. */
  const TOUCHING = { x: 0, y: 300, width: 1000, height: 1700 };
  const COVERED =
    'the soft keyboard covers the element (element 100,200 800x100, keyboard 0,250 1000x1750) — ' +
    'dismiss it (e.g. `dismissKeyboard: true` on the fill, or press back) and re-run';
  const fill = (p: PNG, hex: string): void => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let y = CARD.y; y < CARD.y + CARD.height; y++) {
      for (let x = CARD.x; x < CARD.x + CARD.width; x++) {
        const o = (y * p.width + x) << 2;
        p.data[o] = r;
        p.data[o + 1] = g;
        p.data[o + 2] = b;
        p.data[o + 3] = 255;
      }
    }
  };
  const cardFake = () => {
    resetLayout();
    const fake = new FakeAdapter({ detail: screen(node({ identifier: 'card', rect: { ...CARD } })) }, 'detail');
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, '#3F3F50'));
    return fake;
  };
  /** Every frame would read "CONTINUE" if the recognizer were ever handed one. */
  const countingEngine = () => {
    const probe = { recognized: 0 };
    const engine = {
      recognize: async (_png: Buffer, regions: { id: string }[]) => {
        probe.recognized += 1;
        return regions.map((r) => ({ id: r.id, lines: [{ text: 'CONTINUE', confidence: 1, x: 0, y: 0, w: 200, h: 30 }] }));
      },
    };
    return { probe, engine };
  };
  const SLOW = { pollMs: 300, timeoutMs: 1000 };

  it('a keyboard over the element fails closed with both rects, every round, and nothing is captured or measured', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // The colour the keyboard's keys would give: had it been sampled, it would have passed.
    const color = cardFake();
    color.nextScreenshot = png(1000, 320, (p) => fill(p, '#FFFFFF'));
    color.attachKeyboard({ state: 'shown', frame: COVERING });
    const c = await new Verifier(color, SLOW).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(false);
    // Every round was covered: the covered miss is the timeout's wording — the
    // last finding, which the round the deadline cut (no query, no capture)
    // does not erase.
    expect(c.detail).toBe(`${COVERED}; failing closed, color unchecked`);
    expect(color.screenshots).toHaveLength(0);
    // Reads at 0, 300, 600, 900 ms are asked; the read at 1200 ms is past the deadline and asks nothing.
    expect(color.attachedKeyboard.windowAnswers.queries).toBe(4);
    // Only the window state, never the witness: nothing is pressed here.
    expect(color.attachedKeyboard.witnessAnswers.queries).toBe(0);
    expect(color.keys).toEqual([]);

    const ocr = cardFake();
    ocr.attachKeyboard({ state: 'shown', frame: COVERING });
    const { probe, engine } = countingEngine();
    const o = await new Verifier(ocr, { ...SLOW, ocrEngine: engine }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toBe(`${COVERED}; failing closed, rendered text unchecked`);
    expect(ocr.screenshots).toHaveLength(0);
    expect(probe.recognized).toBe(0);
  });

  it('a keyboard shown elsewhere, or one that only touches the element\'s edge, changes nothing', async () => {
    for (const frame of [BELOW, TOUCHING]) {
      const color = cardFake();
      color.attachKeyboard({ state: 'shown', frame });
      const c = await new Verifier(color, FAST).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } });
      expect(c.pass).toBe(true);
      expect(c.detail).toContain('sampled #3F3F50');
      expect(color.attachedKeyboard.windowAnswers.queries).toBe(1);
      expect(color.screenshots).toHaveLength(2);

      const ocr = cardFake();
      ocr.attachKeyboard({ state: 'shown', frame });
      const { probe, engine } = countingEngine();
      const o = await new Verifier(ocr, { ...FAST, ocrEngine: engine }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
      expect(o.pass).toBe(true);
      expect(probe.recognized).toBe(1);
    }
  });

  it('a hidden keyboard, or an oracle that cannot tell, changes nothing — asked once, then the round goes on as before', async () => {
    for (const state of ['hidden', 'unknown'] as const) {
      const fake = cardFake();
      fake.attachKeyboard({ state });
      const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } });
      expect(result.pass).toBe(true);
      expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
      expect(fake.screenshots).toHaveLength(2);
    }
  });

  it('a keyboard that goes away between rounds costs one round, not the verdict', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake();
    fake.attachKeyboard({ state: 'shown', frame: COVERING }).windowAnswers.queue = [
      { state: 'shown', frame: COVERING },
      { state: 'hidden' },
    ];
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      reads++;
      return real();
    };
    const result = await new Verifier(fake, SLOW).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } });
    expect(result.pass).toBe(true);
    // Round 1: covered, nothing captured. Round 2: hidden, two captures that agree, measured.
    expect(reads).toBe(2);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(2);
    expect(fake.screenshots).toHaveLength(2);
    expect(sleeps).toEqual([SLOW.pollMs, STABILITY_DELAY_MS]);
  });

  /**
   * Review 2026-10-06: covered in round 1, found CLEAR by round 2's query, and
   * round 2's one capture cut by the deadline. The last look said hidden, so
   * "dismiss the keyboard" would be false; the cut sentence is the truth.
   */
  it('a covered miss that a later query contradicted is not the timeout wording — the cut round after it is', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake();
    fake.attachKeyboard({ state: 'shown', frame: COVERING }).windowAnswers.queue = [
      { state: 'shown', frame: COVERING },
      { state: 'hidden' },
    ];
    const realTree = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      vi.setSystemTime(Date.now() + 600);
      return realTree();
    };
    fake.screenshot = async () => {
      vi.setSystemTime(Date.now() + 600);
      const shot = png(1000, 320, (p) => fill(p, '#3F3F50'));
      fake.screenshots.push(shot);
      return shot;
    };
    // Round 1: read 0→600 ms, covered. Pause to 900. Round 2: read to 1500,
    // hidden, one screencap to 2100 — past the 2000 ms deadline, unjudged.
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 2000 }).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'element found, but no time was left within 2000ms to capture a settled frame (the slowest round — a tree read and its captures — took 1200ms here) — raise this assert timeout',
    );
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(2);
    expect(fake.screenshots).toHaveLength(1);
  });

  it('a keyboard that comes back after a clear round is the timeout wording again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake();
    const SHOWN = { state: 'shown' as const, frame: COVERING };
    // Covered at 0 ms; clear at 300 ms, measured and wrong (#3F3F50 is not #FFFFFF); covered again from 900 ms on.
    fake.attachKeyboard(SHOWN).windowAnswers.queue = [SHOWN, { state: 'hidden' }, SHOWN];
    const result = await new Verifier(fake, SLOW).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(`${COVERED}; failing closed, color unchecked`);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(3);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('a real finding made AFTER a contradicted cover is the timeout wording — only the stale cover itself is dropped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = cardFake();
    const SHOWN = { state: 'shown' as const, frame: COVERING };
    // Covered at 0 ms; clear from 300 ms on, measured and wrong (#3F3F50 is
    // not #FFFFFF). The mismatch is the app's finding and must survive the
    // rounds after it: the cover was contradicted, the measurement was not.
    fake.attachKeyboard(SHOWN).windowAnswers.queue = [SHOWN, { state: 'hidden' }];
    const result = await new Verifier(fake, SLOW).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('sampled #3F3F50 (dominant, 100% of region) vs expected #FFFFFF → dE00 61.62 > 8; scale 1.000');
  });
});

/**
 * The same rule from the tree (iOS, 2026-10-07): the WDA source marks the
 * band the keyboard covers with role `keyboard`
 * (tests/adapters/wda-source-keyboard.test.ts), the adapter has no oracle,
 * and the pixel poll reads the band off the round's own tree — no query, no
 * extra read — with a remedy that names no `back`.
 */
describe('pixel asserts under the iOS in-tree keyboard (2026-10-07)', () => {
  const CARD = { x: 100, y: 200, width: 800, height: 100 };
  const COVERING = { x: 0, y: 250, width: 1000, height: 1750 };
  const BELOW = { x: 0, y: 1285, width: 1000, height: 715 };
  const COVERED =
    'the soft keyboard covers the element (element 100,200 800x100, keyboard 0,250 1000x1750) — ' +
    'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the one configured for the guard to tap, before this assert, ' +
    'or `dismissKeyboard: true` on a fill that leaves it up); this adapter cannot hide it on its own (ADVICE)';
  const fill = (p: PNG, hex: string): void => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let y = CARD.y; y < CARD.y + CARD.height; y++) {
      for (let x = CARD.x; x < CARD.x + CARD.width; x++) {
        const o = (y * p.width + x) << 2;
        p.data[o] = r;
        p.data[o + 1] = g;
        p.data[o + 2] = b;
        p.data[o + 3] = 255;
      }
    }
  };
  const iosFake = (band?: { x: number; y: number; width: number; height: number }) => {
    resetLayout();
    const children = [node({ identifier: 'card', rect: { ...CARD } }), ...(band ? [node({ role: KEYBOARD_ROLE, rect: { ...band } })] : [])];
    const fake = new FakeAdapter({ detail: screen(...children) }, 'detail');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.keyboardAdvice = 'ADVICE'; // the adapter's own sentence (IosAdapter has the measured one), quoted by the miss
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, '#FFFFFF')); // the keys' white: had it been sampled, it would have passed
    return fake;
  };
  const SLOW = { pollMs: 300, timeoutMs: 1000 };

  it('a band over the element fails closed every round, naming both rects and the in-tree remedy, and captures nothing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = iosFake(COVERING);
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      reads++;
      return real();
    };
    const c = await new Verifier(fake, SLOW).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(false);
    expect(c.detail).toBe(`${COVERED}; failing closed, color unchecked`);
    expect(fake.screenshots).toHaveLength(0);
    expect(reads).toBe(5); // the rounds' own reads (0, 300, 600, 900 ms asked; 1200 ms past the deadline, asks nothing) — the band costs none of its own
    expect(fake.keys).toEqual([]);

    const ocr = iosFake(COVERING);
    let recognized = 0;
    const engine = {
      recognize: async (_png: Buffer, regions: { id: string }[]) => {
        recognized += 1;
        return regions.map((r) => ({ id: r.id, lines: [{ text: 'CONTINUE', confidence: 1, x: 0, y: 0, w: 200, h: 30 }] }));
      },
    };
    const o = await new Verifier(ocr, { ...SLOW, ocrEngine: engine }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toBe(`${COVERED}; failing closed, rendered text unchecked`);
    expect(recognized).toBe(0);
  });

  it('an element that IS the keyboard\'s UI (under an `ofKeyboard` root, inside the band) is not covered: measured, two captures', async () => {
    resetLayout();
    const kbWindow = node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 1000, height: 2000 }, children: [node({ identifier: 'card', rect: { ...CARD } }), node({ role: KEYBOARD_ROLE, rect: { ...COVERING } })] });
    const fake = new FakeAdapter({ detail: screen(kbWindow) }, 'detail');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, '#FFFFFF'));
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(true);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('an adapter WITH an oracle is not read from the tree: the oracle says hidden, a band in the tree changes nothing (Android untouched)', async () => {
    const fake = iosFake(COVERING);
    fake.platform = 'android';
    fake.attachKeyboard({ state: 'hidden' });
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(true);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('a band elsewhere, or no band at all (parked keyboard, or an idb tree), changes nothing', async () => {
    for (const band of [BELOW, undefined]) {
      const fake = iosFake(band);
      const c = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
      expect(c.pass).toBe(true);
      expect(fake.screenshots).toHaveLength(2);
    }
  });
});
