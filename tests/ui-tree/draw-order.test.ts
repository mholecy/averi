import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { everyNode, KEYBOARD_ROLE, rectsOverlap, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { isInteractive } from '../../src/ui-tree/selectors.js';
import { node as uiNode } from '../helpers/fake.js';

/**
 * The draw-order module's interface (ui-tree/draw-order.ts): its three
 * questions, each pinned on the device shapes its rows were measured on.
 */

/** mp-native's SWIFT form under idb at six scroll positions, rows under the top bar (device check C3-3, 2026-10-09). */
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

  it('structural: an unlabelled `container` with children is no cover at a point, but is drawn over a container (the Compose tab-bar host) and over a target it does not hold whole', () => {
    const later = uiNode({ role: 'container', rect: strip, children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [later] });
  });

  it('structural, holding the target AND its scroll view whole: judged through its content for a target — a WDA `Other` frame laid after the form', () => {
    const later = uiNode({ role: 'container', rect: rect(0, 0, 400, 650), children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] });
    expect(ask(later)).toEqual({ shadowing: undefined, drawnOver: [later], target: [] });
  });

  it('structural, holding the target whole but not its scroll view nor the screen: a bar\'s host, a cover (review round 1: the Compose host over a small target above its tabs)', () => {
    const later = uiNode({ role: 'container', rect: card, children: [uiNode({ role: 'container', rect: rect(0, 700, 10, 10) })] });
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

    it('the myport 2FA screen\'s Späť moved down onto the horizontal scroll indicator (0,485 402x30): still tapped at its centre', async () => {
      const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-myport-2fa-keyboard-toolbar.json', import.meta.url), 'utf8'));
      const nodes = [...everyNode(tree)];
      const indicator = nodes.find((n) => n.label?.startsWith('Horizontal scroll bar'))!;
      expect(indicator).toMatchObject({ role: 'container', rect: rect(0, 485, 402, 30) });
      const back = nodes.find((n) => n.label === 'Späť')!;
      back.rect = { ...back.rect, y: indicator.rect.y - 5 };
      expect(drawOrder(tree).exposure(back, tree.rect)).toMatchObject({ covers: [], tapAt: { moved: false } });
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
      // A sheet starting ABOVE a content target is a cover again (the interim rule\'s stated miss).
      const sheet = uiNode({ role: 'button', label: 'Sheet', rect: rect(0, 200, 402, 400) });
      expect(drawOrder(flat(back, row, sheet)).exposure(row, IPHONE).covers).toEqual([sheet]);
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

    it('a bar button with the form scrolled under the translucent bar (WDA lists the bar first): the scroll view\'s rows are no cover of it', () => {
      const back = uiNode({ role: 'button', label: 'BackButton', rect: rect(30, 70, 28, 28) });
      const under = uiNode({ role: 'button', label: 'Debit account', rect: rect(16, 60, 370, 52) });
      const form = uiNode({ role: 'scrollable', rect: IPHONE, children: [under] });
      const seen = drawOrder(uiNode({ role: 'application', rect: IPHONE, children: [back, form] })).exposure(back, IPHONE);
      expect(seen).toMatchObject({ covers: [], tapAt: { point: { x: 44, y: 84 }, moved: false } });
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
