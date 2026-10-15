import { IOS_ROLE_MAP, iosRoleOf, normalizeIosElement } from './ios-node.js';
import { attachFieldErrors } from './field-errors.js';
import { everyNode, KEYBOARD_ROLE, rectArea, rectsOverlap, sameRect, SCREEN_SIZED_FRACTION, STRUCTURAL_ROLES, type PresentationKind, type Rect, type TypedPresentationKind, type UiNode } from './types.js';

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
  // was measured through WDA only, and idb's flat AX list has not been
  // seen to carry a Toolbar (it does carry the keyboard on iOS 27 — the
  // keys as plain buttons, the band as `other` — but nothing marks them).
  Toolbar: 'toolbar',
};

/**
 * WDA element `type` → the kind of PRESENTED LAYER a layer holding it is (`UiNode.presentation`), in precedence order:
 * a layer holding several is the first's — a UIKit action sheet presented in a `Popover` is an action sheet, named by
 * its message. Roles stay what ROLE_MAP says (`container`); the mark says the rest. Measured: mp-native's SwiftUI exit
 * alert (`Alert`), Contacts' discard prompt (`Popover` → `Sheet "Are you sure…"`), iPhone 17, iOS 27.
 */
const PRESENTATIONS: readonly (readonly [string, TypedPresentationKind])[] = [
  ['Alert', 'alert'],
  ['Sheet', 'actionSheet'],
  ['Popover', 'popover'],
];

/**
 * Relevant subset of a WDA source node. `rawIdentifier` is THE
 * accessibilityIdentifier; `name` merely mirrors it with label fallbacks —
 * never read `name`. `rect` is points with clean numbers (the string `frame`
 * and `nativeFrame` also exist; ignore them). `isVisible`/`isEnabled` are
 * "1"/"0" strings; invisible nodes are KEPT — iOS keeps off-screen nodes in
 * its tree and the assert layer relies on that (see `absent` in flow/config).
 * `isVisible` is read for three purposes: whether a `Keyboard` is on screen
 * (keyboardMarks); with `isAccessible`, which subtrees are
 * HIDDEN (`hiddenRoots`, `UiNode.hidden`); and whether a cell's content is
 * PARKED (`parkedIn`). The normalized node carries neither flag itself.
 * `placeholderValue` (since 2026-10-09) is the text XCUITest says the field
 * shows while empty; WDA's `value` of an EMPTY field is that same text
 * (measured 2026-10-09, iPhone 17 / iOS 27.0, Contacts "New Contact":
 * `textfield id:Company value 'Company'`), so it is carried as the node's
 * `placeholder` (UiNode) and fill counts a value equal to it as empty.
 * Not seen in a captured fixture: the shrunk ones dropped it.
 */
interface WdaElement {
  type?: string;
  rawIdentifier?: string | null;
  label?: string | null;
  value?: string | null;
  placeholderValue?: string | null;
  rect?: Rect;
  isVisible?: string | number | null;
  isAccessible?: string | number | null;
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
  const keyboard = keyboardMarks(root);
  const tree = toUiNode(root, { ...keyboard, hiddenRoots: hiddenRoots(root), presented: presentedLayers(root, keyboard.roots) }, { hidden: false, cell: undefined, scroller: undefined });
  if (carriesFlags(root)) tree.presentationsJudged = true;
  // Nested tree, flat rule: rects are absolute, so a walk is all it takes.
  attachFieldErrors(everyNode(tree));
  return markUnclippedFrames(tree);
}

/**
 * The WDA source's dialect, marked on its tree's root (UiNode.unclippedFrames): every frame as laid out, a scroll
 * view's content past its frame too. THE mark: the parser sets it on every tree, and a WDA `ui_snapshot` capture that
 * lacks it (older captures do) is given it with this, so it is judged as the live source's tree. Returns `tree`.
 */
export function markUnclippedFrames<T extends UiNode>(tree: T): T {
  tree.unclippedFrames = true;
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

/**
 * Every raw element the parser singles out, read once per payload: the keyboard's (`keyboardMarks`), the roots of the
 * hidden subtrees (`hiddenRoots`) and the presented layers (`presentedLayers`).
 */
interface SourceMarks extends KeyboardMarks {
  hiddenRoots: ReadonlySet<WdaElement>;
  presented: PresentedLayers;
}

/** What an element's ancestors hand down to it: it lies in a hidden subtree (`UiNode.hidden`); its nearest `Cell` ancestor, as placed, with the scroll view that cell lies in (`parkedIn`); its nearest scroll view. */
interface Inherited {
  hidden: boolean;
  cell: CellPlace | undefined;
  scroller: Rect | undefined;
}

/** A `Cell`'s rect, as placed (undefined when WDA gave none), and the rect of the nearest scroll view it lies in (undefined in none) — `parkedIn`'s two facts. */
interface CellPlace {
  at: Rect | undefined;
  in: Rect | undefined;
}

/** WDA's scroll-view types (`parkedIn`): the ones the role map makes `scrollable`. */
const SCROLL_TYPES: ReadonlySet<string> = new Set(['Table', 'CollectionView', 'ScrollView']);

function toUiNode(el: WdaElement, marks: SourceMarks, inherited: Inherited): UiNode {
  const hidden = inherited.hidden || marks.hiddenRoots.has(el);
  const rect = parkedIn(el, inherited.cell) ?? el.rect;
  const cell = el.type === 'Cell' ? { at: rect, in: inherited.scroller } : inherited.cell;
  const scroller = el.type !== undefined && SCROLL_TYPES.has(el.type) ? rect : inherited.scroller;
  const node = normalizeIosElement(
    { type: el.type, label: el.label, identifier: el.rawIdentifier, value: el.value, rect },
    ROLE_MAP,
    (el.children ?? []).map((child) => toUiNode(child, marks, { hidden, cell, scroller })),
  );
  if (hidden) node.hidden = true;
  const presentation = marks.presented.layers.get(el);
  if (presentation !== undefined) node.presentation = presentation;
  if (marks.presented.elements.has(el)) node.presentationElement = true;
  // The band node is an `Other` (or, in the fallback, the `Keyboard` itself)
  // whose measured rect IS the covered band — the role changes, the rect,
  // label, identifier and children stay what WDA reported.
  if (marks.bands.has(el)) node.role = KEYBOARD_ROLE;
  if (marks.roots.has(el)) node.ofKeyboard = true;
  // A string only, and not an empty one: absent means "none reported".
  if (typeof el.placeholderValue === 'string' && el.placeholderValue !== '') node.placeholder = el.placeholderValue;
  if (isTextEcho(el, node)) node.children = [];
  return node;
}

/**
 * Is this a `StaticText` whose one child is its own echo — one rendered
 * string that WDA reports as two elements? Measured on every React Native
 * `<Text>` in the MyPort fixtures (iPhone 17 / iOS 26.5, WDA 16.1.7:
 * wda-source-rn-myport.json captured 2026-08-12, the five
 * wda-source-myport-*.json captured 2026-10-07): the `StaticText` carrying
 * the `testID` — `login_title`, label and value "Prihlásenie", 36,291
 * 330x24 in …-login-no-keyboard.json — holds exactly ONE `StaticText` child
 * whose `rawIdentifier` is null and whose label, value and rect are the
 * parent's own. 4 of the scaffold fixture's 9 StaticTexts and 7 of 14 up to
 * 8 of 17 in the login and 2FA ones are such echoes, and no `StaticText`
 * holding a `StaticText` in any fixture is anything else; the native
 * (SwiftUI) wda-source-skeleton-login.json has none. Kept, the echo is a
 * second element for one piece of copy: verify/text-parity.ts
 * #renderedTextFromTree joined both into "Prihlásenie Prihlásenie", so the
 * text table's tree fallback (the source when OCR is unavailable) reported
 * android-vs-ios and ios-vs-contract drift that is not on screen — Android's
 * uiautomator reports the same `<Text>` as ONE TextView; a `text:` selector
 * matched two nodes (interact/resolve.ts's "2 matches … picked the first",
 * a refusal under `ambiguous: 'refuse'`); ui_snapshot printed the line twice
 * (round 3 phase 2 device check, finding 4).
 *
 * The rule (2026-10-08): the outer element is the one element — the one
 * that carries the `testID` when there is one (no id is required: the
 * unidentified `podpora@finportal.sk` is echoed too, in …-login-keyboard.json
 * and both 2FA fixtures, and loses its echo the same way) —
 * and the echo is dropped, ONLY when the parent is a `StaticText` with
 * exactly one child, and that child is a `StaticText` with no identifier, no
 * children (once its own echo is gone), and a label, value and rect equal to
 * the parent's AS NORMALIZED (empty and null strings alike, rects in rounded
 * points — the values every reader above this file sees; the measured echoes
 * are equal raw as well). The rule runs bottom-up, so an unmeasured chain of
 * identical StaticTexts (A → B → C) collapses whole to A: C is B's echo,
 * then B, a leaf, is A's — never left half-way with the string still
 * doubled. Anything else stays as WDA reported it: a child with another
 * label, value or rect, an identified child (an element the app named), two
 * children, a child keeping a child of its own (one that is not its echo —
 * the whole subtree is kept), a child or a parent of any other type (an
 * `Other` host view or a Button whose label propagates to a descendant — the
 * skeleton fixture's "Password login" — is a different element, and
 * resolve.ts's to disambiguate). Here, beside the keyboard
 * marks and the Toolbar role, because this is where WDA's reported shape
 * becomes elements; idb's flat AX list (ios-tree-source.ts) has no nesting
 * to echo and no idb payload in the tests shows a doubled text, so it is
 * left alone.
 */
function isTextEcho(el: WdaElement, node: UiNode): boolean {
  // node.children is el.children mapped one to one, so one count is both.
  if (el.type !== 'StaticText' || node.children.length !== 1) return false;
  const echo = node.children[0];
  return (
    el.children?.[0]?.type === 'StaticText' &&
    echo.identifier === null &&
    echo.children.length === 0 && // after the child's own echo, if any, was dropped: a chain collapses whole
    echo.label === node.label &&
    echo.value === node.value &&
    sameRect(echo.rect, node.rect)
  );
}

/**
 * The rect a PARKED element of a cell is placed at — its nearest `Cell` ancestor's — or undefined when it is not
 * parked. Parked — the measured shape, each rect of area, shared area as `rectsOverlap` asks it (an edge in common is
 * none): the element is `isVisible="0"` and shares no area with its cell, and shares area with the scroll view the
 * cell lies in (the cell's nearest `Table`, `CollectionView` or `ScrollView` ancestor), while the cell shares none with
 * that scroll view.
 *
 * Measured on stock Contacts' New Contact sheet (iPhone 17 simulator, iOS 27.0, WDA 16.1.7, twice;
 * tests/fixtures/wda-capture-contacts-new-contact.json): UIKit has not laid out the cells below the
 * fold, and WDA lists every element of such a cell — its label, its `Insert` button and that button's image, its
 * separator, the Notes cell's text view — at a PARKED frame, `0,62 286x22` and the like: the element's size, at the
 * sheet's origin, inside the viewport, while the cell itself lies where it is, `add instant message` at `20,1306
 * 362x52`, below the screen. The parked element is `isVisible "0"`; its cell's rect is the only true thing about where
 * it is. Taken at face value, `scroll_until … fully: true` on `text:"add related name"` stopped "fully visible after 0
 * swipes", and a tap on `text:"add instant message"` was reported tapped at (143,73) — the sheet's grabber strip —
 * with the row still below the fold.
 * docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md
 *
 * The decisions (docs/adr/0019-wda-hidden-subtrees-and-parked-cell-content.md):
 * - PLACED AT THE CELL, not marked off screen nor given a zero rect: the cell's rect is where the element will be
 *   once laid out — to within the cell — so a tap is refused off screen with "scroll_until it first",
 *   `scroll_until` strokes toward it and stops once the cell shows (the next read has the element laid out at its
 *   real rect), and a visibility assert reads it where its row is. A zero rect would read "no area": the wait's
 *   zero-area hint, and a `scroll_until` that never finds it on screen.
 * - EVERY element of the cell, not its text only: the `Insert` button sits at the same parked `0,62` and a tap on it
 *   would press the same strip.
 * - A `Cell` only (WDA's type, before the role map, which makes it a `container` like every `Other`): the shape was
 *   measured in a UIKit table's cells. An RN or SwiftUI view whose child lies outside it — an absolutely positioned
 *   badge, an overflowing label — is no cell, and its child stays where WDA reports it.
 * - `isVisible="0"` too: a child drawn outside its cell is drawn where it says, and only a child WDA reports invisible
 *   is placed anew. On screen, a laid-out cell's content lies inside it (`add phone` and its button).
 * - THE SCROLL VIEW'S SHAPE: an element outside its cell is parked only when the cell lies wholly outside the scroll
 *   view it lies in (not laid out) and the element inside it (the parked frame). Without it, content scrolled out
 *   sideways read as parked: a carousel row's third chip at x 410, past its own horizontal scroller, was moved onto
 *   the row's cell and tapped, covering the chips beside it; a collection view's card past its edge likewise. A cell
 *   that is on screen never parks its content (a badge hung off its edge stays where it is). Every one of the 82
 *   parked elements of the two Contacts captures has this shape. The scroll view is the CELL's — the one that decides
 *   whether the cell is laid out — not the element's own nearest: a below-the-fold cell holding a scroller of its own
 *   parks that scroller's content all the same.
 * - Whatever lies between the element and its cell: the nearest `Cell` ancestor decides, through any wrapper.
 *
 * Residuals: a parked element that happens to meet its cell's rect (a cell parked near the sheet's origin) keeps its
 * parked frame — a part of it may be wrong by up to the cell's size; content parked in a container that is not a
 * `Cell` (a collection view's cell is a `Cell` too; a SwiftUI `List` row was not measured), or in a cell with no scroll
 * view around it, is not seen.
 */
function parkedIn(el: WdaElement, cell: CellPlace | undefined): Rect | undefined {
  if (cell === undefined || !isZero(el.isVisible)) return undefined;
  const own = usableRect(el.rect);
  const at = usableRect(cell.at);
  const view = usableRect(cell.in);
  if (own === undefined || at === undefined || view === undefined) return undefined;
  return !rectsOverlap(own, at) && rectsOverlap(own, view) && !rectsOverlap(at, view) ? at : undefined;
}

/**
 * WDA's "0" — a string in the JSON format, compared as `onScreen` (the module's, `isVisible` against "1") compares; a
 * missing or null flag is never "0".
 */
const isZero = (flag: string | number | null | undefined): boolean => flag !== undefined && flag !== null && String(flag) === '0';

/**
 * The presented layers of a payload (`presentedLayers`): each marked layer with its kind, and the elements naming the
 * typed ones.
 */
interface PresentedLayers {
  layers: ReadonlyMap<WdaElement, PresentationKind>;
  elements: ReadonlySet<WdaElement>;
}

/**
 * The payload carries WDA's visibility flags (the root's `isVisible`): its source judged presented layers
 * (`UiNode.presentationsJudged`).
 */
const carriesFlags = (root: WdaElement): boolean => root.isVisible !== undefined && root.isVisible !== null;

/** `el` or some element of its subtree passes `test`. */
const someIn = (el: WdaElement, test: (e: WdaElement) => boolean): boolean => test(el) || (el.children ?? []).some((c) => someIn(c, test));
/** `el` and every element of its subtree pass `test`. */
const allIn = (el: WdaElement, test: (e: WdaElement) => boolean): boolean => test(el) && (el.children ?? []).every((c) => allIn(c, test));
/** The first element of `el`'s subtree, pre-order, passing `test`. */
const firstIn = (el: WdaElement, test: (e: WdaElement) => boolean): WdaElement | undefined => {
  if (test(el)) return el;
  for (const c of el.children ?? []) {
    const found = firstIn(c, test);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * The PRESENTED LAYERS of a payload (`UiNode.presentation`), each a direct child of a `Window` (the root's child when
 * the payload has no Window). Read once per payload, beside `keyboardMarks`; the keyboard's Windows and the input
 * host's (`keyboardMarks`' roots) are never searched.
 * - BY TYPE (`PRESENTATIONS`): a layer holding an `Alert`, a `Sheet` or a `Popover` whose rect shares area with the
 *   Window is that kind, the element (the first of the first type in precedence) naming it; one parked off the
 *   screen (a dismissed alert WDA keeps) types nothing, and the flags judge its layer.
 * - BY THE FLAGS (`screen`, `presentedScreen`), only in a payload that carries them: one layer per Window at most.
 * A layer typed is not also `screen` (one mark a layer).
 */
function presentedLayers(root: WdaElement, keyboardWindows: ReadonlySet<WdaElement>): PresentedLayers {
  const layers = new Map<WdaElement, PresentationKind>();
  const elements = new Set<WdaElement>();
  const windows: WdaElement[] = [];
  const visit = (el: WdaElement): void => {
    if (el.type === 'Window' && el !== root) windows.push(el);
    else for (const c of el.children ?? []) visit(c);
  };
  visit(root);
  for (const window of windows.length > 0 ? windows : [root]) {
    if (keyboardWindows.has(window)) continue;
    // An element types its layer only ON the screen: WDA keeps a dismissed alert in its tree, parked off it.
    const screen = usableRect(window.rect) ?? usableRect(root.rect);
    // Its rect only, whatever its flags (a flagless payload types too) — unlike the module's `onScreen`.
    const onWindow = (e: WdaElement): boolean => screen === undefined || (usableRect(e.rect) !== undefined && rectsOverlap(e.rect!, screen));
    for (const layer of window.children ?? []) {
      for (const [type, kind] of PRESENTATIONS) {
        const element = firstIn(layer, (e) => e.type === type && onWindow(e));
        if (element === undefined) continue;
        layers.set(layer, kind);
        elements.add(element);
        break;
      }
    }
    const shown = carriesFlags(root) ? presentedScreen(window) : undefined;
    if (shown !== undefined && !layers.has(shown)) layers.set(shown, 'screen');
  }
  return { layers, elements };
}

/**
 * The layer of `window` WDA's flags show presented over the screen beneath (`UiNode.presentation` `screen`), or
 * undefined: walking the Window's layers in order, past every one that is not screen-sized (`SCREEN_SIZED_FRACTION`
 * of the Window) or carries no content (no element of a non-structural role below it: a bare dimming leaf, the input
 * host's placeholder), the first that has VISIBLE CONTENT ON THE SCREEN — an element of a non-structural role,
 * `isVisible="1"`, sharing area with the Window — when at least one layer walked past before it has every element
 * `isVisible="0"`; and none when a layer with content is neither wholly invisible nor shown (a beneath only partly
 * `0`, or visible content parked off the screen: a dismissed sheet's leftover).
 *
 * Measured (iPhone 17 simulator, iOS 27.0, WDA): over every raw capture of a page sheet, a SwiftUI half or expanded
 * sheet, an RN transparent modal, an alert and a popover, the screen beneath reads wholly `0` while the presented layer
 * shows; over every capture with nothing presented (a pushed form, Account Detail, Safari with its capsule layer,
 * Settings, a dismissed sheet), the first content layer shows. It reads a whole LAYER's flags and a visible later layer
 * beside it — never one node's flag, never a target's own (a node's `isVisible` alone is no geometric truth: the pushed
 * form's phantom tab bar reads `0` on screen).
 */
function presentedScreen(window: WdaElement): WdaElement | undefined {
  const screen = usableRect(window.rect);
  if (screen === undefined) return undefined;
  const content = (e: WdaElement): boolean => !STRUCTURAL_ROLES.has(iosRoleOf(e.type, ROLE_MAP));
  const shownContent = (e: WdaElement): boolean => content(e) && onScreen(e, screen);
  let beneath = false;
  for (const layer of window.children ?? []) {
    const rect = usableRect(layer.rect);
    if (rect === undefined || rectArea(rect) < rectArea(screen) * SCREEN_SIZED_FRACTION) continue;
    if (!(layer.children ?? []).some((c) => someIn(c, content))) continue;
    if (allIn(layer, (e) => isZero(e.isVisible))) {
      beneath = true;
      continue;
    }
    return beneath && someIn(layer, shownContent) ? layer : undefined;
  }
  return undefined;
}

/**
 * The roots of the HIDDEN SUBTREES (`UiNode.hidden`): an element of NO STRUCTURAL ROLE (`STRUCTURAL_ROLES` over this
 * file's role map — not an `Other`, `Cell`, `Window`, `Application` or unmapped type: a control, an image, a text, a
 * scroll view, a toolbar) that WDA reports `isVisible="0"` and `isAccessible="0"`, every element of whose subtree is
 * `isVisible="0"`. A descendant's `isAccessible` is not consulted.
 *
 * Measured on the iPhone 17 simulator (iOS 27.0, WDA 16.1.7; the raw `/source` captures in
 * tests/fixtures/wda-capture-*.json):
 * - mp-native's SWIFT form pushed over the tab host: the host's hidden tab bar is listed after the form at y 711 —
 *   each `nav.tab_*` Button `0/0`, its icon Image (same rect) `isVisible "0"` but `isAccessible "1"`. So "the whole
 *   subtree `0/0`" — the rule first proposed — matches none of them, and the Image went on covering the rows beneath
 *   it (docs/bugs/2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md). With the root alone
 *   asked for `isAccessible`, the button goes with its Image.
 * - Why every descendant's `isVisible`: Account Detail with the bar SHOWN has the same buttons at y 755 `1/1`, under
 *   a host `Other 0,0 402x874` that is `0/0` in both states with an `isVisible "1"` content child.
 * - Why NO STRUCTURAL ROOT: a wrapper's flags say nothing of what it holds. The SWIFT form's `payee_name_input`
 *   row, `Other 24,801 354x52`, is `0/0` with an all-invisible subtree (truthfully: it lies below its form's
 *   ScrollView, which draws none of it — the standing's drawn frame judges that, ui-tree/geometry.ts#Clips.drawnIn);
 *   as a root it took its label and its text field (each `isAccessible "1"`) with it, and the text field stopped
 *   holding the label's centre for the dismissal picker. The screen beneath a modal is reported the same way: Finportal's login
 *   screen under its RN modal, the Contacts list under the New Contact sheet, the sheet under its discard popover —
 *   whole layers `0/0`, drawn chrome a wrapper root would have dropped wholesale. A control, an image or a text is
 *   one thing on screen; a wrapper is a region whose flags say nothing of what it holds. `isAccessible` on the root
 *   does not tell a drawn node from an undrawn one (the payee row is `0/0`); it only keeps an accessible control from
 *   rooting one.
 *
 * Bottom-up, once per payload, beside `keyboardMarks`: each element's subtree is judged from its children's answers,
 * so no subtree is walked twice. Roots inside a root are collected too; `toUiNode` hands the flag down either way.
 */
function hiddenRoots(root: WdaElement): ReadonlySet<WdaElement> {
  const roots = new Set<WdaElement>();
  /** Is every element of `el`'s subtree `isVisible="0"`? Collects the roots on the way. */
  const invisible = (el: WdaElement): boolean => {
    const children = (el.children ?? []).map(invisible); // every child judged, so roots below a visible one are found too
    const whole = isZero(el.isVisible) && children.every(Boolean);
    if (whole && isZero(el.isAccessible) && !STRUCTURAL_ROLES.has(iosRoleOf(el.type, ROLE_MAP))) roots.add(el);
    return whole;
  };
  invisible(root);
  return roots;
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
