import { describe, expect, it, vi } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { MIN_STROKE_FRACTION, sameStroke, screenBox, shortenStroke, swipeScreen, swipeVector, swipeVectorAbove, TOUCH_SLOP } from '../../src/interact/swipe.js';
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
    await expect(scrollUntilVisible(scrolled, 'id:far', { maxSwipes: 1 })).rejects.toThrow(/after 1 swipes/);
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
