import { chooserInFocus, chooserSheet } from '../../../src/adapters/android-chooser.js';
import { parseUiautomatorXml } from '../../../src/adapters/android.js';
import { shellQuote } from '../../../src/adapters/adb-shell.js';
import { labelOf, rectCentre, type DrawnOverStrip, type Point, type Rect, type UiNode } from '../../../src/adapters/types.js';
import { LAB_APP } from '../lab-device.js';
import type { CallResult } from './bounded.js';
import { exitText, firstLineOf, messageOf, nameInLine, verdictLine, type Verdict } from './words.js';

/**
 * The lab emulator's "Open with" chooser as values and words, pure (no Run, no file): what lab-emu.ts reads, decides and
 * says around a block that may leave the chooser up or a preferred activity behind (batch-9's D55 to batch-12's E5).
 * The preferred-activities read, only its `Preferred Activities User N:` block (API 33 prints the whole `dumpsys
 * package` for `preferred-activities`: batch-9's INCONCLUSIVE was that); a lab default (`mAlways=true`, a leak) told
 * from the last-chosen entry "Just once" writes (`mAlways=false`, which no reinstall clears: batch-11); --check's exit;
 * safeTap, the one point a batch may tap on the chooser, never "Always"; the reads that can come back unread (the role
 * holder, the clipboard, the install); and every line a batch prints of them.
 *
 * What is src's is reused, not copied: the focus is android-chooser.ts#chooserInFocus's, the tree src's own uiautomator
 * parser's (D66's UiNode.disabled), the fresh sheet android-chooser.ts#chooserSheet's, a hand line's quoting
 * adb-shell.ts#shellQuote's.
 */

/** The lab app's package (lab-device.ts#LAB_APP's native app): the one the preferred read, the install and --check ask. */
export const LAB_PACKAGE = LAB_APP.native.package;

/** --check's verdict label (d55-b11.ts's `D55 check:` line). */
export const CHECK_LABEL = 'D55 check';
/** The cleanup's verdict label (batch-11's `D55 cleanup:` line; batch-12 wrote `E5 cleanup:`). */
export const CLEANUP_LABEL = 'D55 cleanup';
/** A RESTORE line's start (batch-11's `D55 (Android): …`). */
export const HAND_PREFIX = 'D55 (Android): ';

/** The preferred read: `dumpsys package preferred` (batch-10's and batch-11's; batch-9's `preferred-activities` reads alike). */
export const PREFERRED_ARGV = ['dumpsys', 'package', 'preferred'] as const;
/** The browser role holder read (batch-9's d55-probe.ts): API 33 has no such command — unread, never unchanged. */
export const ROLE_HOLDERS_ARGV = ['cmd', 'role', 'get-role-holders', 'android.app.role.BROWSER'] as const;
/** How far a given tap point may lie from its target's centre (batch-12's guardRow1: ±2 px). */
export const CENTRE_SLACK_PX = 2;

// --------------------------------------------------------------------------------------- the preferred activities

/** One lab entry of the block: its lines joined, its component, its mAlways (none: no such line), its Authority. */
export interface LabEntry {
  text: string;
  component: string;
  always: boolean | undefined;
  authority?: string;
}

/** The block read — every user's, each lab entry in it — or unread, with why: never "no lab entry" unshown. */
export type PreferredRead = { state: 'read'; users: number; lab: LabEntry[] } | { state: 'unread'; why: string };

const BLOCK_HEADER = /^Preferred Activities User \d+:\s*$/;
/** An entry's first line: its hash and component (`eb6cdf5 com.google.android.gm/.ComposeActivityGmailExternal`). */
const ENTRY_LINE = /^(\s+)[0-9a-f]+ ([\w.$]+\/[\w.$]+)\s*$/;
const indentOf = (line: string): number => line.length - line.trimStart().length;

/** Whether an entry names the lab: its component is the lab app's, or it answers the lab's scheme. */
const isLab = (component: string, lines: readonly string[]): boolean =>
  component.startsWith(`${LAB_PACKAGE}/`) || lines.some((l) => l.trim() === 'Scheme: "averilab"');

/** The lab entries of one block's lines: each entry its first line and every line indented deeper (or blank) after it. */
function labEntriesOf(block: readonly string[]): LabEntry[] {
  const lab: LabEntry[] = [];
  for (let j = 0; j < block.length; j++) {
    const m = ENTRY_LINE.exec(block[j]);
    if (m === null) continue;
    const entry = [block[j]];
    for (let k = j + 1; k < block.length && (block[k].trim() === '' || indentOf(block[k]) > m[1].length); k++) entry.push(block[k]);
    if (!isLab(m[2], entry)) continue;
    const text = entry
      .map((l) => l.trim())
      .filter((l) => l !== '')
      .join(' | ');
    // mAlways on the entry's own first line after it (`mMatch=0x300000 mAlways=false`) only, never further down.
    const flag = /\bmAlways=(true|false)\b/.exec(entry.slice(1).find((l) => l.trim() !== '') ?? '')?.[1];
    const authority = /Authority: "([^"]+)"/.exec(text)?.[1];
    lab.push({ text, component: m[2], always: flag === undefined ? undefined : flag === 'true', ...(authority !== undefined && { authority }) });
  }
  return lab;
}

/**
 * The preferred read (d55-b11.ts#preferredOf): only the `Preferred Activities User N:` block(s), each running to the
 * next top-level line. A read that failed, or a dump with no such block (API 33's whole dump cut short, another
 * command's output), is unread.
 */
export function preferredOf(r: CallResult): PreferredRead {
  if (r.code !== 0 || r.timedOut) return { state: 'unread', why: `${PREFERRED_ARGV.join(' ')}: ${exitText(r)}` };
  const lines = r.out.replace(/\r/g, '').split('\n');
  let users = 0;
  const lab: LabEntry[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!BLOCK_HEADER.test(lines[i])) continue;
    users++;
    const block: string[] = [];
    for (i++; i < lines.length && !/^\S/.test(lines[i]); i++) block.push(lines[i]);
    i--;
    lab.push(...labEntriesOf(block));
  }
  return users === 0 ? { state: 'unread', why: 'no `Preferred Activities User N:` block in the dump' } : { state: 'read', users, lab };
}

/** The leaks: a lab default (`mAlways=true`), or an entry with no mAlways line — never assumed harmless. */
export const leaksOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always !== false);
/** The last-chosen entries "Just once" writes (`mAlways=false`): no default; AOSP 13's uninstall does not clear them. */
export const lastChosenOf = (p: { lab: readonly LabEntry[] }): LabEntry[] => p.lab.filter((e) => e.always === false);

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

/**
 * CHOOSER_FOCUS_COMMAND's read, judged by android-chooser.ts#chooserInFocus. Read only when it exited 0 and holds a
 * focus line: its grep exits 1 when nothing matched, which proves no "no chooser".
 */
export function focusOf(r: CallResult): FocusRead {
  if (r.code !== 0 || r.timedOut) return { state: 'unread', why: `the focus read: ${exitText(r)}` };
  if (!/mCurrentFocus=|mFocusedApp=/.test(r.out)) return { state: 'unread', why: 'the focus read holds no mCurrentFocus= or mFocusedApp= line' };
  return { state: 'read', chooser: chooserInFocus(r.out) };
}

// ---------------------------------------------------------------------------------------------------- --check

/**
 * --check's exits (d55-b11.ts --check, batch-12's final pure-b12.ts#checkExit): 0 no lab entry, no chooser; 1 a lab
 * default or an entry with no mAlways line (a leak: "Always" is never tapped, so it predates the batch or is a defect);
 * 3 not proven (a read failed, no Preferred Activities block); 4 a chooser in front; 5 only last-chosen entries, every
 * one accepted; 6 a last-chosen entry not accepted (no default — a WARN, never a RESTORE: no reinstall clears it).
 */
export const CHECK_EXIT = { clean: 0, leak: 1, unproven: 3, chooser: 4, accepted: 5, lastChosen: 6 } as const;
export type CheckExit = (typeof CHECK_EXIT)[keyof typeof CHECK_EXIT];

/** The exit, batch-12's order: a leak first, then a chooser in front, then a read not proven, then the last-chosen. */
export function checkExit(focus: FocusRead, preferred: PreferredRead, accepted: readonly AcceptedEntry[]): CheckExit {
  if (preferred.state === 'read' && leaksOf(preferred).length > 0) return CHECK_EXIT.leak;
  if (focus.state === 'read' && focus.chooser !== undefined) return CHECK_EXIT.chooser;
  if (focus.state === 'unread' || preferred.state === 'unread') return CHECK_EXIT.unproven;
  const last = lastChosenOf(preferred);
  if (last.length === 0) return CHECK_EXIT.clean;
  return last.every((e) => acceptedOf(e, accepted) !== undefined) ? CHECK_EXIT.accepted : CHECK_EXIT.lastChosen;
}

/** Each exit's word: clean and accepted OK, another last-chosen WARN, a default FAIL, the rest ERROR. */
const CHECK_WORD: Readonly<Record<CheckExit, Verdict>> = { 0: 'OK', 1: 'FAIL', 3: 'ERROR', 4: 'ERROR', 5: 'OK', 6: 'WARN' };
export const checkWordOf = (exit: CheckExit): Verdict => CHECK_WORD[exit];

/** How much of an entry's text a line quotes, before `…`. */
const ENTRY_CHARS = 200;
const cut = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s);

/** What a focus read says in a line. */
const focusText = (f: FocusRead): string =>
  f.state === 'unread' ? `chooser unread (${f.why})` : f.chooser === undefined ? 'chooser no' : `chooser yes (${f.chooser})`;

/**
 * --check's line: `D55 check: <word> — chooser no|yes (<component>)|unread (<why>); preferred read (<n> user[s]); lab
 * entries <n> (defaults <d>, last-chosen <l>[, accepted <a>])[; first: <its text>]` or `preferred unread (<why>)`.
 */
export function checkLine(focus: FocusRead, preferred: PreferredRead, accepted: readonly AcceptedEntry[]): string {
  const word = checkWordOf(checkExit(focus, preferred, accepted));
  if (preferred.state === 'unread') return verdictLine(CHECK_LABEL, word, `${focusText(focus)}; preferred unread (${preferred.why})`);
  const last = lastChosenOf(preferred);
  const ok = last.filter((e) => acceptedOf(e, accepted) !== undefined).length;
  const counts = `defaults ${leaksOf(preferred).length}, last-chosen ${last.length}${last.length > 0 ? `, accepted ${ok}` : ''}`;
  const first = preferred.lab.length > 0 ? `; first: ${cut(preferred.lab[0].text, ENTRY_CHARS)}` : '';
  const users = `${preferred.users} user${preferred.users === 1 ? '' : 's'}`;
  return verdictLine(CHECK_LABEL, word, `${focusText(focus)}; preferred read (${users}); lab entries ${preferred.lab.length} (${counts})${first}`);
}

// ------------------------------------------------------------------------------------------- the tri-state reads

/** A shell read: its answer (trimmed of line ends), or unread with why — a command the device lacks is unread. */
export type ShellRead = { state: 'read'; text: string } | { state: 'unread'; why: string };

/**
 * What the device says for a command it has not (batch-9, API 33): `cmd role` `Unknown command: get-role-holders`
 * (exit 255), `cmd clipboard help` `No shell command implementation.` (exit 0). At a line's start only.
 */
const NO_SUCH_COMMAND = /^(?:Unknown command\b.*|No shell command implementation\.)$/m;

export function shellReadOf(r: CallResult): ShellRead {
  if (r.code !== 0 || r.timedOut) return { state: 'unread', why: exitText(r) };
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
 * `cmd package query-activities --brief -a VIEW -d <url>` counted (batch-11.sh#handlers): the component lines, which
 * must be as many as its `N activities found:` line says (`No activities found` is 0); else why not.
 */
export function handlersOf(r: CallResult): number | { why: string } {
  if (r.code !== 0 || r.timedOut) return { why: `query-activities: ${exitText(r)}` };
  const out = r.out.replace(/\r/g, '');
  if (/^No activities found\s*$/m.test(out)) return 0;
  const said = /^(\d+) activit(?:y|ies) found:\s*$/m.exec(out);
  if (said === null) return { why: `query-activities printed no \`N activities found:\` line: ${firstLineOf(out)}` };
  const listed = out.split('\n').filter((l) => /^\s*[\w.]+\/[\w.$]+\s*$/.test(l)).length;
  return listed === Number(said[1]) ? listed : { why: `query-activities said ${said[1]} activities but listed ${listed}` };
}

/** The lab installed (its APK's path on the device), missing, or unknown with why — unreachable is never missing. */
export type Installed = { state: 'installed'; path: string } | { state: 'missing' } | { state: 'unknown'; why: string };

/**
 * `adb get-state` first, then `pm path <lab>` (batch-12.sh#e5_installed): get-state not `device` is unknown; then
 * `package:<path>` with exit 0 installed, exit 1 with nothing said missing, anything else unknown.
 */
export function installedOf(getState: CallResult, pmPath?: CallResult): Installed {
  if (getState.code !== 0 || getState.timedOut) return { state: 'unknown', why: `adb get-state: ${exitText(getState)}` };
  const state = getState.out.trim();
  if (state !== 'device') return { state: 'unknown', why: `adb get-state: ${nameInLine(state)}, not device` };
  if (pmPath === undefined) return { state: 'unknown', why: 'pm path was not read' };
  if (pmPath.timedOut) return { state: 'unknown', why: `pm path: ${exitText(pmPath)}` };
  if (pmPath.code === 1 && `${pmPath.out}${pmPath.err}`.trim() === '') return { state: 'missing' };
  if (pmPath.code !== 0) return { state: 'unknown', why: `pm path: ${exitText(pmPath)}` };
  const path = /^package:(\S+)/m.exec(pmPath.out)?.[1];
  return path === undefined ? { state: 'unknown', why: 'pm path: exit 0 but no package: line' } : { state: 'installed', path };
}

// --------------------------------------------------------------------------------------------------- the tree

/** The bounds as dumped: no node widened under what is drawn over it (src's parser asks; the tap is judged raw). */
export const NOT_JUDGED: DrawnOverStrip = () => () => false;

/**
 * A `uiautomator dump /dev/tty` output as src's tree: the XML up to its last `>` (uiautomator appends a status line;
 * android.ts#dumpedTree reads it so), parsed by src's parser — or why not.
 */
export function treeOf(raw: string): UiNode | { why: string } {
  const end = raw.lastIndexOf('>');
  if (end === -1) return { why: `no XML in the dump: ${firstLineOf(raw)}` };
  try {
    return parseUiautomatorXml(raw.slice(0, end + 1), NOT_JUDGED);
  } catch (e) {
    return { why: `the dump did not parse: ${firstLineOf(messageOf(e))}` };
  }
}

/** Every node of the tree, each with its ancestors (nearest first). */
function withAncestors(root: UiNode): { node: UiNode; up: UiNode[] }[] {
  const out: { node: UiNode; up: UiNode[] }[] = [];
  const walk = (node: UiNode, up: UiNode[]): void => {
    out.push({ node, up });
    for (const c of node.children) walk(c, [node, ...up]);
  };
  walk(root, []);
  return out;
}

/** "Always", by its id (`button_always`, a localized label too) or by the word in its label (any case). */
export const isAlways = (n: UiNode): boolean => n.identifier === 'button_always' || /\balways\b/i.test(n.label ?? '');

/** Half-open, as pixels are: a rect's far edge is the next node's first pixel. */
const contains = (r: Rect, p: Point): boolean => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const rectText = (r: Rect): string => `[${r.x},${r.y} ${r.width}x${r.height}]`;
const pointText = (p: Point): string => `(${p.x}, ${p.y})`;
/** A node as a why names it: its id, then its label. */
const nodeText = (n: UiNode): string => [n.identifier, labelOf(n) === undefined ? undefined : `"${labelOf(n)}"`].filter((s) => s !== undefined && s !== null).join(' ');

/** What a batch may tap on the chooser: a row, by its label (text1 or text2) or its number from 1; or "Just once". */
export type TapTarget = { row: string } | { row: number } | 'once';
export type TapRefusal = 'no-target' | 'not-unique' | 'no-sheet' | 'always' | 'disabled' | 'outside' | 'off-centre' | 'other-node';
/** The one point to tap, or a named refusal with why. */
export type SafeTap = { ok: true; point: Point; why: string } | { ok: false; refusal: TapRefusal; why: string };

const refused = (refusal: TapRefusal, why: string): SafeTap => ({ ok: false, refusal, why });

/** The target's node and how a why names it, or why not. */
function targetOf(nodes: readonly UiNode[], target: TapTarget): { node: UiNode; name: string } | SafeTap {
  if (target === 'once') {
    const once = nodes.filter((n) => n.identifier === 'button_once');
    if (once.length !== 1) return refused(once.length === 0 ? 'no-target' : 'not-unique', `${once.length} nodes with id button_once (need exactly 1)`);
    return { node: once[0], name: `button_once (${JSON.stringify(once[0].label ?? '')})` };
  }
  const lists = nodes.filter((n) => n.identifier === 'resolver_list');
  const rows = lists.length === 1 ? lists[0].children : [];
  const labelsOf = (row: UiNode): string[] =>
    withAncestors(row)
      .map((x) => x.node)
      .filter((n) => n.identifier === 'text1' || n.identifier === 'text2')
      .flatMap((n) => labelOf(n) ?? []);
  const named = (i: number): { node: UiNode; name: string } => ({ node: rows[i], name: `row ${i + 1} (${JSON.stringify(labelsOf(rows[i]).at(-1) ?? '')})` });
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
 * The one point a batch may tap on the chooser (d55-b11.ts#safeTap, batch-12's guardRow1 and guardOnce): the target's
 * centre, or `at` when given (a reply's quoted centre) within CENTRE_SLACK_PX of it. Refused, by name: no such target,
 * or more than one; a tree that is not the chooser's fresh sheet (android-chooser.ts#chooserSheet reads none: AOSP's
 * with_default layout, no chooser); a target that reads as "Always" itself; a disabled one ("Just once" until a row is
 * selected: batch-10); a point outside it or off its centre; any "Always" node — by id or text, anywhere — holding the
 * point or overlapping the target; and any other node holding the point that is not the target, inside it, nor above
 * it (a scrim, a sibling laid there). src's tree carries no `clickable`, so "another node" is any node there, which is
 * every clickable one and more: rows are not clickable in uiautomator (batch-10), the list above takes the click.
 */
export function safeTap(tree: UiNode, target: TapTarget, at?: Point): SafeTap {
  const all = withAncestors(tree);
  const found = targetOf(
    all.map((x) => x.node),
    target,
  );
  if ('ok' in found) return found;
  const { node, name } = found;
  if (chooserSheet(tree) === undefined) return refused('no-sheet', "the tree is not the chooser's fresh sheet (android-chooser.ts#chooserSheet reads none)");
  // The target itself, or a label inside it (a row's text1 or text2).
  if (withAncestors(node).some((x) => isAlways(x.node))) return refused('always', `${name} reads as "Always"`);
  if (node.disabled === true) return refused('disabled', `${name} is disabled`);
  const centre = rectCentre(node.rect);
  const point = at ?? centre;
  if (!contains(node.rect, point)) return refused('outside', `the point ${pointText(point)} is outside ${name} ${rectText(node.rect)}`);
  if (Math.abs(point.x - centre.x) > CENTRE_SLACK_PX || Math.abs(point.y - centre.y) > CENTRE_SLACK_PX) {
    return refused('off-centre', `the point ${pointText(point)} is not ${name}'s centre ${pointText(centre)} within ${CENTRE_SLACK_PX} px`);
  }
  const always = all.find((x) => isAlways(x.node) && overlaps(x.node.rect, node.rect))?.node;
  if (always !== undefined) {
    return refused('always', contains(always.rect, point) ? `the point ${pointText(point)} is inside "Always" (${nodeText(always)})` : `${name} overlaps "Always" (${nodeText(always)})`);
  }
  const above = all.find((x) => x.node === node)!.up;
  const other = all.find((x) => contains(x.node.rect, point) && x.node !== node && !x.up.includes(node) && !above.includes(x.node));
  if (other !== undefined) return refused('other-node', `the point ${pointText(point)} lands on ${nodeText(other.node) || other.node.role}, not ${name}`);
  return { ok: true, point, why: `${name} at ${pointText(point)}` };
}

// ------------------------------------------------------------------------------------------------- the fixtures

/** Device paths a captured fixture must not hold (d55-b11.ts#sanitizeFixture), built from parts as the hygiene test's. */
const slash = '/';
const DEVICE_PATHS = ['/data/', '/sdcard', '/storage/', `${slash}Users${slash}`, '/private/', `${slash}tmp${slash}`, 'emulator-'];

/** Whether `text` holds a device path or the serial: each hit once. */
export function sanitizeFixture(text: string, serial: string): { ok: boolean; hits: string[] } {
  const hits = [...DEVICE_PATHS, serial].filter((p) => p !== '' && text.includes(p));
  return { ok: hits.length === 0, hits: [...new Set(hits)] };
}

// ---------------------------------------------------------------------------------------------- the hand lines

/** `adb -s <serial> <words…>`, each word quoted as a shell reads it back (adb-shell.ts#shellQuote). */
export const adbLine = (serial: string, words: readonly string[]): string => ['adb', '-s', serial, ...words].map(shellQuote).join(' ');
