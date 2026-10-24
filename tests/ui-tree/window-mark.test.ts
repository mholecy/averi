import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type FocusedWindow, type UiNode } from '../../src/adapters/types.js';
import { parseFocusedWindow } from '../../src/adapters/android.js';
import { markByWindow, markedForMiss } from '../../src/ui-tree/window-mark.js';
import { missNote, missOf, presentedAloneHeadline, type Miss } from '../../src/ui-tree/miss.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import { parseDump } from '../helpers/android-dumps.js';

// THE WINDOW MANAGER'S WORD AS A MARK (ui-tree/window-mark.ts): the dumped root is marked by the focused window the WM
// types, matched to it by frame — a Dialog's window presented (`screen` when it spans the screen's width, else
// `dialog`), the activity's window alone with no other app window showing `windowAlone` — or left as it was. Over the
// lab captures and their own WM dumps (tests/fixtures/truth/android-averi_lab-api33).

const ANDROID = new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url);
const uiautomator = (cell: string): UiNode => {
  const raw = readFileSync(new URL(`${cell}.xml`, ANDROID), 'utf8');
  return parseDump(raw.slice(0, raw.lastIndexOf('>') + 1));
};
const wm = (cell: string): FocusedWindow => parseFocusedWindow(readFileSync(new URL(`${cell}.windows.txt`, ANDROID), 'utf8'));
const SCREEN = { width: 1080, height: 2220 };

describe('markByWindow: (tree, the WM\'s word) → the tree marked, or as it was', () => {
  it('dialog-fullscreen, stacked at the root\'s bounds: the root is a presented screen, listed alone', () => {
    const tree = uiautomator('dialog-fullscreen');
    expect(tree.presentation).toBeUndefined();
    const marked = markByWindow(tree, wm('dialog-fullscreen'));
    expect(marked.presentation).toBe('screen');
    expect(presentationOf(marked).alone).toEqual({ kind: 'screen' });
    expect(marked.children).toBe(tree.children);
  });

  it('dialog-views-fullscreen, at an activity\'s very shape: marked too — the type tells it, not the shape', () => {
    expect(markByWindow(uiautomator('dialog-views-fullscreen'), wm('dialog-views-fullscreen')).presentation).toBe('screen');
  });

  it('form-picker\'s expanded sheet, which dumps no scrim: a presented screen', () => {
    expect(markByWindow(uiautomator('form-picker'), wm('form-picker')).presentation).toBe('screen');
  });

  it('a stacked window narrower than the screen (a popup against an edge) is a dialog', () => {
    const popup = parseDump(`<?xml version='1.0' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" clickable="false" bounds="[0,66][600,900]"><node index="0" text="x" resource-id="" class="android.widget.TextView" package="p" content-desc="" clickable="false" bounds="[0,66][600,900]" /></node></hierarchy>`);
    expect(popup.presentation).toBeUndefined();
    expect(markByWindow(popup, { of: 'stacked', frame: { x: 0, y: 66, width: 600, height: 834 }, screen: SCREEN }).presentation).toBe('dialog');
  });

  it('a frame that is not the root\'s (a window opened or closed between the dump and the WM\'s read): nothing is marked', () => {
    const tree = uiautomator('dialog-fullscreen');
    expect(markByWindow(tree, { of: 'stacked', frame: { x: 0, y: 106, width: 1080, height: 2087 }, screen: SCREEN })).toBe(tree);
    expect(markByWindow(uiautomator('open'), { of: 'screenAlone', frame: { x: 40, y: 0, width: 1040, height: 2220 } }).windowAlone).toBeUndefined();
  });

  it('open, the screen alone: `windowAlone` — the miss says no active-window hint', () => {
    const tree = uiautomator('open');
    const marked = markByWindow(tree, wm('open'));
    expect(marked.windowAlone).toBe(true);
    expect(marked.presentation).toBeUndefined();
    expect(missOf({ tree, target: 'id:"nothing.here"' })).toEqual({ of: 'activeWindow' });
    expect(missOf({ tree: marked, target: 'id:"nothing.here"' })).toEqual({ of: 'none' });
  });

  it('a frame a pixel off the root\'s (two readers rounding one layout) still marks it; two pixels do not', () => {
    const tree = uiautomator('dialog-fullscreen');
    const at = (frame: { x: number; y: number; width: number; height: number }) => markByWindow(tree, { of: 'stacked', frame, screen: SCREEN }).presentation;
    expect(at({ ...tree.rect, height: tree.rect.height + 1 })).toBe('screen');
    expect(at({ ...tree.rect, y: tree.rect.y - 1 })).toBe('screen');
    expect(at({ ...tree.rect, height: tree.rect.height + 2 })).toBeUndefined();
    // …and a window a pixel narrower than the screen still spans it: a screen, not a dialog.
    const wide = uiautomator('dialog-views-fullscreen');
    expect(markByWindow(wide, { of: 'stacked', frame: { ...wide.rect, width: wide.rect.width - 1 }, screen: SCREEN }).presentation).toBe('screen');
  });

  it('unknown leaves the tree as it was', () => {
    const tree = uiautomator('dialog-fullscreen');
    expect(markByWindow(tree, { of: 'unknown' })).toBe(tree);
  });

  it('a window the parser already marked keeps its own mark (alert-dim\'s dialog, bottom-sheet-dialog\'s screen), and a tree listing every window takes none', () => {
    const alert = uiautomator('alert-dim');
    expect(markByWindow(alert, wm('alert-dim'))).toBe(alert);
    const sheet = uiautomator('bottom-sheet-dialog');
    expect(markByWindow(sheet, wm('bottom-sheet-dialog'))).toBe(sheet);
    const { activeWindowOnly: _, ...everyWindow } = uiautomator('dialog-fullscreen');
    expect(markByWindow(everyWindow, wm('dialog-fullscreen'))).toBe(everyWindow);
  });
});

describe('a presented window that holds a scroll view of its own: a target missing from it may be a row not laid out yet', () => {
  // form-picker's country sheet: a lazy list whose far rows (country.ST) are not in the tree until scrolled to —
  // `scroll_until` reaches them on the sheet's own list. Telling the agent to close the sheet would dismiss what it needs.
  const sheet = (): UiNode => markByWindow(uiautomator('form-picker'), wm('form-picker'));
  const ST = 'id:"lab.form-picker.country.ST"';

  it('the miss says the window\'s own scroll view may hold it (`mayLieIn`), unless the reader has stroked it already', () => {
    expect(missOf({ tree: sheet(), target: ST })).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'window', mayLieIn: 'itsScrollView' });
    expect(missOf({ tree: sheet(), target: ST, scrolled: true })).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'window' });
  });

  it('a scroll view that cannot scroll now (a ScrollView-classed node that fits, an AlertDialog\'s message) is no list to look in', () => {
    const fits = (n: UiNode): UiNode => ({ ...n, clipsDescendants: undefined, role: n.clipsDescendants === true ? 'scrollable' : n.role, children: n.children.map(fits) });
    const tree = fits(sheet());
    expect([...everyNode(tree)].some((n) => n.role === 'scrollable')).toBe(true);
    expect(missOf({ tree, target: ST })).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'window' });
  });

  it('a window with no scroll view of its own says no scroll (dialog-fullscreen, alert-dim, sheet-medium)', () => {
    expect(missOf({ tree: markByWindow(uiautomator('dialog-fullscreen'), wm('dialog-fullscreen')), target: 'id:"lab.dialog-fullscreen.A"' })).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'window' });
    expect(missOf({ tree: uiautomator('alert-dim'), target: 'id:"lab.alert-dim.A"' })).toEqual({ of: 'presented', layer: { kind: 'dialog' }, listed: 'window' });
    expect(missOf({ tree: uiautomator('sheet-medium'), target: 'id:"lab.sheet-medium.A"' })).toEqual({ of: 'presented', layer: { kind: 'screen' }, listed: 'window' });
  });

  it('its words: the scroll first, close it first only if not — never "no scroll moves it out"', () => {
    const miss = missOf({ tree: sheet(), target: ST }) as Extract<Miss, { of: 'presented' }>;
    expect(presentedAloneHeadline('element id:"x"', miss)).toBe(
      'element id:"x" is not in the tree, which lists only the window presented on top (the tree source lists the active window alone) — ' +
        'scroll_until it in that window\'s own list first; if it is not there, a sheet or modal is presented over it — close it first',
    );
    expect(missNote(miss)).toBe(
      'the tree lists only the window on top: scroll_until it in that window\'s own list first; if it is not there, a sheet or modal is presented over it — close it first',
    );
    const { mayLieIn: _, ...stroked } = miss;
    expect(presentedAloneHeadline('element id:"x"', stroked)).toMatch(/no scroll moves it out from under that screen$/);
  });
});

describe('markedForMiss: asks the adapter only for a miss on an unmarked active-window tree', () => {
  const asking = (window: FocusedWindow) => {
    const asked: number[] = [];
    return { asked, adapter: { focusedWindow: async () => (asked.push(1), window) } };
  };
  const A = 'id:"lab.dialog-fullscreen.A"';

  it('asks once for an unmarked uiautomator tree that holds no match of the target, and marks it', async () => {
    const { asked, adapter } = asking(wm('dialog-fullscreen'));
    expect((await markedForMiss(adapter, { lastTree: uiautomator('dialog-fullscreen') }, A))?.presentation).toBe('screen');
    expect(asked).toHaveLength(1);
  });

  it('never for a marked window, a tree listing every window, no tree, or an adapter with no window manager (iOS)', async () => {
    const { asked, adapter } = asking(wm('alert-dim'));
    await markedForMiss(adapter, { lastTree: uiautomator('alert-dim') }, 'id:"lab.alert-dim.A"');
    const { activeWindowOnly: _, ...everyWindow } = uiautomator('open');
    await markedForMiss(adapter, { lastTree: everyWindow }, A);
    expect(await markedForMiss(adapter, {}, A)).toBeUndefined();
    expect(asked).toHaveLength(0);
    const tree = uiautomator('open');
    expect(await markedForMiss({}, { lastTree: tree }, A)).toBe(tree);
  });

  it('never where the reply words no not-found: no target handed (an absent check, a wrong content), a target the read matched, a failed last read', async () => {
    const { asked, adapter } = asking(wm('dialog-fullscreen'));
    const tree = uiautomator('dialog-fullscreen');
    expect(await markedForMiss(adapter, { lastTree: tree }, undefined)).toBe(tree);
    expect(await markedForMiss(adapter, { lastTree: tree }, 'id:"lab.dialog-fullscreen.S"')).toBe(tree);
    expect(await markedForMiss(adapter, { lastTree: tree, readError: new Error('dump failed') }, A)).toBe(tree);
    expect(asked).toHaveLength(0);
  });
});
