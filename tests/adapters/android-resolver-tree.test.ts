import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseDump } from '../helpers/android-dumps.js';

// T4: Android's "Open with" chooser as uiautomator dumps it, parsed by the production parser (parseUiautomatorXml with
// the port production wires). uiautomator-lab-resolver.xml is batch-10's D55 E2 capture (averi_lab, API 33, main
// 139256a2): `uiautomator dump` 1.5 s after `am start -a VIEW -d averilab://shared/open` from the launcher, both
// focus lines naming android/com.android.internal.app.ResolverActivity; the fresh layout (no last-chosen entry), 27
// nodes, all package `android`, as the device wrote it (uiautomator's trailing status line was not kept). D55c's
// build reads it by resource id (`resolver_list`, `text1`, `button_once`, `button_always`); the
// `resolver_list_with_default` layout (after a "Just once") was never captured.
// android-ui-snapshot-lab-resolver.json is averi's own ui_snapshot reply on the same chooser, batch-10's E4a (a later
// raise of the same link, the same main): the fixture's parse is that reply byte for byte, but for the two `disabled`
// marks D66 added (docs/adr/0042-a-node-its-source-marks-not-enabled-is-said-disabled.md). The recorded reply is device
// evidence and stays as it was taken.

const raw = readFileSync(new URL('../fixtures/uiautomator-lab-resolver.xml', import.meta.url), 'utf8');
/** The chooser's tree as the adapter parses it (any status line after the last `>` cut, as AndroidAdapter.uiTree does), parsed once: no test changes it. */
const chooserTree: UiNode = parseDump(raw.slice(0, raw.lastIndexOf('>') + 1));
const byId = (root: UiNode, id: string): UiNode[] => [...everyNode(root)].filter((n) => n.identifier === id);
const oneById = (root: UiNode, id: string): UiNode => {
  const [node, ...more] = byId(root, id);
  expect(more).toEqual([]);
  if (node === undefined) throw new Error(`no ${id}`);
  return node;
};

describe('the chooser\'s real tree (batch-10 E2, API 33): what the uiautomator parser yields today', () => {
  it('is averi\'s ui_snapshot reply on the chooser (batch-10 E4a), byte for byte, plus `"disabled": true` after the children of the two buttons (D66)', () => {
    const reply = readFileSync(new URL('../fixtures/android-ui-snapshot-lab-resolver.json', import.meta.url), 'utf8');
    // The node's own indent, then everything up to its (empty) children: the mark is the node's last key.
    const marked = (id: string) => new RegExp(`^( *)("identifier": "${id}",[\\s\\S]*?"children": \\[\\])`, 'm');
    const expected = reply.replace(marked('button_once'), '$1$2,\n$1"disabled": true').replace(marked('button_always'), '$1$2,\n$1"disabled": true');
    expect(expected.match(/"disabled": true/g)).toHaveLength(2);
    expect(JSON.stringify(chooserTree, null, 2)).toBe(expected);
  });

  it('27 nodes, every package `android`, the root the active window\'s whole screen, marked as uiautomator\'s', () => {
    expect(raw.match(/<node /g)).toHaveLength(27);
    expect(raw.match(/package="android"/g)).toHaveLength(27);
    const root = chooserTree;
    expect([...everyNode(root)]).toHaveLength(27);
    expect(root.rect).toEqual({ x: 0, y: 0, width: 1080, height: 2220 });
    expect(root).toMatchObject({ paddedTouchTargets: true, activeWindowOnly: true, boundsCutAtScreen: true });
  });

  it('no presentation mark: the sheet\'s window spans the screen from 0,0 with no scrim node — no recognizer knows it', () => {
    // Today's reading: the chooser is a sheet over the launcher, yet its window dumps as a plain screen (D55's focus
    // read names it instead: android-chooser.ts). No row plans a mark from the tree.
    expect(chooserTree.presentation).toBeUndefined();
  });

  it('the title by its id, "Open with"', () => {
    expect(oneById(chooserTree, 'title')).toMatchObject({ role: 'text', label: 'Open with', rect: { x: 66, y: 1522, width: 948, height: 59 } });
  });

  it('`resolver_list` a vertical scrollable though the dump says scrollable="false" (a ListView: its class decides)', () => {
    expect(raw).toContain('resource-id="android:id/resolver_list" class="android.widget.ListView" package="android" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="true" focused="false" scrollable="false"');
    expect(oneById(chooserTree, 'resolver_list')).toMatchObject({ role: 'scrollable', scrollAxis: 'vertical', rect: { x: 0, y: 1650, width: 1080, height: 308 } });
    expect(oneById(chooserTree, 'profile_pager')).toMatchObject({ role: 'scrollable', scrollAxis: 'horizontal' });
  });

  it('a row is a direct child of `resolver_list`, a plain container (not clickable in the dump), labelled by its `text1` and, on the alias row, `text2`', () => {
    const rows = oneById(chooserTree, 'resolver_list').children;
    expect(rows.map((row) => [row.role, row.label, row.identifier, row.rect])).toEqual([
      ['container', null, null, { x: 0, y: 1650, width: 1080, height: 154 }],
      ['container', null, null, { x: 0, y: 1804, width: 1080, height: 154 }],
    ]);
    const texts = rows.map((row) => [...everyNode(row)].filter((n) => n.role === 'text').map((n) => [n.identifier, n.label]));
    expect(texts).toEqual([
      [['text1', 'AveriLab']],
      [['text1', 'AveriLab'], ['text2', 'AveriLab twin']],
    ]);
  });

  it('"Just once" and "Always" by their ids, buttons marked `disabled` as the dump\'s enabled="false" says (D66); no other node is', () => {
    // Fixed by D66 (was KNOWN-WRONG: the mark was dropped, and a tap on one replied a bare "Tapped" while nothing
    // happened). The fresh layout's buttons stay disabled until a row is selected; D55c reads the mark.
    expect(raw).toMatch(/text="Just once" resource-id="android:id\/button_once" class="android.widget.Button" [^>]*clickable="true" enabled="false"/);
    expect(raw).toMatch(/text="Always" resource-id="android:id\/button_always" class="android.widget.Button" [^>]*clickable="true" enabled="false"/);
    const root = chooserTree;
    expect(oneById(root, 'button_once')).toEqual({ role: 'button', label: 'Just once', identifier: 'button_once', value: null, rect: { x: 604, y: 1983, width: 238, height: 149 }, children: [], disabled: true });
    expect(oneById(root, 'button_always')).toEqual({ role: 'button', label: 'Always', identifier: 'button_always', value: null, rect: { x: 842, y: 1983, width: 188, height: 149 }, children: [], disabled: true });
    expect(raw.match(/enabled="true"/g)).toHaveLength(25);
    expect([...everyNode(root)].filter((n) => n.disabled !== undefined).map((n) => n.identifier)).toEqual(['button_once', 'button_always']);
  });

  it('a dump that does not print `enabled` leaves every node unmarked: unknown is not disabled (fail open)', () => {
    const bare = parseDump(raw.slice(0, raw.lastIndexOf('>') + 1).replace(/ enabled="(true|false)"/g, ''));
    expect([...everyNode(bare)].filter((n) => n.disabled !== undefined)).toEqual([]);
    const odd = parseDump(raw.slice(0, raw.lastIndexOf('>') + 1).replace(/ enabled="false"/g, ' enabled="FALSE"'));
    expect([...everyNode(odd)].filter((n) => n.disabled !== undefined)).toEqual([]);
  });
});
