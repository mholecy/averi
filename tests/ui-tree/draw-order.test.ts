import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, KEYBOARD_ROLE, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { node as uiNode } from '../helpers/fake.js';

/**
 * The draw-order module's interface (ui-tree/draw-order.ts): its three
 * questions, each pinned on the device shapes its rows were measured on.
 */

describe('shadowing — the later node drawn over a point (the dismissal picker\'s cover test)', () => {
  const P = { x: 100, y: 100 };
  /** A text node whose rect contains P, unless overridden. */
  const text = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'text', rect: { x: 50, y: 50, width: 100, height: 100 }, ...partial });
  const screen = (...children: UiNode[]): UiNode => uiNode({ role: 'container', rect: { x: 0, y: 0, width: 400, height: 800 }, children });
  const fullScreen = (partial: Partial<UiNode> = {}): UiNode => uiNode({ role: 'other', rect: { x: 0, y: 0, width: 400, height: 800 }, ...partial });

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
    expect(drawOrder(app(tall, title, toolbar())).shadowing(title, at)).toBeUndefined();
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

/**
 * Where the two questions read `NOT_DRAWN` differently, each kept as its caller has been measured against:
 * one node, the same tree, two answers. Unifying a row is a behaviour change, judged per row.
 */
describe('the two questions disagree on purpose, per row', () => {
  const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const SCREEN = rect(0, 0, 400, 800);
  const LIST = rect(0, 0, 400, 600);
  const P = { x: 200, y: 300 };
  /** A clipping list holding the point's target, then `later` drawn after it. */
  const ask = (later: UiNode) => {
    const target = uiNode({ role: 'text', label: 'title', rect: rect(150, 280, 100, 40) });
    const tree = uiNode({ role: 'application', rect: SCREEN, children: [uiNode({ role: 'container', rect: LIST, clipsDescendants: true, children: [target] }), later] });
    const order = drawOrder(tree);
    return { shadowing: order.shadowing(target, P), drawnOver: order.drawnOver(LIST) };
  };
  const card = rect(100, 250, 200, 100);

  it('structural: an unlabelled `container` with children is no cover at a point, but is drawn over a container (the Compose tab-bar host)', () => {
    const later = uiNode({ role: 'container', rect: card, children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later] });
  });

  it('screen-sized host: an interactive one covers a point, but is never drawn over a container', () => {
    const later = uiNode({ role: 'button', label: 'Close', rect: SCREEN, children: [uiNode({ role: 'text', label: 'x', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: later, drawnOver: [] });
  });

  it('content-framed: a `scrollable` with children covers a point only through them, but is drawn over a container', () => {
    const later = uiNode({ role: 'scrollable', rect: card, children: [uiNode({ role: 'text', label: 'row', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later] });
  });

  it('itemless toolbar: no cover at a point, but drawn over a container', () => {
    const later = uiNode({ role: 'toolbar', rect: card, children: [uiNode({ role: 'container', rect: card })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later] });
  });

  it('keyboard: its own nodes cover a point, but are left out of what is drawn over a container', () => {
    const later = uiNode({ role: KEYBOARD_ROLE, ofKeyboard: true, rect: card });
    expect(ask(later)).toEqual({ shadowing: later, drawnOver: [] });
  });
});
