import { inferScreenSize, SCREEN_AGREEMENT_PCT, type ScreenSize } from '../ui-tree/geometry.js';
import { usableScreen, type DeviceScreen, type Rect, type UiNode } from '../adapters/types.js';

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
 *
 * Since 2026-10-07 this file answers TWO questions: `pngScale` (tree
 * points → png pixels, for every pixel reading) and `windowWidth` (the
 * window's width, the denominator of every rect delta). They share the
 * TREE-side refusals — the ones the tree-only png scale makes — not one
 * policy end to end: with a device screen, `pngScale` scales by the device
 * and demotes a content-width tree to a note, because the tree is then only
 * its cross-check, while `windowWidth` still refuses it, because the tree's
 * width IS the rect denominator.
 * Until then the second had no owner: the rect table and the `rect` assert
 * each asked geometry.ts for the width and kept its `reliable` flag as a
 * remark — the table printed "every delta below is scaled wrong" and then a
 * WITHIN TOLERANCE verdict under it, the assert passed with "(UNRELIABLE …)"
 * in its detail — while `pngScale`, on the same tree, refused that width
 * (the 2026-10-07 parity review, P1). A width this file does not trust now
 * reaches no verdict of either kind, and the tree-side refusals are worded
 * once (`untrustedTreeWidth`). The scale's plausibility bound
 * (`PLAUSIBLE_SCALE_*`) moved here from color-parity.ts the same day, so no
 * comparator keeps a scale-trust rule of its own.
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
  'scaled from the UI tree — no usable device screen size, so a node that is not the window could still inflate it';

/**
 * How closely the ROTATED orientation may fit before a refused swap is called
 * ambiguous rather than settled. Past `MAX_ROTATION_DISAGREEMENT` a capture is
 * not a rotation; under this bound it is too nearly one to scale by the
 * unrotated screen and say nothing. Between them lies the only reading that
 * cannot be told apart from a band-shaped crop, and it fails closed.
 */
const AMBIGUOUS_ROTATION = 1.25;


// The shape is the adapter's (adapters/types.ts), because the units contract
// belongs with the read. Re-exported so verify/ callers keep one import.
export type { DeviceScreen };

/**
 * The scale range a phone or tablet capture can land in: 1 on Android (the
 * tree and the png are both pixels), 2–3 on iOS (points against a 2x/3x
 * png). Outside it the tree and the png were almost certainly not taken of
 * the same screen. A NOTE, never a refusal: a scale inside the range proves
 * nothing (the 2026-08-26 halved scale was 1.5, comfortably inside — 0d36959),
 * and the policy that does refuse is the rest of this file. Owned by
 * color-parity.ts until 2026-10-07, which printed it beside its own table
 * and assert only; it now rides on the scale's note, so every pixel reader
 * that prints the note — the colour table and assert, the text table — says
 * it in one wording.
 */
const PLAUSIBLE_SCALE_MIN = 0.5;
const PLAUSIBLE_SCALE_MAX = 4.0;

/**
 * Why a width read from the TREE alone cannot be measured against, or
 * `undefined` when it can — the ONE wording of the two refusals both answers
 * in this file share, so the png scale and the rect denominator cannot
 * disagree about which tree widths are usable or say it two ways (the rect
 * assert had its own copy of the first sentence, the rect table a warning
 * paragraph standing in for the second).
 *
 * - a 0-wide tree: dividing by it makes every delta NaN, and `NaN > tol` is
 *   false — a silent vacuous pass.
 * - a CONTENT width (`ScreenSize.reliable` false): the widest rect starts
 *   inset, or the tree's screen-shaped rects contradict it. Every number
 *   divided by it is scaled by the inset, which is how a real -4.2 % delta
 *   reads +0.06 % (tests/verify/scale.test.ts pins that case).
 */
function untrustedTreeWidth(size: { width: number; reliable: boolean }): string | undefined {
  if (!(size.width > 0)) {
    return (
      'screen width could not be inferred (the widest rect in the tree is 0 wide — ' +
      'idb on iOS can emit a 0x0 synthetic root when elements carry no frames)'
    );
  }
  if (!size.reliable) {
    return (
      `screen width ${size.width} is a CONTENT width, not the window width — the widest rect ` +
      'starts inset (filtered tree?), or the tree\'s own screen-shaped rects contradict it, and ' +
      'nothing in the tree can say which reading is the screen. On iOS the default idb source often ' +
      'surfaces no window rect — app.ios.treeSource: wda in averi.yaml gives one. On Android an inset ' +
      'start is usually the app\'s own window, letterboxed or freeform (a fixed-orientation or ' +
      'non-resizable app on a large screen): it starts inset by design, and its canvas cannot be told ' +
      'from filtered content — measure it full-screen (resizable, matching orientation) or not at all'
    );
  }
  return undefined;
}

export type WindowWidth =
  | {
      width: number;
      /**
       * The window's left edge in tree units, when it is not 0 — an Android
       * window beside a left-hand nav bar or cutout (`besideSystemBars`).
       * Tree rects are in SCREEN coordinates, so a rect's `x` is measured
       * from here; a Figma frame's x is from the canvas's own edge.
       */
      left?: number;
      note?: string;
      error?: undefined;
      widerThanScreen?: undefined;
    }
  | {
      width?: undefined;
      left?: undefined;
      note?: undefined;
      error: string;
      /**
       * Set when the refusal is the device screen's — a window wider than the
       * side it faces — so a FRESH read of the screen may lift it (a fold, an
       * unfold or `wm size` since the memoized read): verify/capture.ts#
       * witnessedWindow re-reads once and judges again before reporting it.
       */
      widerThanScreen?: true;
    };

/**
 * How far one side of a landscape Android window may sit from the screen's
 * edge and still be a system bar or a display cutout, in % of the long side.
 * Measured shapes it must admit (2400x1080 class phones): a 3-button nav bar
 * 126–168 px (5–7 %), a cutout 80–130 px (3–5.5 %); a 1280x720 xhdpi phone's
 * 96 px bar is 7.5 %. What it must keep out: a split-screen pane (≈ 50 %) and
 * a portrait-only app letterboxed in landscape (≈ 27 % each side) — and those
 * are portrait-shaped or far past it anyway. 10 % sits between.
 */
const MAX_SYSTEM_BAR_INSET_PCT = 10;

/**
 * Is `rect` an app window laid out beside system bars on this screen — the
 * one shape in which a window that starts inset (A1) or ends short of the
 * long side (A2) is still the app's whole canvas? All of:
 *
 * - the platform does that at all (`DeviceScreen.windowsBesideSystemBars`,
 *   Android only — an inset rect in an iOS tree is content: the 0x0 idb
 *   root over content at 16→384 on a 402-pt screen, the P1 false pass, is
 *   never asked);
 * - the rect is LANDSCAPE-shaped: system bars and cutouts sit beside a
 *   window only in landscape; in portrait they are above and below it, and
 *   the window spans the width (the P1 shape is portrait, so even on a
 *   flagged screen it fails here, as it does the span below; on a
 *   near-square foldable this is the check that keeps an inset portrait
 *   pane out);
 * - it spans the FULL perpendicular dimension: from y = 0, as tall as the
 *   short side (within the agreement allowance). Filtered content and a
 *   padded container do not; a top/bottom split pane does not either;
 * - each horizontal gap to the screen's edge is at most
 *   `MAX_SYSTEM_BAR_INSET_PCT` of the long side and neither is negative.
 *
 * A device run should confirm the measured shape (2026-10-07, unmeasured on
 * a device: the emulator's landscape used gesture navigation and no cutout).
 */
function besideSystemBars(rect: Rect, screen: DeviceScreen): boolean {
  if (screen.windowsBesideSystemBars !== true) return false;
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  if (!(rect.width > rect.height)) return false;
  if (Math.abs(rect.y) >= 1 || (Math.abs(rect.height - short) / short) * 100 > SCREEN_AGREEMENT_PCT) return false;
  const leftGap = rect.x;
  const rightGap = long - (rect.x + rect.width);
  const limit = (long * MAX_SYSTEM_BAR_INSET_PCT) / 100;
  return leftGap > -1 && rightGap > -1 && leftGap <= limit && rightGap <= limit;
}

/**
 * The one sentence for a window width nothing outside the tree could witness —
 * the counterpart of `TREE_SCALED`, for the same reason it is produced here.
 */
const TREE_WIDTH_UNWITNESSED =
  'window width from the UI tree alone — no usable device screen size to witness it, so a node that is not the window could still inflate it';

/**
 * The WINDOW's width in tree units — the denominator of every rect delta
 * (the rect parity table and the `rect` assert) — or why there is none.
 *
 * The answer is always the TREE's window, never the device screen: rect
 * parity compares against a Figma FRAME, the app's canvas, which in split
 * view is the window and not the screen
 * (docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md, "Rect
 * parity deliberately still scales from the tree" — that decision stands).
 * The device screen, when the caller has one, only WITNESSES it:
 *
 * - A 0-wide tree and a CONTENT width are refused, device or no device
 *   (`untrustedTreeWidth`, the wording the png scale uses). The device cannot
 *   rescue a content width: a full-width screen and a right-hand split-view
 *   window can both reach the screen's right edge from an inset start, and
 *   only one of them has that width as its canvas.
 * - A window WIDER than the screen side it faces is refused: no window
 *   is, so a node that is not the window was counted as it (an off-viewport
 *   sibling, a pixel-scale rect in a point tree — hole 1 of pngScale's
 *   header, which a device-scaled png never needed to refuse but a
 *   denominator does). There is no png here to orient the panel by (`idb
 *   describe` and `wm size` report it as built; the rect table runs without
 *   pixels), so the side is chosen by the WINDOW's own aspect when the tree
 *   has a window rect (`trustworthyHeight`): a portrait window faces the
 *   short side, a landscape one the long side. Review round 1 found why the
 *   longer side alone is not enough: a pixel-scale window on a 414x896 @2x
 *   phone is 828 wide, under 896, and was measured at half scale under a
 *   "split view?" note — the P1 pattern again. Only the walked fallback,
 *   whose height is a content maximum and says nothing about orientation,
 *   keeps the longer side as its bound.
 * - A window that agrees with EITHER side is measured silently (a top
 *   split pane is landscape-shaped but spans the short side). One NARROWER
 *   than the side it faces is measured, with a note: that is the split-view
 *   canvas this function exists to return — or a crowned sub-view, which
 *   the reader is now told to rule out. A walked width that
 *   lies BETWEEN the two sides gets its own note, saying the tree cannot
 *   tell which it is.
 * - No usable screen (none supplied, a failed read, a 0 or NaN size): the
 *   tree's width, with `TREE_WIDTH_UNWITNESSED` — the degraded path says so.
 *
 * A refusal is a value, never a throw, and its consumers fail closed: the
 * rect table FAILS (it does not drop the platform and print a verdict over
 * the other) and the `rect` assert fails through `failClosed`.
 *
 * - An Android window laid out beside a side nav bar or a display cutout in
 *   landscape (`besideSystemBars`, the parity code review's A1/A2,
 *   2026-10-07): one that starts inset is measured — its own width, its
 *   left edge carried as `left` — where the walk alone calls it a content
 *   width, and one short of the long side by a bar is measured silently,
 *   not noted as a split view. Device-witnessed only, Android only.
 *
 * Run on a device on 2026-10-07 (docs/plans/2026-10-07-top4-device-check.md):
 * the units contract of `DeviceAdapter.viewport()` held — the same units as
 * the tree, `wm size`'s override size when one is set. A screen changed
 * after it was read (a fold or unfold, `wm size`) used to refuse until the
 * server restarted, because `viewport()` was memoized for the adapter's
 * life; a wider-than-screen refusal now carries `widerThanScreen` and its
 * caller re-reads the screen once (`viewport({ fresh: true })`) and judges
 * again (capture.ts#witnessedWindow). Not measured: a real foldable, an
 * Android letterboxed or freeform window (refused as a CONTENT width — it
 * starts inset by design, and portrait-shaped or past the bar bound),
 * iPad Stage Manager, an Android landscape window beside a 3-button nav bar
 * or a cutout (the A1/A2 shapes are pinned from the platform's layout
 * rules, not a dump).
 */
export function windowWidth(
  tree: UiNode,
  screen?: DeviceScreen,
  /** The tree's `inferScreenSize`, when the caller already walked it for this frame (capture.ts). */
  size: ScreenSize = inferScreenSize(tree),
): WindowWidth {
  const witnessed = screen !== undefined && usableScreen(screen) ? screen : undefined;
  // A1: an Android window beside a left-hand nav bar or cutout starts inset,
  // so the walk calls it a CONTENT width — with the device as witness, and
  // only in the shape `besideSystemBars` admits, it is the window.
  if (!size.reliable && witnessed !== undefined && size.insetWindow !== undefined && size.width > 0) {
    const inset = size.insetWindow;
    if (besideSystemBars(inset, witnessed)) return { width: inset.width, ...(inset.x !== 0 && { left: inset.x }) };
  }
  const refused = untrustedTreeWidth(size);
  if (refused !== undefined) return { error: refused };
  if (witnessed === undefined) return { width: size.width, note: TREE_WIDTH_UNWITNESSED };
  screen = witnessed;
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const slack = 1 + SCREEN_AGREEMENT_PCT / 100;
  const agrees = (side: number): boolean => (Math.abs(size.width - side) / side) * 100 <= SCREEN_AGREEMENT_PCT;
  const on = `on a ${screen.width}x${screen.height} DEVICE screen`;
  // No remedy for a changed screen here: the caller re-reads the screen
  // before reporting this (capture.ts#witnessedWindow) and says what the
  // re-read found.
  const tooWide = (bound: string): WindowWidth => ({
    error:
      `the tree's window is ${size.width} wide but the ${screen.width}x${screen.height} device screen is ${bound} — ` +
      'a node that is not the window was counted as it (an off-viewport sibling, or a rect in the other unit), ' +
      'so every delta divided by it would be scaled wrong',
    widerThanScreen: true,
  });
  const narrower = (what: string): WindowWidth => ({
    width: size.width,
    note:
      `window ${size.width} wide ${on} — ${what}, so the deltas are % of a window that does not cover the ` +
      'screen (split view?); check it is the canvas the Figma frame describes',
  });
  if (size.trustworthyHeight) {
    // A window rect: its own aspect says which side of the panel it faces.
    const portrait = size.width <= size.height;
    const side = portrait ? short : long;
    const facing = `the ${portrait ? 'short' : 'long'} side a ${portrait ? 'portrait' : 'landscape'} window faces`;
    if (size.width > side * slack) return tooWide(`${side} on ${facing}`);
    // Agreeing with EITHER side is silent: a top split pane on a phone
    // (1080x700 on 1080x2400) is landscape-SHAPED yet spans the short side
    // exactly, and calling it "narrower than the long side" would be a
    // warning about nothing (code review, 2026-10-07).
    if (agrees(side) || agrees(portrait ? long : short)) return { width: size.width };
    // A2: a landscape Android window beside a right-hand nav bar is short of
    // the long side by the bar — the whole canvas, not a split view.
    if (besideSystemBars({ x: 0, y: 0, width: size.width, height: size.height }, screen)) return { width: size.width };
    return narrower(`narrower than ${facing} (${side})`);
  }
  // The walked fallback: its height is a content maximum, so no orientation.
  if (size.width > long * slack) return tooWide(`at most ${long} in either orientation`);
  if (agrees(short) || agrees(long)) return { width: size.width };
  if (size.width < short) return narrower('narrower than either side');
  return {
    width: size.width,
    note:
      `window ${size.width} wide ${on} — wider than its short side (${short}) and narrower than its long side ` +
      `(${long}), and the tree has no window rect to orient by: a landscape split view, or a node that is not ` +
      'the window counted as it on a portrait screen; check which before quoting the deltas',
  };
}

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
 *   tests/verify/scale.test.ts, alongside two more: a partial capture whose
 *   aspect matches the device rotated cannot be told from a rotation, and a
 *   left|right split screen is geometrically identical to the sheet class the
 *   window leg exists to read.
 */
export function pngScale(
  tree: UiNode,
  pngWidth: number,
  pngHeight: number,
  screen?: DeviceScreen,
  /** The tree's `inferScreenSize`, when the caller already walked it for this frame (capture.ts). */
  size: ScreenSize = inferScreenSize(tree),
): PngScale {
  const got = derivePngScale(size, pngWidth, pngHeight, screen);
  if (got.error !== undefined || (got.scale >= PLAUSIBLE_SCALE_MIN && got.scale <= PLAUSIBLE_SCALE_MAX)) return got;
  const implausible = `scale ${got.scale.toFixed(3)} outside [${PLAUSIBLE_SCALE_MIN}, ${PLAUSIBLE_SCALE_MAX}] — wrong png/tree pairing?`;
  return { ...got, note: got.note === undefined ? implausible : `${got.note}; ${implausible}` };
}

/** `pngScale` before the plausibility note — the derivation and every refusal. */
function derivePngScale(
  size: ScreenSize,
  pngWidth: number,
  pngHeight: number,
  screen?: DeviceScreen,
): PngScale {
  if (!Number.isFinite(pngWidth) || pngWidth <= 0 || !Number.isFinite(pngHeight) || pngHeight <= 0) {
    return { error: `screenshot has degenerate dimensions ${pngWidth}x${pngHeight}` };
  }
  const device = orient(screen, pngWidth, pngHeight);
  if (device !== undefined) return fromDevice(device, size, pngWidth, pngHeight);

  const refused = untrustedTreeWidth(size);
  if (refused !== undefined) return { error: refused };
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
  if (!usableScreen(screen)) return undefined;
  const { width, height } = screen;
  const swapped = { ...screen, width: height, height: width };
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
  // A window beside a system bar (A2) is short of the screen by the bar:
  // the same shape windowWidth measures silently, so no "split view?" here.
  const window = size.insetWindow ?? (size.trustworthyHeight ? { x: 0, y: 0, width: size.width, height: size.height } : undefined);
  const barNarrowed = window !== undefined && besideSystemBars(window, device);
  const note =
    off > SCREEN_AGREEMENT_PCT && !barNarrowed
      ? `scaled by the ${device.width}x${device.height} DEVICE screen; the tree reads ` +
        `${size.width}${size.reliable ? '' : ' (content width)'} — ${off.toFixed(1)}% apart, so the ` +
        'window may not cover the screen (split view?) or the tree carries off-layout nodes'
      : undefined;
  return { scale, width: device.width, note };
}
