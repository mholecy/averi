import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { RoundRules } from '../../src/interact/scroll-rounds.js';
import { geometryOf, visibleOf } from '../../scripts/truth/truth.js';
import { parseDump } from '../helpers/android-dumps.js';
import { failureOf, play, type Row } from '../helpers/rounds.js';

/**
 * Backlog T6d: the PREDICTION for the lab cell `carousel-in-list-cut` (fixtures/apps/cells/edges.json, Edges.kt), pinned
 * before its capture (the owner's): carousel-in-list's page and told-axis carousel (a Compose `horizontalScroll`,
 * dumped `android.widget.HorizontalScrollView`), scrolled on appear one card and CUT_DP further, so C — as wide as the
 * carousel's clip — is drawn cut CUT_DP at the clip's LEFT edge, both its sides on the screen. D52's `unfit`
 * (ADR 0021): `fully: true` on C holds at one exact offset only, and the first read knows it.
 *
 * The geometry from the layout arithmetic on averi_lab (1080x2220, density 2.75), at carousel-in-list's measured clip
 * (tests/fixtures/truth/android-averi_lab-api33/carousel-in-list.state.json: `carousel` 66,380 948x234; C 948 wide):
 * the cut 8 dp = 22 px, the carousel's offset on appear 948 + 22 = 970 px, so C lies at 66 + 948 - 970 = 44, its right
 * side at 992 — inside the screen (no side unknown: uiautomator cuts a node at the SCREEN's edge, D17) and listed whole
 * (a clickable Compose node's bounds run on up to 24 dp = 66 px past a clipping container: Edges.kt#SPLIT_CELLS' note;
 * E2 read C at 45 so, batch-3/6). The synthetic dump is carousel-in-list's real one with C moved there and renamed. A
 * capture that disagrees is a finding, not a reason to edit these pins.
 */

const XML = readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/carousel-in-list.xml', import.meta.url), 'utf8');
const C_ID = 'lab.carousel-in-list-cut.C';
const SCREEN: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
const CAROUSEL: Rect = { x: 66, y: 380, width: 948, height: 234 };
const C: Rect = { x: 44, y: 380, width: 948, height: 234 };

/** The capture's expected dump: carousel-in-list's, C renamed and laid at 44 — `[44,380][992,614]`. */
const cutDump = (): string =>
  XML.replace('resource-id="lab.carousel-in-list.C"', `resource-id="${C_ID}"`).replace(/(resource-id="lab\.carousel-in-list-cut\.C"[^>]*bounds=")\[1014,380\]\[1080,614\]/, '$1[44,380][992,614]');

const row = (): Row => {
  const tree: UiNode = parseDump(cutDump());
  const c = [...everyNode(tree)].find((n) => n.identifier === C_ID);
  if (c === undefined) throw new Error('no C');
  return { tree, found: [c] };
};

const FULLY_LEFT: RoundRules & { screen: { width: number; height: number } } = {
  direction: 'left',
  fully: true,
  maxSwipes: 6,
  timeoutMs: 15_000,
  readSettles: true,
  screen: { width: 1080, height: 2220 },
};

describe('carousel-in-list-cut (T6d): C drawn cut at the carousel\'s left clip on appear', () => {
  it('the layout arithmetic: 8 dp = 22 px; offset 970 px; C at 44–992 in the clip 66–1014', () => {
    expect(Math.round(8 * 2.75)).toBe(22);
    expect(CAROUSEL.x + CAROUSEL.width - (948 + 22)).toBe(C.x);
    expect(C.x + C.width).toBe(992);
  });

  it('the truth will measure it partly-centre-in, 926 of its 948 px showing — cut by its scroll view, not the screen', () => {
    const ctx = { screen: SCREEN, safeArea: { top: 66, left: 0, bottom: 66, right: 0 }, clip: CAROUSEL };
    expect(geometryOf(C, ctx)).toBe('partly-centre-in');
    expect(visibleOf(C, ctx)).toEqual({ x: 66, y: 380, width: 926, height: 234 });
  });

  it('the dump lists C where it lies, in the HorizontalScrollView that tells its axis', () => {
    const r = row();
    expect(r.found?.[0]?.rect).toEqual(C);
    const carousel = [...everyNode(r.tree!)].find((n) => n.rect.x === 66 && n.rect.y === 380 && n.rect.width === 948 && n.rect.height === 234 && n.scrollAxis !== undefined);
    expect(carousel?.scrollAxis).toBe('horizontal');
  });

  it('`fully: true` left on C: `unfit` on the first read, no swipe — the reply golden\'s R-unfit row asks', () => {
    const played = play(FULLY_LEFT, [row()]);
    expect(played.steps.map((s) => s.do)).toEqual(['stop']);
    expect(played.outcome).toMatchObject({ kind: 'unfit', swipes: 0, unfit: { along: 'horizontal', size: 948, scrollView: { rect: CAROUSEL } } });
    expect(failureOf(played, `id:"${C_ID}"`).message).toBe(
      `scroll_until id:"${C_ID}" failed after 0 swipes — element is in the viewport but CLIPPED at left: 98% of it is drawn, ` +
        'and it is 948 wide (tree units), as wide as its scroll view scrollable (66,380 948x234): fully: true holds at one exact scroll offset only, ' +
        'which no swipe can be aimed at — drop fully: true, or accept what it shows. ' +
        'Last rect {"x":44,"y":380,"width":948,"height":234} in a 1080x2220 viewport',
    );
  });

  it('the plain stop (`fully: false`) on the same read: visible, no swipe', () => {
    expect(play({ ...FULLY_LEFT, fully: false }, [row()]).outcome).toMatchObject({ kind: 'visible', swipes: 0 });
  });
});
