import { everyNode, type Point, type Rect, type SystemAlert, type UiNode } from './types.js';

/**
 * iOS's system alert in a tree — "Open in “AveriLab”?", raised over SpringBoard when a link to an app's own scheme
 * finds that app not in front — read from either source's answer, with no device call (D54, D49b; ADR 0032's D54
 * amendment). Pure functions over what each source already read, returning the alert's title and its buttons with
 * their centres (SystemAlert), or undefined: on idb a shape (alertShapeInIdb) and a title gate (titleAsksToOpen) —
 * apart, because the source has the elements and the foreground wait has the app's names; on WDA alertInWda.
 *
 * The device facts (batch-5 D49A, 2026-11-02, main 28c1d37d, lab simulator iPhone 17, iOS 27.0; the alert raised
 * over SpringBoard, over Contacts and on a cold start, under both sources):
 * - idb's `describe-all` lists the alert ALONE: SpringBoard's Application (labelled with a single space), a StaticText
 *   "Open in “AveriLab”?" and the Buttons Cancel and Open — no status bar, no icon, no element of the app beneath, no
 *   AXUniqueId, no Alert type. So idb's alert is a shape: SpringBoard listing nothing but text and one to four
 *   buttons, its first text the title. The shape alone would also pass another SpringBoard prompt, so the title must
 *   contain one of the app's names (the language-neutral test: iOS localises the words and the quotes, „AveriLab“ in
 *   German) or read as the measured English form.
 * - WDA's `/source` holds a typed `Alert` (Application › Window › Other › Alert, its label the title), which the
 *   parser already marks: its layer `presentation: 'alert'`, the Alert itself `presentationElement`
 *   (wda-source.ts#PRESENTATIONS) — averi's own marks, not keys of WDA's payload. Its buttons are the Buttons inside
 *   that layer; Contacts' hidden "Return to AveriLab" breadcrumb, a Button of the status bar in the app-switcher card
 *   beneath, is outside it.
 * - Both: the tree is SpringBoard's (idb's Application, WDA's root labelled `' '`; WDA's `/wda/activeAppInfo` named
 *   `com.apple.springboard`). An app's own alert, an app's "Cancel" or "Open in Maps", is never in SpringBoard's tree.
 *
 * What is not done here: deciding which button opens the link. Labels are localised and quoted as they are; the
 * reply lists every button with its centre (mcp/tool-text.ts#deepLinkText) and averi taps none of them.
 *
 * The words an alert is quoted in (D56; ADR 0032's D56 amendment), one wording for both replies that name it —
 * open_deep_link's (mcp/tool-text.ts#deepLinkText) and launch_app's ⚠ note (ios-foreground.ts): alertButtons and
 * ANSWER_ALERT.
 */

/** SpringBoard's Application label in both sources: a single space (2026-10-09, and batch-5 D49A). */
const SPRINGBOARD_LABEL = ' ';

/** The measured English title (batch-5 D49A): `Open in “<App>”?`, with iOS's curly quotes. */
const OPEN_IN = /^Open in “.+”\?$/;

/** idb's alert has at most this many buttons (two measured; four leaves room for a longer system prompt). */
const MAX_IDB_BUTTONS = 4;

/** The fields of an idb `describe-all` element the idb detector reads (ios-tree-source.ts's IdbElement has them all). */
export interface IdbAlertElement {
  type?: string;
  AXLabel?: string | null;
  AXUniqueId?: string | null;
  frame?: Rect;
}

/**
 * The SHAPE of idb's alert, no names asked: the first Application is SpringBoard's, every other element is a
 * StaticText or a Button, the first StaticText (the title) is labelled, and there are one to MAX_IDB_BUTTONS Buttons,
 * each labelled and framed. What passes is a candidate: an alert only when titleAsksToOpen passes its title too
 * (ios-foreground.ts). Anything else is undefined.
 */
export function alertShapeInIdb(elements: readonly IdbAlertElement[]): SystemAlert | undefined {
  const app = elements.find((e) => e.type === 'Application');
  if (app?.AXLabel !== SPRINGBOARD_LABEL) return undefined;
  const rest = elements.filter((e) => e !== app);
  if (!rest.every((e) => e.type === 'StaticText' || e.type === 'Button')) return undefined;
  const title = rest.find((e) => e.type === 'StaticText')?.AXLabel;
  if (typeof title !== 'string' || title === '') return undefined;
  const buttons = rest.filter((e) => e.type === 'Button');
  if (buttons.length === 0 || buttons.length > MAX_IDB_BUTTONS) return undefined;
  const listed: SystemAlert['buttons'][number][] = [];
  for (const b of buttons) {
    if (typeof b.AXLabel !== 'string' || b.AXLabel === '' || b.frame === undefined) return undefined;
    listed.push({ label: b.AXLabel, centre: centreOf(b.frame) });
  }
  return { title, buttons: listed };
}

/**
 * idb's title gate: whether an alert-shaped title reads as iOS asking to open a link in an app — one of `appNames` in
 * it, or the measured English `Open in “…”?` (for any app: the form is iOS's own words).
 */
export function titleAsksToOpen(title: string, appNames: readonly string[]): boolean {
  return namesApp(title, appNames) || OPEN_IN.test(title);
}

/**
 * WDA's alert: in SpringBoard's tree (its root labelled `' '`), the first layer the parser marked `alert` that holds a
 * title and a button — an app-switcher card can hold a hidden one before it; its title the Alert element's label,
 * else the layer's first labelled text; its buttons every labelled Button inside the layer that is not hidden, in tree
 * order. No such layer is no alert.
 */
export function alertInWda(tree: UiNode): SystemAlert | undefined {
  if (tree.label !== SPRINGBOARD_LABEL) return undefined;
  for (const layer of everyNode(tree)) {
    if (layer.presentation !== 'alert') continue;
    const alert = alertOfLayer(layer);
    if (alert !== undefined) return alert;
  }
  return undefined;
}

/** One `alert` layer's title and visible labelled buttons, or undefined when it lacks either. */
function alertOfLayer(layer: UiNode): SystemAlert | undefined {
  const inside = [...everyNode(layer)];
  const title = labelOf(inside.find((n) => n.presentationElement === true)) ?? labelOf(inside.find((n) => n.role === 'text' && labelOf(n) !== undefined));
  if (title === undefined) return undefined;
  const buttons = inside.filter((n) => n.role === 'button' && n.hidden !== true && labelOf(n) !== undefined).map((b) => ({ label: b.label!, centre: centreOf(b.rect) }));
  return buttons.length === 0 ? undefined : { title, buttons };
}

/**
 * Whether `title` contains one of the app's names (blank names never match): the reply's "it asks" (LinkAlert.asksForApp)
 * rests on this — the English form alone is not enough, since its quoted name may be another app's.
 */
export function namesApp(title: string, appNames: readonly string[]): boolean {
  return appNames.some((name) => name.trim() !== '' && title.includes(name));
}

/**
 * An alert's buttons as the replies quote them: `buttons "Cancel" at (127, 474), "Open" at (275, 474)` — every label
 * verbatim, in tree order, with its centre.
 */
export const alertButtons = (alert: SystemAlert): string =>
  `${alert.buttons.length === 1 ? 'button' : 'buttons'} ${alert.buttons.map((b) => `"${b.label}" at (${b.centre.x}, ${b.centre.y})`).join(', ')}`;

/**
 * The advice after an alert's buttons: a tap at the chosen button's coordinates — the one answer proven on a device
 * (batch-5 D49A tapped by coordinates; a selector tap on SpringBoard's tree is unverified) — that averi taps nothing,
 * and what the alert holds back (batch-2: every launch after it stayed behind it).
 */
export const ANSWER_ALERT =
  "Answer it with a tap at the chosen button's x and y (averi taps nothing itself); every launch stays behind the alert until it is answered";

/** A rect's centre in whole points — where a tap lands. */
const centreOf = (r: Rect): Point => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/** A non-empty label, or undefined. */
const labelOf = (n: UiNode | undefined): string | undefined => (n?.label !== null && n?.label !== undefined && n.label !== '' ? n.label : undefined);
