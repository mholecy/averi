import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { captureFrame, measuredFrameFor, pngRegion, STABILITY_DELAY_MS, unsettledNote, unsettledReason } from '../../src/verify/capture.js';
import { FakeAdapter, node } from '../helpers/fake.js';
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';

/**
 * verify/capture.ts is the one owner of frame stability and of the png
 * scale (ARCHITECTURE.md §8). What is worth pinning is the CONTRACT every
 * consumer now relies on: the frame that comes back is a settled one, the
 * budget is the `screenshot` tool's, a tree or device read that fails lands
 * on the frame as a reason rather than as an exception, and the scale is
 * derived from the device first.
 */

// The one sleep owner (util/sleep.ts) is recorded, not waited on: the two
// budgets here are sequences of delays, and the sequence is what to pin —
// a wall clock is a flake, and the real tree-retry budget cost this file
// 1.5 s (review 2026-10-03, round 2). Yields a macrotask so nothing spins.
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
});
afterEach(() => {
  vi.useRealTimers();
});

const SCREEN: UiNode = node({
  role: 'container',
  rect: { x: 0, y: 0, width: 1000, height: 2000 },
  children: [node({ identifier: 'card', rect: { x: 100, y: 200, width: 800, height: 100 } })],
});

function png(width: number, height: number): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(255);
  return PNG.sync.write(image);
}

/** Frames that are not pngs at all — the stability wait compares bytes, nothing else. */
const frame = (tag: string): Buffer => Buffer.from(`frame:${tag}`);

/** A device whose successive screenshots come from a queue; the last one repeats. */
function device(frames: Buffer[]): FakeAdapter {
  const fake = new FakeAdapter({ s: SCREEN }, 's');
  let i = 0;
  fake.screenshot = async () => {
    const shot = frames[Math.min(i++, frames.length - 1)];
    fake.screenshots.push(shot);
    return shot;
  };
  return fake;
}

describe('captureFrame — the stability wait', () => {
  it('returns the first frame that repeats, and nothing captured before it', async () => {
    const fake = device([frame('a'), frame('b'), frame('b'), frame('c')]);
    const { shot } = await captureFrame(fake);
    expect(shot.equals(frame('b'))).toBe(true);
    // a, b, b — the capture that confirmed stability is the one returned.
    expect(fake.screenshots).toHaveLength(3);
  });

  it('a screen that never settles: 5 re-captures 300 ms apart, the LAST frame as the best available, and `stability: moving` saying so', async () => {
    const fake = device(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(frame));
    const got = await captureFrame(fake);
    expect(fake.screenshots).toHaveLength(6);
    expect(got.shot.equals(frame('f'))).toBe(true);
    expect(sleeps).toEqual(Array(5).fill(STABILITY_DELAY_MS));
    // Until 2026-10-05 this frame was indistinguishable from a settled one.
    expect(got.stability).toBe('moving');
    expect(got.captures).toBe(6);
    expect(unsettledReason(got)).toBe(
      'the screen did not settle: 6 captures, each different from the last, before the stability budget or the deadline ran out — an animation or live content; wait for it to finish or hide the live content and re-run',
    );
    expect(unsettledNote(got)).toBe(`⚠ frame: ${unsettledReason(got)} — the last capture is returned as the best available`);
  });

  it('a screen that is already still costs exactly one 300 ms wait and one extra capture, and is settled', async () => {
    const fake = device([frame('a'), frame('a')]);
    const got = await captureFrame(fake);
    expect(fake.screenshots).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(got).toMatchObject({ stability: 'settled', captures: 2 });
    expect(unsettledNote(got)).toBeUndefined();
  });

  /**
   * The budget has no knobs (2026-10-05): a `delayMs` "so tests stay fast"
   * was how the Verifier came to forward its poll interval as the stability
   * delay, and asserts inside flows waited 500 ms where the tool waited 300.
   * The budget is the two constants, whoever calls.
   */
  it('takes no budget options — the delay sequence is the module\'s, whoever calls', async () => {
    const fake = device(['a', 'b', 'b'].map(frame));
    // @ts-expect-error — delayMs/attempts are not options any more (2026-10-05)
    await captureFrame(fake, { delayMs: 5, attempts: 1 });
    expect(sleeps).toEqual([300, 300]);
  });

  it('a `deadline` bounds the wait: a re-capture that would end after it (judged by what the last one cost) is not taken, and the frame says it was still moving', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = device(['a', 'b', 'c', 'd', 'e', 'f'].map(frame));
    // Room for one 300 ms re-capture, not two: the first re-capture is taken
    // (nothing measured yet), costs 300 ms on the clock, and the next would
    // end at 600 — past a deadline at 450.
    const got = await captureFrame(fake, { deadline: Date.now() + 450 });
    expect(fake.screenshots).toHaveLength(2);
    expect(sleeps).toEqual([300]);
    expect(got.shot.equals(frame('b'))).toBe(true);
    expect(got).toMatchObject({ stability: 'moving', captures: 2 });
  });

  it('an expired deadline still gets one honest look — the first capture is never skipped', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const fake = device(['a', 'a'].map(frame));
    const got = await captureFrame(fake, { deadline: Date.now() - 1 });
    expect(fake.screenshots).toHaveLength(1);
    expect(sleeps).toEqual([]);
    // One capture says nothing about stability — decided here, once: no note for a tool that returns it.
    expect(got).toMatchObject({ stability: 'unjudged', captures: 1 });
    expect(unsettledNote(got)).toBeUndefined();
  });

  it('a deadline that still allows the stable pair returns `stability: settled` as usual', async () => {
    const fake = device(['a', 'a'].map(frame));
    const got = await captureFrame(fake, { deadline: Date.now() + 10_000 });
    expect(got).toMatchObject({ stability: 'settled', captures: 2 });
    expect(sleeps).toEqual([300]);
  });
});

describe('captureFrame — the tree beside the png', () => {
  it('without a tree in play, the frame is the png alone: no tree read, no device read, no decode', async () => {
    const fake = device([Buffer.from('not a png'), Buffer.from('not a png')]);
    fake.uiTree = async () => {
      throw new Error('the capture must not read the tree unasked');
    };
    fake.viewport = async () => {
      throw new Error('the capture must not read the device unasked');
    };
    const got = await captureFrame(fake);
    expect(got.shot.equals(Buffer.from('not a png'))).toBe(true);
    // A png-only frame reports nothing about a tree — not even a reason: it
    // asked for nothing more. It still says whether it settled.
    expect(got.measured).toBeUndefined();
    expect(Object.keys(got)).toEqual(['shot', 'stability', 'captures']);
    expect(got).toMatchObject({ stability: 'settled', captures: 2 });
  });

  it('readTree reads the tree with retry — a transient failure (uiautomator null root) is absorbed, 300 ms later', async () => {
    const fake = device([png(1000, 2000)]);
    const orig = fake.uiTree.bind(fake);
    let failures = 1;
    fake.uiTree = async () => {
      if (failures-- > 0) throw new Error('null root node returned by UiTestAutomationBridge');
      return orig();
    };
    const got = await captureFrame(fake, { readTree: true });
    expect(got.measured.tree?.children[0]?.identifier).toBe('card');
    expect(failures).toBe(-1); // succeeded on the 2nd attempt
    // The stability wait, then one retry at the tree-read budget's 300 ms —
    // its own budget, named separately even though the numbers coincide.
    expect(sleeps).toEqual([300, 300]);
    expect(got.measured.error).toBeUndefined();
    expect(got.measured.scale).toMatchObject({ scale: 1, width: 1000 });
  });

  it('a tree read that keeps failing lands on the frame as a reason naming the attempt count and the error — the png is still returned, nothing throws', async () => {
    const fake = device([png(1000, 2000)]);
    fake.uiTree = async () => {
      throw new Error('null root node');
    };
    const got = await captureFrame(fake, { readTree: true });
    expect(got.shot.equals(png(1000, 2000))).toBe(true);
    expect(got.measured.tree).toBeUndefined();
    expect(got.measured.error).toMatch(/^UI tree read failed after 5 attempts: null root node$/);
    expect(got.measured.png).toBeUndefined();
    // One stability wait, then five attempts with four waits between them, each the tree-read budget's 300 ms.
    expect(sleeps).toEqual([300, 300, 300, 300, 300]);
  });

  it('tree: <node> measures the caller\'s own tree against the frame without reading one', async () => {
    const fake = device([png(1000, 2000)]);
    fake.uiTree = async () => {
      throw new Error('the poll owns the tree read');
    };
    const got = await captureFrame(fake, { tree: SCREEN });
    expect(got.measured.tree).toBe(SCREEN);
    expect(got.measured.png).toMatchObject({ width: 1000, height: 2000 });
    expect(got.measured.scale).toMatchObject({ scale: 1, width: 1000 });
  });

  it('an undecodable png keeps the tree and reports the reason; nothing is measured', async () => {
    const fake = device([Buffer.from('not a png')]);
    const got = await captureFrame(fake, { readTree: true });
    expect(got.measured.tree).toBeDefined();
    expect(got.measured.png).toBeUndefined();
    // The frame's one sentence: pngjs's own words, then how to recover.
    expect(got.measured.error).toMatch(/^screenshot PNG decode failed: unrecognised content at end of stream — re-run; if it repeats/);
    expect(got.measured.error).toContain('adb exec-out screencap -p');
  });
});

describe('captureFrame — the one scale', () => {
  it('derives the scale from the DEVICE screen first, and says so when the tree disagrees', async () => {
    const fake = device([png(1000, 2000)]);
    fake.viewportSize = { width: 500, height: 1000 }; // the tree reads 1000 wide
    const got = await captureFrame(fake, { readTree: true });
    expect(got.measured.scale).toMatchObject({ scale: 2, width: 500 });
    expect(got.measured.scale?.note).toMatch(/500x1000 DEVICE screen; the tree reads 1000/);
  });

  it('a device that will not say its size degrades the scale to the tree — it never fails the frame', async () => {
    const fake = device([png(1000, 2000)]);
    fake.viewport = async () => {
      throw new Error('idb describe returned no screen_dimensions');
    };
    const got = await captureFrame(fake, { readTree: true });
    expect(got.measured.scale).toMatchObject({ scale: 1, width: 1000 });
    expect(got.measured.scale?.note).toMatch(/scaled from the UI tree/);
  });

  it('a scale that cannot be derived is carried as the frame\'s one failure reason, not thrown', async () => {
    const fake = device([png(1000, 2000)]);
    // No device screen, and a tree with a 0-wide root: nothing can answer.
    fake.viewport = async () => {
      throw new Error('no idb');
    };
    const got = await captureFrame(fake, { tree: node({ rect: { x: 0, y: 0, width: 0, height: 0 } }) });
    expect(got.measured.scale?.error).toMatch(/screen width could not be inferred/);
  });

  it('a tree the geometry walk cannot traverse fails the SCALE, not the frame — the png and the tree survive', async () => {
    const fake = device([png(1000, 2000)]);
    // A rect-less root — one that is not itself the window, so windowRect
    // (ui-tree/geometry.ts) scans its children for one — with no `children`
    // array to scan. The throw comes from that child scan inside
    // inferScreenSize, before any rect walk. Before 2026-10-02 it ran inside
    // the parity tables' containment; moved into the capture it must stay
    // contained.
    const malformed = { ...node({ rect: { x: 0, y: 0, width: 0, height: 0 } }), children: undefined as unknown as UiNode[] };
    const got = await captureFrame(fake, { tree: malformed });
    expect(got.shot.equals(png(1000, 2000))).toBe(true);
    expect(got.measured.tree).toBe(malformed);
    expect(got.measured.scale?.error).toMatch(/^the png scale could not be derived from this tree: .* — the tree is not well-formed; dump it with ui_snapshot and re-run/);
  });
});

describe('measuredFrameFor — the pure tail captureFrame and the comparator fixtures share', () => {
  const decode = (buf: Buffer) => PNG.sync.read(buf);

  it('is exactly what captureFrame measures for the same tree, png and device screen', async () => {
    const fake = device([png(1000, 2000)]);
    fake.viewportSize = { width: 500, height: 1000 };
    const got = await captureFrame(fake, { tree: SCREEN });
    const direct = measuredFrameFor(SCREEN, decode(png(1000, 2000)), { width: 500, height: 1000 });
    // Same tree by identity, same scale (value AND wording), same pixels —
    // compared field by field: a deep-equal over two pngjs objects is slow
    // and compares decoder internals nobody reads.
    expect(got.measured.tree).toBe(SCREEN);
    expect(got.measured.scale).toEqual(direct.scale);
    expect(got.measured.scale).toMatchObject({ scale: 2, width: 500 });
    expect(got.measured.png?.width).toBe(direct.png.width);
    expect(got.measured.png?.height).toBe(direct.png.height);
    expect(Buffer.from(got.measured.png!.data).equals(Buffer.from(direct.png.data))).toBe(true);
  });

  it('without a device screen it scales from the tree — the comparator fixtures\' default', () => {
    const measured = measuredFrameFor(SCREEN, decode(png(1000, 2000)));
    expect(measured.scale).toMatchObject({ scale: 1, width: 1000 });
    expect(measured.scale.note).toMatch(/scaled from the UI tree/);
  });

  it('a tree the geometry walk cannot traverse fails the SCALE as a carried reason, never throws', () => {
    const malformed = { ...node({ rect: { x: 0, y: 0, width: 0, height: 0 } }), children: undefined as unknown as UiNode[] };
    const measured = measuredFrameFor(malformed, decode(png(1000, 2000)));
    expect(measured.tree).toBe(malformed);
    expect(measured.png.width).toBe(1000);
    expect(measured.scale.error).toMatch(/^the png scale could not be derived from this tree: .* — the tree is not well-formed/);
  });
});

describe('pngRegion — the one rect → png mapping', () => {
  const png = { width: 200, height: 200 };

  it('clamps to the png and reports the clipped fraction; no inset unless asked', () => {
    // scale 3: raw region would be x -30 .. 270, y 2400 .. 2700 against a 2622-tall png.
    const got = pngRegion({ x: -10, y: 800, width: 100, height: 100 }, 3, { width: 1206, height: 2622 });
    expect(got).toMatchObject({ x0: 0, y0: 2400, x1: 270, y1: 2622 });
    // (300x300 scaled) → (270x222 on-png): a third of the area fell off.
    expect(got?.clipped).toBeCloseTo(1 - (270 * 222) / (300 * 300), 6);
    expect(pngRegion({ x: 10, y: 10, width: 100, height: 50 }, 1, png)).toEqual({ x0: 10, y0: 10, x1: 110, y1: 60, clipped: 0 });
  });

  it('applies the requested inset per edge (the color sampler\'s 12%)', () => {
    const got = pngRegion({ x: 10, y: 10, width: 100, height: 50 }, 1, png, 0.12);
    // inset: floor(100*0.12)=12 horizontally, floor(50*0.12)=6 vertically
    expect(got).toEqual({ x0: 22, y0: 16, x1: 98, y1: 54, clipped: 0 });
  });

  it('is undefined for a rect fully off the png, and the inset never empties a tiny one', () => {
    expect(pngRegion({ x: 0, y: 300, width: 10, height: 10 }, 1, png)).toBeUndefined();
    expect(pngRegion({ x: 0, y: 0, width: 2, height: 2 }, 1, png, 0.12)).toMatchObject({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });
});
