import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { Verifier, type AssertSpec } from '../../src/verify/assert.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';

// The LEAK SWEEP of an element assert's failure (A66), in the style of tests/interact/fill-leak.test.ts: an input that is
// NOT the assert's subject — on the screen when the spec matched nothing, so the hint lists the whole tree — never has
// its own text in the reply, which may be a password a fill typed a moment ago. Its text is said by its length and rect
// (ui-tree/node-words.ts#listedText). The assert's own subject is quoted (assert.test.ts pins that), and so is a
// folded hint's node (text-hint.ts#foldedTextHint: it differs from the expected string only in recognizer readings, so
// it says nothing the caller did not write). Each case's sentence is asserted first, so a case that stops reaching its
// path fails as such.

/** The input's own text: a string no sentence of averi holds, nor any four characters of it in a row. */
const OWN = 'zq7vXk2§';
const EXPECTED = '1 of 13 selected';
const FAST = { pollMs: 5, timeoutMs: 100 };

/** Every run of four characters of the sentinel. */
const runs = [...Array(OWN.length - 3).keys()].map((i) => OWN.slice(i, i + 4));

/** The inputs whose text holds the expected text as a segment, and the hint's line for each (the input is laid first). */
const INPUTS: [string, Partial<UiNode>, string][] = [
  [
    'an Android EditText labelled by its own text',
    { label: `${OWN}, ${EXPECTED}`, value: `${OWN}, ${EXPECTED}` },
    '    id=memo label=<its text, 26 characters> at 0,20 100x10\n',
  ],
  ['an input with no label', { label: null, value: `${OWN} – ${EXPECTED}` }, '    id=memo label=<its text, 27 characters> at 0,20 100x10\n'],
  ['an iOS input with a title', { label: 'Note', value: `${OWN} ${EXPECTED}` }, '    id=memo label="Note"\n'],
];

const HINT = 'no node has this exact text, but 1 node(s) CONTAIN it as a whole segment:\n';

/** The assert's paths that read the whole tree: the spec matches nothing. */
const SPECS: [string, AssertSpec][] = [
  ['a text spec', { element: { text: EXPECTED } }],
  ['a label spec', { element: { label: EXPECTED } }],
  ['a role and text spec', { element: { role: 'button', text: EXPECTED } }],
  ['a text on an id that is not there', { element: { id: 'absent' }, text: EXPECTED }],
];

const inputNode = (input: Partial<UiNode>): UiNode => el({ role: 'textfield', identifier: 'memo', ...input });
/** A subject that is no input, saying the wrong thing. */
const wrongSubject = (): UiNode => el({ role: 'text', identifier: 'subject', label: 'Wrong' });

function inputFake(input: Partial<UiNode>): FakeAdapter {
  resetLayout();
  return new FakeAdapter({ s: screen(inputNode(input), el({ role: 'text', identifier: 'title', label: 'Filters' })) }, 's');
}

/** A fake whose first tree read shows `first`, every later one `later`. */
function sequenceFake(first: UiNode[], later: UiNode[]): FakeAdapter {
  const fake = new FakeAdapter({ first: screen(...first), later: screen(...later) }, 'first');
  const read = fake.uiTree.bind(fake);
  fake.uiTree = async () => {
    const tree = await read();
    fake.current = 'later';
    return tree;
  };
  return fake;
}

const noRun = (detail: string | undefined): void => {
  for (const run of runs) expect(detail).not.toContain(run);
};

describe('an element assert never quotes the own text of an input that is not its subject (A66)', () => {
  describe.each(INPUTS)('%s', (_, input, line) => {
    it.each(SPECS)('%s', async (_name, spec) => {
      const result = await new Verifier(inputFake(input), FAST).assert(spec);
      expect(result.pass).toBe(false);
      expect(result.detail).toContain(`${HINT}${line}`);
      noRun(result.detail);
    });

    it('a match on an id that is not there: the no-hint path, the miss alone', async () => {
      // A match is containment already, so no hint lists the tree.
      const result = await new Verifier(inputFake(input), FAST).assert({ element: { id: 'absent' }, match: '1 of 13' });
      expect(result.pass).toBe(false);
      expect(result.detail).toBe('not found within 0.1 s');
    });

    it('no subject in the first read, then a subject that is no input with the wrong content', async () => {
      resetLayout();
      const memo = inputNode(input);
      const fake = sequenceFake([memo], [memo, wrongSubject()]);
      const result = await new Verifier(fake, FAST).assert({ element: { id: 'subject' }, text: EXPECTED });
      expect(result.pass).toBe(false);
      expect(result.detail).toBe('element found but content was: "Wrong"');
      noRun(result.detail);
    });

    it('the subject in the first read, then a tree holding only the input', async () => {
      resetLayout();
      const subject = wrongSubject();
      const fake = sequenceFake([subject], [inputNode(input)]);
      const result = await new Verifier(fake, FAST).assert({ element: { id: 'subject' }, text: EXPECTED });
      expect(result.pass).toBe(false);
      expect(result.detail).toBe('element found but content was: "Wrong"');
      noRun(result.detail);
    });

    it('the subject only in a handed-on tree: the fresh reads are the evidence, and list the input by its rule', async () => {
      // The handed tree (ADR 0030) may only end the poll: its miss is discarded, so its subject is no subject either.
      resetLayout();
      const fake = new FakeAdapter({ s: screen(inputNode({ ...input, identifier: 'subject' })) }, 's');
      const verifier = new Verifier(fake, FAST);
      await verifier.assert({ element: { id: 'subject' } });
      fake.live().children[0].identifier = 'memo';
      const result = await verifier.assert({ element: { id: 'subject' }, text: EXPECTED });
      expect(result.pass).toBe(false);
      expect(result.detail).toBe(`not found within 0.1 s\n  ${HINT}${line}` +
        `    (iOS combines a container's children into one accessibility element — use match: "${EXPECTED}" for a cross-platform assert)`);
      noRun(result.detail);
    });
  });
});
