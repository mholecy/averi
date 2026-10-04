import { PNG } from 'pngjs';
import type { DeviceAdapter, UiNode } from '../adapters/types.js';
import { sleep } from '../util/sleep.js';
import { pngScale, type PngScale } from './scale.js';

/**
 * One settled frame, one scale, one crop — the module every pixel reading in
 * this package goes through.
 *
 * Before 2026-10-02 the pieces of "capture something trustworthy to measure"
 * had four owners. The stability wait lived in assert.ts and was re-declared
 * (with its own constants) by the `screenshot` tool, while the `verify` legs
 * and `ensure_state` took a BARE screenshot — so the frame that fed the color
 * and text parity tables was the one frame the color assert's own doc says
 * must never be the verdict: a mid-animation one. The png scale was derived
 * at four call sites with four failure policies, and the rect→png crop was
 * written twice (color-parity.ts with an inset, text-parity.ts without).
 *
 * This module is the one owner of three facts about a capture:
 * - the png is STABLE: two identical consecutive captures, bounded attempts;
 * - the scale (tree points → png pixels) is computed ONCE per frame, from
 *   the device screen when it will say and the tree when it will not, and
 *   carried as a value — success or a single, quotable failure — so every
 *   consumer reads the same number and the same sentence (verify/scale.ts
 *   owns the derivation and its wording; this module owns that it runs once);
 * - a rect lands in the png the same way everywhere (`pngRegion`), with the
 *   clipped fraction computed beside it; the inset is the caller's option.
 *
 * What stays with the consumers is their FALLBACK POLICY: the color table
 * fails closed on a bad scale, the text table drops to tree evidence with a
 * note, the asserts fail the one assert. Those are different answers to the
 * same fact, and the fact is produced here.
 *
 * Deliberately NOT here: the polling asserts' tree read (Verifier.poll owns
 * the miss-not-failure rule and hands its tree in), and rect parity, which
 * scales from the tree on purpose (docs/bugs/2026-08-26-png-scale-needs-
 * out-of-tree-screen-size.md — its denominator is the app's canvas, not the
 * device screen).
 */

/**
 * The stability budget: up to 5 re-captures 300 ms apart, i.e. a frame that
 * does not settle costs 6 captures and 1.5 s before the LAST one is returned
 * as the best available. The same budget for every consumer — a `verify` leg
 * now waits exactly as long as the `screenshot` tool does.
 *
 * What that costs a leg that used to take one bare screenshot: a floor of
 * one 300 ms sleep and one extra capture when the screen is already still,
 * up to 1.5 s and five extra captures when it is not. And 2 to 6
 * `screenshot()` calls per leg instead of 1 is that many more chances for
 * a transient screencap failure to reject the leg — the one failure this
 * module cannot carry as a value, because without bytes there is no frame.
 * The png is decoded whenever a tree is in play, even for a contract with
 * only rect anchors, which never read a pixel; that decode is paid once and
 * is cheap next to the wait, so it is not gated.
 */
const STABILITY_ATTEMPTS = 5;
const STABILITY_DELAY_MS = 300;

/** Decoded RGBA screenshot — pngjs's `PNG` satisfies this structurally. */
export interface RgbaImage {
  width: number;
  height: number;
  /** 8-bit RGBA, row-major (pngjs normalizes every PNG variant to this). */
  data: Buffer | Uint8Array;
}

/**
 * A frame that decoded and has a tree beside it: what the pixel comparators
 * measure against. `scale` is the ONE derivation for this frame — consumers
 * read `.error` and apply their own policy, never re-derive.
 */
export interface MeasuredFrame {
  tree: UiNode;
  png: RgbaImage;
  scale: PngScale;
  error?: undefined;
}

/**
 * Why a frame has nothing to measure. Two shapes, told apart by `tree`: the
 * png did not decode (the tree is still here — rect parity can use it), or
 * there is no tree at all (the read failed after retry, or none was asked
 * for). `error` is the one sentence a consumer quotes, so no caller ever
 * interpolates a reason that might not be there.
 */
export type Unmeasured =
  | { tree: UiNode; png?: undefined; scale?: undefined; error: string }
  | { tree?: undefined; png?: undefined; scale?: undefined; error: string };

export interface Frame {
  /** The settled screenshot bytes — what a tool returns to the caller. */
  shot: Buffer;
  /** The measured half, or the one reason there is none. Narrow on `error`, then on `tree`. */
  measured: MeasuredFrame | Unmeasured;
}

export interface CaptureOptions {
  /**
   * `true`: read the tree beside the png (bounded retry; a final failure is
   * carried on the frame — a leg must not lose a minutes-long device run
   * over the optional extra read). A node: the caller already has the tree
   * — the polling asserts, whose poll owns the read — and wants it measured
   * against this frame. Omitted: the frame is the png alone, and no decode
   * or device read is paid for.
   */
  tree?: UiNode | true;
  /** Stability re-captures before giving up (default 5). */
  attempts?: number;
  /** Delay between captures (default 300 ms; the Verifier passes its pollMs so tests stay fast). */
  delayMs?: number;
}

/**
 * Capture a settled frame. Nothing past the screenshot itself throws: a tree
 * read that fails after retry, a png that does not decode, a device that
 * will not say its screen size, and a scale walk that throws on a malformed
 * tree all land on the frame as a reason, so every consumer's own fail-closed
 * policy applies instead of a lost leg. (The screenshot must throw — without
 * bytes there is no frame to carry a reason on.)
 *
 * Order, when the tree is READ here (`tree: true`): the png first — its
 * stability is the evidence the screen stopped moving — then the tree, so
 * the tree read describes the screen the wait found settled rather than one
 * it found still moving. Until 2026-10-02 the `verify` leg did the reverse,
 * and uiautomator reports LIVE bounds during an animation, so a tree read
 * before the wait could carry mid-animation rects against a settled png.
 *
 * When the tree is SUPPLIED (`tree: <node>`, the color and ocr asserts), the
 * caller owns its freshness and it predates the wait by one poll round's
 * read. That is acceptable where it happens because the poll retries: a crop
 * that lands wrong on a frame that settled after the read fails this round
 * and the next round reads a tree of the settled screen.
 *
 * The residual race of png-then-tree, recorded 2026-10-02: the screen can
 * change BETWEEN the stable pair and the tree read — a toast, a late async
 * render — and on Android that window is a whole uiautomator dump, seconds
 * long. It is rarer than the old order's race, which needed only an
 * animation already in flight; this one needs a NEW change to begin after
 * two identical captures. The cheap mitigation — one confirming capture
 * after the tree read, a note on the frame when it differs — was rejected
 * here because it is a tree-read/poll concern (which capture confirms what)
 * and the step that owns those primitives should decide it, not this one.
 *
 * The scale is derived once both halves are in hand; the device screen is
 * asked for only then, and a failed read degrades to the tree (the pre-0.6
 * derivation, still correct for every root-bearing capture) rather than
 * failing the frame.
 */
export async function captureFrame(
  adapter: Pick<DeviceAdapter, 'screenshot' | 'uiTree' | 'viewport'>,
  opts: CaptureOptions = {},
): Promise<Frame> {
  const shot = await stableScreenshot(adapter, opts.attempts ?? STABILITY_ATTEMPTS, opts.delayMs ?? STABILITY_DELAY_MS);
  if (opts.tree === undefined) return { shot, measured: { error: 'no UI tree was asked for beside this png' } };
  let tree: UiNode;
  if (opts.tree === true) {
    try {
      tree = await readTreeWithRetry(adapter);
    } catch (e) {
      return { shot, measured: { error: message(e) } };
    }
  } else {
    tree = opts.tree;
  }
  let png: PNG;
  try {
    png = PNG.sync.read(shot);
  } catch (e) {
    return { shot, measured: { tree, error: `screenshot PNG decode failed: ${message(e)}` } };
  }
  // Memoized inside the adapter (adapters/types.ts), so this is a device read
  // once per adapter, not once per frame.
  const screen = await adapter.viewport().catch(() => undefined);
  let scale: PngScale;
  try {
    scale = pngScale(tree, png.width, png.height, screen);
  } catch (e) {
    // The geometry walk assumes a well-formed tree. A node without children
    // or a pathological depth must fail THIS frame's scale, not the leg: the
    // walk used to run inside the parity tables' containment, and moving it
    // here must not widen what a bad tree can take down.
    scale = { error: `the png scale could not be derived from this tree: ${message(e)}` };
  }
  return { shot, measured: { tree, png, scale } };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Two identical consecutive captures, bounded attempts. Each call costs 2 to
 * attempts+1 device captures, and the color and ocr asserts pay that PER POLL
 * ITERATION — never call this inside a tight loop.
 */
async function stableScreenshot(
  adapter: Pick<DeviceAdapter, 'screenshot'>,
  attempts: number,
  delayMs: number,
): Promise<Buffer> {
  let previous = await adapter.screenshot();
  for (let i = 0; i < attempts; i++) {
    await sleep(delayMs);
    const current = await adapter.screenshot();
    if (current.equals(previous)) return current;
    previous = current;
  }
  return previous;
}

/**
 * Bounded-retry tree read for one-shot consumers (a captured frame): right
 * after a flow settles, a device can transiently fail to produce a tree
 * (uiautomator "null root node") — the same transient the polling asserts
 * absorb via readTreeOrError. Throws after the last attempt with the
 * underlying error in the message.
 */
export async function readTreeWithRetry(
  adapter: Pick<DeviceAdapter, 'uiTree'>,
  attempts = 5,
  delayMs = 300,
): Promise<UiNode> {
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(delayMs);
    try {
      return await adapter.uiTree();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new Error(`UI tree read failed after ${attempts} attempts: ${lastError?.message ?? 'unknown error'}`);
}

/** A rect landed in the png: pixel bounds, half-open, plus how much of it fell outside. */
export interface PngRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Share of the rect's scaled area that lay off-png before clamping (0 = fully on-png). */
  clipped: number;
}

/**
 * The one rect → png mapping: scale, clamp to the png, optionally inset each
 * edge by a fraction of the clamped size. Undefined when nothing of the rect
 * is on the png — off-screen in this capture, which the caller must report.
 *
 * Clamping is not cosmetic. iOS keeps off-viewport nodes in the tree with
 * negative or oversized rects; handed one of those unclamped, `CGImage`
 * silently intersects the crop, and ink measured inside that clipped crop
 * would be normalized as if it were the whole anchor — a phantom type-size
 * delta built out of a partly off-screen element. The clipped FRACTION is
 * computed here, once, so the color sampler can say when a remaining sliver
 * may be a neighbour's fill.
 *
 * The inset is an option because the two consumers disagree for good reason:
 * color sampling insets 12% per edge to stay off anti-aliased borders; OCR
 * must NOT inset, since a cropped glyph reads as a different string. The
 * inset never empties a region (it stops at the half-size).
 *
 * Known deviation from the Python port: Math.round rounds half UP where
 * Python's round() is banker's (half to even), so a bound whose scaled
 * product lands exactly on .5 can shift 1px. Accepted deliberately: the
 * color inset swallows any single-pixel edge, and the fixture tests pin
 * THIS behavior — do not "fix" it to banker's without re-pinning them.
 */
export function pngRegion(
  rect: UiNode['rect'],
  scale: number,
  png: { width: number; height: number },
  inset = 0,
): PngRegion | undefined {
  const x0 = Math.round(rect.x * scale);
  const y0 = Math.round(rect.y * scale);
  const x1 = Math.round((rect.x + rect.width) * scale);
  const y1 = Math.round((rect.y + rect.height) * scale);
  const cx0 = Math.max(x0, 0);
  const cy0 = Math.max(y0, 0);
  const cx1 = Math.min(x1, png.width);
  const cy1 = Math.min(y1, png.height);
  if (cx1 - cx0 < 1 || cy1 - cy0 < 1) return undefined;
  const full = (x1 - x0) * (y1 - y0);
  const clipped = full > 0 ? 1.0 - ((cx1 - cx0) * (cy1 - cy0)) / full : 0.0;
  const iw = cx1 - cx0;
  const ih = cy1 - cy0;
  const ix = Math.min(Math.floor(iw * inset), Math.floor((iw - 1) / 2));
  const iy = Math.min(Math.floor(ih * inset), Math.floor((ih - 1) / 2));
  return { x0: cx0 + ix, y0: cy0 + iy, x1: cx1 - ix, y1: cy1 - iy, clipped };
}
