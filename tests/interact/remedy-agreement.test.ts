import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import { keyboardPosition } from '../../src/ui-tree/keyboard-position.js';
import { presentedRemedy, sceneOf } from '../../src/ui-tree/standing.js';
import type { UsableScreen } from '../../src/ui-tree/usable-screen.js';
import { judgeTap } from '../../src/interact/tap-judgement.js';
import { PRESENTED_OVER } from '../../src/interact/target-text.js';
import { overElement } from '../../src/verify/pixel-poll.js';
import { failureOf, play, type Row } from '../helpers/rounds.js';
import { node } from '../helpers/fake.js';

// ONE remedy for a target that is not reachable itself (ui-tree/standing.ts#Remedy), decided once by the standing with
// one precedence — a screen presented over the target first (docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md),
// then the rest — and only rendered by the verbs: the tap's refusal (interact/tap-judgement.ts), the pixel assert's miss
// (verify/pixel-poll.ts) and scroll_until's stop (interact/scroll-rounds.ts). A table over the trees with a presented
// screen: each verb's answer for the same target names the same remedy.

const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const BOX: Rect = { x: 0, y: 0, width: 402, height: 874 };
const USABLE: UsableScreen = { box: BOX, boxes: [BOX], oriented: BOX, from: 'device', statusBand: 62 };
const NONE = { dismissal: 'none', advice: 'ADV' } as const;

/**
 * A row at the top of a scroll view, its centre (201,50) in the 62-pt status band, beneath a React Native transparent
 * modal: a screen-filling dimming leaf laid on a later screen-sized layer, the card beside it. The shape the
 * architecture review reproduced the three verbs' disagreement on.
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

const stacked = async (): Promise<Record<string, UiNode>> =>
  (JSON.parse(await readFile(new URL('../fixtures/wda-ui-snapshot-stacked-layers.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> }).screens;

const byRect = (tree: UiNode, r: Rect): UiNode =>
  [...everyNode(tree)].find((n) => n.rect.x === r.x && n.rect.y === r.y && n.rect.width === r.width && n.rect.height === r.height)!;

/** The tap's refusal of `target` on `tree` (or its point), as the guard's clear path judges it on the iPhone. */
async function tapSaid(tree: UiNode, target: UiNode): Promise<string> {
  const scene = sceneOf(tree);
  const reading = { ofKeyboard: () => false, cover: async () => undefined, corroborated: async () => false };
  try {
    const judge = await judgeTap({ viewport: async () => IPHONE }, 'id:t', { node: target, tree, scene }, USABLE, { position: keyboardPosition(scene.order, reading), remedy: NONE });
    return JSON.stringify(await judge.aim());
  } catch (e) {
    return (e as Error).message;
  }
}

/** The pixel assert's miss for `target` (an ocr assert: the whole rect read). */
const pixelSaid = async (tree: UiNode, target: UiNode): Promise<string | undefined> =>
  overElement({ viewport: async () => IPHONE, keyboard: undefined, keyboardAdvice: 'ADV' }, tree, target, { glyphs: true });

/** scroll_until's outcome for `target`: two reads of the same tree, the status band known. */
function stopOf(tree: UiNode, target: UiNode) {
  const row: Row = { tree, found: [target], screen: USABLE };
  return play({ direction: 'down', fully: false, maxSwipes: 5, timeoutMs: 30_000, screen: IPHONE }, [row, row]);
}

const PRESENTED_FOR_THE_ELEMENT = presentedRemedy('the element');

describe('one remedy for a target beneath a presented screen — the tap, the pixel assert and scroll_until agree', () => {
  /** The cases: the probe, and the real ui_snapshots' targets on which the verbs disagreed. */
  const cases = async (): Promise<[string, UiNode, UiNode][]> => {
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
        pixel: of(scene.standing(target, USABLE, { of: 'pixel', reads: target.rect, glyphs: true })),
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

  it('a target off the screen beneath a presented screen: the tap says close it first, not "scroll_until it with fully: true first"', async () => {
    const screens = await stacked();
    const target = byRect(screens.swiftFeesSheet, { x: 24, y: 869, width: 354, height: 52 });
    expect(await tapSaid(screens.swiftFeesSheet, target)).toMatch(
      /^id:t is off screen at \(201,895\) on a 402x874 screen — only \d+% of it \(rect 24,869 354x52\) is on screen, and a tap goes to its centre — a screen is presented over it \(a modal or a sheet\) — close it first; no scroll moves it out from under that screen; nothing was tapped$/,
    );
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
            scene.standing(target, screen, { of: 'pixel', reads: target.rect, glyphs: true }),
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
