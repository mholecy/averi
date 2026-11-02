import { everyNode, type Point, type Rect, type SystemAlert, type UiNode } from './types.js';

/**
 * iOS's system alert in a tree — "Open in “AveriLab”?", raised over SpringBoard when a link to an app's own scheme
 * finds that app not in front — read from either source's answer, with no device call (D54, D49b; ADR 0032's D54
 * amendment). Two pure detectors, one per source, both returning the alert's title and its buttons with their centres
 * (SystemAlert), or undefined.
 *
 * The device facts (batch-5 D49A, 2026-11-02, main 28c1d37d, lab simulator iPhone 17, iOS 27.0; the alert raised
 * over SpringBoard, over Contacts and on a cold start, under both sources):
 * - idb's `describe-all` lists the alert ALONE: SpringBoard's Application (labelled with a single space), a StaticText
 *   "Open in “AveriLab”?" and the Buttons Cancel and Open — no status bar, no icon, no element of the app beneath, no
 *   AXUniqueId, no Alert type. So idb's alert is a shape: SpringBoard listing nothing but text and one to four
 *   buttons, its first text the title. The shape alone would also pass a bare home screen read as a clock and icons,
 *   so the title must contain one of the app's names (the language-neutral test: iOS localises the words and the
 *   quotes, „AveriLab“ in German) or read as the measured English form.
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
 * idb's alert: the first Application is SpringBoard's, every other element is a StaticText or a Button, there are one
 * to MAX_IDB_BUTTONS Buttons, each labelled and framed, and the first StaticText — the title — names the app
 * (`appNames`) or reads `Open in “…”?`. Anything else is no alert, and the caller says what it said before.
 */
export function alertInIdb(elements: readonly IdbAlertElement[], appNames: readonly string[]): SystemAlert | undefined {
  const app = elements.find((e) => e.type === 'Application');
  if (app?.AXLabel !== SPRINGBOARD_LABEL) return undefined;
  const rest = elements.filter((e) => e !== app);
  if (!rest.every((e) => e.type === 'StaticText' || e.type === 'Button')) return undefined;
  const title = rest.find((e) => e.type === 'StaticText')?.AXLabel;
  if (typeof title !== 'string' || !(namesApp(title, appNames) || OPEN_IN.test(title))) return undefined;
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
 * WDA's alert: in SpringBoard's tree (its root labelled `' '`), the first layer the parser marked `alert`; its title
 * the Alert element's label, else the layer's first labelled text; its buttons every labelled Button inside the layer
 * that is not hidden, in tree order. No title or no such button is no alert.
 */
export function alertInWda(tree: UiNode): SystemAlert | undefined {
  if (tree.label !== SPRINGBOARD_LABEL) return undefined;
  const layer = [...everyNode(tree)].find((n) => n.presentation === 'alert');
  if (layer === undefined) return undefined;
  const inside = [...everyNode(layer)];
  const title = labelOf(inside.find((n) => n.presentationElement === true)) ?? labelOf(inside.find((n) => n.role === 'text' && labelOf(n) !== undefined));
  if (title === undefined) return undefined;
  const buttons = inside.filter((n) => n.role === 'button' && n.hidden !== true && labelOf(n) !== undefined).map((b) => ({ label: b.label!, centre: centreOf(b.rect) }));
  return buttons.length === 0 ? undefined : { title, buttons };
}

/** Whether `title` contains one of the app's names (blank names never match). The reply's "it asks" rests on this. */
export function namesApp(title: string, appNames: readonly string[]): boolean {
  return appNames.some((name) => name.trim() !== '' && title.includes(name));
}

/** A rect's centre in whole points — where a tap lands. */
const centreOf = (r: Rect): Point => ({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });

/** A non-empty label, or undefined. */
const labelOf = (n: UiNode | undefined): string | undefined => (n?.label !== null && n?.label !== undefined && n.label !== '' ? n.label : undefined);
