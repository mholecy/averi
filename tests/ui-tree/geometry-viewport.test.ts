import { describe, expect, it } from 'vitest';
import type { DeviceScreen, Rect, UiNode } from '../../src/adapters/types.js';
import {
  aboveNavigationBand,
  belowStatusBand,
  clippedEdges,
  collectRects,
  coverText,
  cutAtScreenEdges,
  distanceInside,
  drawnPart,
  flatListBarLine,
  frameText,
  inferScreenSize,
  isUntold,
  nodeText,
  outsideScrollViewText,
  overlapsPastSlack,
  quoted,
  rectText,
  screenOf,
  toldFrame,
  visibleFractionInViewport,
  wholePast,
  windowTurnsScreen,
  type ScreenSize,
} from '../../src/ui-tree/geometry.js';
import { node } from '../helpers/fake.js';

/**
 * geometry.ts's viewport and screen arithmetic, asked directly (backlog D45): which way a window says the screen faces
 * (`windowTurnsScreen`), which edges a rect runs past (`clippedEdges`) or lies wholly past (`wholePast`), how much of it
 * a box holds (`visibleFractionInViewport`), the system bands a box loses (`belowStatusBand`, `aboveNavigationBand`),
 * the inset window `inferScreenSize` surfaces, and the sentences' rect spellings. Each was reached before only through
 * its callers (ui-tree/standing.ts, ui-tree/usable-screen.ts, interact/scroll-text.ts).
 */

const r = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const at = (rect: Rect, ...children: UiNode[]): UiNode => node({ rect, children });
/** A root of no area: idb's synthetic root, uiautomator's multi-window dump, WDA's rect-less sheet root. */
const rectless = (...children: UiNode[]): UiNode => at(r(0, 0, 0, 0), ...children);

/** The iPhone 17 panel as `idb describe` reports it: portrait, as built. */
const IPHONE: DeviceScreen = { width: 402, height: 874 };
/** A 1080x2400 Android panel as `wm size` reports it, whose windows may sit beside its system bars. */
const PIXEL: DeviceScreen = { width: 1080, height: 2400, windowsBesideSystemBars: true };
/** A tree's own window, its sides its own (`trustworthyHeight`). */
const windowed = (width: number, height: number): ScreenSize => ({ width, height, reliable: true, trustworthyHeight: true, windowLeg: 'root' });
/** A walked extent the tree vouches for by width only: its height is the lowest content edge. */
const walked = (width: number, height: number): ScreenSize => ({ width, height, reliable: true, trustworthyHeight: false });
/** A tree that cannot say its screen, offering the window in its position that starts inset. */
const inset = (insetWindow: Rect | undefined, width = 2400, height = 1080): ScreenSize => ({ width, height, reliable: false, trustworthyHeight: false, ...(insetWindow !== undefined && { insetWindow }) });

describe('windowTurnsScreen — a window whose reach fits the panel turned sideways, and does not fit it as built', () => {
  it("a window's own sides: landscape on a portrait panel turns it; portrait does not; a square that fits either way says nothing", () => {
    expect(windowTurnsScreen(windowed(874, 402), IPHONE)).toBe(true);
    expect(windowTurnsScreen(windowed(402, 874), IPHONE)).toBe(false);
    expect(windowTurnsScreen(windowed(400, 400), IPHONE)).toBe(false);
  });

  it('a top split-screen pane (1080x1000 on 1080x2400) is landscape-SHAPED yet fits the panel unturned: not turned', () => {
    expect(windowTurnsScreen(windowed(1080, 1000), PIXEL)).toBe(false);
  });

  it('a window that fits neither way (the panel as built nor turned) is not turned', () => {
    expect(windowTurnsScreen(windowed(3000, 1080), PIXEL)).toBe(false);
    expect(windowTurnsScreen(windowed(2400, 1200), PIXEL)).toBe(false);
  });

  it('FIT_SLACK, 2 %: a reach 2 % past the turned panel still fits it; past that it does not', () => {
    expect(windowTurnsScreen(windowed(2448, 1080), PIXEL)).toBe(true);
    expect(windowTurnsScreen(windowed(2449, 1080), PIXEL)).toBe(false);
    expect(windowTurnsScreen(windowed(2400, 1101), PIXEL)).toBe(true);
    expect(windowTurnsScreen(windowed(2400, 1102), PIXEL)).toBe(false);
    // …and as built: a window within 2 % of the portrait panel fits it unturned, so it says nothing.
    expect(windowTurnsScreen(windowed(1101, 1101), PIXEL)).toBe(false);
  });

  it('a walked height never votes: a reliable width alone decides — wider than the panel as built and within it turned (an 852-wide walk over rows down to y 3000 on 393x852)', () => {
    const panel: DeviceScreen = { width: 393, height: 852 };
    expect(windowTurnsScreen(walked(852, 3000), panel)).toBe(true);
    expect(windowTurnsScreen(walked(393, 3000), panel)).toBe(false);
    // The width's slack either way: within 2 % of the side as built is that side; past 2 % of the long side is neither.
    expect(windowTurnsScreen(walked(400, 3000), panel)).toBe(false);
    expect(windowTurnsScreen(walked(401, 3000), panel)).toBe(true);
    expect(windowTurnsScreen(walked(869, 3000), panel)).toBe(true);
    expect(windowTurnsScreen(walked(870, 3000), panel)).toBe(false);
    // A walked height that would say "landscape" says nothing: the width says portrait.
    expect(windowTurnsScreen(walked(393, 200), panel)).toBe(false);
  });

  it("an unreliable tree on a platform whose windows sit beside system bars: the inset window's REACH witnesses — beside a left nav bar, and below a status bar too", () => {
    expect(windowTurnsScreen(inset(r(126, 0, 2274, 1080)), PIXEL)).toBe(true);
    expect(windowTurnsScreen(inset(r(126, 63, 2274, 1017)), PIXEL)).toBe(true);
    // Its reach, not its size: the same window laid at 300 reaches past the turned panel.
    expect(windowTurnsScreen(inset(r(300, 0, 2274, 1080)), PIXEL)).toBe(false);
    expect(windowTurnsScreen(inset(r(126, 200, 2274, 1017)), PIXEL)).toBe(false);
    // A portrait inset window fits the panel as built: not turned.
    expect(windowTurnsScreen(inset(r(0, 63, 1080, 2337), 1080, 2400), PIXEL)).toBe(false);
  });

  it('an inset rect witnesses nothing where windows never sit beside bars (an iOS tree: it is content), nor does an unreliable tree with none', () => {
    expect(windowTurnsScreen(inset(r(126, 0, 2274, 1080)), { width: 1080, height: 2400 })).toBe(false);
    expect(windowTurnsScreen(inset(r(126, 0, 2274, 1080)), { width: 1080, height: 2400, windowsBesideSystemBars: false })).toBe(false);
    expect(windowTurnsScreen(inset(undefined), PIXEL)).toBe(false);
  });

  it('a reliable tree of no usable size falls to the inset window; a panel of no usable size turns nothing', () => {
    const empty: ScreenSize = { width: 0, height: 0, reliable: true, trustworthyHeight: false, insetWindow: r(126, 0, 2274, 1080) };
    expect(windowTurnsScreen(empty, PIXEL)).toBe(true);
    expect(windowTurnsScreen({ ...empty, insetWindow: undefined }, PIXEL)).toBe(false);
    expect(windowTurnsScreen(windowed(874, 402), { width: 0, height: 874 })).toBe(false);
    expect(windowTurnsScreen(walked(852, 3000), { width: 393, height: Number.NaN })).toBe(false);
    expect(windowTurnsScreen(walked(852, 3000), { width: 0, height: 874 })).toBe(false);
  });

  it('the slack is inclusive on every side (a 400x800 panel, whose 2 % lands on whole units: 408 and 816)', () => {
    const panel: DeviceScreen = { width: 400, height: 800 };
    expect(windowTurnsScreen(walked(408, 3000), panel)).toBe(false);
    expect(windowTurnsScreen(walked(409, 3000), panel)).toBe(true);
    expect(windowTurnsScreen(walked(816, 3000), panel)).toBe(true);
    expect(windowTurnsScreen(windowed(816, 408), panel)).toBe(true);
    expect(windowTurnsScreen(windowed(816, 409), panel)).toBe(false);
  });
});

describe('clippedEdges — the viewport edges a rect runs past, in the order a reader scans', () => {
  const vp = { width: 400, height: 800 };

  it('none for a rect inside, flush edges included; each edge it runs past, top, bottom, left, right', () => {
    expect(clippedEdges(r(0, 0, 400, 800), vp)).toEqual([]);
    expect(clippedEdges(r(10, 10, 100, 100), vp)).toEqual([]);
    expect(clippedEdges(r(0, -1, 100, 100), vp)).toEqual(['top']);
    expect(clippedEdges(r(0, 701, 100, 100), vp)).toEqual(['bottom']);
    expect(clippedEdges(r(-1, 0, 100, 100), vp)).toEqual(['left']);
    expect(clippedEdges(r(301, 0, 100, 100), vp)).toEqual(['right']);
    expect(clippedEdges(r(-10, -10, 420, 820), vp)).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('a viewport that starts lower or further right (the screen below the status band, a window beside a nav bar): its own edges', () => {
    const below = { y: 62, width: 402, height: 812 };
    expect(clippedEdges(r(0, 62, 402, 812), below)).toEqual([]);
    expect(clippedEdges(r(0, 40, 100, 50), below)).toEqual(['top']);
    expect(clippedEdges(r(0, 825, 100, 50), below)).toEqual(['bottom']);
    const beside = { x: 126, width: 2274, height: 1080 };
    expect(clippedEdges(r(126, 0, 2274, 1080), beside)).toEqual([]);
    expect(clippedEdges(r(125, 0, 100, 100), beside)).toEqual(['left']);
    expect(clippedEdges(r(2301, 0, 100, 100), beside)).toEqual(['right']);
  });
});

describe('wholePast — the side of the viewport a rect lies wholly past, below before above', () => {
  const vp = r(0, 62, 402, 718);

  it('each side, a rect starting on the far edge included; none for a rect sharing any of the viewport', () => {
    expect(wholePast(r(24, 780, 354, 44), vp)).toBe('bottom');
    expect(wholePast(r(24, 18, 354, 44), vp)).toBe('top');
    expect(wholePast(r(402, 100, 100, 44), vp)).toBe('right');
    expect(wholePast(r(-100, 100, 100, 44), vp)).toBe('left');
    expect(wholePast(r(24, 779, 354, 44), vp)).toBeUndefined();
    expect(wholePast(r(24, 19, 354, 44), vp)).toBeUndefined();
    expect(wholePast(r(401, 100, 100, 44), vp)).toBeUndefined();
    expect(wholePast(r(-99, 100, 100, 44), vp)).toBeUndefined();
    expect(wholePast(r(0, 62, 402, 718), vp)).toBeUndefined();
  });

  it('below before above, and either before a side: as a scroll down finds it', () => {
    expect(wholePast(r(500, 900, 100, 44), vp)).toBe('bottom');
    expect(wholePast(r(-200, 900, 100, 44), vp)).toBe('bottom');
    expect(wholePast(r(500, 0, 100, 44), vp)).toBe('top');
    expect(wholePast(r(-200, 0, 100, 44), vp)).toBe('top');
  });

  it('a viewport offset on x: its own sides', () => {
    const beside = r(126, 0, 2274, 1080);
    expect(wholePast(r(2400, 100, 50, 50), beside)).toBe('right');
    expect(wholePast(r(76, 100, 50, 50), beside)).toBe('left');
    expect(wholePast(r(77, 100, 50, 50), beside)).toBeUndefined();
  });

  it("a rect of no area lies past none — the SWIFT form's placeholder texts read at 0,0 0x0, above the viewport's top by its edge alone", () => {
    expect(wholePast(r(0, 0, 0, 0), vp)).toBeUndefined();
    expect(wholePast(r(24, 900, 354, 0), vp)).toBeUndefined();
    expect(wholePast(r(500, 100, 0, 44), vp)).toBeUndefined();
  });
});

describe('visibleFractionInViewport — how much of a rect a box holds, as a fraction of its own area', () => {
  const vp = { width: 400, height: 800 };

  it('whole inside: 1; partly: the share inside; wholly outside or only touching: 0', () => {
    expect(visibleFractionInViewport(r(10, 10, 100, 100), vp)).toBe(1);
    expect(visibleFractionInViewport(r(0, 750, 100, 100), vp)).toBe(0.5);
    expect(visibleFractionInViewport(r(350, 0, 100, 100), vp)).toBe(0.5);
    expect(visibleFractionInViewport(r(-100, -100, 600, 1000), vp)).toBeCloseTo(320000 / 600000, 10);
    expect(visibleFractionInViewport(r(0, 800, 100, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(r(500, 0, 100, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(r(0, 900, 100, 100), vp)).toBe(0);
    // Past on both axes: two negative overlaps make a positive product — still nothing of it inside.
    expect(visibleFractionInViewport(r(500, 900, 100, 100), vp)).toBe(0);
  });

  it('a rect of no area shows nothing, though it lies inside', () => {
    expect(visibleFractionInViewport(r(10, 10, 0, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(r(10, 10, 100, 0), vp)).toBe(0);
  });

  it('a box that starts lower or further right is measured from its own origin (the screen below the status band)', () => {
    expect(visibleFractionInViewport(r(0, 12, 100, 100), { y: 62, width: 402, height: 812 })).toBe(0.5);
    expect(visibleFractionInViewport(r(0, 824, 100, 100), { y: 62, width: 402, height: 812 })).toBe(0.5);
    expect(visibleFractionInViewport(r(50, 0, 100, 100), { x: 100, width: 300, height: 800 })).toBe(0.5);
    expect(visibleFractionInViewport(r(350, 0, 100, 100), { x: 100, width: 300, height: 800 })).toBe(0.5);
  });
});

describe('belowStatusBand — a portrait box less the status band at its top', () => {
  const SCREEN = r(0, 0, 402, 874);

  it("the iPhone's 62-pt band off a portrait screen; the box itself with no band, a band of 0, or no screen", () => {
    expect(belowStatusBand(SCREEN, { statusBand: 62 })).toEqual(r(0, 62, 402, 812));
    expect(belowStatusBand(SCREEN, {})).toEqual(SCREEN);
    expect(belowStatusBand(SCREEN, { statusBand: 0 })).toEqual(SCREEN);
    expect(belowStatusBand(SCREEN, undefined)).toEqual(SCREEN);
  });

  it('portrait only: a landscape box (an iPhone hides its bar) and a square keep their top', () => {
    expect(belowStatusBand(r(0, 0, 874, 402), { statusBand: 62 })).toEqual(r(0, 0, 874, 402));
    expect(belowStatusBand(r(0, 0, 400, 400), { statusBand: 62 })).toEqual(r(0, 0, 400, 400));
  });

  it("`shape` says portrait for a box cut from the screen (the screen above a keyboard): the screen's shape, not the cut's", () => {
    const aboveKeyboard = r(0, 0, 402, 300);
    expect(belowStatusBand(aboveKeyboard, { statusBand: 62 }, SCREEN)).toEqual(r(0, 62, 402, 238));
    expect(belowStatusBand(aboveKeyboard, { statusBand: 62 })).toEqual(aboveKeyboard);
    expect(belowStatusBand(SCREEN, { statusBand: 62 }, r(0, 0, 874, 402))).toEqual(SCREEN);
  });

  it('a box starting below the band keeps it all; one inside the band is left with no height', () => {
    expect(belowStatusBand(r(0, 100, 402, 200), { statusBand: 62 }, SCREEN)).toEqual(r(0, 100, 402, 200));
    expect(belowStatusBand(r(0, 0, 402, 50), { statusBand: 62 }, SCREEN)).toEqual(r(0, 62, 402, 0));
    expect(belowStatusBand(r(0, 40, 402, 100), { statusBand: 62 }, SCREEN)).toEqual(r(0, 62, 402, 78));
  });
});

describe("aboveNavigationBand — a portrait box less the navigation band at its bottom (the band's top line)", () => {
  const SCREEN = r(0, 0, 1080, 2400);

  it('the band off a portrait screen; the box itself with no band, or no screen', () => {
    expect(aboveNavigationBand(SCREEN, { navigationBand: 2274 })).toEqual(r(0, 0, 1080, 2274));
    expect(aboveNavigationBand(SCREEN, {})).toEqual(SCREEN);
    expect(aboveNavigationBand(SCREEN, undefined)).toEqual(SCREEN);
  });

  it('portrait only: a landscape box keeps its bottom (Android moves the bar to a side), a square too', () => {
    expect(aboveNavigationBand(r(0, 0, 2400, 1080), { navigationBand: 900 })).toEqual(r(0, 0, 2400, 1080));
    expect(aboveNavigationBand(r(0, 0, 1080, 1080), { navigationBand: 900 })).toEqual(r(0, 0, 1080, 1080));
  });

  it('a reading at or above the box\'s top is no band (fails open): the box itself', () => {
    const lower = r(0, 2300, 1080, 100);
    expect(aboveNavigationBand(lower, { navigationBand: 2274 }, SCREEN)).toEqual(lower);
    expect(aboveNavigationBand(lower, { navigationBand: 2300 }, SCREEN)).toEqual(lower);
    expect(aboveNavigationBand(lower, { navigationBand: 2301 }, SCREEN)).toEqual(r(0, 2300, 1080, 1));
  });

  it('a box starting lower loses only what lies under the band; one ending above it keeps all; `shape` says portrait for a cut', () => {
    expect(aboveNavigationBand(r(0, 100, 1080, 2300), { navigationBand: 2274 })).toEqual(r(0, 100, 1080, 2174));
    expect(aboveNavigationBand(r(0, 0, 1080, 2000), { navigationBand: 2274 })).toEqual(r(0, 0, 1080, 2000));
    expect(aboveNavigationBand(r(0, 1500, 1080, 900), { navigationBand: 2274 }, SCREEN)).toEqual(r(0, 1500, 1080, 774));
    expect(aboveNavigationBand(r(0, 1500, 1080, 900), { navigationBand: 2274 })).toEqual(r(0, 1500, 1080, 900));
  });
});

describe('overlapsPastSlack — two rects sharing area thicker than PIXEL_OVERLAP_SLACK on its thin side', () => {
  it('3 units thick hides; 2 does not (a neighbour laid flush shares an edge\'s antialiasing); none shared, none', () => {
    const el = r(0, 100, 400, 60);
    expect(overlapsPastSlack(el, r(0, 157, 400, 60))).toBe(true);
    expect(overlapsPastSlack(el, r(0, 158, 400, 60))).toBe(false);
    expect(overlapsPastSlack(el, r(397, 0, 100, 400))).toBe(true);
    expect(overlapsPastSlack(el, r(398, 0, 100, 400))).toBe(false);
    expect(overlapsPastSlack(el, r(0, 300, 400, 60))).toBe(false);
  });
});

describe('drawnPart, isUntold, toldFrame — what of a rect its drawn frame holds', () => {
  const rect = r(24, 700, 354, 120);
  const told = (frame: Rect | undefined) => ({ told: true as const, frame, scrollers: [], listedWhereItLies: false });

  it('the rect itself when nothing cuts it, or when the tree cannot tell; the part inside a told frame; undefined when nothing of it is drawn', () => {
    expect(drawnPart(rect, undefined)).toEqual(rect);
    expect(drawnPart(rect, { told: false })).toEqual(rect);
    expect(drawnPart(rect, told(r(0, 0, 402, 780)))).toEqual(r(24, 700, 354, 80));
    expect(drawnPart(rect, told(undefined))).toBeUndefined();
    expect(drawnPart(rect, told(r(0, 900, 402, 100)))).toBeUndefined();
  });

  it('untold only for the tree that cannot tell; a told frame only where one is told', () => {
    expect(isUntold({ told: false })).toBe(true);
    expect(isUntold(undefined)).toBe(false);
    expect(isUntold(told(undefined))).toBe(false);
    expect(toldFrame(told(r(0, 0, 402, 780)))).toEqual(told(r(0, 0, 402, 780)));
    expect(toldFrame({ told: false })).toBeUndefined();
    expect(toldFrame(undefined)).toBeUndefined();
  });
});

describe('cutAtScreenEdges, distanceInside — sides a source cut at the screen, and how far a side lies inside another', () => {
  const SCREEN = r(0, 0, 1080, 2220);

  it('distanceInside: positive inside, 0 on the side, negative past it — each side toward the middle', () => {
    const outer = r(100, 200, 800, 1000);
    const inner = r(110, 230, 700, 900);
    expect(distanceInside(inner, outer, 'top')).toBe(30);
    expect(distanceInside(inner, outer, 'bottom')).toBe(70);
    expect(distanceInside(inner, outer, 'left')).toBe(10);
    expect(distanceInside(inner, outer, 'right')).toBe(90);
    expect(distanceInside(r(90, 190, 820, 1020), outer, 'top')).toBe(-10);
    expect(distanceInside(r(90, 190, 820, 1020), outer, 'bottom')).toBe(-10);
    expect(distanceInside(r(90, 190, 820, 1020), outer, 'left')).toBe(-10);
    expect(distanceInside(r(90, 190, 820, 1020), outer, 'right')).toBe(-10);
  });

  it("the lab's carousel card dumped `[586,380][1080,614]` in its carousel `[66,380][1014,614]`: right; at each side alike; none where the frame meets the screen too", () => {
    const carousel = r(66, 380, 948, 234);
    expect(cutAtScreenEdges(r(586, 380, 494, 234), carousel, SCREEN)).toEqual(['right']);
    expect(cutAtScreenEdges(r(0, 380, 500, 234), carousel, SCREEN)).toEqual(['left']);
    expect(cutAtScreenEdges(r(1, 380, 500, 234), carousel, SCREEN)).toEqual(['left']);
    expect(cutAtScreenEdges(r(2, 380, 500, 234), carousel, SCREEN)).toEqual([]);
    const column = r(100, 300, 800, 1600);
    expect(cutAtScreenEdges(r(200, 0, 300, 400), column, SCREEN)).toEqual(['top']);
    expect(cutAtScreenEdges(r(200, 1900, 300, 320), column, SCREEN)).toEqual(['bottom']);
    expect(cutAtScreenEdges(r(0, 700, 1080, 176), r(0, 0, 1080, 2220), SCREEN)).toEqual([]);
    // A frame a pixel inside the screen is the screen's edge: the cut may be the frame's.
    expect(cutAtScreenEdges(r(586, 380, 494, 234), r(66, 380, 1013, 234), SCREEN)).toEqual([]);
  });
});

describe('collectRects — {id → rect} for the first occurrence of each identifier, pre-order', () => {
  it('the first of a repeated id wins, a parent before its child; nodes with no id, or an empty one, are left out', () => {
    const tree = node({
      identifier: 'root',
      rect: r(0, 0, 402, 874),
      children: [
        node({ identifier: 'row', rect: r(0, 100, 402, 44), children: [node({ identifier: 'row', rect: r(0, 100, 50, 44) })] }),
        node({ identifier: 'row', rect: r(0, 200, 402, 44) }),
        node({ identifier: '', rect: r(0, 300, 402, 44) }),
        node({ identifier: null, rect: r(0, 400, 402, 44), children: [node({ identifier: 'deep', rect: r(10, 410, 20, 20) })] }),
      ],
    });
    expect(collectRects(tree)).toEqual(new Map([['root', r(0, 0, 402, 874)], ['row', r(0, 100, 402, 44)], ['deep', r(10, 410, 20, 20)]]));
  });
});

describe('screenOf — the root\'s rect, or the tree\'s largest when the root has none', () => {
  it("the root's rect when it has area; else the largest by area (idb's synthetic 0x0 root); the empty root when nothing has area", () => {
    expect(screenOf(at(r(0, 0, 402, 874), at(r(0, 0, 804, 874))))).toEqual(r(0, 0, 402, 874));
    expect(screenOf(rectless(at(r(0, 0, 402, 100)), at(r(0, 0, 402, 874), at(r(0, 0, 400, 2000))), at(r(0, 0, 100, 100))))).toEqual(r(0, 0, 400, 2000));
    expect(screenOf(rectless(at(r(0, 0, 402, 874)), at(r(10, 10, 402, 874))))).toEqual(r(0, 0, 402, 874));
    expect(screenOf(at(r(0, 0, 402, 0), at(r(0, 0, 402, 874))))).toEqual(r(0, 0, 402, 874));
    expect(screenOf(rectless())).toEqual(r(0, 0, 0, 0));
  });
});

describe('the rect spellings a sentence quotes (rectText, frameText, nodeText, coverText, outsideScrollViewText)', () => {
  const button = { role: 'button', label: 'Continue to summary', identifier: 'continue', rect: r(24, 780, 354, 44) };

  it('rectText `x,y wxh` for a node; frameText `[x,y][x2,y2]` for the keyboard, as dumpsys prints it', () => {
    expect(rectText(r(24, 780, 354, 44))).toBe('24,780 354x44');
    expect(frameText(r(0, 1269, 1080, 951))).toBe('[0,1269][1080,2220]');
  });

  it('nodeText: the role, the label quoted — else the id — and the rect', () => {
    expect(nodeText(button)).toBe('button "Continue to summary" (24,780 354x44)');
    expect(nodeText({ ...button, label: null })).toBe('button id:continue (24,780 354x44)');
    expect(nodeText({ ...button, label: '' })).toBe('button id:continue (24,780 354x44)');
    expect(nodeText({ ...button, label: null, identifier: null })).toBe('button (24,780 354x44)');
  });

  it('coverText: the node alone when it presses its own rect; with where it reaches when that is not its rect', () => {
    const alert = { role: 'container', label: 'Exit confirmation', identifier: null, rect: r(41, 365, 320, 172) };
    expect(coverText(alert)).toBe('container "Exit confirmation" (41,365 320x172)');
    expect(coverText(alert, r(41, 365, 320, 172))).toBe('container "Exit confirmation" (41,365 320x172)');
    expect(coverText(alert, r(0, 0, 402, 874))).toBe('container "Exit confirmation" (41,365 320x172, reaching 0,0 402x874)');
  });

  it('outsideScrollViewText: outside by default, or past one edge', () => {
    const form = { role: 'scrollable', label: null, identifier: 'form', rect: r(0, 0, 402, 780) };
    expect(outsideScrollViewText(form)).toBe('outside its scroll view scrollable id:form (0,0 402x780)');
    expect(outsideScrollViewText(form, 'below')).toBe('below its scroll view scrollable id:form (0,0 402x780)');
  });

  it('quoted keeps the role, label, id and a copy of the rect — never the subtree', () => {
    const full = node({ ...button, children: [node({})] });
    const q = quoted(full);
    expect(q).toEqual(button);
    expect(q.rect).not.toBe(full.rect);
  });

  it("flatListBarLine: a fifth of the screen down from its top", () => {
    expect(flatListBarLine(r(0, 0, 402, 874))).toBeCloseTo(174.8, 10);
    expect(flatListBarLine(r(0, 100, 402, 1000))).toBe(300);
  });
});

describe('inferScreenSize — the inset window: screen-shaped in the window\'s position, not at the origin (ScreenSize.insetWindow)', () => {
  it("uiautomator's root laid beside a left nav bar (126,0 2274x1080): the walk answers, unreliable, and the root is offered as the inset window", () => {
    const tree = at(r(126, 0, 2274, 1080), at(r(126, 0, 2274, 200)), at(r(200, 300, 1000, 400)));
    expect(inferScreenSize(tree)).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: r(126, 0, 2274, 1080) });
  });

  it("a root with area that is no window is never passed over for a child, even a screen-shaped one at the origin", () => {
    const tree = at(r(126, 0, 2274, 1080), at(r(0, 0, 402, 874)));
    expect(inferScreenSize(tree)).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: r(126, 0, 2274, 1080) });
  });

  it('an inset root shaped like a bar is no window: nothing offered', () => {
    expect(inferScreenSize(at(r(126, 0, 2274, 100)))).toEqual({ width: 2400, height: 100, reliable: false, trustworthyHeight: false });
  });

  it('half a root rect is no rect: the children are asked', () => {
    expect(inferScreenSize(at(r(126, 0, 2274, 0), at(r(126, 63, 2274, 1017)))).insetWindow).toEqual(r(126, 63, 2274, 1017));
    expect(inferScreenSize(at(r(0, 0, 0, 1080), at(r(126, 63, 2274, 1017)))).insetWindow).toEqual(r(126, 63, 2274, 1017));
  });

  it('a rect-less multi-window dump: the app window below the status bar and beside the nav bar (126,63 2274x1017) is offered; the bar, origin-anchored and bar-shaped, is no window', () => {
    const app = at(r(126, 63, 2274, 1017));
    const bar = at(r(0, 0, 2400, 63));
    expect(inferScreenSize(rectless(app, bar))).toEqual({ width: 2400, height: 1080, reliable: false, trustworthyHeight: false, insetWindow: r(126, 63, 2274, 1017) });
  });

  it('among the candidates the widest wins, ties broken on height — whichever comes first', () => {
    const narrow = at(r(126, 0, 1000, 1000));
    const wide = at(r(126, 0, 1100, 800));
    expect(inferScreenSize(rectless(narrow, wide)).insetWindow).toEqual(r(126, 0, 1100, 800));
    expect(inferScreenSize(rectless(wide, narrow)).insetWindow).toEqual(r(126, 0, 1100, 800));
    const short = at(r(126, 0, 1000, 900));
    const tall = at(r(126, 0, 1000, 1000));
    expect(inferScreenSize(rectless(short, tall)).insetWindow).toEqual(r(126, 0, 1000, 1000));
    expect(inferScreenSize(rectless(tall, short)).insetWindow).toEqual(r(126, 0, 1000, 1000));
  });

  it('a candidate must have area, lie on layout and be screen-shaped', () => {
    expect(inferScreenSize(rectless(at(r(126, 0, 1000, 0)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(r(126, 0, 0, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(r(126, -5, 1000, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(r(-5, 10, 1000, 1000)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(r(126, 0, 0, 0)))).insetWindow).toBeUndefined();
    // MAX_SCREEN_ASPECT, 3:1, inclusive: flatter is a bar.
    expect(inferScreenSize(rectless(at(r(126, 0, 1002, 334)))).insetWindow).toEqual(r(126, 0, 1002, 334));
    expect(inferScreenSize(rectless(at(r(126, 0, 1003, 334)))).insetWindow).toBeUndefined();
  });

  it('a candidate the layout inside it contradicts — content starting in it and reaching 10 % past its right — is not offered; content peeking, or parked past its right, is no contradiction', () => {
    const window = r(126, 0, 1000, 1000);
    // 1226 is 10 % past: the limit, not past it.
    expect(inferScreenSize(rectless(at(window), at(r(200, 100, 1026, 100)))).insetWindow).toEqual(window);
    expect(inferScreenSize(rectless(at(window), at(r(200, 100, 1027, 100)))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(window, at(r(1125, 100, 500, 100))))).insetWindow).toBeUndefined();
    expect(inferScreenSize(rectless(at(window), at(r(1126, 100, 1000, 100)))).insetWindow).toEqual(window);
    // Content off layout (a scrim at a negative origin) contradicts nothing.
    expect(inferScreenSize(rectless(at(window), at(r(200, -5, 2000, 100)))).insetWindow).toEqual(window);
  });
});

describe('inferScreenSize — the edges of the walk and of the window test', () => {
  it('a root of no height is no window, though it lies at the origin with a width: its child is', () => {
    expect(inferScreenSize(at(r(0, 0, 402, 0), at(r(0, 0, 402, 874))))).toEqual({ width: 402, height: 874, reliable: true, trustworthyHeight: true, windowLeg: 'child' });
  });

  it('a guessed window\'s layout may peek up to 10 % past its right edge; past that it contradicts the window', () => {
    const child = r(0, 0, 300, 400);
    expect(inferScreenSize(rectless(at(child), at(r(200, 100, 130, 50))))).toMatchObject({ width: 300, reliable: true });
    expect(inferScreenSize(rectless(at(child), at(r(200, 100, 131, 50))))).toMatchObject({ width: 300, reliable: false });
  });

  it('a walked bar is corroborated by a screen-shaped rect reaching within 10 % of it; one reaching less leaves the width unreliable', () => {
    expect(inferScreenSize(rectless(at(r(10, 0, 990, 1000)), at(r(0, 0, 1100, 100))))).toMatchObject({ width: 1100, reliable: true });
    expect(inferScreenSize(rectless(at(r(10, 0, 990, 1000)), at(r(0, 0, 1101, 100))))).toMatchObject({ width: 1101, reliable: false });
  });

  it('a rect a unit above or left of the origin is off layout (a scrim), not part of the walk', () => {
    expect(inferScreenSize(rectless(at(r(16, 0, 370, 800)), at(r(-1, 0, 2000, 100)))).width).toBe(386);
    expect(inferScreenSize(rectless(at(r(16, 0, 370, 800)), at(r(0, -1, 2000, 100)))).width).toBe(386);
  });

  it('a root within ORIGIN_SLACK of the origin is the window; one a unit off is not', () => {
    expect(inferScreenSize(at(r(0.5, 0.5, 402, 874)))).toMatchObject({ windowLeg: 'root', reliable: true });
    expect(inferScreenSize(at(r(1, 0, 402, 874))).windowLeg).toBeUndefined();
    expect(inferScreenSize(at(r(0, 1, 402, 874))).windowLeg).toBeUndefined();
  });

  it("the walk's width is reliable only from a rect at the origin: a unit inset is a content width", () => {
    expect(inferScreenSize(rectless(at(r(1, 0, 370, 1200))))).toMatchObject({ width: 371, reliable: false });
    expect(inferScreenSize(rectless(at(r(0.5, 0, 370, 1200))))).toMatchObject({ width: 370.5, reliable: true });
  });

  it('the widest is the FIRST to reach furthest: an inset window before the bar that reaches as far keeps the width unreliable', () => {
    // A bar first: the origin-anchored maximum, corroborated by the screen-shaped window reaching as far.
    expect(inferScreenSize(rectless(at(r(0, 0, 2400, 63)), at(r(126, 63, 2274, 1017)))).reliable).toBe(true);
    expect(inferScreenSize(rectless(at(r(126, 63, 2274, 1017)), at(r(0, 0, 2400, 63)))).reliable).toBe(false);
  });

  it("the walked height is the lowest bottom edge, whichever rect comes first; a scrim above the screen's top is no layout", () => {
    expect(inferScreenSize(rectless(at(r(16, 100, 370, 800)), at(r(16, 0, 370, 850)))).height).toBe(900);
    expect(inferScreenSize(rectless(at(r(16, 0, 370, 800)), at(r(0, -5, 804, 900))))).toMatchObject({ width: 386, height: 800 });
  });

  it('a child window: the widest wins, ties broken on height, whichever comes first', () => {
    const short = at(r(0, 0, 402, 800));
    const tall = at(r(0, 0, 402, 874));
    expect(inferScreenSize(rectless(short, tall))).toMatchObject({ width: 402, height: 874, windowLeg: 'child' });
    expect(inferScreenSize(rectless(tall, short))).toMatchObject({ width: 402, height: 874, windowLeg: 'child' });
  });
});
