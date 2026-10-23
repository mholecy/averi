import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FocusedWindow, UiNode } from '../../src/adapters/types.js';
import { parseFocusedWindow } from '../../src/adapters/android.js';
import { markByWindow, markedByWindow } from '../../src/ui-tree/window-mark.js';
import { missOf } from '../../src/ui-tree/miss.js';
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

describe('markedByWindow: asks the adapter only for an unmarked active-window tree', () => {
  const asking = (window: FocusedWindow) => {
    const asked: number[] = [];
    return { asked, adapter: { focusedWindow: async () => (asked.push(1), window) } };
  };

  it('asks once for an unmarked uiautomator tree and marks it', async () => {
    const { asked, adapter } = asking(wm('dialog-fullscreen'));
    expect((await markedByWindow(adapter, uiautomator('dialog-fullscreen')))?.presentation).toBe('screen');
    expect(asked).toHaveLength(1);
  });

  it('never for a marked window, a tree listing every window, no tree, or an adapter with no window manager (iOS)', async () => {
    const { asked, adapter } = asking(wm('alert-dim'));
    await markedByWindow(adapter, uiautomator('alert-dim'));
    const { activeWindowOnly: _, ...everyWindow } = uiautomator('open');
    await markedByWindow(adapter, everyWindow);
    expect(await markedByWindow(adapter, undefined)).toBeUndefined();
    expect(asked).toHaveLength(0);
    const tree = uiautomator('open');
    expect(await markedByWindow({}, tree)).toBe(tree);
  });
});
