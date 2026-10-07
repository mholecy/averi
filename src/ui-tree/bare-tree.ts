import { everyNode, STRUCTURAL_ROLES, type UiNode } from '../adapters/types.js';
import { rectArea } from './geometry.js';

/**
 * Does the tree hold anything a user could read or act on? If not it is
 * BARE — the accessibility tree is empty or unrendered, and a selector that
 * matches nothing in it says nothing about the screen. Asked by ui_snapshot's
 * second text block (mcp/tool-text.ts `snapshotNote`); the wording lives
 * there, the question here, with the rest of what is asked OF a tree.
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
 * alone (WDA always sends rects, every fixture). Nothing is
 * skipped by position (the root counts). Sizes are judged against the tree's
 * OWN largest rect, which assumes every source wraps the screen in a
 * full-size root (idb's Application, WDA's Application/Window, Android's
 * decor): a future source without one, giving only a few labelled
 * equal-size containers, would be called bare. Accepted costs: a labelled
 * full-screen RN root alone is called bare — the wrong direction, accepted
 * because that shape (one accessible root collapsing the whole screen)
 * cannot be checked from the tree anyway and the note says to compare with
 * a screenshot before reading anything into it; and, on the safe side, a
 * small labelled overlay during load (LogBox, a Metro banner) makes a
 * loading tree non-bare; and a LOADED screen whose only non-wrapper nodes
 * are identified-but-unlabeled images or spinners (icon-only RN Pressables
 * with a testID and no accessibilityLabel, an Android camera/QR screen whose
 * controls are clickable ImageViews without contentDescription) is called
 * bare — rare, since nearly every loaded screen has a text, button, field,
 * scrollable or labelled node, and cheap: a wrong ⚠ sends the agent to a
 * screenshot, never to a conclusion. Device-confirmed 2026-10-06: the WDA
 * and uiautomator splash shapes and idb's stuck 0×0 Application (the last
 * now a read error at the idb source, see above).
 */
export function isBareTree(tree: UiNode): boolean {
  const nodes = [...everyNode(tree)];
  const largest = Math.max(0, ...nodes.map((n) => rectArea(n.rect)));
  const wrapperBySize = (n: UiNode) => largest === 0 || rectArea(n.rect) >= largest * SCREEN_SIZED_FRACTION;
  return !nodes.some((n) => {
    if (DECORATION_ROLES.has(n.role)) return Boolean(n.label);
    if (STRUCTURAL_ROLES.has(n.role)) return (Boolean(n.label) || Boolean(n.value)) && !wrapperBySize(n);
    return true;
  });
}

// STRUCTURAL_ROLES, the wrapper roles this rule reads, is defined beside
// KEYBOARD_ROLE in adapters/types.ts since 2026-10-07 (geometry.ts's
// `shadowing` reads it too).
/** Roles that are decoration unless LABELLED: a splash image (identified or not), a spinner. */
export const DECORATION_ROLES: ReadonlySet<string> = new Set(['image', 'progress']);
/**
 * A container/other node whose area reaches this fraction of the tree's
 * largest rect is a wrapper by size — a window or application, whatever
 * label the framework gave it. 0.9 leaves room for a status-bar inset or a
 * rounding difference between the wrapper and the screen, while a content
 * row (a Cell, a Pressable) sits far below it.
 */
export const SCREEN_SIZED_FRACTION = 0.9;
