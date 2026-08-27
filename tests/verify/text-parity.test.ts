import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseLayoutContract, type LayoutContract } from '../../src/verify/layout-contract.js';
import type { OcrLine, OcrRegionResult } from '../../src/verify/ocr.js';
import {
  compareTextParity,
  contractHasTextAnchors,
  evaluateOcrAssert,
  formatTextParity,
  normalizeText,
  ocrRegionsFor,
  renderedTextFromTree,
  survivesIn,
  textParityVerdict,
  type TextCapture,
} from '../../src/verify/text-parity.js';

/**
 * Every fixture here is the SHAPE MEASURED on the live payment form on
 * 2026-08-14 (android emulator + iPhone 17 simulator, read through averi's own
 * adapters), not an invented one. The shapes are the whole point: each of the
 * comparator's rules exists because one of these trees would otherwise produce
 * a false finding or hide a real one.
 *
 * Validation pairs pinned below, the type-size equivalent of color parity's
 * #CFCFD3-vs-#FDFDFD:
 *   CONTINUE      android ink 32px/1080 vs ios 36px/1206 →  0.74% apart → PASS
 *   top-bar title android ink 41px/1080 vs ios 40px/1206 → 12.63% apart → FAIL
 */

const n = (partial: Partial<UiNode>): UiNode => ({
  role: 'other',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 0, height: 0 },
  children: [],
  ...partial,
});

/**
 * Height defaults to a REAL phone aspect (402x874pt / 1080x2348px, 2.174),
 * not a round 2x: the png scale is now cross-checked against the window's
 * own aspect, so a fictional root would fail closed for the right reason.
 */
const root = (width: number, children: UiNode[], height = Math.round(width * 2.174)): UiNode =>
  n({ role: 'container', rect: { x: 0, y: 0, width, height }, children });

const text = (id: string | null, label: string, rect = { x: 0, y: 0, width: 100, height: 20 }): UiNode =>
  n({ role: 'text', identifier: id, label, rect });

const line = (text: string, h: number): OcrLine => ({ text, confidence: 1, x: 0, y: 0, w: 100, h });

const ocrMap = (entries: Record<string, OcrLine[] | { error: string }>): Map<string, OcrRegionResult> =>
  new Map(
    Object.entries(entries).map(([id, v]) => [
      id,
      Array.isArray(v) ? { id, lines: v } : { id, lines: [], error: v.error },
    ]),
  );

const contract = (anchors: unknown[], extra: Record<string, unknown> = {}): LayoutContract =>
  parseLayoutContract(JSON.stringify({ screen: 'payment.form', anchors, ...extra }));

describe('renderedTextFromTree — what counts as rendered copy', () => {
  it('reads ALL nodes carrying the id, not just the first (measured: SwiftUI propagates one identifier to every leaf)', () => {
    // The measured iOS amount field: the id matches three nodes and the
    // placeholder sits on the SECOND. First-occurrence-wins would miss it.
    const tree = root(402, [
      n({ role: 'textfield', identifier: 'amount', value: null }),
      text('amount', 'Enter amount'),
      text('amount', 'CZK'),
    ]);
    expect(renderedTextFromTree(tree, 'amount')).toEqual(['Enter amount', 'CZK']);
  });

  it('ignores the label of a non-text node — iOS authored a11y summaries are not rendered copy', () => {
    // Measured: credit_select renders 'Select credit account' but exposes
    // label 'To account'; comparing that label would be a phantom finding.
    const tree = root(402, [n({ role: 'button', identifier: 'credit', label: 'To account' })]);
    expect(renderedTextFromTree(tree, 'credit')).toEqual([]);
  });

  it("reads a field's value but never its label (android mirrors the value into label, iOS does not)", () => {
    const android = root(1080, [n({ role: 'textfield', identifier: 'amount', label: '123', value: '123' })]);
    const ios = root(402, [n({ role: 'textfield', identifier: 'amount', label: null, value: '123' })]);
    expect(renderedTextFromTree(android, 'amount')).toEqual(['123']);
    expect(renderedTextFromTree(ios, 'amount')).toEqual(['123']);
  });

  it('descends into children — android cards expose their copy as separate text nodes', () => {
    const tree = root(1080, [
      n({ role: 'container', identifier: 'debit', children: [text(null, 'From:'), text(null, 'My Account CZK')] }),
    ]);
    expect(renderedTextFromTree(tree, 'debit')).toEqual(['From:', 'My Account CZK']);
  });
});

describe('normalizeText', () => {
  it('collapses whitespace including NBSP and narrow NBSP, trims, and preserves case', () => {
    expect(normalizeText('  TO MY  ACCOUNT   ')).toBe('TO MY ACCOUNT');
    expect(normalizeText('Continue')).toBe('Continue');
  });
});

describe('compareTextParity — the measured copy drift', () => {
  const c = contract([{ id: 'amount', text: 'Enter amount' }]);
  const captures = (): Partial<Record<'android' | 'ios', TextCapture>> => ({
    android: {
      tree: root(1080, [n({ role: 'textfield', identifier: 'amount', value: null })]),
      ocr: ocrMap({ amount: [line('0.00', 30)] }),
      pngWidth: 1080,
    },
    ios: {
      tree: root(402, [n({ role: 'textfield', identifier: 'amount' }), text('amount', 'Enter amount')]),
      ocr: ocrMap({ amount: [line('Enter amount', 33)] }),
      pngWidth: 1206,
    },
  });

  it("the real 2026-08-14 drift FAILS: android renders '0.00' where iOS renders 'Enter amount'", () => {
    const r = compareTextParity(c, captures());
    expect(r.pass).toBe(false);
    expect(r.findings.map((f) => f.comparison)).toContain('android-vs-ios');
    // Figma says 'Enter amount', so android is the wrong side — and the
    // contract axis names it rather than leaving the reader to guess.
    const vsContract = r.findings.filter((f) => f.comparison === 'android-vs-contract');
    expect(vsContract).toHaveLength(1);
    expect(vsContract[0].detail).toContain('"0.00"');
    expect(r.findings.some((f) => f.comparison === 'ios-vs-contract')).toBe(false);
    expect(textParityVerdict(r)).toContain('COPY DRIFT');
  });

  it('a fixed android build PASSES', () => {
    const caps = captures();
    (caps.android as TextCapture).ocr = ocrMap({ amount: [line('Enter amount', 30)] });
    const r = compareTextParity(c, caps);
    expect(r.findings).toHaveLength(0);
    expect(r.pass).toBe(true);
    expect(r.rows[0].source).toBe('ocr');
  });

  it('OCR is preferred over the tree — the tree alone would call this row equal-and-empty', () => {
    // Without OCR both trees would be compared: android '' vs ios 'Enter
    // amount'. The point is the SOURCE the row reports, so the reader knows
    // which question was answered.
    const caps = captures();
    const r = compareTextParity(c, caps);
    expect(r.rows[0].source).toBe('ocr');
    expect(r.rows[0].android?.ocr).toBe('0.00');
    expect(r.rows[0].android?.tree).toBe('');
  });
});

describe('compareTextParity — type size, the validation pair', () => {
  it('CONTINUE PASSES: android 32px/1080 vs ios 36px/1206 → 0.74% apart', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: [line('CONTINUE', 32)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: [line('CONTINUE', 36)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].sizeDelta).toBeCloseTo(0.74, 2);
    expect(r.findings).toHaveLength(0);
    expect(r.pass).toBe(true);
  });

  it('the 22sp-vs-17pt title FAILS: android 41px/1080 vs ios 40px/1206 → 12.63% apart', () => {
    const c = contract([{ id: 'title', text: 'TO MY ACCOUNT' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('title', 'TO MY ACCOUNT')]), ocr: ocrMap({ title: [line('TO MY ACCOUNT', 41)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('title', 'TO MY ACCOUNT')]), ocr: ocrMap({ title: [line('TO MY ACCOUNT', 40)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].sizeDelta).toBeCloseTo(12.63, 2);
    const size = r.findings.filter((f) => f.field === 'size');
    expect(size).toHaveLength(1);
    expect(size[0].detail).toContain('3.80% of width');
    expect(textParityVerdict(r)).toContain('TYPE SIZE DELTA');
  });

  it('the tolerance sits between the two: the same title pair passes at 13%, the CTA pair fails at 0.5%', () => {
    const title = contract([{ id: 'title', text: 'T' }], { tolerance_size_pct: 13 });
    const r = compareTextParity(title, {
      android: { tree: root(1080, [text('title', 'T')]), ocr: ocrMap({ title: [line('T', 41)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('title', 'T')]), ocr: ocrMap({ title: [line('T', 40)] }), pngWidth: 1206 },
    });
    expect(r.findings.filter((f) => f.field === 'size')).toHaveLength(0);
  });

  it('size is NOT compared when the strings differ — different glyphs have different ink extents', () => {
    const c = contract([{ id: 'a', text_dynamic: false }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('a', 'CONTINUE')]), ocr: ocrMap({ a: [line('CONTINUE', 32)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('a', 'NEXT')]), ocr: ocrMap({ a: [line('NEXT', 80)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].sizeDelta).toBeUndefined();
    // The copy drift is still reported — only the height comparison is withheld.
    expect(r.findings.filter((f) => f.field === 'text')).toHaveLength(1);
  });

  it('size is NOT compared on a multi-line anchor — line boxes do not compose into one height', () => {
    const c = contract([{ id: 'a', text: 'one two' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('a', 'one two')]), ocr: ocrMap({ a: [line('one', 30), line('two', 30)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('a', 'one two')]), ocr: ocrMap({ a: [line('one', 33), line('two', 33)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].sizeDelta).toBeUndefined();
    expect(r.pass).toBe(true);
  });
});

describe('compareTextParity — dynamic anchors', () => {
  it('text_dynamic skips the literal comparison: locale formatting and node granularity both differ legitimately', () => {
    // Measured: android splits the balance across two nodes ('1,121' + '.00')
    // where iOS renders one ('1 121,00').
    const c = contract([{ id: 'balance', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [n({ identifier: 'balance', children: [text(null, '1,121'), text(null, '.00')] })]) },
      ios: { tree: root(402, [text('balance', '1 121,00')]) },
    });
    expect(r.findings).toHaveLength(0);
    expect(r.rows[0].dynamic).toBe(true);
    expect(r.rows[0].verdict).toBe('—');
    expect(r.notes.join(' ')).toContain('text_dynamic');
  });

  it('a dynamic anchor is never size-checked either', () => {
    const c = contract([{ id: 'balance', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('balance', '1,121.00')]), ocr: ocrMap({ balance: [line('1,121.00', 41)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('balance', '1,121.00')]), ocr: ocrMap({ balance: [line('1,121.00', 20)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].sizeDelta).toBeUndefined();
    expect(r.pass).toBe(true);
  });
});

describe('compareTextParity — source honesty', () => {
  it('never mixes sources: OCR on one platform only falls back to tree for BOTH, with a note', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: [line('CONTINUE', 32)] }), pngWidth: 1080 },
      ios: { tree: root(402, [text('cta', 'CONTINUE')]) },
    });
    expect(r.rows[0].source).toBe('tree');
    expect(r.notes.join(' ')).toContain('OCR ran on only some platforms');
  });

  it('a per-region OCR error degrades that platform to tree evidence rather than failing the row', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: { error: 'region outside the screenshot' } }), pngWidth: 1080 },
      ios: { tree: root(402, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: [line('CONTINUE', 36)] }), pngWidth: 1206 },
    });
    expect(r.rows[0].source).toBe('tree');
    expect(r.pass).toBe(true);
  });
});

describe('compareTextParity — the accessibility note', () => {
  it('flags copy that is rendered but carries no accessible name (the measured android placeholder)', () => {
    const c = contract([{ id: 'amount', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [n({ role: 'textfield', identifier: 'amount', label: null, value: null })]),
        ocr: ocrMap({ amount: [line('0.00', 30)] }),
        pngWidth: 1080,
      },
    });
    expect(r.notes.join(' ')).toContain('invisible to assistive technology');
  });

  it('does NOT flag an authored summary that merely differs from the rendered copy — that is a design choice', () => {
    // Measured iOS: the button renders 'CONTINUE' and is labelled
    // 'Continue to summary'. Labelled is labelled; this must stay quiet.
    const c = contract([{ id: 'cta', text_dynamic: true }]);
    const r = compareTextParity(c, {
      ios: {
        tree: root(402, [n({ role: 'button', identifier: 'cta', label: 'Continue to summary' })]),
        ocr: ocrMap({ cta: [line('CONTINUE', 36)] }),
        pngWidth: 1206,
      },
    });
    expect(r.notes.join(' ')).not.toContain('invisible to assistive technology');
  });
});

describe('compareTextParity — the occlusion guard', () => {
  it('flags an anchor whose tree text vanished from the reading (measured: the IME covering the CTA)', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [text('cta', 'CONTINUE')]),
        // What the recognizer saw through the keyboard drawn over the button.
        ocr: ocrMap({ cta: [line('0', 30), line('.', 30)] }),
        pngWidth: 1080,
      },
    });
    expect(r.occluded).toHaveLength(1);
    expect(r.rows[0].verdict).toBe('OCCLUDED');
    expect(r.pass).toBe(false);
    // The whole point: a covered anchor must NOT be dispatched as copy drift.
    expect(r.findings).toHaveLength(0);
    expect(formatTextParity(r)).toContain('NOT compared as drift');
    // The cause is NOT asserted: the identical signal is produced by text at
    // unreadable contrast, which is a finding rather than substrate.
    expect(formatTextParity(r)).toContain('unreadable contrast');
    expect(r.occluded[0].covered.android).toContain('cause not determined');
  });

  it('flags an empty reading over a tree that has text', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]), ocr: ocrMap({ cta: [] }), pngWidth: 1080 },
    });
    expect(r.occluded[0].covered.android).toContain('(nothing)');
  });

  it('stays quiet on a PARTIAL mismatch — OCR merges lines a tree keeps separate', () => {
    // The measured android debit card: six separate text nodes, read back as
    // one run. Requiring every string to survive would fire on every card.
    const c = contract([{ id: 'debit', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [n({ identifier: 'debit', children: [text(null, 'From:'), text(null, '1,121'), text(null, '.00')] })]),
        ocr: ocrMap({ debit: [line('From: My Account CZK 1,121.00', 30)] }),
        pngWidth: 1080,
      },
    });
    expect(r.occluded).toHaveLength(0);
  });

  it('a COMBINED a11y label is READ, not OCCLUDED — the joining comma is never rendered', () => {
    // Measured 2026-08-27 on user_settings.overview: accessibility.md §8 requires
    // a multi-part row to expose ONE combined '{label}, {value}' node. The comma
    // exists only in the label, so a literal containment test marked every such
    // row UNREAD — and OCCLUDED WITHHOLDS the row from copy drift, silently
    // suppressing the very check the guard exists to protect.
    const c = contract([{ id: 'profile_row_6', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [text('profile_row_6', 'Phone, +123 456 789 1')]),
        ocr: ocrMap({ profile_row_6: [line('Phone +123 456 789 1', 30)] }),
        pngWidth: 1080,
      },
      ios: {
        tree: root(402, [text('profile_row_6', 'Phone, +123 456 789 1')]),
        ocr: ocrMap({ profile_row_6: [line('Phone +123 456 789 1', 30)] }),
        pngWidth: 1206,
      },
    });
    expect(r.occluded).toHaveLength(0);
    expect(r.rows[0].verdict).not.toBe('OCCLUDED');
    // ...and the row stays subject to copy comparison rather than withheld.
    expect(formatTextParity(r)).not.toContain('NOT compared as drift');
  });

  it('a product row whose toggle state is in the label is COMPARED, not withheld', () => {
    // The device shape that kept finding 3 open: ', visible' names a toggle
    // GRAPHIC, so that part can never be read — and while the whole joined
    // string had to survive, the row was withheld from copy drift, which is
    // the exact harm this guard was supposed to prevent.
    const c = contract([{ id: 'product_row_4', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [text('product_row_4', 'My Account, * 5433, visible')]),
        ocr: ocrMap({ product_row_4: [line('My Account *5433', 30)] }),
        pngWidth: 1080,
      },
    });
    expect(r.occluded).toHaveLength(0);
    expect(r.rows[0].verdict).not.toBe('OCCLUDED');
    expect(formatTextParity(r)).not.toContain('NOT compared as drift');
  });

  it('stays quiet when the tree carries no rendered text at all — the normal iOS button case', () => {
    const c = contract([{ id: 'cta', text_dynamic: true }]);
    const r = compareTextParity(c, {
      ios: {
        tree: root(402, [n({ role: 'button', identifier: 'cta', label: 'Continue to summary' })]),
        ocr: ocrMap({ cta: [line('CONTINUE', 36)] }),
        pngWidth: 1206,
      },
    });
    expect(r.occluded).toHaveLength(0);
  });
});

describe('compareTextParity — regressions found in review', () => {
  it('an id on a container AND its text child is read ONCE, not once per ancestor', () => {
    // findBySpec returns ancestors and their matching descendants, so walking
    // every match double-counted the leaf and reported
    // 'Enter amount Enter amount' as a copy drift.
    const nested = root(402, [
      n({ role: 'container', identifier: 'amount', children: [text('amount', 'Enter amount')] }),
    ]);
    expect(renderedTextFromTree(nested, 'amount')).toEqual(['Enter amount']);
  });

  it('a platform whose tree carries no rendered copy is UNREAD, never compared as ""', () => {
    // The normal iOS shape on the tree source. Comparing it as '' dispatched
    // two confident phantom findings on every non-macOS host.
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]) },
      ios: { tree: root(402, [n({ role: 'button', identifier: 'cta', label: 'Continue to summary' })]) },
    });
    expect(r.findings).toHaveLength(0);
    expect(r.rows[0].verdict).toBe('OCCLUDED');
    expect(r.occluded[0].covered.ios).toContain('exposes no rendered copy');
    expect(r.pass).toBe(false);
  });

  it('the UNREAD guard tolerates textAllCaps: tree "Continue" vs rendered "CONTINUE"', () => {
    // Android's AccessibilityNodeInfo reports the UNTRANSFORMED text, so a
    // case-sensitive survival test failed every Material caps button.
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'Continue')]), ocr: ocrMap({ cta: [line('CONTINUE', 30)] }), pngWidth: 1080 },
    });
    expect(r.occluded).toHaveLength(0);
    expect(r.rows[0].verdict).toBe('OK');
  });

  it('the UNREAD guard tolerates an ellipsized render', () => {
    const c = contract([{ id: 'row', text_dynamic: true }]);
    const r = compareTextParity(c, {
      android: {
        tree: root(1080, [text('row', 'Select credit account')]),
        ocr: ocrMap({ row: [line('Select credit acc…', 30)] }),
        pngWidth: 1080,
      },
    });
    expect(r.occluded).toHaveLength(0);
  });

  it('clamps an anchor hanging off the png instead of measuring ink in a silently clipped crop', () => {
    const c = contract([{ id: 'cta', text: 'X' }]);
    const tree = root(402, [n({ identifier: 'cta', rect: { x: -10, y: 800, width: 100, height: 100 } })]);
    // scale 3: raw region would be x -30 .. 270, y 2400 .. 2700 against a 2622-tall png.
    expect(ocrRegionsFor(c, tree, 1206, 2622).regions).toEqual([{ id: 'cta', x: 0, y: 2400, w: 270, h: 222 }]);
    // Nothing on screen at all → omitted, so it surfaces as an OCR-less row.
    const off = root(402, [n({ identifier: 'cta', rect: { x: 0, y: 2000, width: 100, height: 100 } })]);
    expect(ocrRegionsFor(c, off, 1206, 2622).regions).toEqual([]);
  });
});

describe('compareTextParity — missing anchors and bad input', () => {
  // Shares a validator with color parity's tolerance_de, so what needs pinning
  // is that the message still names THIS comparator and THIS field — that
  // specificity is why layout-contract leaves the tolerances `unknown` rather
  // than typing them at load time.
  it.each([['10'], [0], [-1]])('a contract tolerance_size_pct of %j is rejected by name', (tol) => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }], { tolerance_size_pct: tol });
    expect(() =>
      compareTextParity(c, { android: { tree: root(1080, [text('cta', 'CONTINUE')]) } }),
    ).toThrow(`text parity: tolerance_size_pct must be a positive number, got ${JSON.stringify(tol)}`);
  });

  it('an id absent from one tree is MISSING and fails the run', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, {
      android: { tree: root(1080, [text('cta', 'CONTINUE')]) },
      ios: { tree: root(402, []) },
    });
    expect(r.missing).toEqual([{ id: 'cta', absent: { ios: 'no id in tree' } }]);
    expect(r.pass).toBe(false);
  });

  it('absent everywhere renders a MISSING row and compares nothing', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    const r = compareTextParity(c, { android: { tree: root(1080, []) } });
    expect(r.rows[0].verdict).toBe('MISSING');
    expect(r.findings).toHaveLength(0);
  });

  it('anchors that did not opt in are not checked at all', () => {
    const c = contract([{ id: 'a', text: 'X' }, { id: 'b', w: 100 }]);
    const r = compareTextParity(c, { android: { tree: root(1080, [text('a', 'X'), text('b', 'whatever')]) } });
    expect(r.checkedCount).toBe(1);
    expect(r.anchorCount).toBe(2);
    expect(r.rows).toHaveLength(1);
  });

  it('a non-string text and a non-boolean text_dynamic are bad input — throws, never guesses', () => {
    const bad = contract([{ id: 'a', text: 42 }]);
    expect(() => compareTextParity(bad, { android: { tree: root(1080, [text('a', 'x')]) } })).toThrow(/must be the exact rendered string/);
    const bad2 = contract([{ id: 'a', text_dynamic: 'yes' }]);
    expect(() => compareTextParity(bad2, { android: { tree: root(1080, [text('a', 'x')]) } })).toThrow(/must be true or false/);
  });

  it('throws on an invalid tolerance and on no captures at all', () => {
    const c = contract([{ id: 'a', text: 'X' }], { tolerance_size_pct: 0 });
    expect(() => compareTextParity(c, { android: { tree: root(1080, [text('a', 'X')]) } })).toThrow(/positive number/);
    expect(() => compareTextParity(contract([{ id: 'a', text: 'X' }]), {})).toThrow(/no platform capture/);
  });
});

describe('ocrRegionsFor', () => {
  it('scales opted-in anchor rects into png pixels (live: android 1.000, ios 3.000)', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }, { id: 'other', w: 10 }]);
    const ios = root(402, [n({ identifier: 'cta', rect: { x: 24, y: 780, width: 354, height: 44 } })]);
    expect(ocrRegionsFor(c, ios, 1206, 2622).regions).toEqual([{ id: 'cta', x: 72, y: 2340, w: 1062, h: 132 }]);
  });

  it('THROWS when the scale cannot be derived — an empty list would read as "no text anchors"', () => {
    const c = contract([{ id: 'cta', text: 'CONTINUE' }]);
    expect(() => ocrRegionsFor(c, root(402, [n({ identifier: 'cta' })]), 0, 800)).toThrow(
      /degenerate dimensions 0x800/,
    );
  });

  it('THROWS rather than cropping by a width an off-viewport node inflated (2026-08-26)', () => {
    // The measured shape: a modal sheet up, iOS keeping a sibling parked one
    // screen to the right. Scaling by 804 would crop at 45% of the height.
    const c = contract([{ id: 'cta', text: 'APPLY' }]);
    const sheet = root(402, [
      n({ identifier: 'cta', rect: { x: 208, y: 791, width: 176, height: 44 } }),
      n({ rect: { x: 402, y: 0, width: 402, height: 874 } }),
    ]);
    expect(ocrRegionsFor(c, sheet, 1206, 2622).regions).toEqual([{ id: 'cta', x: 624, y: 2373, w: 528, h: 132 }]);

    // Same tree with the window itself inflated — no root to fall back on.
    const broken = root(804, [n({ identifier: 'cta', rect: { x: 208, y: 791, width: 176, height: 44 } })], 874);
    expect(() => ocrRegionsFor(c, broken, 1206, 2622)).toThrow(/do not describe the same screen/);
  });
});

describe('evaluateOcrAssert', () => {
  it('passes an exact string and reports what it read', () => {
    const r = evaluateOcrAssert({ text: 'CONTINUE' }, [line('CONTINUE', 32)], 1080);
    expect(r.pass).toBe(true);
    expect(r.detail).toContain('"CONTINUE"');
  });

  it('fails closed when nothing was recognized — unread is not verified-as-empty', () => {
    const r = evaluateOcrAssert({ text: 'CONTINUE' }, [], 1080);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('failing closed');
  });

  it('checks ink height against heightPct within tolerance', () => {
    expect(evaluateOcrAssert({ heightPct: 2.96 }, [line('CONTINUE', 32)], 1080).pass).toBe(true);
    expect(evaluateOcrAssert({ heightPct: 2.96 }, [line('CONTINUE', 41)], 1080).pass).toBe(false);
  });

  it('fails closed on a height check over multi-line text', () => {
    const r = evaluateOcrAssert({ heightPct: 2.96 }, [line('one', 32), line('two', 32)], 1080);
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('single-line only');
  });

  it('supports a regex instead of an exact string', () => {
    expect(evaluateOcrAssert({ match: '^\\d+[.,]\\d{2}$' }, [line('1 121,00', 30)], 1080).pass).toBe(false);
    expect(evaluateOcrAssert({ match: 'CONTIN' }, [line('CONTINUE', 30)], 1080).pass).toBe(true);
  });
});

describe('contractHasTextAnchors', () => {
  it('true only when an anchor opts in via text / text_dynamic', () => {
    expect(contractHasTextAnchors(contract([{ id: 'a', w: 10 }]))).toBe(false);
    expect(contractHasTextAnchors(contract([{ id: 'a', text: 'X' }]))).toBe(true);
    expect(contractHasTextAnchors(contract([{ id: 'a', text_dynamic: true }]))).toBe(true);
  });
});

describe('formatTextParity', () => {
  it('renders the table, the source column, notes and the findings section', () => {
    const c = contract([{ id: 'amount', text: 'Enter amount' }]);
    const out = formatTextParity(
      compareTextParity(c, {
        android: { tree: root(1080, [n({ role: 'textfield', identifier: 'amount' })]), ocr: ocrMap({ amount: [line('0.00', 30)] }), pngWidth: 1080 },
        ios: { tree: root(402, [text('amount', 'Enter amount')]), ocr: ocrMap({ amount: [line('Enter amount', 33)] }), pngWidth: 1206 },
      }),
    );
    expect(out).toContain('screen: payment.form');
    expect(out).toContain('anchors checked: 1/1');
    expect(out).toContain('0.00');
    expect(out).toContain('TEXT FINDING(S)');
    // The dispatch advice must keep copy drift a SPEC question first.
    expect(out).toContain('SPEC question');
  });
});

describe('survivesIn — the UNREAD guard predicate', () => {
  // The four cases the 2026-08-27 report pins as acceptance. The last two
  // matter as much as the first two: the guard's narrowness is deliberate, and
  // a fix measured only by "the false positive stopped" cannot distinguish
  // itself from disabling the check.
  it.each([
    // The three product rows measured ON DEVICE 2026-08-27. Each fails the
    // whole-string test for a reason no separator rule reaches: ', visible'
    // describes a toggle GRAPHIC that renders no text at all, and OCR edits
    // the remaining parts — dropping the space in '* 5433', and inserting a
    // '€' it recognised from the leading currency avatar (an image).
    ['My Account, 5304826947468842, visible', 'My Account € 5304826947468842', true],
    ['My Account, * 5433, visible', 'My Account *5433', true],
    ['My Account CZK, * 5434, visible', 'My Account CZK *5434', true],
    // The row the punctuation fix already closed — regression guard.
    ['Phone, +123 456 789 1', 'Phone +123 456 789 1', true],
    ['Full name, Arthur Dent', 'Full name Arthur Dent', true],
    ['CONTINUE', '', false],
    ['Enter amount', '0.00', false],
  ])('survivesIn(%j, %j) === %s', (tree, seen, want) => {
    expect(survivesIn(tree as string, seen as string)).toBe(want);
  });

  it('a combined label whose region read NOTHING is still UNREAD', () => {
    // The real occlusion case must survive the parts rule: no part can be found
    // in an empty reading, so a dialog over the row still reports honestly.
    expect(survivesIn('My Account, * 5433, visible', '')).toBe(false);
  });

  it('a combined label none of whose parts appear is still UNREAD', () => {
    expect(survivesIn('My Account, * 5433, visible', 'Totally different copy')).toBe(false);
  });

  it('does not let a 1-2 character part vouch for the whole row', () => {
    // 'Kč' is two characters and turns up in half the amounts on screen; a part
    // that short is coincidence, not evidence the region was read.
    expect(survivesIn('Kč, 1 121,00', 'Kč')).toBe(false);
  });

  it('DOES let a 3-character part vouch — the floor is pinned from both sides', () => {
    // The other half of the bound. Without this, MIN_PART_LENGTH could drift
    // up to 6 and every test would stay green while the guard silently
    // over-narrowed — this directory records that failure class three times.
    expect(survivesIn('Balance, CZK', 'Total CZK 1 121,00')).toBe(true);
  });

  it('ACCEPTED COST: a dialog over the value is read when the label part is legible', () => {
    // Pinned as a limitation, not as a virtue. The parts rule cannot see
    // PARTIAL occlusion of a combined row, and on a text_dynamic anchor no
    // string comparison follows — so this shape now passes silently where it
    // used to fail loudly. Accepted because a WHOLLY covered region still has
    // no survivor (the test below), because the same blindness always existed
    // for the two-node spelling of this row, and because the false positive it
    // replaces suppressed the copy check on every combined row.
    expect(survivesIn('Notifications, On', 'Allow notifications from this app?')).toBe(true);
    // The bound that makes it acceptable: cover the whole region and the guard
    // still fires.
    expect(survivesIn('Notifications, On', '')).toBe(false);
  });

  it('still catches a real substitution that punctuation cannot explain', () => {
    expect(survivesIn('Phone, +123 456 789 1', 'Email, a@b.example')).toBe(false);
  });

  it('keeps the case and truncation leniencies it already had', () => {
    expect(survivesIn('Continue', 'CONTINUE')).toBe(true);
    expect(survivesIn('Select credit account', 'Select credit acc…')).toBe(true);
  });
});
