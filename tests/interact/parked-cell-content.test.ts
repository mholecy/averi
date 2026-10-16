import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { judgeTap } from '../../src/interact/tap-judgement.js';
import { lookOn } from '../../src/ui-tree/look.js';
import { usableScreen } from '../../src/ui-tree/usable-screen.js';
import { play } from '../helpers/rounds.js';

// A tap and `scroll_until` on the label of a cell UIKit has not laid out, under WDA — the bug note's expected
// behaviour: the row is below the fold, so the tap is refused off screen and `scroll_until` scrolls to it, never
// "Tapped" at the parked point nor "fully visible after 0 swipes".
// docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md
// docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md

const IPHONE = { width: 402, height: 874 };
const contactsSheet = async (): Promise<UiNode> =>
  parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-new-contact.json', import.meta.url), 'utf8'));
const text = (tree: UiNode, label: string): UiNode => [...everyNode(tree)].find((n) => n.role === 'text' && n.label === label)!;

describe('the label of a cell below the fold (Contacts New Contact, `add instant message`, its cell at 20,1306)', () => {
  it('tap: refused as off screen — scroll_until it first — never sent to the parked point (143,73), the sheet\'s grabber strip', async () => {
    const tree = await contactsSheet();
    const adapter = { viewport: async () => IPHONE };
    // The look of the tree on an adapter with no oracle (ui-tree/look.ts#lookOn): the in-tree reading, no dismissal.
    const look = lookOn({}, tree);
    const outcome = await judgeTap(adapter, 'role:text label:"add instant message"', { node: text(tree, 'add instant message'), look }, await usableScreen(adapter, look))
      .then((j) => j.aim())
      .catch((e: unknown) => e as Error);
    expect(outcome instanceof Error ? `${outcome.constructor.name}: ${outcome.message}` : JSON.stringify(outcome)).toBe(
      'OffScreenRefusal: role:text label:"add instant message" is off screen at (201,1332) on a 402x874 screen (rect 20,1306 362x52) — scroll_until it first; nothing was tapped',
    );
  });

  it('scroll_until … fully: the first round strokes toward it, down — no "fully visible after 0 swipes"', async () => {
    const tree = await contactsSheet();
    const target = text(tree, 'add related name');
    const played = play({ direction: 'down', fully: true, maxSwipes: 5, timeoutMs: 30000, screen: IPHONE }, [{ tree, found: [target] }]);
    expect(played.outcome).toBeUndefined();
    expect(played.steps.map((s) => (s.do === 'stroke' ? `stroke ${s.toward}` : s.do))).toEqual(['stroke down']);
  });
});
