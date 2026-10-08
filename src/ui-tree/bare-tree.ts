import { everyNode, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type Rect, type UiNode } from '../adapters/types.js';
import { rectArea } from './geometry.js';

/**
 * Does the tree hold anything a user could read or act on? If not it is
 * BARE — the accessibility tree is empty or unrendered, and a selector that
 * matches nothing in it says nothing about the screen. Asked by ui_snapshot's
 * second text block (mcp/tool-text.ts `snapshotNote`) and, since 2026-10-07,
 * by the flow engine's detect probe (flow/engine.ts `detects`: a probe whose
 * every tree was bare answers `bare`, not `no`, and the ladder will not run
 * a DESTRUCTIVE rung on it — docs/bugs/2026-10-06-second-look-reads-android-
 * decor-as-not-in-state.md) — and, since 2026-10-08, by every element
 * condition and the absent assert (ui-tree/verdict.ts: a selector's miss,
 * or an absence, on a bare tree is `unknown`, never `yes`). The question
 * lives here, with the rest of what is asked OF a tree, and so does the
 * tree's shape (`treeShape`, `nodeCount` at the end of this file) — a fact
 * about the tree every asker quotes. The sentence around it: ui_snapshot's
 * note and the ladder's "every UI tree read was bare, the last one …" keep
 * their own; the conditions' timeouts and the absent assert share ONE,
 * verdict.ts#bareTimeoutNote.
 *
 * Measured (docs/bugs/2026-10-06-ui-snapshot-empty-right-after-launch.md,
 * and its addendum the same day): `role:button` → `[]` two seconds after
 * launch_app on a PIN screen with ten buttons; and later, after a cold
 * relaunch to the rendered PIN screen, `idb ui describe-all` returned ONLY
 * `{"type":"Application","AXFrame":"{{0, 0}, {0, 0}}"}` for 4+ minutes —
 * normalized, a 0×0 root with one empty `other` child.
 *
 * The rule, shaped by two review rounds (2026-10-06) against the real
 * parsers and fixtures:
 *
 * - NOT "no node has a label/identifier/value": the wrappers every source
 *   emits before an app has rendered are all named by their framework. WDA's
 *   `Application` carries the app's display name as its label
 *   (fixtures/wda-source-rn-myport.json: "MyPort"); idb's flat list opens
 *   with an `Application` element labelled the same way; Android's decor
 *   chain carries android:id/content and the status/navigation bar
 *   backgrounds, stripped by the parser to identifiers "content",
 *   "…BarBackground". That rule never fired on a real launch.
 * - NOT "roles only" either: React Native Pressables without an
 *   accessibilityRole, UIKit Cell/Heading/Link, a SwiftUI `.combine` card,
 *   Flutter and Compose clickables all arrive as `container`/`other` WITH
 *   a label — a loaded screen can consist of nothing else, and calling it
 *   bare would tell the registration guard "⚠" on a loaded screen: the
 *   dangerous direction.
 *
 * So: any role other than `container`/`other` counts (text, button,
 * textfield, switch, scrollable, …), even unlabeled. Decoration — `image`,
 * `progress` — counts only when LABELLED, not when merely identified: a
 * lone splash image or spinner IS a loading screen, and the splash image
 * is identified — measured 2026-10-06 on finportal through WDA
 * (docs/bugs/2026-10-06-bare-tree-misses-wda-rn-splash.md): the 7-node
 * splash tree is the labelled Application, five unlabeled containers and
 * `{ role: image, label: null, identifier: "SplashScreenLogo" }`
 * (expo-splash-screen's id); the Android 12+ system splash icon is
 * likewise expected to carry a resource-id (not yet measured). A "Bank
 * logo" with a label is something to select and counts. A
 * `container`/`other` counts when it has a LABEL or VALUE (an identifier
 * alone does not: that is the Android decor shape) AND is not a wrapper by
 * size — its area is under SCREEN_SIZED_FRACTION of the largest rect in the
 * tree, which excludes the labelled full-screen Application of both iOS
 * sources. A tree with NO geometry at all (every rect zero-area) has no
 * screen to judge size against, so there a structural node is a wrapper
 * whatever it says — an app name on a 0×0 root must not read as content.
 * The measured case was idb's stuck 0×0 Application; since 2026-10-06 the
 * idb source throws that shape as a read error (IdbEmptyTreeError) before
 * it reaches this rule, and the clause stays for every other tree with no
 * geometry — a source or fixture that sends no rects, a synthetic root
 * alone (WDA always sends rects, every fixture). Only a status bar is
 * skipped by position (below); the root counts like any node. Sizes are
 * judged against the tree's OWN largest rect, which assumes every source
 * wraps the screen in a full-size root (idb's Application, WDA's Application/Window, Android's
 * decor): a future source without one, giving only a few labelled
 * equal-size containers, would be called bare. Accepted costs: a labelled
 * full-screen RN root alone is called bare — the wrong direction, accepted
 * because that shape (one accessible root collapsing the whole screen)
 * cannot be checked from the tree anyway and the note says to compare with
 * a screenshot before reading anything into it; and, on the safe side, a
 * small labelled overlay during load (LogBox, a Metro banner) makes a
 * loading tree non-bare — safe for a presence check, but since 2026-10-08
 * (verdict.ts) the unsafe direction for `absent:`, which such a tree now
 * decides: measured on the iOS dev-client build, expo's "Downloading 100%…"
 * banner over the splash let an absent-`login_username` wait pass ~1.6 s
 * after a cold launch in 3 of 5 launches (docs/plans/
 * 2026-10-08-round3-phase1-device-check.md); a development-build artefact,
 * no release build shows it; and a LOADED screen whose only non-wrapper nodes
 * are identified-but-unlabeled images or spinners (icon-only RN Pressables
 * with a testID and no accessibilityLabel, an Android camera/QR screen whose
 * controls are clickable ImageViews without contentDescription) is called
 * bare — rare, since nearly every loaded screen has a text, button, field,
 * scrollable or labelled node. For ui_snapshot that miss is cheap: a wrong
 * ⚠ sends the agent to a screenshot, never to a conclusion. Since the ladder
 * asks too (2026-10-07) it has a second cost: on such an icon-only loaded
 * screen `ensure_state` cannot reach a DESTRUCTIVE rung — the probe reads
 * `bare` for the whole second look and the rung is refused (⛔) rather than
 * run. That is the safe direction (a refusal, never a wipe), and `run_flow`
 * of the rung still runs it deliberately. Device-confirmed 2026-10-06: the
 * WDA and uiautomator splash shapes and idb's stuck 0×0 Application (the
 * last now a read error at the idb source, see above); the uiautomator decor
 * shape is also what the ladder's second look read for +5.3…+13.8 s of a
 * measured Android cold launch before `login_screen` rendered at +18.3 s.
 *
 * SpringBoard's launch tree (2026-10-08, docs/bugs/2026-10-08-ios-launch-
 * transition-tree-reads-as-rendered.md). MEASURED on an iPhone 17 simulator,
 * iOS 27.0, idb, four cold launches: for ~2 s after launch_app idb reads
 * SpringBoard, not the app — the status bar (`text '18:29'` at {50,22,48,22},
 * `other 'Cellular'`, a Wi-Fi `other` with a value, `other '100 % battery
 * power'`, the items ending at y 39–44 of an 874 pt screen, the clock at 44)
 * and, for the first ~1.2 s, `button 'Skeleton Internal' id='Skeleton
 * Internal'` at {-2,234,406,406}, the app's home-screen icon zooming in —
 * beside a full-screen Application labelled ' '. Every one of those counted
 * as content, so an `absent:` passed and `ensure_state` ran a DESTRUCTIVE
 * rung with no second look. Two clauses make that tree bare:
 *
 * - the STATUS BAR is not content. A status bar is a CLOCK — a `text` whose
 *   WHOLE label is a time (`18:29`, see CLOCK), wholly inside the top
 *   STATUS_BAND_FRACTION of the screen — with at least one STATUS ITEM
 *   beside it: a labelled or valued `container`/`other` lying wholly above
 *   the clock's bottom plus CLOCK_SLACK_FRACTION of the screen (the measured
 *   Cellular, Wi-Fi and battery items). When there is one, every node lying
 *   wholly above that line is skipped, whatever its role or label. The band
 *   ends at the clock, not at the 8 % cap: the cap reaches y 82 on an iPad
 *   and would swallow a whole navigation bar (24…74).
 * - a LONE button beside a status bar is the launch icon: when the tree has
 *   a status bar and the only content left is one `button`, it is bare. No
 *   shape is asked of the button (the measured frame overflows the screen
 *   and its label is its identifier, but a frame read earlier in the zoom is
 *   not measured and need not do either), because a miss here is the bug
 *   and a wrong "bare" costs only a delay or a refusal.
 *
 * Why so much is asked of the status bar (review of 2026-10-08): a clock
 * found ANYWHERE in a label, in the 8 % band, made app content a status
 * bar — an iPad navigation bar "Departs 10:30" + Back + Share beside one
 * "Check in" button read bare, as did "Total €12.50", "$4.99", an iPhone
 * landscape "Meeting 10:30", and a camera's "00:12" recording timer at
 * y 54 beside "Stop recording" — a ⛔ forever on a legitimate screen and an
 * `absent:` that never passes. The whole-label clock rejects the prices,
 * dates and titles; the status item rejects a lone timer or a clock-shaped
 * title (a nav bar's Back is a button, its title a text — neither is an
 * item). What still reads a loaded screen as bare: a clock-shaped `text`
 * (`v2.10` matches) beside a labelled `container`/`other`, both inside the
 * top 8 % and above the clock's line, and nothing else but one button —
 * the safe direction (`unknown` verdicts, the second look, ⛔), never a pass.
 *
 * INFERRED, not measured: that the clock reads as a time in every locale
 * (CLOCK; a status bar with no readable time — a call pill, "18 h 29" — is
 * missed, i.e. read as before); that a status item always stands beside it;
 * the band's cap on other devices (STATUS_BAND_FRACTION); and that an APP's
 * tree carries no status bar — the one whole app read the note recorded on
 * iOS 27 (bare, 2 nodes, at +3.0 s) had none, no WDA fixture holds a
 * StatusBar, and uiautomator dumps only the app's window (its decor's
 * `statusBarBackground` is identifier-only, bare by the clause above, and
 * holds no clock, so Android's decor is unchanged). A loaded screen with one
 * button and no status bar in its tree is not bare, as before.
 */
export function isBareTree(tree: UiNode): boolean {
  const nodes = [...everyNode(tree)];
  const screen = largestRect(nodes);
  const wrapperBySize = (n: UiNode) => screen === undefined || rectArea(n.rect) >= rectArea(screen) * SCREEN_SIZED_FRACTION;
  const statusLine = screen === undefined ? undefined : statusBarBottom(nodes, screen);
  const content: UiNode[] = [];
  for (const n of nodes) {
    if (statusLine !== undefined && screen !== undefined && within(n.rect, screen, statusLine)) continue;
    const counts =
      DECORATION_ROLES.has(n.role) ? Boolean(n.label)
      : STRUCTURAL_ROLES.has(n.role) ? (Boolean(n.label) || Boolean(n.value)) && !wrapperBySize(n)
      : true;
    // Two content nodes settle it: the launch icon is only ever alone.
    if (counts && content.push(n) > 1) return false;
  }
  return content.length === 0 || (statusLine !== undefined && content[0].role === 'button');
}

/**
 * The tree's largest rect — the screen every source wraps its tree in — or
 * undefined when no rect has area. The status band is measured against the
 * same rect wrapperBySize is, so the two agree on what the screen is: a
 * labelled Application taller than the screen stops being a wrapper by size
 * and counts, whatever the band does.
 */
const largestRect = (nodes: readonly UiNode[]): Rect | undefined => {
  let best: Rect | undefined;
  for (const n of nodes) if (rectArea(n.rect) > (best === undefined ? 0 : rectArea(best))) best = n.rect;
  return best;
};

/** A rect with area lying wholly between the screen's top and `bottom`. */
const within = (r: Rect, screen: Rect, bottom: number): boolean => rectArea(r) > 0 && r.y >= screen.y && r.y + r.height <= bottom;

/**
 * The status bar's bottom line, or undefined when the tree shows none: the
 * first CLOCK `text` wholly inside the top STATUS_BAND_FRACTION whose line —
 * its bottom plus CLOCK_SLACK_FRACTION of the screen, capped at the band —
 * holds a labelled or valued `container`/`other` other than a wrapper.
 */
const statusBarBottom = (nodes: readonly UiNode[], screen: Rect): number | undefined => {
  const cap = screen.y + screen.height * STATUS_BAND_FRACTION;
  for (const clock of nodes) {
    if (clock.role !== 'text' || !CLOCK.test(clock.label ?? '') || !within(clock.rect, screen, cap)) continue;
    const line = Math.min(cap, clock.rect.y + clock.rect.height + screen.height * CLOCK_SLACK_FRACTION);
    const item = nodes.some((n) => n !== clock && STRUCTURAL_ROLES.has(n.role) && (Boolean(n.label) || Boolean(n.value)) && within(n.rect, screen, line));
    if (item) return line;
  }
  return undefined;
};

/**
 * A status-bar clock: the WHOLE label is a time — `18:29` (measured), `6:29`,
 * Finnish `18.29`, Arabic-Indic digits (`\p{Nd}`), an iPad's `6:29 PM` or
 * `6:29 p.m.`, a prefixed `下午6:29`, a Devanagari `6:29 अपराह्न` (letters
 * and combining marks, up to 8 a word) — inferred. Anchored, and the prefix
 * is letters only, so "Departs 10:30", "Total €12.50", "$4.99" and
 * "08.10.2026" are not clocks; `v2.10` is, which the status item guards.
 */
const CLOCK = /^(?:[\p{L}\p{M}]{1,3}\s?)?\p{Nd}{1,2}[:.]\p{Nd}{2}(?:\s?[\p{L}\p{M}]{1,8}\.?){0,2}$/u;

// STRUCTURAL_ROLES, the wrapper roles this rule reads, is defined beside
// KEYBOARD_ROLE in adapters/types.ts since 2026-10-07 (geometry.ts's
// `shadowing` reads it too).
/** Roles that are decoration unless LABELLED: a splash image (identified or not), a spinner. */
export const DECORATION_ROLES: ReadonlySet<string> = new Set(['image', 'progress']);
/**
 * The cap on the status bar (2026-10-08): its clock must lie wholly inside
 * the top fraction of the screen (the tree's largest rect), and nothing below
 * the cap is ever skipped. A fraction, not points, because iOS rects are
 * points and Android's are pixels. Measured on iOS 27 (iPhone 17, 874 pt):
 * the clock ends at y 44, 5.0 %. Inferred from published top insets: a
 * Dynamic Island iPhone's 62 pt of 874 is 7.1 %, an iPhone SE's 20 of 667 is
 * 3.0 %, an iPad's 24 of 1024 is 2.3 %. 8 % holds them all with room for
 * rounding; the band itself ends at the clock (CLOCK_SLACK_FRACTION).
 */
export const STATUS_BAND_FRACTION = 0.08;
/**
 * How far below the clock's bottom a status item may end, as a fraction of
 * the screen's height: 1 %, 8.7 pt on the measured 874 pt screen, where the
 * items end at 39–44 and the clock at 44 (measured); the slack covers an
 * item taller than the clock on another device (inferred).
 */
export const CLOCK_SLACK_FRACTION = 0.01;

/**
 * `button ×3, container ×1, text ×1` — by count, then name; the normalized
 * role vocabulary is small, so nothing is cut. Here, beside the rule, since
 * 2026-10-07 (it was private to mcp/tool-text.ts): the flow engine names a
 * bare tree by its shape too, and flow/ may not import mcp/.
 */
const rolesPresent = (nodes: readonly UiNode[]): string => {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.role, (counts.get(n.role) ?? 0) + 1);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([role, n]) => `${role} ×${n}`)
    .join(', ');
};

/**
 * `7 nodes`, `1 node` — the pluralisation spelled once, for treeShape and
 * ui_snapshot's bare note (mcp/tool-text.ts `snapshotNote`, which counts
 * without the roles); until the 2026-10-07 review each spelled its own.
 */
export const nodeCount = (nodes: readonly UiNode[]): string => `${nodes.length} node${nodes.length === 1 ? '' : 's'}`;

/**
 * What a bare tree holds, as every sentence that reports one says it
 * (2026-10-08, code review: hand-copied in four places until then) — the
 * flow's unread-tree failure, the verdict's undecided wait, ui_snapshot's
 * bare note and the ui_snapshot tool description. isBareTree is what it
 * describes.
 */
export const BARE_TREE_CONTENTS = "nothing of the app's (only wrappers, unlabeled decoration, or iOS's status bar and launch icon)";

/** `7 nodes (roles: container ×6, image ×1)` — a tree by its shape, for a line that says what a bare read held. */
export const treeShape = (tree: UiNode): string => {
  const nodes = [...everyNode(tree)];
  return `${nodeCount(nodes)} (roles: ${rolesPresent(nodes)})`;
};
