import { describe, expect, it } from 'vitest';
import type { DeviceScreen, Rect, UiNode } from '../../src/adapters/types.js';
import {
  aboveNavigationBand,
  belowStatusBand,
  clearOfSystemBands,
  clippedEdges,
  collectRects,
  cutAtScreenEdges,
  distanceInside,
  drawnPart,
  isUntold,
  overlapsPastSlack,
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
 * and the drawn-frame and screen-edge arithmetic. Each was reached before only through its callers (ui-tree/standing.ts,
 * ui-tree/usable-screen.ts, interact/scroll-text.ts). `inferScreenSize` and `screenOf` are geometry-screen-size.test.ts's,
 * the rect spellings geometry-text.test.ts's.
 */

const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

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

  it('a walked height never votes: a reliable width alone decides (an 852-wide walk on 393x852 is turned)', () => {
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

  it("windows beside system bars: an unreliable tree's inset window witnesses by its reach", () => {
    expect(windowTurnsScreen(inset(rect(126, 0, 2274, 1080)), PIXEL)).toBe(true);
    expect(windowTurnsScreen(inset(rect(126, 63, 2274, 1017)), PIXEL)).toBe(true);
    // Its reach, not its size: the same window laid at 300 reaches past the turned panel.
    expect(windowTurnsScreen(inset(rect(300, 0, 2274, 1080)), PIXEL)).toBe(false);
    expect(windowTurnsScreen(inset(rect(126, 200, 2274, 1017)), PIXEL)).toBe(false);
    // A portrait inset window fits the panel as built: not turned.
    expect(windowTurnsScreen(inset(rect(0, 63, 1080, 2337), 1080, 2400), PIXEL)).toBe(false);
  });

  it('an inset rect witnesses nothing where windows never sit beside bars (an iOS tree: it is content), nor does an unreliable tree with none', () => {
    expect(windowTurnsScreen(inset(rect(126, 0, 2274, 1080)), { width: 1080, height: 2400 })).toBe(false);
    expect(windowTurnsScreen(inset(rect(126, 0, 2274, 1080)), { width: 1080, height: 2400, windowsBesideSystemBars: false })).toBe(false);
    expect(windowTurnsScreen(inset(undefined), PIXEL)).toBe(false);
  });

  it('a reliable tree of no usable size falls to the inset window; a panel of no usable size turns nothing', () => {
    const empty: ScreenSize = { width: 0, height: 0, reliable: true, trustworthyHeight: false, insetWindow: rect(126, 0, 2274, 1080) };
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
    expect(clippedEdges(rect(0, 0, 400, 800), vp)).toEqual([]);
    expect(clippedEdges(rect(10, 10, 100, 100), vp)).toEqual([]);
    expect(clippedEdges(rect(0, -1, 100, 100), vp)).toEqual(['top']);
    expect(clippedEdges(rect(0, 701, 100, 100), vp)).toEqual(['bottom']);
    expect(clippedEdges(rect(-1, 0, 100, 100), vp)).toEqual(['left']);
    expect(clippedEdges(rect(301, 0, 100, 100), vp)).toEqual(['right']);
    expect(clippedEdges(rect(-10, -10, 420, 820), vp)).toEqual(['top', 'bottom', 'left', 'right']);
  });

  it('a viewport that starts lower or further right (the screen below the status band, a window beside a nav bar): its own edges', () => {
    const below = { y: 62, width: 402, height: 812 };
    expect(clippedEdges(rect(0, 62, 402, 812), below)).toEqual([]);
    expect(clippedEdges(rect(0, 40, 100, 50), below)).toEqual(['top']);
    expect(clippedEdges(rect(0, 825, 100, 50), below)).toEqual(['bottom']);
    const beside = { x: 126, width: 2274, height: 1080 };
    expect(clippedEdges(rect(126, 0, 2274, 1080), beside)).toEqual([]);
    expect(clippedEdges(rect(125, 0, 100, 100), beside)).toEqual(['left']);
    expect(clippedEdges(rect(2301, 0, 100, 100), beside)).toEqual(['right']);
  });
});

describe('wholePast — the side of the viewport a rect lies wholly past, below before above', () => {
  const vp = rect(0, 62, 402, 718);

  it('each side, a rect starting on the far edge included; none for a rect sharing any of the viewport', () => {
    expect(wholePast(rect(24, 780, 354, 44), vp)).toBe('bottom');
    expect(wholePast(rect(24, 18, 354, 44), vp)).toBe('top');
    expect(wholePast(rect(402, 100, 100, 44), vp)).toBe('right');
    expect(wholePast(rect(-100, 100, 100, 44), vp)).toBe('left');
    expect(wholePast(rect(24, 779, 354, 44), vp)).toBeUndefined();
    expect(wholePast(rect(24, 19, 354, 44), vp)).toBeUndefined();
    expect(wholePast(rect(401, 100, 100, 44), vp)).toBeUndefined();
    expect(wholePast(rect(-99, 100, 100, 44), vp)).toBeUndefined();
    expect(wholePast(rect(0, 62, 402, 718), vp)).toBeUndefined();
  });

  it('below before above, and either before a side: as a scroll down finds it', () => {
    expect(wholePast(rect(500, 900, 100, 44), vp)).toBe('bottom');
    expect(wholePast(rect(-200, 900, 100, 44), vp)).toBe('bottom');
    expect(wholePast(rect(500, 0, 100, 44), vp)).toBe('top');
    expect(wholePast(rect(-200, 0, 100, 44), vp)).toBe('top');
  });

  it('a viewport offset on x: its own sides', () => {
    const beside = rect(126, 0, 2274, 1080);
    expect(wholePast(rect(2400, 100, 50, 50), beside)).toBe('right');
    expect(wholePast(rect(76, 100, 50, 50), beside)).toBe('left');
    expect(wholePast(rect(77, 100, 50, 50), beside)).toBeUndefined();
  });

  it("a rect of no area lies past none — the SWIFT form's placeholder texts read at 0,0 0x0, above the viewport's top by its edge alone", () => {
    expect(wholePast(rect(0, 0, 0, 0), vp)).toBeUndefined();
    expect(wholePast(rect(24, 900, 354, 0), vp)).toBeUndefined();
    expect(wholePast(rect(500, 100, 0, 44), vp)).toBeUndefined();
  });
});

describe('visibleFractionInViewport — how much of a rect a box holds, as a fraction of its own area', () => {
  const vp = { width: 400, height: 800 };

  it('whole inside: 1; partly: the share inside; wholly outside or only touching: 0', () => {
    expect(visibleFractionInViewport(rect(10, 10, 100, 100), vp)).toBe(1);
    expect(visibleFractionInViewport(rect(0, 750, 100, 100), vp)).toBe(0.5);
    expect(visibleFractionInViewport(rect(350, 0, 100, 100), vp)).toBe(0.5);
    expect(visibleFractionInViewport(rect(-100, -100, 600, 1000), vp)).toBeCloseTo(320000 / 600000, 10);
    expect(visibleFractionInViewport(rect(0, 800, 100, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(rect(500, 0, 100, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(rect(0, 900, 100, 100), vp)).toBe(0);
    // Wholly past on both axes: nothing of it inside.
    expect(visibleFractionInViewport(rect(500, 900, 100, 100), vp)).toBe(0);
  });

  it('a rect of no area shows nothing, though it lies inside', () => {
    expect(visibleFractionInViewport(rect(10, 10, 0, 100), vp)).toBe(0);
    expect(visibleFractionInViewport(rect(10, 10, 100, 0), vp)).toBe(0);
  });

  it('a box that starts lower or further right is measured from its own origin (the screen below the status band)', () => {
    expect(visibleFractionInViewport(rect(0, 12, 100, 100), { y: 62, width: 402, height: 812 })).toBe(0.5);
    expect(visibleFractionInViewport(rect(0, 824, 100, 100), { y: 62, width: 402, height: 812 })).toBe(0.5);
    expect(visibleFractionInViewport(rect(50, 0, 100, 100), { x: 100, width: 300, height: 800 })).toBe(0.5);
    expect(visibleFractionInViewport(rect(350, 0, 100, 100), { x: 100, width: 300, height: 800 })).toBe(0.5);
  });
});

describe('clearOfSystemBands — a portrait box less both system bands (D59b code review: the one helper)', () => {
  it('the status band off its top and the navigation band off its bottom, each as its own helper cuts it; a landscape box keeps both', () => {
    const box: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
    expect(clearOfSystemBands(box, { statusBand: 66, navigationBand: 2088 })).toEqual({ x: 0, y: 66, width: 1080, height: 2022 });
    expect(clearOfSystemBands(box, { statusBand: 66 })).toEqual({ x: 0, y: 66, width: 1080, height: 2154 });
    expect(clearOfSystemBands(box, { navigationBand: 2088 })).toEqual({ x: 0, y: 0, width: 1080, height: 2088 });
    expect(clearOfSystemBands(box, undefined)).toEqual(box);
    const wide: Rect = { x: 0, y: 0, width: 2220, height: 1080 };
    expect(clearOfSystemBands(wide, { statusBand: 66, navigationBand: 1000 })).toEqual(wide);
    // `shape` says portrait for a box cut from the screen (above a keyboard), as for each band's own helper.
    expect(clearOfSystemBands({ x: 0, y: 0, width: 1080, height: 900 }, { statusBand: 66, navigationBand: 850 }, box)).toEqual({ x: 0, y: 66, width: 1080, height: 784 });
  });
});

describe('belowStatusBand — a portrait box less the status band at its top', () => {
  const SCREEN = rect(0, 0, 402, 874);

  it("the iPhone's 62-pt band off a portrait screen; the box itself with no band, a band of 0, or no screen", () => {
    expect(belowStatusBand(SCREEN, { statusBand: 62 })).toEqual(rect(0, 62, 402, 812));
    expect(belowStatusBand(SCREEN, {})).toEqual(SCREEN);
    expect(belowStatusBand(SCREEN, { statusBand: 0 })).toEqual(SCREEN);
    expect(belowStatusBand(SCREEN, undefined)).toEqual(SCREEN);
  });

  it('portrait only: a landscape box (an iPhone hides its bar) and a square keep their top', () => {
    expect(belowStatusBand(rect(0, 0, 874, 402), { statusBand: 62 })).toEqual(rect(0, 0, 874, 402));
    expect(belowStatusBand(rect(0, 0, 400, 400), { statusBand: 62 })).toEqual(rect(0, 0, 400, 400));
  });

  it("`shape` says portrait for a box cut from the screen (the screen above a keyboard): the screen's shape, not the cut's", () => {
    const aboveKeyboard = rect(0, 0, 402, 300);
    expect(belowStatusBand(aboveKeyboard, { statusBand: 62 }, SCREEN)).toEqual(rect(0, 62, 402, 238));
    expect(belowStatusBand(aboveKeyboard, { statusBand: 62 })).toEqual(aboveKeyboard);
    expect(belowStatusBand(SCREEN, { statusBand: 62 }, rect(0, 0, 874, 402))).toEqual(SCREEN);
  });

  it('a box starting below the band keeps it all; one inside the band is left with no height', () => {
    expect(belowStatusBand(rect(0, 100, 402, 200), { statusBand: 62 }, SCREEN)).toEqual(rect(0, 100, 402, 200));
    expect(belowStatusBand(rect(0, 0, 402, 50), { statusBand: 62 }, SCREEN)).toEqual(rect(0, 62, 402, 0));
    expect(belowStatusBand(rect(0, 40, 402, 100), { statusBand: 62 }, SCREEN)).toEqual(rect(0, 62, 402, 78));
  });
});

describe("aboveNavigationBand — a portrait box less the navigation band at its bottom (the band's top line)", () => {
  const SCREEN = rect(0, 0, 1080, 2400);

  it('the band off a portrait screen; the box itself with no band, or no screen', () => {
    expect(aboveNavigationBand(SCREEN, { navigationBand: 2274 })).toEqual(rect(0, 0, 1080, 2274));
    expect(aboveNavigationBand(SCREEN, {})).toEqual(SCREEN);
    expect(aboveNavigationBand(SCREEN, undefined)).toEqual(SCREEN);
  });

  it('portrait only: a landscape box keeps its bottom (Android moves the bar to a side), a square too', () => {
    expect(aboveNavigationBand(rect(0, 0, 2400, 1080), { navigationBand: 900 })).toEqual(rect(0, 0, 2400, 1080));
    expect(aboveNavigationBand(rect(0, 0, 1080, 1080), { navigationBand: 900 })).toEqual(rect(0, 0, 1080, 1080));
  });

  it('a reading at or above the box\'s top is no band (fails open): the box itself', () => {
    const lower = rect(0, 2300, 1080, 100);
    expect(aboveNavigationBand(lower, { navigationBand: 2274 }, SCREEN)).toEqual(lower);
    expect(aboveNavigationBand(lower, { navigationBand: 2300 }, SCREEN)).toEqual(lower);
    expect(aboveNavigationBand(lower, { navigationBand: 2301 }, SCREEN)).toEqual(rect(0, 2300, 1080, 1));
  });

  it('a box starting lower loses only what lies under the band; one ending above it keeps all; `shape` says portrait for a cut', () => {
    expect(aboveNavigationBand(rect(0, 100, 1080, 2300), { navigationBand: 2274 })).toEqual(rect(0, 100, 1080, 2174));
    expect(aboveNavigationBand(rect(0, 0, 1080, 2000), { navigationBand: 2274 })).toEqual(rect(0, 0, 1080, 2000));
    expect(aboveNavigationBand(rect(0, 1500, 1080, 900), { navigationBand: 2274 }, SCREEN)).toEqual(rect(0, 1500, 1080, 774));
    expect(aboveNavigationBand(rect(0, 1500, 1080, 900), { navigationBand: 2274 })).toEqual(rect(0, 1500, 1080, 900));
  });
});

describe('overlapsPastSlack — two rects sharing area thicker than PIXEL_OVERLAP_SLACK on its thin side', () => {
  it('3 units thick hides; 2 does not (a neighbour laid flush shares an edge\'s antialiasing); none shared, none', () => {
    const el = rect(0, 100, 400, 60);
    expect(overlapsPastSlack(el, rect(0, 157, 400, 60))).toBe(true);
    expect(overlapsPastSlack(el, rect(0, 158, 400, 60))).toBe(false);
    expect(overlapsPastSlack(el, rect(397, 0, 100, 400))).toBe(true);
    expect(overlapsPastSlack(el, rect(398, 0, 100, 400))).toBe(false);
    expect(overlapsPastSlack(el, rect(0, 300, 400, 60))).toBe(false);
  });
});

describe('drawnPart, isUntold, toldFrame — what of a rect its drawn frame holds', () => {
  const row = rect(24, 700, 354, 120);
  const told = (frame: Rect | undefined) => ({ told: true as const, frame, scrollers: [], listedWhereItLies: false });

  it('the rect itself when nothing cuts it, or when the tree cannot tell; the part inside a told frame; undefined when nothing of it is drawn', () => {
    expect(drawnPart(row, undefined)).toEqual(row);
    expect(drawnPart(row, { told: false })).toEqual(row);
    expect(drawnPart(row, told(rect(0, 0, 402, 780)))).toEqual(rect(24, 700, 354, 80));
    expect(drawnPart(row, told(undefined))).toBeUndefined();
    expect(drawnPart(row, told(rect(0, 900, 402, 100)))).toBeUndefined();
  });

  it('untold only for the tree that cannot tell; a told frame only where one is told', () => {
    expect(isUntold({ told: false })).toBe(true);
    expect(isUntold(undefined)).toBe(false);
    expect(isUntold(told(undefined))).toBe(false);
    expect(toldFrame(told(rect(0, 0, 402, 780)))).toEqual(told(rect(0, 0, 402, 780)));
    expect(toldFrame({ told: false })).toBeUndefined();
    expect(toldFrame(undefined)).toBeUndefined();
  });
});

describe('cutAtScreenEdges, distanceInside — sides a source cut at the screen, and how far a side lies inside another', () => {
  const SCREEN = rect(0, 0, 1080, 2220);

  it('distanceInside: positive inside, 0 on the side, negative past it — each side toward the middle', () => {
    const outer = rect(100, 200, 800, 1000);
    const inner = rect(110, 230, 700, 900);
    expect(distanceInside(inner, outer, 'top')).toBe(30);
    expect(distanceInside(inner, outer, 'bottom')).toBe(70);
    expect(distanceInside(inner, outer, 'left')).toBe(10);
    expect(distanceInside(inner, outer, 'right')).toBe(90);
    expect(distanceInside(rect(90, 190, 820, 1020), outer, 'top')).toBe(-10);
    expect(distanceInside(rect(90, 190, 820, 1020), outer, 'bottom')).toBe(-10);
    expect(distanceInside(rect(90, 190, 820, 1020), outer, 'left')).toBe(-10);
    expect(distanceInside(rect(90, 190, 820, 1020), outer, 'right')).toBe(-10);
  });

  it("the lab's carousel card dumped `[586,380][1080,614]` in its carousel `[66,380][1014,614]`: right; at each side alike; none where the frame meets the screen too", () => {
    const carousel = rect(66, 380, 948, 234);
    expect(cutAtScreenEdges(rect(586, 380, 494, 234), carousel, SCREEN)).toEqual(['right']);
    expect(cutAtScreenEdges(rect(0, 380, 500, 234), carousel, SCREEN)).toEqual(['left']);
    expect(cutAtScreenEdges(rect(1, 380, 500, 234), carousel, SCREEN)).toEqual(['left']);
    expect(cutAtScreenEdges(rect(2, 380, 500, 234), carousel, SCREEN)).toEqual([]);
    const column = rect(100, 300, 800, 1600);
    expect(cutAtScreenEdges(rect(200, 0, 300, 400), column, SCREEN)).toEqual(['top']);
    expect(cutAtScreenEdges(rect(200, 1900, 300, 320), column, SCREEN)).toEqual(['bottom']);
    expect(cutAtScreenEdges(rect(0, 700, 1080, 176), rect(0, 0, 1080, 2220), SCREEN)).toEqual([]);
    // A frame a pixel inside the screen is the screen's edge: the cut may be the frame's.
    expect(cutAtScreenEdges(rect(586, 380, 494, 234), rect(66, 380, 1013, 234), SCREEN)).toEqual([]);
  });
});

describe('collectRects — {id → rect} for the first occurrence of each identifier, pre-order', () => {
  it('the first of a repeated id wins, a parent before its child; nodes with no id, or an empty one, are left out', () => {
    const tree = node({
      identifier: 'root',
      rect: rect(0, 0, 402, 874),
      children: [
        node({ identifier: 'row', rect: rect(0, 100, 402, 44), children: [node({ identifier: 'row', rect: rect(0, 100, 50, 44) })] }),
        node({ identifier: 'row', rect: rect(0, 200, 402, 44) }),
        node({ identifier: '', rect: rect(0, 300, 402, 44) }),
        node({ identifier: null, rect: rect(0, 400, 402, 44), children: [node({ identifier: 'deep', rect: rect(10, 410, 20, 20) })] }),
      ],
    });
    expect(collectRects(tree)).toEqual(new Map([['root', rect(0, 0, 402, 874)], ['row', rect(0, 100, 402, 44)], ['deep', rect(10, 410, 20, 20)]]));
  });
});
