/**
 * The one-line responses of the tap, type_text, swipe, launch_app and open_deep_link tools, as pure functions.
 *
 * They are here rather than inline in server.ts because server.ts connects a
 * transport at module load and cannot be imported by a test — and these lines
 * carry information the agent acts on: the resolution note (which of several
 * nodes was tapped) and, until 2026-10-09, the fill's warnings. A regression
 * that dropped either would otherwise be invisible to every test in the repo
 * (review 2026-10-03).
 *
 * 2026-10-03, later the same day: the reason above no longer holds — the
 * handlers moved to mcp/tools.ts, which is importable and tested through an
 * in-memory transport. The functions stay here anyway: they are pure, and
 * tool-text.test.ts pins every wording variant without building a server, a
 * registry or a fake device to provoke each one.
 *
 * The type_text reply WITH a selector (a fill) is not here since 2026-10-09:
 * it is interact/fill-text.ts#fillReply, beside the flow's fill line it must
 * agree with — the flow engine may not import this layer.
 */

import { everyNode, type DeepLinkOutcome, type LinkAlert, type LinkChooser, type Platform, type Stroke, type UiNode } from '../adapters/types.js';
import { alertButtonsText, ALERT_ADVICE } from '../adapters/ios-system-alert.js';
import { CHOOSER_ADVICE, CHOOSER_SHEET_ADVICE, chooserSheetSays } from '../adapters/android-chooser.js';
import { BARE_TREE_CONTENTS, isBareTree, nodeCount, treeShape } from '../ui-tree/bare-tree.js';
import { charactersText } from '../util/count.js';
import type { Direction } from '../interact/swipe.js';
import { launchedLine, WIPE_LABEL, type Launched } from '../flow/launch.js';
import { ASSERT_TIMEOUT_MS } from '../verify/assert.js';
import { formatSeconds } from '../util/duration.js';
import { DISABLED_TAP, type TapMarks } from '../interact/tap.js';

/**
 * A reply's warning on its own line below: `\n⚠ <note>`, or nothing when there is none. The one spelling of that
 * line's shape for the tap, swipe, launch and deep-link replies (the flow's `⚠ …` trace lines carry the same words).
 */
const warnLine = (note: string | undefined): string => (note !== undefined ? `\n⚠ ${note}` : '');

/**
 * `Tapped <selector>`, then — when the tap went elsewhere than the centre
 * (interact/tap-judgement.ts#TapJudge.aim, 2026-10-09) — where and why, then
 * the resolution note in parentheses when there was one. And on its own line
 * below (warnLine), `⚠ <DISABLED_TAP>` when the tapped node is marked disabled
 * (adapters/types.ts#UiNode.disabled, D66): the tap was sent all the same.
 * Unmarked, the reply is one line. `tapped` is what interact/tap.ts#tapElement
 * returned, passed whole.
 */
export const tapText = (selector: string, { note, moved, disabled }: TapMarks): string =>
  `Tapped ${selector}${moved ? ` ${moved}` : ''}${note ? ` (${note})` : ''}` + warnLine(disabled === true ? DISABLED_TAP : undefined);

/**
 * `Typed N characters` — type_text without a selector: the focused field
 * is typed into and nothing is read back, so there is no fill to render.
 * Moved out of the handler 2026-10-08 with the singular (charactersText).
 */
export const typedText = (length: number): string => `Typed ${charactersText(length)}`;

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
  warnLine(swipe.note);

/**
 * `Launched <appId>[/<Activity>] on <platform>[ (state cleared)]` — after
 * `Launched`, the launch's own line (flow/launch.ts#launchedLine, shared with
 * the flow's `launch` trace line: the activity whichever one the launch
 * actually used, so a fallback to averi.yaml's is visible). Moved out of the
 * handler 2026-10-03: wording, not delegation.
 *
 * And on their own lines below, as swipeText lays out its note: `⚠ <note>`
 * when the launch said one (LaunchOutcome.note, 2026-10-09 — iOS's
 * foreground wait, adapters/ios-foreground.ts; since D55b also Android's
 * chooser after a `-p` start, adapters/android-chooser.ts), then
 * `⚠ clearState: <…>` when it wiped (since 2026-10-09, with the session's
 * count) — the flow's
 * `⚠ launch` and `⚠ clearState` trace lines, in the same words and order.
 * The `clearState:` label is kept because the flow line reads exactly so;
 * the note's `launch:` is not, the reply's first line already saying it.
 */
export const launchText = (platform: Platform, launched: Launched): string =>
  `Launched ${launchedLine(launched, platform)}` +
  warnLine(launched.note) +
  (launched.wiped !== undefined ? `\n${WIPE_LABEL}: ${launched.wiped}` : '');

/**
 * `Opened <url> on <platform>`, and the link's note on its own line as `⚠ <note>` (D49a: iOS's foreground wait after a
 * link to the project's own scheme, adapters/ios-foreground.ts — the note leads with what to do), as launchText lays
 * out a launch's. When iOS showed a system alert instead of opening it (D54, DeepLinkOutcome.alert), that is the
 * headline: alertText. When Android's chooser is in front instead of an app (D55, DeepLinkOutcome.chooser), so is
 * that: chooserText.
 */
export const deepLinkText = (platform: Platform, url: string, outcome: DeepLinkOutcome): string =>
  outcome.chooser !== undefined
    ? chooserText(url, outcome.chooser)
    : outcome.alert !== undefined
      ? alertText(url, outcome.alert)
      : `Opened ${url} on ${platform}` + warnLine(outcome.note);

/**
 * `Android has not opened <url> yet: its chooser (<component>) is in front, asking which app opens it.`, then the
 * advice (CHOOSER_ADVICE: pick the app, "Just once", never "Always"; BACK drops the link; averi taps nothing) — D55,
 * worded once in adapters/android-chooser.ts. With the chooser's sheet read (D55c, LinkChooser.sheet; ADR 0041's D55c
 * amendment) the reply quotes it — the title, each app at its row's centre, the buttons at theirs, "(disabled)" where
 * marked (chooserSheetSays) — and the advice is to tap a row by its x and y, then id:button_once
 * (CHOOSER_SHEET_ADVICE); with no sheet, D55's reply byte for byte.
 */
const chooserText = (url: string, chooser: LinkChooser): string => {
  const inFront = `Android has not opened ${url} yet: its chooser (${chooser.component}) is in front, `;
  return chooser.sheet === undefined
    ? `${inFront}asking which app opens it. ${CHOOSER_ADVICE}`
    : `${inFront}${chooserSheetSays(chooser.sheet, 'asking which app opens it')}. ${CHOOSER_SHEET_ADVICE}`;
};

/**
 * `iOS has not opened <url> yet: it asks "<title>" — buttons "<label>" at (x, y), …` (D54), then the advice
 * (ALERT_ADVICE: a tap by the chosen button's label, or at its coordinates (D57), and that averi taps nothing). The
 * buttons and the advice are worded once, in adapters/ios-system-alert.ts, for launch_app's note too (D56). The title
 * and every label are quoted verbatim, localised as iOS shows them; which button opens the link is the agent's to
 * read. "it asks" only when the title names the link's app (`asksForApp`); any other alert is "a system alert", in no
 * words of averi's own about opening.
 */
const alertText = (url: string, alert: LinkAlert): string => {
  const what = alert.asksForApp ? `it asks "${alert.title}"` : `a system alert is up, "${alert.title}"`;
  return `iOS has not opened ${url} yet: ${what} — ${alertButtonsText(alert)}. ${ALERT_ADVICE}`;
};

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
      `⚠ ${lead} tree is bare: ${nodeCount([...everyNode(tree)])}, ${BARE_TREE_CONTENTS}. ` +
      'The accessibility tree is empty or unrendered: the screen may still be loading, or — measured on iOS idb 2026-10-06 — ' +
      'the tree stays empty for minutes on a rendered screen. Compare with screenshot: if the screen is rendered, the tree source is stuck, ' +
      `not the app — do not read the element as absent. assert polls (${formatSeconds(ASSERT_TIMEOUT_MS)} by default; set "timeout" in the spec).`
    );
  }
  if (match === undefined) return undefined;
  return `0 matches for ${match.selector} in a tree of ${treeShape(tree)}`;
};
