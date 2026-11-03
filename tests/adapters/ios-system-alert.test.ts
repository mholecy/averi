import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { alertButtonsText, alertInWda, alertShapeInIdb, ALERT_ADVICE, namesApp, titleAsksToOpen, type IdbAlertElement } from '../../src/adapters/ios-system-alert.js';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import type { SystemAlert, UiNode } from '../../src/adapters/types.js';

// D54 (D49b, 2026-11-02; ADR 0032's D54 amendment): iOS's "Open in “AveriLab”?" confirmation, as both tree sources
// list it — batch-5 D49A's captures (E2 over SpringBoard, E3 with Contacts in front), cut to the fields averi reads.
// idb lists the alert alone under SpringBoard's Application (label a single space): the title and two Buttons, no
// status bar; WDA's /source holds an `Alert`, which averi's parser marks (`presentation: 'alert'` on its layer).

const json = async (name: string): Promise<unknown> => JSON.parse(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
const IDB_E2 = ((await json('idb-springboard-open-in-alert.json')) as { elements: IdbAlertElement[] }).elements;
const WDA_E2 = parseWdaSourceValue(await json('wda-capture-springboard-open-in-alert.json'));
const WDA_E3 = parseWdaSourceValue(await json('wda-capture-contacts-open-in-alert.json'));
/** The lab app's names, as `simctl appinfo dev.averi.lab` lists them. */
const LAB_NAMES = ['AveriLab'];

/** What both sources say of the captured alert: the title verbatim, the buttons in order at their centres. */
const OPEN_IN: SystemAlert = {
  title: 'Open in “AveriLab”?',
  buttons: [
    { label: 'Cancel', centre: { x: 127, y: 474 } },
    { label: 'Open', centre: { x: 275, y: 474 } },
  ],
};

const f = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const SCREEN = f(0, 0, 402, 874);
const app = (label: string): IdbAlertElement => ({ type: 'Application', AXLabel: label, frame: SCREEN });
const text = (label: string): IdbAlertElement => ({ type: 'StaticText', AXLabel: label, frame: f(71, 409, 260, 20) });
const button = (label: string | null, x = 57): IdbAlertElement => ({ type: 'Button', AXLabel: label, frame: f(x, 450, 140, 48) });

describe('alertShapeInIdb — SpringBoard listing only a title and one to four buttons (the shape alone, no names)', () => {
  it('the captured alert (E2): its title and both buttons, each at its centre', () => {
    expect(alertShapeInIdb(IDB_E2)).toEqual(OPEN_IN);
  });

  it('any title passes the shape — a localised one, or one naming no app (the title gate is titleAsksToOpen)', () => {
    const de = [app(' '), text('In „AveriLab“ öffnen?'), button('Abbrechen'), button('Öffnen', 205)];
    expect(alertShapeInIdb(de)).toEqual({
      title: 'In „AveriLab“ öffnen?',
      buttons: [
        { label: 'Abbrechen', centre: { x: 127, y: 474 } },
        { label: 'Öffnen', centre: { x: 275, y: 474 } },
      ],
    });
    expect(alertShapeInIdb([app(' '), text('Allow notifications?'), button('OK')])?.title).toBe('Allow notifications?');
  });

  it('one to four buttons; none, or five, is not this shape', () => {
    expect(alertShapeInIdb([app(' '), text('Open in “AveriLab”?'), button('OK')])?.buttons).toHaveLength(1);
    const four = [app(' '), text('Open in “AveriLab”?'), ...[1, 2, 3, 4].map((i) => button(`B${i}`, i * 10))];
    expect(alertShapeInIdb(four)?.buttons).toHaveLength(4);
    expect(alertShapeInIdb([app(' '), text('Open in “AveriLab”?')])).toBeUndefined();
    expect(alertShapeInIdb([...four, button('B5', 50)])).toBeUndefined();
  });

  it('the title is the first text, a second text does not replace it', () => {
    expect(alertShapeInIdb([app(' '), text('Allow AveriLab?'), text('More'), button('OK')])?.title).toBe('Allow AveriLab?');
  });

  // Negative fixtures: the lab, an app's own Cancel and "Open in Maps", an app's own alert, SpringBoard's launch tree.
  it('the lab app in front (batch-5 case-rs-idb-E6: "AveriLab", Target A–D): no shape', () => {
    const lab = [app('AveriLab'), ...['A', 'B', 'C', 'D'].map((x, i) => ({ ...button(`Target ${x}`), AXUniqueId: `lab.open.${x}`, frame: f(51, 110 + 180 * i, 300, 64) }))];
    expect(alertShapeInIdb(lab)).toBeUndefined();
  });

  it("an app's own Cancel and \"Open in Maps\" (the front app is not SpringBoard): no shape", () => {
    expect(alertShapeInIdb([app('Contacts'), text('Open in “AveriLab”?'), button('Cancel'), button('Open in Maps', 205)])).toBeUndefined();
  });

  it("an app's own alert of the same shape (the lab's alert-dim truth tree): its Application is the app's, so no shape", async () => {
    const dim = (await json('truth/ios-iphone17-ios27/alert-dim.idb.json')) as IdbAlertElement[];
    expect(dim.map((e) => e.type)).toEqual(['Application', 'StaticText', 'StaticText', 'Button', 'Button']);
    expect(alertShapeInIdb(dim)).toBeUndefined();
  });

  // SpringBoard's launch tree as measured (docs/bugs/2026-10-08-ios-launch-transition-tree-reads-as-rendered.md, the
  // elements tests/ui-tree/bare-tree.test.ts rebuilds: the status bar and the zooming icon), the icon the lab's: the
  // status items are no StaticText or Button, so it is no alert's shape though its icon names the app.
  it("SpringBoard's measured launch tree, its icon labelled \"AveriLab\": no shape", () => {
    const launch: IdbAlertElement[] = [
      app(' '),
      { type: 'StaticText', AXLabel: '18:29', frame: f(50, 22, 48, 22) },
      { type: 'StatusItem', AXLabel: 'Cellular', frame: f(285, 25, 20, 14) },
      { type: 'StatusItem', AXLabel: null, AXUniqueId: '3 of 3 Wi-Fi bars', frame: f(314, 26, 18, 13) },
      { type: 'StatusItem', AXLabel: '100 % battery power', frame: f(341, 25, 29, 14) },
      { type: 'Button', AXLabel: 'AveriLab', AXUniqueId: 'AveriLab', frame: f(-2, 234, 406, 406) },
    ];
    expect(alertShapeInIdb(launch)).toBeUndefined();
  });

  it('an unlabelled or empty Application, a missing title label or a button without one or without a frame: no shape', () => {
    expect(alertShapeInIdb([app(''), text('Open in “AveriLab”?'), button('OK')])).toBeUndefined();
    expect(alertShapeInIdb([{ type: 'Application', frame: SCREEN }, text('Open in “AveriLab”?'), button('OK')])).toBeUndefined();
    expect(alertShapeInIdb([text('Open in “AveriLab”?'), button('OK')])).toBeUndefined();
    expect(alertShapeInIdb([app(' '), { type: 'StaticText', AXLabel: null }, button('OK')])).toBeUndefined();
    expect(alertShapeInIdb([app(' '), text(''), button('OK')])).toBeUndefined();
    expect(alertShapeInIdb([app(' '), text('Open in “AveriLab”?'), button(null)])).toBeUndefined();
    expect(alertShapeInIdb([app(' '), text('Open in “AveriLab”?'), button('')])).toBeUndefined();
    expect(alertShapeInIdb([app(' '), text('Open in “AveriLab”?'), { type: 'Button', AXLabel: 'OK' }])).toBeUndefined();
  });

  it('centres are rounded to whole points', () => {
    const odd = [app(' '), text('Open in “AveriLab”?'), { type: 'Button', AXLabel: 'OK', frame: f(10.4, 20.2, 15, 9.3) }];
    expect(alertShapeInIdb(odd)?.buttons).toEqual([{ label: 'OK', centre: { x: 18, y: 25 } }]);
  });
});

describe("titleAsksToOpen — the idb title gate: an app's name in it, or the English \"Open in “…”?\"", () => {
  it('the English form passes without a name (appinfo named none of it, or another)', () => {
    expect(titleAsksToOpen('Open in “AveriLab”?', [])).toBe(true);
    expect(titleAsksToOpen('Open in “AveriLab”?', ['Lab Two'])).toBe(true);
  });

  it('a localised title passes by the app name it contains, and fails without it', () => {
    expect(titleAsksToOpen('In „AveriLab“ öffnen?', LAB_NAMES)).toBe(true);
    expect(titleAsksToOpen('In „AveriLab“ öffnen?', [])).toBe(false);
  });

  it('a clock, or another prompt naming no app: fails', () => {
    expect(titleAsksToOpen('18:29', LAB_NAMES)).toBe(false);
    expect(titleAsksToOpen('Allow notifications?', LAB_NAMES)).toBe(false);
    expect(titleAsksToOpen('Open in Maps', LAB_NAMES)).toBe(false);
  });
});

describe("alertInWda — the layer averi marks as an alert, in SpringBoard's tree", () => {
  it('the captured alert over SpringBoard (E2): the Alert\'s label and its buttons, as idb lists them', () => {
    expect(alertInWda(WDA_E2)).toEqual(OPEN_IN);
  });

  it("with Contacts in front (E3): the same — Contacts' hidden \"Return to AveriLab\" breadcrumb Button, outside the alert, is not one of its buttons", () => {
    expect(alertInWda(WDA_E3)).toEqual(OPEN_IN);
  });

  it("an app's own alert (the lab's alert-dim truth tree, its Application \"AveriLab\"): not SpringBoard's, so no alert", async () => {
    const dim = parseWdaSourceValue(await json('truth/ios-iphone17-ios27/alert-dim.wda.json'));
    expect(dim.children.some(function marked(n): boolean { return n.presentation === 'alert' || n.children.some(marked); })).toBe(true);
    expect(alertInWda(dim)).toBeUndefined();
  });

  it("Contacts' own Popover and Sheet, and Contacts' New Contact screen: no alert", async () => {
    expect(alertInWda(parseWdaSourceValue(await json('wda-capture-contacts-discard-popover.json')))).toBeUndefined();
    expect(alertInWda(parseWdaSourceValue(await json('wda-capture-contacts-new-contact.json')))).toBeUndefined();
  });

  /** E2's tree with the alert layer's subtree changed by `edit`. */
  const editAlert = (edit: (layer: UiNode) => void) => {
    const tree = structuredClone(WDA_E2);
    const visit = (n: UiNode): void => {
      if (n.presentation === 'alert') edit(n);
      else n.children.forEach(visit);
    };
    visit(tree);
    return tree;
  };

  it("the Alert element's label is the title, over its first text", () => {
    const tree = editAlert((layer) => {
      const visit = (n: UiNode): void => {
        if (n.presentationElement === true) n.label = 'Open in “AveriLab” (the Alert)';
        n.children.forEach(visit);
      };
      visit(layer);
    });
    expect(alertInWda(tree)?.title).toBe('Open in “AveriLab” (the Alert)');
  });

  it("the title falls back to the alert's first text when the Alert element has no label", () => {
    const tree = editAlert((layer) => {
      const visit = (n: UiNode): void => {
        if (n.presentationElement === true) n.label = null;
        n.children.forEach(visit);
      };
      visit(layer);
    });
    expect(alertInWda(tree)).toEqual(OPEN_IN);
  });

  it('no title at all, or no labelled visible button: no alert (the reply falls back to the note)', () => {
    const untitled = editAlert((layer) => {
      const visit = (n: UiNode): void => {
        if (n.presentationElement === true || n.role === 'text') n.label = null;
        n.children.forEach(visit);
      };
      visit(layer);
    });
    expect(alertInWda(untitled)).toBeUndefined();
    const buttonless = editAlert((layer) => {
      const visit = (n: UiNode): void => {
        if (n.role === 'button' && n.label === 'Cancel') n.hidden = true;
        if (n.role === 'button' && n.label === 'Open') n.label = '';
        n.children.forEach(visit);
      };
      visit(layer);
    });
    expect(alertInWda(buttonless)).toBeUndefined();
  });

  it('a hidden or unlabelled button inside the alert is left out; the others stay', () => {
    const tree = editAlert((layer) => {
      const visit = (n: UiNode): void => {
        if (n.role === 'button' && n.label === 'Cancel') n.hidden = true;
        n.children.forEach(visit);
      };
      visit(layer);
    });
    expect(alertInWda(tree)?.buttons).toEqual([{ label: 'Open', centre: { x: 275, y: 474 } }]);
  });

  // An app-switcher card can hold an alert WDA reads hidden (Contacts' own, say) before the one on screen: every marked
  // layer is tried, and the first with a title and a visible labelled button is the alert.
  it('a hidden alert in an app-switcher card before the real one: the real one, not undefined', () => {
    const tree = structuredClone(WDA_E3);
    const node = (over: Partial<UiNode>): UiNode => ({ role: 'container', label: null, identifier: null, value: null, rect: SCREEN, children: [], ...over });
    const parked = node({
      presentation: 'alert',
      children: [
        node({ label: 'Discard changes?', presentationElement: true, rect: f(41, 388, 320, 126) }),
        node({ role: 'button', label: 'Discard', hidden: true, rect: f(57, 450, 140, 48) }),
      ],
    });
    tree.children.unshift(node({ label: 'Contacts', identifier: 'card:com.apple.MobileAddressBook', children: [parked] }));
    expect(alertInWda(tree)).toEqual(OPEN_IN);
  });

  it('a tree that is not SpringBoard\'s (root labelled with an app\'s name) holding the same alert: no alert', () => {
    const tree = structuredClone(WDA_E2);
    tree.label = 'AveriLab';
    expect(alertInWda(tree)).toBeUndefined();
  });
});

describe('namesApp — whether an alert title names the app (the reply words it as asking to open it)', () => {
  it('a name contained in the title, any quotes around it', () => {
    expect(namesApp('Open in “AveriLab”?', LAB_NAMES)).toBe(true);
    expect(namesApp('In „AveriLab“ öffnen?', ['Lab', 'AveriLab'])).toBe(true);
  });

  it('no name in it, no names, or only blank ones: false', () => {
    expect(namesApp('Allow notifications?', LAB_NAMES)).toBe(false);
    expect(namesApp('Open in “AveriLab”?', [])).toBe(false);
    expect(namesApp('Open in “AveriLab”?', ['', ' '])).toBe(false);
  });
});

// D56: one wording of an alert's buttons and of the advice, shared by open_deep_link's reply (mcp/tool-text.ts) and
// launch_app's note (ios-foreground.ts).
describe('alertButtonsText and ALERT_ADVICE — the words both replies quote an alert in (D56)', () => {
  it('one button: "button", its label quoted verbatim with its centre', () => {
    expect(alertButtonsText({ title: 'Allow?', buttons: [{ label: 'Allow Once', centre: { x: 201, y: 500 } }] })).toBe('button "Allow Once" at (201, 500)');
  });

  it('two buttons: "buttons", in the order listed, comma-separated', () => {
    const alert: SystemAlert = {
      title: 'Open in “AveriLab”?',
      buttons: [
        { label: 'Cancel', centre: { x: 127, y: 474 } },
        { label: 'Open', centre: { x: 275, y: 474 } },
      ],
    };
    expect(alertButtonsText(alert)).toBe('buttons "Cancel" at (127, 474), "Open" at (275, 474)');
  });

  it('the advice: a tap by the button\'s label first, its x and y the fallback, none by averi, and what the alert holds back', () => {
    expect(ALERT_ADVICE).toBe(
      'Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y (averi taps nothing itself); ' +
        'every launch stays behind the alert until it is answered',
    );
  });
});

// T4: the trees once Cancel answered the alert (batch-6 A, WDA's /source about 1 s after the tap: the
// wda-capture-*-after-open-in-cancel.json fixtures' `_comment`). Cancel opens nothing, so the tree is the app that was
// in front before the link: SpringBoard's home screen, or Contacts — never the alert, and never the lab. That the
// tree right after the tap is SpringBoard's and the lab's ~1 s after Open (batch-7 A, L3/L4) was summarised by the
// probe, its trees not kept.
describe('alertInWda — WDA\'s tree after Cancel answered "Open in “AveriLab”?" (batch-6 A, real captures)', () => {
  const after = async (name: string): Promise<UiNode> => parseWdaSourceValue(((await json(`wda-capture-${name}-after-open-in-cancel.json`)) as { value: unknown }).value);
  const labels = (tree: UiNode): (string | null)[] => {
    const out: (string | null)[] = [];
    const walk = (n: UiNode): void => {
      out.push(n.label, n.identifier);
      n.children.forEach(walk);
    };
    walk(tree);
    return out;
  };

  it.each([
    ['springboard', ' '],
    ['contacts', 'Contacts'],
  ])('%s beneath: no alert, the root the previous app (%j), no node naming the alert or the lab', async (name, root) => {
    const tree = await after(name);
    expect(tree.label).toBe(root);
    expect(alertInWda(tree)).toBeUndefined();
    expect(labels(tree).filter((l) => l !== null && /Open in|^lab\./.test(l))).toEqual([]);
  });
});
