import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSpecSchema, scanForCrashes, Verifier } from '../../src/verify/assert.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';
import { KEYBOARD_ROLE, type Rect, type UiNode } from '../../src/adapters/types.js';
import { findBySpec } from '../../src/ui-tree/selectors.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import { captureFrame, STABILITY_DELAY_MS } from '../../src/verify/capture.js';
import { OcrUnavailableError } from '../../src/verify/ocr.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';

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

/**
 * A capture (402x874, or `width` x `height`) with the element at `rect` drawn in `hex` on a black screen: what a
 * measured element's capture shows. A screen of one colour reads as the screen beside the element, which under idb —
 * no scroll view listed to say it is drawn there — fails closed (verify/eyes.ts#apartOfFrame).
 */
function drawnAt(rect: Rect, hex: string, { width, height } = { width: 402, height: 874 }): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return png(width, height, (p) => {
    for (let o = 0; o < p.data.length; o += 4) [p.data[o], p.data[o + 1], p.data[o + 2]] = [0, 0, 0];
    for (let y = rect.y; y < rect.y + rect.height; y++) for (let x = rect.x; x < rect.x + rect.width; x++) [p.data[(y * width + x) * 4], p.data[(y * width + x) * 4 + 1], p.data[(y * width + x) * 4 + 2]] = [r!, g!, b!];
  });
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
          // A rendered `text`: identified-unlabeled `other` nodes alone are a BARE tree, where absence is undecided (2026-10-08).
          el({ role: 'text', identifier: 'row_0' }),
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

  it('names a node whose text differs only in typographic punctuation or diacritics, and still fails', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { p: screen(el({ role: 'text', identifier: 'payee', label: 'Payee’s name' })) },
      'p',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { text: "Payee's name" } });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'not found within 0.1 s\n' +
        "  no node has this exact text, but 1 node(s) differ from it only in ' vs ’:\n" +
        '    id=payee label="Payee’s name"\n' +
        '    (the tree carries the app\'s characters exactly, so the assert compares them exactly — ' +
        'expect the text as the node has it)',
    );
  });

  it('names a fold-equal node when the element is found but its content differs only that way', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { p: screen(el({ role: 'text', identifier: 'cta', label: 'Prihlásiť sa' })) },
      'p',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'cta' }, text: 'Prihlásit sa' });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('element found but content was: "Prihlásiť sa"');
    expect(result.detail).toContain('differ from it only in t vs ť');
  });

  it('names a node whose letter an expectation copied from a reading has as its look-alike, expectation first', async () => {
    resetLayout();
    const fake = new FakeAdapter({ p: screen(el({ role: 'text', identifier: 'name', label: 'Ľubomír' })) }, 'p');
    const result = await new Verifier(fake, FAST).assert({ element: { text: "L'ubomír" } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain("no node has this exact text, but 1 node(s) differ from it only in L' vs Ľ:");
  });

  it('names no node whose text is the look-alike of the letter expected — the node is the copy', async () => {
    resetLayout();
    const fake = new FakeAdapter({ p: screen(el({ role: 'text', identifier: 'name', label: "L'ubomír" })) }, 'p');
    const result = await new Verifier(fake, FAST).assert({ element: { text: 'Ľubomír' } });
    expect(result.pass).toBe(false);
    expect(result.detail).not.toContain('differ from it only in');
  });

  it('names the character that differs even when the node also keeps it elsewhere', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { p: screen(el({ role: 'text', identifier: 'bob', label: 'it’s Bob’s' })) },
      'p',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { text: "it's Bob’s" } });
    expect(result.detail).toContain("differ from it only in ' vs ’:");
  });

  it('prints the field that differs only by the fold — a field\'s value is shown as value=', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { p: screen(el({ role: 'textfield', identifier: 'payee', label: 'Payee', value: 'Bob’s' })) },
      'p',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'payee' }, text: "Bob's" });
    expect(result.detail).toContain('    id=payee value="Bob’s"');
  });

  it('stays quiet for a node that differs outside the fold', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { p: screen(el({ role: 'text', identifier: 'payee', label: 'Payee’s game' })) },
      'p',
    );
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'payee' }, text: "Payee's name" });
    expect(result.detail).toBe('element found but content was: "Payee’s game"');
  });

  it('stays quiet when the string is genuinely absent — no hint to invent', async () => {
    const result = await new Verifier(dashboardFake(), FAST).assert({ element: { text: 'Nowhere' } });
    expect(result.detail).toBe('not found within 0.1 s');
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
    const result = await new Verifier(fake, { ...FAST, ocr: { engine: engine('CONTINUE') } }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe(
      'element rect 100,500 800x100 scaled by 1.000 leaves nothing on-screen; failing closed, rendered text unchecked',
    );
  });

  it('passes on the rendered string and says what it read', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine('CONTINUE') } });
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
    const verifier = new Verifier(sheetFake(), { ...FAST, ocr: { engine: engine('CONTINUE') } });
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
    const verifier = new Verifier(fake, { ...FAST, ocr: { engine: engine('CONTINUE') } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/CONTENT width.*failing closed, rendered text unchecked/);
  });

  it('still reads the tree when the device will not report a screen — a failed read is not a failed assert', async () => {
    const fake = cardFake();
    fake.viewport = async () => {
      throw new Error('idb describe: no such device');
    };
    const verifier = new Verifier(fake, { ...FAST, ocr: { engine: engine('CONTINUE') } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('read "CONTINUE"');
  });

  it('fails with a timeout detail when the element never appears (no screenshot burned)', async () => {
    const fake = cardFake();
    const verifier = new Verifier(fake, { ...FAST, ocr: { engine: engine('CONTINUE') } });
    const result = await verifier.assert({ element: { id: 'ghost' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('not found within');
    expect(fake.screenshots).toHaveLength(0);
  });

  it('fails closed (with the decode error) when the screenshot is not decodable', async () => {
    const fake = cardFake();
    fake.nextScreenshot = Buffer.from('not a png');
    const verifier = new Verifier(fake, { ...FAST, ocr: { engine: engine('CONTINUE') } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toMatch(/screenshot PNG decode failed: .*; failing closed, rendered text unchecked/);
  });

  it('fails on drift and quotes both sides', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine('0.00') } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'Enter amount' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('read "0.00"');
    expect(result.detail).toContain('vs expected "Enter amount"');
  });

  it('checks rendered ink height in % of screen width (screen 1000 wide, png 1000 → 30px = 3.00%)', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine('CONTINUE', 30) } });
    const ok = await verifier.assert({ element: { id: 'card' }, ocr: { heightPct: 3.0 } });
    expect(ok.pass).toBe(true);
    expect(ok.detail).toContain('ink height 3.00% of width');

    const tooBig = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine('CONTINUE', 41) } });
    const bad = await tooBig.assert({ element: { id: 'card' }, ocr: { heightPct: 3.0 } });
    expect(bad.pass).toBe(false);
  });

  it('fails closed when the recognizer read nothing — unread is not verified-as-empty', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine(undefined) } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('failing closed');
  });

  it('fails closed when the recognizer itself throws, naming the reason', async () => {
    const engineThrows = { recognize: async () => { throw new Error('swiftc not found'); } };
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engineThrows } });
    const result = await verifier.assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('swiftc not found');
  });

  /**
   * Review 2026-10-07 (assert-capture-ocr C2): the measure's catch turned
   * every recognizer throw into a miss, so a host without `swiftc` polled the
   * whole 12 s default before saying so. An `OcrUnavailableError` now ends
   * the assert after its one read, fail-closed, in the shape a refused
   * capture does (2794f5e) — and a passing element assert after it in the
   * same batch is still evaluated. The read count is the guard: a poll that
   * went on would read again every few ms of its 2 s budget.
   */
  it('an engine that will never read ends the assert after one read, and the batch goes on', async () => {
    let reads = 0;
    const missing = {
      recognize: async () => {
        reads += 1;
        throw new OcrUnavailableError('OCR needs the Swift compiler: `swiftc --version` failed — install the Xcode Command Line Tools.');
      },
    };
    const results = await new Verifier(cardFake(), { pollMs: 5, timeoutMs: 2_000, ocr: { engine: missing } }).assertAll([
      { element: { id: 'card' }, ocr: { text: 'CONTINUE' } },
      { element: { id: 'card' } },
    ]);
    expect(results.map((r) => r.pass)).toEqual([false, true]);
    expect(results[0].detail).toBe(
      'OCR failed: OCR needs the Swift compiler: `swiftc --version` failed — install the Xcode Command Line Tools; ' +
        'failing closed, rendered text unchecked',
    );
    expect(reads).toBe(1);
  });

  it('…while one failed read is a miss: the poll reads again, and the deadline quotes it in the one sentence', async () => {
    let reads = 0;
    const flaky = {
      recognize: async () => {
        reads += 1;
        throw new Error('recognizer exited 2');
      },
    };
    const result = await new Verifier(cardFake(), { ...FAST, ocr: { engine: flaky } }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result).toMatchObject({ pass: false, detail: 'OCR failed: recognizer exited 2; failing closed, rendered text unchecked' });
    expect(reads).toBeGreaterThan(1);
  });

  it('a missing element times out like every other assert', async () => {
    const verifier = new Verifier(cardFake(), { ...FAST, ocr: { engine: engine('CONTINUE') } });
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

  it('samples only the part of the element its scroll view draws (a WDA tree\'s drawn frame): a card running past its list\'s bottom at 240 is read above it, not on what shows below', async () => {
    resetLayout();
    const list = node({ role: 'scrollable', identifier: 'list', rect: { x: 0, y: 0, width: 1000, height: 240 }, children: [node({ identifier: 'card', rect: { ...CARD } })] });
    const fake = new FakeAdapter({ detail: { ...screen(list), unclippedFrames: true } }, 'detail');
    // The card's drawn part (200–240) in its fill; below the list, 240–300, the screen's own background.
    fake.nextScreenshot = png(1000, 320, (p) => {
      fill(p, '#FDFDFD', { ...CARD, height: 40 });
      fill(p, '#20242C', { ...CARD, y: 240, height: 60 });
    });
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.pass).toBe(true);
    expect(result.detail).toContain('sampled #FDFDFD (dominant, 100% of region)');
  });

  it('on a root of no area and no device screen, nothing is cut: the sampler reads the whole card, as the judge judged it, not only the part its list draws', async () => {
    resetLayout();
    const list = node({ role: 'scrollable', identifier: 'list', rect: { x: 0, y: 0, width: 1000, height: 240 }, children: [node({ identifier: 'card', rect: { ...CARD } })] });
    const root = node({ role: 'application', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [list] });
    const fake = new FakeAdapter({ detail: { ...root, unclippedFrames: true } }, 'detail');
    fake.viewport = async () => {
      throw new Error('no device screen');
    };
    // The list's part (200–240) light, the rest (240–300) dark: the whole card's inset region is mostly dark.
    fake.nextScreenshot = png(1000, 320, (p) => {
      fill(p, '#FDFDFD', { ...CARD, height: 40 });
      fill(p, '#20242C', { ...CARD, y: 240, height: 60 });
    });
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#20242C' } });
    expect(result.detail).toContain('sampled #20242C');
    expect(result.pass).toBe(true);
  });

  it('on a root of no area WITH a device screen, the sampler reads the region of the screen the judge judged on: the card\'s part its list draws, not the whole card', async () => {
    resetLayout();
    const list = node({ role: 'scrollable', identifier: 'list', rect: { x: 0, y: 0, width: 1000, height: 240 }, children: [node({ identifier: 'card', rect: { ...CARD } })] });
    const root = node({ role: 'application', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [list] });
    const fake = new FakeAdapter({ detail: { ...root, unclippedFrames: true } }, 'detail');
    fake.viewportSize = { width: 1000, height: 320 };
    // The list's part (200–240) light, the rest (240–300) dark: judged on the device's screen, only the light part is drawn.
    fake.nextScreenshot = png(1000, 320, (p) => {
      fill(p, '#FDFDFD', { ...CARD, height: 40 });
      fill(p, '#20242C', { ...CARD, y: 240, height: 60 });
    });
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FDFDFD' } });
    expect(result.detail).toContain('sampled #FDFDFD');
    expect(result.pass).toBe(true);
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
    expect(result.detail).toBe('element found, but no time was left within 3 s to capture a settled frame (the slowest round — a tree read and its captures — took 5.5 s here) — raise this assert timeout');
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
    expect(result.detail).toBe('element found, but no time was left within 3 s to capture a settled frame (the slowest round — a tree read and its captures — took 3.2 s here) — raise this assert timeout');
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
    const verifier = new Verifier(fake, { pollMs: 300, timeoutMs: 2000, ocr: { engine: engine as never } });
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
      'element found and its region held still, but no time was left within 0.3 s to confirm its position with a second tree read (the slowest round — a tree read and its captures — took 0.3 s here) — raise this assert timeout or let the screen come to rest',
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
    expect(result.detail).toBe('element found, but no time was left within 0.5 s to capture a settled frame (the slowest round — a tree read and its captures — took 0.3 s here) — raise this assert timeout');
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
    const ocr = await new Verifier(moving(), { pollMs: 300, timeoutMs: 2000, ocr: { engine } }).assert({
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
    const result = await new Verifier(fake, { pollMs: 300, timeoutMs: 3000, ocr: { engine } }).assert({
      element: { id: 'card' },
      ocr: { text: 'CONTINUE' },
    });
    expect(result.pass).toBe(false);
    expect(result.detail).toBe('element found, but no time was left within 3 s to capture a settled frame (the slowest round — a tree read and its captures — took 3.2 s here) — raise this assert timeout');
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
    const result = await new Verifier(fake, { ...FAST, ocr: { engine } }).assert({
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
      'element found, but no time was left within 3 s to capture a settled frame (the slowest round — a tree read and its captures — took 3.35 s here) — raise this assert timeout',
    );
  });

  it('with no timeout configured, an ocr assert passes on a still screen at device speed too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = deviceTimed(false);
    const { probe, engine } = countingEngine();
    const t0 = Date.now();
    const result = await new Verifier(fake, { ocr: { engine } }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
    expect(result.pass).toBe(true);
    expect(probe.recognized).toBe(1);
    expect(Date.now() - t0).toBe(4300);
  });

  it('the tree asserts keep the 3 s default — only the pixel asserts pay for a round of captures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // element exists: never found
    expect((await new Verifier(cardFake()).assert({ element: { id: 'ghost' } })).detail).toBe('not found within 3 s');
    // text content: never found
    const text = await new Verifier(cardFake()).assert({ element: { id: 'ghost' }, text: 'x' });
    expect(text.detail).toBe('not found within 3 s');
    // rect: never found
    const rect = await new Verifier(cardFake()).assert({ element: { id: 'ghost' }, rect: { x: 100, frameWidth: 1000 } });
    expect(rect.detail).toBe('not found within 3 s');
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
      'element found, but no time was left within 6 s to capture a settled frame (the slowest round — a tree read and its captures — took 4.6 s here) — raise this assert timeout',
    );
  });
});

describe('assertSpecSchema', () => {
  // Architecture review 2026-10-07 (assert-capture-ocr C3): a `match` that
  // does not compile used to pass the schema and fail mid-run — an element
  // assert threw out of assertAll a few ms in, losing the batch's other
  // results, and an ocr assert polled its whole 12 s budget as "OCR failed".
  // The schema is now where that mistake is caught, naming the field.
  it.each([
    ['element match', { element: { id: 'x' }, match: '(' }, ['match']],
    ['ocr match', { element: { id: 'x' }, ocr: { match: '(' } }, ['ocr', 'match']],
  ])('rejects an %s that is not a valid regex, at the field, with the engine\'s own diagnosis', (_, spec, path) => {
    const result = assertSpecSchema.safeParse(spec);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path, message: expect.stringMatching(/^not a valid regular expression — .*Unterminated group/) }),
    ]);
  });

  it('accepts a valid match on either kind — the refinement judges the pattern, not the field', () => {
    expect(assertSpecSchema.parse({ element: { id: 'x' }, match: '^Pay \\d+' })).toBeDefined();
    expect(assertSpecSchema.parse({ element: { id: 'x' }, ocr: { match: 'CONT(INUE)?' } })).toBeDefined();
  });

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
    const o = await new Verifier(ocr, { ...SLOW, ocr: { engine } }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
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
      const o = await new Verifier(ocr, { ...FAST, ocr: { engine } }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
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

  it('a FLOATING keyboard (2026-10-08): its panel over the element is the same covered miss, quoting the panel — the band below it covers nothing here', async () => {
    // The measured shape (docs/bugs/2026-10-05-android-floating-gboard-keyboard.md): the band a strip at the
    // bottom, the panel mid-screen — a second rect of the IME window's region, read once the band is up.
    const PANEL = { x: 300, y: 150, width: 400, height: 300 };
    const fake = cardFake();
    fake.nextScreenshot = png(1000, 320, (p) => fill(p, '#FFFFFF'));
    fake.attachKeyboard({ state: 'shown', frame: BELOW });
    fake.attachedKeyboard.touchableAnswers.current = { witness: 'shown', region: [PANEL, BELOW] };
    const result = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#FFFFFF' } });
    expect(result.pass).toBe(false);
    expect(result.detail).toContain('the soft keyboard covers the element (element 100,200 800x100, keyboard 300,150 400x300)');
    expect(fake.screenshots).toHaveLength(0);
    expect(fake.attachedKeyboard.touchableAnswers.queries).toBeGreaterThan(0);

    // The input method not saying shown in the same call: no panel, the band alone — measured as before.
    const unconfirmed = cardFake();
    unconfirmed.attachKeyboard({ state: 'shown', frame: BELOW });
    unconfirmed.attachedKeyboard.touchableAnswers.current = { witness: 'unknown', region: [PANEL, BELOW] };
    expect((await new Verifier(unconfirmed, FAST).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } })).pass).toBe(true);
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
      'element found, but no time was left within 2 s to capture a settled frame (the slowest round — a tree read and its captures — took 1.2 s here) — raise this assert timeout',
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
    'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the screen title, before this assert, ' +
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
    const o = await new Verifier(ocr, { ...SLOW, ocr: { engine } }).assert({ element: { id: 'card' }, ocr: { text: 'CONTINUE' } });
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

/**
 * Round 8 (N2, docs/bugs/2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md; the owner's
 * decision: fail closed): a pixel assert's element under something of the app drawn over it — the tap's covers,
 * ui-tree/draw-order.ts#exposure — or under the status band fails closed, as the keyboard case does, naming what
 * lies over it; nothing is captured. Measured on the iPhone 17 (402x874, a 62-pt band): a colour assert on
 * `value_date_select` at 24,30 PASSED on the status bar's #EFF1F4, its ocr read the bar's "Contacts"; one under
 * CONTINUE sampled CONTINUE's #91919A. The same shapes, through the idb parser.
 */
describe('pixel asserts under chrome drawn over the element (round 8)', async () => {
  const FORM = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
  const MODAL = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')).screens as Record<string, unknown[]>;
  /** CONTINUE as the miss names it: its frame, and its reach — the pinned bar's, run down to the screen's bottom (draw-order.ts#pinnedReach). */
  const CONTINUE = 'button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)';
  const REMEDY = 'the capture would show it, not the element; scroll_until the element with `fully: true` first and re-run';
  /** idb's flat list cannot say whether the element scrolls (geometry.ts#Clips.inScroller): the remedy names a child clear of it too. */
  const OR_CHILD = `${REMEDY} — or, if no scroll moves it out from under that, assert something in it that lies clear of that`;
  const IPHONE = { width: 402, height: 874, statusBand: 62 };
  /** The whole screen one colour: what the bar or the button would give the sampler. */
  const solid = (hex: string) =>
    png(402, 874, (p) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      for (let o = 0; o < p.data.length; o += 4) [p.data[o], p.data[o + 1], p.data[o + 2]] = [r, g, b];
    });
  /** The SWIFT form as idb lists it, in `app`'s window, with `extra` elements in content order (after the title, before CONTINUE). */
  const swiftFormIn = (app: Record<string, unknown>, ...extra: Record<string, unknown>[]) => {
    const elements = [app, ...FORM.slice(1, 3), ...extra, ...FORM.slice(3)];
    const fake = new FakeAdapter({ form: parseIdbDescribeAll(JSON.stringify(elements)) }, 'form');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { ...IPHONE };
    return fake;
  };
  const swiftForm = (...extra: Record<string, unknown>[]) => swiftFormIn(FORM[0], ...extra);
  const VALUE_DATE = { type: 'Button', AXLabel: 'Value date', AXUniqueId: 'swift_payment.form.value_date_select', AXValue: null, frame: { x: 24, y: 30, width: 354, height: 52 } };
  const MESSAGE = { type: 'StaticText', AXLabel: 'Message for my bank', AXUniqueId: null, AXValue: null, frame: { x: 42, y: 778, width: 160, height: 20 } };
  const engineReading = (text: string) => {
    const probe = { recognized: 0 };
    const engine = {
      recognize: async (_png: Buffer, regions: { id: string }[]) => {
        probe.recognized += 1;
        return regions.map((r) => ({ id: r.id, lines: [{ text, confidence: 1, x: 0, y: 0, w: 200, h: 30 }] }));
      },
    };
    return { probe, engine };
  };

  it('the measured status-band case (value_date_select at 24,30 under the 62-pt band): the colour assert no longer PASSES on the bar\'s #EFF1F4 — it fails closed naming the band, nothing captured', async () => {
    const fake = swiftForm(VALUE_DATE);
    fake.nextScreenshot = solid('#EFF1F4');
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'swift_payment.form.value_date_select' }, color: { expected: '#FDFDFD', deltaE: 8, sample: 'dominant' } });
    expect(c.pass).toBe(false);
    expect(c.detail).toBe(`the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — ${OR_CHILD}; failing closed, color unchecked`);
    expect(fake.screenshots).toHaveLength(0);

    // …and the ocr assert does not read the bar's breadcrumb as the element's copy.
    const ocr = swiftForm(VALUE_DATE);
    const { probe, engine } = engineReading('Contacts');
    const o = await new Verifier(ocr, { ...FAST, ocr: { engine } }).assert({ element: { id: 'swift_payment.form.value_date_select' }, ocr: { text: 'Value date' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toBe(`the status bar is drawn over the element (element 24,30 354x52, status bar 0,0 402x62) — ${OR_CHILD}; failing closed, rendered text unchecked`);
    expect(probe.recognized).toBe(0);
  });

  it('the measured CONTINUE case ("Message for my bank" at 42,778 under CONTINUE at 24,780): fails closed naming the button — not a colour the element was blamed for', async () => {
    const fake = swiftForm(MESSAGE);
    fake.nextScreenshot = solid('#91919A');
    const c = await new Verifier(fake, FAST).assert({ element: { text: 'Message for my bank' }, color: { expected: '#91919A' } });
    expect(c.pass).toBe(false);
    expect(c.detail).toBe(`${CONTINUE} is drawn over the element (element 42,778 160x20) — ${OR_CHILD}; failing closed, color unchecked`);
    expect(fake.screenshots).toHaveLength(0);

    const ocr = swiftForm(MESSAGE);
    const { probe, engine } = engineReading('Message for my bank');
    const o = await new Verifier(ocr, { ...FAST, ocr: { engine } }).assert({ element: { text: 'Message for my bank' }, ocr: { text: 'Message for my bank' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toBe(`${CONTINUE} is drawn over the element (element 42,778 160x20) — ${OR_CHILD}; failing closed, rendered text unchecked`);
    expect(probe.recognized).toBe(0);
  });

  it('an ocr target under a navigation title laid after the content (a nested tree): fails closed naming the title', async () => {
    resetLayout();
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const row = node({ role: 'text', identifier: 'row_label', label: 'Payee', rect: { x: 24, y: 70, width: 354, height: 30 } });
    const title = node({ role: 'text', label: 'SWIFT PAYMENT', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const tree = node({
      role: 'application',
      rect: full,
      children: [node({ role: 'scrollable', rect: full, children: [row] }), node({ role: 'other', rect: { x: 0, y: 62, width: 402, height: 54 }, children: [title] })],
    });
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { ...IPHONE };
    fake.nextScreenshot = solid('#FFFFFF');
    const { probe, engine } = engineReading('Payee');
    const o = await new Verifier(fake, { ...FAST, ocr: { engine } }).assert({ element: { id: 'row_label' }, ocr: { text: 'Payee' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toBe(`text "SWIFT PAYMENT" (135,73 131x22) is drawn over the element (element 24,70 354x30) — ${REMEDY}; failing closed, rendered text unchecked`);
    expect(probe.recognized).toBe(0);
  });

  it('the remedy names a child clear of it where no scroll may cure it: the same row in no scroll view (pinned under the bar), or a cover that holds the element whole', async () => {
    resetLayout();
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const title = node({ role: 'text', label: 'SWIFT PAYMENT', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const bar = node({ role: 'other', rect: { x: 0, y: 62, width: 402, height: 54 }, children: [title] });
    const judged = async (row: UiNode, inScrollView: boolean) => {
      const tree = node({ role: 'application', rect: full, children: [inScrollView ? node({ role: 'scrollable', rect: full, children: [row] }) : row, bar] });
      const fake = new FakeAdapter({ s: tree }, 's');
      fake.platform = 'ios';
      fake.keyboard = undefined;
      fake.viewportSize = { ...IPHONE };
      return (await new Verifier(fake, FAST).assert({ element: { id: 'row_label' }, color: { expected: '#FFFFFF' } })).detail;
    };
    expect(await judged(node({ role: 'text', identifier: 'row_label', rect: { x: 24, y: 70, width: 354, height: 30 } }), false)).toBe(
      `text "SWIFT PAYMENT" (135,73 131x22) is drawn over the element (element 24,70 354x30) — ${OR_CHILD}; failing closed, color unchecked`,
    );
    expect(await judged(node({ role: 'text', identifier: 'row_label', rect: { x: 150, y: 76, width: 60, height: 16 } }), true)).toBe(
      `text "SWIFT PAYMENT" (135,73 131x22) is drawn over the element (element 150,76 60x16) — ${OR_CHILD}; failing closed, color unchecked`,
    );
  });

  it('a screen-sized element is judged too (review of fix/r8-pixel, round 2): a colour assert on a root under a near-fullscreen dialog, and an ocr assert on a root reading the status bar\'s "Contacts", fail closed', async () => {
    resetLayout();
    const full = { x: 0, y: 0, width: 1080, height: 2220 };
    const root = node({ identifier: 'root', rect: { ...full }, children: [node({ role: 'text', label: 'Content', rect: { x: 66, y: 300, width: 900, height: 100 } })] });
    const dialog = node({ rect: { ...full }, children: [node({ role: 'button', rect: { ...full } }), node({ label: 'Dialog', rect: { x: 90, y: 200, width: 900, height: 1800 } })] });
    const android = new FakeAdapter({ s: node({ rect: { ...full }, children: [root, dialog] }) }, 's');
    android.viewportSize = { width: 1080, height: 2220, statusBand: 66 };
    android.nextScreenshot = png(1080, 2220);
    const c = await new Verifier(android, FAST).assert({ element: { id: 'root' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/is drawn over the element \(element 0,0 1080x2220\) — the capture would show it/);
    expect(android.screenshots).toHaveLength(0);

    const window = node({ identifier: 'screen', rect: { x: 0, y: 0, width: 402, height: 874 } });
    const ios = new FakeAdapter({ s: node({ role: 'application', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [window] }) }, 's');
    ios.platform = 'ios';
    ios.keyboard = undefined;
    ios.viewportSize = { ...IPHONE };
    ios.nextScreenshot = solid('#FFFFFF');
    const { probe, engine } = engineReading('Contacts');
    const o = await new Verifier(ios, { ...FAST, ocr: { engine } }).assert({ element: { id: 'screen' }, ocr: { text: 'Contacts' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toMatch(/^the status bar is drawn over the element \(element 0,0 402x874, status bar 0,0 402x62\)/);
    expect(probe.recognized).toBe(0);
    // …while a colour assert on the same window samples 12 % down, below the band, and is measured.
    const colour = await new Verifier(ios, FAST).assert({ element: { id: 'screen' }, color: { expected: '#FFFFFF' } });
    expect([colour.pass, colour.detail]).toEqual([true, expect.stringContaining('sampled #FFFFFF')]);
  });

  it('the Android navigation band (D7): the Settings title flush with it fails an ocr assert closed, nothing recognized — a colour assert on it is measured', async () => {
    resetLayout();
    const title = node({ role: 'text', identifier: 'title', label: 'Sound & vibration', rect: { x: 198, y: 2105, width: 428, height: 49 } });
    const list = node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 596, width: 1080, height: 1558 }, children: [node({ rect: { x: 0, y: 2072, width: 1080, height: 82 }, children: [title] })] });
    const android = new FakeAdapter({ s: node({ rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [list] }) }, 's');
    android.viewportSize = { width: 1080, height: 2220, statusBand: 66, navigationBand: 2154 };
    android.nextScreenshot = png(1080, 2220);
    const { probe, engine } = engineReading('Sound & vibration');
    const o = await new Verifier(android, { ...FAST, ocr: { engine } }).assert({ element: { id: 'title' }, ocr: { text: 'Sound & vibration' } });
    expect(o.pass).toBe(false);
    expect(o.detail).toMatch(/^the element may be cut at the navigation bar \(element 198,2105 428x49, navigation bar from y 2154\): .* — scroll it up: .*; failing closed, rendered text unchecked$/);
    expect(probe.recognized).toBe(0);
    const c = await new Verifier(android, FAST).assert({ element: { id: 'title' }, color: { expected: '#FFFFFF' } });
    expect(c.detail).toContain('sampled #FFFFFF');
  });

  it('a container element: its own descendants are never covers — measured as before', async () => {
    resetLayout();
    const card = node({
      identifier: 'card',
      rect: { x: 24, y: 200, width: 354, height: 100 },
      children: [node({ role: 'text', label: 'Title', rect: { x: 40, y: 210, width: 200, height: 20 } }), node({ role: 'button', label: 'Go', rect: { x: 300, y: 250, width: 60, height: 40 } })],
    });
    const fake = new FakeAdapter({ s: node({ role: 'application', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [card] }) }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { ...IPHONE };
    fake.nextScreenshot = solid('#3F3F50');
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'card' }, color: { expected: '#3F3F50' } });
    expect(c.pass).toBe(true);
    expect(fake.screenshots).toHaveLength(2);
  });

  it('the non-covers the tap was taught stay non-covers: idb\'s modal listed before the content, and the form\'s rows clear of CONTINUE, are measured', async () => {
    for (const [screen, id] of [
      ['chooser', 'accounts.detail.payment_type_sheet.row_own'],
      ['chooser', 'accounts.detail.payment_type_sheet.row_swift'],
      ['valueDatePicker', 'swift_payment.form.value_date_picker'],
      ['valueDatePicker', 'swift_payment.form.fees_select'],
    ] as const) {
      const tree = parseIdbDescribeAll(JSON.stringify(MODAL[screen]));
      const fake = new FakeAdapter({ s: tree }, 's');
      fake.platform = 'ios';
      fake.keyboard = undefined;
      fake.viewportSize = { ...IPHONE };
      fake.nextScreenshot = drawnAt(findBySpec(tree, { id })[0]!.rect, '#FDFDFD');
      const c = await new Verifier(fake, FAST).assert({ element: { id }, color: { expected: '#FDFDFD' } });
      expect([id, c.pass, c.detail]).toEqual([id, true, expect.stringContaining('sampled #FDFDFD')]);
    }
  });

  it('no status band (Android today, a landscape window, or a device size that cannot be read): an element at the top is measured as before', async () => {
    for (const shape of ['android', 'landscape', 'unread'] as const) {
      const fake = swiftFormIn(shape === 'landscape' ? { ...FORM[0], frame: { x: 0, y: 0, width: 874, height: 402 } } : FORM[0], VALUE_DATE);
      // The device reports its panel as built; a window held sideways turns it (geometry.ts#windowTurnsScreen), and a landscape screen has no band.
      if (shape === 'android') fake.viewportSize = { width: 402, height: 874 };
      if (shape === 'unread') {
        fake.viewport = async () => {
          throw new Error('idb describe: no screen_dimensions');
        };
      }
      fake.nextScreenshot = drawnAt(VALUE_DATE.frame, '#FDFDFD', shape === 'landscape' ? { width: 874, height: 402 } : undefined);
      const c = await new Verifier(fake, FAST).assert({ element: { id: 'swift_payment.form.value_date_select' }, color: { expected: '#FFFFFF' } });
      expect([shape, c.detail]).toEqual([shape, expect.stringContaining('vs expected #FFFFFF')]);
    }
  });

  it('a finding like the keyboard\'s: an element scrolled out from under CONTINUE between rounds is measured — the cover cost one round, not the verdict', async () => {
    const fake = swiftForm(MESSAGE);
    // Drawn where it comes to rest, clear of CONTINUE.
    fake.nextScreenshot = drawnAt({ ...MESSAGE.frame, y: 700 }, '#FDFDFD');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      const tree = await real();
      // From the second read on, the label sits clear of CONTINUE.
      if (++reads >= 2) tree.children.find((n) => n.label === 'Message for my bank')!.rect.y = 700;
      return tree;
    };
    const c = await new Verifier(fake, FAST).assert({ element: { text: 'Message for my bank' }, color: { expected: '#FDFDFD' } });
    expect(c.pass).toBe(true);
    expect(reads).toBe(2); // covered, nothing captured; then clear at 700, two captures that agree, measured
    expect(fake.screenshots).toHaveLength(2);
  });

  it('the keyboard is asked first: an element under both the in-tree keyboard band and a cover reads as under the keyboard', async () => {
    const fake = swiftForm(MESSAGE);
    fake.live().children.push(node({ role: KEYBOARD_ROLE, rect: { x: 0, y: 589, width: 402, height: 285 } }));
    fake.keyboardAdvice = 'ADVICE';
    const c = await new Verifier(fake, FAST).assert({ element: { text: 'Message for my bank' }, color: { expected: '#FDFDFD' } });
    expect(c.pass).toBe(false);
    expect(c.detail).toMatch(/^the soft keyboard covers the element \(element 42,778 160x20, keyboard 0,589 402x285\)/);
  });
});

/**
 * D2, the owner's decision: idb's keyboard band is a keyboard line for the pixel assert — an element under it gets the keyboard's
 * remedy, never a key named as its cover and never a measurement of keyboard pixels; a key itself is the keyboard's own UI.
 */
describe('pixel asserts under idb\'s keyboard band (D2)', async () => {
  const PAD = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements as { AXUniqueId?: string | null; AXLabel?: string | null; frame: Record<string, number> }[];
  const KEYBOARD_REMEDY =
    'hide it first and re-run (in a flow: a tap: step on an element that hides it, such as the screen title, before this assert, ' +
    'or `dismissKeyboard: true` on a fill that leaves it up); this adapter cannot hide it on its own (ADVICE); failing closed, color unchecked';
  /** The number pad (band 0,589 402x285), value_date_select moved to `y`. */
  const pad = (y: number) => {
    const elements = PAD.map((e) => (e.AXUniqueId === 'swift_payment.form.value_date_select' ? { ...e, frame: { ...e.frame, y } } : e));
    const fake = new FakeAdapter({ form: parseIdbDescribeAll(JSON.stringify(elements)) }, 'form');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.keyboardAdvice = 'ADVICE';
    fake.viewportSize = { width: 402, height: 874, statusBand: 62 };
    fake.nextScreenshot = png(402, 874, (p) => p.data.fill(255));
    return fake;
  };
  it('under key `5`: the keyboard\'s remedy quoting the band — not `button "5"` with a scroll', async () => {
    const fake = pad(640);
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'swift_payment.form.value_date_select' }, color: { expected: '#FFFFFF' } });
    expect(c.detail).toBe(`the soft keyboard covers the element (element 24,640 354x52, keyboard 0,589 402x285) — ${KEYBOARD_REMEDY}`);
    expect(fake.screenshots).toHaveLength(0);
  });
  it('between the band\'s top and the keys (24,565 354x52, centre (201,591)): fails closed on the keyboard — the sampler would read keyboard pixels', async () => {
    const fake = pad(565);
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'swift_payment.form.value_date_select' }, color: { expected: '#FFFFFF' } });
    expect(c.detail).toBe(`the soft keyboard covers the element (element 24,565 354x52, keyboard 0,589 402x285) — ${KEYBOARD_REMEDY}`);
  });
  it('an app row listed right before the keys, wholly inside the band (Sign in at 20,700 362x50, keys at 780): the keyboard\'s miss, never measured', async () => {
    const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number, AXUniqueId: string | null = null) => ({ type, AXLabel, AXUniqueId, AXValue: null, frame: { x, y, width, height } });
    const fake = new FakeAdapter(
      {
        form: parseIdbDescribeAll(
          JSON.stringify([
            el('Application', 'App', 0, 0, 402, 874),
            el('Button', 'Sign in', 20, 700, 362, 50, 'signin'),
            ...['Q', 'W', 'E', 'R'].map((k, i) => el('Button', k, 2 + 40 * i, 780, 38, 46)),
            el('Other', null, 0, 590, 402, 284),
          ]),
        ),
      },
      'form',
    );
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.keyboardAdvice = 'ADVICE';
    fake.viewportSize = { width: 402, height: 874, statusBand: 62 };
    fake.nextScreenshot = png(402, 874, (p) => p.data.fill(255));
    const c = await new Verifier(fake, FAST).assert({ element: { id: 'signin' }, color: { expected: '#FFFFFF' } });
    expect(c.detail).toBe(`the soft keyboard covers the element (element 20,700 362x50, keyboard 0,590 402x284) — ${KEYBOARD_REMEDY}`);
  });
  it('a key itself is the keyboard\'s own UI: measured', async () => {
    const fake = pad(545);
    fake.nextScreenshot = drawnAt({ x: 137, y: 650, width: 133, height: 54 }, '#FFFFFF');
    const c = await new Verifier(fake, FAST).assert({ element: { text: '5' }, color: { expected: '#FFFFFF' } });
    expect(c.pass).toBe(true);
  });
});

/**
 * A capture the adapter REFUSES (adapters/screenshot-bytes.ts, 2026-10-08) is
 * not a poll miss: it ends THAT assert at once — one capture, no polling to
 * the deadline — failing closed with the adapter's first line, and
 * `assertAll` goes on to the next assert (pixel-poll.ts's header). Only a
 * png that came back and does not decode is a miss (the "not a png" tests above).
 */
describe('a capture the adapter refuses fails that assert closed, and the batch goes on', () => {
  const REFUSAL = '`adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 0 bytes — not a PNG';
  const refusing = () => {
    resetLayout();
    const fake = new FakeAdapter({ s: screen(node({ identifier: 'card', rect: { x: 0, y: 0, width: 100, height: 40 } })) }, 's');
    let captures = 0;
    fake.screenshot = async () => {
      captures += 1;
      // The adapter's sentence ends with a full stop; the detail must not read `PNG.; failing closed`.
      throw new Error(`${REFUSAL}.\nsecond line, not quoted`);
    };
    return { fake, captures: () => captures };
  };

  it('color: fails closed with the transport message after one capture, and the element assert after it is still evaluated', async () => {
    const { fake, captures } = refusing();
    const results = await new Verifier(fake, FAST).assertAll([
      { element: { id: 'card' }, color: { expected: '#FDFDFD' } },
      { element: { id: 'card' } },
    ]);
    expect(results.map((r) => r.pass)).toEqual([false, true]);
    expect(results[0].detail).toBe(`screenshot failed: ${REFUSAL}; failing closed, color unchecked`);
    expect(captures()).toBe(1);
  });

  it('screenshot baseline, creating: fails closed after one capture, nothing written, and the batch goes on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
    try {
      const { fake, captures } = refusing();
      const results = await new Verifier(fake, { ...FAST, baselineDir: dir }).assertAll([
        { screenshot: { baseline: 'dash' } },
        { element: { id: 'card' } },
      ]);
      expect(results.map((r) => r.pass)).toEqual([false, true]);
      expect(results[0].detail).toBe(`screenshot failed: ${REFUSAL}; failing closed, baseline match unchecked`);
      expect(captures()).toBe(1);
      await expect(readFile(join(dir, fake.platform, 'dash.png'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('screenshot baseline, diffing: fails closed after one capture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'averi-baselines-'));
    try {
      const still = dashboardFake();
      still.nextScreenshot = png(50, 50);
      await new Verifier(still, { ...FAST, baselineDir: dir }).assert({ screenshot: { baseline: 'dash' } });
      const { fake, captures } = refusing();
      // The diff path: the baseline exists for this platform.
      expect(await readFile(join(dir, fake.platform, 'dash.png'))).toBeDefined();
      const [result] = await new Verifier(fake, { ...FAST, baselineDir: dir }).assertAll([{ screenshot: { baseline: 'dash' } }]);
      expect(result).toMatchObject({ pass: false, detail: `screenshot failed: ${REFUSAL}; failing closed, baseline match unchecked` });
      expect(captures()).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
