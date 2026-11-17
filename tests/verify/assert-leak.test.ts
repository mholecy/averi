import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { Verifier, type AssertSpec } from '../../src/verify/assert.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';

// The LEAK SWEEP of an element assert's failure (A66), in the style of tests/interact/fill-leak.test.ts: an input that is
// NOT the assert's subject — on the screen when the spec matched nothing, so the hint lists the whole tree — never has
// its own text in the reply, which may be a password a fill typed a moment ago. Its text is said by its length and rect
// (ui-tree/listed-text.ts#listedText). The assert's own subject is quoted (assert.test.ts pins that), and so is a
// folded hint's node (text-hint.ts#foldedTextHint: it differs from the expected string only in recognizer readings, so
// it says nothing the caller did not write). Each case's sentence is asserted first, so a case that stops reaching its
// path fails as such.

/** The input's own text: a string no sentence of averi holds, nor any four characters of it in a row. */
const OWN = 'zq7vXk2§';
const EXPECTED = '1 of 13 selected';
const FAST = { pollMs: 5, timeoutMs: 100 };

/** Every run of four characters of the sentinel. */
const runs = [...Array(OWN.length - 3).keys()].map((i) => OWN.slice(i, i + 4));

/** The inputs whose own text holds the expected text as a segment, each the hint's `label ?? value`. */
const INPUTS: [string, Partial<UiNode>][] = [
  ['an Android EditText labelled by its own text', { label: `${OWN}, ${EXPECTED}`, value: `${OWN}, ${EXPECTED}` }],
  ['an input with no label', { label: null, value: `${OWN} – ${EXPECTED}` }],
];

const HINT = 'no node has this exact text, but 1 node(s) CONTAIN it as a whole segment:\n    id=memo label=<its text, ';

/** The assert's paths that read the whole tree (the spec matches nothing), and the sentence each must reach. */
const SPECS: [string, AssertSpec, string][] = [
  ['a text spec', { element: { text: EXPECTED } }, HINT],
  ['a label spec', { element: { label: EXPECTED } }, HINT],
  ['a role and text spec', { element: { role: 'button', text: EXPECTED } }, HINT],
  ['a text on an id that is not there', { element: { id: 'absent' }, text: EXPECTED }, HINT],
  ['a match on an id that is not there', { element: { id: 'absent' }, match: '1 of 13' }, 'not found within 0.1 s'],
];

describe("an element assert never quotes the own text of an input that is not its subject (A66)", () => {
  describe.each(INPUTS)('%s', (_, input) => {
    it.each(SPECS)('%s', async (_name, spec, sentence) => {
      resetLayout();
      const fake = new FakeAdapter(
        { s: screen(el({ role: 'textfield', identifier: 'memo', ...input }), el({ role: 'text', identifier: 'title', label: 'Filters' })) },
        's',
      );
      const result = await new Verifier(fake, FAST).assert(spec);
      expect(result.pass).toBe(false);
      expect(result.detail).toContain(sentence);
      for (const run of runs) expect(result.detail).not.toContain(run);
    });
  });
});
