import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';

// What the WDA parser marks as a PRESENTED LAYER (`UiNode.presentation`, on the layer — a Window's direct child): the
// source's own word that a layer is presented over the screen beneath. By the type of an element the layer holds
// (`Alert`, an action sheet `Sheet`, a `Popover` — that element named `UiNode.presentationElement`), or, for a screen
// with no such type, by WDA's own visibility flags: every node of the screen-sized layer beneath reads `isVisible="0"`
// while a later screen-sized layer shows. And on the root, whether the source judged presented layers at all
// (`UiNode.presentationsJudged`): a payload carrying visibility flags.

const SCREEN = { x: 0, y: 0, width: 402, height: 874 };
const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/** A synthetic WDA element: visible and accessible unless overridden. */
const el = (type: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type,
  rawIdentifier: null,
  label: null,
  value: null,
  rect: SCREEN,
  isVisible: '1',
  isAccessible: '1',
  children: [],
  ...over,
});
/** `el` with every node of its subtree `isVisible="0"`. */
const hiddenAll = (e: Record<string, unknown>): Record<string, unknown> => ({ ...e, isVisible: '0', isAccessible: '0', children: ((e.children as Record<string, unknown>[]) ?? []).map(hiddenAll) });
/** A flagless element (a hand-reduced payload): no `isVisible`, no `isAccessible`, anywhere. */
const flagless = (e: Record<string, unknown>): Record<string, unknown> => {
  const { isVisible: _v, isAccessible: _a, children, ...rest } = e;
  return { ...rest, children: ((children as Record<string, unknown>[]) ?? []).map(flagless) };
};

const app = (...windows: Record<string, unknown>[]) => el('Application', { label: 'Example', children: windows });
const win = (...layers: Record<string, unknown>[]) => el('Window', { children: layers });
/** A screen: a full-screen layer holding a navigation bar and a list of rows. */
const screen = (name: string) =>
  el('Other', {
    children: [
      el('NavigationBar', { label: name, rect: rect(0, 62, 402, 54), children: [el('StaticText', { label: name, rect: rect(150, 70, 102, 22) })] }),
      el('Table', { rect: rect(0, 116, 402, 758), children: [el('Cell', { rect: rect(0, 116, 402, 44), children: [el('StaticText', { label: `${name} row`, rect: rect(20, 126, 200, 22) })] })] }),
    ],
  });
/** A page sheet's layer: the sheet's nav bar and form, laid in a full-screen transition container. */
const pageSheet = () =>
  el('Other', {
    children: [
      el('Other', { rect: rect(0, 62, 402, 812), children: [el('NavigationBar', { label: 'New Contact', rect: rect(0, 62, 402, 56), children: [el('Button', { label: 'Cancel', rect: rect(16, 72, 70, 36) })] })] }),
      el('Table', { rect: rect(0, 118, 402, 756), children: [el('TextField', { label: 'First name', rect: rect(20, 300, 362, 44) })] }),
    ],
  });

/**
 * A sheet's layer with no content of its own (the lab's medium sheet): its `dismiss popup` and its card, nested empty
 * `Other`s — every element shown, none of a non-structural role.
 */
const emptySheet = () =>
  el('Other', {
    children: [
      el('Other', { label: 'dismiss popup', rawIdentifier: 'PopoverDismissRegion', rect: rect(-402, -874, 1206, 2622) }),
      el('Other', { rect: rect(8, 415, 386, 451), children: [el('Other', { rect: rect(8, 415, 386, 451), children: [el('Other', { rect: rect(8, 415, 386, 451) })] })] }),
    ],
  });

const marks = (tree: UiNode) =>
  [...everyNode(tree)].filter((n) => n.presentation !== undefined || n.presentationElement === true).map((n) => [n.label ?? `${n.rect.x},${n.rect.y} ${n.rect.width}x${n.rect.height}`, n.presentation ?? 'element']);

describe('UiNode.presentation — a layer WDA types as presented: kind and label from the element it holds', () => {
  it('a layer holding an `Alert` is marked "alert", and the alert is the element naming it — its role, label and rect kept; nothing else marked', () => {
    const button = el('Button', { label: 'Discard', rect: rect(205, 473, 140, 48) });
    const alert = el('Alert', { label: 'Exit confirmation', rect: rect(41, 365, 320, 172), children: [button] });
    const tree = parseWdaSourceValue(app(win(hiddenAll(screen('Form')), el('Other', { children: [el('Other'), el('Other', { isVisible: '0' }), alert] }))));
    expect(marks(tree)).toEqual([
      ['0,0 402x874', 'alert'],
      ['Exit confirmation', 'element'],
    ]);
    const element = [...everyNode(tree)].find((n) => n.presentationElement === true)!;
    expect([element.role, element.rect]).toEqual(['container', rect(41, 365, 320, 172)]);
  });

  it('a popover holding an action sheet (`Popover` → `Sheet`, UIKit\'s discard prompt) is marked "actionSheet", named by the sheet\'s message; its `dismiss popup` stays an ordinary node of the layer', () => {
    const sheet = el('Sheet', { label: 'Are you sure you want to discard this new contact?', rect: rect(10, 78, 240, 169), children: [el('Button', { label: 'Discard Changes', rect: rect(10, 160, 240, 44) })] });
    const layer = el('Other', { children: [el('Other', { label: 'dismiss popup', rawIdentifier: 'PopoverDismissRegion' }), el('Popover', { rect: rect(10, 78, 240, 169), children: [el('Other', { rect: rect(10, 78, 240, 169), children: [sheet] })] })] });
    const tree = parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), layer)));
    expect(marks(tree).filter(([, kind]) => kind !== 'screen')).toEqual([
      ['0,0 402x874', 'actionSheet'],
      ['Are you sure you want to discard this new contact?', 'element'],
    ]);
  });

  it('a `Popover` with no typed content is marked "popover"', () => {
    const layer = el('Other', { children: [el('Other', { label: 'dismiss popup' }), el('Popover', { rect: rect(10, 78, 240, 169), children: [el('Button', { label: 'Copy', rect: rect(20, 90, 100, 44) })] })] });
    const tree = parseWdaSourceValue(app(win(screen('Notes'), layer)));
    expect(marks(tree)).toEqual([
      ['0,0 402x874', 'popover'],
      ['10,78 240x169', 'element'],
    ]);
  });
});

describe('UiNode.presentation "screen" — a later screen-sized layer shown over a layer WDA reports wholly invisible', () => {
  it('a page sheet over a list: the list\'s layer reads every node `isVisible="0"`, the sheet\'s layer shows — the SHEET\'S layer is marked "screen", nothing else', () => {
    const tree = parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), pageSheet())));
    expect(marks(tree)).toEqual([['0,0 402x874', 'screen']]);
    expect(tree.children[0].children[1].presentation).toBe('screen');
  });

  it('a half sheet (its dim a bare leaf of the layer, its card a third of the screen) and an RN transparent modal (a dim leaf, a card) are marked the same: the LAYER is screen-sized, whatever its content\'s size', () => {
    const half = el('Other', { children: [el('Other', { label: 'dismiss popup', rect: rect(-402, -874, 1206, 2622) }), el('Other', { rect: rect(0, 560, 402, 314), children: [el('Button', { label: 'Standard', rect: rect(31, 600, 340, 43) })] })] });
    const modal = el('Other', { children: [el('Other', { rawIdentifier: 'forgot_overlay' }), el('Other', { rawIdentifier: 'forgot_modal', rect: rect(16, 301, 370, 220), children: [el('StaticText', { label: 'Forgot password?', rect: rect(32, 320, 300, 24) })] })] });
    for (const layer of [half, modal]) expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), layer))))).toEqual([['0,0 402x874', 'screen']]);
  });

  it('not presented: the first content-carrying layer shows (a pushed form, Safari\'s capsule over its web view) — nothing marked', () => {
    const capsule = el('Other', { rawIdentifier: 'CapsuleViewController', children: [el('Button', { label: 'Back', rect: rect(20, 800, 44, 44) })] });
    expect(marks(parseWdaSourceValue(app(win(screen('Page'), capsule))))).toEqual([]);
    expect(marks(parseWdaSourceValue(app(win(screen('Form')))))).toEqual([]);
  });

  it('a layer beneath only PARTLY `isVisible="0"` (one row of it still reads visible) presents nothing beneath it: no mark', () => {
    const partly = hiddenAll(screen('Form'));
    const table = (partly.children as Record<string, unknown>[])[1];
    (table.children as Record<string, unknown>[])[0] = el('Cell', { rect: rect(0, 116, 402, 44), children: [el('StaticText', { label: 'Form row', rect: rect(20, 126, 200, 22) })] });
    expect(marks(parseWdaSourceValue(app(win(partly, pageSheet()))))).toEqual([]);
  });

  it('a lingering dismissed layer — its only visible content parked off the screen, below it — is no presented screen: no mark', () => {
    const leftover = el('Other', { children: [el('Other', { rect: rect(-402, -874, 1206, 2622) }), el('Other', { rect: rect(8, 874, 386, 400), children: [el('Button', { label: 'Standard', rect: rect(31, 900, 340, 43) })] })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), leftover))))).toEqual([]);
  });

  it('a layer that is not screen-sized, or carries no content (a bare leaf, an inputView placeholder), is walked past — beneath or above', () => {
    const bare = el('Other', { isVisible: '0' });
    const strip = el('Other', { rect: rect(0, 0, 402, 120), children: [el('Button', { label: 'Banner', rect: rect(20, 60, 100, 44) })] });
    expect(marks(parseWdaSourceValue(app(win(bare, hiddenAll(screen('Contacts')), strip, pageSheet()))))).toEqual([['0,0 402x874', 'screen']]);
  });

  it('a sheet with NO content of its own (its dim and its card only empty frames, every one shown) over a hidden screen is marked "screen" — the hidden layer beneath is the fact, the sheet need not hold a button', () => {
    // docs/bugs/2026-10-16-lab-ios-wda-scrolled-host-beneath-a-medium-sheet-loses-the-presented-remedy.md: the lab's
    // medium sheet over a scrolled host, as WDA reports it — beneath, every node `0`; the sheet's layer a `dismiss
    // popup` and the card's nested `Other`s, every one `1`, no element of a non-structural role.
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Host')), emptySheet()))))).toEqual([['0,0 402x874', 'screen']]);
  });

  it('draw order reads that mark: every target of the scrolled host beneath — above the screen, under the status bar, whole under the dim, a sliver at its bottom, below the screen — lies under a presented screen', () => {
    const target = (id: string, y: number) => el('Button', { label: `Target ${id}`, rawIdentifier: `lab.${id}`, rect: rect(51, y, 300, 64) });
    const host = el('Other', { children: [el('ScrollView', { children: [el('Other', { rect: rect(0, -200, 402, 1600), children: [target('H', -88), target('G', -20), target('M', 290), target('E', 869), target('F', 1009)] })] })] });
    const tree = parseWdaSourceValue(app(win(hiddenAll(host), emptySheet())));
    const order = drawOrder(tree);
    const byId = (id: string) => [...everyNode(tree)].find((n) => n.identifier === `lab.${id}`)!;
    for (const id of ['H', 'G', 'M', 'E', 'F']) expect(order.presentedOver(byId(id)), id).toBeDefined();
    expect(order.exposure(byId('M'), SCREEN).covers.some((c) => c.presented)).toBe(true);
  });

  it('…but only as the last word: a content-carrying layer after it is still the one marked, and one that is neither hidden nor shown still marks nothing', () => {
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), emptySheet(), pageSheet())))).map(([, kind]) => kind)).toEqual(['screen']);
    expect(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), emptySheet(), pageSheet()))).children[0].children[2].presentation).toBe('screen');
    const leftover = el('Other', { children: [el('Other', { rect: rect(8, 874, 386, 400), children: [el('Button', { label: 'Standard', rect: rect(31, 900, 340, 43) })] })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), emptySheet(), leftover))))).toEqual([]);
  });

  it('an empty layer is no presented screen without a hidden layer before it, nor when nothing of it shows', () => {
    expect(marks(parseWdaSourceValue(app(win(screen('Form'), emptySheet()))))).toEqual([]);
    expect(marks(parseWdaSourceValue(app(win(emptySheet(), hiddenAll(screen('Form'))))))).toEqual([]);
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), hiddenAll(emptySheet())))))).toEqual([]);
  });

  it('what shows is asked of the layer\'s children: a bare shown leaf (Contacts\' sheet with the keyboard up ends its Window with one) is no presented screen, nor a layer whose only shown frame lies off the Window', () => {
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), el('Other')))))).toEqual([]);
    const parked = el('Other', { children: [el('Other', { isVisible: '0', rect: rect(-402, -874, 1206, 2622) }), el('Other', { rect: rect(8, 900, 386, 451), children: [el('Other', { rect: rect(8, 900, 386, 451) })] })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), parked))))).toEqual([]);
  });

  it('the FIRST empty layer that shows is the one marked, not a later one', () => {
    const tree = parseWdaSourceValue(app(win(hiddenAll(screen('Form')), emptySheet(), emptySheet())));
    expect(marks(tree)).toEqual([['0,0 402x874', 'screen']]);
    expect(tree.children[0].children[1].presentation).toBe('screen');
  });

  it('only in the app\'s Window (the first): a later Window reading wholly `0` (the input host\'s, with the keyboard down) followed by a shown empty layer marks nothing', () => {
    const inputHost = win(hiddenAll(el('Other', { children: [el('Other', { rect: rect(0, 566, 402, 308), children: [el('Button', { label: 'Paste', rect: rect(150, 600, 80, 40) })] })] })), emptySheet());
    expect(marks(parseWdaSourceValue(app(win(screen('Form')), inputHost)))).toEqual([]);
  });

  it('only the FIRST shown layer after the hidden one: a later layer over the sheet (a toast host) is not marked', () => {
    const toast = el('Other', { children: [el('StaticText', { label: 'Saved', rect: rect(100, 780, 200, 30) })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), pageSheet(), toast))))).toEqual([['0,0 402x874', 'screen']]);
  });

  it('a sheet under a typed popover is "screen" when the list beneath it reads invisible, the popover\'s layer typed — two marks, one per layer', () => {
    const sheetUnder: Record<string, unknown> = hiddenAll(pageSheet());
    // Only the sheet's grabber still reads visible, as WDA reports a sheet with a popover up over it.
    (sheetUnder.children as Record<string, unknown>[]).push(el('Button', { label: 'Sheet Grabber', rect: rect(180, 66, 42, 10) }));
    const popover = el('Other', { children: [el('Other', { label: 'dismiss popup' }), el('Popover', { rect: rect(10, 78, 240, 169), children: [el('Sheet', { label: 'Discard?', rect: rect(10, 78, 240, 169) })] })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), sheetUnder, popover))))).toEqual([
      ['0,0 402x874', 'screen'],
      ['0,0 402x874', 'actionSheet'],
      ['Discard?', 'element'],
    ]);
  });

  it('a typed layer over a hidden screen is marked by its type only (one mark a layer): an alert\'s layer is "alert", not also "screen"', () => {
    const alertLayer = el('Other', { children: [el('Other'), el('Alert', { label: 'Exit confirmation', rect: rect(41, 365, 320, 172), children: [el('Button', { label: 'Discard', rect: rect(205, 473, 140, 48) })] })] });
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Form')), alertLayer))))).toEqual([
      ['0,0 402x874', 'alert'],
      ['Exit confirmation', 'element'],
    ]);
  });

  it('a typed element parked OFF the screen (a dismissed alert WDA keeps at y 1200) types nothing: the flags judge its layer — "screen" over a hidden screen, nothing over a shown one', () => {
    const parked = el('Alert', { label: 'Gone', rect: rect(41, 1200, 320, 172) });
    const sheetWithParked = pageSheet();
    (sheetWithParked.children as Record<string, unknown>[]).push(parked);
    expect(marks(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), sheetWithParked))))).toEqual([['0,0 402x874', 'screen']]);
    expect(marks(parseWdaSourceValue(app(win(screen('Form'), el('Other', { children: [el('Other'), parked] })))))).toEqual([]);
  });

  it('per Window: the keyboard\'s Window is never beneath and never presented — a hidden keyboard layer before a shown one marks nothing', () => {
    const keyboardWindow = win(
      hiddenAll(el('Other', { children: [el('Keyboard', { rect: rect(0, 874, 402, 243), children: [el('Key', { label: 'q', rect: rect(3, 880, 37, 42) })] })] })),
      el('Other', { children: [el('Button', { label: 'Dictate', rect: rect(330, 820, 60, 44) })] }),
    );
    expect(marks(parseWdaSourceValue(app(win(screen('Form')), keyboardWindow)))).toEqual([]);
  });

  it('per Window: the input host\'s edit-menu callout, laid after its inputView placeholder, is no presented layer', () => {
    const inputHost = win(el('Other', { isVisible: '0', children: [el('Other', { rawIdentifier: 'inputView', rect: rect(0, 566, 402, 308), isVisible: '0' })] }), el('Other', { children: [el('MenuItem', { label: 'Paste', rect: rect(150, 400, 80, 40) })] }));
    expect(marks(parseWdaSourceValue(app(win(screen('Form')), inputHost)))).toEqual([]);
  });
});

describe('UiNode.presentationsJudged — on the root: the source judged presented layers', () => {
  it('a payload carrying visibility flags is judged, whether or not anything is presented', () => {
    expect(parseWdaSourceValue(app(win(screen('Form')))).presentationsJudged).toBe(true);
    expect(parseWdaSourceValue(app(win(hiddenAll(screen('Contacts')), pageSheet()))).presentationsJudged).toBe(true);
  });

  it('a flagless payload (a hand-reduced fixture) is not judged, and no "screen" layer is marked in it — a typed one still is', () => {
    const tree = parseWdaSourceValue(flagless(app(win(screen('Contacts'), pageSheet()))));
    expect(tree.presentationsJudged).toBeUndefined();
    expect(marks(tree)).toEqual([]);
    const alert = parseWdaSourceValue(flagless(app(win(screen('Form'), el('Other', { children: [el('Alert', { label: 'Oops', rect: rect(41, 365, 320, 172) })] })))));
    expect(marks(alert)).toEqual([
      ['0,0 402x874', 'alert'],
      ['Oops', 'element'],
    ]);
  });
});
