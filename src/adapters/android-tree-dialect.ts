import { XMLParser } from 'fast-xml-parser';
import { markLocationSorted } from './android-accessibility-order.js';
import { BOUNDS_RE, parseBounds } from './android-bounds.js';
import { everyNode, rectArea, zeroRect, type ClippedSide, type DrawnOverStrip, type Rect, type ScrollAxis, type UiNode } from './types.js';

/**
 * The uiautomator dialect: a `uiautomator dump`'s XML as a normalized tree (types.ts#UiNode), with the marks its source
 * puts on the root — pure, with no device call here (android.ts reads the dump).
 */

/** android.widget.* class (last segment) → normalized role. */
const ROLE_MAP: Record<string, string> = {
  Button: 'button',
  ImageButton: 'button',
  TextView: 'text',
  EditText: 'textfield',
  AutoCompleteTextView: 'textfield',
  ImageView: 'image',
  CheckBox: 'checkbox',
  Switch: 'switch',
  ToggleButton: 'switch',
  RadioButton: 'radiobutton',
  SeekBar: 'slider',
  ProgressBar: 'progress',
  WebView: 'webview',
  RecyclerView: 'scrollable',
  ListView: 'scrollable',
  ScrollView: 'scrollable',
  HorizontalScrollView: 'scrollable',
  ViewPager: 'scrollable',
};

/**
 * The classes whose type fixes the one axis they scroll on (types.ts#UiNode.scrollAxis): the classic views, and a
 * Compose scroller with no collection info, which the accessibility bridge names `ScrollView` for vertical scroll
 * semantics and `HorizontalScrollView` for horizontal (the lab app's `verticalScroll` forms and lists, measured: 12
 * `scrollable="true"` nodes, all `android.widget.ScrollView`). Not here, so unknown: a lazy list or grid
 * (`LazyColumn` dumps as `android.view.View` — the lab's form picker and sticky list), a RecyclerView (either axis;
 * the dump names no orientation), a ViewPager2.
 */
export const AXIS_BY_CLASS: Readonly<Record<string, ScrollAxis>> = {
  ScrollView: 'vertical',
  NestedScrollView: 'vertical',
  ListView: 'vertical',
  GridView: 'vertical',
  HorizontalScrollView: 'horizontal',
  ViewPager: 'horizontal',
};

interface RawNode {
  class?: string;
  'resource-id'?: string;
  text?: string;
  /** Not in the API 33 dump (measured); read when a newer one carries it — see normalizeNode. */
  hint?: string;
  'content-desc'?: string;
  focusable?: string;
  'long-clickable'?: string;
  /** "true" on a node that takes a click — read only for a sheet's scrim (`presentedWindow`). */
  clickable?: string;
  /** "true" on a node that scrolls now — its descendants' bounds are clipped to it (types.ts#UiNode.clipsDescendants). */
  scrollable?: string;
  /** "true"/"false" on every node of the API 33 dump (measured: the lab's form PIN "true") — read on text inputs only (types.ts#UiNode.secure). */
  password?: string;
  /** "true"/"false" on every node of the API 33 dump (measured: the chooser's "Just once" "false") — UiNode.disabled. */
  enabled?: string;
  bounds?: string;
  node?: RawNode | RawNode[];
}

/**
 * A uiautomator dump as a normalized tree. `drawnOverStrip` judges whether a
 * node cut short of its own content lies under something drawn there
 * (`widenUnderCovers`) — the UI-tree layer's draw order, handed in
 * (types.ts#DrawnOverStrip).
 */
export function parseUiautomatorXml(xml: string, drawnOverStrip: DrawnOverStrip): UiNode {
  const parsed = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    // uiautomator writes a newline, a tab and every code point beyond the BMP (an emoji) as a numeric character
    // reference (`&#10;`, `&#127482;`); the parser decodes those with the named ones, once — `&amp;#10;` stays `&#10;`.
    // Here, not after parsing: a second pass could not tell an app's literal `&#10;` from a reference. HTML's named
    // entities (`&nbsp;`, `&copy;` …) decode too — harmless, as uiautomator escapes every `&` it does not mean as one.
    htmlEntities: true,
    // A text input's value keeps its outer spaces, as the app holds them (D72; iOS's reading does too, ios-node.ts):
    // the parser's own trim cut them, so `Jan ` read back `Jan` — a false failure, and with clear a wipe one short per
    // space (`JJan `). `text` and `hint` keep them — a hint is compared with a reading exactly (fill-landing.ts), so an
    // empty field showing `Name ` reads empty. Every other attribute is trimmed as before (`trimOuter`), and a label
    // drawn from `text` is trimmed in normalizeNode: matching through the LABEL is unchanged. The `value` path
    // (`value:`, and `text:`, which asks the value too) sees the field's real text, as on iOS — a flow that matched a
    // trimmed Android value quotes the space (`text:"Jan "`) or uses `~`.
    trimValues: false,
    attributeValueProcessor: (name: string, value: string) => (name === 'text' || name === 'hint' ? value : trimOuter(value)),
    isArray: (name) => name === 'node',
  }).parse(xml);
  const roots: RawNode[] = parsed.hierarchy?.node ?? [];
  if (roots.length === 0) throw new Error('uiautomator dump contained no nodes');
  // An arrow, not `roots.map(normalizeNode)`: map would hand its index in as `around`.
  const grown = new Map<UiNode, Rect>();
  const provided = new Set<UiNode>();
  const children = roots.map((root) => normalizeNode(root, { grown, provided, inProvider: false }));
  // The source's marks: Compose lists a control's touch target as its wrapper (types.ts#UiNode.paddedTouchTargets),
  // the dump lists the active window only (`activeWindowOnly`), and that window, when the dump shows it presented, is
  // marked so (`presentation`, `presentedWindow`), and it cuts a node's bounds at the screen's edge
  // (`boundsCutAtScreen`). Set before the widening: the draw order judging it reads the marks.
  const presented = children.length === 1 ? presentedWindow(roots[0], children[0].rect) : undefined;
  const tree: UiNode =
    children.length === 1
      ? { ...children[0], paddedTouchTargets: true, activeWindowOnly: true, boundsCutAtScreen: true, ...(presented !== undefined && { presentation: presented }) }
      : { role: 'container', label: null, identifier: null, value: null, rect: zeroRect(), children, paddedTouchTargets: true, activeWindowOnly: true, boundsCutAtScreen: true };
  // The one window's root, copied: what the provider rule said of it holds for its copy.
  if (children.length === 1 && provided.has(children[0])) provided.add(tree);
  // Each window's own tree: the root synthesized over several windows is no ViewGroup, its windows in no sorted order.
  for (const window of children.length === 1 ? [tree] : children) markLocationSorted(window, provided);
  widenUnderCovers(tree, grown, drawnOverStrip);
  return tree;
}

/**
 * The PRESENTED WINDOW the dump is, when its one window shows it is one (types.ts#UiNode.presentation on the root):
 * `uiautomator dump` lists the active window only (`UiNode.activeWindowOnly`), so with a dialog or a bottom sheet up
 * the dump IS that window and the screen beneath is not in it. Read here, where the raw dump is — the scrim's
 * `clickable` never reaches the normalized tree — as the WDA parser reads WDA's own flags
 * (wda-source.ts#presentedLayers); the presentation module reads the mark (ui-tree/presentation.ts#byMarks, which
 * answers `alone` of a marked root). The window is asked of each recognizer in `PRESENTED_WINDOWS`, in order; the first that knows it
 * names it.
 * Residuals, stated: a fully expanded Compose sheet dumps no scrim (form-picker's country picker: only the sheet and
 *   its drag handle) and is no presented window here; a floating window against the top or the left edge (a popup at
 *   the top-left corner, a bottom-anchored full-width dialog) and a full-screen dialog (dialog-fullscreen: Compose lays
 *   it between the bars against the left edge, no fact telling it from an app's screen) are none either; an app's own
 *   sheet built without Material's dialog layout is none, nor is Material's `SideSheetDialog` (other ids; unmeasured);
 *   a window offset on both axes that is the app's own — a freeform (desktop-mode) window, a compat-mode app boxed on
 *   both axes — reads as a `dialog`; an app's own clickable, labelled leaf laid from its window's top edge at full
 *   width, with a full-width sibling under it to the bottom, reads as a scrim, and an app's own views it gave
 *   Material's three ids, laid so, as Material's sheet dialog. What a mark changes is asked only for a target the tree
 *   does not hold (presentation.ts#Presentation.topmostAt, #alone), so a misreading costs a refusal, never a false
 *   `Tapped`. The windows the dump has no fact for — the full-screen dialog, the expanded sheet, a window against an
 *   edge — are typed after the read, on a miss, by the window manager's word (`focusedWindow`,
 *   ui-tree/window-mark.ts#markByWindow).
 * docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md
 */
function presentedWindow(window: RawNode, rect: Rect): 'dialog' | 'screen' | undefined {
  if (rectArea(rect) === 0) return undefined;
  return PRESENTED_WINDOWS.find((r) => r.holds(window, rect))?.as;
}

/** One kind of presented window the dump can show: what it is presented as, and whether this window is one. */
interface PresentedWindowRecognizer {
  as: 'dialog' | 'screen';
  /** `window` the dump's one window, raw; `rect` its bounds as normalized, of some area. */
  holds(window: RawNode, rect: Rect): boolean;
}

/**
 * A window that FLOATS OFF THE SCREEN'S EDGES ON BOTH AXES — its left edge past x 0 AND its top edge past y 0 — is a
 * `dialog`. An app's window lies against at least one of the screen's top and left edges: a phone's full-screen window
 * at 0,0 whatever its bars, and also one offset on ONE axis only — a landscape window beside a cutout the app does not
 * draw into, a letterboxed or pillarboxed compat-mode app on a tablet or a foldable, the lower window of a split
 * screen. A dialog laid in the middle floats off both. Measured: the lab's Compose AlertDialog, `[155,851][925,1368]`
 * on 1080x2220 (alert-dim); a touch outside it dismisses it. Why not "smaller than the screen", the round-5 plan: the
 * parser has no screen size — the adapter's `wm size` is memoized as a pending read (viewport-memo.ts), with no answer
 * to peek at before a tree's first read, and awaiting it would add an adb call before the first dump and make the mark
 * depend on which verb read first.
 */
const floatingDialog: PresentedWindowRecognizer = {
  as: 'dialog',
  holds: (_window, rect) => rect.x > 0 && rect.y > 0,
};

/**
 * A full-screen window whose content lays a SCRIM above a SHEET is a `screen`: some node's child that is clickable,
 * labelled and childless, spanning the window's width from its top edge, followed at once by a sibling spanning the
 * width down to the window's bottom edge from no lower than the scrim's bottom. Measured: the lab's half-expanded
 * Material 3 ModalBottomSheet (sheet-medium), its scrim `content-desc="Close sheet"` `[0,0][1080,1110]`, the sheet
 * `[0,1110][1080,2220]`; a stroke inside the sheet drags it to full height. The label is the guard: an unlabelled
 * full-width clickable leaf over a full-width sibling is common app content (a card's touch layer).
 */
const composeSheetScrim: PresentedWindowRecognizer = {
  as: 'screen',
  holds: (window, rect) =>
    someAdjacentPair(window, (_parent, scrim, sheet) => {
      const pair = scrimAndSheet(scrim, sheet);
      if (pair === undefined || emptyToNull(scrim['content-desc']) === null) return false;
      const { s, below } = pair;
      return s.x === rect.x && s.width === rect.width && s.y === rect.y && below.y + below.height === rect.y + rect.height && below.y > s.y && below.y <= s.y + s.height;
    }),
};

/**
 * A Views `BottomSheetDialog` (Material Components' own layout, `design_bottom_sheet_dialog.xml`) is a `screen`: under
 * a `…:id/coordinator`, a clickable, childless `…:id/touch_outside` scrim followed at once by its sibling
 * `…:id/design_bottom_sheet`, the sheet of the scrim's left, width and bottom, its top inside the scrim — at or below
 * the scrim's top (a fully expanded sheet starts where the scrim does; unmeasured). Read by the ids' ENTRIES, never
 * localized (the package is the app's), and against the SCRIM's edges, not the window's: the coordinator fits the
 * system bars. Measured: the lab's sheet over its slots (bottom-sheet-dialog, Material 1.13.0), the window
 * `[0,0][1080,2220]`, `touch_outside` `[0,66][1080,2154]` UNLABELLED (`NAF="true"`), the sheet `[0,1164][1080,2154]`;
 * a touch on the scrim dismisses the sheet. The ids are the guard `composeSheetScrim`'s label is — the scrim rule is
 * not relaxed to unlabelled leaves. A `BottomSheetDialogFragment` lays the same layout (unmeasured).
 * docs/bugs/2026-10-19-lab-android-views-bottom-sheet-dialog-is-no-presented-window-scroll-until-strokes-its-scrim-and-dismisses-it.md
 */
const materialSheetDialog: PresentedWindowRecognizer = {
  as: 'screen',
  holds: (window) =>
    someAdjacentPair(window, (parent, scrim, sheet) => {
      if (idEntry(parent) !== 'coordinator' || idEntry(scrim) !== 'touch_outside' || idEntry(sheet) !== 'design_bottom_sheet') return false;
      const pair = scrimAndSheet(scrim, sheet);
      if (pair === undefined) return false;
      const { s, below } = pair;
      return below.y + below.height === s.y + s.height && below.y >= s.y && below.height > 0;
    }),
};

/**
 * What both sheet recognizers ask of a scrim and the sibling after it, with their bounds: the scrim a clickable,
 * childless node of some height, the sheet as wide as it and at its left (`composeSheetScrim` lays the scrim at the
 * window's width, so its sheet spans the window too). Where the sheet's top and bottom lie is each recognizer's own.
 */
function scrimAndSheet(scrim: RawNode, sheet: RawNode): { s: Rect; below: Rect } | undefined {
  if (scrim.clickable !== 'true' || childrenOf(scrim).length > 0) return undefined;
  const s = parseBounds(scrim.bounds);
  const below = parseBounds(sheet.bounds);
  return s.height > 0 && below.x === s.x && below.width === s.width ? { s, below } : undefined;
}

/** The recognizers `presentedWindow` asks, in order. */
const PRESENTED_WINDOWS: readonly PresentedWindowRecognizer[] = [floatingDialog, composeSheetScrim, materialSheetDialog];

const childrenOf = (n: RawNode): RawNode[] => (n.node === undefined ? [] : Array.isArray(n.node) ? n.node : [n.node]);

/** Whether some node of `root`'s subtree has two children, one followed at once by the other, that `pair` accepts. */
function someAdjacentPair(root: RawNode, pair: (parent: RawNode, first: RawNode, next: RawNode) => boolean): boolean {
  const kids = childrenOf(root);
  return kids.some((kid, i) => i + 1 < kids.length && pair(root, kid, kids[i + 1])) || kids.some((kid) => someAdjacentPair(kid, pair));
}

/** A view id's entry name — `touch_outside` of `com.bank.app:id/touch_outside` — or undefined for no `…:id/…` id. */
function idEntry(n: RawNode): string | undefined {
  const id = n['resource-id'] ?? '';
  const at = id.indexOf(':id/');
  return at < 0 ? undefined : id.slice(at + ':id/'.length);
}

/**
 * Where a node lies in the dump: its parent's rect as normalized, and its
 * nearest clipping ancestor's (`UiNode.clipsDescendants`), when it has them;
 * and the dump's `grown` — each node `uncut` would widen, with the rect,
 * applied by `widenUnderCovers` once the whole tree is read.
 */
interface Around {
  parent?: Rect;
  clip?: Rect;
  grown: Map<UiNode, Rect>;
  /** Whether the node is, or lies under, a node provider's host (`providesNodes`): its children are the provider's. */
  inProvider: boolean;
  /** The dump's nodes whose children a node provider lists, not AOSP's sort (android-accessibility-order.ts#markLocationSorted skips them). */
  provided: Set<UiNode>;
}

/**
 * Whether `raw` hosts a NODE PROVIDER — its children are virtual nodes the provider lists in its own order, not the
 * views AOSP sorts by location (android-accessibility-order.ts): a node of the class `android.view.View` none of whose
 * direct children is of the class `android.view.ViewGroup`. A plain View holds no child views, so any children it lists
 * are virtual: Compose's (AndroidComposeView dumps as `android.view.View`, under a ComposeView on a screen and under a
 * bare ViewGroup in a dialog's window — measured on every Compose capture of the lab, API 33), or an
 * ExploreByTouchHelper's. Everything under it is the provider's too. The class is the accessibility className, which a
 * delegate may set: React Native gives `android.view.View` to a view with some accessibility roles (`toolbar`, `alert`,
 * `header`, `tablist`, … — ReactAccessibilityDelegate.kt), and such a container's children are its real child views,
 * React Native's ViewGroups — a direct `android.view.ViewGroup` child tells it from a provider's host (ADR 0015's
 * residual 5, narrowed by A42a: rn-banner-role). A role container whose children all carry classes other than
 * `android.view.ViewGroup` (each a role, a Text, an Image) still reads as a provider's host, unmarked.
 */
const providesNodes = (raw: RawNode): boolean =>
  raw.class === 'android.view.View' && !childrenOf(raw).some((child) => child.class === 'android.view.ViewGroup');

function normalizeNode(raw: RawNode, around: Around): UiNode {
  const className = raw.class?.split('.').pop() ?? '';
  // The text as the app holds it, outer spaces kept (a text input's value), and as it names the node, trimmed (D72).
  const rawText = emptyToNull(raw.text);
  const text = emptyToNull(raw.text === undefined ? undefined : trimOuter(String(raw.text)));
  const contentDesc = emptyToNull(raw['content-desc']);
  const rawChildren = raw.node === undefined ? [] : Array.isArray(raw.node) ? raw.node : [raw.node];
  // Compose text inputs don't always dump as EditText: a BasicTextField with
  // scroll semantics surfaces as (Horizontal)ScrollView carrying the content
  // in `text` (measured on the login username field — value came back
  // null and fill's clear silently no-oped). A focusable AND long-clickable
  // scroll view is a text input; real scroll containers are neither.
  const composeTextInput =
    (className === 'HorizontalScrollView' || className === 'ScrollView') &&
    raw.focusable === 'true' &&
    raw['long-clickable'] === 'true';
  const isTextInput = className.endsWith('EditText') || composeTextInput;
  const { rect, clippedOut } = nodeBounds(raw.bounds, around.parent);
  const clips = raw.scrollable === 'true';
  const inProvider = around.inProvider || providesNodes(raw);
  const children = rawChildren.map((child) => normalizeNode(child, { ...around, parent: rect, clip: clips ? rect : around.clip, inProvider }));
  const whole = around.clip === undefined ? undefined : uncut(rect, children, around.clip);
  const node: UiNode = {
    role: isTextInput ? 'textfield' : (ROLE_MAP[className] ?? (rawChildren.length > 0 ? 'container' : 'other')),
    label: contentDesc ?? text,
    // resource-id is "com.example.app:id/login_button" — selectors use the short name
    identifier: emptyToNull(raw['resource-id']?.split('/').pop()),
    value: isTextInput ? rawText : null,
    rect,
    children,
    // The one fact the role cannot carry: uiautomator cuts its descendants'
    // bounds to this node, most of them (types.ts#UiNode.clipsDescendants —
    // why a flag and not a `scrollable` role for a Compose scroller).
    ...(clips && { clipsDescendants: true as const }),
    // Dumped inverted: wholly outside its container, on this side (types.ts#UiNode.clippedOut).
    ...(clippedOut !== undefined && { clippedOut }),
    // The axis its class fixes (AXIS_BY_CLASS) — never a text input's, whose class is a scroll view's too.
    ...(!isTextInput && AXIS_BY_CLASS[className] !== undefined && { scrollAxis: AXIS_BY_CLASS[className] }),
    // Not enabled, as the dump says it (types.ts#UiNode.disabled): a missing attribute stays unknown.
    ...(raw.enabled === 'false' && { disabled: true as const }),
  };
  // An EMPTY classic EditText dumps its HINT as `text` — AccessibilityNodeInfo
  // .getText() returns the hint while isShowingHintText() — and the API 33
  // dump has no attribute that says so (measured on the Pixel_3a AVD,
  // Android 13: the Contacts editor's `text="Last name"`, the Settings
  // search's `text="Search settings"`, both empty). A dump that
  // DOES name the hint (newer uiautomator builds, the uiautomator2 server's
  // `hint`) hands it to fill as the node's placeholder (UiNode), read
  // opportunistically: no captured dump carries it yet. Compose placeholders
  // are not dumped as text at all (measured), so need none.
  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md
  const hint = isTextInput ? emptyToNull(raw.hint) : null;
  if (hint !== null) node.placeholder = hint;
  // Masked or not, as the dump says it (types.ts#UiNode.secure) — on a text input only: what a container or a label
  // says of itself is not what the field in it does, and a missing attribute stays unknown.
  if (isTextInput && (raw.password === 'true' || raw.password === 'false')) node.secure = raw.password === 'true';
  if (whole !== undefined) around.grown.set(node, whole);
  if (inProvider) around.provided.add(node);
  return node;
}

/**
 * The node's whole extent when uiautomator cut its bounds short of its own
 * descendants (the bug note below): Compose subtracts what an overlay
 * sibling drawn over a node covers from that node's bounds, and not from
 * its descendants' — mp-native's Account Detail row under its sticky date
 * header (`0,401 1080x79`) dumps as `row_0 66,480 948x66`, its own label
 * and button as `66,403 948x143`, the row's true rect. The cut rect lies
 * whole in the list and clear of the header, so it read "fully visible".
 * Only a CANDIDATE here: `widenUnderCovers` widens it when something is
 * drawn over the strip gained.
 *
 * Only descendants with the node's EXACT x and width count — a row's own
 * label or button, which ARE the row; not a badge or an icon hanging off
 * one side, and not a full-bleed child (a carousel breaking out of a
 * card's padding: counted, it widened the card sideways, and the card's
 * own button no longer spanned it, so its label read covered). And the node grows along y alone, on ONE side: a
 * cut leaves the node's other edge where its descendants' is (row_0's
 * bottom, 546; the rows cut at the tab bar, their tops), while a child
 * overflowing both edges (a touch target, an offset) is no cut. The
 * residual that rule leaves, stated: a node cut
 * at BOTH ends — a tall card between a sticky header and a floating tab
 * bar, dumped `66,480 948x1360` over its own `66,420 948x1480` — is not
 * widened either, and reads whole. Vertical only: every cut measured was a list's row under a bar
 * across it, and no sideways one was seen. The grown rect is cut to the
 * nearest clipping ancestor's, as uiautomator cut the descendants, so a node
 * cut by the list's own edge (or by the display) is not widened past it —
 * the flush probe (interact/flush-check.ts) judges that one —
 * and a node in no clipping container is left as dumped: the overlay cut
 * was measured inside a scroller only. A node with no area (collapsed, or
 * scrolled off) stays so: widening it would make a target of a node the
 * dump says is not shown. Undefined when nothing grows — a control and its
 * padded touch target lie inside their wrapper (measured: wrapper 132,
 * control 110, label 66), so they never widen it.
 * docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md
 */
function uncut(rect: Rect, children: readonly UiNode[], clip: Rect): Rect | undefined {
  if (rectArea(rect) === 0) return undefined;
  const bottom = rect.y + rect.height;
  let [top, low] = [rect.y, bottom];
  for (const child of children) {
    for (const d of everyNode(child)) {
      if (rectArea(d.rect) === 0 || d.rect.x !== rect.x || d.rect.width !== rect.width) continue;
      [top, low] = [Math.min(top, d.rect.y), Math.max(low, d.rect.y + d.rect.height)];
    }
  }
  // What is gained is cut to the clip; what was dumped stays, even past it (a wrapper Compose dumps overhanging its list).
  [top, low] = [Math.min(rect.y, Math.max(top, clip.y)), Math.max(bottom, Math.min(low, clip.y + clip.height))];
  const grewUp = top < rect.y;
  const grewDown = low > bottom;
  if (grewUp === grewDown) return undefined; // nothing gained, or both sides: overflow, not a cut
  return { ...rect, y: top, height: low - top };
}

/**
 * Widen each `grown` node whose gained strip — the part of the grown rect
 * outside the dumped one — something is drawn over, as draw order's target
 * column judges it for that node (`drawnOverStrip`,
 * types.ts#DrawnOverStrip; what draws is ui-tree/draw-order.ts's
 * `NOT_DRAWN`): the
 * overlay that cut it lies there — row_0's sticky header, the floating tab
 * bar over the rows cut at it. A strip nothing draws over is the node's own
 * overflow, and widening it would make the node overlap what it does not.
 * Judged on
 * the dumped rects, every decision before any is applied; the dumped rect
 * is kept as `cutBounds` (types.ts#UiNode.cutBounds, which states the
 * residual: the next row of the same list is drawn over the strip exactly
 * as a sticky header is).
 */
function widenUnderCovers(tree: UiNode, grown: ReadonlyMap<UiNode, Rect>, drawnOverStrip: DrawnOverStrip): void {
  if (grown.size === 0) return;
  const drawnOver = drawnOverStrip(tree);
  const widen = [...grown].filter(([node, whole]) => {
    const strip: Rect =
      whole.y < node.rect.y ? { ...whole, height: node.rect.y - whole.y } : { ...whole, y: node.rect.y + node.rect.height, height: whole.y + whole.height - (node.rect.y + node.rect.height) };
    return drawnOver(node, strip);
  });
  for (const [node, whole] of widen) {
    node.cutBounds = node.rect;
    node.rect = whole;
  }
}

/**
 * A node's bounds as dumped — unless uiautomator dumped them INVERTED, bottom
 * above top or right left of left (the bug note below: Settings'
 * rows scrolled under the collapsing app bar, `text="Apps"
 * bounds="[198,297][324,58]"`, `homepage_title` `[66,66][428,44]`). The
 * node is clipped OUT of its container: one edge is the container's (the
 * clip, 297: the list's top), the other the node's own, already past it
 * (58). Which edge is the clip's is read off the parent, whose rect is cut
 * to the same clip: the edge of the two nearer the parent's same edge —
 * the top to its top, the bottom to its bottom (a tie, and a root, read
 * top or left). Such a node is clamped to zero size AT the clip edge — a
 * node with no area is never a target (interact/resolve.ts), and none
 * other reads a negative side — and the side it lies past is kept as
 * `clippedOut` (types.ts#UiNode.clippedOut), for the scroll and the wait's
 * hint. Both axes are clamped; the vertical side is the one named when
 * both are inverted.
 * docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md
 */
function nodeBounds(bounds: string | undefined, parent: Rect | undefined): { rect: Rect; clippedOut?: ClippedSide } {
  const m = bounds?.match(BOUNDS_RE);
  if (!m) return { rect: zeroRect() };
  const [, l, t, r, b] = m.map(Number);
  const nearer = (a: number, edgeA: number, z: number, edgeZ: number) => Math.abs(z - edgeZ) < Math.abs(a - edgeA);
  const vertical: ClippedSide | undefined = b >= t ? undefined : parent !== undefined && nearer(t, parent.y, b, parent.y + parent.height) ? 'bottom' : 'top';
  const sideways: ClippedSide | undefined = r >= l ? undefined : parent !== undefined && nearer(l, parent.x, r, parent.x + parent.width) ? 'right' : 'left';
  const rect: Rect = {
    x: sideways === 'right' ? r : l,
    y: vertical === 'bottom' ? b : t,
    width: sideways === undefined ? r - l : 0,
    height: vertical === undefined ? b - t : 0,
  };
  const clippedOut = vertical ?? sideways;
  return clippedOut === undefined ? { rect } : { rect, clippedOut };
}

/**
 * An attribute's outer whitespace cut, as fast-xml-parser's `trimValues` cut it before D72 — but after the entities
 * are decoded, where the parser trimmed before: so a newline, a tab or a return, which uiautomator writes only as a
 * reference (`&#10;`, `&#9;`, `&#13;`, never raw), is kept at the edges as it was, and every other whitespace is cut.
 * Exactly as before for uiautomator's output; a space written as a reference at an edge (`&#32;`, `&#160;`), which
 * uiautomator never writes, is cut now where the old trim kept it.
 */
function trimOuter(value: string): string {
  return value.replace(/^[^\S\n\t\r]+|[^\S\n\t\r]+$/g, '');
}

function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : String(value);
}
