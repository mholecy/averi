import { IOS_ROLE_MAP, normalizeIosElement } from './ios-node.js';
import { attachFieldErrors } from './field-errors.js';
import { everyNode, KEYBOARD_ROLE, rectArea, rectsOverlap, type Rect, type UiNode } from './types.js';

/**
 * Parser for WebDriverAgent's sessionless `GET /source?format=json` — the
 * NESTED XCUIElement tree, kept nested (unlike idb's flat AX-element list).
 * The nesting is the point of the WDA path: React Native puts `testID` on the
 * HOST VIEW, which WDA reports as an `Other` node WITH `rawIdentifier` while
 * idb's AX output drops it entirely (measured 2026-08-12, WDA 16.1.7,
 * fixtures in tests/fixtures/wda-source-*.json).
 *
 * Since 2026-10-07 the nesting carries a second thing idb cannot see: the
 * soft keyboard. iOS keeps it in the accessibility tree as a `Keyboard`
 * element under its own `Window`, so the band of screen it covers is a
 * tree question, and this parser answers it ONCE per read (`keyboardMarks`,
 * below): one node per on-screen keyboard gets `KEYBOARD_ROLE` and its rect
 * is the band; the Windows that ARE the keyboard's UI get `ofKeyboard`, so
 * a tap on a key or on the accessory toolbar's Done is never read as a tap
 * under the keyboard. Zero extra device reads: the tap guard and the pixel
 * poll read both marks off the same tree that resolved their target. The
 * measured facts the rules rest on are in
 * docs/bugs/2026-10-05-ios-tap-lands-on-soft-keyboard.md and in
 * tests/adapters/wda-source-keyboard.test.ts, over the five fixtures
 * captured that day.
 */

/**
 * WDA element `type` → normalized role. Types arrive WITHOUT the
 * "XCUIElementType" prefix (measured: plain "StaticText", "Other", ...).
 * The shared iOS vocabulary (ios-node.ts) plus structural types only
 * the nested tree has.
 *
 * `Keyboard` stays `container`: the element's own rect is NOT the band the
 * keyboard covers (measured 17–44 pt short of the drawn area, keyboardMarks)
 * and a parked keyboard — `isVisible=0`, below the screen — is still in the
 * tree. The node that carries `KEYBOARD_ROLE` is chosen by keyboardMarks,
 * not by type.
 */
const ROLE_MAP: Record<string, string> = {
  ...IOS_ROLE_MAP,
  // Structural types that never appear in idb's flat AX list:
  Application: 'container',
  NavigationBar: 'container',
  TabBar: 'container',
  Alert: 'container',
  Keyboard: 'container',
  StatusBar: 'container',
  // `Toolbar` is `toolbar` (stage B, 2026-10-07): an app's
  // `inputAccessoryView` arrives as a `Toolbar` element in the input-host
  // Window (the 2FA fixtures: "Toolbar" {0,518,402,48} holding the "Done"
  // Button), and ui-tree/soft-keyboard.ts#accessoryDismissButton finds the
  // dismissal by that role. Until then the type fell through to `other`.
  // Not interactive (ui-tree/selectors.ts: a selector never prefers it).
  // Non-structural in ui-tree/bare-tree.ts, where `other` IS structural: as
  // `other` a Toolbar counted as content only when labelled and not
  // screen-sized; as `toolbar` it always does — a toolbar on screen is
  // rendered UI, labelled or not. `role:toolbar` now matches it where
  // `role:other` did. Here and not in the shared IOS_ROLE_MAP: the element
  // was measured through WDA only, and idb's flat AX list, which never
  // carries the keyboard, has not been seen to carry a Toolbar either.
  Toolbar: 'toolbar',
};

/**
 * Relevant subset of a WDA source node. `rawIdentifier` is THE
 * accessibilityIdentifier; `name` merely mirrors it with label fallbacks —
 * never read `name`. `rect` is points with clean numbers (the string `frame`
 * and `nativeFrame` also exist; ignore them). `isVisible`/`isEnabled` are
 * "1"/"0" strings; invisible nodes are KEPT — iOS keeps off-screen nodes in
 * its tree and the assert layer relies on that (see `absent` in flow/config).
 * `isVisible` is read for ONE purpose (since 2026-10-07): whether a
 * `Keyboard` is on screen (keyboardMarks). Nothing else reads it, and the
 * normalized node does not carry it.
 */
interface WdaElement {
  type?: string;
  rawIdentifier?: string | null;
  label?: string | null;
  value?: string | null;
  rect?: Rect;
  isVisible?: string | number | null;
  children?: WdaElement[] | null;
}

/** Parse the raw `/source?format=json` response body. */
export function parseWdaSource(json: string): UiNode {
  return parseWdaSourceValue(JSON.parse(json));
}

/**
 * Parse an already-JSON.parsed `/source` payload (WdaServer.source() returns
 * parsed `unknown`). Accepts the `{ value: <root>, sessionId }` envelope or a
 * bare root node — a node is recognized by its string `type`, which the
 * envelope lacks, so a node's own string `value` field cannot mislead the
 * unwrap. The root comes back as returned (Application → container), not
 * under a synthetic wrapper: selectors walk the root like any node.
 */
export function parseWdaSourceValue(value: unknown): UiNode {
  const root = unwrapEnvelope(value);
  const tree = toUiNode(root, keyboardMarks(root));
  // Nested tree, flat rule: rects are absolute, so a walk is all it takes.
  attachFieldErrors(everyNode(tree));
  return tree;
}

function unwrapEnvelope(value: unknown): WdaElement {
  if (isElement(value)) return value;
  if (isRecord(value) && isElement(value.value)) return value.value;
  throw new Error(
    'WDA /source payload has no element root — expected { value: { type, ... } } or a bare node',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isElement(value: unknown): value is WdaElement {
  return isRecord(value) && typeof value.type === 'string';
}

/** The raw elements keyboardMarks singles out: the band node per on-screen keyboard, and the roots of the keyboard's own UI. */
interface KeyboardMarks {
  bands: ReadonlySet<WdaElement>;
  roots: ReadonlySet<WdaElement>;
}

function toUiNode(el: WdaElement, marks: KeyboardMarks): UiNode {
  const node = normalizeIosElement(
    { type: el.type, label: el.label, identifier: el.rawIdentifier, value: el.value, rect: el.rect },
    ROLE_MAP,
    (el.children ?? []).map((child) => toUiNode(child, marks)),
  );
  // The band node is an `Other` (or, in the fallback, the `Keyboard` itself)
  // whose measured rect IS the covered band — the role changes, the rect,
  // label, identifier and children stay what WDA reported.
  if (marks.bands.has(el)) node.role = KEYBOARD_ROLE;
  if (marks.roots.has(el)) node.ofKeyboard = true;
  return node;
}

/**
 * A band may cover at most this fraction of its window's height (review
 * 2026-10-07): the measured bands are 38–41 % of an 874-pt screen (335,
 * 308, 356 pt), a phone in landscape reaches about half, and a wrapper that
 * is merely a little smaller than its Window — a safe-area inset, a Stage
 * Manager frame, a raw 873.67 against 874 before rounding — is not a
 * keyboard. Without the bound such a wrapper would be crowned the band and
 * every tap on the screen refused.
 */
export const MAX_BAND_FRACTION = 0.6;

/**
 * The two marks the keyboard leaves in the normalized tree. Measured
 * 2026-10-07 on the iPhone 17 simulator (iOS 26.5, 402×874 pt), finportal
 * login and 2FA screens, WDA `/source` saved per state (the fixtures named
 * below, in tests/fixtures/):
 *
 * THE BAND (`KEYBOARD_ROLE`), one per `Keyboard` that is ON SCREEN:
 * - The `Keyboard` rect alone is not the covered area. With the AutoFill
 *   ("Passwords") bar up (wda-source-myport-login-keyboard-bar.json) the bar
 *   is a SIBLING `SystemInputAssistantView` 44 pt ABOVE the Keyboard
 *   {0,583,402,233}, at 539–583 — exactly where the tap this fix exists for
 *   landed (`login_submit` centre y 571). Without the bar
 *   (…-login-keyboard.json) the keyboard's grey still begins at 566, 17 pt
 *   above the keys (read off the screenshot's pixels); and the dictation
 *   button reaches 805–875, below the Keyboard's 816. With an app
 *   `inputAccessoryView` toolbar (…-2fa-keyboard-toolbar.json) the toolbar's
 *   48 pt slot sits above the keyboard, 518–566, and the toolbar itself is
 *   in ANOTHER Window whose `isVisible` is 0 while the toolbar's is 1 — so
 *   neither window-level visibility nor a type list is the rule.
 * - What IS the band, in all three: the keyboard's Window holds one
 *   full-screen wrapper and under it ONE `Other` that is the UNION of
 *   everything the keyboard draws — bar or toolbar slot, keys, dictation
 *   row — reaching the screen bottom: {0,539,402,335}, {0,566,402,308},
 *   {0,518,402,356}. The rule: from the Keyboard's nearest `Window`
 *   ancestor walk down toward the Keyboard; the first element whose rect is
 *   a band — starts below the window's top and is under MAX_BAND_FRACTION
 *   of its height — is it. A wrapper that merely fails to contain the whole
 *   window (an inset, a fractional edge) is walked past. A tree in which no
 *   such ancestor exists (the Keyboard sits right under its full-screen
 *   wrappers, or has no Window) gets the Keyboard's own rect — never
 *   nothing, since a keyboard that IS on screen must not read as absent,
 *   and the Keyboard's own rect is exempt from the bound: a keyboard that
 *   really is that tall really covers that much.
 * - On screen: `isVisible` is "1" AND the rect has area AND it intersects
 *   the window's rect. A PARKED keyboard — the simulator has decided a
 *   hardware keyboard is typing — is still in the tree, `isVisible=0`, at
 *   y 891 on an 874-pt screen (…-2fa-keyboard-parked.json; and at y == 874
 *   on 2026-10-05): both halves of the test agree, and it emits nothing.
 *   With nothing focused there is no `Keyboard` node at all
 *   (…-login-no-keyboard.json). Both conditions are required, not one:
 *   visibility alone was not measured without the geometry agreeing, and a
 *   window with no usable rect (WDA roots a sheet tree in a rect-less node,
 *   ui-tree/geometry.ts) leaves visibility to decide alone.
 * - An ancestor WITHOUT a usable rect is skipped, not crowned: a 0×0 band
 *   would read as covering nothing while a keyboard is up.
 *
 * THE KEYBOARD'S OWN UI (`ofKeyboard`, review round 1 the same day): a tap
 * on a key, on the AutoFill bar, on the dictation button or on the accessory
 * toolbar's Done lands INSIDE the band — and is exactly what the user does
 * (an OTP digit, the one non-submitting dismissal). The guard must not
 * refuse it as "under the keyboard". In every keyboard-up fixture the
 * keyboard's UI is two Windows after the app's: the one holding the
 * `Keyboard` (keys, bar, dictation), and UIKit's input-host Window holding
 * an element identified `inputView` (the keyboard's placeholder, 539/566
 * down) beside the app's `inputAccessoryView` Toolbar (518–566 in the 2FA
 * fixture) — the Toolbar sits in a DIFFERENT Window than the band, so "a
 * descendant of the band node" would miss Done. The rule: the nearest
 * `Window` ancestor of every `Keyboard` element and of every
 * `inputView`-identified element is marked; without a Window, the element
 * itself. Marked whether or not the keyboard is on screen (a parked
 * keyboard's Window is still its Window). Residual: the parked fixture's
 * Toolbar Window holds no `inputView` and is not marked — with no band on
 * screen nothing is refused there either.
 *
 * The `inputView` half is guarded twice (review round 2): `rawIdentifier`
 * is app-settable (a React Native `testID`), and an app element so named
 * would otherwise mark the APP's Window and exempt every target in it from
 * the guard — fail-open, silently (measured on the K1 fixture with
 * `login_card` renamed: `login_submit` was tapped). So (a) the element
 * must be shaped like UIKit's placeholder, which in every fixture has the
 * BAND's own rect — full window width, reaching the window's bottom edge,
 * and a band by `isBand` ({0,539,402,335}, {0,566,402,308} twice); and (b)
 * the Application's FIRST Window child is never marked through it — UIKit
 * orders windows by level, the app's own window comes first and the
 * keyboard's and the input host's after it, in all five fixtures. Each
 * alone is defeatable (a band-shaped bottom sheet named `inputView`; an app
 * with a second window of its own); together a false mark needs both. The
 * `Keyboard` half stays unconditional: the element TYPE is UIKit's, not
 * the app's.
 *
 * Other residuals (recorded, not handled — stage A): the parked case's
 * accessory toolbar stays on screen at 826–874 with `isVisible=1` and no
 * Keyboard on screen, so a target under it is not covered by this rule; an
 * iPad floating or split keyboard, landscape, and a `Keyboard` with more
 * than one band-bearing ancestor were not measured (the first on-screen
 * Keyboard's band is the one `keyboardInTree` reads).
 *
 * `rectsOverlap` and `rectArea` come from adapters/types.ts, not ui-tree/geometry.ts:
 * adapters/ sits below ui-tree/ (ARCHITECTURE.md §2). The band-shape tests
 * (`usableRect`, `isBand`, below) are this file's own — nothing above
 * asks them.
 */
function keyboardMarks(root: WdaElement): KeyboardMarks {
  const bands = new Set<WdaElement>();
  const roots = new Set<WdaElement>();
  /** The ancestors of the element being visited, root first. */
  const ancestors: WdaElement[] = [];
  const visit = (el: WdaElement): void => {
    if (el.type === 'Keyboard') {
      roots.add(nearestWindow(ancestors) ?? el);
      const band = bandOf(el, ancestors);
      if (band !== undefined) bands.add(band);
    } else if (el.rawIdentifier === 'inputView' && isInputHostPlaceholder(el, ancestors)) {
      roots.add(nearestWindow(ancestors) ?? el);
    }
    ancestors.push(el);
    for (const child of el.children ?? []) visit(child);
    ancestors.pop();
  };
  visit(root);
  return { bands, roots };
}

/** The index of the nearest `Window` among the ancestors, or -1. The root itself is never a Window here: it is the Application (or a bare node). */
function windowIndex(ancestors: readonly WdaElement[]): number {
  for (let i = ancestors.length - 1; i > 0; i--) if (ancestors[i].type === 'Window') return i;
  return -1;
}

/** The nearest `Window` ancestor, or undefined — never the root: a root marked `ofKeyboard` would make every target the keyboard's. */
const nearestWindow = (ancestors: readonly WdaElement[]): WdaElement | undefined => ancestors[windowIndex(ancestors)];

/**
 * Is an `inputView`-identified element UIKit's input-host placeholder and
 * not an app element that borrowed the name (keyboardMarks, review round
 * 2)? Both guards: the band shape in its window — full width, flush with
 * the window's bottom, `isBand` — and a Window that is not the
 * Application's first (the app's own). Without a Window, or without a
 * usable window rect, the shape cannot be judged and the answer is no.
 */
function isInputHostPlaceholder(el: WdaElement, ancestors: readonly WdaElement[]): boolean {
  const at = windowIndex(ancestors);
  if (at < 0) return false;
  const window = ancestors[at];
  if (at === 1 && ancestors[0].children?.[0] === window) return false; // the Application's first Window: the app's
  const screen = usableRect(window.rect);
  const rect = usableRect(el.rect);
  if (screen === undefined || rect === undefined) return false;
  return (
    rect.x <= screen.x &&
    rect.x + rect.width >= screen.x + screen.width &&
    rect.y + rect.height >= screen.y + screen.height &&
    isBand(rect, screen)
  );
}

/** The band element for one `Keyboard`, or undefined when it is not on screen (the rule: keyboardMarks). */
function bandOf(keyboard: WdaElement, ancestors: readonly WdaElement[]): WdaElement | undefined {
  // No Window: the root stands in for it as the SCREEN (its rect), ancestors[0] when there is one.
  const windowAt = Math.max(0, windowIndex(ancestors));
  const screen = usableRect(ancestors[windowAt]?.rect) ?? usableRect(ancestors[0]?.rect);
  if (!onScreen(keyboard, screen)) return undefined;
  if (screen === undefined) return keyboard; // "a band of the window" is undecidable without a window rect
  for (let i = windowAt + 1; i < ancestors.length; i++) {
    const rect = usableRect(ancestors[i].rect);
    if (rect !== undefined && isBand(rect, screen)) return ancestors[i];
  }
  return keyboard;
}

const onScreen = (el: WdaElement, screen: Rect | undefined): boolean => {
  if (String(el.isVisible) !== '1') return false;
  const rect = usableRect(el.rect);
  if (rect === undefined) return false;
  return screen === undefined || rectsOverlap(rect, screen);
};

/**
 * The rect when it has positive area, else undefined — a missing or
 * degenerate rect decides nothing here. "Positive area" is `rectArea`'s
 * (adapters/types.ts) since 2026-10-08, not a third spelling of it: the
 * same both-sides-positive test, which NaN fails too. It differs only where
 * the product is not a positive finite number — an infinite side (WDA's
 * JSON never writes one), a product past Number.MAX_VALUE or one under the
 * smallest double (sides near 1e±154): WDA's points are none of these.
 */
const usableRect = (rect: Rect | undefined): Rect | undefined =>
  rect !== undefined && rectArea(rect) > 0 ? rect : undefined;

/** A band of its window: starts below the window's top edge and is under MAX_BAND_FRACTION of its height. */
const isBand = (rect: Rect, screen: Rect): boolean =>
  rect.y > screen.y && rect.height < screen.height * MAX_BAND_FRACTION;
