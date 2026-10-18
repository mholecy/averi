import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DeviceScreen, UiNode } from '../../src/adapters/types.js';
import { walkOf } from '../../src/ui-tree/placed.js';
import { presentationOf } from '../../src/ui-tree/presentation.js';
import { presentedRemedy, presentedStop } from '../../src/ui-tree/standing.js';
import { ElementNotFoundError, resolveSettled } from '../../src/interact/resolve.js';
import { failureOf, play, type Row } from '../helpers/rounds.js';
import { parseDump } from '../helpers/android-dumps.js';

// ANDROID'S PRESENTED WINDOW (docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md):
// `uiautomator dump` lists the ACTIVE window only, so beneath an AlertDialog or a ModalBottomSheet the screen's targets
// are not in the tree at all. The parser marks its root as such a listing (`UiNode.activeWindowOnly`) and marks the
// window presented when the dump shows it is (`UiNode.presentation`: a floating window, `dialog`; a window whose scrim
// lies above its sheet, `screen`); the presentation module reads both (ui-tree/presentation.ts#byMarks, #byUiautomator),
// and the verbs refuse to stroke or wait on a target the tree cannot list beneath it.
//
// The captures are the lab app's (fixtures/apps/android on truth/phase-3, captured by scripts/truth/capture-android.ts
// on the averi_lab AVD, Pixel 3a profile, API 33, 1080x2220): tests/fixtures/truth/android-averi_lab-api33/<cell>.xml,
// copied unchanged.

/** A lab capture as the adapter parses it (the status line uiautomator appends cut, as AndroidAdapter.uiTree does). */
const capture = (cell: 'alert-dim' | 'sheet-medium' | 'form-picker' | 'open'): UiNode => {
  const raw = readFileSync(new URL(`../fixtures/uiautomator-lab-${cell}.xml`, import.meta.url), 'utf8');
  return parseDump(raw.slice(0, raw.lastIndexOf('>') + 1));
};

const PIXEL: DeviceScreen = { width: 1080, height: 2220, statusBand: 66 };
/** `scroll_until`'s rules on the Pixel, as the golden asks it (direction down, the defaults). */
const RULES = { direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: PIXEL } as const;

/** A uiautomator dump of one window holding `body`, the window at `bounds` (raw, as uiautomator writes them). */
const dump = (bounds: string, body: string): UiNode =>
  parseDump(
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
      `<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" clickable="false" scrollable="false" bounds="${bounds}">${body}</node></hierarchy>`,
  );
/** A raw uiautomator node. */
const raw = (bounds: string, attrs: { desc?: string; clickable?: boolean; scrollable?: boolean } = {}, children = ''): string =>
  `<node index="0" text="" resource-id="" class="android.view.View" package="p" content-desc="${attrs.desc ?? ''}" clickable="${attrs.clickable === true}" scrollable="${attrs.scrollable === true}" bounds="${bounds}"${children === '' ? ' />' : `>${children}</node>`}`;

describe('the uiautomator parser marks its root: the dump lists the active window only', () => {
  it('every dump\'s root carries `activeWindowOnly`, a plain screen\'s as a presented window\'s', () => {
    for (const cell of ['open', 'alert-dim', 'sheet-medium', 'form-picker'] as const) expect(capture(cell).activeWindowOnly).toBe(true);
  });

  it('the presentation module picks the uiautomator adapter by that mark (not by `paddedTouchTargets`)', () => {
    const tree = capture('open');
    expect(presentationOf(tree).fallback).toBe('uiautomator');
    const { activeWindowOnly: _, ...unmarked } = tree;
    expect(presentationOf(unmarked).fallback).toBe('shape');
  });
});

describe('the uiautomator parser marks the one window presented when the dump shows it is', () => {
  it('measured, the AlertDialog (alert-dim): a window off the screen\'s top and left edges floats over what it was opened from — `dialog`', () => {
    const tree = capture('alert-dim');
    expect(tree.rect).toEqual({ x: 155, y: 851, width: 770, height: 517 });
    expect(tree.presentation).toBe('dialog');
  });

  it('measured, the half-expanded ModalBottomSheet (sheet-medium): a screen-wide clickable labelled scrim from the window\'s top, the sheet beneath it to the bottom — `screen`', () => {
    expect(capture('sheet-medium').presentation).toBe('screen');
  });

  it('a plain screen (open) is no presented window; nor is the expanded picker sheet (form-picker), whose dump carries no scrim — a residual', () => {
    expect(capture('open').presentation).toBeUndefined();
    expect(capture('form-picker').presentation).toBeUndefined();
  });

  it('the scrim must be clickable, labelled, childless and screen-wide from the window\'s top, its sibling reaching the bottom from no lower than the scrim\'s', () => {
    const sheet = raw('[0,1110][1080,2220]', {}, raw('[128,1353][953,1529]', { desc: 'Target S', clickable: true }));
    const scrim = (attrs: Parameters<typeof raw>[1], bounds = '[0,0][1080,1110]') => raw(bounds, attrs);
    const host = (first: string, second = sheet) => dump('[0,0][1080,2220]', raw('[0,0][1080,2220]', {}, first + second));
    expect(host(scrim({ desc: 'Close sheet', clickable: true })).presentation).toBe('screen');
    // A full-screen scrim behind the sheet (the Views BottomSheetDialog's `touch_outside` shape) holds too.
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[0,0][1080,2220]')).presentation).toBe('screen');
    expect(host(scrim({ clickable: true })).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Banner' })).presentation).toBeUndefined();
    // A would-be scrim with a child of its own is content (a banner holding its text), no scrim.
    expect(host(raw('[0,0][1080,1110]', { desc: 'Close sheet', clickable: true }, raw('[40,40][400,100]', { desc: 'x' }))).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[0,66][1080,1110]')).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[40,0][1040,1110]')).presentation).toBeUndefined();
    // The next sibling stops short of the window's bottom, or begins below the scrim: no sheet.
    expect(host(scrim({ desc: 'Close sheet', clickable: true }), raw('[0,1110][1080,2000]')).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }), raw('[0,1200][1080,2220]')).presentation).toBeUndefined();
    // The scrim last, with nothing after it: no sheet either.
    expect(dump('[0,0][1080,2220]', raw('[0,0][1080,2220]', {}, sheet + scrim({ desc: 'Close sheet', clickable: true }))).presentation).toBeUndefined();
  });

  it('a window against the screen\'s top or left edge is no dialog, however small or offset on the other axis; one of no area is none', () => {
    expect(dump('[0,0][600,900]', raw('[0,0][600,900]', { desc: 'x' })).presentation).toBeUndefined();
    // A full-height window offset sideways: landscape beside a cutout, a pillarboxed compat-mode app.
    expect(dump('[120,0][1200,2220]', raw('[120,0][1200,2220]', { desc: 'x' })).presentation).toBeUndefined();
    // A full-width window offset down: a split screen's lower window.
    expect(dump('[0,1110][1080,2220]', raw('[0,1110][1080,2220]', { desc: 'x' })).presentation).toBeUndefined();
    // The plain screen shifted 120 px right reads as no dialog either.
    const shifted = readFileSync(new URL('../fixtures/uiautomator-lab-open.xml', import.meta.url), 'utf8').replace(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g, (_m, l, t, r, b) => `bounds="[${+l + 120},${t}][${+r + 120},${b}]"`);
    expect(parseDump(shifted.slice(0, shifted.lastIndexOf('>') + 1)).presentation).toBeUndefined();
    expect(dump('[200,300][200,300]', '').presentation).toBeUndefined();
  });
});

describe('the presentation module: the presented window is listed alone', () => {
  it('`alone` names the dialog, and the sheet as a presented screen; nothing on a plain screen', () => {
    expect(presentationOf(capture('alert-dim')).alone).toEqual({ kind: 'dialog' });
    expect(presentationOf(capture('sheet-medium')).alone).toEqual({ kind: 'screen' });
    expect(presentationOf(capture('open')).alone).toBeUndefined();
    expect(presentationOf(capture('form-picker')).alone).toBeUndefined();
  });

  it('a WDA-style marked layer on a tree that lists every window is not alone: a target missing there is missing', () => {
    const tree = capture('alert-dim');
    const { activeWindowOnly: _, ...everyWindow } = tree;
    expect(presentationOf(everyWindow).alone).toBeUndefined();
  });

  it('for no target, every touch-down lands on the dialog — outside its window too, where the AlertDialog dismisses on it', () => {
    const tree = capture('alert-dim');
    expect(presentationOf(tree).topmostAt({ x: 540, y: 1776 })?.cover.node).toBe(tree);
    expect(presentationOf(tree).press(tree)).toEqual({ surface: tree, reach: tree.rect, layer: { kind: 'dialog' } });
  });

  it('a target of the window\'s own is not beneath it: nothing presented over the dialog\'s Keep, nor the sheet\'s S', () => {
    for (const [cell, label] of [['alert-dim', 'Keep'], ['sheet-medium', 'Target S']] as const) {
      const tree = capture(cell);
      const own = find(tree, (n) => n.label === label)!;
      const order = walkOf(tree);
      const over = presentationOf(tree, order).over(own);
      expect(order.filter((p) => over.wholeScreen(p) || over.surface(p) !== undefined || !over.drawn(p))).toEqual([]);
    }
  });
});

const find = (n: UiNode, p: (n: UiNode) => boolean): UiNode | undefined => (p(n) ? n : n.children.map((c) => find(c, p)).find((f) => f !== undefined));

describe('scroll_until for a target the tree cannot list beneath the presented window: stops before any swipe', () => {
  it('alert-dim: the stroke would touch down on the dim outside the dialog, which dismisses it — none is sent', () => {
    const row: Row = { tree: capture('alert-dim'), found: [] };
    const played = play(RULES, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    expect(failureOf(played, 'id:"lab.alert-dim.D"').message).toBe(
      'scroll_until id:"lab.alert-dim.D" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (540,1776) on ' +
        `container (155,851 770x517) — ${presentedStop({ kind: 'dialog' })}, so none was sent.`,
    );
  });

  it('sheet-medium: the stroke would drag the sheet up (it expands) — none is sent', () => {
    const row: Row = { tree: capture('sheet-medium'), found: [] };
    const played = play(RULES, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    expect(failureOf(played, 'id:"lab.sheet-medium.D"').message).toContain(`${presentedStop({ kind: 'screen' })}, so none was sent.`);
  });

  it('…a plain failure, not absence', () => {
    const row: Row = { tree: capture('alert-dim'), found: [] };
    expect(failureOf(play(RULES, [row, row]), 'id:"lab.alert-dim.D"')).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('the expanded picker (form-picker), unmarked, strokes as before: its touch-down lies on the sheet\'s own list anyway', () => {
    const row: Row = { tree: capture('form-picker'), found: [] };
    const played = play(RULES, [row, row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(true);
  });
});

describe('tap: the wait for a target the tree cannot list beneath the presented window names the layer', () => {
  const adapter = (tree: UiNode) => ({ uiTree: async () => tree });
  const FAST = { ambiguous: 'first' as const, timeoutMs: 30, pollMs: 2 };
  /** The error the wait for `selector` on `tree` throws. */
  const waitFails = (tree: UiNode, selector: string): Promise<Error> =>
    resolveSettled(adapter(tree), selector, FAST).then(
      () => {
        throw new Error('resolved');
      },
      (e: unknown) => e as Error,
    );

  it('alert-dim: close it first, not "to appear" — a plain failure, not absence', async () => {
    const error = await waitFails(capture('alert-dim'), 'id:"lab.alert-dim.A"');
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toBe(
      'Timed out after 30ms: element id:"lab.alert-dim.A" is not in the tree, which lists only the window presented on top (the tree source lists the ' +
        `active window alone) — ${presentedRemedy('it', { kind: 'dialog' })}`,
    );
  });

  it('sheet-medium: the presented screen\'s remedy', async () => {
    const error = await waitFails(capture('sheet-medium'), 'id:"lab.sheet-medium.A"');
    expect(error.message).toContain(presentedRemedy('it', { kind: 'screen' }));
    expect(error.message).not.toMatch(/to appear/);
  });

  it('a plain screen still waits "to appear"', async () => {
    const error = await waitFails(capture('open'), 'id:"nothing.here"');
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect(error.message).toMatch(/waiting for element id:"nothing.here" to appear/);
  });
});
