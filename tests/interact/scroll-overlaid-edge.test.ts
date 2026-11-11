import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { describeScrollResult, scrollUntilVisible } from '../../src/interact/scroll.js';
import { parseDump } from '../helpers/android-dumps.js';
import { FakeAdapter } from '../helpers/fake.js';
import { bothPinnedRemedyText } from '../../src/ui-tree/remedy-text.js';

/**
 * `scroll_until` ON A NODE COMPOSE CUT AT AN OVERLAY (ui-tree/later-edges.ts#OverlaidEdge), over the lab's real captures
 * served unchanged by every read: `fully: true` never claims a row whose rest may lie under the pinned button, and a
 * role-less strip cut by the button is no stop; the plain stop on a row whose centre is clear still stops. docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md
 */

const FAST = { maxSwipes: 4, timeoutMs: 2_000, settleMs: 1 };
const fakeOf = (cell: string): FakeAdapter => {
  const fake = new FakeAdapter({ s: parseDump(readFileSync(new URL(`../fixtures/truth/android-averi_lab-api33/${cell}.xml`, import.meta.url), 'utf8')) }, 's');
  fake.viewportSize = { width: 1080, height: 2220 };
  return fake;
};
const failure = async (cell: string, selector: string, fully: boolean): Promise<string> => {
  const e = (await scrollUntilVisible(fakeOf(cell), selector, { ...FAST, fully }).catch((err: unknown) => err)) as Error;
  expect(e).toBeInstanceOf(Error);
  return e.message;
};
const RUNS_ON = "drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, so the rest of it may lie under that container";

describe('scroll_until on a node cut at an overlay', () => {
  // Neither P nor Continue lies in a scroll view (the cell lists none): no scroll moves either, so no swipe is sent (D87) —
  // it stroked 3 times before, then blamed "a layout defect", which the stop still says without the strokes.
  it('pinned-bar P, fully: true — no "fully visible": stops before any swipe naming Continue, with no share of it said to show', async () => {
    const fake = fakeOf('pinned-bar');
    const e = (await scrollUntilVisible(fake, 'id:"lab.pinned-bar.P"', { ...FAST, fully: true }).catch((err: unknown) => err)) as Error;
    expect(e.message).toContain(`stopped before any swipe — element is in the viewport but cut at its bottom edge by container id:lab.pinned-bar.continue (66,1956 948x154), ${RUNS_ON}; no swipe was sent — ${bothPinnedRemedyText('touch')}`);
    expect(e.message).not.toMatch(/% of it shows/);
    expect(fake.swipes).toEqual([]);
  });
  it('pinned-bar P, fully: true, direction up — no swipe either way', async () => {
    const fake = fakeOf('pinned-bar');
    const e = (await scrollUntilVisible(fake, 'id:"lab.pinned-bar.P"', { ...FAST, fully: true, direction: 'up' }).catch((err: unknown) => err)) as Error;
    expect(e.message).toContain('stopped before any swipe');
    expect(fake.swipes).toEqual([]);
  });
  // The plain stop is the next tap's point (its centre clear, the probe there fired P): it stops, its words as before —
  // a stated residual (ADR 0013, refined 2026-10-20): its reply does not say the row may run on under the button.
  it('pinned-bar P, the plain stop: its centre clear — stops, as before', async () => {
    expect(describeScrollResult(await scrollUntilVisible(fakeOf('pinned-bar'), 'id:"lab.pinned-bar.P"', FAST))).toBe('fully visible after 0 swipes');
  });
  it('text-under-bar P (a role-less strip under Continue), the plain stop: no stop on the strip — cut by Continue', async () => {
    const message = await failure('text-under-bar', 'id:"lab.text-under-bar.P"', false);
    expect(message).toContain(`element is in the viewport but cut at its bottom edge by container id:lab.text-under-bar.continue (66,1956 948x154), ${RUNS_ON}; only a 825x22 part of it shows`);
  });
});
