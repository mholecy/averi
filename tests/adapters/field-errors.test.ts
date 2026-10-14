import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { attachFieldErrors } from '../../src/adapters/field-errors.js';
import { everyNode } from '../../src/adapters/types.js';
import type { UiNode } from '../../src/adapters/types.js';
import { node } from '../helpers/fake.js';

const fixture = (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

/**
 * The field/error pairing rule now has ONE owner shared by both iOS tree
 * sources (idb's flat list, WDA's nested tree). That makes it worth pinning
 * properly: a change here silently changes both platforms at once, and the
 * previous fixtures only ever had one field and one candidate — so most of
 * the rule was passing by coincidence rather than by test.
 */

const field = (id: string, y: number, height = 20): UiNode =>
  node({ role: 'textfield', identifier: id, rect: { x: 0, y, width: 100, height } });

const text = (id: string | null, y: number, label: string | null): UiNode =>
  node({ role: 'text', identifier: id, label, rect: { x: 0, y, width: 100, height: 10 } });

describe('field/error pairing', () => {
  it('pairs the NEAREST error below the field, whatever order they arrive in', () => {
    const target = field('amount', 100);
    // Far candidate FIRST: document order disagrees with distance, so this
    // fails unless the rule genuinely sorts by y.
    attachFieldErrors([text('amount', 500, 'Far away'), target, text('amount', 130, 'Nearest')]);
    expect(target.error).toBe('Nearest');
  });

  it('never borrows an error belonging to a different field', () => {
    const amount = field('amount', 100);
    const iban = field('iban', 300);
    attachFieldErrors([amount, iban, text('iban', 340, 'Invalid IBAN')]);
    expect(amount.error).toBeUndefined();
    expect(iban.error).toBe('Invalid IBAN');
  });

  it('ignores the title ABOVE the field and takes only what is below it', () => {
    const target = field('amount', 100, 20);
    attachFieldErrors([text('amount', 80, 'Amount'), target, text('amount', 125, 'Too large')]);
    expect(target.error).toBe('Too large');
  });

  it('ignores a text overlapping the field itself — below means below the BOTTOM', () => {
    const target = field('amount', 100, 20); // spans y 100..120
    // A same-identifier text inside the field's own span (an inline
    // placeholder) is not an error message; the real one sits under the field.
    attachFieldErrors([target, text('amount', 110, 'Placeholder'), text('amount', 125, 'Too large')]);
    expect(target.error).toBe('Too large');
  });

  it('counts a text starting exactly at the field bottom as below it', () => {
    const target = field('amount', 100, 20); // bottom = 120
    attachFieldErrors([target, text('amount', 120, 'Required')]);
    expect(target.error).toBe('Required');
  });

  it('a zero-height field is not the next field below itself', () => {
    const target = field('amount', 100, 0);
    attachFieldErrors([target, text('amount', 110, 'Required')]);
    expect(target.error).toBe('Required');
  });

  it('ignores a same-identifier text that has no label', () => {
    const target = field('amount', 100);
    attachFieldErrors([target, text('amount', 130, null)]);
    expect(target.error).toBeUndefined();
  });

  it('ignores a non-text node below the field', () => {
    const target = field('amount', 100);
    const button = node({
      role: 'button',
      identifier: 'amount',
      label: 'Clear',
      rect: { x: 0, y: 130, width: 40, height: 10 },
    });
    attachFieldErrors([target, button]);
    expect(target.error).toBeUndefined();
  });

  describe('fields sharing one component identifier', () => {
    // mp-native's SWIFT form on WDA: every field and its floating title carry
    // `TextFieldWithComponentStyle`, each title starting 1 pt above its field.
    const ID = 'TextFieldWithComponentStyle';
    const titled = (y: number, label: string): [UiNode, UiNode] => [
      node({ role: 'text', identifier: ID, label, rect: { x: 42, y: y - 1, width: 47, height: 22 } }),
      node({ role: 'textfield', identifier: ID, rect: { x: 42, y, width: 318, height: 20 } }),
    ];

    it('the next field’s title just above it is not this field’s error', () => {
      const [ibanTitle, iban] = titled(357, 'IBAN*');
      const [bicTitle, bic] = titled(425, 'BIC*');
      attachFieldErrors([ibanTitle, iban, bicTitle, bic]);
      expect(iban.error).toBeUndefined();
      expect(bic.error).toBeUndefined();
    });

    it('a validation message between a field and the next field’s title still pairs', () => {
      const [ibanTitle, iban] = titled(357, 'IBAN*');
      const [bicTitle, bic] = titled(425, 'BIC*');
      const invalid = node({ role: 'text', identifier: ID, label: 'Invalid IBAN', rect: { x: 42, y: 380, width: 200, height: 16 } });
      attachFieldErrors([ibanTitle, iban, bicTitle, bic, invalid]);
      expect(iban.error).toBe('Invalid IBAN');
      expect(bic.error).toBeUndefined();
    });

    it('a validation message under the last field pairs', () => {
      const [ibanTitle, iban] = titled(357, 'IBAN*');
      const [bicTitle, bic] = titled(425, 'BIC*');
      const required = node({ role: 'text', identifier: ID, label: 'Required', rect: { x: 42, y: 448, width: 200, height: 16 } });
      attachFieldErrors([ibanTitle, iban, bicTitle, bic, required]);
      expect(iban.error).toBeUndefined();
      expect(bic.error).toBe('Required');
    });

    it('a validation message above a later field with no title of its own still pairs with the field it lies under', () => {
      const [ibanTitle, iban] = titled(357, 'IBAN*');
      const invalid = node({ role: 'text', identifier: ID, label: 'Invalid IBAN', rect: { x: 42, y: 380, width: 200, height: 16 } });
      const untitled = node({ role: 'textfield', identifier: ID, rect: { x: 42, y: 425, width: 318, height: 20 } });
      attachFieldErrors([ibanTitle, iban, invalid, untitled]);
      expect(iban.error).toBe('Invalid IBAN');
      expect(untitled.error).toBeUndefined();
    });

    it('a field with a label reaching into its top AND a placeholder inside it lends neither to the field above', () => {
      // The amount field as measured (idb and WDA): "Amount*" y 283 h 16 ends
      // 3 pt inside the field at y 296, and "Value*" sits inside the field.
      const above = field(ID, 220);
      const amount = node({ role: 'textfield', identifier: ID, rect: { x: 42, y: 296, width: 232, height: 21 } });
      attachFieldErrors([
        above,
        node({ role: 'text', identifier: ID, label: 'Amount*', rect: { x: 42, y: 283, width: 51, height: 16 } }),
        amount,
        node({ role: 'text', identifier: ID, label: 'Value*', rect: { x: 42, y: 296, width: 49, height: 21 } }),
      ]);
      expect(above.error).toBeUndefined();
      expect(amount.error).toBeUndefined();
    });

    it('never takes a text lying past the next same-identifier field', () => {
      // Titles that overlap their own field (idb's spelling of the same form)
      // and a later field's message: none of it is the first field's.
      const first = field(ID, 100);
      const second = field(ID, 200);
      attachFieldErrors([first, text(ID, 100, 'First'), second, text(ID, 200, 'Second'), text(ID, 230, 'Too long')]);
      expect(first.error).toBeUndefined();
      expect(second.error).toBe('Too long');
    });
  });

  describe('a message carrying its own error identifier', () => {
    // mp-native's SWIFT form with the IBAN message shown, as both tree sources
    // returned it (tests/fixtures/ios-ui-snapshot-swift-iban-error.json): the
    // message is `swift_payment.form.iban_input_error`, while the IBAN input and
    // every other field and title share `TextFieldWithComponentStyle`.
    const SWIFT = async (): Promise<Record<'idb' | 'wda', UiNode>> =>
      (JSON.parse(await fixture('ios-ui-snapshot-swift-iban-error.json')) as { screens: Record<'idb' | 'wda', UiNode> }).screens;
    const MESSAGE = "The IBAN you've entered is not valid. Please adjust and try again";
    const errors = (tree: UiNode): [string, number, string | undefined][] =>
      [...everyNode(tree)].filter((n) => n.role === 'textfield').map((n) => [n.value ?? '', n.rect.y, n.error]);

    it.each(['idb', 'wda'] as const)('pairs with the IBAN field above it, and with no other field (%s)', async (source) => {
      const tree = (await SWIFT())[source];
      attachFieldErrors(everyNode(tree));
      const paired = errors(tree).filter(([, , error]) => error !== undefined);
      expect(paired).toEqual([['XX12', 364, MESSAGE]]);
    });

    it('a screen-level error far below a field is not that field’s (Account Detail, idb)', async () => {
      // tests/fixtures/idb-ui-snapshot-account-detail-error.json: the search
      // field at the top of the screen, and 337 pt below it, in its column,
      // `accounts.detail.error` "That's an error" — the screen's error state.
      const tree = (JSON.parse(await fixture('idb-ui-snapshot-account-detail-error.json')) as { screen: UiNode }).screen;
      attachFieldErrors(everyNode(tree));
      expect(errors(tree)).toEqual([['Search', 67, undefined]]);
    });

    // Synthetic rows below share one component identifier on every field, as
    // the SWIFT form does, so only the message's own identifier can pair it.
    const input = (x: number, y: number, width = 300): UiNode =>
      node({ role: 'textfield', identifier: 'Component', rect: { x, y, width, height: 20 } });
    const message = (x: number, y: number, width = 300, label = 'Invalid', id = 'form.iban_input_error'): UiNode =>
      node({ role: 'text', identifier: id, label, rect: { x, y, width, height: 30 } });

    it('pairs with nothing when no field above it shares its column', () => {
      // A field above-left that the message does not reach horizontally is
      // another column's field, however near it is vertically.
      const left = input(0, 100, 150);
      attachFieldErrors([left, message(200, 130, 150)]);
      expect(left.error).toBeUndefined();
    });

    it('pairs with nothing when the only field in its column lies below it', () => {
      // A message describes the field above it; the field under it is the
      // next thing on the form, not what the message is about.
      const below = input(0, 200);
      attachFieldErrors([message(0, 100), below]);
      expect(below.error).toBeUndefined();
    });

    it.each([
      ['form.iban_input_error', true],
      ['form.iban.error', true],
      ['form-iban-error', true],
      ['form.iban_input_ERROR', true],
      ['form.ibanerror', false],
      ['form.error_iban', false],
      ['IbanError', false],
    ])('the identifier %s names its text an error: %s', (id, names) => {
      const iban = input(0, 100);
      attachFieldErrors([iban, message(0, 130, 300, 'Invalid', id)]);
      expect(iban.error).toBe(names ? 'Invalid' : undefined);
    });

    it('pairs with the nearer of two stacked fields, never the one past it', () => {
      const first = input(0, 100);
      const second = input(0, 160);
      attachFieldErrors([first, second, message(0, 190)]);
      expect(first.error).toBeUndefined();
      expect(second.error).toBe('Invalid');
    });

    it('pairs with nothing when a field of its column lies between it and the field above', () => {
      // The second field starts under the first and reaches past the
      // message's top: the message sits inside that field's own span, so it
      // is not the first field's, and it is not below the second.
      const first = input(0, 100);
      const second = node({ role: 'textfield', identifier: 'Component', rect: { x: 0, y: 160, width: 300, height: 40 } });
      attachFieldErrors([first, second, message(0, 190)]);
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
    });

    it('counts a message starting exactly at the field’s bottom as below it', () => {
      const iban = input(0, 100); // bottom = 120
      attachFieldErrors([iban, message(0, 120)]);
      expect(iban.error).toBe('Invalid');
    });

    it('a message starting 1 pt above the field’s bottom is not below it: it pairs with nothing', () => {
      const iban = input(0, 100); // bottom = 120
      attachFieldErrors([iban, message(0, 119)]);
      expect(iban.error).toBeUndefined();
    });

    it('a field of its column starting exactly at the upper field’s bottom, reaching past the message’s top, lies between them', () => {
      const first = input(0, 100); // bottom = 120
      const second = node({ role: 'textfield', identifier: 'Component', rect: { x: 0, y: 120, width: 300, height: 30 } });
      attachFieldErrors([first, second, message(0, 140)]);
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
    });

    it('a field whose horizontal extent only touches the message’s (an overlap of exactly 0) is not in its column', () => {
      const left = input(0, 100, 150); // right edge at 150
      attachFieldErrors([left, message(150, 130, 150)]);
      expect(left.error).toBeUndefined();
    });

    describe('how far below the field it may start', () => {
      // At most 24 pt below the field's bottom, or the field's own height when
      // that is more: the IBAN message starts 16 pt under its 20 pt field.
      it.each([
        [20, 24, true],
        [20, 25, false],
        [48, 48, true],
        [48, 49, false],
      ])('a %i pt field, a message %i pt below its bottom: pairs %s', (height, gap, pairs) => {
        const f = node({ role: 'textfield', identifier: 'Component', rect: { x: 0, y: 100, width: 300, height } });
        attachFieldErrors([f, message(0, 100 + height + gap)]);
        expect(f.error).toBe(pairs ? 'Invalid' : undefined);
      });
    });

    it('a field of another column between them does not keep it from the field above', () => {
      // A narrow field to the right, starting between the IBAN field's bottom
      // and the message's top: it is not in the message's column.
      const iban = input(0, 100, 150);
      const aside = input(200, 125, 100);
      attachFieldErrors([iban, aside, message(0, 130, 150)]);
      expect(iban.error).toBe('Invalid');
      expect(aside.error).toBeUndefined();
    });

    describe('a field with no identifier', () => {
      // The message's own identifier names it an error; the field needs no
      // identifier to be the one it lies under, or to stand between them.
      const bare = (y: number): UiNode => node({ role: 'textfield', identifier: null, rect: { x: 0, y, width: 300, height: 20 } });

      it('takes the message under it', () => {
        const f = bare(100);
        attachFieldErrors([f, message(0, 130)]);
        expect(f.error).toBe('Invalid');
      });

      it('lying between them keeps it from the field above', () => {
        const iban = input(0, 100);
        const between = node({ role: 'textfield', identifier: null, rect: { x: 0, y: 125, width: 300, height: 20 } });
        attachFieldErrors([iban, between, message(0, 130)]);
        expect(iban.error).toBeUndefined();
        expect(between.error).toBeUndefined();
      });
    });

    describe('two fields side by side on one row', () => {
      // An expiry/CVV-style row: two inputs at the same height, 20 pt apart.
      const row = (): [UiNode, UiNode] => [input(0, 100, 140), input(160, 100, 140)];

      it('a message under one of them pairs with that one alone', () => {
        const [left, right] = row();
        attachFieldErrors([left, right, message(160, 130, 140)]);
        expect(left.error).toBeUndefined();
        expect(right.error).toBe('Invalid');
      });

      it('a message reaching under both pairs with the one it overlaps more', () => {
        // Listed after the field it barely reaches, so document order alone
        // would pick the wrong one.
        const [left, right] = row();
        attachFieldErrors([left, right, message(100, 130, 200)]);
        expect(left.error).toBeUndefined();
        expect(right.error).toBe('Invalid');
      });

      it('a message overlapping both equally pairs with the first listed', () => {
        const [left, right] = row();
        attachFieldErrors([left, right, message(0, 130, 300)]);
        expect(left.error).toBe('Invalid');
        expect(right.error).toBeUndefined();
      });
    });

    it('gives way to a message carrying the field’s own identifier', () => {
      // Listed last and nearer, so neither order nor distance hands it the
      // field: the same-identifier message is the field's by convention.
      const amount = node({ role: 'textfield', identifier: 'amount', rect: { x: 0, y: 100, width: 300, height: 20 } });
      attachFieldErrors([amount, text('amount', 160, 'Too large'), message(0, 125, 300, 'Invalid', 'amount_error')]);
      expect(amount.error).toBe('Too large');
    });

    it.each([
      ['farther', [185, 150]],
      ['nearer', [150, 185]],
    ] as const)('of two such messages under one field, the nearer pairs (the %s listed first)', (_, ys) => {
      // A 48 pt field, so both lie close enough under it (bottom 148: 2 and
      // 37 pt below). Both orders, so neither the first nor the last listed
      // wins by document order alone.
      const iban = node({ role: 'textfield', identifier: 'Component', rect: { x: 0, y: 100, width: 300, height: 48 } });
      attachFieldErrors([iban, ...ys.map((y) => message(0, y, 300, y === 150 ? 'Nearer' : 'Farther'))]);
      expect(iban.error).toBe('Nearer');
    });
  });

  it('leaves a field with no candidate untouched', () => {
    const target = field('amount', 100);
    attachFieldErrors([target, text('other', 130, 'Unrelated')]);
    expect(target.error).toBeUndefined();
  });
});

describe('everyNode', () => {
  it('yields the root and every descendant, pre-order', () => {
    const tree = node({
      identifier: 'root',
      children: [
        node({ identifier: 'a', children: [node({ identifier: 'a1' })] }),
        node({ identifier: 'b' }),
      ],
    });
    expect([...everyNode(tree)].map((n) => n.identifier)).toEqual(['root', 'a', 'a1', 'b']);
  });

  it('reaches a field and its error sitting in DIFFERENT branches', () => {
    const target = field('amount', 100);
    const tree = node({
      children: [node({ children: [target] }), node({ children: [text('amount', 130, 'Too large')] })],
    });
    // Rects are absolute, so a cross-branch pair must still be found — this is
    // the whole reason the nested WDA tree can reuse the flat rule.
    attachFieldErrors(everyNode(tree));
    expect(target.error).toBe('Too large');
  });
});
