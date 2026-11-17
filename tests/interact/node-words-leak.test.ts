import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import type { RoundRules } from '../../src/interact/scroll-rounds.js';
import { tapElement } from '../../src/interact/tap.js';
import { Verifier } from '../../src/verify/assert.js';
import { FAST, FakeAdapter, iosLoginFake, node } from '../helpers/fake.js';
import { failureOf, play, type Row } from '../helpers/rounds.js';

// The LEAK SWEEP of the sentences that NAME A NODE (A67), in the style of fill-leak.test.ts and assert-leak.test.ts:
// an input labelled by its own text — an Android EditText with no content-desc, whose label is its value, which may be
// a password typed a moment ago — is never quoted where a tap, `scroll_until`, a dismissal or a pixel assert names it:
// as a cover over a tap's target, in a `within` refusal, as the node a stroke touched down on, as what keeps a
// configured dismissal from a tap, as a cover over a pixel assert's element. It is said by its length
// (ui-tree/node-words.ts#nodeText, the A54 rule of ADR 0043). Each case's sentence is asserted first, so a case that
// stops reaching its path fails as such. The keyboard's accessory button is no case: accessoryDismissButton
// (ui-tree/soft-keyboard.ts) takes a `button` only, never an input.

/** The input's own text: a string no sentence of averi holds, nor any four characters of it in a row. */
const OWN = 'zq7vXk2§';
const OWN_WORDS = '<its text, 8 characters>';
const runs = [...Array(OWN.length - 3).keys()].map((i) => OWN.slice(i, i + 4));
const noRun = (said: string): void => {
  for (const run of runs) expect(said).not.toContain(run);
};

/** An input labelled by its own text at `rect`. */
const ownInput = (rect: Rect, identifier: string | null = null): UiNode => node({ role: 'textfield', label: OWN, value: OWN, identifier, rect });

const PIXEL = { width: 1080, height: 2220 };
/** A 1080x2220 screen: `row` (0,1100 1080x`rowHeight`), the input drawn after it over its top 200 px. */
function underInput(rowHeight: number, role = 'button'): FakeAdapter {
  const fake = new FakeAdapter(
    {
      s: node({
        role: 'container',
        rect: { x: 0, y: 0, ...PIXEL },
        children: [node({ role, identifier: 'row', label: 'Row', rect: { x: 0, y: 1100, width: 1080, height: rowHeight } }), ownInput({ x: 0, y: 1100, width: 1080, height: 200 })],
      }),
    },
    's',
  );
  fake.viewportSize = { ...PIXEL };
  return fake;
}

const COVER = `textfield ${OWN_WORDS} (0,1100 1080x200)`;

describe('a sentence that names an input labelled by its own text says its length, never the text (A67)', () => {
  it('a tap moved off it: the moved note', async () => {
    const result = await tapElement(underInput(300), 'id:row', FAST);
    expect(result.moved).toBe(`at (540,1350) — its centre (540,1250) is under ${COVER}, drawn over it; tapped the uncovered part 1080x100`);
    noRun(result.moved!);
  });

  it('a tap refused under it: the CoveredRefusal', async () => {
    const message = await tapElement(underInput(210), 'id:row', FAST).then(
      () => 'tapped',
      (e: unknown) => (e as Error).message,
    );
    expect(message).toContain(`id:row is under ${COVER} at its centre (540,1205), drawn over it`);
    noRun(message);
  });

  it('a pixel assert on an element under it: failed closed, naming the cover', async () => {
    const r = await new Verifier(underInput(300, 'text'), { pollMs: 5, timeoutMs: 100 }).assert({ element: { id: 'row' }, color: { expected: '#FFFFFF' } });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain(`${COVER} is drawn over the element`);
    noRun(r.detail ?? '');
  });

  it('a configured dismissal under it: the skip line names it by its length', async () => {
    const fake = iosLoginFake({ keyboardAdvice: 'ADVICE' });
    fake.live().children.push(ownInput({ x: 20, y: 280, width: 362, height: 120 })); // over the title's centre (201,303)
    const message = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }] }).then(
      () => 'tapped',
      (e: unknown) => (e as Error).message,
    );
    expect(message).toContain(`(tap id:"login_title": covered by textfield ${OWN_WORDS} at 20,280 362x120)`);
    noRun(message);
  });

  describe('`scroll_until`', () => {
    const ANDROID: RoundRules & { screen: { width: number; height: number } } = { direction: 'down', fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: PIXEL };
    /** Two inputs labelled by their own text, in a screen with no scroll view. */
    const twoInputs = (): UiNode =>
      node({ role: 'container', identifier: 'content', rect: { x: 0, y: 0, ...PIXEL }, children: [ownInput({ x: 0, y: 300, width: 1080, height: 100 }, 'a'), ownInput({ x: 0, y: 500, width: 1080, height: 100 }, 'b')] });

    it.each([
      ['several match: the ambiguity lists them', 'role:textfield', `matches 2 elements: textfield ${OWN_WORDS} (0,300 1080x100), textfield ${OWN_WORDS} (0,500 1080x100)`],
      ['its match lies in no scroll view', 'id:a', `matches textfield ${OWN_WORDS} (0,300 1080x100), which is no scroll view`],
    ] as const)('`within` refused when %s', (_, within, words) => {
      const tree = twoInputs();
      const message = failureOf(play({ ...ANDROID, within }, [{ tree }]), 'id:target').message;
      expect(message).toContain(`within ${within} ${words}`);
      noRun(message);
    });

    it('the node the strokes touched down on, drawn over their list', () => {
      // tests/interact/scroll-end-turn.test.ts's case, the bar an input labelled by its own text.
      const capture = parseWdaSource(readFileSync(new URL('../fixtures/wda-capture-lab-scroll-bounded.json', import.meta.url), 'utf8'));
      const F = 'lab.scroll-bounded.F';
      const input = ownInput({ x: 0, y: 400, width: 402, height: 40 });
      const row: Row = { tree: { ...capture, children: [...capture.children, input] }, found: [...everyNode(capture)].filter((n) => n.identifier === F) };
      const IPHONE = { direction: 'up' as const, fully: false, maxSwipes: 6, timeoutMs: 15_000, screen: { width: 402, height: 874 } };
      const message = failureOf(play(IPHONE, [row, row, row]), `id:"${F}"`).message;
      expect(message).toContain(`they touched down at 201,416 on textfield ${OWN_WORDS} at 0,400 402x40`);
      noRun(message);
    });
  });
});
