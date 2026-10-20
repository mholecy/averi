import { describe, expect, it } from 'vitest';
import type { PresentationKind } from '../../src/adapters/types.js';
import type { MarkedLayer } from '../../src/ui-tree/presentation.js';
import { ACTIVE_WINDOW_HINT } from '../../src/ui-tree/miss.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
import { flushText } from '../../src/interact/scroll-text.js';
import { flushProbedSide, presentedRemedySaid, windowHintSaid } from '../../scripts/truth/replies.js';

// The two "close it first" the harness reads apart (scripts/truth/replies.ts): the presented remedy, driven here by
// src's own builders (ui-tree/standing.ts#presentedRemedy, #presentedStop) over every layer they word, and the
// active-window hint (#ACTIVE_WINDOW_HINT), which is no presented remedy.

/** Every presentation kind — the type check below fails when src adds one this list lacks. */
const KINDS = ['alert', 'actionSheet', 'popover', 'dialog', 'screen'] as const satisfies readonly PresentationKind[];
const everyKind: Exclude<PresentationKind, (typeof KINDS)[number]> extends never ? true : false = true;

const LAYERS: readonly (MarkedLayer | undefined)[] = [undefined, ...KINDS.flatMap((kind) => [{ kind }, { kind, label: 'Delete account?' }])];

describe('presentedRemedySaid: the presented remedy in every wording src builds', () => {
  it.each(LAYERS.flatMap((layer) => (['it', 'the element'] as const).map((what) => [what, layer] as const)))('presentedRemedy(%s, %o)', (what, layer) => {
    expect(everyKind).toBe(true);
    const remedy = presentedRemedy(what, layer);
    expect(presentedRemedySaid(`ERROR id:"lab.x" is under … — ${remedy}; nothing was tapped`)).toBe(true);
    expect(windowHintSaid(remedy)).toBe(false);
  });

  it.each(LAYERS.map((layer) => [layer] as const))('presentedStop(%o)', (layer) => {
    expect(presentedRemedySaid(`ERROR scroll_until id:"lab.x" stopped before any swipe — … — ${presentedStop(layer)}, so none was sent`)).toBe(true);
  });

  it('not the active-window hint, nor a bare "close it first"', () => {
    const hinted = `ERROR Timed out after 5000ms waiting for element id:"lab.x" to appear\n  (${ACTIVE_WINDOW_HINT})`;
    expect(presentedRemedySaid(hinted)).toBe(false);
    expect(windowHintSaid(hinted)).toBe(true);
    expect(presentedRemedySaid('ERROR … — close it first; nothing was tapped')).toBe(false);
  });
});

describe('flushProbedSide: the probed side in both forms src builds (src/interact/scroll-text.ts#flushText)', () => {
  const container = { x: 0, y: 303, width: 1080, height: 1238 };
  const pinned = { role: 'container', identifier: 'header', label: null, rect: { x: 0, y: 303, width: 1080, height: 154 } };

  it('on the scroll container\'s own edge and on the edge of a node pinned in it, each side', () => {
    for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
      expect(flushProbedSide(`fully visible after 1 swipe${flushText({ edge, container, checked: true })}`)).toBe(edge);
      expect(flushProbedSide(`fully visible after 2 swipes${flushText({ edge, container, pinned, checked: true })}`)).toBe(edge);
    }
  });

  it('none where no probe moved nothing: unchecked, or spanning the container', () => {
    expect(flushProbedSide(`fully visible after 0 swipes${flushText({ edge: 'top', container, pinned, checked: false, why: 'budget' })}`)).toBeUndefined();
    expect(flushProbedSide(`fully visible after 0 swipes${flushText({ edges: ['top', 'bottom'], container, pinned, checked: false, why: 'fills' })}`)).toBeUndefined();
  });
});
