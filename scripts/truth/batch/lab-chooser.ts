import { chooserSheet } from '../../../src/adapters/android-chooser.js';
import { parseUiautomatorXml } from '../../../src/adapters/android.js';
import { everyNode, labelOf, rectCentre, type DrawnOverStrip, type Point, type Rect, type UiNode } from '../../../src/adapters/types.js';
import {
  adbLine,
  checkHand,
  defaultHand,
  entryText,
  focusedAppOf,
  HAND_PREFIX,
  handlersIn,
  handlersUnread,
  isChooser,
  LAB_PACKAGE,
  lastChosenOf,
  leaksOf,
  preferredIn,
  preferredUnread,
  unflaggedOf,
  type HandBase,
  type LabEntry,
  type PreferredRead,
} from '../chooser-readers.js';
// Moved to the leaf module (T20a) and re-exported, so a batch that imports them from here still does.
export {
  adbLine,
  checkHand,
  defaultHand,
  HAND_PREFIX,
  LAB_PACKAGE,
  lastChosenOf,
  leaksOf,
  PREFERRED_ARGV,
  unflaggedOf,
  type HandBase,
  type LabEntry,
  type PreferredRead,
} from '../chooser-readers.js';
import type { CallResult } from './bounded.js';
import { shellQuote } from './shell.js';
import { exitText, failedCall, firstLineOf, messageOf, nameInLine, verdictLine, type Verdict } from './words.js';

/**
 * The lab emulator's "Open with" chooser as values and words, pure (no Run, no file): what lab-emu.ts reads, decides
 * and says around a block that may leave the chooser up or a preferred activity behind (batch-9's D55 to batch-12's
 * E5). The preferred-activities read, only its `Preferred Activities User N:` block (API 33 prints the whole `dumpsys
 * package` for `preferred-activities`: batch-9's INCONCLUSIVE was that); a lab default (`mAlways=true`, a leak) told
 * from the last-chosen entry "Just once" writes (`mAlways=false`, which no reinstall clears: batch-11); --check's exit;
 * safeTap, the one point a batch may tap on the chooser, never "Always"; the reads that can come back unread (the role
 * holder, the clipboard, the install); and every line a batch prints of them.
 *
 * The readers the live golden's chooser premise reads too (T20a) live in ../chooser-readers.ts, a leaf outside the
 * batch layer: the preferred block's parse, the leak rule, the handler count, the default's and the check's hand
 * lines; re-exported here. Here they are wrapped over a CallResult (preferredOf, handlersOf: a failed call is unread).
 *
 * The focus is judged by the harness's own reader (chooser-readers.ts#focusedAppOf and #isChooser, the chooser group's,
 * live-chooser.ts's), never by src's android-chooser.ts#chooserInFocus: a lab check does not judge with the code under
 * test (ADR 0020; TL5, A22). What is src's and no judge is reused, not copied: the read's command
 * (CHOOSER_FOCUS_COMMAND), the tree src's own uiautomator parser's (D66's UiNode.disabled), the fresh sheet
 * android-chooser.ts#chooserSheet's, an adb word's quoting
 * adb-shell.ts#shellQuote's (through chooser-readers.ts#adbLine). A host path in a hand line is quoted by shell.ts, the
 * batches' one host-shell quoter.
 */

/** --check's verdict label (d55-b11.ts's `D55 check:` line). */
export const CHECK_LABEL = 'D55 check';
/** The cleanup's verdict label (batch-11's `D55 cleanup:` line; batch-12 wrote `E5 cleanup:`). */
export const CLEANUP_LABEL = 'D55 cleanup';
/** The browser role holder read (batch-9's d55-probe.ts): API 33 has no such command — unread, never unchanged. */
export const ROLE_HOLDERS_ARGV = ['cmd', 'role', 'get-role-holders', 'android.app.role.BROWSER'] as const;
/** The clipboard read (batch-9's D43 probe asked its help first): API 33 has no shell implementation — unread. */
export const CLIPBOARD_ARGV = ['cmd', 'clipboard', 'help'] as const;
/** How far a given tap point may lie from its target's centre (batch-12's guardRow1: ±2 px). */
export const CENTRE_SLACK_PX = 2;

// --------------------------------------------------------------------------------------- the preferred activities

/**
 * The preferred read (d55-b11.ts's preferredOf): only the `Preferred Activities User N:` block(s), each running to the
 * next top-level line; in a block, each entry is its first line (a hash and a component) and every line after it
 * indented deeper, or blank. A read that failed, or a dump with no such block (API 33's whole dump cut short, another
 * command's output), is unread.
 */
export function preferredOf(r: CallResult): PreferredRead {
  return failedCall(r) ? preferredUnread(exitText(r)) : preferredIn(r.out);
}

/** A last-chosen entry a batch accepts as the lab's known state (batch-12's README), by Authority and component. */
export interface AcceptedEntry {
  authority: string;
  component: RegExp;
  why: string;
}
export const acceptedOf = (e: LabEntry, accepted: readonly AcceptedEntry[]): AcceptedEntry | undefined =>
  accepted.find((a) => a.authority === e.authority && a.component.test(e.component));

// --------------------------------------------------------------------------------------------------- the focus

/** The focus read: the chooser in front (its component) or not (undefined), or unread with why. */
export type FocusRead = { state: 'read'; chooser: string | undefined } | { state: 'unread'; why: string };

/** The chooser a read shows in front; none for one unread (it shows nothing). */
export const chooserOf = (f: FocusRead): string | undefined => (f.state === 'read' ? f.chooser : undefined);

/**
 * CHOOSER_FOCUS_COMMAND's read, judged by the harness's own reader of the focused activity (chooser-readers.ts
 * #focusedAppOf, #isChooser: the chooser group's oracle, not src's chooserInFocus — TL5). Read only when it exited 0
 * and holds an `mFocusedApp=` line, the one that reader decides by: its grep exits 1 when nothing matched, and a read
 * with the focused window alone proves no "no chooser". A line naming no activity (`mFocusedApp=null`) is read: no
 * chooser.
 */
export function focusOf(r: CallResult): FocusRead {
  if (failedCall(r)) return { state: 'unread', why: `the focus read: ${exitText(r)}` };
  if (!r.out.includes('mFocusedApp=')) return { state: 'unread', why: 'the focus read holds no mFocusedApp= line' };
  const focused = focusedAppOf(r.out);
  return { state: 'read', chooser: isChooser(focused) ? focused : undefined };
}

// ---------------------------------------------------------------------------------------------------- --check

/**
 * --check's exits (d55-b11.ts --check, batch-12's final checkExit, in pure-b12.ts): 0 no lab entry, no chooser; 1 a lab
 * default (a leak: "Always" is never tapped, so it predates the batch or is a defect); 3 not proven (a read failed, no
 * Preferred Activities block, or a lab entry with no mAlways line — one that cannot be compared never triggers a
 * reinstall: code review); 4 a chooser in front; 5 only last-chosen entries, every
 * one accepted; 6 a last-chosen entry not accepted (no default — a WARN, never a RESTORE: no reinstall clears it).
 */
export const CHECK_EXIT = { clean: 0, leak: 1, unproven: 3, chooser: 4, accepted: 5, lastChosen: 6 } as const;
export type CheckExit = (typeof CHECK_EXIT)[keyof typeof CHECK_EXIT];

/** The exit, batch-12's order: a leak first, then a chooser in front, then a read not proven, then the last-chosen. */
export function checkExit(focus: FocusRead, preferred: PreferredRead, accepted: readonly AcceptedEntry[]): CheckExit {
  if (preferred.state === 'read' && leaksOf(preferred).length > 0) return CHECK_EXIT.leak;
  if (chooserOf(focus) !== undefined) return CHECK_EXIT.chooser;
  if (focus.state === 'unread' || preferred.state === 'unread' || unflaggedOf(preferred).length > 0) return CHECK_EXIT.unproven;
  const last = lastChosenOf(preferred);
  if (last.length === 0) return CHECK_EXIT.clean;
  return last.every((e) => acceptedOf(e, accepted) !== undefined) ? CHECK_EXIT.accepted : CHECK_EXIT.lastChosen;
}

/**
 * What each exit means, once, for --check's line, the cleanup and the abort's window alike: its verdict word, whether
 * it proves the lab put back (a reinstall too), its words around --check's own, and its hand lines.
 */
export interface CheckOutcome {
  word: Verdict;
  proven: boolean;
  words(why: string): string;
  hand(b: HandBase): string[];
}
const said = (why: string): string => why;
const none = (): string[] => [];
export const CHECK_OUTCOME: Readonly<Record<CheckExit, CheckOutcome>> = {
  0: { word: 'OK', proven: true, words: said, hand: none },
  5: { word: 'OK', proven: true, words: said, hand: none },
  6: {
    word: 'WARN',
    proven: true,
    words: (why) => `a last-chosen entry not accepted (mAlways=false: no default; no reinstall clears it, so none is tried — no RESTORE): ${why}`,
    hand: none,
  },
  1: { word: 'FAIL', proven: false, words: (why) => `a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: ${why}`, hand: (b) => [defaultHand(b)] },
  3: { word: 'ERROR', proven: false, words: (why) => `the preferred activities or the focus not proven clean: ${why}`, hand: (b) => [checkHand(b.serial)] },
  4: { word: 'ERROR', proven: false, words: (why) => `the chooser is still in front after BACK and HOME: ${why}`, hand: (b) => [checkHand(b.serial)] },
};
export const checkWordOf = (exit: CheckExit): Verdict => CHECK_OUTCOME[exit].word;

/** What a focus read says in a line. */
const focusText = (f: FocusRead): string =>
  f.state === 'unread' ? `chooser unread (${f.why})` : f.chooser === undefined ? 'chooser no' : `chooser yes (${f.chooser})`;

/**
 * What --check read, in words: `chooser no|yes (<component>)|unread (<why>); preferred read (<n> user[s]); lab entries
 * <n> (defaults <d>, last-chosen <l>[, accepted <a>])[; first: <its text>]`, or `…; preferred unread (<why>)`.
 */
export function checkWhy(focus: FocusRead, preferred: PreferredRead, accepted: readonly AcceptedEntry[]): string {
  if (preferred.state === 'unread') return `${focusText(focus)}; preferred unread (${preferred.why})`;
  const last = lastChosenOf(preferred);
  const ok = last.filter((e) => acceptedOf(e, accepted) !== undefined).length;
  const unflagged = unflaggedOf(preferred).length;
  const counts = `defaults ${leaksOf(preferred).length}, last-chosen ${last.length}${last.length > 0 ? `, accepted ${ok}` : ''}${unflagged > 0 ? `, no mAlways ${unflagged}` : ''}`;
  const first = preferred.lab.length > 0 ? `; first: ${entryText(preferred.lab[0])}` : '';
  const users = `${preferred.users} user${preferred.users === 1 ? '' : 's'}`;
  return `${focusText(focus)}; preferred read (${users}); lab entries ${preferred.lab.length} (${counts})${first}`;
}

/** --check's line: `D55 check: <its exit's word> — <checkWhy>`. */
export const checkLine = (focus: FocusRead, preferred: PreferredRead, accepted: readonly AcceptedEntry[]): string =>
  verdictLine(CHECK_LABEL, checkWordOf(checkExit(focus, preferred, accepted)), checkWhy(focus, preferred, accepted));

// ------------------------------------------------------------------------------------------- the tri-state reads

/** A shell read: its answer (trimmed of line ends), or unread with why — a command the device lacks is unread. */
export type ShellRead = { state: 'read'; text: string } | { state: 'unread'; why: string };

/**
 * What the device says for a command it has not (batch-9, API 33): `cmd role` `Unknown command: get-role-holders`
 * (exit 255), `cmd clipboard help` `No shell command implementation.` (exit 0). At a line's start only.
 */
const NO_SUCH_COMMAND = /^(?:Unknown command\b.*|No shell command implementation\.)$/m;

export function shellReadOf(r: CallResult): ShellRead {
  if (failedCall(r)) return { state: 'unread', why: exitText(r) };
  const said = NO_SUCH_COMMAND.exec(`${r.out}\n${r.err}`.replace(/\r/g, ''));
  if (said !== null) return { state: 'unread', why: `the device has no such command: ${said[0]}` };
  return { state: 'read', text: r.out.replace(/[\r\n]+$/, '') };
}

/** Two reads of one thing: unchanged (both read, equal), changed, or unread (either read, named) — never unchanged. */
export type ReadCompared = { outcome: 'unchanged'; text: string } | { outcome: 'changed'; before: string; after: string } | { outcome: 'unread'; why: string };

export function compareReads(before: ShellRead, after: ShellRead): ReadCompared {
  if (before.state === 'read' && after.state === 'read') {
    return before.text === after.text ? { outcome: 'unchanged', text: before.text } : { outcome: 'changed', before: before.text, after: after.text };
  }
  const why = [before.state === 'unread' ? `before: ${before.why}` : '', after.state === 'unread' ? `after: ${after.why}` : ''].filter((w) => w !== '');
  return { outcome: 'unread', why: why.join('; ') };
}

/** `<label>: OK — unchanged ("…")`, `ERROR — CHANGED: "…" → "…"`, or `WARN — not compared: <why>` (never OK unread). */
export function comparedLine(label: string, c: ReadCompared): string {
  if (c.outcome === 'unchanged') return verdictLine(label, 'OK', `unchanged (${JSON.stringify(c.text)})`);
  if (c.outcome === 'changed') return verdictLine(label, 'ERROR', `CHANGED: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`);
  return verdictLine(label, 'WARN', `not compared: ${c.why}`);
}

/**
 * `cmd package query-activities --brief -a VIEW -d <url>` counted (batch-11.sh's handlers): the component lines, which
 * must be as many as its `N activities found:` line says (`No activities found` is 0); else why not.
 */
export function handlersOf(r: CallResult): number | { why: string } {
  return failedCall(r) ? handlersUnread(exitText(r)) : handlersIn(r.out);
}

/** Why `adb get-state` says the emulator cannot be asked (not `device`), or undefined when it can. */
export function unreachableOf(getState: CallResult): string | undefined {
  if (failedCall(getState)) return `adb get-state: ${exitText(getState)}`;
  const state = getState.out.trim();
  return state === 'device' ? undefined : `adb get-state: ${nameInLine(state)}, not device`;
}

/** The lab installed (its APK's path on the device), missing, or unknown with why — unreachable is never missing. */
export type Installed = { state: 'installed'; path: string } | { state: 'missing' } | { state: 'unknown'; why: string };

/**
 * `pm path <lab>`, asked only once `adb get-state` said `device` (batch-12.sh's e5_installed; lab-emu.ts#labInstalled
 * asks that first): `package:<path>` with exit 0 installed, exit 1 with nothing said missing, anything else unknown.
 */
export function installedOf(pmPath: CallResult): Installed {
  if (pmPath.timedOut) return { state: 'unknown', why: `pm path: ${exitText(pmPath)}` };
  if (pmPath.code === 1 && `${pmPath.out}${pmPath.err}`.trim() === '') return { state: 'missing' };
  if (failedCall(pmPath)) return { state: 'unknown', why: `pm path: ${exitText(pmPath)}` };
  const path = /^package:(\S+)/m.exec(pmPath.out)?.[1];
  return path === undefined ? { state: 'unknown', why: 'pm path: exit 0 but no package: line' } : { state: 'installed', path };
}

// --------------------------------------------------------------------------------------------------- the tree

/** The bounds as dumped: no node widened under what is drawn over it (src's parser asks; the tap is judged raw). */
export const NOT_JUDGED: DrawnOverStrip = () => () => false;

/** What src's tree drops of a node, read from its own tag: its resource-id, text and content-desc apart, its enabled. */
export interface RawAttrs {
  /** Each as written in the tag; undefined when the tag has none. */
  resourceId: string | undefined;
  text: string | undefined;
  contentDesc: string | undefined;
  /** `true` or `false` as dumped; undefined (no `enabled`) is never taken as enabled. */
  enabled: string | undefined;
}

/** A dump read twice: src's tree for its structure and bounds, and each node's own tag for what src's tree drops. */
export interface Dump {
  root: UiNode;
  attrs(n: UiNode): RawAttrs;
}

/**
 * One attribute of a node's tag as written; undefined when the tag has none. Not entity-decoded: uiautomator writes an
 * entity only for `&`, `<`, `>`, `"` and control characters, none of them in a resource id or in the word "always".
 */
const attrOf = (tag: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/**
 * A `uiautomator dump /dev/tty` output as a Dump: the XML up to its last `>` (uiautomator appends a status line;
 * android.ts#dumpedTree reads it so), parsed by src's parser, and its `<node>` tags read in the same order — src's tree
 * and the tags are both in document order, node for node. A dump whose tags and parsed nodes do not pair up is no
 * tree: nothing could be judged of a node then.
 */
export function treeOf(raw: string): Dump | { why: string } {
  const end = raw.lastIndexOf('>');
  if (end === -1) return { why: `no XML in the dump: ${firstLineOf(raw)}` };
  const xml = raw.slice(0, end + 1);
  let root: UiNode;
  try {
    root = parseUiautomatorXml(xml, NOT_JUDGED);
  } catch (e) {
    return { why: `the dump did not parse: ${firstLineOf(messageOf(e))}` };
  }
  const nodes = [...everyNode(root)];
  // Quote-aware: a `>` inside a quoted value ends no tag (review round 2).
  const tags = [...xml.matchAll(/<node\b(?:[^>"]|"[^"]*")*>/g)].map((m) => m[0]);
  if (tags.length !== nodes.length) return { why: `the dump's ${tags.length} node tags are not the parsed tree's ${nodes.length} nodes` };
  // Paired node for node, or not at all: each tag's resource-id must be its node's identifier (src keeps the last
  // segment, none for an empty or missing id).
  const ids = tags.map((t) => attrOf(t, 'resource-id') ?? '');
  const firstMismatch = nodes.findIndex((n, i) => (ids[i].split('/').pop() || null) !== n.identifier);
  if (firstMismatch !== -1) {
    const at = firstMismatch;
    return { why: `the dump's tags and src's tree disagree at node ${at}: tag resource-id ${JSON.stringify(ids[at])}, tree identifier ${JSON.stringify(nodes[at].identifier)}` };
  }
  const byNode = new Map(nodes.map((n, i) => [n, { resourceId: ids[i], text: attrOf(tags[i], 'text'), contentDesc: attrOf(tags[i], 'content-desc'), enabled: attrOf(tags[i], 'enabled') }]));
  return { root, attrs: (n) => byNode.get(n)! };
}

/** Whether `a` is an ancestor of `n`, by the tree's parent links. */
type IsAbove = (a: UiNode, n: UiNode) => boolean;
function aboveIn(root: UiNode): IsAbove {
  const parent = new Map<UiNode, UiNode>();
  for (const n of everyNode(root)) for (const c of n.children) parent.set(c, n);
  return (a, n) => {
    for (let p = parent.get(n); p !== undefined; p = parent.get(p)) if (p === a) return true;
    return false;
  };
}

/**
 * "Always", each field on its own (src's label shows content-desc before text, so a text "Always" behind another
 * content-desc would hide): its resource-id's last segment `button_always`, whatever its words (a localized one too),
 * or the word "always", any case, in its text or its content-desc. A row of an app named "Always…" is refused too: safe
 * by design, the tap is never needed there.
 */
const ALWAYS_WORD = /\balways\b/i;
// `String`: a field the tag lacks reads "undefined", neither an id nor the word.
export const isAlways = (a: RawAttrs): boolean => /(?:^|\/)button_always$/.test(String(a.resourceId)) || ALWAYS_WORD.test(String(a.text)) || ALWAYS_WORD.test(String(a.contentDesc));

/** Half-open, as pixels are: a rect's far edge is the next node's first pixel. */
const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const rectText = (r: Rect): string => `[${r.x},${r.y} ${r.width}x${r.height}]`;
const pointText = (p: Point): string => `(${p.x}, ${p.y})`;

/** A node as a why names it: its id and its label quoted, either alone, or its role when it has neither. */
function nodeText(n: UiNode): string {
  const label = labelOf(n);
  if (n.identifier === null) return label === undefined ? n.role : JSON.stringify(label);
  return label === undefined ? n.identifier : `${n.identifier} ${JSON.stringify(label)}`;
}

/** What a batch may tap on the chooser: a row, by its label (text1 or text2) or its number from 1; or "Just once". */
export type TapTarget = { row: string } | { row: number } | 'once';
export type TapRefusal = 'no-target' | 'not-unique' | 'no-sheet' | 'always' | 'disabled' | 'enabled-unshown' | 'outside' | 'off-centre' | 'other-node';
/** The one point to tap, or a named refusal with why. */
export type SafeTap = { ok: true; point: Point; why: string } | { ok: false; refusal: TapRefusal; why: string };

const refused = (refusal: TapRefusal, why: string): SafeTap => ({ ok: false, refusal, why });

/** The target's node and how a why names it, or why not. */
function targetOf(nodes: readonly UiNode[], target: TapTarget): { node: UiNode; name: string } | SafeTap {
  if (target === 'once') {
    const once = nodes.filter((n) => n.identifier === 'button_once');
    if (once.length !== 1) return refused(once.length === 0 ? 'no-target' : 'not-unique', `${once.length} nodes with id button_once (need exactly 1)`);
    return { node: once[0], name: `button_once (${JSON.stringify(once[0].label)})` };
  }
  const lists = nodes.filter((n) => n.identifier === 'resolver_list');
  if (lists.length > 1) return refused('not-unique', `${lists.length} resolver_list nodes (need exactly 1)`);
  const rows = lists.length === 1 ? lists[0].children : [];
  // A row's labels: its text1 and text2 (AOSP's resolve_list_item), as chooserSheet reads them.
  const labelsOf = (row: UiNode): string[] => [...everyNode(row)].filter((n) => n.identifier === 'text1' || n.identifier === 'text2').flatMap((n) => labelOf(n) ?? []);
  const named = (i: number): { node: UiNode; name: string } => ({ node: rows[i], name: `row ${i + 1} (${labelsOf(rows[i]).map((l) => JSON.stringify(l)).join(', ')})` });
  if (typeof target.row === 'number') {
    const n = target.row;
    return Number.isInteger(n) && n >= 1 && n <= rows.length ? named(n - 1) : refused('no-target', `no row ${n} in resolver_list (${rows.length} rows)`);
  }
  const label = target.row;
  const hits = rows.flatMap((r, i) => (labelsOf(r).includes(label) ? [i] : []));
  if (hits.length === 0) return refused('no-target', `no row says ${JSON.stringify(label)}`);
  if (hits.length > 1) return refused('not-unique', `${hits.length} rows say ${JSON.stringify(label)} (need exactly 1)`);
  return named(hits[0]);
}

/**
 * The one point a batch may tap on the chooser (d55-b11.ts's safeTap, batch-12's guardRow1 and guardOnce): the target's
 * centre, or `at` when given (a reply's quoted centre) within CENTRE_SLACK_PX of it. Refused, by name: no such target,
 * or more than one; a tree that is not the chooser's fresh sheet (android-chooser.ts#chooserSheet reads none: AOSP's
 * with_default layout, no chooser); a target that reads as "Always" itself; a disabled one ("Just once" until a row is
 * selected: batch-10); a point outside it or off its centre; any "Always" node — by id or text, anywhere — holding the
 * point or overlapping the target; and any other node holding the point that is not the target, inside it, nor above
 * it (a scrim, a sibling laid there). src's tree carries no `clickable`, so "another node" is any node there, which is
 * every clickable one and more: rows are not clickable in uiautomator (batch-10), the list above takes the click.
 */
export function safeTap(dump: Dump, target: TapTarget, at?: Point): SafeTap {
  const tree = dump.root;
  // src's identifier too (review round 2): a tag read wrong cannot hide an id src read.
  const isAlwaysNode = (n: UiNode): boolean => n.identifier === 'button_always' || isAlways(dump.attrs(n));
  const all = [...everyNode(tree)];
  const found = targetOf(all, target);
  if ('ok' in found) return found;
  const { node, name } = found;
  if (chooserSheet(tree) === undefined) return refused('no-sheet', "the tree is not the chooser's fresh sheet (android-chooser.ts#chooserSheet reads none)");
  // The target itself, or a label inside it (a row's text1 or text2).
  if ([...everyNode(node)].some(isAlwaysNode)) return refused('always', `${name} reads as "Always"`);
  if (node.disabled === true) return refused('disabled', `${name} is disabled`);
  // Fail closed: enabled only when the dump says so (d55-b11.ts and pure-b12.ts read `enabled="true"`).
  if (dump.attrs(node).enabled !== 'true') return refused('enabled-unshown', `${name}: the dump does not say it is enabled`);
  const centre = rectCentre(node.rect);
  const point = at ?? centre;
  if (!contains(node.rect, point)) return refused('outside', `the point ${pointText(point)} is outside ${name} ${rectText(node.rect)}`);
  if (Math.abs(point.x - centre.x) > CENTRE_SLACK_PX || Math.abs(point.y - centre.y) > CENTRE_SLACK_PX) {
    return refused('off-centre', `the point ${pointText(point)} is not ${name}'s centre ${pointText(centre)} within ${CENTRE_SLACK_PX} px`);
  }
  // An ancestor "Always" holds the target, so it overlaps it: refused here too.
  const always = all.find((n) => isAlwaysNode(n) && overlaps(n.rect, node.rect));
  if (always !== undefined) {
    return refused('always', contains(always.rect, point) ? `the point ${pointText(point)} is inside "Always" (${nodeText(always)})` : `${name} overlaps "Always" (${nodeText(always)})`);
  }
  const isAbove = aboveIn(tree);
  const other = all.find((n) => n !== node && contains(n.rect, point) && !isAbove(node, n) && !isAbove(n, node));
  if (other !== undefined) return refused('other-node', `the point ${pointText(point)} lands on ${nodeText(other)}, not ${name}`);
  return { ok: true, point, why: `${name} at ${pointText(point)}` };
}

// ------------------------------------------------------------------------------------------------- the fixtures

/** Device paths a captured fixture must not hold (d55-b11.ts's sanitizeFixture), built from parts as the hygiene test's. */
const slash = '/';
const DEVICE_PATHS = ['/data/', '/sdcard', '/storage/', `${slash}Users${slash}`, '/private/', `${slash}tmp${slash}`, 'emulator-'];

/** Whether `text` holds a device path or the serial: each hit once. */
export function sanitizeFixture(text: string, serial: string): { ok: boolean; hits: string[] } {
  const hits = [...DEVICE_PATHS, serial].filter((p) => p !== '' && text.includes(p));
  return { ok: hits.length === 0, hits: [...new Set(hits)] };
}

// ---------------------------------------------------------------------------------------------- the hand lines

/** Interrupted inside the reinstall with adb unreachable: whether the lab is installed is unknown, never "missing". */
export const unknownInstallHand = (b: HandBase): string =>
  `${HAND_PREFIX}whether the lab is installed is unknown (interrupted during its reinstall, adb unreachable): once adb ` +
  `answers, ${adbLine(b.serial, ['get-state'])} (device), then ${adbLine(b.serial, ['shell', 'pm', 'path', LAB_PACKAGE])}; if it ` +
  `prints nothing, ${adbLine(b.serial, ['install', b.apk])}; then: ${b.then}`;

/** The lab proven not installed: install it again. */
export const missingHand = (b: HandBase): string => `${HAND_PREFIX}the lab APK is NOT installed: ${adbLine(b.serial, ['install', b.apk])}; then: ${b.then}`;

/** The installed lab not proven the pulled APK (a pull, an unzip, or its cells.json differing): the proof by hand. */
export const cellsHand = (b: HandBase, catalog: string, why: string): string =>
  `${HAND_PREFIX}the installed lab not proven the pulled APK (${why}): ${adbLine(b.serial, ['shell', 'pm', 'path', LAB_PACKAGE])}, ` +
  `${adbLine(b.serial, ['pull'])} <that path> <a file>, unzip -p <that file> assets/cells.json must equal ${shellQuote(catalog)}; if not, ` +
  `${adbLine(b.serial, ['uninstall', LAB_PACKAGE])} && ${adbLine(b.serial, ['install', b.apk])}; then: ${b.then}`;

/**
 * No reinstall was done: the probe's state file was not marked dirty (review round 4: a `--restore` with no state does
 * nothing, so the line names the probe's `--state` run — its command when the batch gives one).
 */
export const stateFileHand = (b: HandBase, stateFile: string, why: string, stateCommand?: string): string =>
  `${HAND_PREFIX}no reinstall was done: the probe's state file ${shellQuote(stateFile)} was not marked dirty (${why}); run ` +
  `${stateCommand ?? "the probe's --state"} first, then clear the default by hand: ${adbLine(b.serial, ['uninstall', LAB_PACKAGE])} && ${adbLine(b.serial, ['install', b.apk])}`;

/** The probe's state not put back, its restore failing with no hand line of its own: its command. */
export const stateHand = (command: string): string => `${HAND_PREFIX}the lab's state not put back: ${command}`;
