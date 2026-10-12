/**
 * iOS's STATUS BAND (2026-10-09, the owner's decision on device check C3-1.3
 * of docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-
 * chrome.md): the top of a portrait screen down to the safe area,
 * which the layers above count as OFF the screen for the point a tap
 * presses — the tap's on-screen rule, where a moved tap may go, and
 * `scroll_until`'s stop on that point (ui-tree/geometry.ts#belowStatusBand).
 * Measured: one 0.3-s stroke flung `priority_select` to `24,-20`, its centre
 * (201,6) on the screen and under no node of the idb tree; the plain stop
 * stopped there, and the tap went to the status bar, which scrolled the form
 * back to its top. Neither tree source lists the status bar.
 *
 * Here, in the adapter layer, because it is a fact of the iOS DEVICE: the
 * iOS adapter reports it with the screen (`DeviceScreen.statusBand`,
 * ios.ts#viewport), Android reports none (its status bar lies outside the
 * app's window, so outside every rect its tree gives), and interact/ only
 * reads it — the one source of truth.
 */

/**
 * iOS's top safe-area inset of a PORTRAIT screen, in points, by its size.
 * MEASURED on the iPhone 17 simulator (402x874, iOS 27): WDA lists the
 * navigation bar at `0,62 402x54` (tests/fixtures/wda-source-rn-myport.json,
 * and SwiftUI's at `0,62 402x44` in wda-source-skeleton-login.json), the
 * status bar's own items end at y 39–44 (SpringBoard's tree,
 * ui-tree/bare-tree.ts), and a tap at (201,6) was taken by the status bar.
 * The other sizes are Apple's published insets for the iPhones of those
 * sizes, NOT measured here (where two models share a size and differ — the
 * 375x812 X and 12 mini, 44 and 50; the 414x896 XS Max and XR, 44 and 48 —
 * the smaller). Not in it, stated: the iPhone Air (420x912) and every iPad —
 * no inset for them is on record in the repo or in the simulator runtime's
 * device profiles (which carry the screen size, not the safe area) — so
 * they get `IOS_MIN_STATUS_BAND`.
 */
const IOS_SAFE_AREA_TOPS: Readonly<Record<string, number>> = {
  '402x874': 62,
  '440x956': 62,
  '393x852': 59,
  '430x932': 59,
  '390x844': 47,
  '428x926': 47,
  '375x812': 44,
  '414x896': 44,
  '375x667': 20,
  '414x736': 20,
  '320x568': 20,
};

/**
 * The band for a portrait screen of a size the table does not hold: 20 pt,
 * the classic status bar's height and the smallest any iOS device has in
 * portrait — so the band never reaches into a navigation bar on a screen it
 * was not measured on, and a point in the top 20 pt, which every status bar
 * takes, is still caught. Residual, stated: on such a screen (an iPhone Air,
 * a Dynamic Island model newer than the table) a point between 20 pt and
 * its real inset is judged on screen, as before the band existed.
 */
export const IOS_MIN_STATUS_BAND = 20;

/**
 * The status band of a screen of this size held upright (its shorter side
 * as the width): `IOS_SAFE_AREA_TOPS`, else `IOS_MIN_STATUS_BAND`. The band
 * belongs to the portrait screen; a judgement in a landscape box cuts none
 * (an iPhone hides its status bar there; an iPad's landscape bar is not
 * seen, stated). Residual: an app that hides its status bar (a full-screen
 * player or game) has tap targets in the band refused — the safe direction.
 */
export function iosStatusBand(screen: { width: number; height: number }): number {
  const width = Math.min(screen.width, screen.height);
  const height = Math.max(screen.width, screen.height);
  return IOS_SAFE_AREA_TOPS[`${width}x${height}`] ?? IOS_MIN_STATUS_BAND;
}
