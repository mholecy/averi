import type { Point } from '../adapters/types.js';
import type { SystemBar } from './standing.js';

/**
 * THE words for each system bar (standing.ts#SystemBar), by edge: its
 * name, and the diagnosis of a target pinned under it — a layout drawn under
 * the bar without keeping clear of it (iOS's safe area, Android's window
 * insets; at the bottom, an edge-to-edge layout that keeps no clearance).
 * The tap's refusal (interact/resolve.ts#systemBarRemedy), `scroll_until`'s
 * failures (interact/scroll-text.ts) and the pixel assert's
 * (verify/pixel-poll.ts) read them, so the three say one fact alike. Here,
 * in the UI-tree layer every one of them may import, as geometry.ts's
 * `rectText` is.
 */
const SYSTEM_BAR_WORDS: Readonly<Record<SystemBar['edge'], { readonly name: string; readonly pinned: string }>> = {
  top: { name: 'status bar', pinned: 'it is pinned under the status bar (a layout that does not keep clear of it?)' },
  bottom: { name: 'navigation bar', pinned: 'it is pinned under the navigation bar (a layout that does not keep clear of it?)' },
};

/** The bar a system band is: `status bar` at the top, `navigation bar` at the bottom. */
export const systemBarName = (edge: SystemBar['edge']): string => SYSTEM_BAR_WORDS[edge].name;

/** The diagnosis for a target pinned under the bar at `edge`. */
export const pinnedUnder = (edge: SystemBar['edge']): string => SYSTEM_BAR_WORDS[edge].pinned;

/** Where the bar's band lies, in the tree's units: `in the top 62 of the screen`, `from y 2154 to the bottom of the screen`. */
const bandText = (bar: SystemBar): string => (bar.edge === 'top' ? `in the top ${bar.bottom} of the screen` : `from y ${bar.top} to the bottom of the screen`);

/**
 * A point under a system bar as one clause — `under the status bar at
 * (201,6), in the top 62 of the screen (tree units), where a tap goes to the
 * status bar`, `under the navigation bar at (540,2186), from y 2154 to the
 * bottom of the screen (tree units), …` — read by the tap's refusal
 * (interact/resolve.ts#refuseOffScreen) and by `scroll_until`'s failures
 * (interact/scroll-text.ts). No
 * platform named, and the band in the tree's units — pt on iOS, px on
 * Android, the units every rect in the same reply is in.
 */
export const underSystemBar = (at: Point, bar: SystemBar): string => {
  const name = systemBarName(bar.edge);
  return `under the ${name} at (${at.x},${at.y}), ${bandText(bar)} (tree units), where a tap goes to the ${name}`;
};

/**
 * A rect reaching into a system bar's band, its centre clear, as one clause
 * — `partly under the navigation bar, from y 2154 to the bottom of the
 * screen (tree units)` — `scroll_until`'s words for a `fully: true` stop the
 * band's region refuses (standing.ts#Standing's `band`).
 */
export const partlyUnderSystemBar = (bar: SystemBar): string => `partly under the ${systemBarName(bar.edge)}, ${bandText(bar)} (tree units)`;
