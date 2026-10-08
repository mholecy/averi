/**
 * The one-line responses of the tap, type_text, swipe and launch_app tools, as pure functions.
 *
 * They are here rather than inline in server.ts because server.ts connects a
 * transport at module load and cannot be imported by a test — and these lines
 * carry information the agent acts on: the resolution note (which of several
 * nodes was tapped) and the fill warning (a masked field that already held
 * text). A regression that dropped either would otherwise be invisible to
 * every test in the repo (review 2026-10-03).
 *
 * 2026-10-03, later the same day: the reason above no longer holds — the
 * handlers moved to mcp/tools.ts, which is importable and tested through an
 * in-memory transport. The functions stay here anyway: they are pure, and
 * tool-text.test.ts pins every wording variant (note, warning, cleared)
 * without building a server, a registry or a fake device to provoke each one.
 */

import { everyNode, type Platform, type Stroke, type UiNode } from '../adapters/types.js';
import { isBareTree, nodeCount, treeShape } from '../ui-tree/bare-tree.js';
import type { FillResult } from '../interact/fill.js';
import type { Direction } from '../interact/swipe.js';
import { ASSERT_TIMEOUT_MS } from '../verify/assert.js';
import { formatSeconds } from '../util/duration.js';

/** `Tapped <selector>`, with the resolution note in parentheses when there was one. */
export const tapText = (selector: string, note: string | undefined): string =>
  `Tapped ${selector}${note ? ` (${note})` : ''}`;

/**
 * `Filled <selector> (N characters[, cleared first])[ (note)]`, and on its own
 * line below, `⚠ <warning>` when the fill was legal but suspicious. The
 * warning gets a line of its own so it is not lost inside the parentheses.
 * Takes the fill's own result spread in, so the tool never passes two
 * `undefined`s positionally (review 2026-10-03, C2 shape).
 */
export const fillText = (
  selector: string,
  fill: { length: number; cleared: boolean } & FillResult,
): string =>
  `Filled ${selector} (${fill.length} characters${fill.cleared ? ', cleared first' : ''})${fill.note ? ` (${fill.note})` : ''}` +
  (fill.warning ? `\n⚠ ${fill.warning}` : '');

/**
 * `Swiped[ <direction>] (x,y) → (x,y)` — the stroke actually sent, for a
 * direction and for raw coordinates alike — and on its own line below,
 * `⚠ <note>` when the direction's screen box was not witnessed as the screen
 * (interact/swipe.ts#ScreenBox's note). Both forms were spelled inline in the
 * handler until 2026-10-08 (code review of the swipe commit).
 */
export const swipeText = (swipe: Stroke & { direction?: Direction; note?: string }): string =>
  `Swiped ${swipe.direction !== undefined ? `${swipe.direction} ` : ''}` +
  `(${swipe.from.x},${swipe.from.y}) → (${swipe.to.x},${swipe.to.y})` +
  (swipe.note !== undefined ? `\n⚠ ${swipe.note}` : '');

/**
 * `Launched <appId>[/<Activity>] on <platform>[ (state cleared)]`. The
 * activity is shown by its last path segment — a fully-qualified
 * `pkg/pkg.MainActivity` reads as `pkg.MainActivity` — and is whichever one
 * the launch actually used, so a fallback to averi.yaml's is visible in the
 * response. Moved out of the handler 2026-10-03: wording, not delegation.
 */
export const launchText = (launch: {
  appId: string;
  platform: Platform;
  activity?: string;
  clearState?: boolean;
}): string =>
  `Launched ${launch.appId}${launch.activity === undefined ? '' : `/${launch.activity.split('/').pop()}`} on ${launch.platform}${launch.clearState ? ' (state cleared)' : ''}`;

/**
 * ui_snapshot's SECOND text block, after the JSON — or nothing. The array
 * itself never changes (existing parsers read the first block as before);
 * this says what a bare `[]` could not (2026-10-06, docs/bugs/2026-10-06-
 * ui-snapshot-empty-right-after-launch.md: `role:button` → `[]` two seconds
 * after launch_app returned, on a PIN screen with ten buttons; the same
 * day's addendum: the idb tree stayed a 0×0 Application for 4+ minutes on
 * the RENDERED PIN screen, so no retry promise is made; since the fix of
 * that addendum idb's stuck shape no longer reaches this note — the idb
 * source throws it as a read error, adapters/ios-tree-source.ts
 * IdbEmptyTreeError — and the note covers the bare trees that remain):
 *
 * - filter given, nothing matched, the tree has content: the plain fact —
 *   `0 matches for <filter> in a tree of N nodes (roles: …)`. No ⚠: "absent"
 *   is a legitimate answer, and the roles show what IS there.
 * - the tree is BARE (ui-tree/bare-tree.ts owns the question), with or
 *   without a filter: ⚠, the two readings (still loading; or the tree
 *   source stuck on a rendered screen), the one check that tells them apart
 *   (screenshot), the one thing not to do (read the element as absent), and
 *   `assert` as the poller (its default budget quoted from verify/assert.ts's
 *   ASSERT_TIMEOUT_MS, not restated). The
 *   unfiltered case gets it too: a root with no children reads as "nothing
 *   on screen" just as a `[]` does, and the rule is the tree's, not the
 *   filter's.
 * - filter matched, or an unfiltered tree with content: undefined.
 *
 * `match` is the selector together with what it matched, so the two cannot
 * disagree (review 2026-10-06: a selector and a separate count were a clump).
 */
export const snapshotNote = (tree: UiNode, match?: { selector: string; matched: readonly unknown[] }): string | undefined => {
  if (match !== undefined && match.matched.length > 0) return undefined;
  if (isBareTree(tree)) {
    const lead = match === undefined ? 'The' : `0 matches for ${match.selector}, and the`;
    return (
      `⚠ ${lead} tree is bare: ${nodeCount([...everyNode(tree)])}, none readable or interactive (only wrappers and unlabeled decoration). ` +
      'The accessibility tree is empty or unrendered: the screen may still be loading, or — measured on iOS idb 2026-10-06 — ' +
      'the tree stays empty for minutes on a rendered screen. Compare with screenshot: if the screen is rendered, the tree source is stuck, ' +
      `not the app — do not read the element as absent. assert polls (${formatSeconds(ASSERT_TIMEOUT_MS)} by default; set "timeout" in the spec).`
    );
  }
  if (match === undefined) return undefined;
  return `0 matches for ${match.selector} in a tree of ${treeShape(tree)}`;
};
