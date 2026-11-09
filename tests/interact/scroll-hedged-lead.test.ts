import { describe, expect, it } from 'vitest';
import { describeScrollResult, type ScrollUntilResult } from '../../src/interact/scroll-text.js';
import { node } from '../helpers/fake.js';

/**
 * T17 (ADR 0013's T17 amendment): a `fully: true` stop the reply hedges — a flush edge no probe checked (every `why`
 * of interact/flush-check.ts#Flush) or a soft keyboard nothing could place (`unlocated`) — stays a success, but its
 * opening claims nothing the rest takes back: `visible after N swipes, NOT CONFIRMED WHOLE: <the hedge>`, never
 * `fully visible`. A checked flush stop and a clean one keep `fully visible`.
 */
const box = { x: 0, y: 242, width: 1080, height: 1736 };
const header = { role: 'container', label: null, identifier: 'header', rect: { x: 0, y: 242, width: 1080, height: 154 } };
const stop = (r: Partial<ScrollUntilResult>): ScrollUntilResult => ({ swipes: 3, visible: 1, clipped: [], ...r });
const UNLOCATED_CLAUSE =
  'the input method reports a soft keyboard shown, but the window state gives it no area on screen (one still coming up? not measured), so where it lies is unknown — it was not judged and may cover the element';

const HEDGES: readonly [string, ScrollUntilResult['flush'], string][] = [
  ['budget', { edge: 'top', container: box, checked: false, why: 'budget' }, "its top edge lies on its scroll container's (0,242 1080x1736), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there"],
  ['room', { edge: 'bottom', container: box, checked: false, why: 'room' }, 'no scroll container around it has room for a probe swipe to check it — it may be cut there'],
  ['axis', { edge: 'bottom', container: box, checked: false, why: 'axis' }, 'every scroll container around it from that one outward scrolls only sideways, so no probe swipe can move its bottom edge into view to check it — it may be cut there'],
  ['tap', { edge: 'top', container: box, checked: false, why: 'tap' }, 'the probe swipe was too short to tell from a tap — it may be cut there'],
  ['held', { edge: 'right', container: box, checked: false, why: 'held', revealed: 64 }, 'a swipe toward it showed 64 px more of it, then 2 swipes after it moved nothing — the content ended there or the app did not take them'],
  ['fills', { edges: ['top', 'bottom'], container: box, checked: false, why: 'fills' }, 'it fills its scroll container (0,242 1080x1736) exactly'],
  ['fills + pinned', { edges: ['top', 'bottom'], container: box, pinned: header, checked: false, why: 'fills' }, 'it spans its scroll container (0,242 1080x1736) from the edge of container id:header'],
];

describe('T17 — a hedged fully: true stop opens with a lead that does not claim it whole', () => {
  it.each(HEDGES)('%s: `visible after N swipes, NOT CONFIRMED WHOLE: <the hedge>`, never `fully visible`', (_why, flush, clause) => {
    const reply = describeScrollResult(stop({ flush }));
    expect(reply).toMatch(/^visible after 3 swipes, NOT CONFIRMED WHOLE: /);
    expect(reply).not.toMatch(/fully visible/);
    expect(reply).not.toContain('; but ');
    expect(reply).toContain(clause);
  });

  it.each(HEDGES)('%s, the eyes unjudged: `visible by the tree after N swipes, NOT CONFIRMED WHOLE: …`', (_why, flush) => {
    const eyes = { sees: 'unjudged', edge: 'bottom', by: node({ role: 'button', identifier: 'bar', rect: { x: 0, y: 1978, width: 1080, height: 100 } }), why: 'a blended frame' } as const;
    const reply = describeScrollResult(stop({ flush, eyes }));
    expect(reply).toMatch(/^visible by the tree after 3 swipes, NOT CONFIRMED WHOLE: /);
    expect(reply).not.toMatch(/fully visible/);
    expect(reply).toContain('a screenshot could not tell (a blended frame)');
  });

  it('a checked flush stop keeps `fully visible after N swipes; …` unchanged', () => {
    const reply = describeScrollResult(stop({ flush: { edge: 'top', container: box, checked: true } }));
    expect(reply).toBe("fully visible after 3 swipes; its top edge lies on its scroll container's (0,242 1080x1736), and 2 probe swipes toward it moved nothing — nothing of it is cut there");
  });

  it('a clean stop keeps `fully visible after N swipes`', () => {
    expect(describeScrollResult(stop({}))).toBe('fully visible after 3 swipes');
  });

  it('the `unlocated` keyboard: `visible after N swipes, NOT CONFIRMED UNCOVERED: <the keyboard clause>`', () => {
    expect(describeScrollResult(stop({ keyboard: { state: 'unlocated' } }))).toBe(`visible after 3 swipes, NOT CONFIRMED UNCOVERED: ${UNLOCATED_CLAUSE}`);
  });

  it('a flush hedge and an unlocated keyboard: `NOT CONFIRMED WHOLE OR UNCOVERED:`, both clauses kept', () => {
    const reply = describeScrollResult(stop({ flush: { edge: 'top', container: box, checked: false, why: 'budget' }, keyboard: { state: 'unlocated' } }));
    expect(reply).toBe(
      `visible after 3 swipes, NOT CONFIRMED WHOLE OR UNCOVERED: its top edge lies on its scroll container's (0,242 1080x1736), where Android cuts a node's bounds to the container, ` +
        `and no swipe or time was left to check it — it may be cut there, a rect assert or screenshot may measure part of it; ${UNLOCATED_CLAUSE}`,
    );
  });

  it('a flush hedge judged above a docked keyboard: the lead first, where it was judged after the hedge', () => {
    const reply = describeScrollResult(stop({ flush: { edge: 'top', container: box, checked: false, why: 'tap' }, keyboard: { state: 'shown', frame: { x: 0, y: 1400, width: 1080, height: 800 } } }));
    expect(reply).toMatch(/^visible after 3 swipes, NOT CONFIRMED WHOLE: its top edge .* too short to tell from a tap — it may be cut there, a rect assert or screenshot may measure part of it; judged above the soft keyboard over /);
  });

  it('a checked flush stop with an unlocated keyboard: only the keyboard is unconfirmed, the probe clause kept after it', () => {
    const reply = describeScrollResult(stop({ flush: { edge: 'top', container: box, checked: true }, keyboard: { state: 'unlocated' } }));
    expect(reply).toBe(
      `visible after 3 swipes, NOT CONFIRMED UNCOVERED: ${UNLOCATED_CLAUSE}; its top edge lies on its scroll container's (0,242 1080x1736), and 2 probe swipes toward it moved nothing — nothing of it is cut there`,
    );
  });
});
