import { inferScreenSize, type ScreenSize } from '../ui-tree/geometry.js';
import type { DeviceScreen, UiNode } from '../adapters/types.js';

/**
 * The tree-points → png-pixels scale: THE one owner. Every crop, sample and
 * region in this package is this number times a rect, so a wrong one is not a
 * wrong pixel but a reading of the wrong element — the 2026-08-26 failure,
 * where a halved scale cropped 45% down a screen and OCR read the transaction
 * row behind a modal sheet (docs/bugs/2026-08-26-ios-ocr-crop-scale.md).
 *
 * It lives in verify/ rather than beside `inferScreenSize` in ui-tree/ because
 * the split is a real one: geometry answers "how big is the screen", and this
 * file decides whether that answer is TRUSTWORTHY enough to measure against.
 * Trust policy, tolerances and the prose a failed run has to read are this
 * package's business — ui-tree/geometry.ts states in its own header that it
 * knows nothing about them.
 */

/**
 * How far the down-scale may exceed the across-scale before the tree and the
 * screenshot are declared not to describe the same screen.
 *
 * The number is set by the gap between the two things it must tell apart, not
 * by rounding (whole-point rects move a scale by ~0.13% at phone sizes):
 * - a window legitimately SHORTER than the capture — an Android dump whose
 *   single root excludes the status and navigation bars — runs to about 20%
 *   on a small screen, and must never fail;
 * - an off-viewport node counted as the screen parks one screen-width over,
 *   so it inflates the width by ~100%.
 *
 * 1.5 sits between them with room on both sides. It is deliberately blunt: a
 * tighter bound would fail closed on real 3-button-navigation Android windows,
 * where the old width-only scale was CORRECT.
 *
 * The same number bounds the device-screen check, where it means something
 * narrower: the device cannot report an inflated width, so what is left to
 * catch is a png that does not belong to this screen at all — a capture from
 * another device, or one rotated since. It stays ONE-sided for the reason the
 * tree check is: a png SHORTER than the screen is how this package's own
 * band-shaped test captures look, and clamping already makes those safe.
 */
export const MAX_AXIS_SCALE_RATIO = 1.5;

export type PngScale =
  | { scale: number; width: number; note?: string; error?: undefined }
  | { scale?: undefined; width?: undefined; note?: undefined; error: string };

/**
 * The ONE sentence any surface prints about how a scale was derived. It is
 * produced here rather than by each caller because the callers kept
 * re-deriving the condition and wording it three ways — and one of them keyed
 * off `screen === undefined`, which misses a screen that WAS supplied and was
 * unusable (a 0 or NaN size), the exact case worth admitting to.
 */
const TREE_SCALED =
  'scaled from the UI tree — no usable device screen size, so an off-layout node could still inflate it';

/**
 * How closely the ROTATED orientation may fit before a refused swap is called
 * ambiguous rather than settled. Past `MAX_ROTATION_DISAGREEMENT` a capture is
 * not a rotation; under this bound it is too nearly one to scale by the
 * unrotated screen and say nothing. Between them lies the only reading that
 * cannot be told apart from a band-shaped crop, and it fails closed.
 */
const AMBIGUOUS_ROTATION = 1.25;

/**
 * How far the tree's own width may sit from the device's before the mismatch
 * is worth saying out loud. Whole-point rects and a rounded screen size move
 * it by well under a percent; 2% is comfortably above that and well below the
 * signatures that matter (a system-bar inset, a half-width split view).
 */
const SCREEN_AGREEMENT_PCT = 2;

// The shape is the adapter's (adapters/types.ts), because the units contract
// belongs with the read. Re-exported so verify/ callers keep one import.
export type { DeviceScreen };

/**
 * The scale, derived from the most trustworthy source available:
 *
 * 1. The DEVICE screen (`DeviceAdapter.viewport()` — `idb describe` points on
 *    iOS, `wm size` pixels on Android), when the caller supplies one. This is
 *    the only source that cannot be fooled by the tree, and it is also the
 *    right question: a screenshot captures the SCREEN, so png/screen is the
 *    scale even when the app's window is smaller than the screen.
 * 2. The window rect in the tree, then the widest-rect walk — see
 *    ui-tree/geometry.ts. Both stay reachable because the device read can
 *    fail (no idb, an adb hiccup) and a failed read must degrade, not throw.
 *
 * Fails closed with a quotable reason rather than guessing, on four counts:
 * degenerate inputs, a 0-wide tree, a content width (a filtered tree cannot
 * describe a screen), and the two axes disagreeing past
 * `MAX_AXIS_SCALE_RATIO`.
 *
 * The two holes left open in 0.5.0 — a rootless tree whose oversized node is
 * anchored at x=0, and a window NARROWER than the capture — are shut whenever
 * a device screen is supplied. Without one:
 *
 * - hole 1 no longer scales silently, but it does now FAIL CLOSED where 0.5.0
 *   returned a (halved) number — the oversized node reaches the axis check,
 *   and a tree that contradicts its own window is refused rather than
 *   resolved. That is the one way this change can break a run that used to
 *   produce output, and it takes an iOS box with no working idb to reach.
 * - hole 2 is unfalsifiable from a tree alone and stays pinned in
 *   tests/verify/scale.test.ts, alongside a third: a partial capture whose
 *   aspect matches the device rotated cannot be told from a rotation.
 */
export function pngScale(
  tree: UiNode,
  pngWidth: number,
  pngHeight: number,
  screen?: DeviceScreen,
): PngScale {
  if (!Number.isFinite(pngWidth) || pngWidth <= 0 || !Number.isFinite(pngHeight) || pngHeight <= 0) {
    return { error: `screenshot has degenerate dimensions ${pngWidth}x${pngHeight}` };
  }
  const device = orient(screen, pngWidth, pngHeight);
  const size = inferScreenSize(tree);
  if (device !== undefined) return fromDevice(device, size, pngWidth, pngHeight);

  if (size.width <= 0) {
    return {
      error:
        'screen width could not be inferred (the widest rect in the tree is 0 wide — ' +
        'idb on iOS can emit a 0x0 synthetic root when elements carry no frames)',
    };
  }
  if (!size.reliable) {
    return {
      error:
        `screen width ${size.width} is a CONTENT width, not the window width — either the widest ` +
        'rect starts inset (filtered tree?) or the layout inside the only window-shaped node ' +
        'reaches well past it, and the tree cannot say which of the two is the screen',
    };
  }
  const scale = pngWidth / size.width;
  if (size.trustworthyHeight) {
    const scaleY = pngHeight / size.height;
    if (scaleY > scale * MAX_AXIS_SCALE_RATIO) {
      return {
        error:
          `the tree and the screenshot do not describe the same screen — the ${size.width}x${size.height} ` +
          `window scales by ${scale.toFixed(3)} across but ${scaleY.toFixed(3)} down against a ` +
          `${pngWidth}x${pngHeight} png. Either the width is inflated (an off-viewport node counted as ` +
          'the screen) or the window covers only part of the capture (split screen?)',
      };
    }
  }
  return { scale, width: size.width, note: TREE_SCALED };
}

/**
 * How closely the two axes must agree before a swap is called a ROTATION. A
 * real rotation agrees almost exactly — the same panel, the same device scale,
 * both axes — so this is a rounding allowance, not a judgement call.
 */
const MAX_ROTATION_DISAGREEMENT = 1.05;

/**
 * The device size, oriented to the capture. `idb describe` and `wm size` report
 * the panel as built, so a landscape run reads a portrait screen against a
 * landscape screenshot — a rotation, not a fault.
 *
 * The swap is decided by the CAPTURE alone: take the orientation whose two
 * axes agree, and only when that agreement is tight. Nothing else can be
 * trusted to say. An earlier draft let the tree cast a vote, on the grounds
 * that a wide short png is also what a band-shaped partial capture looks like
 * — but the tree's orientation comes from a walked height, the one number
 * geometry.ts documents as inflated without limit, and review found a
 * landscape iPhone whose scroll container made the tree read "portrait": the
 * swap was refused and the crop scaled by 6.52 instead of 3.0, in the ACROSS
 * direction that the one-sided check below cannot see. Aspect agreement needs
 * no witness: a rotation agrees in the swapped orientation, a band capture
 * agrees in neither and is left alone.
 *
 * Anything degenerate returns undefined and the caller falls back to the tree,
 * which is the pre-0.6 behavior rather than a new failure.
 */
function orient(
  screen: DeviceScreen | undefined,
  pngWidth: number,
  pngHeight: number,
): { screen: DeviceScreen; rotated: boolean; rotatedFit: number } | undefined {
  if (screen === undefined) return undefined;
  const { width, height } = screen;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return undefined;
  const swapped = { width: height, height: width };
  const asIs = axisDisagreement(screen, pngWidth, pngHeight);
  const rotatedFit = axisDisagreement(swapped, pngWidth, pngHeight);
  return rotatedFit < asIs && rotatedFit <= MAX_ROTATION_DISAGREEMENT
    ? { screen: swapped, rotated: true, rotatedFit }
    : { screen, rotated: false, rotatedFit };
}

/** How far the across- and down-scales of one candidate size sit apart (>= 1). */
function axisDisagreement(screen: DeviceScreen, pngWidth: number, pngHeight: number): number {
  const across = pngWidth / screen.width;
  const down = pngHeight / screen.height;
  return Math.max(across / down, down / across);
}

/**
 * png-vs-device. What can still go wrong once the width is the device's own is
 * a png that is not this screen's: a capture from another device, or one taken
 * before a rotation. Both read as a down-scale far larger than the across one.
 *
 * The tree is demoted to a cross-check: when it insists on a different width,
 * that is worth a note (an iPad split-view window, a filtered dump), never a
 * failure — the device is the better witness of the two.
 */
function fromDevice(
  oriented: { screen: DeviceScreen; rotated: boolean; rotatedFit: number },
  size: ScreenSize,
  pngWidth: number,
  pngHeight: number,
): PngScale {
  const device = oriented.screen;
  const scale = pngWidth / device.width;
  const scaleY = pngHeight / device.height;
  // A png that fits this screen ONLY when rotated, but not closely enough to
  // call it a rotation, is the one reading the one-sided check below cannot
  // see: the error lands in the ACROSS direction. Refuse it by name rather
  // than scale by an orientation nothing supports (review 2026-08-27).
  if (
    !oriented.rotated &&
    axisDisagreement(device, pngWidth, pngHeight) > MAX_AXIS_SCALE_RATIO &&
    oriented.rotatedFit <= AMBIGUOUS_ROTATION
  ) {
    return {
      error:
        `the ${device.width}x${device.height} device screen matches the ${pngWidth}x${pngHeight} png ` +
        `only when rotated, and then only to within ${oriented.rotatedFit.toFixed(3)} — too loose to ` +
        'call a rotation, too close to scale by the unrotated screen. Re-capture after the device settles',
    };
  }
  if (scaleY > scale * MAX_AXIS_SCALE_RATIO) {
    return {
      error:
        'the device screen and the screenshot do not describe the same capture — the ' +
        `${device.width}x${device.height} screen scales by ${scale.toFixed(3)} across but ` +
        `${scaleY.toFixed(3)} down against a ${pngWidth}x${pngHeight} png (a capture from another ` +
        'device, or one taken before a rotation?)',
    };
  }
  if (size.width <= 0) {
    return {
      scale,
      width: device.width,
      note: `scaled by the ${device.width}x${device.height} DEVICE screen; the tree offered no width to cross-check it against`,
    };
  }
  const off = (Math.abs(size.width - device.width) / device.width) * 100;
  const note =
    off > SCREEN_AGREEMENT_PCT
      ? `scaled by the ${device.width}x${device.height} DEVICE screen; the tree reads ` +
        `${size.width}${size.reliable ? '' : ' (content width)'} — ${off.toFixed(1)}% apart, so the ` +
        'window may not cover the screen (split view?) or the tree carries off-layout nodes'
      : undefined;
  return { scale, width: device.width, note };
}
