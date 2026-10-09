import { describe, expect, it, vi } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { dragMs, MIN_DRAG_MS, MIN_STROKE_BOX, strokeBox, strokeRoom, MIN_STROKE_FRACTION, sameStroke, screenBox, scrollStroke, shortenStroke, swipeScreen, swipeVector, swipeVectorAbove, TOUCH_DOWN_CUT_FLOOR, TOUCH_SLOP } from '../../src/interact/swipe.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

// The scroll loop's settle pause is recorded, not waited on.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));

const fresh = () => {
  resetLayout();
  return new FakeAdapter({ s: screen(el({ identifier: 'anything' })) }, 's'); // 1000x2000 root, viewport derived from it
};

/** A fake whose tree is `root` and whose device reports `viewport` (or throws it, as a failed `wm size` would). */
function device(root: UiNode, viewport: DeviceScreen | Error): FakeAdapter {
  const fake = new FakeAdapter({ s: root }, 's');
  if (viewport instanceof Error) {
    fake.viewport = async () => {
      throw viewport;
    };
  } else {
    fake.viewportSize = viewport;
  }
  return fake;
}

describe('swipeScreen — one table, two meanings', () => {
  it("'finger' names the finger's movement: up travels from below centre to above it, 30% either side", async () => {
    const fake = fresh();
    await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
  });

  it("'content' names where the content lies: content below is reached by the finger travelling up", async () => {
    const fake = fresh();
    await swipeScreen(fake, { direction: 'down', meaning: 'content' });
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
  });

  it('the horizontal pair is the same table rotated', async () => {
    const fake = fresh();
    await swipeScreen(fake, { direction: 'left', meaning: 'finger' });
    await swipeScreen(fake, { direction: 'left', meaning: 'content' });
    expect(fake.swipes).toEqual([
      { from: { x: 800, y: 1000 }, to: { x: 200, y: 1000 } },
      { from: { x: 200, y: 1000 }, to: { x: 800, y: 1000 } },
    ]);
  });

  it('repeats the same gesture `times` times from one tree read, and returns the stroke it drew', async () => {
    const fake = fresh();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    const drawn = await swipeScreen(fake, { direction: 'down', meaning: 'finger', times: 3 });
    expect(fake.swipes).toHaveLength(3);
    expect(new Set(fake.swipes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(reads).toBe(1);
    expect(drawn).toEqual({ ...fake.swipes[0] });
  });
});

describe('screenBox — the device screen is the box a gesture swipes in (2026-10-08)', () => {
  it('swipes over the DEVICE size, not the tree root, when the two differ (an Android window short of the nav bar)', async () => {
    // The tree's root is the app window above a nav bar; the device is the panel.
    const fake = device(node({ rect: { x: 0, y: 0, width: 1080, height: 2274 } }), { width: 1080, height: 2400 });
    await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 540, y: 1920 }, to: { x: 540, y: 480 } }]); // the tree's box would be y 1819 → 455
  });

  it('turns the device box when the window fits the screen only sideways (landscape on a panel reported as built)', async () => {
    const fake = device(node({ rect: { x: 0, y: 0, width: 2400, height: 1080 } }), { width: 1080, height: 2400 });
    await swipeScreen(fake, { direction: 'left', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 1920, y: 540 }, to: { x: 480, y: 540 } }]);
  });

  it('does not turn it for a landscape-SHAPED window that fits the screen unturned (a top split-screen pane)', async () => {
    const fake = device(node({ rect: { x: 0, y: 0, width: 1080, height: 1000 } }), { width: 1080, height: 2400 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('a tree that cannot be read loses only the orientation witness: the device box still stands, and the note says so', async () => {
    const fake = device(screen(), { width: 1000, height: 2000 });
    fake.uiTree = async () => {
      throw new Error('uiautomator dump returned no XML');
    };
    const drawn = await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
    expect(drawn.note).toBe(
      'the UI tree could not be read (uiautomator dump returned no XML); swiped over the device screen as built, 1000x2000',
    );
  });

  it('an Android landscape window beside a LEFT nav bar or cutout turns the box too — with and without a status bar above it', async () => {
    // Not origin-anchored, so the tree walks it (reliable: false); its reach,
    // 2400x1080, is the panel turned. The old tree box got this right.
    for (const rect of [
      { x: 126, y: 0, width: 2274, height: 1080 },
      { x: 126, y: 63, width: 2274, height: 1017 },
    ]) {
      const fake = device(node({ rect }), { width: 1080, height: 2400, windowsBesideSystemBars: true });
      await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
      expect(fake.swipes).toEqual([{ from: { x: 1200, y: 864 }, to: { x: 1200, y: 216 } }]);
    }
  });

  it("an inset window whose REACH runs past the turned panel witnesses nothing — its left edge counts", async () => {
    // 2274 wide fits 2400, but starting at 300 it ends at 2574: no window on this panel.
    const fake = device(node({ rect: { x: 300, y: 0, width: 2274, height: 1080 } }), { width: 1080, height: 2400, windowsBesideSystemBars: true });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('an inset rect in an iOS tree is content, never a window: it turns nothing', async () => {
    const fake = device(node({ rect: { x: 126, y: 0, width: 2274, height: 1080 } }), { width: 1080, height: 2400 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('a WALKED height never votes: a landscape tree whose rows run to y=3000 still turns the panel, by its width (orient\'s incident)', async () => {
    // No window rect (a rectless root over rows): the walk answers 852 wide —
    // reliable — and 3000 tall, a content maximum that fits no panel.
    const rows = node({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      children: [node({ rect: { x: 0, y: 100, width: 852, height: 44 } }), node({ rect: { x: 0, y: 2956, width: 852, height: 44 } })],
    });
    const fake = device(rows, { width: 393, height: 852 });
    await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 426, y: 315 }, to: { x: 426, y: 79 } }]); // 852x393, not 393x852's (197,682)→(197,170)
  });

  it('a walked width that fits the panel as built does not turn it (the split-pane guard, by width), nor one that fits it neither way', async () => {
    const rows = node({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      children: [node({ rect: { x: 0, y: 100, width: 393, height: 44 } }), node({ rect: { x: 0, y: 2956, width: 393, height: 44 } })],
    });
    const fake = device(rows, { width: 393, height: 852 });
    expect((await screenBox(fake, { tree: rows })).box).toEqual({ x: 0, y: 0, width: 393, height: 852 });
    // …nor does one too wide for the panel either way: no window on this screen.
    const wide = node({ rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ rect: { x: 0, y: 100, width: 1800, height: 44 } })] });
    expect((await screenBox(device(wide, { width: 393, height: 852 }), { tree: wide })).box).toEqual({ x: 0, y: 0, width: 393, height: 852 });
  });

  it('rounding slack: a landscape window 1% past the turned panel still turns it', async () => {
    const fake = device(node({ rect: { x: 0, y: 0, width: 2424, height: 1091 } }), { width: 1080, height: 2400 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 2400, height: 1080 });
  });

  it('a window too TALL for the turned panel does not turn it (1200x1200 on 1080x2400 fits neither way)', async () => {
    const fake = device(node({ rect: { x: 0, y: 0, width: 1200, height: 1200 } }), { width: 1080, height: 2400 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('an unreadable device size falls back to a reliable tree window, and says so', async () => {
    const fake = device(screen(), new Error('Cannot parse wm size output: garbage'));
    const drawn = await swipeScreen(fake, { direction: 'up', meaning: 'finger' });
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
    expect(drawn.note).toBe(
      "the device screen size could not be read (Cannot parse wm size output: garbage); swiped over the UI tree's window, 1000x2000",
    );
  });

  it('a 0×0 device size falls back too — the WDA sheet: the screen-shaped child window, not the off-layout scrim', async () => {
    // The PopoverDismissRegion parked at {-402,-874} is not layout; a union of
    // the children would read 804x1748 and centre the swipe on the corner.
    const root = node({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      children: [
        node({ rect: { x: 0, y: 0, width: 402, height: 874 } }),
        node({ rect: { x: -402, y: -874, width: 1206, height: 2622 } }),
      ],
    });
    const fake = device(root, { width: 0, height: 0 });
    const drawn = await swipeScreen(fake, { direction: 'up', meaning: 'finger' }); // 402x874 → centre (201,437), dy 262
    expect(fake.swipes).toEqual([{ from: { x: 201, y: 699 }, to: { x: 201, y: 175 } }]);
    expect(drawn.note).toBe("the device reported 0x0; swiped over the UI tree's window, 402x874");
  });

  it('a tree with no geometry and no device size is REFUSED — never a swipe from (0,0) to (0,0)', async () => {
    const fake = device(node({ rect: { x: 0, y: 0, width: 0, height: 0 } }), { width: 0, height: 0 });
    await expect(swipeScreen(fake, { direction: 'up', meaning: 'finger' })).rejects.toThrow(
      'No screen box to swipe in: the device reported 0x0, and the UI tree has no geometry — nothing was swiped.',
    );
    expect(fake.swipes).toEqual([]);
  });

  it("a walked tree is no box: its height is the lowest content edge, not a window's", async () => {
    // A synthetic 0×0 root over two rows and nothing screen-shaped: no
    // window, the walk answers 300x800 — reliable as a width, not as a height.
    const root = node({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      children: [
        node({ rect: { x: 0, y: 100, width: 300, height: 50 } }),
        node({ rect: { x: 0, y: 750, width: 300, height: 50 } }),
      ],
    });
    const fake = device(root, new Error('idb describe returned no screen_dimensions'));
    await expect(swipeScreen(fake, { direction: 'up', meaning: 'finger' })).rejects.toThrow(
      "could not be read (idb describe returned no screen_dimensions), and the UI tree's height 800 is a content extent",
    );
    expect(fake.swipes).toEqual([]);
  });

  it('an unreliable tree is no box either, and neither is an unread one', async () => {
    // Content starting inset: a CONTENT width, not a window.
    const inset = node({ rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ rect: { x: 50, y: 0, width: 300, height: 600 } })] });
    await expect(screenBox(device(inset, { width: 0, height: 0 }), { tree: inset })).rejects.toThrow(
      "the UI tree's 350x600 is not a window it can vouch for",
    );
    await expect(screenBox(device(screen(), new Error('device offline')), { error: new Error('null root node') })).rejects.toThrow(
      'No screen box to swipe in: the device screen size could not be read (device offline), and the UI tree could not be read (null root node) — nothing was swiped.',
    );
  });

  it('an unreliable tree is no orientation witness: a CONTENT extent that would fit the panel sideways does not turn it', async () => {
    const inset = node({ rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ rect: { x: 50, y: 0, width: 2350, height: 1000 } })] });
    const fake = device(inset, { width: 1080, height: 2400 });
    expect((await screenBox(fake, { tree: inset })).box).toEqual({ x: 0, y: 0, width: 1080, height: 2400 });
  });

  it('scroll_until draws the same stroke as a swipe: over the same box, turned the same way (content below = finger up)', async () => {
    const root = node({
      rect: { x: 0, y: 0, width: 2400, height: 1080 },
      children: [node({ identifier: 'far', rect: { x: 0, y: 90_000, width: 100, height: 10 } })],
    });
    const scrolled = device(root, { width: 1080, height: 2400 });
    await expect(scrollUntilVisible(scrolled, 'id:far', { maxSwipes: 1 })).rejects.toThrow(/after 1 swipe \(maxSwipes\)/);
    const swiped = device(root, { width: 1080, height: 2400 });
    await swipeScreen(swiped, { direction: 'up', meaning: 'finger' });
    expect(scrolled.swipes).toEqual([{ from: { x: 1200, y: 864 }, to: { x: 1200, y: 216 } }]);
    expect(swiped.swipes).toEqual([{ from: { x: 1200, y: 864 }, to: { x: 1200, y: 216 } }]);
  });
});

/**
 * 2026-10-08, the iOS device check of
 * docs/bugs/2026-10-08-scroll-until-ignores-android-soft-keyboard.md and
 * review round 1: the stroke drawn over a keyboard is the uncovered box's,
 * its TOUCH-DOWN never inside the keyboard clearance (0.8 of the uncovered
 * height) nor higher than the keyboard-less stroke's touch-down.
 */
describe('swipeVectorAbove — the touch-down placed clear of a keyboard, never higher than without one', () => {
  /** The measured iPhone 17 (402x874 pt) and the WDA pad's band top (0 572 402 302). */
  const IOS = { x: 0, y: 0, width: 402, height: 874 };
  /** The measured Pixel_3a (1080x2220) and its IME's top edge ([0,1398][1080,2220]). */
  const ANDROID = { x: 0, y: 0, width: 1080, height: 2220 };

  it('iOS, content UP (finger down): touches down at y 175, as without a keyboard — not at 114 in the top bar, where the stroke over the box above the pad touched down and moved nothing', () => {
    expect(swipeVectorAbove(IOS, 572, 'up', 'content')).toEqual({ from: { x: 201, y: 175 }, to: { x: 201, y: 458 } });
    expect(swipeVector({ ...IOS, height: 572 }, 'up', 'content').from.y).toBe(114); // the first fix's touch-down, measured dead
  });

  it('content DOWN (finger up) is the uncovered box\'s own stroke, as both device checks ran it: iOS 458 → 114, Android 1118 → 280 — no length cut', () => {
    expect(swipeVectorAbove(IOS, 572, 'down', 'content')).toEqual({ from: { x: 201, y: 458 }, to: { x: 201, y: 114 } });
    expect(swipeVectorAbove(ANDROID, 1398, 'down', 'content')).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } });
  });

  it('Android, content UP: touches down at the keyboard-less 444, not 280', () => {
    expect(swipeVectorAbove(ANDROID, 1398, 'up', 'content')).toEqual({ from: { x: 540, y: 444 }, to: { x: 540, y: 1118 } });
  });

  it('the touch-down is never inside the clearance: a band low on the screen pulls the keyboard-less 1776 up to 0.8 of the 2100 above it', () => {
    expect(swipeVectorAbove(ANDROID, 2100, 'down', 'content').from).toEqual({ x: 540, y: 1680 });
  });

  it('left/right: along the keyboard-less centre line (y 437 on iOS, not the 286 centre of the box above the pad), pulled up to the clearance only when that line lies inside it', () => {
    expect(swipeVectorAbove(IOS, 572, 'right', 'content')).toEqual(swipeVector(IOS, 'right', 'content'));
    expect(swipeVectorAbove(IOS, 572, 'left', 'content').from.y).toBe(437);
    // A keyboard from y 400: the centre line 437 lies inside the clearance (0.8 × 400 = 320).
    expect(swipeVectorAbove(IOS, 400, 'left', 'content')).toEqual({ from: { x: 80, y: 320 }, to: { x: 322, y: 320 } });
  });

  it('a keyboard over most of the screen (unmeasured): a content-up stroke left shorter than half the uncovered box\'s own falls back to that stroke — never a near-zero drag, which is a tap', () => {
    // Band at 262 of 874: the keyboard-less touch-down 175 against a clearance of 210 — a 35-pt drag; the box's own is 158.
    expect(swipeVectorAbove(IOS, 262, 'up', 'content')).toEqual(swipeVector({ ...IOS, height: 262 }, 'up', 'content'));
  });

  it('the fallback\'s boundary: a stroke of EXACTLY half the uncovered box\'s reach is kept', () => {
    // 400x1000, band at 400: box stroke 80 → 320 (240); keyboard-less touch-down 200 → placed 200 → 320 (120 = 240 / 2).
    const box = { x: 0, y: 0, width: 400, height: 1000 };
    expect(swipeVectorAbove(box, 400, 'up', 'content')).toEqual({ from: { x: 200, y: 200 }, to: { x: 200, y: 320 } });
    // Just below it falls back: band at 398 → box stroke 80 → 318 (238), placed 200 → 318 (118 < 119).
    expect(swipeVectorAbove(box, 398, 'up', 'content')).toEqual({ from: { x: 200, y: 80 }, to: { x: 200, y: 318 } });
  });
});

/** Review round 2 (2026-10-08): the stroke `scroll_until` shortens after each turn round a target a fling carried past. */
describe('shortenStroke — the touch-down kept, the reach scaled, never a tap', () => {
  const down = { from: { x: 201, y: 458 }, to: { x: 201, y: 114 } }; // the WDA content-down stroke, 344 pt

  it('scales the reach toward the touch-down, which stays where it was placed', () => {
    expect(shortenStroke(down, 0.5, 874)).toEqual({ from: { x: 201, y: 458 }, to: { x: 201, y: 286 } });
    expect(shortenStroke(down, 1, 874)).toEqual(down);
  });

  it('never below twice TOUCH_SLOP (assumed 24) on an 874-pt iPhone, where 3 % of the side is only 26: 344 × 1/16 = 21.5 becomes 48', () => {
    expect(TOUCH_SLOP).toBe(24);
    expect(shortenStroke(down, 1 / 16, 874)).toEqual({ from: { x: 201, y: 458 }, to: { x: 201, y: 410 } });
  });

  it('never below MIN_STROKE_FRACTION (3 %) of the side along the stroke: on the 2220-px Pixel_3a 67 px, not the slop floor\'s 48', () => {
    expect(MIN_STROKE_FRACTION).toBe(0.03);
    const androidDown = { from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } }; // 838 px; × 1/32 = 26
    expect(shortenStroke(androidDown, 1 / 32, 2220)).toEqual({ from: { x: 540, y: 1118 }, to: { x: 540, y: 1051 } });
    // Sideways the side is the width: 3 % of 1080 = 32.4, under the slop floor — 48.
    expect(shortenStroke({ from: { x: 216, y: 1110 }, to: { x: 864, y: 1110 } }, 1 / 32, 1080)).toEqual({ from: { x: 216, y: 1110 }, to: { x: 264, y: 1110 } });
  });

  it('never longer than the stroke given: a stroke already under the floor is left as it is', () => {
    const short = { from: { x: 10, y: 50 }, to: { x: 10, y: 30 } };
    expect(shortenStroke(short, 0.5, 874)).toEqual(short);
  });

  it('sideways too: along the stroke, x scaled, y kept', () => {
    expect(shortenStroke({ from: { x: 80, y: 437 }, to: { x: 322, y: 437 } }, 0.5, 402)).toEqual({ from: { x: 80, y: 437 }, to: { x: 201, y: 437 } });
  });
});

describe('sameStroke — the same touch-down and lift-off, point for point (code review of round 2, 2026-10-08)', () => {
  const s = { from: { x: 540, y: 1118 }, to: { x: 540, y: 280 } };
  it('compares points, not spelling: key order does not matter, any coordinate does', () => {
    expect(sameStroke(s, { to: { y: 280, x: 540 }, from: { y: 1118, x: 540 } })).toBe(true);
    expect(sameStroke(s, { ...s, from: { x: 541, y: 1118 } })).toBe(false);
    expect(sameStroke(s, { ...s, from: { x: 540, y: 1117 } })).toBe(false);
    expect(sameStroke(s, { ...s, to: { x: 539, y: 280 } })).toBe(false);
    expect(sameStroke(s, { ...s, to: { x: 540, y: 699 } })).toBe(false);
  });
});

describe('scrollStroke — the scroll step\'s stroke over the box the round decided (2026-10-09; it judges nothing since deep/r3-scroll)', () => {
  const BOX = { x: 0, y: 0, width: 1080, height: 2220 };
  const SETTINGS = { x: 0, y: 737, width: 1080, height: 1417 };
  it('over the screen box: the box\'s stroke, as before (swipeVector, swipeVectorAbove, shortenStroke)', () => {
    expect(scrollStroke({ toward: 'down', reach: 1, box: BOX })).toEqual(swipeVector(BOX, 'down', 'content'));
    expect(scrollStroke({ toward: 'down', reach: 1, coverTop: 1398, box: BOX })).toEqual(swipeVectorAbove(BOX, 1398, 'down', 'content'));
    expect(scrollStroke({ toward: 'down', reach: 0.5, box: BOX })).toEqual(shortenStroke(swipeVector(BOX, 'down', 'content'), 0.5, 2220));
  });
  it('over a container\'s box: a content-up stroke touches down inside the list (1021), not on the header above it (444)', () => {
    expect(scrollStroke({ toward: 'up', reach: 1, box: BOX }).from.y).toBe(444);
    expect(scrollStroke({ toward: 'up', reach: 1, box: SETTINGS })).toEqual({ from: { x: 540, y: 1021 }, to: { x: 540, y: 1871 } });
    expect(scrollStroke({ toward: 'up', reach: 0.25, box: SETTINGS })).toEqual({ from: { x: 540, y: 1021 }, to: { x: 540, y: 1234 } });
    expect(scrollStroke({ toward: 'down', reach: 1, coverTop: 1398, box: SETTINGS })).toEqual(swipeVectorAbove(SETTINGS, 1398, 'down', 'content'));
  });
});

describe('dragMs — a stroke\'s duration at the adapter\'s drag speed (2026-10-09)', () => {
  const PIXEL_3A = { width: 1080, height: 2220 };
  it('length ÷ (speed × the long side), in whole ms rounded up: 0.45 of 2220 is 999 px/s', () => {
    expect(dragMs({ from: { x: 540, y: 1776 }, to: { x: 540, y: 444 } }, 0.45, PIXEL_3A)).toBe(1334); // the screen stroke, 1332 px
    expect(dragMs({ from: { x: 540, y: 1871 }, to: { x: 540, y: 1021 } }, 0.45, PIXEL_3A)).toBe(851); // Settings' list stroke
    expect(dragMs({ from: { x: 0, y: 0 }, to: { x: 1332, y: 0 } }, 0.45, { width: 2220, height: 1080 })).toBe(1334); // landscape: the long side still
  });
  it(`never under MIN_DRAG_MS (${MIN_DRAG_MS}, Android's own default): a probe or a halved stroke is not sent faster than before`, () => {
    expect(dragMs({ from: { x: 540, y: 1021 }, to: { x: 540, y: 1234 } }, 0.45, PIXEL_3A)).toBe(300);
  });
});

describe('strokeBox, strokeRoom and the travel cap — the stroke box\'s one owner, and no stroke that is a tap (code review of fix/r3-scroll; deep/r3-scroll, 2026-10-09)', () => {
  const BOX = { x: 0, y: 0, width: 1080, height: 2220 };
  const SETTINGS = { x: 0, y: 737, width: 1080, height: 1417 };
  it(`a box under MIN_STROKE_BOX (${MIN_STROKE_BOX}) along the stroke is no stroke box — 60 % of it is under twice TOUCH_SLOP`, () => {
    expect(MIN_STROKE_BOX).toBe(80);
    const strip = { x: 0, y: 1948, width: 1080, height: 30 };
    expect(strokeBox(BOX, strip, 'down')).toBeUndefined();
    expect(strokeBox(BOX, { ...strip, y: 1898, height: 80 }, 'down')).toEqual({ ...strip, y: 1898, height: 80 });
    expect(strokeBox(BOX, strip, 'left')).toEqual(strip); // 1080 wide: room for a sideways stroke
    // Above a keyboard, only the part above it counts.
    expect(strokeBox(BOX, { x: 0, y: 1300, width: 1080, height: 600 }, 'down', 1350)).toBeUndefined();
  });
  it('met with the box (a container reaching past the screen), above a cover inside it; no room when the two do not meet or the cover starts above the container', () => {
    expect(strokeBox(BOX, { x: 0, y: 242, width: 1080, height: 5000 }, 'down')).toEqual({ x: 0, y: 242, width: 1080, height: 1978 });
    expect(strokeBox(BOX, SETTINGS, 'down', 1398)).toEqual(SETTINGS); // the box is the container's; the stroke keeps clear of the cover (scrollStroke)
    expect(strokeBox(BOX, { x: 0, y: 3000, width: 1080, height: 100 }, 'down')).toBeUndefined();
    expect(strokeBox(BOX, SETTINGS, 'down', 700)).toBeUndefined();
  });
  it('strokeRoom: the FIRST candidate with room, nearest first — the candidate as given and the box met with the screen — or none (no room): a list running on under the IME from 58 px above it has room on the screen, none above the keyboard', () => {
    const strip = { x: 0, y: 1948, width: 1080, height: 30 };
    const list = { x: 0, y: 242, width: 1080, height: 5000 };
    expect(strokeRoom(BOX, [strip, list], 'down')).toEqual({ within: list, box: { x: 0, y: 242, width: 1080, height: 1978 } });
    expect(strokeRoom(BOX, [strip], 'down')).toBeUndefined();
    expect(strokeRoom(BOX, [], 'down')).toBeUndefined();
    const under = { x: 0, y: 1340, width: 1080, height: 800 };
    expect(strokeRoom(BOX, [under], 'up')).toEqual({ within: under, box: under });
    expect(strokeRoom(BOX, [under], 'up', 1398)).toBeUndefined();
    expect(strokeRoom(BOX, [under, SETTINGS], 'up', 1398)).toEqual({ within: SETTINGS, box: SETTINGS, coverTop: 1398 }); // the cover the stroke keeps clear of, handed back with the box
  });
  it('strokeRoom cuts the box above a node DRAWN OVER the container\'s lower half on the stroke\'s line (2026-10-09, the floating tab bar): its top is the box\'s cover, as a keyboard\'s is — the lower of the two never wins', () => {
    // Measured, mp-native Account Detail: the list 0,825 1080x1395 runs under the bar's host 66,1840 948x248.
    const list = { x: 0, y: 825, width: 1080, height: 1395 };
    const bar = { x: 66, y: 1840, width: 948, height: 248 };
    const over = (within: { y: number }) => (within.y === list.y ? [bar] : []);
    expect(strokeRoom(BOX, [list], 'down', undefined, over)).toEqual({ within: list, box: list, coverTop: 1840 });
    // The touch-down clears the bar: y 1638, not the 1942 that landed on it (and 1800 was measured to scroll).
    expect(scrollStroke({ toward: 'down', reach: 1, box: list, coverTop: 1840 })).toEqual({ from: { x: 540, y: 1638 }, to: { x: 540, y: 1028 } });
    expect(scrollStroke({ toward: 'down', reach: 1, box: list })).toEqual({ from: { x: 540, y: 1942 }, to: { x: 540, y: 1104 } });
    // A content-up stroke touches down at 0.2 (y 1104), clear of the bar: not cut; nor a sideways one.
    expect(strokeRoom(BOX, [list], 'up', undefined, over)).toEqual({ within: list, box: list });
    expect(strokeRoom(BOX, [list], 'left', undefined, over)).toEqual({ within: list, box: list });
    // With a keyboard: the higher of the two tops.
    expect(strokeRoom(BOX, [list], 'down', 1398, over)?.coverTop).toBe(1398);
    expect(strokeRoom(BOX, [list], 'down', 2000, over)?.coverTop).toBe(1840);
    // Not on the stroke's line (x 540): a FAB in the corner takes no touch-down — no cut.
    expect(strokeRoom(BOX, [list], 'down', undefined, () => [{ x: 880, y: 1900, width: 160, height: 160 }])).toEqual({ within: list, box: list });
    // In the upper half (a floating header): not this rule's (a bottom cover only) — no cut.
    expect(strokeRoom(BOX, [list], 'down', undefined, () => [{ x: 0, y: 825, width: 1080, height: 200 }])).toEqual({ within: list, box: list });
    // Below the box (the met box ends at the screen's bottom): nothing to cut.
    expect(strokeRoom({ x: 0, y: 0, width: 1080, height: 1800 }, [list], 'down', undefined, over)).toEqual({ within: list, box: { ...list, height: 975 } });
    // The highest of several, and the next candidate judged with its own.
    expect(strokeRoom(BOX, [list], 'down', undefined, () => [bar, { x: 0, y: 1700, width: 1080, height: 100 }])?.coverTop).toBe(1700);
  });
  it('the lower half the cut looks in is the box\'s ABOVE the keyboard (code review of fix/r4, P3): a bar sitting on the keyboard, in the uncovered box\'s lower half, is cut for', () => {
    const list = { x: 0, y: 825, width: 1080, height: 1395 };
    const onKeyboard = () => [{ x: 0, y: 1150, width: 1080, height: 150 }];
    // Above the list's centre (1522), below the uncovered box's (825..1300 → 1062): until then the cut stayed 1300 and the touch-down, 1206, was on the bar.
    expect(strokeRoom(BOX, [list], 'down', 1300, onKeyboard)).toEqual({ within: list, box: list, coverTop: 1150 });
    expect(scrollStroke({ toward: 'down', reach: 1, box: list, coverTop: 1300 }).from).toEqual({ x: 540, y: 1206 });
    expect(scrollStroke({ toward: 'down', reach: 1, box: list, coverTop: 1150 }).from.y).toBeLessThan(1150);
    // Without the keyboard the same bar lies in the list's upper half: not cut, as before.
    expect(strokeRoom(BOX, [list], 'down', undefined, onKeyboard)).toEqual({ within: list, box: list });
  });
  it('a node over the TOUCH-DOWN is cut for wherever its top lies (2026-10-09, D3): a short list under the measured bar — the host starts in its upper half, yet covers 0.8 of it', () => {
    const short = { x: 0, y: 1550, width: 1080, height: 670 };
    const bar = { x: 66, y: 1840, width: 948, height: 248 };
    // The uncut stroke touches down at 0.8 of the list, 2086, on the host (1840–2088): above its centre, 1885, so the lower-half rule missed it.
    expect(scrollStroke({ toward: 'down', reach: 1, box: short }).from).toEqual({ x: 540, y: 2086 });
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [bar])).toEqual({ within: short, box: short, coverTop: 1840 });
    expect(scrollStroke({ toward: 'down', reach: 1, box: short, coverTop: 1840 }).from).toEqual({ x: 540, y: 1782 });
    // The cut moves the touch-down up onto another node drawn over the list: cut above that one too, while a third of the box is left.
    const above = { x: 0, y: 1780, width: 1080, height: 20 };
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [bar, above])).toEqual({ within: short, box: short, coverTop: 1780 });
    expect(scrollStroke({ toward: 'down', reach: 1, box: short, coverTop: 1780 }).from).toEqual({ x: 540, y: 1734 });
    // All or nothing (code review of fix/r5-stroke): when the next cut would leave under a third, none is made — not the bar's alone, which still lands on the node.
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [bar, { x: 0, y: 1600, width: 1080, height: 200 }])).toEqual({ within: short, box: short });
    // A node over most of the box (a sheet; under MIN_STROKE_BOX left too) is not cut for: the stroke is drawn as before, its fast fail naming the node.
    const sheet = { x: 0, y: 1600, width: 1080, height: 620 };
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [sheet])).toEqual({ within: short, box: short });
    // …nor a wrapper over the measured list from near its top: cut, the 838-px stroke would be 70 px (TOUCH_DOWN_CUT_FLOOR).
    const list = { x: 0, y: 825, width: 1080, height: 1395 };
    expect(TOUCH_DOWN_CUT_FLOOR).toBe(1 / 3);
    expect(strokeRoom(BOX, [list], 'down', undefined, () => [{ x: 0, y: 940, width: 1080, height: 1280 }])).toEqual({ within: list, box: list });
    // …while the lower-half rule's cut stands under it: the bar's 1840 kept, the wrapper not cut for.
    expect(strokeRoom(BOX, [list], 'down', undefined, () => [{ x: 66, y: 1840, width: 948, height: 248 }, { x: 0, y: 940, width: 1080, height: 1280 }])).toEqual({ within: list, box: list, coverTop: 1840 });
    // Off the touch-down (beside the stroke's line, or below the touch-down): no cut, as before.
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [{ x: 600, y: 1840, width: 480, height: 248 }])).toEqual({ within: short, box: short });
    expect(strokeRoom(BOX, [short], 'down', undefined, () => [{ x: 0, y: 1600, width: 1080, height: 100 }])).toEqual({ within: short, box: short });
    // A content-up stroke is still never cut.
    expect(strokeRoom(BOX, [short], 'up', undefined, () => [bar])).toEqual({ within: short, box: short });
  });
  it('maxTravel caps the finger\'s travel, the touch-down kept, never under twice TOUCH_SLOP', () => {
    const list = { x: 0, y: 242, width: 1080, height: 1736 };
    expect(scrollStroke({ toward: 'up', reach: 0.25, box: list, maxTravel: 177 })).toEqual({ from: { x: 540, y: 589 }, to: { x: 540, y: 766 } });
    expect(scrollStroke({ toward: 'up', reach: 0.25, box: list, maxTravel: 10 }).to.y).toBe(589 + 52); // the 3 %-of-side floor, 52 px
  });
});
