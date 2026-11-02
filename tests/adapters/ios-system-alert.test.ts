import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { alertInIdb, alertInWda, namesApp, type IdbAlertElement } from '../../src/adapters/ios-system-alert.js';
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

describe('alertInIdb — SpringBoard listing only a title and its buttons, the title naming the app', () => {
  it('the captured alert (E2): its title and both buttons, each at its centre', () => {
    expect(alertInIdb(IDB_E2, LAB_NAMES)).toEqual(OPEN_IN);
  });

  it('the English "Open in “…”?" form is enough without a name (appinfo named none of it)', () => {
    expect(alertInIdb(IDB_E2, [])).toEqual(OPEN_IN);
    expect(alertInIdb(IDB_E2, ['Lab Two'])).toEqual(OPEN_IN);
  });

  it('a localised title is found by the app name it contains (German quotes, not the English form)', () => {
    const de = [app(' '), text('In „AveriLab“ öffnen?'), button('Abbrechen'), button('Öffnen', 205)];
    expect(alertInIdb(de, LAB_NAMES)).toEqual({
      title: 'In „AveriLab“ öffnen?',
      buttons: [
        { label: 'Abbrechen', centre: { x: 127, y: 474 } },
        { label: 'Öffnen', centre: { x: 275, y: 474 } },
      ],
    });
    expect(alertInIdb(de, [])).toBeUndefined();
  });

  it('one to four buttons; none, or five, is not this alert', () => {
    expect(alertInIdb([app(' '), text('Open in “AveriLab”?'), button('OK')], [])?.buttons).toHaveLength(1);
    const four = [app(' '), text('Open in “AveriLab”?'), ...[1, 2, 3, 4].map((i) => button(`B${i}`, i * 10))];
    expect(alertInIdb(four, [])?.buttons).toHaveLength(4);
    expect(alertInIdb([app(' '), text('Open in “AveriLab”?')], [])).toBeUndefined();
    expect(alertInIdb([...four, button('B5', 50)], [])).toBeUndefined();
  });

  it('the title is the first text: a second text that names the app does not make one', () => {
    expect(alertInIdb([app(' '), text('Allow notifications?'), text('AveriLab'), button('OK')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([app(' '), text('Allow AveriLab?'), text('More'), button('OK')], LAB_NAMES)?.title).toBe('Allow AveriLab?');
  });

  // Negative fixtures: an app's own Cancel and "Open in Maps", an app's own alert, SpringBoard's home screen, the lab.
  it('the lab app in front (batch-5 case-rs-idb-E6: "AveriLab", Target A–D): no alert', () => {
    const lab = [app('AveriLab'), ...['A', 'B', 'C', 'D'].map((x, i) => ({ ...button(`Target ${x}`), AXUniqueId: `lab.open.${x}`, frame: f(51, 110 + 180 * i, 300, 64) }))];
    expect(alertInIdb(lab, LAB_NAMES)).toBeUndefined();
  });

  it("an app's own Cancel and \"Open in Maps\" (the front app is not SpringBoard): no alert", () => {
    const maps = [app('Contacts'), text('Open in “AveriLab”?'), button('Cancel'), button('Open in Maps', 205)];
    expect(alertInIdb(maps, LAB_NAMES)).toBeUndefined();
  });

  it("an app's own alert of the same shape (the lab's alert-dim truth tree): its Application is the app's, so no alert", async () => {
    const dim = (await json('truth/ios-iphone17-ios27/alert-dim.idb.json')) as IdbAlertElement[];
    expect(dim.map((e) => e.type)).toEqual(['Application', 'StaticText', 'StaticText', 'Button', 'Button']);
    expect(alertInIdb(dim, LAB_NAMES)).toBeUndefined();
  });

  it("SpringBoard's home screen (its clock and an icon — an Other among them): no alert, by shape", () => {
    const home = [app(' '), text('18:29'), { type: 'Other', AXLabel: 'Dock', frame: f(0, 780, 402, 94) }, { ...button('AveriLab'), AXUniqueId: 'AveriLab' }];
    expect(alertInIdb(home, LAB_NAMES)).toBeUndefined();
    // an icon's caption first, naming the app: the title would pass — the Other (the dock) is what tells it apart
    expect(alertInIdb([app(' '), text('AveriLab'), { type: 'Other', AXLabel: 'Dock', frame: f(0, 780, 402, 94) }, button('AveriLab')], LAB_NAMES)).toBeUndefined();
    // a home screen of only a clock and icons would pass the shape: its title (the clock) names no app
    expect(alertInIdb([app(' '), text('18:29'), button('Contacts'), button('AveriLab', 205)], LAB_NAMES)).toBeUndefined();
  });

  it('an unlabelled or empty Application, a missing title label or a button without one or without a frame: no alert', () => {
    expect(alertInIdb([app(''), text('Open in “AveriLab”?'), button('OK')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([{ type: 'Application', frame: SCREEN }, text('Open in “AveriLab”?'), button('OK')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([text('Open in “AveriLab”?'), button('OK')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([app(' '), { type: 'StaticText', AXLabel: null }, button('OK')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([app(' '), text('Open in “AveriLab”?'), button(null)], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([app(' '), text('Open in “AveriLab”?'), button('')], LAB_NAMES)).toBeUndefined();
    expect(alertInIdb([app(' '), text('Open in “AveriLab”?'), { type: 'Button', AXLabel: 'OK' }], LAB_NAMES)).toBeUndefined();
  });

  it('centres are rounded to whole points', () => {
    const odd = [app(' '), text('Open in “AveriLab”?'), { type: 'Button', AXLabel: 'OK', frame: f(10.4, 20.2, 15, 9.3) }];
    expect(alertInIdb(odd, [])?.buttons).toEqual([{ label: 'OK', centre: { x: 18, y: 25 } }]);
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
