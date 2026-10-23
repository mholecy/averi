import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { markIdbDialect, parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { ACTIVE_WINDOW_HINT, missNote, missOf, NO_ID_LISTED, TREE_SOURCE_REMEDY, withMissNote, type Miss } from '../../src/ui-tree/miss.js';
import type { Target } from '../../src/ui-tree/selectors.js';
import { parseDump } from '../helpers/android-dumps.js';
import { node, screen } from '../helpers/fake.js';

// THE decision behind every not-found (ui-tree/miss.ts): why a target is not in the last read, asked with the target,
// in one precedence — a failed read; a match only at 0×0; a layer listed alone; the active window only; idb's dialect
// (a read that lists no identifier at all; an id set on a container is in no idb read) — and its words. Over the lab's captures (tests/fixtures/truth/): the
// iOS twins read by idb and by WDA on the same screen, and the Android dumps.

const IOS = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
const ANDROID = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
/** A lab iOS capture as idb's parser gives it (flat, marked with idb's dialect). */
const idb = (cell: string): UiNode => parseIdbDescribeAll(readFileSync(new URL(`${cell}.idb.json`, IOS), 'utf8'));
/** The same screen as WDA's parser gives it (nested, every container's identifier listed). */
const wda = (cell: string): UiNode => parseWdaSource(readFileSync(new URL(`${cell}.wda.json`, IOS), 'utf8'));
/** A lab Android capture as the adapter parses it (the status line uiautomator appends cut). */
const uiautomator = (cell: string): UiNode => {
  const raw = readFileSync(new URL(`${cell}.xml`, ANDROID), 'utf8');
  return parseDump(raw.slice(0, raw.lastIndexOf('>') + 1));
};

/** A tree with one more node at its root's end. */
const plus = (tree: UiNode, ...more: UiNode[]): UiNode => ({ ...tree, children: [...tree.children, ...more] });
const ghost = (identifier: string, clippedOut?: 'top' | 'bottom'): UiNode =>
  node({ identifier, rect: { x: 0, y: 0, width: 0, height: 0 }, ...(clippedOut !== undefined && { clippedOut }) });

const R = 'id:lab.sheet-long-list.R';
const SHORT_R = 'id:lab.sheet-long-list-short.R';
const idR = (id: string): Miss => ({ of: 'idUnlisted', id });
const noId = (id: string): Miss => ({ of: 'noIdListed', id });
/** A launch-transition read idb gave: its Application root alone, nothing of the app's (ui-tree/bare-tree.ts). */
const bareIdb = (): UiNode => markIdbDialect(node({ role: 'container', identifier: null, label: null, rect: { x: 0, y: 0, width: 402, height: 874 } }));

describe('missOf — (tree, target) → Miss, one table', () => {
  const rows: readonly [what: string, last: { tree?: UiNode; readError?: Error }, target: Target | undefined, miss: Miss][] = [
    // unread outranks everything: the read's error is the story.
    ['a failed read', { tree: idb('sheet-long-list'), readError: new Error('idb gone') }, R, { of: 'unread' }],
    ['no read at all', {}, R, { of: 'unread' }],

    // The idb/WDA twins (the lab's sheet-long-list: a UITableViewController in a sheet, its rows' ids set on each cell's
    // label). idb lists no identifier on any element of the read (every AXUniqueId null) — the miss says that fact; WDA
    // lists the id, so the tree holds it.
    ['idb, a read listing no identifier at all (sheet-long-list)', { tree: idb('sheet-long-list') }, R, noId('lab.sheet-long-list.R')],
    ['WDA, the same id on the same screen: the tree holds it, nothing of idb', { tree: wda('sheet-long-list') }, R, { of: 'none' }],
    ['idb, a read listing no identifier at all (sheet-long-list-short)', { tree: idb('sheet-long-list-short') }, SHORT_R, noId('lab.sheet-long-list-short.R')],
    ['WDA, its twin', { tree: wda('sheet-long-list-short') }, SHORT_R, { of: 'none' }],
    ['WDA, an id in no tree: no dialect fact (WDA lists containers\' ids)', { tree: wda('sheet-long-list') }, 'id:lab.nowhere', { of: 'none' }],
    ['idb, an id the list holds, with area: nothing of idb\'s dialect', { tree: plus(idb('sheet-long-list'), node({ identifier: 'g' })) }, 'id:g', { of: 'none' }],
    ['idb, one identifier listed elsewhere: the id unlisted, not the read\'s fact', { tree: plus(idb('sheet-long-list'), node({ identifier: 'g' })) }, R, idR('lab.sheet-long-list.R')],
    ['idb, a flow\'s spec naming the id alone', { tree: idb('sheet-long-list') }, { id: 'lab.sheet-long-list.R' }, noId('lab.sheet-long-list.R')],
    ['idb, an alert whose buttons carry no identifier (alert-dim)', { tree: idb('alert-dim') }, 'id:lab.alert-dim.A', noId('lab.alert-dim.A')],
    ['idb, a bare launch read: it lists nothing of the app\'s, so its ids say nothing of the screen', { tree: bareIdb() }, R, { of: 'none' }],

    // Only an id ALONE is a statement about the id: the fields AND, and a regex names no one id.
    ['idb, id AND text', { tree: idb('sheet-long-list') }, `${R} text:"Target R"`, { of: 'none' }],
    ['idb, a spec of id AND role', { tree: idb('sheet-long-list') }, { id: 'lab.sheet-long-list.R', role: 'button' }, { of: 'none' }],
    ['idb, a regex id', { tree: idb('sheet-long-list') }, 'id~"lab\\.sheet-long-list\\.R"', { of: 'none' }],
    ['idb, a text', { tree: idb('sheet-long-list') }, 'text:Nope', { of: 'none' }],
    ['idb, no target in hand (an assert)', { tree: idb('sheet-long-list') }, undefined, { of: 'none' }],

    // A layer listed alone outranks idb's dialect: the screen beneath is not in the list at all.
    ['idb, a sheet over the screen (its dismiss region listed)', { tree: idb('sheet-medium') }, 'id:lab.sheet-medium.A', { of: 'presented', layer: { kind: 'screen' }, listed: 'layer' }],
    ['idb, a large sheet with no dismiss region, listing the sheet\'s own ids: idb\'s dialect', { tree: idb('sheet-background') }, 'id:lab.sheet-background.A', idR('lab.sheet-background.A')],

    // Android: the windows uiautomator lists.
    ['uiautomator, a dialog listed alone', { tree: uiautomator('alert-dim') }, 'id:lab.alert-dim.A', { of: 'presented', layer: { kind: 'dialog' }, listed: 'window' }],
    ['uiautomator, a sheet listed alone', { tree: uiautomator('sheet-medium') }, 'id:lab.sheet-medium.A', { of: 'presented', layer: { kind: 'screen' }, listed: 'window' }],
    ['uiautomator, a window it does not mark', { tree: uiautomator('form-picker') }, 'id:lab.form-picker.name', { of: 'activeWindow' }],
    ['uiautomator, a match with area: the tree\'s facts alone', { tree: uiautomator('form-picker') }, 'id:lab.form-picker.country.ST', { of: 'activeWindow' }],

    // A match only at 0×0 says the target IS in the tree: it outranks every fact of what the tree does not list.
    ['uiautomator, matched only clipped out above its scroll container (Settings\' collapsing bar, the lab\'s)', { tree: uiautomator('scroll-collapsing') }, 'id:lab.scroll-collapsing.A', { of: 'zeroArea', clippedOut: ['top'] }],
    ['…clipped out past two sides', { tree: plus(screen(), ghost('g', 'top'), ghost('g', 'bottom')) }, 'id:g', { of: 'zeroArea', clippedOut: ['top', 'bottom'] }],
    ['…one of them not clipped out: no side to name', { tree: plus(screen(), ghost('g', 'top'), ghost('g')) }, 'id:g', { of: 'zeroArea', clippedOut: [] }],
    ['…over a window listed alone', { tree: plus(uiautomator('alert-dim'), ghost('g')) }, 'id:g', { of: 'zeroArea', clippedOut: [] }],
    ['…in idb\'s list, by an id alone', { tree: plus(idb('sheet-long-list'), ghost('g')) }, 'id:g', { of: 'zeroArea', clippedOut: [] }],
    ['…a 0×0 match beside one with area: it is in the tree', { tree: plus(screen(), ghost('g'), node({ identifier: 'g' })) }, 'id:g', { of: 'none' }],
    ['…without the target, never', { tree: plus(screen(), ghost('g')) }, undefined, { of: 'none' }],

    ['a tree that lists every window and marks nothing', { tree: screen() }, 'id:x', { of: 'none' }],
  ];

  it.each(rows)('%s', (_, last, target, miss) => {
    expect(missOf({ ...last, target })).toEqual(miss);
  });
});

describe('missNote — the words, once', () => {
  it('each kind\'s note; nothing for unread or none', () => {
    expect(missNote({ of: 'presented', layer: { kind: 'dialog' }, listed: 'window' })).toBe('a dialog is presented over it, and the tree lists only that window — close it first');
    expect(missNote({ of: 'presented', layer: { kind: 'screen' }, listed: 'layer' })).toBe('a sheet or modal is presented over it, and the tree lists only that layer — close it first');
    expect(missNote({ of: 'presented', layer: { kind: 'dialog', label: 'Delete?' }, listed: 'window' })).toBe('a dialog "Delete?" is presented over it, and the tree lists only that window — close it first');
    expect(missNote({ of: 'activeWindow' })).toBe(ACTIVE_WINDOW_HINT);
    expect(missNote({ of: 'zeroArea', clippedOut: [] })).toBe('it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first');
    expect(missNote({ of: 'zeroArea', clippedOut: ['top'] })).toBe('it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first');
    expect(missNote({ of: 'zeroArea', clippedOut: ['right'] })).toBe('it matched only nodes clipped out right of its scroll container (scrolled past it) — scroll_until it with direction: "right" first');
    expect(missNote({ of: 'zeroArea', clippedOut: ['top', 'bottom'] })).toBe('it matched only nodes clipped out above or below its scroll container — scroll_until it first');
    const reasons =
      'Possible reasons: idb lists nothing beneath the keyboard or a presented sheet, alert or cover, and drops some ids, ' +
      "any set on a container and a UIKit table cell label's among them.";
    expect(missNote({ of: 'idUnlisted', id: 'amount_input' })).toBe(
      `no tree read contained id:"amount_input". ${reasons} ` +
        'If something covers it, close that first; if it is showing, set app.ios.treeSource: wda in averi.yaml',
    );
    expect(missNote({ of: 'noIdListed', id: 'lab.sheet-long-list.R' })).toBe(
      `no tree read contained id:"lab.sheet-long-list.R", and idb's read lists no id on any element. ${reasons} ` +
        'If something covers it, close that first; if it is showing, ask for it by text: or label:, or set app.ios.treeSource: wda in averi.yaml',
    );
    expect(missNote({ of: 'unread' })).toBeUndefined();
    expect(missNote({ of: 'none' })).toBeUndefined();
  });

  it('idb\'s two notes: the read\'s fact (NO_ID_LISTED) in one phrase with no parenthesis inside, both ending on the one remedy (TREE_SOURCE_REMEDY)', () => {
    const noIdNote = missNote({ of: 'noIdListed', id: 'x' })!;
    expect(noIdNote).toContain(NO_ID_LISTED);
    for (const note of [noIdNote, missNote({ of: 'idUnlisted', id: 'x' })!]) expect(note).not.toMatch(/[()]/);
    expect(noIdNote.endsWith(TREE_SOURCE_REMEDY)).toBe(true);
    expect(missNote({ of: 'idUnlisted', id: 'x' })!.endsWith(TREE_SOURCE_REMEDY)).toBe(true);
    expect(missNote({ of: 'idUnlisted', id: 'x' })).not.toContain(NO_ID_LISTED);
  });

  it('withMissNote: the note after a one-line not-found, in a parenthesis; nothing added for none or no miss', () => {
    expect(withMissNote('not found', { of: 'activeWindow' })).toBe(`not found (${ACTIVE_WINDOW_HINT})`);
    expect(withMissNote('not found', { of: 'none' })).toBe('not found');
    expect(withMissNote('not found', undefined)).toBe('not found');
  });
});
