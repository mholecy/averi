import { inferScreenSize } from '../ui-tree/geometry.js';
import type { UiNode } from '../adapters/types.js';

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
 */
export const MAX_AXIS_SCALE_RATIO = 1.5;

export type PngScale =
  | { scale: number; width: number; error?: undefined }
  | { scale?: undefined; width?: undefined; error: string };

/**
 * Fails closed with a quotable reason rather than guessing, on four counts:
 * degenerate inputs, a 0-wide tree, a content width (a filtered tree cannot
 * describe a screen), and — only when the root gave us a trustworthy height —
 * the two axes disagreeing past `MAX_AXIS_SCALE_RATIO`.
 *
 * TWO KNOWN HOLES, both narrower than the bug this closes but neither shut:
 *
 * 1. The axis check needs a height it can trust, which only the root rect
 *    gives (a walked height is inflated by scroll content). Trees with no
 *    usable root — idb's flat `describe-all` under a synthetic 0x0 root,
 *    uiautomator multi-root dumps — therefore get the width check only, and an
 *    oversized node anchored at x=0 still poisons the scale there silently.
 * 2. The check is one-sided. A window NARROWER than the capture (iPad
 *    split-view, Android freeform) reads as a too-large scale and sails
 *    through, because the opposite signature — a png shorter than the screen —
 *    is how this package's own band-shaped test captures look, and clamping
 *    already makes those safe.
 *
 * Shutting either one needs a screen size from OUTSIDE the tree (`simctl`
 * device metrics, WDA `/window/size`, `wm size`), which is the fix the bug
 * report asks for and this is not.
 */
export function pngScale(tree: UiNode, pngWidth: number, pngHeight: number): PngScale {
  if (!Number.isFinite(pngWidth) || pngWidth <= 0 || !Number.isFinite(pngHeight) || pngHeight <= 0) {
    return { error: `screenshot has degenerate dimensions ${pngWidth}x${pngHeight}` };
  }
  const size = inferScreenSize(tree);
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
        `screen width ${size.width} is a CONTENT width, not the window width ` +
        '(the widest rect starts inset — filtered tree?)',
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
  return { scale, width: size.width };
}
