import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, KEYBOARD_ROLE, rectsOverlap, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { rectCentre, rectWithin } from '../../src/ui-tree/geometry.js';
import { isInteractive } from '../../src/ui-tree/selectors.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';
import { CLASSIC_VIEWS } from '../helpers/synthetic-android-trees.js';
import { node as uiNode } from '../helpers/fake.js';

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

/**
 * The draw-order module's interface (ui-tree/draw-order.ts): its three
 * questions, each pinned on the device shapes its rows were measured on.
 */

/** mp-native's SWIFT form under idb at six scroll positions, rows under the top bar (device check C3-3, 2026-10-09). */
const PAD = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')) as { elements: unknown[] };
const MODAL = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')) as { screens: Record<string, unknown[]> };
const C33 = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-scrolled-under-top-bar.json', import.meta.url), 'utf8')) as { positions: Record<string, unknown[]> };

describe('shadowing — the later node drawn over a point (the dismissal picker\'s cover test)', () => {
  const P = { x: 100, y: 100 };
  /** A text node whose rect contains P, unless overridden. */
  const text = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'text', rect: { x: 50, y: 50, width: 100, height: 100 }, ...partial });
  const screen = (...children: UiNode[]): UiNode => uiNode({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children });
  const fullScreen = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'other', rect: { x: 0, y: 0, width: 400, height: 800 }, ...partial });

  it('the same node object at two places in the tree: either place is the node, never its own cover (the old walk\'s rule)', () => {
    const target = text({ label: 'title' });
    expect(drawOrder(screen(target, fullScreen({ children: [target] }))).shadowing(target, P)).toBeUndefined();
    const later = text({ label: 'later' });
    expect(drawOrder(screen(target, fullScreen({ children: [target, later] }))).shadowing(target, P)).toBe(later);
  });

  it('nothing after the node: undefined — the ancestor, an earlier sibling and the node\'s own descendant all contain the point and none counts', () => {
    const target = text({ label: 'title', children: [text({ label: 'inner' })] });
    expect(drawOrder(screen(text({ label: 'earlier' }), target)).shadowing(target, P)).toBeUndefined();
  });

  it('a later structural wrapper containing the point is not a cover (container or other), nor is a later zero-area node', () => {
    const target = text({ label: 'title' });
    const tree = screen(target, fullScreen(), fullScreen({ role: 'container' }), text({ rect: { x: 50, y: 50, width: 0, height: 100 } }));
    expect(drawOrder(tree).shadowing(target, P)).toBeUndefined();
  });

  it('a later non-structural node containing the point is the cover; with several, the LAST in pre-order — a later Window\'s content included', () => {
    const target = text({ label: 'title' });
    const alert = text({ label: 'Session expired' });
    const ok = uiNode({ role: 'button', label: 'OK', rect: { x: 90, y: 90, width: 20, height: 20 } });
    expect(drawOrder(screen(target, alert)).shadowing(target, P)).toBe(alert);
    const tree = screen(target, alert, fullScreen({ children: [ok] }), text({ rect: { x: 200, y: 200, width: 10, height: 10 } }));
    expect(drawOrder(tree).shadowing(target, P)).toBe(ok);
  });

  it('a later node that reaches the point only on its exclusive right/bottom edge is not a cover', () => {
    const target = text({ label: 'title' });
    expect(drawOrder(screen(target, text({ rect: { x: 0, y: 0, width: 100, height: 100 } }))).shadowing(target, P)).toBeUndefined();
  });

  it('keyboard-owned later nodes are NOT exempt: the band, and a key over the point, are covers (review 2026-10-07)', () => {
    const target = text({ label: 'title' });
    const band = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 50, width: 400, height: 335 } });
    const key = uiNode({ role: 'button', label: 'q', ofKeyboard: true, rect: { x: 90, y: 90, width: 20, height: 20 } });
    expect(drawOrder(screen(target, fullScreen({ ofKeyboard: true, children: [band] }))).shadowing(target, P)).toBe(band);
    expect(drawOrder(screen(target, fullScreen({ ofKeyboard: true, children: [band, key] }))).shadowing(target, P)).toBe(key);
  });

  it('a later screen-sized HOST is not a cover by itself — the WDA SwiftUI toolbar host (docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md)', () => {
    // The measured tree, abridged: the title in the top bar, then (pre-order) a 402×874 `toolbar 'Toolbar'`
    // holding a 402×874 container, then the host's hidden tab bar elsewhere.
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 200, y: 84 };
    const title = uiNode({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const form = uiNode({ role: 'container', rect: full, children: [uiNode({ role: 'button', label: 'Continue to summary', rect: { x: 24, y: 512, width: 354, height: 44 } })] });
    const toolbar = (rect = full) => uiNode({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect, children: [uiNode({ role: 'container', rect })] });
    const home = uiNode({ role: 'button', label: 'Home', rect: { x: 69, y: 711, width: 67, height: 52 } });
    const app = (...children: UiNode[]) => uiNode({ role: 'application', rect: full, children });
    expect(drawOrder(app(uiNode({ role: 'other', rect: full, children: [title, form, toolbar(), home] }))).shadowing(title, at)).toBeUndefined();
    // The screen is the ROOT's rect, not the largest: a tall scroll content (WDA keeps off-screen nodes) earlier in the tree does not shrink the host below it.
    const tall = uiNode({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 3000 } });
    // (A host with an item away from the point: an itemless toolbar is excused at any size, which would not pin the screen.)
    const withItem = uiNode({ role: 'toolbar', rect: full, children: [uiNode({ role: 'container', rect: full, children: [uiNode({ role: 'button', label: 'Done', rect: { x: 300, y: 800, width: 80, height: 40 } })] })] });
    expect(drawOrder(app(tall, title, withItem)).shadowing(title, at)).toBeUndefined();
    // An inset host (402×820, 94 % of the screen: a status-bar inset) is still a host.
    expect(drawOrder(app(title, toolbar({ x: 0, y: 54, width: 402, height: 820 }))).shadowing(title, { x: 200, y: 84 })).toBeUndefined();
    // Just under SCREEN_SIZED_FRACTION (0.9) it covers as itself: 402×786 is 89.9 % — given an item (elsewhere), since an
    // itemless toolbar covers at no size (2026-10-09, below).
    const underRect = { x: 0, y: 0, width: 402, height: 786 };
    const under = uiNode({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect: underRect, children: [uiNode({ role: 'container', rect: underRect, children: [home] })] });
    expect(drawOrder(app(title, under)).shadowing(title, at)).toBe(under);
  });

  it('the host rule\'s edge: exactly SCREEN_SIZED_FRACTION of the root is a host; a root with no rect falls back to the largest rect', () => {
    const target = text({ label: 'title' });
    // Each host holds one item away from the point: an itemless toolbar covers at no size (2026-10-09), and this pins the size rule.
    const item = () => uiNode({ role: 'button', label: 'Done', rect: { x: 300, y: 650, width: 80, height: 40 } });
    const host = (height: number) => uiNode({ role: 'toolbar', rect: { x: 0, y: 0, width: 400, height }, children: [uiNode({ role: 'container', rect: { x: 0, y: 0, width: 400, height }, children: [item()] })] });
    expect(drawOrder(screen(target, host(720))).shadowing(target, P)).toBeUndefined(); // 288000 = 0.9 × 320000
    const below = host(719);
    expect(drawOrder(screen(target, below)).shadowing(target, P)).toBe(below);
    const rootless = (h: UiNode) => uiNode({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [fullScreen(), target, h] });
    expect(drawOrder(rootless(host(800))).shadowing(target, P)).toBeUndefined();
    const small = host(700);
    expect(drawOrder(rootless(small)).shadowing(target, P)).toBe(small);
  });

  it('a screen-sized node that is interactive or childless still covers: a full-screen backdrop button (an RN transparent Modal\'s Pressable), an image, a text — but no longer a leaf toolbar (2026-10-09)', () => {
    const target = text({ label: 'title' });
    const rect = { x: 0, y: 0, width: 400, height: 800 };
    const backdrop = uiNode({ role: 'button', label: 'Close', rect, children: [text({ label: 'elsewhere', rect: { x: 0, y: 600, width: 400, height: 100 } })] });
    const image = uiNode({ role: 'image', rect });
    const leafText = text({ label: 'Terms', rect });
    expect(drawOrder(screen(target, backdrop)).shadowing(target, P)).toBe(backdrop);
    expect(drawOrder(screen(target, image)).shadowing(target, P)).toBe(image);
    expect(drawOrder(screen(target, leafText)).shadowing(target, P)).toBe(leafText);
    // FLIPPED 2026-10-09 (docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md): this pin said a
    // childless screen-sized `toolbar` covers. It was the generic childless-node rule written with a toolbar, never a
    // measured toolbar that covered; the one device shape of it — UIKit's Contacts sheet under WDA — draws nothing over the
    // title, and refused every dismissal there. A toolbar with no items is not a cover (the itemless-toolbar rule below).
    expect(drawOrder(screen(target, uiNode({ role: 'toolbar', rect }))).shadowing(target, P)).toBeUndefined();
  });

  /**
   * The Contacts "New Contact" sheet under WDA (UIKit, iPhone 17, iOS 27, 2026-10-09 05:30 UTC,
   * docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md), in pre-order after the title
   * `text 'New Contact' 149 89 104 22` (inside `container id:"New Contact" 0 78 402 54`): the form's `scrollable 0 62 402 812`
   * WITH children, then two `toolbar 'Toolbar'`s, `0 83 402 48` and `0 62 402 812`, EACH holding one empty `Other` →
   * `container` of its own rect (no label, value, identifier or children — the raw `/source` at 347e70d, the note's
   * Correction: the first fix built them childless and never held on the device); then the keyboard's band `0 573 402 301`.
   * Each toolbar alone contained the title's point (201,100) and refused the dismissal as covered.
   */
  describe('an itemless toolbar covers nothing, whatever its size (the Contacts sheet, 2026-10-09)', () => {
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 201, y: 100 };
    const BAR = { x: 0, y: 83, width: 402, height: 48 };
    const SHEET = { x: 0, y: 62, width: 402, height: 812 };
    const title = uiNode({ role: 'text', label: 'New Contact', rect: { x: 149, y: 89, width: 104, height: 22 } });
    const titleBox = uiNode({ role: 'container', identifier: 'New Contact', rect: { x: 0, y: 78, width: 402, height: 54 }, children: [title] });
    const form = uiNode({ role: 'scrollable', rect: SHEET, children: [uiNode({ role: 'textfield', identifier: 'First name', rect: { x: 20, y: 300, width: 360, height: 44 } })] });
    /** The measured shape by default: one empty same-rect frame. */
    const frame = (rect: UiNode['rect'], children: UiNode[] = []) => uiNode({ role: 'container', rect, children });
    const toolbar = (rect: UiNode['rect'], children: UiNode[] = [frame(rect)]) => uiNode({ role: 'toolbar', label: 'Toolbar', rect, children });
    const band = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 573, width: 402, height: 301 } });
    const app = (...after: UiNode[]) => uiNode({ role: 'application', rect: full, children: [uiNode({ role: 'other', rect: full, children: [titleBox, form, ...after] }), band] });

    it('the measured shape — both toolbars — and each alone: nothing covers the title', () => {
      expect(drawOrder(app(toolbar(BAR), toolbar(SHEET))).shadowing(title, at)).toBeUndefined();
      expect(drawOrder(app(toolbar(BAR))).shadowing(title, at)).toBeUndefined(); // the 48-pt one: a bar's size, which no screen-sized host rule would excuse
      expect(drawOrder(app(toolbar(SHEET))).shadowing(title, at)).toBeUndefined();
    });

    it('itemless is judged by content, not by child count: no child, or empty frames nested any depth, list no item', () => {
      expect(drawOrder(app(toolbar(BAR, []))).shadowing(title, at)).toBeUndefined();
      expect(drawOrder(app(toolbar(BAR, [frame(BAR, [frame(BAR), frame(BAR, [frame(BAR)])])]))).shadowing(title, at)).toBeUndefined();
    });

    it('`other` is not a frame: the role an iOS parser gives every type it does not map — a SegmentedControl, a Stepper — so an unlabelled one is an item (review round 1)', () => {
      const bar = toolbar(BAR, [frame(BAR, [uiNode({ role: 'other', rect: { x: 120, y: 90, width: 160, height: 32 } })])]);
      expect(drawOrder(app(bar)).shadowing(title, at)).toBe(bar);
      // Through the WDA parser: a Toolbar holding an unlabelled, childless SegmentedControl → `other` → the toolbar covers.
      const wdaRect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
      const parsed = parseWdaSource(
        JSON.stringify({
          type: 'Application', label: 'Contacts', rect: wdaRect(0, 0, 402, 874), children: [
            { type: 'StaticText', label: 'New Contact', rect: wdaRect(149, 89, 104, 22) },
            { type: 'Toolbar', label: 'Toolbar', rect: wdaRect(0, 83, 402, 48), children: [{ type: 'SegmentedControl', rect: wdaRect(120, 90, 160, 32) }] },
          ],
        }),
      );
      const nodes = [...everyNode(parsed)];
      const parsedTitle = nodes.find((n) => n.label === 'New Contact')!;
      const parsedBar = nodes.find((n) => n.role === 'toolbar')!;
      expect(parsedBar.children.map((c) => c.role)).toEqual(['other']);
      expect(drawOrder(parsed).shadowing(parsedTitle, at)).toBe(parsedBar);
    });

    it('a descendant that could be an item — labelled, valued, identified, or of any non-frame role, at any depth — and the toolbar covers as itself', () => {
      const elsewhere = { x: 300, y: 90, width: 80, height: 34 };
      const items = [
        uiNode({ role: 'container', label: 'Draft', rect: elsewhere }),
        uiNode({ role: 'other', value: '1', rect: elsewhere }),
        uiNode({ role: 'container', identifier: 'save', rect: elsewhere }),
        uiNode({ role: 'button', rect: elsewhere }), // an unlabelled control
        uiNode({ role: 'image', rect: elsewhere }), // an unlabelled icon
      ];
      for (const item of items) {
        const nested = toolbar(BAR, [frame(BAR, [frame(BAR, [item])])]);
        expect(drawOrder(app(nested)).shadowing(title, at)).toBe(nested);
      }
    });

    it('a toolbar with ANY item still covers as itself, at the bar\'s size — its item elsewhere, as the input-accessory bar\'s Done', () => {
      const withItem = toolbar(BAR, [uiNode({ role: 'button', label: 'Cancel', rect: { x: 16, y: 90, width: 60, height: 34 } })]);
      expect(drawOrder(app(withItem)).shadowing(title, at)).toBe(withItem);
      const item = uiNode({ role: 'text', label: 'Draft', rect: { x: 150, y: 90, width: 100, height: 20 } });
      expect(drawOrder(app(toolbar(SHEET, [item]))).shadowing(title, at)).toBe(item); // a screen-sized one: through its item at the point
    });

    it('the excuse is the toolbar\'s alone: a childless image or text of the same rect, and an interactive node, still cover', () => {
      const image = uiNode({ role: 'image', rect: BAR });
      const label = uiNode({ role: 'text', label: 'Toolbar', rect: BAR });
      const button = uiNode({ role: 'button', rect: BAR });
      for (const cover of [image, label, button]) expect(drawOrder(app(toolbar(BAR), cover)).shadowing(title, at)).toBe(cover);
    });

    it('the measured input-accessory toolbar (wda-source-myport-2fa-keyboard-toolbar.json: Toolbar → Other → Button "Done") still covers what it is drawn over', async () => {
      const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-2fa-keyboard-toolbar.json', import.meta.url), 'utf8'));
      const nodes = [...everyNode(tree)];
      const accessory = nodes.find((n) => n.role === 'toolbar')!;
      expect(accessory.rect).toEqual({ x: 0, y: 518, width: 402, height: 48 });
      expect(accessory.children.length).toBeGreaterThan(0);
      // The app's support text {16,547,370,40} runs under the bar's slot (518–566). With the keyboard's band (its Window,
      // after the accessory's) taken out, so that only the bar can answer: the bar is what is drawn over the text.
      const text = nodes.find((n) => n.label?.startsWith('Pri probléme'))!;
      const withoutBand = { ...tree, children: tree.children.filter((w) => ![...everyNode(w)].some((n) => n.role === KEYBOARD_ROLE)) };
      expect(drawOrder(withoutBand).shadowing(text, { x: 200, y: 550 })).toBe(accessory);
    });
  });

  it('a screen-sized host with content over the point still covers, through that content', () => {
    const target = text({ label: 'title' });
    const message = text({ label: 'Session expired' });
    const host = (...children: UiNode[]) => uiNode({ role: 'toolbar', rect: { x: 0, y: 0, width: 400, height: 800 }, children });
    expect(drawOrder(screen(target, host(message))).shadowing(target, P)).toBe(message);
    expect(drawOrder(screen(target, host(fullScreen({ children: [message] })))).shadowing(target, P)).toBe(message);
    // WDA's alert shape (Alert → container, structural) over the point: its text covers, as before.
    expect(drawOrder(screen(target, host(uiNode({ role: 'container', rect: { x: 60, y: 60, width: 280, height: 160 }, children: [message] })))).shadowing(target, P)).toBe(message);
    // The accepted trade-off: the same host with nothing of its own at the point reads as not covering.
    expect(drawOrder(screen(target, host(text({ label: 'elsewhere', rect: { x: 0, y: 600, width: 400, height: 100 } })))).shadowing(target, P)).toBeUndefined();
  });

  /**
   * The device check at e9e6509 (the same bug note, "Device check"): with the toolbar host excused, the form's
   * `scrollable 0 0 402 512` — after the title in pre-order, 58 % of the screen, its frame under the translucent top
   * bar, its first row at y 150 — covered the title at (201,84). The measured tree, in its full shape.
   */
  describe('a scroll view with content covers only through that content, whatever its size (device check 2026-10-08)', () => {
    const full = { x: 0, y: 0, width: 402, height: 874 };
    const at = { x: 201, y: 84 };
    const title = uiNode({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: { x: 135, y: 73, width: 131, height: 22 } });
    const row = (identifier: string, y: number) => uiNode({ role: 'button', identifier, rect: { x: 16, y, width: 370, height: 52 } });
    const form = (...extra: UiNode[]) =>
      uiNode({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 512 }, children: [row('swift_payment.form.debit_select', 150), row('swift_payment.form.priority_select', 681), ...extra] });
    const toolbar = () => uiNode({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', rect: full, children: [uiNode({ role: 'container', rect: full })] });
    const keyboard = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: { x: 0, y: 572, width: 402, height: 302 } });
    const app = (...screenChildren: UiNode[]) => uiNode({ role: 'application', rect: full, children: [uiNode({ role: 'other', rect: full, children: screenChildren }), keyboard] });

    it('the full measured shape — title, container, the form\'s scrollable, the screen-sized toolbar, the keyboard: nothing covers the title', () => {
      expect(drawOrder(app(title, uiNode({ role: 'container', rect: full, children: [form()] }), toolbar())).shadowing(title, at)).toBeUndefined();
    });

    it('the scrollable alone after the title (no toolbar to shadow it — the case the first test missed): not a cover', () => {
      expect(drawOrder(app(title, form())).shadowing(title, at)).toBeUndefined();
    });

    it('its content at the point still covers — a row scrolled under the title, a sheet\'s list text — and is what is named', () => {
      const under = uiNode({ role: 'text', label: 'Debit account', rect: { x: 16, y: 70, width: 370, height: 30 } });
      expect(drawOrder(app(title, form(under))).shadowing(title, at)).toBe(under);
      expect(drawOrder(app(title, form(under), toolbar())).shadowing(title, at)).toBe(under);
    });

    it('a childless scrollable, an interactive node of the same size, a same-sized webview with content and a smaller card still cover as themselves', () => {
      const rect = { x: 0, y: 0, width: 402, height: 512 };
      const elsewhere = () => [row('elsewhere', 400)];
      const empty = uiNode({ role: 'scrollable', rect });
      const backdrop = uiNode({ role: 'button', rect, children: elsewhere() });
      const web = uiNode({ role: 'webview', rect, children: elsewhere() });
      const card = uiNode({ role: 'toolbar', rect: { x: 20, y: 60, width: 362, height: 200 }, children: elsewhere() });
      for (const cover of [empty, backdrop, web, card]) expect(drawOrder(app(title, cover)).shadowing(title, at)).toBe(cover);
    });
  });
});

describe('drawnOver — the nodes drawn over a clipping container (the floating tab bar)', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const LIST = rect(0, 825, 1080, 1395);
  it('measured, mp-native Account Detail: the bar\'s unlabelled host and its tabs, after the list in the tree — never the list\'s own rows, nor anything before it, nor what misses it', () => {
    const row = uiNode({ role: 'container', identifier: 'transactions.list.row_0', rect: rect(0, 1112, 1080, 200), children: [uiNode({ role: 'other', label: 'Coffee', rect: rect(40, 1150, 400, 50) })] });
    const list = uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: [row] });
    const header = uiNode({ role: 'other', label: 'Account', rect: rect(0, 300, 1080, 500) }); // before the list, and beside it
    const tab = uiNode({ role: 'container', identifier: 'nav.tab_home', rect: rect(66, 1876, 237, 176), children: [uiNode({ role: 'other', label: 'Home', rect: rect(100, 1990, 160, 40) })] });
    const host = uiNode({ role: 'container', rect: rect(66, 1840, 948, 248), children: [tab] });
    const above = uiNode({ role: 'other', label: 'Toast', rect: rect(0, 100, 1080, 100) }); // after, but misses the list
    const root = uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [header, list, host, above] });
    expect(drawOrder(root).drawnOver(LIST)).toEqual([host, tab, tab.children[0]]);
  });
  it('draws nothing: no area, an empty structural leaf (a spacer), a screen-sized host (its content is judged), the keyboard\'s own subtree — and a rect of no clipping node in this tree is undefined, not empty', () => {
    const list = uiNode({ role: 'container', rect: LIST, clipsDescendants: true });
    const spacer = uiNode({ role: 'other', rect: rect(0, 1900, 1080, 100) });
    const flat = uiNode({ role: 'text', label: 'x', rect: rect(0, 1900, 0, 100) });
    const card = uiNode({ role: 'other', label: 'Snack', rect: rect(40, 1900, 1000, 120) });
    const layer = uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [card] });
    const keys = uiNode({ role: 'container', rect: rect(0, 1398, 1080, 822), ofKeyboard: true, children: [uiNode({ role: 'button', label: 'q', rect: rect(0, 1500, 100, 100) })] });
    const root = uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [list, spacer, flat, layer, keys] });
    expect(drawOrder(root).drawnOver(LIST)).toEqual([card]);
    expect(drawOrder(root).drawnOver(rect(0, 825, 1080, 1000))).toBeUndefined(); // not asked of this tree — told apart from "nothing over it"
  });
  it('the container is never the keyboard\'s own: a keyboard-marked clipping node of the rect is passed over — undefined alone, the later one of that rect otherwise', () => {
    const card = () => uiNode({ role: 'other', label: 'Snack', rect: rect(40, 1900, 1000, 120) });
    const keyboardList = uiNode({ role: 'container', rect: LIST, clipsDescendants: true, ofKeyboard: true });
    const afterKeyboard = card();
    expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [keyboardList, afterKeyboard] })).drawnOver(LIST)).toBeUndefined();
    const list = uiNode({ role: 'container', rect: LIST, clipsDescendants: true });
    const afterList = card();
    expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [keyboardList, afterKeyboard, list, afterList] })).drawnOver(LIST)).toEqual([afterList]);
  });
  it('of two clipping nodes of the same rect, the OUTERMOST is the container: what is inside it after the inner one scrolls with it, not over it', () => {
    const sibling = uiNode({ role: 'other', label: 'Footer', rect: rect(40, 1900, 1000, 120) });
    const outer = uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: [uiNode({ role: 'container', rect: LIST, clipsDescendants: true }), sibling] });
    const over = uiNode({ role: 'other', label: 'Bar', rect: rect(40, 2000, 1000, 120) });
    expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [outer, over] })).drawnOver(LIST)).toEqual([over]);
  });
});

describe('drawnOverAt — the node drawn over a container at a touch-down (the exhausted stop\'s sentence)', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const LIST = rect(0, 825, 1080, 1395);
  const tab = uiNode({ role: 'container', label: 'Home', identifier: 'nav.tab_home', rect: rect(66, 1876, 237, 176) });
  const host = uiNode({ role: 'container', rect: rect(66, 1840, 948, 248), children: [tab] });
  const tree = (...over: UiNode[]) =>
    uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [uiNode({ role: 'container', rect: LIST, clipsDescendants: true }), ...over] });

  it('the last drawn over the container that contains the point — the tab over its host; the host above its tabs (y 1857, measured)', () => {
    expect(drawOrder(tree(host)).drawnOverAt(LIST, { x: 150, y: 1900 })).toBe(tab);
    expect(drawOrder(tree(host)).drawnOverAt(LIST, { x: 540, y: 1857 })).toBe(host);
    expect(drawOrder(tree(host)).drawnOverAt(LIST, { x: 540, y: 1200 })).toBeUndefined();
  });

  it('a node whose rect holds the container whole is no evidence of a cover: not named — the next one down is', () => {
    const wrapper = uiNode({ role: 'container', label: 'w', rect: rect(0, 825, 1080, 1395) });
    expect(drawOrder(tree(host, wrapper)).drawnOverAt(LIST, { x: 540, y: 1857 })).toBe(host);
    expect(drawOrder(tree(wrapper)).drawnOverAt(LIST, { x: 540, y: 1857 })).toBeUndefined();
  });

  it('undefined when this tree holds no container of that rect (the list moved)', () => {
    expect(drawOrder(tree(host)).drawnOverAt(rect(0, 401, 1080, 1819), { x: 540, y: 1857 })).toBeUndefined();
  });
});

describe('coversOf — what is drawn over a region of a node as a target, wherever the region lies (the uiautomator parser\'s widening)', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const LIST = rect(0, 401, 1080, 1753);
  /** Account Detail's row_0 as dumped (cut at its sticky header's bottom, 480), and the strip its own content says it reaches above that. */
  const row = () => uiNode({ role: 'container', identifier: 'row_0', rect: rect(66, 480, 948, 66), children: [uiNode({ role: 'button', rect: rect(66, 403, 948, 143) })] });
  const STRIP = rect(66, 403, 948, 77);
  /** The Android screen: a list holding `inList`, then `after` listed after it; the source's mark on the root, as the parser sets it. */
  const screen = (inList: UiNode[], ...after: UiNode[]) =>
    uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), paddedTouchTargets: true, children: [uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: inList }), ...after] });
  const header = () => uiNode({ role: 'container', identifier: 'date_header_0', rect: rect(0, 401, 1080, 79), children: [uiNode({ role: 'text', label: '17.07.2026', rect: rect(66, 415, 220, 50) })] });

  it('a region OUTSIDE the node\'s rect: the sticky header listed after the row, with its text, is drawn over the strip — where exposure, cut to the row\'s own rect, sees nothing', () => {
    const r = row();
    const h = header();
    const order = drawOrder(screen([r, h]));
    expect(order.coversOf(r, STRIP)).toEqual([h, h.children[0]]);
    expect(order.exposure(r, rect(0, 0, 1080, 2220)).covers).toEqual([]);
  });

  it('only what meets the region with area, and only what is listed after the node: the header listed BEFORE the row covers nothing; a region clear of it neither', () => {
    const r = row();
    const h = header();
    expect(drawOrder(screen([h, r])).coversOf(r, STRIP)).toEqual([]);
    expect(drawOrder(screen([r, h])).coversOf(r, rect(66, 546, 948, 40))).toEqual([]);
    expect(drawOrder(screen([r, h])).coversOf(r, rect(66, 480, 948, 0))).toEqual([]);
  });

  it('a screen-sized host listed after it (a Compose snackbar host) draws nothing there — its snackbar elsewhere neither', () => {
    const r = row();
    const snackbar = uiNode({ role: 'container', label: 'Saved', rect: rect(30, 2050, 1020, 130) });
    const host = uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [snackbar] });
    expect(drawOrder(screen([r], host)).coversOf(r, STRIP)).toEqual([]);
  });

  it('the TARGET column, not the container one: a layer the list\'s size listed after it, holding the row\'s list whole, its button elsewhere (a FAB host), draws nothing on the strip', () => {
    const r = row();
    const fab = uiNode({ role: 'button', label: 'Add', rect: rect(900, 2000, 120, 120) });
    const layer = uiNode({ role: 'container', rect: LIST, children: [fab] });
    const order = drawOrder(screen([r], layer));
    expect(order.coversOf(r, STRIP)).toEqual([]);
    expect(order.drawnOver(LIST)).toContain(layer); // drawn over the list as a container: the column coversOf does not read
  });

  it('a bare structural overlay — childless, no label, no value, only an id — draws nothing either', () => {
    const r = row();
    expect(drawOrder(screen([r], uiNode({ role: 'other', identifier: 'overlay', rect: LIST }))).coversOf(r, STRIP)).toEqual([]);
  });

  it('the same overlay saying something is drawn: a label, or a child that draws', () => {
    const r = row();
    const labelled = uiNode({ role: 'other', identifier: 'overlay', label: 'Header', rect: LIST });
    expect(drawOrder(screen([r], labelled)).coversOf(r, STRIP)).toEqual([labelled]);
    const tab = uiNode({ role: 'container', label: 'Home', rect: rect(102, 410, 219, 60) });
    const host = uiNode({ role: 'container', identifier: 'tabs', rect: rect(66, 400, 948, 100), children: [tab] });
    expect(drawOrder(screen([r], host)).coversOf(r, STRIP)).toEqual([host, tab]);
  });

  it('a node of another tree has no covers', () => {
    expect(drawOrder(screen([row(), header()])).coversOf(row(), STRIP)).toEqual([]);
  });
});

/**
 * Where the three questions read `NOT_DRAWN` differently, each kept as its caller has been measured against:
 * one node, the same tree, three answers. Unifying a row is a behaviour change, judged per row.
 */
describe('the three questions disagree on purpose, per row', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const SCREEN = rect(0, 0, 400, 800);
  const LIST = rect(0, 0, 400, 600);
  const P = { x: 200, y: 300 };
  /** A clipping list holding the point's target, then `later` drawn after it — after the list, or `beside` the target inside it. */
  const ask = (later: UiNode, beside = false) => {
    const target = uiNode({ role: 'text', label: 'title', rect: rect(150, 280, 100, 40) });
    const list = uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: beside ? [target, later] : [target] });
    const tree = uiNode({ role: 'application', rect: SCREEN, children: beside ? [list] : [list, later] });
    const order = drawOrder(tree);
    return { shadowing: order.shadowing(target, P), drawnOver: order.drawnOver(LIST), target: order.exposure(target, SCREEN).covers };
  };
  const card = rect(100, 250, 200, 100);
  /** Overlaps the target (150,280 100x40) without holding it whole. */
  const strip = rect(100, 300, 200, 50);

  /** What the Compose tab-bar host holds: a tab, an identified `container` (its content off the target here). */
  const tab = () => uiNode({ role: 'container', identifier: 'nav.tab_home', rect: rect(0, 700, 10, 10) });

  it('structural: an unlabelled `container` with children is no cover at a point, but is drawn over a container (the Compose tab-bar host) and over a target it does not hold whole', () => {
    const later = uiNode({ role: 'container', rect: strip, children: [tab()] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [later] });
  });

  it('structural, holding nothing but empty frames: no cover of a target — it carries nothing drawable (round 7: WDA\'s grouped cell background) — but drawn over a container, as a leaf is not', () => {
    const later = uiNode({ role: 'container', rect: strip, children: [uiNode({ role: 'container', rect: strip, children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later, later.children[0]], target: [] });
  });

  it('structural, holding the target AND its scroll view whole: judged through its content for a target — a WDA `Other` frame laid after the form', () => {
    const later = uiNode({ role: 'container', rect: rect(0, 0, 400, 650), children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [] });
  });

  it('structural, holding the target whole but not its scroll view nor the screen: a bar\'s host, a cover (review round 1: the Compose host over a small target above its tabs)', () => {
    const later = uiNode({ role: 'container', rect: card, children: [tab()] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [later] });
  });

  it('screen-sized host: an interactive one covers a point and a target, but is never drawn over a container', () => {
    const later = uiNode({ role: 'button', label: 'Close', rect: SCREEN, children: [uiNode({ role: 'text', label: 'x', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: later, drawnOver: [], target: [later] });
  });

  it('content-framed: a `scrollable` with children covers a point or a target only through them, but is drawn over a container', () => {
    const later = uiNode({ role: 'scrollable', rect: card, children: [uiNode({ role: 'text', label: 'row', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [] });
  });

  it('scrolled content: a later scroll view\'s row over the target covers a point and is drawn over a container, but is no cover of a target outside that scroll view', () => {
    const row = uiNode({ role: 'text', label: 'row', rect: strip });
    const later = uiNode({ role: 'scrollable', rect: card, children: [row] });
    expect(ask(later)).toEqual({ shadowing: row, drawnOver: [later, row], target: [] });
  });

  it('itemless toolbar: no cover at a point or of a target, but drawn over a container', () => {
    const later = uiNode({ role: 'toolbar', rect: card, children: [uiNode({ role: 'container', rect: card })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [] });
  });

  it('keyboard: its own nodes cover a point, but are left out of what is drawn over a container and over a target', () => {
    const later = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: card });
    expect(ask(later)).toEqual({ shadowing: later, drawnOver: [], target: [] });
  });

  it('same frame: a node of exactly the target\'s rect covers a point and is drawn over a container, but is the target listed again (idb\'s twins), no cover of it', () => {
    const later = uiNode({ role: 'button', label: 'twin', rect: rect(150, 280, 100, 40) });
    expect(ask(later)).toEqual({ shadowing: later, drawnOver: [later], target: [] });
  });

  it('on the target: a non-interactive SIBLING lying wholly inside the target is drawn on it (a floating label; in idb\'s flat list it must also repeat the target) — a cover at a point, not of the target; drawn over the list it is not, being in it', () => {
    const label = () => uiNode({ role: 'text', label: 'IBAN', rect: rect(160, 285, 50, 20) });
    const sibling = label();
    expect(ask(sibling, true)).toEqual({ shadowing: sibling, drawnOver: [], target: [] });
    const button = uiNode({ role: 'button', label: 'clear', rect: rect(160, 285, 50, 20) });
    expect(ask(button, true)).toEqual({ shadowing: button, drawnOver: [], target: [button] });
    // Not a sibling — after the list, inside the target's rect: a cover's part, so a cover.
    const elsewhere = label();
    expect(ask(elsewhere)).toEqual({ shadowing: elsewhere, drawnOver: [elsewhere], target: [elsewhere] });
  });

  it('own control: an unlabelled interactive SIBLING holding a non-interactive target whole and spanning their wrapper\'s width (a Compose Button\'s clickable over its label) — a cover at a point, not of the target; drawn over the list it is not, being in it', () => {
    const target = uiNode({ role: 'text', label: 'title', rect: rect(150, 280, 100, 40) });
    const control = uiNode({ role: 'button', rect: rect(140, 272, 120, 56) });
    const wrapper = uiNode({ role: 'container', rect: rect(140, 270, 120, 60), children: [target, control] });
    const order = drawOrder(uiNode({ role: 'application', rect: SCREEN, children: [uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: [wrapper] })] }));
    expect({ shadowing: order.shadowing(target, P), drawnOver: order.drawnOver(LIST), target: order.exposure(target, SCREEN).covers }).toEqual({ shadowing: control, drawnOver: [], target: [] });
    // The same control laid in the list beside the target: it does not span the list's width — a cover.
    const pinned = uiNode({ role: 'button', rect: rect(140, 270, 120, 60) });
    expect(ask(pinned, true)).toEqual({ shadowing: pinned, drawnOver: [], target: [pinned] });
    // After the list, holding the target: no sibling — a bar's button, a cover.
    const bar = uiNode({ role: 'button', rect: rect(140, 270, 120, 60) });
    expect(ask(bar)).toEqual({ shadowing: bar, drawnOver: [bar], target: [bar] });
  });
});

/**
 * `exposure(node, within)` — what of a tap or scroll target shows inside the box its caller judges in (the screen, cut
 * above a witnessed keyboard), and where a tap on it should go (docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-
 * app-chrome.md). Each case is a measured shape from that note's device checks, abridged.
 */
describe('exposure — what of a target shows, and where a tap on it goes', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const IPHONE = rect(0, 0, 402, 874);
  const PIXEL = rect(0, 0, 1080, 2220);
  /** The CONTINUE bar, measured at `24,780 354x44` (both tree sources). */
  const CONTINUE = rect(24, 780, 354, 44);
  const continueButton = () => uiNode({ role: 'button', label: 'Continue to summary', identifier: 'swift_payment.form.continue_button', rect: CONTINUE });
  const priority = (y: number) => uiNode({ role: 'button', identifier: 'swift_payment.form.priority_select', rect: rect(24, y, 354, 52) });
  /** idb's FLAT list under a 0×0 root (adapters/ios-tree-source.ts#parseIdbDescribeAll): the Application first, CONTINUE last. */
  const idbForm = (...rows: UiNode[]) =>
    uiNode({
      role: 'container',
      rect: rect(0, 0, 0, 0),
      children: [
        uiNode({ role: 'other', label: 'mp-native', rect: IPHONE }),
        uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) }),
        uiNode({ role: 'text', label: 'SWIFT PAYMENT', identifier: 'swift_payment.form.title', rect: rect(136, 74, 130, 20) }),
        ...rows,
        continueButton(),
      ],
    });

  describe('mp-native SWIFT form, idb (2026-10-09 06:07 UTC): priority_select under the CONTINUE bar', () => {
    it('at rest, y 771: only its top 9 pt show — under the minimum, so no tap point; CONTINUE is the cover at its centre (201,797)', () => {
      const row = priority(771);
      const tree = idbForm(row);
      const seen = drawOrder(tree).exposure(row, IPHONE);
      expect(seen.covers.map((n) => n.identifier)).toEqual(['swift_payment.form.continue_button']);
      expect(seen.largest).toEqual(rect(24, 771, 354, 9));
      expect(seen.shows).toBeCloseTo(9 / 52);
      expect(seen.tapAt).toBeUndefined();
      expect(seen.minPiece).toBe(24); // 0.06 × 402, rounded
      expect(seen.coverAt({ x: 201, y: 797 })?.identifier).toBe('swift_payment.form.continue_button');
    });

    it('at y 763 a 17-pt strip shows — still under 24, refused; at y 754 a 26-pt strip, the centre (201,780) on the bar — the tap moves to the strip', () => {
      const at763 = priority(763);
      expect(drawOrder(idbForm(at763)).exposure(at763, IPHONE).tapAt).toBeUndefined();
      const at754 = priority(754);
      const seen = drawOrder(idbForm(at754)).exposure(at754, IPHONE);
      expect(seen.largest).toEqual(rect(24, 754, 354, 26));
      expect(seen.tapAt).toEqual({ point: { x: 201, y: 767 }, moved: true, piece: rect(24, 754, 354, 26) });
      // One point higher the centre (201,779) is clear of the bar: tapped where it always was.
      const at753 = priority(753);
      expect(drawOrder(idbForm(at753)).exposure(at753, IPHONE).tapAt).toEqual({ point: { x: 201, y: 779 }, moved: false });
    });

    it('scrolled clear of the bar (the manual swipe, row at y 452): nothing over it, the centre tapped as always', () => {
      const row = priority(452);
      const seen = drawOrder(idbForm(row)).exposure(row, IPHONE);
      expect(seen).toMatchObject({ covers: [], shows: 1, tapAt: { point: { x: 201, y: 478 }, moved: false } });
      expect(seen.largest).toEqual(row.rect);
    });

    it('the shape through the idb parser (tests/fixtures/idb-swift-form-continue.json): the same answer', async () => {
      const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
      const row = [...everyNode(tree)].find((n) => n.identifier === 'swift_payment.form.priority_select')!;
      const seen = drawOrder(tree).exposure(row, IPHONE);
      expect(seen.covers.map((n) => n.label)).toEqual(['Continue to summary']);
      expect(seen.tapAt).toBeUndefined();
    });
  });

  it('mp-native SWIFT form, WDA: the bar after the form\'s scroll view in a full-screen container, the toolbar host after it — CONTINUE alone covers', () => {
    const row = priority(771);
    const form = uiNode({ role: 'scrollable', rect: rect(0, 116, 402, 664), children: [priority(150), row] });
    const toolbar = uiNode({ role: 'toolbar', label: 'Toolbar', rect: IPHONE, children: [uiNode({ role: 'container', rect: IPHONE })] });
    const bar = continueButton();
    const tree = uiNode({
      role: 'application',
      rect: IPHONE,
      children: [uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'text', label: 'SWIFT PAYMENT', rect: rect(135, 73, 131, 22) }), uiNode({ role: 'container', rect: IPHONE, children: [form, bar] }), toolbar] })],
    });
    expect(drawOrder(tree).exposure(row, IPHONE).covers).toEqual([bar]);
  });

  it('a cover in the middle of a target: the centre is covered, the largest piece beside it is tapped; a cover holding it whole leaves nothing', () => {
    const target = uiNode({ role: 'button', label: 'Wide', rect: rect(0, 100, 400, 100) });
    const badge = uiNode({ role: 'button', label: 'badge', rect: rect(150, 80, 100, 140) }); // across it, top to bottom
    const seen = drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 400, 800), children: [target, badge] })).exposure(target, rect(0, 0, 400, 800));
    expect(seen.largest).toEqual(rect(0, 100, 150, 100)); // of two equal pieces, the first found
    expect(seen.tapAt).toEqual({ point: { x: 75, y: 150 }, moved: true, piece: rect(0, 100, 150, 100) });
    expect(seen.shows).toBeCloseTo(0.75);
    const sheet = uiNode({ role: 'image', label: 'sheet', rect: rect(0, 0, 400, 800) });
    const gone = drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 400, 800), children: [target, sheet] })).exposure(target, rect(0, 0, 400, 800));
    expect(gone).toMatchObject({ shows: 0, covers: [sheet] });
    expect([gone.largest, gone.tapAt]).toEqual([undefined, undefined]);
  });

  it('`within` cuts both ways: what lies outside it neither shows nor covers — a node under the keyboard band, a bar below the cut', () => {
    const target = uiNode({ role: 'button', label: 'Row', rect: rect(0, 500, 400, 100) });
    const bar = uiNode({ role: 'button', label: 'Bar', rect: rect(0, 580, 400, 60) });
    const tree = uiNode({ role: 'container', rect: rect(0, 0, 400, 800), children: [target, bar] });
    const above = rect(0, 0, 400, 560); // the screen above a band whose top is at 560
    const seen = drawOrder(tree).exposure(target, above);
    expect(seen).toMatchObject({ covers: [], shows: 0.6, tapAt: { point: { x: 200, y: 550 }, moved: false } });
    // The bar reaching up past the cut: only its part within counts, and the centre (200,550) is under it — the tap moves up.
    const tall = uiNode({ role: 'button', label: 'Bar', rect: rect(0, 540, 400, 100) });
    const cut = drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 400, 800), children: [target, tall] })).exposure(target, above);
    expect(cut).toMatchObject({ covers: [tall], largest: rect(0, 500, 400, 40), tapAt: { point: { x: 200, y: 520 }, moved: true } });
    // A centre outside `within` (under the cut) with nothing over it is still no tap point: the tap moves into what shows.
    const lower = rect(0, 0, 400, 540);
    expect(drawOrder(tree).exposure(target, lower).tapAt).toEqual({ point: { x: 200, y: 520 }, moved: true, piece: rect(0, 500, 400, 40) });
    const outside = drawOrder(tree).exposure(target, rect(0, 0, 400, 400));
    expect(outside).toMatchObject({ shows: 0, covers: [] });
    expect(outside.tapAt).toBeUndefined();
  });

  it('a node not in this tree: nothing is known over it — its part within shows, its centre is its tap point', () => {
    const stranger = uiNode({ role: 'button', rect: rect(0, 0, 100, 100) });
    expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 400, 800) })).exposure(stranger, rect(0, 0, 400, 800))).toMatchObject({
      covers: [],
      shows: 1,
      tapAt: { point: { x: 50, y: 50 }, moved: false },
    });
  });

  it('coverAt names the cover drawn on top at a point — the last in pre-order that contains it — and nothing off the covers', () => {
    const target = uiNode({ role: 'button', label: 'Row', rect: rect(0, 500, 400, 100) });
    const host = uiNode({ role: 'container', rect: rect(0, 540, 400, 100), children: [uiNode({ role: 'button', label: 'Home', rect: rect(0, 560, 100, 80) })] });
    const seen = drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 400, 800), children: [target, host] })).exposure(target, rect(0, 0, 400, 800));
    expect(seen.coverAt({ x: 50, y: 580 })?.label).toBe('Home');
    expect(seen.coverAt({ x: 200, y: 580 })).toBe(host);
    expect(seen.coverAt({ x: 200, y: 520 })).toBeUndefined();
  });

  it('Compose Account Detail (2026-10-09): a row under the floating tab bar\'s host — host and tabs cover it; the tab itself has nothing over it', () => {
    const row = uiNode({ role: 'container', identifier: 'transactions.list.row_3', rect: rect(0, 1840, 1080, 200) });
    const list = uiNode({ role: 'container', rect: rect(0, 825, 1080, 1395), clipsDescendants: true, children: [row] });
    const tab = uiNode({ role: 'container', identifier: 'nav.tab_home', rect: rect(66, 1876, 237, 176), children: [uiNode({ role: 'other', label: 'Home', rect: rect(100, 1990, 160, 40) })] });
    const host = uiNode({ role: 'container', rect: rect(66, 1840, 948, 248), children: [tab] });
    const order = drawOrder(uiNode({ role: 'container', rect: PIXEL, children: [list, host] }));
    const seen = order.exposure(row, PIXEL);
    expect(seen.covers).toEqual([host, tab, tab.children[0]]);
    expect(seen.minPiece).toBe(65); // 0.06 × 1080, rounded
    expect(seen.tapAt).toEqual({ point: { x: 33, y: 1940 }, moved: true, piece: rect(0, 1840, 66, 200) }); // the 66-px column left of the host
    expect(order.exposure(tab, PIXEL).covers).toEqual([]);
    // A small target above the tabs, wholly inside the host (review round 1): the host holds it, but neither its list nor
    // the screen — still a cover, at the band where the touch-down at y 1857 was swallowed.
    const amount = uiNode({ role: 'text', label: '-12,00 €', rect: rect(800, 1845, 200, 30) });
    const small = drawOrder(uiNode({ role: 'container', rect: PIXEL, children: [uiNode({ role: 'container', rect: rect(0, 825, 1080, 1395), clipsDescendants: true, children: [amount] }), host] }));
    expect(small.exposure(amount, PIXEL).covers).toEqual([host]);
  });

  it('Android Contacts editor (2026-10-09 05:05 UTC): First name under the top app bar laid after the form — its 38-px strip is refused', () => {
    const firstName = uiNode({ role: 'textfield', label: 'First name', rect: rect(132, 118, 816, 160) });
    const form = uiNode({ role: 'container', rect: rect(0, 66, 1080, 2154), clipsDescendants: true, children: [firstName] });
    const save = uiNode({ role: 'button', label: 'Save', rect: rect(830, 100, 200, 120) });
    const bar = uiNode({ role: 'container', rect: rect(0, 66, 1080, 174), children: [uiNode({ role: 'text', label: 'Create contact', rect: rect(200, 120, 400, 60) }), save] });
    const order = drawOrder(uiNode({ role: 'container', rect: PIXEL, children: [form, bar] }));
    const seen = order.exposure(firstName, PIXEL);
    expect(seen.largest).toEqual(rect(132, 240, 816, 38));
    expect(seen.tapAt).toBeUndefined();
    expect(seen.coverAt({ x: 540, y: 198 })).toBe(bar);
  });

  describe('a floating tab bar covers what lies outside it, whatever the listing order (docs/bugs/2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md)', () => {
    /** mp-native Account Detail, iPhone 17 (idb and WDA, 2026-10-09 21:11 UTC): the four tab items, `37,755 82x64` … `283,755 82x64`. */
    const tabs = () => ['home', 'transactions', 'cards', 'more'].map((id, i) => uiNode({ role: 'button', label: id, identifier: `nav.tab_${id}`, rect: rect(37 + 82 * i, 755, 82, 64) }));
    /** `transactions.list.row_3 24,721 354x52`, its centre (201,747) in the pill the bar draws ≈12 pt above its buttons. */
    const row3 = () => uiNode({ role: 'button', identifier: 'transactions.list.row_3', rect: rect(24, 721, 354, 52) });
    const title = () => uiNode({ role: 'text', label: 'Account', rect: rect(150, 70, 100, 22) });
    /** idb's flat list, as measured: the Application, the tab items FIRST, then the content. */
    const idb = (...content: UiNode[]) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', label: 'mp-native', rect: IPHONE }), ...tabs(), ...content] });

    it('measured, idb (tabs listed before the content): row_3 is under the tab items and their reach 0.2 × 64 ≈ 13 pt above them — the 21-pt strip above is under the minimum, so it is refused; the cover at its centre is the Cards item, whose column x 201 the tap pressed', () => {
      const row = row3();
      const tree = idb(title(), row);
      const seen = drawOrder(tree).exposure(row, IPHONE);
      expect(seen.covers.map((n) => n.identifier)).toEqual(['nav.tab_home', 'nav.tab_transactions', 'nav.tab_cards', 'nav.tab_more']);
      expect(seen.reaches).toEqual([rect(37, 742, 82, 77), rect(119, 742, 82, 77), rect(201, 742, 82, 77), rect(283, 742, 82, 77)]);
      expect(seen.centreCover?.identifier).toBe('nav.tab_cards');
      expect(seen.largest).toEqual(rect(24, 721, 354, 21));
      expect(seen.tapAt).toBeUndefined();
    });

    it('measured, WDA (the row, then the four tab buttons, no bar): the same — the reach above the buttons is the pill\'s, not their frames\'', () => {
      const row = row3();
      const tree = uiNode({
        role: 'application',
        rect: IPHONE,
        children: [uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: rect(0, 0, 402, 874), children: [row] }), uiNode({ role: 'container', rect: rect(0, 0, 402, 874), children: tabs() })] })],
      });
      const seen = drawOrder(tree).exposure(row, IPHONE);
      expect(seen.centreCover?.identifier).toBe('nav.tab_cards');
      expect(seen.tapAt).toBeUndefined();
    });

    it('whatever the order: the tab items listed last cover row_3 the same; a row clear of the reach (bottom at 742) has nothing over it, in either order', () => {
      const row = row3();
      const last = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', label: 'mp-native', rect: IPHONE }), title(), row, ...tabs()] });
      expect(drawOrder(last).exposure(row, IPHONE)).toMatchObject({ reaches: [37, 119, 201, 283].map((x) => rect(x, 742, 82, 77)), centreCover: { identifier: 'nav.tab_cards' } });
      const clear = uiNode({ role: 'button', identifier: 'transactions.list.row_2', rect: rect(24, 690, 354, 52) });
      expect(drawOrder(idb(title(), clear)).exposure(clear, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { moved: false } });
      const clearLast = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), title(), clear, ...tabs()] });
      expect(drawOrder(clearLast).exposure(clear, IPHONE).covers).toEqual([]);
    });

    it('a row with its centre above the reach is tapped there; one with its centre in it is moved to a fingertip\'s piece above, or refused — never sent onto a tab', () => {
      const at = (y: number) => uiNode({ role: 'button', identifier: 'row', rect: rect(24, y, 354, 52) });
      const moved = at(712); // centre 738 clear of the reach (742); a cover only over its bottom 22 pt
      expect(drawOrder(idb(title(), moved)).exposure(moved, IPHONE).tapAt).toEqual({ point: { x: 201, y: 738 }, moved: false });
      const lower = at(725); // centre 751 in the reach; the 17-pt strip above is too thin
      expect(drawOrder(idb(title(), lower)).exposure(lower, IPHONE).tapAt).toBeUndefined();
      const tall = uiNode({ role: 'button', identifier: 'card', rect: rect(24, 690, 354, 80) }); // centre 730 clear
      expect(drawOrder(idb(title(), tall)).exposure(tall, IPHONE).tapAt).toMatchObject({ moved: false });
      const tallLow = uiNode({ role: 'button', identifier: 'card', rect: rect(24, 700, 354, 90) }); // centre 745 under the reach: moved to the 42-pt strip above it
      expect(drawOrder(idb(title(), tallLow)).exposure(tallLow, IPHONE).tapAt).toEqual({ point: { x: 201, y: 721 }, moved: true, piece: rect(24, 700, 354, 42) });
    });

    it('the tab items themselves stay tappable (device check M-1.5): a tab, its own label inside it, nothing of the bar over them — rows listed after the tabs are no cover of them', () => {
      // row_4 runs under the bar, the list on past the screen (`date_header_5` at 876, as measured: so row_4 is not pinned).
      const tree = idb(title(), row3(), uiNode({ role: 'button', identifier: 'transactions.list.row_4', rect: rect(24, 817, 354, 52) }), uiNode({ role: 'text', identifier: 'transactions.list.date_header_5', rect: rect(0, 876, 402, 30) }));
      const order = drawOrder(tree);
      for (const tab of tree.children.filter((n) => n.identifier?.startsWith('nav.tab_'))) expect(order.exposure(tab, IPHONE)).toMatchObject({ covers: [], tapAt: { moved: false } });
      // WDA: a tab's label inside its button — the bar's own; the items beside it are no cover.
      const label = uiNode({ role: 'text', label: 'Cards', rect: rect(220, 795, 44, 14) });
      const items = tabs();
      items[2] = uiNode({ ...items[2], children: [label] });
      const wda = uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: IPHONE, children: [row3()] }), uiNode({ role: 'container', rect: IPHONE, children: items })] });
      expect(drawOrder(wda).exposure(label, IPHONE).covers).toEqual([]);
    });

    it('the shape, and nothing short of it: two items, items of unequal height or y, overlapping items, items spanning under 60 % of the width, or ending above the screen\'s lowest 10 %, are no tab bar — row_3 reads clear of their frames, as before', () => {
      const row = row3();
      const with_ = (items: UiNode[]) => drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), ...items, title(), row] })).exposure(row, IPHONE);
      const item = (x: number, y = 755, w = 82, h = 64) => uiNode({ role: 'button', label: `i${x}`, rect: rect(x, y, w, h) });
      expect(with_([item(37), item(119), item(201), item(283)]).covers).toHaveLength(4); // the control: the shape
      for (const items of [
        [item(37, 755, 160), item(201, 755, 160)], // two, wide enough together (320 of 402)
        [item(37), item(119, 755, 82, 60), item(201), item(283, 755, 82, 60)], // two and two of unequal height
        [item(37), item(119, 756), item(201), item(283, 756)], // two and two at unequal y
        [item(37), item(100), item(201), item(283)], // overlapping
        [item(37, 755, 60), item(119, 755, 60), item(201, 755, 60), item(283, 755, 60)], // 240 of 402: under 60 %
        [item(37, 700), item(119, 700), item(201, 700), item(283, 700)], // bottom 764, above the band (786.6)
      ]) {
        expect(with_(items)).toMatchObject({ covers: [], tapAt: { moved: false } });
      }
      // Not interactive: a text row of the same shape is no tab bar.
      expect(with_([37, 119, 201, 283].map((x) => uiNode({ role: 'text', label: `t${x}`, rect: rect(x, 755, 82, 64) }))).covers).toEqual([]);
    });

    it('a nested tree\'s order is its draw order (review of fix/r7-covers): a WDA action sheet listed after the bar is drawn over it — its Cancel and Delete account are tapped at their centres; tabs listed before a row there cover nothing of it, while idb\'s, listed first, do', () => {
      const cancel = uiNode({ role: 'button', label: 'Cancel', rect: rect(8, 782, 386, 57) });
      const del = uiNode({ role: 'button', label: 'Delete account', rect: rect(8, 717, 386, 57) });
      const bar = uiNode({ role: 'container', rect: rect(20, 743, 362, 76), children: tabs() });
      const content = uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'text', label: 'row', rect: rect(24, 600, 354, 52) })] });
      const sheet = uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'container', rect: rect(8, 600, 386, 240), children: [del, cancel] })] });
      const order = drawOrder(uiNode({ role: 'application', rect: IPHONE, children: [content, bar, sheet] }));
      expect(order.exposure(cancel, IPHONE)).toMatchObject({ covers: [], tapAt: { point: { x: 201, y: 811 }, moved: false } });
      expect(order.exposure(del, IPHONE)).toMatchObject({ covers: [], tapAt: { point: { x: 201, y: 746 }, moved: false } });
      // The tab bar listed BEFORE row_3 in a nested tree is beneath it; the same order in idb's flat list is reading order, and the bar covers it.
      const row = row3();
      const nested = uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'container', rect: rect(20, 743, 362, 76), children: tabs() }), uiNode({ role: 'scrollable', rect: IPHONE, children: [row] })] });
      expect(drawOrder(nested).exposure(row, IPHONE).covers).toEqual([]);
      const flat = row3();
      expect(drawOrder(idb(flat)).exposure(flat, IPHONE).centreCover?.identifier).toBe('nav.tab_cards');
    });

    it('in idb\'s list the items are bottom chrome: a row listed BEFORE them, a reading-order break between (a date header above it), still has them over it', () => {
      const row = uiNode({ role: 'button', identifier: 'transactions.list.row_4', rect: rect(24, 735, 354, 52) });
      const header = uiNode({ role: 'text', identifier: 'transactions.list.date_header_0', rect: rect(0, 600, 402, 30) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), title(), row, header, ...tabs()] });
      expect(drawOrder(tree).exposure(row, IPHONE).covers.map((n) => n.identifier)).toEqual(['nav.tab_home', 'nav.tab_transactions', 'nav.tab_cards', 'nav.tab_more']);
    });

    it('a text in the items\' box, listed after them in idb\'s list (a tab\'s caption), is the bar\'s own: no item covers it', () => {
      const caption = uiNode({ role: 'text', label: 'Cards', rect: rect(220, 795, 44, 14) });
      expect(drawOrder(idb(caption)).exposure(caption, IPHONE).covers).toEqual([]);
    });

    it('items ending below the screen\'s bottom are no bar: listed first in idb\'s list, they cover nothing of a row listed after them', () => {
      const items = [37, 119, 201, 283].map((x) => uiNode({ role: 'button', label: `i${x}`, rect: rect(x, 850, 82, 64) }));
      const row = uiNode({ role: 'button', identifier: 'row', rect: rect(24, 790, 354, 52) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), ...items, title(), row] });
      expect(drawOrder(tree).exposure(row, IPHONE).covers).toEqual([]);
    });

    it('a pinned item keeps its pinned reach and gains the one above: a bar ending inside the bottom 6 % reaches from 0.2 × its height above it down to the screen\'s bottom', () => {
      const items = [37, 119, 201, 283].map((x) => uiNode({ role: 'button', label: `i${x}`, rect: rect(x, 790, 82, 49) }));
      const below = uiNode({ role: 'text', label: 'footnote', rect: rect(40, 850, 300, 14) });
      const row = uiNode({ role: 'button', identifier: 'row', rect: rect(24, 760, 354, 30) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), title(), row, below, ...items] });
      expect(drawOrder(tree).exposure(row, IPHONE).reaches).toEqual([37, 119, 201, 283].map((x) => rect(x, 780, 82, 94)));
    });

    it('the keyboard\'s keys are no tab bar: idb\'s number pad (run2-ios #250) — its bottom row `,` `0` `Delete`, three equal keys across the screen — reaches no key above it', () => {
      const tree = parseIdbDescribeAll(JSON.stringify(PAD.elements));
      const order = drawOrder(tree);
      const keys = [...everyNode(tree)].filter((n) => ['7', '8', '9'].includes(n.label ?? ''));
      expect(keys).toHaveLength(3);
      for (const key of keys) expect(order.exposure(key, IPHONE)).toMatchObject({ covers: [], shows: 1 });
    });
  });

  describe('no false cover — the shapes measured clean', () => {
    it('every WDA fixture (real /source payloads): no interactive or labelled node reads as covered — the scroll indicators WDA lists last in a ScrollView are no cover (review round 1)', async () => {
      const dir = new URL('../fixtures/', import.meta.url);
      const covered: string[] = [];
      let judged = 0;
      for (const file of (await readdir(dir)).filter((f) => f.startsWith('wda-source'))) {
        const tree = parseWdaSource(await readFile(new URL(file, dir), 'utf8'));
        const order = drawOrder(tree);
        for (const n of everyNode(tree)) {
          if (n.ofKeyboard === true || n.rect.width * n.rect.height === 0 || !(isInteractive(n) || n.label)) continue;
          judged++;
          const seen = order.exposure(n, tree.rect);
          if (seen.covers.length > 0) covered.push(`${file}: ${n.role} ${n.label} under ${seen.covers.map((c) => c.label).join(', ')}`);
        }
      }
      expect(judged).toBeGreaterThan(200);
      expect(covered).toEqual([]);
    });

    it('WDA, Settings › General › Language & Region (2026-10-09 21:04 UTC): a grouped cell\'s background — an unlabelled `container` of the cell\'s size holding one empty frame, listed after the row\'s button — is no cover of `text:"Region"` nor of `id:LOCALE`', () => {
      const region = uiNode({ role: 'text', label: 'Region', rect: rect(36, 428, 50, 21) });
      const button = uiNode({ role: 'button', identifier: 'LOCALE', label: 'Region, Slovakia', rect: rect(36, 428, 308, 21), children: [region, uiNode({ role: 'text', label: 'Slovakia', rect: rect(280, 428, 64, 21) })] });
      const background = (inner: Partial<UiNode> = {}) => uiNode({ role: 'container', rect: rect(20, 411, 362, 54), children: [uiNode({ role: 'container', rect: rect(20, 411, 362, 54), ...inner })] });
      const cell = (bg: UiNode) =>
        uiNode({
          role: 'container',
          identifier: 'LOCALE',
          label: 'Region, Slovakia',
          rect: rect(20, 411, 362, 54),
          children: [
            uiNode({ role: 'container', rect: rect(20, 411, 332, 54), children: [uiNode({ role: 'container', rect: rect(20, 411, 332, 54), children: [button] })] }),
            bg,
            uiNode({ role: 'container', rect: rect(36, 464, 346, 1) }),
            uiNode({ role: 'button', label: 'chevron', rect: rect(352, 432, 12, 12) }),
          ],
        });
      const tree = (bg: UiNode) => uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: rect(0, 62, 402, 812), children: [cell(bg)] })] });
      const order = drawOrder(tree(background()));
      expect(order.exposure(region, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { moved: false } });
      expect(order.exposure(button, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { moved: false } });
      // Something drawable at any depth — a label, an identifier, another role — and the wrapper covers, as the Compose tab-bar host does.
      for (const inner of [{ label: 'Badge' }, { identifier: 'bg' }, { role: 'image' }]) {
        const bg = background(inner);
        expect(drawOrder(tree(bg)).exposure(region, IPHONE).covers).toContain(bg);
      }
      // …and an identified background itself (the measured one has no identifier).
      const named = { ...background(), identifier: 'cell_bg' };
      expect(drawOrder(tree(named)).exposure(region, IPHONE).covers).toContain(named);
    });

    it('the myport 2FA screen\'s Späť moved down onto the horizontal scroll indicator (0,485 402x30): still tapped at its centre', async () => {
      const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-2fa-keyboard-toolbar.json', import.meta.url), 'utf8'));
      const nodes = [...everyNode(tree)];
      const indicator = nodes.find((n) => n.label?.startsWith('Horizontal scroll bar'))!;
      expect(indicator).toMatchObject({ role: 'container', rect: rect(0, 485, 402, 30) });
      const back = nodes.find((n) => n.label === 'Späť')!;
      back.rect = { ...back.rect, y: indicator.rect.y - 5 };
      expect(drawOrder(tree).exposure(back, tree.rect)).toMatchObject({ covers: [], tapAt: { moved: false } });
    });

    describe('WDA, the SWIFT form (2026-10-09 20:57 UTC): an unlabelled textfield over its placeholder label `Payee’s name`, holding its own horizontal scroll indicator', () => {
      const label = () => uiNode({ role: 'text', label: 'Payee’s name', rect: rect(42, 446, 103, 22) });
      const bar = (partial: Partial<UiNode> = {}) =>
        uiNode({ role: 'container', label: 'Horizontal scroll bar, 1 page', value: '0 %', rect: rect(42, 454, 318, 10), children: [uiNode({ role: 'container', rect: rect(45, 461, 309, 3) })], ...partial });
      const field = (text: UiNode, input: UiNode) =>
        uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: rect(0, 116, 402, 664), children: [uiNode({ role: 'container', identifier: 'swift_payment.form.payee_name_input', rect: rect(24, 431, 354, 52), children: [text, input] })] })] });
      const textfield = (indicator: UiNode, partial: Partial<UiNode> = {}) => uiNode({ role: 'textfield', rect: rect(42, 447, 318, 20), children: [indicator], ...partial });

      it('the textfield\'s scroll indicator is no cover of the label — a text input\'s, as a scroll view\'s, matched by shape: localised, it is excused the same', () => {
        for (const indicator of [bar(), bar({ label: 'Vodorovný posuvník, 1 strana' }), bar({ label: null, value: null })]) {
          const text = label();
          expect(drawOrder(field(text, textfield(indicator))).exposure(text, IPHONE).covers).not.toContain(indicator);
        }
      });

      it('the textfield holding the label\'s centre, the label overhanging it by a point above and below (446–468 against 447–467), is the label\'s own field (round 7, the owner\'s decision): nothing over the label, tapped at its centre (94,457), where the field takes the tap', () => {
        const text = label();
        expect(drawOrder(field(text, textfield(bar()))).exposure(text, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { point: { x: 94, y: 457 }, moved: false } });
        // An overhang of 2 is the field's too; beyond it, a cover.
        const two = uiNode({ role: 'text', label: 'Payee’s name', rect: rect(42, 445, 103, 24) });
        expect(drawOrder(field(two, textfield(bar()))).exposure(two, IPHONE).covers).toEqual([]);
      });

      it('…and no other control: a label overhanging by 3, one whose centre lies off the field, a labelled or valued field, a button of the field\'s rect — each still covers', () => {
        const at = (r: ReturnType<typeof rect>) => uiNode({ role: 'text', label: 'Payee’s name', rect: r });
        const cases: [UiNode, UiNode][] = [
          [at(rect(42, 444, 103, 26)), textfield(bar())], // 3 above and below
          [at(rect(42, 466, 103, 3)), textfield(bar())], // within the overhang, but its centre (94,468) below the field
          [at(rect(42, 440, 103, 10)), textfield(bar())], // its centre (93,445) above the field
          [label(), textfield(bar(), { label: 'Payee’s name' })],
          [label(), textfield(bar(), { value: 'ACME s.r.o.' })],
          [label(), uiNode({ role: 'button', rect: rect(42, 447, 318, 20) })],
        ];
        for (const [text, control] of cases) expect(drawOrder(field(text, control)).exposure(text, IPHONE).covers).toContain(control);
      });

      it('…and the shape stays narrow: under another interactive parent (a button), or an identified container of that shape, it covers', () => {
        const text = label();
        const underButton = bar();
        expect(drawOrder(field(text, uiNode({ role: 'button', label: 'Pick', rect: rect(42, 447, 318, 20), children: [underButton] }))).exposure(text, IPHONE).covers).toContain(underButton);
        const identified = bar({ identifier: 'pager' });
        expect(drawOrder(field(text, textfield(identified))).exposure(text, IPHONE).covers).toContain(identified);
      });
    });

    it('the scroll-indicator excuse is narrow: an `other` (an unmapped control) or an identified container of the same shape in the target\'s scroll view still covers', () => {
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 470, 402, 52) });
      const shaped = (partial: Partial<UiNode>) => uiNode({ role: 'container', label: 'Horizontal scroll bar, 1 page', value: '0 %', rect: rect(0, 485, 402, 30), children: [uiNode({ role: 'container', rect: rect(43, 512, 316, 3) })], ...partial });
      const tree = (later: UiNode) => uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: rect(0, 62, 402, 500), children: [row, later] })] });
      expect(drawOrder(tree(shaped({}))).exposure(row, IPHONE).covers).toEqual([]);
      for (const cover of [shaped({ role: 'other' }), shaped({ identifier: 'pager' })]) expect(drawOrder(tree(cover)).exposure(row, IPHONE).covers).toEqual([cover]);
    });

    it('an outlined field\'s floating label straddling its top border (a narrower sibling, its centre on the field — in a nested tree it need not repeat the field): drawn on it; a full-width sibling is a header, a cover', () => {
      const field = uiNode({ role: 'textfield', identifier: 'iban', rect: rect(24, 300, 354, 56) });
      const label = uiNode({ role: 'text', label: 'IBAN', rect: rect(36, 292, 40, 16) });
      const header = uiNode({ role: 'text', label: 'Section', rect: rect(24, 290, 354, 20) });
      const tree = (later: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), children: [uiNode({ role: 'other', rect: IPHONE }), field, later] });
      expect(drawOrder(tree(label)).exposure(field, IPHONE).covers).toEqual([]);
      expect(drawOrder(tree(header)).exposure(field, IPHONE).covers).toEqual([header]);
      // A pinned footer's text straddling the BOTTOM edge (review round 2) — narrower, its centre on the field — still covers.
      const footer = uiNode({ role: 'text', label: 'Total 120 CZK', rect: rect(24, 330, 250, 40) });
      expect(drawOrder(tree(footer)).exposure(field, IPHONE).covers).toEqual([footer]);
    });

    it('in idb\'s flat list a narrower text on the target that repeats nothing of it is a cover (code review of deep/r5-covers, P4): a pinned footer\'s text inside a row, a bare-text sticky header', () => {
      const row = uiNode({ role: 'button', identifier: 'row', label: 'Row', rect: rect(0, 760, 402, 60) });
      const footer = uiNode({ role: 'text', label: 'Total 100 EUR', rect: rect(16, 785, 200, 30) });
      const header = uiNode({ role: 'text', label: 'SECTION', rect: rect(16, 770, 200, 40) });
      const tree = (later: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), row, later] });
      for (const cover of [footer, header]) expect(drawOrder(tree(cover)).exposure(row, IPHONE).covers).toEqual([cover]);
      // What a field's own label repeats — its label, placeholder, value, or (idb) its identifier — is drawn on it.
      const field = uiNode({ role: 'textfield', identifier: 'iban_field', label: 'IBAN', placeholder: 'Enter IBAN', value: 'DE89', rect: rect(24, 300, 354, 56) });
      const on = (partial: Partial<UiNode>) => uiNode({ role: 'text', rect: rect(36, 310, 120, 18), ...partial });
      const withField = (text: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [field, text] });
      for (const text of [on({ label: 'IBAN' }), on({ label: 'Enter IBAN' }), on({ label: 'DE89' }), on({ identifier: 'iban_field', label: 'International account' })]) {
        expect(drawOrder(withField(text)).exposure(field, IPHONE).covers).toEqual([]);
      }
      const other = on({ label: 'Required' });
      expect(drawOrder(withField(other)).exposure(field, IPHONE).covers).toEqual([other]);
    });

    it('…in a nested tree the sibling is the evidence, whatever it says (verification of P4): the same footer text in the footer, a sibling of the row\'s scroll view, covers; a text listed beside its own view is drawn on it', () => {
      const row = uiNode({ role: 'button', identifier: 'row', label: 'Row', rect: rect(0, 760, 402, 60) });
      const footer = uiNode({ role: 'text', label: 'Total 100 EUR', rect: rect(16, 785, 200, 30) });
      const nested = uiNode({
        role: 'container',
        rect: IPHONE,
        children: [uiNode({ role: 'scrollable', rect: rect(0, 0, 402, 874), children: [row] }), uiNode({ role: 'container', rect: rect(0, 770, 402, 104), children: [footer] })],
      });
      expect(drawOrder(nested).exposure(row, IPHONE).covers).toContain(footer);
      const view = uiNode({ role: 'container', identifier: 'screen', rect: rect(0, 116, 402, 758) });
      const text = uiNode({ role: 'text', label: 'Scaffold is running.', rect: rect(138, 479, 126, 18) });
      const beside = (flatList?: true) => uiNode({ role: 'container', rect: IPHONE, ...(flatList && { flatList }), children: [view, text] });
      expect(drawOrder(beside()).exposure(view, IPHONE).covers).toEqual([]);
      expect(drawOrder(beside(true)).exposure(view, IPHONE).covers).toEqual([text]);
    });

    it('the real RN fixture (tests/fixtures/wda-source-rn-myport.json): the screen\'s texts, which WDA lists as siblings of `placeholder_screen`, are no cover of it — its centre is tapped', async () => {
      const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-rn-myport.json', import.meta.url), 'utf8'));
      const screen = [...everyNode(tree)].find((n) => n.identifier === 'placeholder_screen')!;
      const exposure = drawOrder(tree).exposure(screen, tree.rect);
      expect(exposure.covers.filter((n) => n.role === 'text')).toEqual([]); // only the RN debugger's warning banner, 10,787 382x49, at the bottom
      expect(exposure.centreCover).toBeUndefined();
      expect(exposure.tapAt).toEqual({ point: { x: 201, y: 495 }, moved: false });
      expect(exposure.coverAt({ x: 201, y: 495 })).toBeUndefined();
    });

    it('idb\'s flat list, chrome before content (owner decision on device check C3-3): a row scrolled up under the top bar, listed after it, is no cover of BackButton or the title; CONTINUE over priority_select still is', async () => {
      const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
      const nodes = [...everyNode(tree)];
      const find = (p: (n: UiNode) => boolean) => nodes.find(p)!;
      const back = find((n) => n.label === 'BackButton');
      const title = find((n) => n.identifier === 'swift_payment.form.title');
      const debit = find((n) => n.identifier === 'swift_payment.form.debit_select');
      const priority = find((n) => n.identifier === 'swift_payment.form.priority_select');
      const iban = find((n) => n.role === 'textfield');
      expect(drawOrder(tree).exposure(back, IPHONE).covers).toEqual([]); // at rest, the row at y 150
      debit.rect = { ...debit.rect, y: 40, height: 72 }; // scrolled up under the bar: 24,40 354x72 over BackButton (y 70) and the title (y 74)
      iban.rect = { ...iban.rect, y: 27 };
      for (const target of [back, title]) expect(drawOrder(tree).exposure(target, IPHONE)).toMatchObject({ covers: [], tapAt: { moved: false } });
      // The measured false refusals of the interim rule: a row whose top lies INSIDE Back's 70–98 (C3-3 positions 2, 4, 6).
      debit.rect = { ...debit.rect, y: 82, height: 20 };
      for (const target of [back, title]) expect(drawOrder(tree).exposure(target, IPHONE)).toMatchObject({ covers: [], tapAt: { moved: false } });
      // CONTINUE (y 780) over priority_select (y 771): content over content — a cover, as measured.
      expect(drawOrder(tree).exposure(priority, IPHONE).covers.map((n) => n.identifier)).toEqual(['swift_payment.form.continue_button']);
    });

    it('…where the content starts: the first node past the bar\'s band (the top 20 %), or lying on a node of the bar before it; the screen-sized Application is skipped', () => {
      const host = uiNode({ role: 'other', label: 'app', rect: IPHONE });
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const save = uiNode({ role: 'button', label: 'Save', rect: rect(330, 70, 50, 28) });
      const flat = (...children: UiNode[]) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [host, ...children] });
      // A row lying on BackButton starts the content, even inside the band: no cover of the bar before it.
      const under = uiNode({ role: 'textfield', rect: rect(42, 82, 318, 20) });
      expect(drawOrder(flat(back, save, under)).exposure(back, IPHONE).covers).toEqual([]);
      // A row past the band starts it too; what follows is content, and content covers content.
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 300, 402, 60) });
      const bar = uiNode({ role: 'button', label: 'Pinned', rect: rect(0, 320, 402, 60) });
      expect(drawOrder(flat(back, row, bar)).exposure(row, IPHONE).covers).toEqual([bar]);
      // A sheet listed last that starts ABOVE a content target: the reading-order break — no cover of it, the stated
      // residual the owner accepted (docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-…); over the bar it still is.
      const sheet = uiNode({ role: 'button', label: 'Sheet', rect: rect(16, 200, 370, 400) });
      expect(drawOrder(flat(back, row, sheet)).exposure(row, IPHONE).covers).toEqual([]);
      // One that holds the row whole never breaks (review of fix/r6b-idb, HIGH 2): a cover in its own right.
      const whole = uiNode({ role: 'button', label: 'Sheet', rect: rect(0, 200, 402, 400) });
      expect(drawOrder(flat(back, row, whole)).exposure(row, IPHONE).covers).toEqual([whole]);
      // A node of the bar lying on another (a badge on BackButton) starts the content — the stated miss: no cover of it.
      const badge = uiNode({ role: 'image', label: 'Badge', rect: rect(40, 70, 30, 20) });
      expect(drawOrder(flat(back, badge, row)).exposure(back, IPHONE).covers).toEqual([]);
    });

    it('…only content ENDING inside the bar\'s band is excused (review MAJOR 1): a sheet reaching past it covers the bar\'s items; a popover ending inside it does not — the residual, stated', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 300, 402, 60) });
      const flat = (later: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), back, row, later] });
      const sheet = uiNode({ role: 'button', label: 'Cancel', rect: rect(16, 72, 370, 400) });
      expect(drawOrder(flat(sheet)).exposure(back, IPHONE).covers).toEqual([sheet]);
      const popover = uiNode({ role: 'button', label: 'Tip', rect: rect(16, 72, 70, 34) });
      expect(drawOrder(flat(popover)).exposure(back, IPHONE).covers).toEqual([]);
    });

    it('a screen with no bar (the reviewer\'s repro, MAJOR 1): rows at the top read as the bar\'s, and a menu listed last that reaches past the band still covers Row1 — the tap moves off it', () => {
      const rows = [62, 106, 150, 194].map((y, i) => uiNode({ role: 'button', label: `Row${i + 1}`, rect: rect(0, y, 402, 44) }));
      const menu = uiNode({ role: 'button', label: 'Menu', rect: rect(150, 70, 240, 130) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', label: 'App', rect: IPHONE }), ...rows, menu] });
      const seen = drawOrder(tree).exposure(rows[0], IPHONE);
      expect(seen.covers).toEqual([menu]);
      expect(seen.tapAt).toEqual({ point: { x: 75, y: 88 }, moved: true, piece: rect(0, 70, 150, 36) });
    });

    // Code review of round 6, P4: firstContent's stated miss, pinned. A first row lying wholly inside the band and clear
    // of the bar's items is read as the bar's, so content listed after it that ends inside the band is no cover of it.
    it('the residual, pinned: a first row wholly inside the band and clear of Back (120–160) is read as the bar\'s — a tip ending in the band over it reads clear; a menu reaching past the band still covers it', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const first = uiNode({ role: 'button', label: 'First', rect: rect(0, 120, 402, 40) }); // ends at 160, inside the line at 174.8
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 300, 402, 60) });
      const flat = (later: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), back, first, row, later] });
      const tip = uiNode({ role: 'text', label: 'Tip', rect: rect(0, 130, 200, 20) }); // over First, ending at 150
      expect(drawOrder(flat(tip)).exposure(first, IPHONE).covers).toEqual([]); // the false "clear", stated in firstContent
      const menu = uiNode({ role: 'button', label: 'Menu', rect: rect(150, 125, 240, 130) }); // reaches 255, past the line
      expect(drawOrder(flat(menu)).exposure(first, IPHONE).covers).toEqual([menu]);
    });

    it('the band\'s line sits at 20 % of the screen (174.8 on 874): content ending at 170 is excused over a bar item, content ending at 180 is not', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 300, 402, 60) });
      const flat = (later: UiNode) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), back, row, later] });
      const short = uiNode({ role: 'textfield', rect: rect(20, 80, 318, 90) }); // 80–170
      expect(drawOrder(flat(short)).exposure(back, IPHONE).covers).toEqual([]);
      const long = uiNode({ role: 'textfield', rect: rect(20, 80, 318, 100) }); // 80–180
      expect(drawOrder(flat(long)).exposure(back, IPHONE).covers).toEqual([long]);
    });

    it('a row reaching past the band\'s line starts the content: a text ending inside the band over its top covers it', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 150, 402, 50) }); // 150–200, past the line at 174.8
      const tip = uiNode({ role: 'text', label: 'Tip', rect: rect(0, 160, 200, 14) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), back, row, tip] });
      expect(drawOrder(tree).exposure(row, IPHONE).covers).toEqual([tip]);
    });

    it('a row scrolled ABOVE the screen starts the content, whatever band it ends in: the rows after it are content, and a text ending inside the band over one of them covers it', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const above = uiNode({ role: 'button', label: 'Above', rect: rect(0, -100, 402, 50) });
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 100, 402, 40) });
      const tip = uiNode({ role: 'text', label: 'Tip', rect: rect(0, 110, 200, 30) });
      const tree = uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: IPHONE }), back, above, row, tip] });
      expect(drawOrder(tree).exposure(row, IPHONE).covers).toEqual([tip]);
    });

    it('…the same shapes with no flat-list mark (a WDA or Android tree, or any tree its source did not mark) are judged as before: the row under the bar covers BackButton', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const debit = uiNode({ role: 'button', label: 'Debit account', rect: rect(24, 40, 354, 72) });
      const shape = (flatList?: true) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), ...(flatList && { flatList }), children: [uiNode({ role: 'other', rect: IPHONE }), back, debit] });
      expect(drawOrder(shape()).exposure(back, IPHONE).covers).toEqual([debit]);
      expect(drawOrder(shape(true)).exposure(back, IPHONE).covers).toEqual([]);
    });

    describe('the six measured positions of device check C3-3 (tests/fixtures/idb-swift-form-scrolled-under-top-bar.json)', () => {
      const positions = Object.entries(C33.positions).map(([pos, elements]) => [pos, parseIdbDescribeAll(JSON.stringify(elements))] as const);

      it.each(positions)('%s: Back and the title are uncovered — all of them shows, the tap goes to the centre', (_pos, tree) => {
        const order = drawOrder(tree);
        for (const [id, centre] of [['BackButton', { x: 44, y: 84 }], ['swift_payment.form.title', { x: 201, y: 84 }]] as const) {
          const target = tree.children.find((n) => n.identifier === id)!;
          expect(order.exposure(target, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { point: centre, moved: false } });
        }
      });

      it('the rows that lay on Back and the title at positions 2, 4 and 6 (the interim rule\'s three false refusals) are in the dumps, after them', () => {
        const at = (pos: string) => positions.find(([p]) => p === pos)![1].children;
        const back = rect(30, 70, 28, 28);
        const onBack = (pos: string) => at(pos).filter((n, i) => i > 1 && rectsOverlap(n.rect, back)).map((n) => `${n.role} ${n.rect.x},${n.rect.y}`);
        expect([onBack('pos2'), onBack('pos4'), onBack('pos6')]).toEqual([
          ['textfield 42,75', 'text 42,75'],
          ['textfield 42,82', 'text 42,82'],
          ['text 42,80'],
        ]);
      });

      it('position 6: the pinned CONTINUE, listed last, still covers the row under it (payee_country_select 24,776 354x52) — content over content', () => {
        const tree = positions.find(([p]) => p === 'pos6')![1];
        const row = tree.children.find((n) => n.identifier === 'swift_payment.form.payee_country_select')!;
        const seen = drawOrder(tree).exposure(row, IPHONE);
        expect(seen.centreCover?.identifier).toBe('swift_payment.form.continue_button');
        expect(seen.tapAt).toBeUndefined(); // 4 pt show above the bar
      });
    });

    describe('the reading-order break (docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md): later nodes from the first one starting above a content target are no cover of it', () => {
      const screenOf = (name: string) => parseIdbDescribeAll(JSON.stringify(MODAL.screens[name]));

      it('the payment-type chooser, listed before the transaction list it is drawn over: row_own and row_swift are uncovered, tapped at their centres', () => {
        const tree = screenOf('chooser');
        const order = drawOrder(tree);
        for (const [id, centre] of [['row_own', { x: 201, y: 423 }], ['row_swift', { x: 201, y: 479 }]] as const) {
          const row = tree.children.find((n) => n.identifier === `accounts.detail.payment_type_sheet.${id}`)!;
          expect(order.exposure(row, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { point: centre, moved: false } });
        }
      });

      it('…where the break falls: for row_own at filter_icon (358 < 397) — date_header_0 (399) and row_0 (435), listed before it, would cover; for row_swift at once', () => {
        const tree = screenOf('chooser');
        const own = tree.children.find((n) => n.identifier === 'accounts.detail.payment_type_sheet.row_own')!;
        const icon = tree.children.find((n) => n.identifier === 'transactions.list.filter_icon')!;
        icon.rect = { ...icon.rect, y: 400 }; // no longer above row_own: the list behind reads as drawn over it
        expect(drawOrder(tree).exposure(own, IPHONE).covers.map((n) => n.identifier)).toEqual(['transactions.list.filter_icon', 'transactions.list.date_header_0', 'transactions.list.row_0']);
      });

      it('the SWIFT form\'s value-date picker, listed after the title and before every row: uncovered, its centre tapped', () => {
        const tree = screenOf('valueDatePicker');
        const picker = tree.children.find((n) => n.identifier === 'swift_payment.form.value_date_picker')!;
        expect(drawOrder(tree).exposure(picker, IPHONE)).toMatchObject({ covers: [], shows: 1, tapAt: { point: { x: 205, y: 479 }, moved: false } });
      });

      const app = uiNode({ role: 'other', label: 'app', rect: IPHONE });
      const flat = (...children: UiNode[]) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [app, ...children] });
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(24, 400, 354, 52) });
      const footer = uiNode({ role: 'text', label: 'Total 100 EUR', rect: rect(40, 420, 200, 20) }); // starts below Row's top: before the break

      it('before the break nothing changes, and a node of no area never breaks: a text after a 0×0 node still covers', () => {
        const above = uiNode({ role: 'text', label: 'Above', rect: rect(24, 300, 354, 20) });
        expect(drawOrder(flat(row, footer)).exposure(row, IPHONE).covers).toEqual([footer]);
        expect(drawOrder(flat(row, above, footer)).exposure(row, IPHONE).covers).toEqual([]);
        expect(drawOrder(flat(row, uiNode({ role: 'textfield', rect: rect(24, 300, 354, 0) }), footer)).exposure(row, IPHONE).covers).toEqual([footer]);
        // Its top AT the target\'s is no break.
        expect(drawOrder(flat(row, uiNode({ role: 'text', label: 'Level', rect: rect(380, 400, 20, 10) }), footer)).exposure(row, IPHONE).covers).toEqual([footer]);
      });

      it('a node pinned at the bottom never breaks and is never past a break: CONTINUE over a label under it, after a field above it, covers it', () => {
        const label = uiNode({ role: 'text', label: 'Street', rect: rect(42, 807, 186, 20) });
        const field = uiNode({ role: 'textfield', identifier: 'f', rect: rect(42, 600, 318, 20) }); // starts above: the break
        const bar = uiNode({ role: 'button', label: 'Go', rect: rect(24, 780, 354, 44) });
        expect(drawOrder(flat(label, field, bar)).exposure(label, IPHONE).covers).toEqual([bar]);
        // Nor does it break for what follows it: a badge listed after the bar, on the label, still covers it.
        const badge = uiNode({ role: 'text', label: '2', rect: rect(100, 810, 20, 12) });
        expect(drawOrder(flat(label, bar, badge)).exposure(label, IPHONE).covers).toEqual([bar, badge]);
        // A row cut by the screen\'s bottom (ending at 880, past 874) is not pinned: it starts above the label, so it breaks.
        const cut = uiNode({ role: 'button', label: 'Cut', rect: rect(200, 800, 202, 80) }); // not holding the label whole
        expect(drawOrder(flat(label, cut)).exposure(label, IPHONE).covers).toEqual([]);
      });

      it('the bar\'s items never break: a menu listed after the content, reaching past the band, still covers BackButton', () => {
        const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
        const menu = uiNode({ role: 'button', label: 'Menu', rect: rect(16, 72, 370, 400) });
        expect(drawOrder(flat(back, row, uiNode({ role: 'text', label: 'Above', rect: rect(24, 50, 100, 10) }), menu)).exposure(back, IPHONE).covers).toEqual([menu]);
      });

      describe('idb\'s keyboard (review of fix/r6b-idb, HIGH 1): idb marks no keyboard node, so its keys, listed last, are the only covers of the rows under it — the break never excuses them', () => {
        const pad = () => parseIdbDescribeAll(JSON.stringify(PAD.elements));
        const labels = (nodes: readonly UiNode[]) => nodes.map((n) => n.identifier ?? n.label);

        it('run2-ios #250: value_date_select under CONTINUE, lifted onto the number pad, and the keys 1–3 — every cover it had at 2f98900, and CONTINUE\'s reach down to the keyboard\'s top (589) on its centre', () => {
          const tree = pad();
          const row = tree.children.find((n) => n.identifier === 'swift_payment.form.value_date_select')!;
          const seen = drawOrder(tree).exposure(row, IPHONE);
          expect(labels(seen.covers)).toEqual(['swift_payment.form.continue_button', '1', '2', '3']);
          expect(seen.centreCover?.identifier).toBe('swift_payment.form.continue_button');
          expect(seen.tapAt).toBeUndefined();
        });

        it('…the reviewer\'s probe on it: a row at 24,570 354x60 between the form and CONTINUE is never tapped on key "2" (201,600) — it is refused, under CONTINUE\'s reach and the keys', () => {
          const tree = pad();
          const row = uiNode({ role: 'button', label: 'Fees', rect: rect(24, 570, 354, 60) });
          tree.children.splice(tree.children.findIndex((n) => n.identifier === 'swift_payment.form.continue_button'), 0, row);
          const seen = drawOrder(tree).exposure(row, IPHONE);
          expect(labels(seen.covers)).toEqual(['swift_payment.form.continue_button', '1', '2', '3']);
          expect(seen.tapAt).toBeUndefined();
        });

        const keyboard = () => [
          ...[5, 137, 270].map((x, i) => uiNode({ role: 'button', label: String(i + 1), rect: rect(x, 596, 132, 54) })),
          uiNode({ role: 'other', rect: rect(0, 589, 402, 285) }),
        ];

        it('a node starting above the target that is not chrome (an error\'s TRY AGAIN, run3-ios #45) breaks for content — never for the keys before the background, nor those after it (Dictate)', () => {
          const field = uiNode({ role: 'textfield', label: 'Name', rect: rect(24, 580, 354, 40) });
          const retry = uiNode({ role: 'button', label: 'TRY AGAIN', rect: rect(16, 427, 370, 44) });
          const over = uiNode({ role: 'text', label: 'Over', rect: rect(30, 585, 100, 20) });
          const dictate = uiNode({ role: 'button', label: 'Dictate', rect: rect(325, 600, 68, 69) });
          expect(labels(drawOrder(flat(field, retry, over, ...keyboard(), dictate)).exposure(field, IPHONE).covers)).toEqual(['1', '2', '3', 'Dictate']);
        });

        it('a lifted bar reaches down to the keyboard\'s top, not the screen\'s bottom: a row lying under the keyboard below the keys listed is no target of its reach', () => {
          const low = uiNode({ role: 'textfield', label: 'Low', rect: rect(24, 700, 354, 20) });
          const bar = uiNode({ role: 'button', label: 'Continue', rect: rect(24, 512, 354, 44) });
          expect(drawOrder(flat(low, bar, ...keyboard())).exposure(low, IPHONE).covers).toEqual([]); // the background is no cover in idb's list (the structural row)
          const row = uiNode({ role: 'textfield', label: 'Row', rect: rect(24, 545, 354, 52) });
          expect(labels(drawOrder(flat(row, bar, ...keyboard())).exposure(row, IPHONE).covers)).toEqual(['Continue', '1', '2', '3']);
        });

        it('narrow: the background must span the screen\'s width down to its bottom, be unlabelled and structural — else the keys are content, and the break excuses them', () => {
          const field = uiNode({ role: 'textfield', label: 'Name', rect: rect(24, 580, 354, 40) });
          const retry = uiNode({ role: 'button', label: 'TRY AGAIN', rect: rect(16, 427, 370, 44) });
          const keys = keyboard().slice(0, 3);
          for (const back of [uiNode({ role: 'other', rect: rect(2, 589, 402, 285) }), uiNode({ role: 'other', rect: rect(0, 589, 410, 285) }), uiNode({ role: 'other', rect: rect(0, 589, 402, 280) }), uiNode({ role: 'other', rect: rect(0, 100, 402, 774) }), uiNode({ role: 'other', label: 'Card', rect: rect(0, 589, 402, 285) }), uiNode({ role: 'image', rect: rect(0, 589, 402, 285) })]) {
            expect(drawOrder(flat(field, retry, ...keys, back)).exposure(field, IPHONE).covers.filter((n) => n.role === 'button')).toEqual([]);
          }
          // Without the background (a shape idb's keyboard never had in the 69 device dumps) the keys after a lifted bar are content: the residual.
          const bar = uiNode({ role: 'button', label: 'Continue', rect: rect(24, 500, 354, 44) });
          expect(drawOrder(flat(field, bar, ...keys)).exposure(field, IPHONE).covers).toEqual([]);
        });
      });

      it('a bar listed last that ends inside the top bar\'s band never breaks (review of fix/r6b-idb, MEDIUM — Contacts\' New Contact, run3-ios #102): Toolbar 0,83 402x48 covers a row scrolled under it', () => {
        const bar = uiNode({ role: 'other', identifier: 'New Contact', rect: rect(0, 78, 402, 54) });
        const row = uiNode({ role: 'button', label: 'add birthday', rect: rect(20, 95, 362, 51) });
        const toolbar = uiNode({ role: 'other', label: 'Toolbar', identifier: 'Toolbar', rect: rect(0, 83, 402, 48) });
        const tree = flat(uiNode({ role: 'button', label: 'add address', rect: rect(20, 30, 362, 51) }), bar, row, uiNode({ role: 'button', label: 'add date', rect: rect(20, 160, 362, 51) }), toolbar);
        const seen = drawOrder(tree).exposure(row, IPHONE);
        expect(seen.covers).toEqual([toolbar]);
        expect(seen.tapAt).toBeUndefined();
        // One ending below the band's line (174.8) is content, and breaks.
        const low = uiNode({ role: 'other', label: 'Toolbar', rect: rect(0, 83, 300, 100) }); // not holding the row whole
        expect(drawOrder(flat(bar, row, low)).exposure(row, IPHONE).covers).toEqual([]);
      });

      it('a tree that is not a flat list has no break: the same shapes judged as before', () => {
        const above = uiNode({ role: 'text', label: 'Above', rect: rect(24, 300, 354, 20) });
        const cover = uiNode({ role: 'button', label: 'Cover', rect: rect(24, 410, 354, 40) });
        expect(drawOrder(uiNode({ role: 'container', rect: IPHONE, children: [row, above, cover] })).exposure(row, IPHONE).covers).toEqual([cover]);
        expect(drawOrder(flat(row, above, cover)).exposure(row, IPHONE).covers).toEqual([]);
      });
    });

    describe('a node pinned at the bottom of idb\'s flat list covers down to the screen\'s bottom (round-6 device check H-1: a tap 3 pt below CONTINUE pressed it)', () => {
      const pos1 = () => parseIdbDescribeAll(JSON.stringify(C33.positions.pos1));
      const CONTINUE = 'swift_payment.form.continue_button';

      it('the measured shape: the bank-street label at 42,817 186x20, 3 pt below CONTINUE\'s frame (bottom 824) — covered at its centre (135,827), no piece to move to', () => {
        const tree = pos1();
        const label = tree.children.find((n) => n.label === 'Payee\u2019s bank street & no.*')!;
        label.rect = rect(42, 817, 186, 20);
        const seen = drawOrder(tree).exposure(label, IPHONE);
        expect(seen.centreCover?.identifier).toBe(CONTINUE);
        expect(seen.coverAt({ x: 135, y: 827 })?.identifier).toBe(CONTINUE);
        expect([seen.shows, seen.tapAt]).toEqual([0, undefined]);
        // Where it lay under the frame itself (42,807, centre 817): refused as before.
        label.rect = rect(42, 807, 186, 20);
        expect(drawOrder(tree).exposure(label, IPHONE)).toMatchObject({ shows: 0 });
      });

      it('position 1 as dumped: the bank-city field and its label at y 827, wholly below CONTINUE, are covered whole; the rows above it are not', () => {
        const tree = pos1();
        const order = drawOrder(tree);
        const below = tree.children.filter((n) => n.rect.y === 827);
        expect(below.map((n) => n.role)).toEqual(['textfield', 'text']);
        for (const n of below) expect(order.exposure(n, IPHONE)).toMatchObject({ shows: 0, covers: [expect.objectContaining({ identifier: CONTINUE })] });
        const fees = tree.children.find((n) => n.identifier === 'swift_payment.form.fees_select')!;
        expect(order.exposure(fees, IPHONE).covers).toEqual([]);
      });

      const app = uiNode({ role: 'other', label: 'app', rect: IPHONE });
      const flat = (...children: UiNode[]) => uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [app, ...children] });
      const under = uiNode({ role: 'text', label: 'Under', rect: rect(42, 840, 150, 20) }); // below a bar at 780–824

      it('only across its own x-range: a text beside it, below its top, is no cover\'s target', () => {
        const bar = uiNode({ role: 'button', label: 'Go', rect: rect(24, 780, 354, 44) });
        const beside = uiNode({ role: 'text', label: 'Beside', rect: rect(380, 830, 20, 20) });
        expect(drawOrder(flat(under, beside, bar)).exposure(under, IPHONE).covers).toEqual([bar]);
        expect(drawOrder(flat(under, beside, bar)).exposure(beside, IPHONE).covers).toEqual([]);
      });

      it('narrow: a row of a list that runs on below it, a node that is not interactive, one ending above the band (821.6), one of no area (the `noArea` row), and any tree that is not a flat list reach no lower than their frame', () => {
        const row = uiNode({ role: 'button', label: 'Row', rect: rect(24, 780, 354, 44) });
        const next = uiNode({ role: 'button', label: 'Next', rect: rect(24, 876, 354, 52) }); // the list runs on past the screen
        expect(drawOrder(flat(under, row, next)).exposure(under, IPHONE).covers).toEqual([]);
        const flush = uiNode({ role: 'button', label: 'Flush', rect: rect(380, 824, 20, 52) }); // starts AT the row's bottom: the list runs on
        expect(drawOrder(flat(under, row, flush)).exposure(under, IPHONE).covers).toEqual([]);
        const text = uiNode({ role: 'text', label: 'Total', rect: rect(24, 780, 354, 44) });
        expect(drawOrder(flat(under, text)).exposure(under, IPHONE).covers).toEqual([]);
        const high = uiNode({ role: 'button', label: 'High', rect: rect(24, 776, 354, 44) }); // ends at 820
        expect(drawOrder(flat(under, high)).exposure(under, IPHONE).covers).toEqual([]);
        const flatLine = uiNode({ role: 'button', label: 'Line', rect: rect(24, 830, 354, 0) }); // no area: nothing to run down
        expect(drawOrder(flat(under, flatLine)).exposure(under, IPHONE).covers).toEqual([]);
        const bar = uiNode({ role: 'button', label: 'Go', rect: rect(24, 780, 354, 44) });
        expect(drawOrder(flat(under, bar)).exposure(under, IPHONE).covers).toEqual([bar]);
        expect(drawOrder(uiNode({ role: 'container', rect: IPHONE, children: [under, bar] })).exposure(under, IPHONE).covers).toEqual([]);
      });

      it('a node listed BEFORE it is the only kind it reaches: the bar itself and what is listed after it are judged as before', () => {
        const bar = uiNode({ role: 'button', label: 'Go', rect: rect(24, 780, 354, 44) });
        const order = drawOrder(flat(bar));
        expect(order.exposure(bar, IPHONE)).toMatchObject({ covers: [], tapAt: { point: { x: 201, y: 802 }, moved: false } });
      });
    });

    it('a bar button with the form scrolled under the translucent bar (WDA lists the bar first): the scroll view\'s rows are no cover of it', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const under = uiNode({ role: 'button', label: 'Debit account', rect: rect(16, 60, 370, 52) });
      const form = uiNode({ role: 'scrollable', rect: IPHONE, children: [under] });
      const seen = drawOrder(uiNode({ role: 'application', rect: IPHONE, children: [back, form] })).exposure(back, IPHONE);
      expect(seen).toMatchObject({ covers: [], tapAt: { point: { x: 44, y: 84 }, moved: false } });
    });

    it('a navigation bar\'s Back with a web page scrolled under the bar (WDA lists the bar first): the page\'s link is no cover of it — a web view scrolls', () => {
      const back = uiNode({ role: 'button', label: 'Back', rect: rect(8, 70, 80, 40) });
      const link = uiNode({ role: 'link', label: 'Read more', rect: rect(16, 72, 200, 30) });
      const bar = uiNode({ role: 'other', label: 'NavigationBar', rect: rect(0, 62, 402, 54), children: [back] });
      const page = uiNode({ role: 'webview', rect: IPHONE, children: [link] });
      const seen = drawOrder(uiNode({ role: 'container', rect: IPHONE, children: [bar, page] })).exposure(back, IPHONE);
      expect(seen).toMatchObject({ covers: [], tapAt: { point: { x: 48, y: 90 }, moved: false } });
    });

    it('a web view is the nearest scroller of what it holds, for `structural`\'s wrapper excuse too: an unlabelled wrapper listed after a link, holding the link\'s web view whole (inside a scroll view), is no cover of it', () => {
      const link = uiNode({ role: 'link', label: 'Read more', rect: rect(16, 300, 200, 30) });
      const page = uiNode({ role: 'webview', rect: rect(0, 200, 402, 400), children: [link] });
      const wrapper = uiNode({ role: 'container', rect: rect(0, 150, 402, 500), children: [uiNode({ role: 'text', label: 'Footer', rect: rect(16, 620, 200, 20) })] });
      const tree = uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: IPHONE, children: [page, wrapper] })] });
      expect(drawOrder(tree).exposure(link, IPHONE).covers).toEqual([]);
    });

    it('…and for the scroll-indicator row: an indicator-shaped `container` (a child of the web view holding only empty frames) over a link is no cover of it', () => {
      const link = uiNode({ role: 'link', label: 'Read more', rect: rect(16, 300, 200, 30) });
      const bar = uiNode({ role: 'container', label: 'Vertical scroll bar, 2 pages', rect: rect(10, 290, 380, 50), children: [uiNode({ role: 'container', rect: rect(380, 300, 3, 30) })] });
      const tree = uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'webview', rect: IPHONE, children: [link, bar] })] });
      expect(drawOrder(tree).exposure(link, IPHONE).covers).toEqual([]);
    });

    it('scrolled content excuses only within the target\'s own screen: a full-screen web view in a LATER screen-sized layer (an RN transparent Modal\'s window) covers a native button of the screen beneath with its text', () => {
      const pay = uiNode({ role: 'button', label: 'Pay', rect: rect(24, 700, 354, 50) });
      const terms = uiNode({ role: 'text', label: 'Terms and conditions', rect: rect(16, 690, 370, 80) });
      const tree = uiNode({
        role: 'application',
        rect: IPHONE,
        children: [uiNode({ role: 'other', rect: IPHONE, children: [pay] }), uiNode({ role: 'other', rect: IPHONE, children: [uiNode({ role: 'webview', rect: IPHONE, children: [terms] })] })],
      });
      expect(drawOrder(tree).exposure(pay, IPHONE).covers).toEqual([terms]);
    });

    it('…and so does a native list in a later screen-sized layer (a full-screen sheet\'s rows over the screen beneath)', () => {
      const pay = uiNode({ role: 'button', label: 'Pay', rect: rect(24, 700, 354, 50) });
      const row = uiNode({ role: 'button', label: 'Share', rect: rect(0, 690, 402, 60) });
      const tree = uiNode({
        role: 'application',
        rect: IPHONE,
        children: [uiNode({ role: 'other', rect: IPHONE, children: [pay] }), uiNode({ role: 'other', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: IPHONE, children: [row] })] })],
      });
      expect(drawOrder(tree).exposure(pay, IPHONE).covers).toEqual([row]);
    });

    it('…and where no screen-sized ancestor holds the scroller (a dump of two windows under a 0×0 root), its content is not excused: the safe direction', () => {
      const pay = uiNode({ role: 'button', label: 'Pay', rect: rect(24, 1700, 1000, 120) });
      const row = uiNode({ role: 'button', label: 'Share', rect: rect(0, 1680, 1080, 160) });
      const tree = uiNode({
        role: 'container',
        rect: rect(0, 0, 0, 0),
        children: [uiNode({ role: 'container', rect: rect(0, 0, 1080, 2220), children: [pay] }), uiNode({ role: 'scrollable', rect: rect(0, 1200, 1080, 1020), children: [row] })],
      });
      expect(drawOrder(tree).exposure(pay, rect(0, 0, 1080, 2220)).covers).toEqual([row]);
    });

    it('a link under a sticky element of ITS OWN web page still has that element over it', () => {
      const link = uiNode({ role: 'link', label: 'Read more', rect: rect(16, 100, 200, 30) });
      const sticky = uiNode({ role: 'text', label: 'Contents', rect: rect(0, 90, 402, 40) });
      const tree = uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'webview', rect: IPHONE, children: [link, sticky] })] });
      expect(drawOrder(tree).exposure(link, IPHONE).covers).toEqual([sticky]);
    });

    it('a row under a sticky header of ITS OWN scroll view still has the header over it', () => {
      const row = uiNode({ role: 'button', label: 'Row', rect: rect(0, 100, 402, 52) });
      const header = uiNode({ role: 'text', label: 'Section', rect: rect(0, 90, 402, 30) });
      const tree = uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'scrollable', rect: IPHONE, children: [row, header] })] });
      expect(drawOrder(tree).exposure(row, IPHONE).covers).toEqual([header]);
    });

    it('the Contacts "New Contact" sheet under WDA: a field, and the Cancel button — the itemless toolbars, the form and the keyboard cover neither', () => {
      const SHEET = rect(0, 62, 402, 812);
      const BAR = rect(0, 83, 402, 48);
      const cancel = uiNode({ role: 'button', label: 'Cancel', rect: rect(16, 89, 60, 34) });
      const field = uiNode({ role: 'textfield', identifier: 'First name', rect: rect(20, 300, 360, 44) });
      const form = uiNode({ role: 'scrollable', rect: SHEET, children: [field, uiNode({ role: 'textfield', identifier: 'Last name', rect: rect(20, 344, 360, 44) })] });
      const toolbar = (r: UiNode['rect']) => uiNode({ role: 'toolbar', label: 'Toolbar', rect: r, children: [uiNode({ role: 'container', rect: r })] });
      const band = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: rect(0, 573, 402, 301) });
      const tree = uiNode({ role: 'application', rect: IPHONE, children: [uiNode({ role: 'other', rect: IPHONE, children: [cancel, form, toolbar(BAR), toolbar(SHEET)] }), band] });
      for (const target of [cancel, field]) expect(drawOrder(tree).exposure(target, IPHONE).covers).toEqual([]);
    });

    it('the SwiftUI pushed screen: the full-screen toolbar host after a row covers nothing, its item away from the row neither', () => {
      const row = uiNode({ role: 'button', label: 'Wi-Fi', rect: rect(16, 200, 370, 52) });
      const host = uiNode({ role: 'toolbar', label: 'Toolbar', rect: IPHONE, children: [uiNode({ role: 'container', rect: IPHONE, children: [uiNode({ role: 'button', label: 'Done', rect: rect(300, 60, 80, 40) })] })] });
      expect(drawOrder(uiNode({ role: 'application', rect: IPHONE, children: [row, host] })).exposure(row, IPHONE).covers).toEqual([]);
    });

    it('idb\'s floating label lying on its empty field (the measured TextFieldWithComponentStyle): drawn on it, not over it', () => {
      const input = uiNode({ role: 'textfield', identifier: 'TextFieldWithComponentStyle', rect: rect(26, 366, 350, 30) });
      const label = uiNode({ role: 'text', identifier: 'TextFieldWithComponentStyle', label: 'IBAN', rect: rect(42, 372, 120, 18) });
      expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 0, 0), children: [uiNode({ role: 'other', rect: IPHONE }), input, label] })).exposure(input, IPHONE).covers).toEqual([]);
    });
  });
});

/**
 * A Compose `Button` reaches uiautomator as a wrapper holding its label text and, AFTER it, an unlabelled clickable
 * `button` of about the wrapper's rect; a list row's label node has the row's avatar text, one wrapper down, lying on it
 * (docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md — a regression of round 5's C3:
 * `tap text:"LOGIN"` refused, `scroll_until` calling it a layout defect, `fully: true` never stopping on a row).
 */
describe('exposure — a Compose label\'s own control, a row\'s own content (2026-10-09)', () => {
  const PIXEL = rect(0, 0, 1080, 2220);
  const parse = (xml: string) => {
    const tree = parseDump(xml);
    const find = (p: (n: UiNode) => boolean) => [...everyNode(tree)].find(p)!;
    return { tree, find, order: drawOrder(tree) };
  };
  /**
   * The round-5 ui_snapshots (tests/fixtures/android-ui-snapshot-compose.json), by screen — each root marked
   * `paddedTouchTargets`, as the parser marks every uiautomator root since the snapshots were taken (code review of round 6b, P2).
   */
  const snapshots = async (): Promise<Record<string, UiNode>> =>
    Object.fromEntries(
      Object.entries((JSON.parse(await readFile(new URL('../fixtures/android-ui-snapshot-compose.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> }).screens).map(
        ([screen, tree]) => [screen, { ...tree, paddedTouchTargets: true as const }],
      ),
    );
  /** Every text in `tree` with a later `button` sibling holding it whole — the shape the bug note measured. */
  const labelled = (tree: UiNode): UiNode[] =>
    [...everyNode(tree)].flatMap((parent) =>
      parent.children.filter((n, i) => n.role === 'text' && parent.children.slice(i + 1).some((b) => b.role === 'button' && b.rect.x <= n.rect.x && b.rect.y <= n.rect.y && b.rect.x + b.rect.width >= n.rect.x + n.rect.width && b.rect.y + b.rect.height >= n.rect.y + n.rect.height)),
    );

  it('the round-5 ui_snapshots: every text under its own control — LOGIN, PAY / PAY ME / SCAN QR, Contacts\' "No thanks", Save, "Add phone" (cut to 96 px), "Add fields" (to 76), the rows cut at the tab bar — shows whole, its centre tapped', async () => {
    const seen: string[] = [];
    for (const [screen, tree] of Object.entries(await snapshots())) {
      const order = drawOrder(tree);
      for (const text of labelled(tree)) {
        const exposure = order.exposure(text, PIXEL);
        seen.push(`${screen} ${text.label}`);
        expect({ screen, label: text.label, covers: exposure.covers, moved: exposure.tapAt?.moved }).toEqual({ screen, label: text.label, covers: [], moved: false });
      }
    }
    expect(seen.length).toBe(91);
    for (const label of ['LOGIN', 'PAY', 'PAY ME', 'SCAN QR', 'No thanks', 'Sync device and SIM contacts', 'Save', 'Add phone', 'Add fields']) expect(seen.some((s) => s.endsWith(` ${label}`))).toBe(true);
  });

  it('…the measured shapes in them: the control spans its wrapper\'s width, inset only vertically by a share that varies; a row\'s button stays whole where the row\'s container is cut', async () => {
    const { contactsCreateStaged, contactsCreate, accountDetail } = await snapshots();
    const wrapperOf = (tree: UiNode, label: string) => [...everyNode(tree)].find((p) => p.children.some((c) => c.label === label))!;
    const shape = (tree: UiNode, label: string) => {
      const wrapper = wrapperOf(tree, label);
      return { wrapper: wrapper.rect, button: wrapper.children.find((c) => c.role === 'button' && c.rect.x === wrapper.rect.x)!.rect };
    };
    expect(shape(contactsCreateStaged, 'Add fields')).toEqual({ wrapper: rect(132, 2067, 312, 132), button: rect(132, 2078, 312, 76) });
    expect(shape(contactsCreate, 'Add phone')).toEqual({ wrapper: rect(105, 2047, 261, 132), button: rect(105, 2058, 261, 96) });
    const cut = [...everyNode(accountDetail)].filter((n) => n.identifier === 'transactions.list.row_29' || n.identifier === 'transactions.list.row_30');
    expect(cut.map((row) => [row.rect, row.children.at(-1)!.rect])).toEqual([
      [rect(66, 1784, 948, 56), rect(66, 1784, 948, 143)],
      [rect(66, 2088, 948, 99), rect(66, 2044, 948, 143)],
    ]);
    // The label nodes of the rows wholly in the list, clear of the tab bar: no cover — the avatar's text is their own.
    const order = drawOrder(accountDetail);
    const rows = [...everyNode(accountDetail)].filter((n) => n.role === 'other' && n.label?.startsWith('Loan repayment') && n.rect.y >= 401 && n.rect.y + n.rect.height <= 1840);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(order.exposure(row, PIXEL).covers).toEqual([]);
  });

  it('the round-5 ui_snapshots\' ICON buttons — Contacts\' Cancel, More options, Delete: the label node under a control padded by 11 px on all four sides of its 132×132 wrapper shows whole, its centre tapped (a refusal at 2f98900)', async () => {
    const { contactsCreateStaged, contactsCreate } = await snapshots();
    const icons = (tree: UiNode) =>
      [...everyNode(tree)].flatMap((parent) =>
        parent.children.flatMap((n, i) => {
          const control = parent.children.slice(i + 1).find((b) => b.role === 'button' && !b.label && rectWithin(n.rect, b.rect) && b.rect.x !== parent.rect.x);
          return n.label && control ? [{ label: n.label, n, wrapper: parent.rect, control: control.rect }] : [];
        }),
      );
    const seen: string[] = [];
    for (const [screen, tree] of Object.entries({ contactsCreateStaged, contactsCreate })) {
      const order = drawOrder(tree);
      for (const { label, n, wrapper, control } of icons(tree)) {
        seen.push(`${screen} ${label}`);
        expect([wrapper.width, wrapper.height, control.x - wrapper.x, control.y - wrapper.y, control.width, control.height, n.rect.width, n.rect.height]).toEqual([132, 132, 11, 11, 110, 110, 66, 66]);
        expect(order.exposure(n, PIXEL)).toMatchObject({ covers: [], shows: 1, tapAt: { point: rectCentre(control), moved: false } });
      }
    }
    expect(seen.sort()).toEqual(['contactsCreate Cancel', 'contactsCreate Delete', 'contactsCreate More options', 'contactsCreate More options', 'contactsCreateStaged Cancel', 'contactsCreateStaged Delete', 'contactsCreateStaged More options']);
  });

  it.each([
    ['LOGIN', COMPOSE.login, rect(44, 1402, 992, 121), { x: 540, y: 1463 }],
    ['SIGN IN', COMPOSE.signIn, rect(44, 1808, 992, 121), { x: 541, y: 1869 }],
    ['DISCARD', COMPOSE.discard, rect(638, 1192, 276, 121), { x: 776, y: 1253 }],
    ['KEEP EDITING', COMPOSE.discard, rect(262, 1192, 376, 121), { x: 450, y: 1253 }],
    ['No thanks', COMPOSE.noThanks, rect(44, 1967, 992, 110), { x: 541, y: 2023 }],
  ])('through the parser — %s: the unlabelled clickable `button` after the text, spanning its wrapper\'s width and holding it, is its own control — no cover; its centre is tapped', (label, xml, button, centre) => {
    const { find, order } = parse(xml);
    const text = find((n) => n.label === label);
    expect(find((n) => n.role === 'button' && n.rect.x === button.x && n.rect.y === button.y)).toMatchObject({ label: null, rect: button });
    const seen = order.exposure(text, PIXEL);
    expect(seen).toMatchObject({ covers: [], shows: 1, tapAt: { point: centre, moved: false } });
    expect(seen.centreCover).toBeUndefined();
    expect(seen.coverAt(centre)).toBeUndefined();
  });

  it('Account Detail through the parser: the avatar\'s text `LR`, in the avatar\'s wrapper and wholly inside the row\'s label node, is the row\'s own content — the label node shows whole; the floating tab bar\'s host still covers the row beneath it', () => {
    const { find, order } = parse(COMPOSE.accountDetail);
    const label = find((n) => n.label === 'Loan repayment, 17.12.2025, +493.00 EUR');
    expect(label).toMatchObject({ role: 'other', rect: rect(66, 951, 948, 143) });
    expect(order.exposure(label, PIXEL)).toMatchObject({ covers: [], shows: 1, tapAt: { point: { x: 540, y: 1023 }, moved: false } });
    const host = find((n) => n.role === 'container' && n.rect.y === 1840 && n.rect.x === 66);
    const lower = find((n) => n.label === 'Card payment, 15.12.2025, -12.00 EUR');
    const seen = order.exposure(lower, PIXEL);
    expect(seen.covers[0]).toBe(host);
    expect(seen.covers).not.toContain(find((n) => n.label === 'CP'));
    expect(seen.shows).toBeCloseTo(10 / 143);
  });

  it('WDA (wda-source-myport-login-keyboard.json): `login_support`, a childless RN view, has its sibling `login_support_email` drawn on it — and that sibling\'s text `podpora@finportal.sk` is its own content too, no cover (a cover at dd50327)', async () => {
    const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-login-keyboard.json', import.meta.url), 'utf8'));
    const nodes = [...everyNode(tree)];
    const support = nodes.find((n) => n.identifier === 'login_support')!;
    const email = nodes.find((n) => n.identifier === 'login_support_email')!;
    expect([support.children, email.children.map((c) => [c.role, c.label])]).toEqual([[], [['text', 'podpora@finportal.sk']]]);
    expect(drawOrder(tree).exposure(support, tree.rect).covers).toEqual([]);
  });

  describe('what stays a cover', () => {
    const TEXT = rect(481, 1438, 118, 49);
    const text = () => uiNode({ role: 'text', label: 'LOGIN', rect: TEXT });
    const button = (r = rect(44, 1402, 992, 121), partial: Partial<UiNode> = {}) => uiNode({ role: 'button', rect: r, ...partial });
    const WRAPPER = rect(44, 1397, 992, 132);
    /** The label and `later` in `parent`'s rect, on a Compose screen (uiautomator's root mark, `paddedTouchTargets`). */
    const inParent = (target: UiNode, later: UiNode, parent = WRAPPER) =>
      uiNode({ role: 'container', rect: PIXEL, paddedTouchTargets: true, children: [uiNode({ role: 'container', rect: PIXEL, children: [uiNode({ role: 'container', rect: parent, children: [target, later] })] })] });
    const coversOf = (target: UiNode, later: UiNode, parent = WRAPPER) => drawOrder(inParent(target, later, parent)).exposure(target, PIXEL).covers;

    it('an interactive target is no label: a later button holding a button whole in their wrapper covers it', () => {
      const target = uiNode({ role: 'button', label: 'Inner', rect: TEXT });
      const later = button();
      expect(coversOf(target, later)).toEqual([later]);
    });

    it('a scrim or backdrop: a clickable sibling in a SCREEN-SIZED parent (an RN transparent Modal\'s Pressable), or screen-sized itself in a full-width sheet (a dismiss region), covers the text it holds', () => {
      const target = text();
      const scrim = button(PIXEL);
      expect(coversOf(target, scrim, PIXEL)).toEqual([scrim]);
      // Spanning a screen-sized layout's width, not screen-sized itself: the layout is no wrapper of it.
      const band = button(rect(0, 1300, 1080, 300));
      expect(coversOf(target, band, PIXEL)).toEqual([band]);
      // Screen-sized itself, spanning a sheet's width and reaching past it.
      const past = button(PIXEL);
      expect(coversOf(target, past, rect(0, 400, 1080, 1820))).toEqual([past]);
    });

    it('the control spans its wrapper\'s WIDTH, as measured: one inset by a pixel on either side or shifted by one, one spanning only the height, one not holding the label whole (a clear button), one that says something (a label, a value) covers it; one reaching past the wrapper vertically (a row cut at the list\'s edge) does not', () => {
      const target = text();
      for (const r of [rect(45, 1402, 991, 121), rect(44, 1402, 991, 121), rect(45, 1402, 992, 121), rect(400, 1397, 300, 132), rect(560, 1440, 60, 45)]) {
        const later = button(r);
        expect(coversOf(target, later)).toEqual([later]);
      }
      for (const said of [button(undefined, { label: 'LOG IN' }), button(undefined, { value: 'on' })]) expect(coversOf(target, said)).toEqual([said]);
      expect(coversOf(target, button(rect(44, 1300, 992, 300)))).toEqual([]);
      // Spanning the width but missing the label's bottom: a cover.
      const low = uiNode({ role: 'text', label: 'LOGIN', rect: rect(481, 1500, 118, 25) });
      const upper = button(rect(44, 1397, 992, 110));
      expect(coversOf(low, upper)).toEqual([upper]);
    });

    it('a control of ANOTHER parent covers: the pinned CONTINUE bar after the list, a bar in a sheet beside the label\'s wrapper, an unlabelled Surface spanning a wrapper of its own', () => {
      const target = text();
      const bar = button(rect(44, 1400, 992, 132));
      const tree = uiNode({ role: 'container', rect: PIXEL, children: [uiNode({ role: 'container', rect: rect(0, 0, 1080, 1500), clipsDescendants: true, children: [uiNode({ role: 'container', rect: WRAPPER, children: [target] })] }), bar] });
      expect(drawOrder(tree).exposure(target, PIXEL).covers).toEqual([bar]);
      const sheet = uiNode({ role: 'container', rect: rect(0, 1200, 1080, 600), children: [uiNode({ role: 'container', rect: WRAPPER, children: [target] }), bar] });
      expect(drawOrder(uiNode({ role: 'container', rect: PIXEL, children: [sheet] })).exposure(target, PIXEL).covers).toEqual([bar]);
      const surface = button(rect(44, 1392, 992, 136));
      const own = uiNode({ role: 'container', rect: rect(44, 1390, 992, 140), children: [surface] });
      const beside = uiNode({ role: 'container', rect: PIXEL, children: [uiNode({ role: 'container', rect: rect(0, 1200, 1080, 600), children: [uiNode({ role: 'container', rect: WRAPPER, children: [target] }), own] })] });
      expect(drawOrder(beside).exposure(target, PIXEL).covers).toEqual([own, surface]);
    });

    it('a classic View\'s pinned CTA in the SAME layout as a text (review of fix/r6, synthetic): LOG IN over "Forgot password?" with the keyboard up, CONTINUE over the terms, a sheet\'s PAY over its fee — inset from the layout\'s sides and labelled: a cover', () => {
      const cases: [string, string, string][] = [
        ['Forgot password?', 'LOG IN', CLASSIC_VIEWS.loginImeUp],
        ['By continuing you accept the terms', 'CONTINUE', CLASSIC_VIEWS.terms],
        ['Fee: 2.00 EUR', 'PAY', CLASSIC_VIEWS.sheet],
      ];
      for (const [label, cta, xml] of cases) {
        const { find, order } = parse(xml);
        const seen = order.exposure(find((n) => n.label === label), PIXEL);
        expect(seen.covers.map((n) => n.label)).toEqual([cta]);
        expect(seen.tapAt).toBeUndefined();
      }
      // Unlabelled, LOG IN still covers: it does not span its layout's width, nor is it padded evenly on all four sides (40, 40, 940, 20).
      const { find, order } = parse(CLASSIC_VIEWS.loginImeUp);
      const login = find((n) => n.label === 'LOG IN');
      login.label = null;
      expect(order.exposure(find((n) => n.label === 'Forgot password?'), PIXEL).covers).toEqual([login]);
    });

    describe('the icon button\'s control, padded on all four sides (Contacts\' Cancel: wrapper 11,88 132x132, control 22,99 110x110, label node 44,121 66x66)', () => {
      const ICON_WRAPPER = rect(11, 88, 132, 132);
      const icon = (r = rect(44, 121, 66, 66)) => uiNode({ role: 'other', label: 'Cancel', rect: r });

      it('padded evenly, or within a pixel (a centred placement rounded — 126 px around 105 at 2.625 dp/px, insets 11 and 10): no cover', () => {
        expect(coversOf(icon(), button(rect(22, 99, 110, 110)), ICON_WRAPPER)).toEqual([]);
        expect(coversOf(icon(rect(43, 120, 63, 63)), button(rect(22, 99, 105, 105)), rect(11, 88, 126, 126))).toEqual([]);
        // A 24-dp control padded to 48 dp at 2.625 px/dp: 63 px in 126, insets 32 and 31 — 2×32 is the side plus the rounding's pixel.
        expect(coversOf(icon(rect(51, 128, 47, 47)), button(rect(43, 120, 63, 63)), rect(11, 88, 126, 126))).toEqual([]);
      });

      it('a cover: a control flush with a side (insets 0 and 1), insets differing by two, an inset over half the control\'s side, a label off the control\'s centre on either axis, a control that says something', () => {
        for (const r of [rect(11, 88, 131, 131), rect(22, 99, 108, 110)]) {
          const later = button(r);
          expect(coversOf(icon(), later, ICON_WRAPPER)).toEqual([later]);
        }
        const wide = button(rect(55, 132, 44, 44));
        expect(coversOf(icon(rect(66, 143, 22, 22)), wide, ICON_WRAPPER)).toEqual([wide]);
        // The SHORTER side bounds it: insets of 30 around a 110×40 control (2×30 over 40, under 110).
        const flat = button(rect(41, 118, 110, 40));
        expect(coversOf(icon(rect(86, 128, 20, 20)), flat, rect(11, 88, 170, 100))).toEqual([flat]);
        // Off by 2 px on either axis is off centre too (centre (77,154) → (79,154), (77,156)).
        for (const r of [rect(24, 101, 40, 40), rect(57, 101, 40, 40), rect(24, 134, 40, 40), rect(59, 134, 40, 40), rect(57, 136, 40, 40)]) {
          const later = button(rect(22, 99, 110, 110));
          expect(coversOf(icon(r), later, ICON_WRAPPER)).toEqual([later]);
        }
        const said = button(rect(22, 99, 110, 110), { label: 'Close' });
        expect(coversOf(icon(), said, ICON_WRAPPER)).toEqual([said]);
      });

      it('residual, stated: an icon button CUT by a list\'s or scroll view\'s edge — insets 11, 11, 11, 41 — is still refused', () => {
        const cut = button(rect(22, 99, 110, 80));
        expect(coversOf(icon(rect(44, 121, 66, 56)), cut, ICON_WRAPPER)).toEqual([cut]);
      });

      it('only where measured — uiautomator\'s tree (`paddedTouchTargets`; code review of round 6b, P2): under WDA an unlabelled button centred over a text with an even margin in its card stays a cover; spanning the card\'s width, it is the text\'s own control there too', () => {
        // The same shape on the iPhone 17 under WDA: a card `Other` → its text, then an unlabelled overlay `Button` 8 pt in.
        const label = uiNode({ role: 'text', label: 'Cancel', rect: rect(40, 220, 40, 20) });
        const overlay = button(rect(20, 200, 80, 60));
        const card = uiNode({ role: 'container', rect: rect(12, 192, 96, 76), children: [label, overlay] });
        const wda = uiNode({ role: 'container', rect: rect(0, 0, 402, 874), children: [uiNode({ role: 'container', rect: rect(0, 0, 402, 874), children: [card] })] });
        expect(drawOrder(wda).exposure(label, rect(0, 0, 402, 874)).covers).toEqual([overlay]);
        // The mark alone makes it the label's own: the shape is the measured one.
        expect(drawOrder({ ...wda, paddedTouchTargets: true }).exposure(label, rect(0, 0, 402, 874)).covers).toEqual([]);
        // spansWidth is not gated: a text button's control (the card's x and width) is the text's own on any tree.
        const wide = button(rect(12, 200, 96, 60));
        const spanning = uiNode({ role: 'container', rect: rect(0, 0, 402, 874), children: [uiNode({ role: 'container', rect: rect(12, 192, 96, 76), children: [label, wide] })] });
        expect(drawOrder(spanning).exposure(label, rect(0, 0, 402, 874)).covers).toEqual([]);
      });

      it('through the WDA parser: no tree it gives carries the mark', async () => {
        const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-login-keyboard.json', import.meta.url), 'utf8'));
        expect([...everyNode(tree)].some((n) => n.paddedTouchTargets === true)).toBe(false);
        expect(parseDump(COMPOSE.login).paddedTouchTargets).toBe(true);
      });

      it('a centred dialog-like overlay in a screen-sized parent, padded evenly, still covers', () => {
        const target = uiNode({ role: 'text', label: 'Are you sure?', rect: rect(440, 1060, 200, 100) });
        const overlay = button(rect(40, 40, 1000, 2140));
        expect(coversOf(target, overlay, PIXEL)).toEqual([overlay]);
      });
    });

    it('a non-interactive node of the wrapper\'s width holding the label — an opaque card, a loading view — covers it', () => {
      const target = text();
      for (const role of ['image', 'progress', 'other']) {
        const card = uiNode({ role, rect: rect(44, 1402, 992, 121), ...(role === 'other' && { label: 'Loading' }) });
        expect(coversOf(target, card)).toEqual([card]);
      }
    });

    it('in idb\'s flat list every node is a sibling, of the 0×0 root that no control spans: a later button holding the text, its top at the text\'s, covers it', () => {
      const target = text();
      const later = button(rect(44, 1438, 992, 121));
      expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: PIXEL }), target, later] })).exposure(target, PIXEL).covers).toEqual([later]);
      // Nor an icon's padded control: no node lies inside the 0×0 root (both below the top bar's band, so content).
      const icon = uiNode({ role: 'other', label: 'Cancel', rect: rect(44, 1121, 66, 66) });
      const padded = button(rect(22, 1099, 110, 110));
      expect(drawOrder(uiNode({ role: 'container', rect: rect(0, 0, 0, 0), flatList: true, children: [uiNode({ role: 'other', rect: PIXEL }), icon, padded] })).exposure(icon, PIXEL).covers).toEqual([padded]);
    });

    it('a row\'s own content is narrow: in the avatar\'s wrapper, an interactive node, a text reaching outside the label node, and any text under a full-width sibling (a header) cover it; so does content two wrappers down', () => {
      const label = uiNode({ role: 'other', label: 'Loan repayment', rect: rect(66, 951, 948, 143) });
      const rowOf = (sibling: UiNode) => uiNode({ role: 'container', rect: PIXEL, children: [uiNode({ role: 'container', rect: rect(66, 951, 948, 143), children: [label, sibling] })] });
      const avatar = (inner: UiNode) => uiNode({ role: 'container', rect: rect(116, 979, 88, 88), children: [inner] });
      const own = uiNode({ role: 'text', label: 'LR', rect: rect(136, 999, 48, 49) });
      expect(drawOrder(rowOf(avatar(own))).exposure(label, PIXEL).covers).toEqual([]);
      const badge = uiNode({ role: 'button', label: 'Edit', rect: rect(136, 999, 48, 49) });
      expect(drawOrder(rowOf(avatar(badge))).exposure(label, PIXEL).covers).toEqual([badge]);
      const out = uiNode({ role: 'text', label: 'LR', rect: rect(136, 1080, 48, 49) });
      expect(drawOrder(rowOf(avatar(out))).exposure(label, PIXEL).covers).toEqual([out]);
      const header = uiNode({ role: 'container', label: 'December', rect: rect(66, 940, 948, 60), children: [uiNode({ role: 'text', label: 'December', rect: rect(100, 951, 300, 40) })] });
      expect(drawOrder(rowOf(header)).exposure(label, PIXEL).covers).toEqual([header, header.children[0]]);
      const deep = uiNode({ role: 'text', label: 'LR', rect: rect(136, 999, 48, 49) });
      expect(drawOrder(rowOf(avatar(uiNode({ role: 'container', rect: rect(126, 990, 68, 68), children: [deep] })))).exposure(label, PIXEL).covers).toEqual([deep]);
    });

    it('…and only of a CHILDLESS target: the list holding the rows, with the tab bar\'s host drawn on it as its sibling, still has the tab and its label over it', () => {
      const tree = parseDump(COMPOSE.accountDetail);
      const list = [...everyNode(tree)].find((n) => n.clipsDescendants === true)!;
      const covers = drawOrder(tree).exposure(list, PIXEL).covers;
      expect(covers.map((n) => n.identifier ?? n.label)).toEqual(['nav.tab_home', 'Home']);
    });
  });
});
