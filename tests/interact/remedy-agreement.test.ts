import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import { keyboardPosition, type KeyboardLine, type KeyboardPosition } from '../../src/ui-tree/keyboard-position.js';
import { presentedRemedy, sceneOf } from '../../src/ui-tree/standing.js';
import type { MarkedLayer } from '../../src/ui-tree/draw-order.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { judgeTap } from '../../src/interact/tap-judgement.js';
import { ElementNotFoundError } from '../../src/interact/resolve.js';
import { overElement } from '../../src/verify/pixel-poll.js';
import { colorSampleRect } from '../../src/verify/color-parity.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { failureOf, play, type Row } from '../helpers/rounds.js';
import { stackedLayers } from '../helpers/stacked-layers.js';
import { node } from '../helpers/fake.js';

// ONE remedy for a target that is not reachable itself (ui-tree/standing.ts#Remedy), decided once by the standing with
// one precedence — a screen presented over the target first (docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md),
// then the rest — and only rendered by the verbs: the tap's refusal (interact/tap-judgement.ts), the pixel assert's miss
// (verify/pixel-poll.ts) and scroll_until's stop (interact/scroll-rounds.ts). A table over the trees with a presented
// screen: each verb's answer for the same target names the same remedy.

// The pixel assert reads idb's band from the tree's own draw order (ui-tree/keyboard-position.ts#keyboardPosition), which
// finds one only in idb's flat list, where no screen reads as presented over another: `idbLine` stands in for that
// band, so the pixel assert's keyboard branch beneath a presented screen can be asked at all.
const { idbLine } = vi.hoisted(() => ({ idbLine: { value: undefined as { y: number; witnessed: boolean } | undefined } }));
vi.mock('../../src/ui-tree/keyboard-position.js', async (orig) => {
  const real = await orig<typeof import('../../src/ui-tree/keyboard-position.js')>();
  return {
    ...real,
    keyboardPosition: (...args: Parameters<typeof real.keyboardPosition>) => {
      const position = real.keyboardPosition(...args);
      return { ...position, readingLine: () => position.readingLine(), owns: (n: UiNode) => position.owns(n), line: (subject?: UiNode, line?: KeyboardLine) => idbLine.value ?? position.line(subject, line) };
    },
  };
});

const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const BOX: Rect = { x: 0, y: 0, width: 402, height: 874 };
const USABLE: UsableScreen = { box: BOX, boxes: [BOX], oriented: BOX, from: 'device', statusBand: 62 };
const NONE = { dismissal: 'none', advice: 'ADV' } as const;

/**
 * A row at the top of a scroll view, its centre (201,50) in the 62-pt status band, beneath a React Native transparent
 * modal: a screen-filling dimming leaf laid on a later screen-sized layer, the card beside it. Two remedies hold of it
 * at once — a scroll out from under the status bar, and closing the screen presented over it — so it is where the three
 * verbs would part if each picked its own.
 */
function probe(): { tree: UiNode; target: UiNode } {
  const target = node({ role: 'text', identifier: 't', label: 'Top row', rect: { x: 0, y: 10, width: 402, height: 80 } });
  const full = (children: UiNode[], extra: Partial<UiNode> = {}) => node({ role: 'container', rect: { ...BOX }, children, ...extra });
  const tree = full(
    [
      full([
        full([node({ role: 'scrollable', rect: { ...BOX }, children: [target, node({ role: 'button', identifier: 'b', label: 'B', rect: { x: 0, y: 200, width: 402, height: 50 } })] })]),
        full([
          full([], { identifier: 'dim' }),
          node({ role: 'container', identifier: 'card', rect: { x: 16, y: 301, width: 370, height: 220 }, children: [node({ role: 'button', identifier: 'close', label: 'Close', rect: { x: 30, y: 320, width: 100, height: 40 } })] }),
        ]),
      ]),
    ],
    { label: 'App' },
  );
  return { tree, target };
}

const stacked = stackedLayers;

const byRect = (tree: UiNode, r: Rect): UiNode =>
  [...everyNode(tree)].find((n) => n.rect.x === r.x && n.rect.y === r.y && n.rect.width === r.width && n.rect.height === r.height)!;

/** A device and the usable screen it gives — the iPhone, unless a row says otherwise. */
interface On {
  readonly device: DeviceScreen;
  readonly usable: UsableScreen;
}
const ON_IPHONE: On = { device: IPHONE, usable: USABLE };
const PIXEL_BOX: Rect = { x: 0, y: 0, width: 1080, height: 2220 };
const ON_PIXEL: On = {
  device: { width: 1080, height: 2220, statusBand: 66, navigationBand: 2154 },
  usable: { box: PIXEL_BOX, boxes: [PIXEL_BOX], oriented: PIXEL_BOX, from: 'device', statusBand: 66, navigationBand: 2154 },
};

/**
 * The tap's refusal of `target` on `tree` (or its point), as the guard's clear path judges it. `position`: the keyboard
 * position to judge with — by default the tree's own, over a reading that sees no keyboard.
 */
async function tapSaid(tree: UiNode, target: UiNode, { device, usable }: On = ON_IPHONE, position?: KeyboardPosition): Promise<string> {
  const scene = sceneOf(tree);
  const reading = { ofKeyboard: () => false, cover: async () => undefined, corroborated: async () => false };
  try {
    const judge = await judgeTap({ viewport: async () => device }, 'id:t', { node: target, tree, scene }, usable, { position: position ?? keyboardPosition(scene.order, reading), remedy: NONE });
    return JSON.stringify(await judge.aim());
  } catch (e) {
    return (e as Error).message;
  }
}

/** The pixel assert's miss for `target` (an ocr assert: the whole rect read). */
const pixelSaid = async (tree: UiNode, target: UiNode, { device }: On = ON_IPHONE): Promise<string | undefined> =>
  overElement({ viewport: async () => device, keyboard: undefined, keyboardAdvice: 'ADV' }, tree, target, { glyphs: true });

/** The pixel assert's miss for `target` as a colour assert reads it: the sample rect (verify/color-parity.ts#colorSampleRect). */
const colourSaid = async (tree: UiNode, target: UiNode, { device }: On = ON_IPHONE): Promise<string | undefined> =>
  overElement({ viewport: async () => device, keyboard: undefined, keyboardAdvice: 'ADV' }, tree, target, { reads: colorSampleRect, glyphs: false });

/** scroll_until's outcome for `target`: two reads of the same tree, the status band known. */
function stopOf(tree: UiNode, target: UiNode, { device, usable }: On = ON_IPHONE) {
  const row: Row = { tree, found: [target], screen: usable };
  return play({ direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: device }, [row, row]);
}

/** `content`'s screen in a screen-sized layer, and — `dimmed` — a later screen-sized layer holding only a dimming leaf: an RN transparent modal's shape. */
function beneathDim(box: Rect, content: UiNode[], dimmed = true): UiNode {
  const full = (children: UiNode[], extra: Partial<UiNode> = {}) => node({ role: 'container', rect: { ...box }, children, ...extra });
  return full([full([full(content), ...(dimmed ? [full([full([], { identifier: 'dim' })])] : [])])]);
}

const PRESENTED_FOR_THE_ELEMENT = presentedRemedy('the element');
const PRESENTED_OVER = presentedRemedy('it');

describe('one remedy for a target beneath a presented screen — the tap, the pixel assert and scroll_until agree', () => {
  /** The cases: the probe, and the real ui_snapshots' targets on which the verbs disagreed. */
  /** The action sheet WDA types in the discard popover's layer, as the remedy names it. */
  const DISCARD_SHEET: MarkedLayer = { kind: 'actionSheet', label: 'Are you sure you want to discard this new contact?' };
  const cases = async (): Promise<[string, UiNode, UiNode, MarkedLayer?][]> => {
    const screens = await stacked();
    const { tree, target } = probe();
    return [
      ['the probe: a scroll view\'s top row under the status bar, beneath an RN modal\'s dim', tree, target],
      ['the RN modal over the Finportal login: its header 0,0 402x102, centre under the status bar', screens.finportalForgot, byRect(screens.finportalForgot, { x: 0, y: 0, width: 402, height: 102 })],
      ['the SWIFT form beneath the Fees sheet: its header 0,0 402x116, centre under the status bar', screens.swiftFeesSheet, byRect(screens.swiftFeesSheet, { x: 0, y: 0, width: 402, height: 116 })],
      ['the SWIFT form beneath the Fees sheet: payee_street_input 24,869 354x52, centre below the screen', screens.swiftFeesSheet, byRect(screens.swiftFeesSheet, { x: 24, y: 869, width: 354, height: 52 })],
      ['the Contacts list beneath the New Contact sheet: a row behind the sheet\'s form', screens.contactsSheet, [...everyNode(screens.contactsSheet)].find((n) => n.label === 'Contact photo for Kate Bell')!],
    ];
  };

  it('the standing carries the presented remedy for every purpose — the tap, the plain stop, the fully stop and the pixel assert', async () => {
    for (const [name, tree, target] of await cases()) {
      const scene = sceneOf(tree);
      const of = (s: { kind: string; remedy?: { of: string } }) => (s.kind === 'reachable' ? 'reachable' : s.remedy?.of);
      expect({
        name,
        tap: of(scene.standing(target, USABLE, { of: 'tap' })),
        stop: of(scene.standing(target, USABLE, { of: 'stop' })),
        fully: of(scene.standing(target, USABLE, { of: 'fully' })),
        pixel: of(scene.standing(target, USABLE, { of: 'pixel', reads: (r) => r, glyphs: true })),
      }).toEqual({ name, tap: 'presented', stop: 'presented', fully: 'presented', pixel: 'presented' });
    }
  });

  it('each verb renders it in its own words: the tap refuses with "close it first", the pixel assert misses with it, scroll_until stops `presented`', async () => {
    for (const [name, tree, target] of await cases()) {
      const tap = await tapSaid(tree, target);
      expect({ name, tap: tap.endsWith(` — ${PRESENTED_OVER}; nothing was tapped`) }).toEqual({ name, tap: true });
      expect({ name, pixel: (await pixelSaid(tree, target))?.endsWith(PRESENTED_FOR_THE_ELEMENT) }).toEqual({ name, pixel: true });
      expect({ name, stop: stopOf(tree, target).outcome?.kind }).toEqual({ name, stop: 'presented' });
    }
  });

  it('the probe, word for word: the tap names the status bar it lies under and the presented screen\'s remedy in place of the bar\'s', async () => {
    const { tree, target } = probe();
    expect(await tapSaid(tree, target)).toBe(
      'id:t is under the status bar at (201,50), in the top 62 of the screen (tree units), where a tap goes to the status bar (rect 0,10 402x80) — ' +
        'a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
    expect(await pixelSaid(tree, target)).toBe(
      'the status bar is drawn over the element (element 0,10 402x80, status bar 0,0 402x62) — the capture would show it, not the element; ' +
        'a screen is presented over the element (a modal or a sheet) — close it first; no scroll moves the element out from under that screen',
    );
    expect(failureOf(stopOf(tree, target), 'id:t').message).toBe(
      'scroll_until id:t stopped before any swipe — element is in the viewport but under container id:dim (0,0 402x874), drawn over it — 0% of it shows — ' +
        'a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen, and a swipe on it may dismiss it, so none was sent. ' +
        'Last rect {"x":0,"y":10,"width":402,"height":80} in a 402x874 viewport',
    );
  });

  it('a target off the screen beneath a presented screen: the tap says close it first, not "scroll_until it with fully: true first" — and none of it is drawn: its 5 pt on the screen lie below its form\'s 780', async () => {
    const screens = await stacked();
    const target = byRect(screens.swiftFeesSheet, { x: 24, y: 869, width: 354, height: 52 });
    expect(await tapSaid(screens.swiftFeesSheet, target)).toBe(`id:t is off screen at (201,895) on a 402x874 screen (rect 24,869 354x52) — ${PRESENTED_OVER}; nothing was tapped`);
  });

  it('every target of every tree with a presented screen: where a verb\'s standing names a presented surface, its remedy is the presented one, whatever its kind', async () => {
    const screens = await stacked();
    for (const [name, tree] of Object.entries(screens)) {
      const scene = sceneOf(tree);
      for (const screen of [USABLE, { ...USABLE, statusBand: undefined }]) {
        for (const target of everyNode(tree)) {
          if (target === tree || target.rect.width * target.rect.height === 0) continue;
          const standings = [
            scene.standing(target, screen, { of: 'tap' }),
            scene.standing(target, screen, { of: 'stop' }),
            scene.standing(target, screen, { of: 'fully' }),
            scene.standing(target, screen, { of: 'pixel', reads: (r) => r, glyphs: true }),
          ];
          for (const s of standings) {
            if (s.kind === 'reachable' || s.facts.presented === undefined) continue;
            expect({ name, rect: target.rect, kind: s.kind, remedy: s.remedy.of }).toEqual({ name, rect: target.rect, kind: s.kind, remedy: 'presented' });
          }
        }
      }
    }
  });
});

/**
 * Presented first whatever else keeps the target from reach — a cut, the soft keyboard — for every verb that judges
 * it: closing the screen presented over the target is the first step, whatever lies beneath it. Synthetic shapes,
 * since no measured tree holds a presented screen over a sliver, a navigation-bar cut or a keyboard band.
 */
describe('presented first over a cut and over the soft keyboard — each verb\'s words', () => {
  /** Android's SWIFT toggle cut to a 948x30 sliver at its clipping form's bottom edge (ADR 0013), beneath a dim or not. */
  const sliver = (dimmed: boolean) => {
    const target = node({ identifier: 't', rect: { x: 66, y: 1949, width: 948, height: 30 }, children: [node({ role: 'text', label: 'Payment details', rect: { x: 66, y: 1961, width: 948, height: 17 } })] });
    const form = node({ role: 'scrollable', clipsDescendants: true, rect: { x: 0, y: 242, width: 1080, height: 1736 }, children: [node({ identifier: 'filler', rect: { x: 66, y: 900, width: 948, height: 100 } }), target] });
    return { tree: beneathDim(PIXEL_BOX, [form, node({ role: 'button', label: 'CONTINUE', rect: { x: 66, y: 1979, width: 948, height: 132 } })], dimmed), target };
  };
  const CUT = "id:t is cut at its scroll container's bottom edge (container 0,242 1080x1736); only a 948x30 part of it shows, 30 deep across that edge, under the 65 a tap needs";

  it('a sliver its scroll container cuts, beneath a dim: the tap names the cut and the presented screen\'s remedy in place of the scroll; scroll_until stops `presented`', async () => {
    const { tree, target } = sliver(true);
    expect(await tapSaid(tree, target, ON_PIXEL)).toBe(`${CUT} — ${PRESENTED_OVER}; nothing was tapped`);
    expect(stopOf(tree, target, ON_PIXEL).outcome?.kind).toBe('presented');
  });

  it('…and with no dim, the cut\'s own remedy, a scroll toward the edge', async () => {
    const { tree, target } = sliver(false);
    expect(await tapSaid(tree, target, ON_PIXEL)).toMatch(new RegExp(`^${CUT.replace(/[()]/g, '\\$&')} — scroll_until it first \\(`));
  });

  /** A settings title flush with the navigation bar's top inside a list ending there (ADR 0009's possible cut), beneath a dim or not. */
  const flushTitle = (dimmed: boolean) => {
    const target = node({ role: 'text', identifier: 't', label: 'Sound', rect: { x: 198, y: 2105, width: 428, height: 49 } });
    const list = node({ role: 'scrollable', clipsDescendants: true, rect: { x: 0, y: 596, width: 1080, height: 1558 }, children: [node({ identifier: 'row', rect: { x: 0, y: 2072, width: 1080, height: 82 }, children: [target] })] });
    return { tree: beneathDim(PIXEL_BOX, [list], dimmed), target };
  };
  const NAV_CUT =
    "the element may be cut at the navigation bar (element 198,2105 428x49, navigation bar from y 2154): it ends on the bar's top edge, as its scroll container 0,596 1080x1558 does, so the crop may read only what shows of it";

  it('an ocr assert on a title that may be cut at the navigation bar, beneath a dim: the cut named, the presented screen\'s remedy in place of the scroll', async () => {
    const { tree, target } = flushTitle(true);
    expect(await pixelSaid(tree, target, ON_PIXEL)).toBe(`${NAV_CUT} — ${PRESENTED_FOR_THE_ELEMENT}`);
  });

  it('…and with no dim, scroll it up', async () => {
    const { tree, target } = flushTitle(false);
    expect(await pixelSaid(tree, target, ON_PIXEL)).toBe(`${NAV_CUT} — scroll it up: scroll_until the element with \`fully: true\` first and re-run`);
  });

  /** A row from y 480 to 580 beneath a dim, its centre (201,530) under idb's band from y 524 (a line no guard acts on). */
  const underBand = (dimmed: boolean) => {
    const target = node({ role: 'button', identifier: 't', rect: { x: 20, y: 480, width: 362, height: 100 } });
    return { tree: beneathDim(BOX, [node({ role: 'scrollable', rect: { ...BOX }, children: [target] })], dimmed), target };
  };
  const BAND: KeyboardLine = { y: 524, witnessed: false };
  const bandPosition: KeyboardPosition = { line: () => BAND, readingLine: async () => undefined, owns: () => false };
  const UNDER = "id:t is under the soft keyboard: its centre (201,530) lies below the keyboard's top edge at y 524, where a tap presses the keyboard";

  it('a tap whose centre lies under the keyboard\'s band, the part above it beneath a dim: the keyboard named, the presented screen\'s remedy in place of hiding it', async () => {
    const { tree, target } = underBand(true);
    expect(await tapSaid(tree, target, ON_IPHONE, bandPosition)).toBe(`${UNDER} — ${PRESENTED_OVER}; nothing was tapped`);
  });

  it('…and with no dim, scroll it or hide the keyboard', async () => {
    const { tree, target } = underBand(false);
    expect(await tapSaid(tree, target, ON_IPHONE, bandPosition)).toMatch(new RegExp(`^${UNDER.replace(/[()]/g, '\\$&')} — scroll_until it first, or hide the keyboard`));
  });

  it('a pixel assert on an element idb\'s band meets, beneath a dim: the keyboard named, the presented screen\'s remedy in place of hiding it', async () => {
    const { tree, target } = underBand(true);
    idbLine.value = BAND;
    try {
      expect(await pixelSaid(tree, target)).toBe(`the soft keyboard covers the element (element 20,480 362x100, keyboard 0,524 402x350) — ${PRESENTED_FOR_THE_ELEMENT}`);
      const clear = underBand(false);
      expect(await pixelSaid(clear.tree, clear.target)).toMatch(/^the soft keyboard covers the element \(element 20,480 362x100, keyboard 0,524 402x350\) — hide it first and re-run/);
    } finally {
      idbLine.value = undefined;
    }
  });
});

/**
 * A target NOTHING of which lies in the frame a verb judges — wholly below the screen, or wholly inside the status band
 * — beneath a presented screen: the presented fact is judged of the node itself, geometry-free
 * (ui-tree/draw-order.ts#DrawOrder.presentedOver, the rule `scroll_until`'s stroke asks at its touch-down less the
 * point), so the tap, the colour and ocr asserts and `scroll_until` all say "close it first", where the tap said
 * "scroll_until it first", the bar's advice, and the colour assert "scroll it on-screen".
 * docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md
 */
describe('a target wholly out of the judged frame beneath a presented screen — presented judged of the node', () => {
  /** Contacts' discard popover with the keyboard down: the raw /source capture, its `add instant message` row wholly below the screen. */
  const popover = async (): Promise<UiNode> => parseWdaSource(await readFile(new URL('../fixtures/wda-capture-contacts-discard-popover.json', import.meta.url), 'utf8'));
  /** The Fees sheet's tree with `priority_select` (and its label) moved to `24,-20 354x52`, wholly inside the 62-pt status band — as one stroke flung it on the device. */
  const inStatusBand = (tree: UiNode): { tree: UiNode; target: UiNode } => {
    let target: UiNode | undefined;
    const moved = (n: UiNode, dy?: number): UiNode => {
      const by = dy ?? (n.identifier === 'swift_payment.form.priority_select' ? -20 - n.rect.y : undefined);
      const out: UiNode = { ...n, rect: by === undefined ? n.rect : { ...n.rect, y: n.rect.y + by }, children: n.children.map((c) => moved(c, by)) };
      if (n.identifier === 'swift_payment.form.priority_select') target = out;
      return out;
    };
    const copy = moved(tree);
    return { tree: copy, target: target! };
  };
  /** The action sheet WDA types in the discard popover's layer, as the remedy names it. */
  const DISCARD_SHEET: MarkedLayer = { kind: 'actionSheet', label: 'Are you sure you want to discard this new contact?' };
  const cases = async (): Promise<[string, UiNode, UiNode, MarkedLayer?][]> => {
    const screens = await stacked();
    const discard = await popover();
    const band = inStatusBand(screens.swiftFeesSheet);
    return [
      ['the SWIFT form beneath the Fees half sheet: bank_country_select 24,1209 354x52, wholly below the screen', screens.swiftFeesSheet, byRect(screens.swiftFeesSheet, { x: 24, y: 1209, width: 354, height: 52 })],
      ['the New Contact sheet beneath the discard popover\'s action sheet: its text `add instant message` 20,1306, wholly below the screen', discard, [...everyNode(discard)].find((n) => n.role === 'text' && n.label === 'add instant message')!, DISCARD_SHEET],
      ['the SWIFT form beneath the Fees sheet: priority_select at 24,-20 354x52, wholly inside the status band', band.tree, band.target],
    ];
  };

  it('every purpose\'s standing carries the presented remedy — the tap, both stops, the ocr and the colour assert', async () => {
    for (const [name, tree, target] of await cases()) {
      const scene = sceneOf(tree);
      const of = (s: { kind: string; remedy?: { of: string } }) => (s.kind === 'reachable' ? 'reachable' : s.remedy?.of);
      expect({
        name,
        tap: of(scene.standing(target, USABLE, { of: 'tap' })),
        stop: of(scene.standing(target, USABLE, { of: 'stop' })),
        fully: of(scene.standing(target, USABLE, { of: 'fully' })),
        ocr: of(scene.standing(target, USABLE, { of: 'pixel', reads: (r) => r, glyphs: true })),
        colour: of(scene.standing(target, USABLE, { of: 'pixel', reads: colorSampleRect, glyphs: false })),
      }).toEqual({ name, tap: 'presented', stop: 'presented', fully: 'presented', ocr: 'presented', colour: 'presented' });
    }
  });

  it('each verb says "close it first": the tap refuses, the ocr and colour asserts miss, scroll_until stops before any swipe', async () => {
    for (const [name, tree, target, layer] of await cases()) {
      const [over, forTheElement] = [presentedRemedy('it', layer), presentedRemedy('the element', layer)];
      expect({ name, tap: (await tapSaid(tree, target)).endsWith(` — ${over}; nothing was tapped`) }).toEqual({ name, tap: true });
      expect({ name, ocr: (await pixelSaid(tree, target))?.endsWith(forTheElement) }).toEqual({ name, ocr: true });
      expect({ name, colour: (await colourSaid(tree, target))?.endsWith(forTheElement) }).toEqual({ name, colour: true });
      for (const direction of ['down', 'up'] as const) {
        const row: Row = { tree, found: [target], screen: USABLE };
        const message = failureOf(play({ direction, fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE }, [row, row]), 'id:t').message;
        expect({ name, direction, stop: message.includes(over) && message.includes('stopped before any swipe') }).toEqual({ name, direction, stop: true });
      }
    }
  });

  it('a colour assert on a sliver beneath a presented sheet never measures the sheet: payee_street_input 24,869 354x52, 5 pt of it on the 402x874 screen beneath the Fees dim — none of them drawn, its form ending at 780 — misses with "close it first"', async () => {
    const screens = await stacked();
    const target = byRect(screens.swiftFeesSheet, { x: 24, y: 869, width: 354, height: 52 });
    expect(await colourSaid(screens.swiftFeesSheet, target)).toBe(
      `nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780) (element 24,869 354x52, screen 0,0 402x874) — ${PRESENTED_FOR_THE_ELEMENT}`,
    );
  });

  it('word for word, wholly below beneath the Fees sheet: the tap, and the colour assert — off the screen, the presented remedy in place of the scroll', async () => {
    const screens = await stacked();
    const target = byRect(screens.swiftFeesSheet, { x: 24, y: 1209, width: 354, height: 52 });
    expect(await tapSaid(screens.swiftFeesSheet, target)).toBe(`id:t is off screen at (201,1235) on a 402x874 screen (rect 24,1209 354x52) — ${PRESENTED_OVER}; nothing was tapped`);
    expect(await colourSaid(screens.swiftFeesSheet, target)).toBe(`nothing of the element lies on the screen (element 24,1209 354x52, screen 0,0 402x874) — ${PRESENTED_FOR_THE_ELEMENT}`);
  });

  it('…and with nothing presented, the same row below the screen is scrolled to: the tap "scroll_until it first", the colour and ocr asserts "scroll it on-screen"', async () => {
    const target = node({ role: 'button', identifier: 't', rect: { x: 24, y: 1209, width: 354, height: 52 } });
    const tree = beneathDim(BOX, [node({ role: 'scrollable', rect: { ...BOX }, children: [node({ role: 'button', identifier: 'top', rect: { x: 24, y: 100, width: 354, height: 52 } }), target] })], false);
    expect(await tapSaid(tree, target)).toBe('id:t is off screen at (201,1235) on a 402x874 screen (rect 24,1209 354x52) — scroll_until it first; nothing was tapped');
    const OFF = 'nothing of the element lies on the screen (element 24,1209 354x52, screen 0,0 402x874) — scroll it on-screen: scroll_until the element first and re-run';
    expect(await colourSaid(tree, target)).toBe(OFF);
    expect(await pixelSaid(tree, target)).toBe(OFF);
  });
});

/**
 * A sliver of the element on the screen no thicker than the pixel slack (geometry.ts#PIXEL_OVERLAP_SLACK, 2 units):
 * what a neighbour's edge may share without counting as over it is too thin to measure, so the pixel assert fails
 * closed as for an element off the screen — the same remedy decision, presented first. Measured:
 * `payee_street_input` moved to y 872–873.7 beneath the Fees dim passed a colour assert on ~6 px rows of the dim
 * ("clipped 96% off-png"), while the tap on the same tree said close it first.
 */
describe('a sliver of the element on the screen thinner than the slack fails closed — never measured', () => {
  const movedTo = (tree: UiNode, id: string, y: number): { tree: UiNode; target: UiNode } => {
    let target: UiNode | undefined;
    const walk = (n: UiNode, dy?: number): UiNode => {
      const by = dy ?? (n.identifier === id ? y - n.rect.y : undefined);
      const out: UiNode = { ...n, rect: by === undefined ? n.rect : { ...n.rect, y: n.rect.y + by }, children: n.children.map((c) => walk(c, by)) };
      if (n.identifier === id) target = out;
      return out;
    };
    const copy = walk(tree);
    return { tree: copy, target: target! };
  };

  /** The Fees sheet's tree with its form laid out to the screen's bottom (`0,0 402x874`), so the screen's edge alone cuts the row moved to `y`. */
  const toTheBottom = async (y: number) => {
    const moved = movedTo((await stacked()).swiftFeesSheet, 'swift_payment.form.payee_street_input', y);
    const grow = (n: UiNode): UiNode => ({ ...n, rect: n.role === 'scrollable' && n.rect.height === 780 ? { ...n.rect, height: 874 } : n.rect, children: n.children.map(grow) });
    const tree = grow(moved.tree);
    return { tree, target: [...everyNode(tree)].find((n) => n.identifier === 'swift_payment.form.payee_street_input')! };
  };

  it('payee_street_input at y 872 beneath the Fees dim: the colour and the ocr assert fail closed with "close it first", word for word', async () => {
    const { tree, target } = await toTheBottom(872);
    const said = `only a sliver of the element lies on the screen, too thin to measure (element 24,872 354x52, on the screen 24,872 354x2, screen 0,0 402x874) — ${PRESENTED_FOR_THE_ELEMENT}`;
    expect(await colourSaid(tree, target)).toBe(said);
    expect(await pixelSaid(tree, target)).toBe(said);
  });

  it('the slack\'s edge: at y 871, 3 pt on the screen, the sliver is measurable, and the dim over it is named — close it first', async () => {
    const { tree, target } = await toTheBottom(871);
    const said = `container "dismiss popup" (-402,-874 1206x2622) is drawn over the element (element 24,871 354x52) — the capture would show it, not the element; ${PRESENTED_FOR_THE_ELEMENT}`;
    expect(await colourSaid(tree, target)).toBe(said);
    expect(await pixelSaid(tree, target)).toBe(said);
  });

  it('…at y 872.5, 873 and 873.7: the same, never measured', async () => {
    for (const y of [872.5, 873, 873.7]) {
      const { tree, target } = await toTheBottom(y);
      for (const said of [await colourSaid(tree, target), await pixelSaid(tree, target)]) {
        expect({ y, said: said?.startsWith('only a sliver of the element lies on the screen, too thin to measure') && said.endsWith(PRESENTED_FOR_THE_ELEMENT) }).toEqual({ y, said: true });
      }
    }
  });

  it('…and as the form ends, at 780: the same rows lie outside it, never measured — close it first', async () => {
    for (const y of [871, 872, 873.7]) {
      const { tree, target } = movedTo((await stacked()).swiftFeesSheet, 'swift_payment.form.payee_street_input', y);
      for (const said of [await colourSaid(tree, target), await pixelSaid(tree, target)]) {
        expect({ y, said: said?.startsWith('nothing of the element is drawn: it lies outside its scroll view scrollable (0,0 402x780)') && said.endsWith(PRESENTED_FOR_THE_ELEMENT) }).toEqual({ y, said: true });
      }
    }
  });

  it('…and with nothing presented, the same sliver at the bottom edge, or at the top edge under the status band: scroll it on-screen', async () => {
    const SCROLL = 'scroll it on-screen: scroll_until the element first and re-run';
    const bottom = node({ role: 'button', identifier: 't', rect: { x: 24, y: 873, width: 354, height: 52 } });
    const top = node({ role: 'button', identifier: 't', rect: { x: 24, y: -50, width: 354, height: 51 } });
    for (const target of [bottom, top]) {
      const tree = beneathDim(BOX, [node({ role: 'scrollable', rect: { ...BOX }, children: [node({ role: 'button', identifier: 'mid', rect: { x: 24, y: 300, width: 354, height: 52 } }), target] })], false);
      for (const said of [await colourSaid(tree, target), await pixelSaid(tree, target)]) {
        expect({ rect: target.rect, said: said?.startsWith('only a sliver of the element lies on the screen, too thin to measure') && said.endsWith(SCROLL) }).toEqual({ rect: target.rect, said: true });
      }
    }
  });

  it('a whole element thinner than the slack lying on the screen is no sliver: a 402x1 divider is measured', async () => {
    const divider = node({ role: 'other', identifier: 't', rect: { x: 0, y: 400, width: 402, height: 1 } });
    const tree = beneathDim(BOX, [node({ role: 'scrollable', rect: { ...BOX }, children: [divider] })], false);
    expect(await colourSaid(tree, divider)).toBeUndefined();
    expect(await pixelSaid(tree, divider)).toBeUndefined();
  });
});

/**
 * RESIDUAL (ADR 0018 residual 11): beneath an UNDIMMED partial presented surface — a later screen-sized layer holding
 * only a sheet's scroll view over the screen's lower part, no dimming view — a target the sheet does not lie over
 * (wholly above the screen, or under the status bar) is told "close it first" by the tap and the pixel assert, which
 * judge the presented fact of the node (draw-order.ts#DrawOrder.presentedOver), while `scroll_until` strokes: it
 * stops only on a surface in its read's frame or at its stroke's touch-down (draw-order.ts#DrawOrder.presentedAt),
 * and the touch-down misses the sheet. The verbs' wording agrees; their behaviour does not, and this
 * pins it.
 */
describe('residual: an undimmed partial sheet — the tap and the pixel assert say close it first, scroll_until strokes', () => {
  const undimmed = (y: number): { tree: UiNode; target: UiNode } => {
    const target = node({ role: 'button', identifier: 't', rect: { x: 24, y, width: 354, height: 52 } });
    const full = (children: UiNode[]) => node({ role: 'container', rect: { ...BOX }, children });
    const sheet = node({ role: 'scrollable', rect: { x: 0, y: 500, width: 402, height: 374 }, children: [node({ role: 'button', identifier: 'opt', label: 'Option', rect: { x: 20, y: 520, width: 362, height: 50 } })] });
    const tree = full([full([full([node({ role: 'scrollable', rect: { ...BOX }, children: [node({ role: 'button', identifier: 'mid', rect: { x: 24, y: 300, width: 354, height: 52 } }), target] })]), full([sheet])])]);
    return { tree, target };
  };

  it('wholly above the screen (y -300) and under the status bar (y 20): the tap and the colour assert close it first; scroll_until sends a stroke, never stops `presented`', async () => {
    for (const y of [-300, 20]) {
      const { tree, target } = undimmed(y);
      expect({ y, tap: (await tapSaid(tree, target)).endsWith(` — ${PRESENTED_OVER}; nothing was tapped`) }).toEqual({ y, tap: true });
      expect({ y, colour: (await colourSaid(tree, target))?.endsWith(PRESENTED_FOR_THE_ELEMENT) }).toEqual({ y, colour: true });
      const row: Row = { tree, found: [target], screen: USABLE };
      const played = play({ direction: 'up', fully: false, maxSwipes: 2, timeoutMs: 30_000, screen: IPHONE }, [row, row, row]);
      expect({ y, stroked: played.steps.some((s) => s.do === 'stroke'), stop: played.outcome?.kind }).toMatchObject({ y, stroked: true });
      expect(played.outcome?.kind).not.toBe('presented');
    }
  });
});

/**
 * A target listed in its scroll view but outside the scroll view's frame, on a tree of unclipped frames (WDA's): its
 * scroll view draws none of it there, or not its centre (ui-tree/standing.ts, the drawn frame; geometry.ts
 * #Clips.drawnIn). One standing for every verb, its remedy the off-screen one: the tap refuses naming the scroll view,
 * the colour and ocr asserts fail closed naming it, `scroll_until` strokes — and beneath a presented screen each says
 * close it first. The at-rest SWIFT form's shape, synthetic: its form `0,0 402x780`, CONTINUE pinned below it,
 * `payee_name_input` `24,801 354x52` and `payee_street_input` `24,869 354x52` listed below the form.
 */
describe('a target outside what its scroll view draws — the tap, the pixel assert and scroll_until agree', () => {
  const atRest = (dimmed: boolean, ...more: UiNode[]) => {
    const name = node({ role: 'textfield', identifier: 't', rect: { x: 24, y: 801, width: 354, height: 52 } });
    const street = node({ role: 'textfield', identifier: 'street', rect: { x: 24, y: 869, width: 354, height: 52 } });
    const form = node({ role: 'scrollable', identifier: 'form', rect: { x: 0, y: 0, width: 402, height: 780 }, children: [node({ role: 'button', identifier: 'top', rect: { x: 24, y: 300, width: 354, height: 52 } }), name, street, ...more] });
    // A WDA screen: its source's mark, every frame unclipped (UiNode.unclippedFrames).
    const tree: UiNode = { ...beneathDim(BOX, [form, node({ role: 'button', label: 'Continue to summary', rect: { x: 24, y: 780, width: 354, height: 44 } })], dimmed), unclippedFrames: true };
    return { tree, name, street };
  };
  const OUTSIDE = 'nothing of the element is drawn: it lies outside its scroll view scrollable id:form (0,0 402x780)';
  const INTO_VIEW = 'scroll it into view: scroll_until the element first and re-run';

  it('the tap refuses payee_name_input, its centre (201,827) on the bare background below the form: never "Tapped"', async () => {
    const { tree, name } = atRest(false);
    expect(await tapSaid(tree, name)).toBe('id:t is outside its scroll view scrollable id:form (0,0 402x780) at (201,827): nothing of it is drawn (rect 24,801 354x52) — scroll_until it first; nothing was tapped');
  });

  it('the colour and the ocr assert fail closed on payee_street_input, 5 pt of it on the screen and none drawn: never measured on the background', async () => {
    const { tree, street } = atRest(false);
    const said = `${OUTSIDE} (element 24,869 354x52, screen 0,0 402x874) — ${INTO_VIEW}`;
    expect(await colourSaid(tree, street)).toBe(said);
    expect(await pixelSaid(tree, street)).toBe(said);
  });

  it('scroll_until payee_name_input strokes — never "visible after 0 swipes"', () => {
    const { tree, name } = atRest(false);
    const played = stopOf(tree, name);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(true);
    expect(played.outcome?.kind).not.toBe('visible');
  });

  it('a sliver its scroll view\'s edge leaves, no thicker than the slack: the ocr assert fails closed naming the scroll view', async () => {
    const sliver = node({ role: 'button', identifier: 's', rect: { x: 24, y: 778, width: 354, height: 52 } });
    const { tree } = atRest(false, sliver);
    expect(await pixelSaid(tree, sliver)).toBe(
      `only a sliver of the element is drawn, too thin to measure: the rest lies outside its scroll view scrollable id:form (0,0 402x780) (element 24,778 354x52, drawn 24,778 354x2, screen 0,0 402x874) — ${INTO_VIEW}`,
    );
  });

  it('beneath a presented screen, each says close it first: the tap, the colour and ocr asserts, scroll_until stops `presented`', async () => {
    const { tree, name, street } = atRest(true);
    expect(await tapSaid(tree, name)).toBe(`id:t is outside its scroll view scrollable id:form (0,0 402x780) at (201,827): nothing of it is drawn (rect 24,801 354x52) — ${PRESENTED_OVER}; nothing was tapped`);
    expect(await colourSaid(tree, street)).toBe(`${OUTSIDE} (element 24,869 354x52, screen 0,0 402x874) — ${PRESENTED_FOR_THE_ELEMENT}`);
    expect(await pixelSaid(tree, name)).toBe(`${OUTSIDE} (element 24,801 354x52, screen 0,0 402x874) — ${PRESENTED_FOR_THE_ELEMENT}`);
    expect(stopOf(tree, name).outcome?.kind).toBe('presented');
  });
});

/**
 * A form beneath an ALERT (tests/fixtures/wda-synthetic-alert-over-form.json, the measured shape of a SwiftUI alert over
 * a pushed form): the alert's layer covers the whole screen (UiNode.presentation, the WDA parser's mark), so every verb
 * refuses the form's targets — no tap, no measurement, no swipe — naming the alert, and reaches the alert's own buttons.
 */
describe('a target beneath an alert — the tap, the pixel assert and scroll_until name the alert', () => {
  const alertForm = async () => parseWdaSource(await readFile(new URL('../fixtures/wda-synthetic-alert-over-form.json', import.meta.url), 'utf8'));
  const ofId = (tree: UiNode, id: string) => [...everyNode(tree)].find((n) => n.identifier === id)!;
  // Named with its reach, the whole screen: the point a sentence names lies on the reach, not always on the card.
  const ALERT = 'container "Leave the form" (41,365 320x172, reaching 0,0 402x874)';
  const CLOSE_IT = 'an alert is presented over it ("Leave the form") — close it first';

  it('the tap refuses a field of the form, under the alert at its centre: never "Tapped"', async () => {
    const tree = await alertForm();
    expect(await tapSaid(tree, ofId(tree, 'form.note_input'))).toBe(`id:t is under ${ALERT} at its centre (201,602), drawn over it; nothing of it shows — ${CLOSE_IT}; nothing was tapped`);
  });

  it('…and the form\'s full-screen Toolbar, of the dim\'s exact frame: refused, not moved', async () => {
    const tree = await alertForm();
    expect(await tapSaid(tree, ofId(tree, 'Toolbar'))).toBe(`id:t is under ${ALERT} at its centre (201,437), drawn over it; nothing of it shows — ${CLOSE_IT}; nothing was tapped`);
  });

  it('the alert\'s own buttons are tapped at their centre', async () => {
    const tree = await alertForm();
    const leave = [...everyNode(tree)].find((n) => n.role === 'button' && n.label === 'Leave')!;
    expect(JSON.parse(await tapSaid(tree, leave))).toEqual({ point: { x: 275, y: 497 } });
  });

  it('the colour and the ocr assert fail closed naming the alert, which reaches the whole screen', async () => {
    const tree = await alertForm();
    const said = `${ALERT} is drawn over the element (element 24,576 354x52) — the capture would show it, not the element; an alert is presented over the element ("Leave the form") — close it first`;
    expect(await colourSaid(tree, ofId(tree, 'form.note_input'))).toBe(said);
    expect(await pixelSaid(tree, ofId(tree, 'form.note_input'))).toBe(said);
  });

  it('scroll_until stops before any swipe, naming the alert', async () => {
    const tree = await alertForm();
    expect(failureOf(stopOf(tree, ofId(tree, 'form.note_input')), 'id:t').message).toBe(
      `scroll_until id:t stopped before any swipe — element is in the viewport but under ${ALERT} at its centre (201,602), drawn over it — 0% of it shows — ` +
        `${CLOSE_IT}, and a swipe would land on the alert, so none was sent. Last rect {"x":24,"y":576,"width":354,"height":52} in a 402x874 viewport`,
    );
  });

  it('a field below the fold beneath the alert: the tap says close it first, and scroll_until does not swipe — every touch-down lies on the alert', async () => {
    const tree = await alertForm();
    const field = ofId(tree, 'form.note_input');
    field.rect = { x: 24, y: 1200, width: 354, height: 52 };
    expect(await tapSaid(tree, field)).toBe(`id:t is off screen at (201,1226) on a 402x874 screen (rect 24,1200 354x52) — ${CLOSE_IT}; nothing was tapped`);
    expect(failureOf(stopOf(tree, field), 'id:t').message).toBe(
      `scroll_until id:t stopped before any swipe — element lies below the viewport, and the next swipe would touch down at (201,699) on ${ALERT} — ` +
        `${CLOSE_IT}, and a swipe would land on the alert, so none was sent. Last rect {"x":24,"y":1200,"width":354,"height":52} in a 402x874 viewport`,
    );
  });

  it('a target not in the tree: scroll_until sends no swipe under the alert — its touch-down lies on the alert, wherever it would land', async () => {
    const tree = await alertForm();
    const row: Row = { tree, found: [], screen: USABLE };
    const played = play({ direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE }, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    expect(failureOf(played, 'text:"Nothing like this"').message).toBe(
      `scroll_until text:"Nothing like this" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (201,699) on ${ALERT} — ` +
        `${CLOSE_IT}, and a swipe would land on the alert, so none was sent.`,
    );
  });

  it('a target not in the tree with the bound already reached: the bound says nothing of where its held-back swipe would touch down — that is asked only on behalf of a target', async () => {
    const tree = await alertForm();
    const row: Row = { tree, found: [], screen: USABLE };
    const played = play({ direction: 'down', fully: false, maxSwipes: 0, timeoutMs: 30_000, screen: IPHONE }, [row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    expect(played.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' } });
    expect(played.outcome).not.toHaveProperty('presented');
  });
});


/**
 * A screen beneath a layer the tree source marks `screen` (UiNode.presentation): a list screen whose list fills the
 * screen, and over it a sheet — its nav bar with Cancel, then either a form with no scroll view of its own, or its own
 * list over the lower part of the screen. A stroke for a target not in the tree touches down on the screen's largest
 * scroll view, the list beneath, at (201,699).
 */
describe('a target not in the tree beneath a marked presented screen — scroll_until stops unless it strokes the sheet\'s own list', () => {
  const sheetOver = (own: 'form' | 'list'): UiNode => {
    const rows = Array.from({ length: 12 }, (_, i) => node({ role: 'text', label: `Row ${i}`, rect: { x: 0, y: 100 + 70 * i, width: 402, height: 60 } }));
    const beneath = node({ role: 'container', rect: { ...BOX }, children: [node({ role: 'scrollable', rect: { ...BOX }, children: rows })] });
    const bar = node({ role: 'container', rect: { x: 0, y: 62, width: 402, height: 56 }, children: [node({ role: 'button', label: 'Cancel', rect: { x: 16, y: 72, width: 70, height: 36 } })] });
    const body =
      own === 'form'
        ? node({ role: 'container', identifier: 'sheet.form', rect: { x: 0, y: 118, width: 402, height: 756 }, children: [node({ role: 'textfield', identifier: 'name', rect: { x: 20, y: 300, width: 362, height: 44 } })] })
        : node({ role: 'scrollable', identifier: 'sheet.list', rect: { x: 0, y: 118, width: 402, height: 700 }, children: [node({ role: 'text', label: 'Austria', rect: { x: 0, y: 130, width: 402, height: 44 } })] });
    const layer = node({ role: 'container', rect: { ...BOX }, presentation: 'screen', children: [bar, body] });
    return node({ role: 'container', label: 'App', rect: { ...BOX }, presentationsJudged: true, children: [node({ role: 'container', rect: { ...BOX }, children: [beneath, layer] })] });
  };
  const RULES = { direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE } as const;

  it('the touch-down on the sheet, off any scroll view of its own: no swipe — the stop names what of the sheet is there', () => {
    const row: Row = { tree: sheetOver('form'), found: [], screen: USABLE };
    const played = play(RULES, [row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(false);
    const failure = failureOf(played, 'text:"Nothing like this"');
    expect(failure.message).toBe(
      'scroll_until text:"Nothing like this" stopped before any swipe — element is not in the tree, and the next swipe would touch down at (201,699) on ' +
        `container id:sheet.form (0,118 402x756) — ${presentedRemedy('it')}, and a swipe on it may dismiss it, so none was sent.`,
    );
  });

  it('…a plain failure, not absence: an optional step fails there, as beneath an alert', () => {
    const row: Row = { tree: sheetOver('form'), found: [], screen: USABLE };
    expect(failureOf(play(RULES, [row, row]), 'text:"Nothing like this"')).not.toBeInstanceOf(ElementNotFoundError);
  });

  it('the touch-down on the sheet\'s own list: a search inside the sheet keeps stroking', () => {
    const row: Row = { tree: sheetOver('list'), found: [], screen: USABLE };
    const played = play(RULES, [row, row, row]);
    expect(played.steps.some((s) => s.do === 'stroke')).toBe(true);
    expect(played.outcome?.kind).not.toBe('presented');
  });
});
