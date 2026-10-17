import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, KEYBOARD_ROLE, type KeyboardWitness, type SoftKeyboard, type UiNode } from '../../src/adapters/types.js';
import { drawOrder, type DrawOrder } from '../../src/ui-tree/draw-order.js';
import { readKeyboard, type KeyboardCover, type KeyboardReading } from '../../src/ui-tree/keyboard-cover.js';
import { coverLine, keyboardPosition, type KeyboardLine } from '../../src/ui-tree/keyboard-position.js';
import { parseInputShown, parseTouchableRegion } from '../../src/adapters/android.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { strokeLine } from '../../src/interact/scroll-read.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { lookAt, lookOn } from '../../src/ui-tree/look.js';
import { GBOARD, GBOARD_STRIP } from '../helpers/android-dumps.js';
import { FakeAdapter, node, screen, type FakeKeyboard } from '../helpers/fake.js';

// Where the soft keyboard lies on one look (ui-tree/keyboard-position.ts), through its interface: a position over a draw
// order — synthetic, or a parsed tree's — and a reading (keyboard-cover.ts#readKeyboard over a FakeAdapter, the
// oracle's calls counted on the fake, or a hand-made reading that counts its own). One table per member: `line` per
// source combination and subject, `owns` per mark, `readingLine` per reading state and how often it asks.

type Order = Pick<DrawOrder, 'keyboardBandTop' | 'ofKeyboardBand'>;
/** No band: an order with no idb band and no node of one. */
const NO_BAND: Order = { keyboardBandTop: undefined, ofKeyboardBand: () => false };
/** The merge over `order`, as a look with no reading of its own asks it. */
const edge = (reading: KeyboardLine | undefined, order: Order, subject?: UiNode): KeyboardLine | undefined => keyboardPosition(order).line(subject, reading);
/** A reading's line through a position (on an order with no band). */
const readingLineOf = (reading: KeyboardReading): Promise<KeyboardLine | undefined> => keyboardPosition(NO_BAND, reading).readingLine();
/** An adapter with the oracle (the window model), its window state and witness scripted; the tree is never read. */
function withOracle(window: SoftKeyboard, witness: KeyboardWitness = 'unknown'): { fake: FakeAdapter; oracle: FakeKeyboard } {
  const fake = new FakeAdapter({ s: screen() }, 's');
  return { fake, oracle: fake.attachKeyboard(window, witness) };
}
/** The three oracle calls a reading made: state(), touchable(), witness(). */
const calls = (oracle: FakeKeyboard): [number, number, number] => [oracle.windowAnswers.queries, oracle.touchableAnswers.queries, oracle.witnessAnswers.queries];

/**
 * THE merge (`line`): the top edge nothing may be aimed or stroked under — a corroborated reading's cover top
 * (`readingLine`), idb's band line (`DrawOrder.keyboardBandTop`), or the higher of the two — witnessed when a reading stands by it.
 */
describe('line — a corroborated reading, idb\'s band, both, neither', () => {
  const window = (y: number): KeyboardLine => ({ y, witnessed: true });
  const IDB_589: KeyboardLine = { y: 589, witnessed: false };
  /** A draw order that read idb's band at `top` (or none), and whose band holds `keys`. */
  const order = (top: number | undefined, ...keys: UiNode[]) => ({ keyboardBandTop: top, ofKeyboardBand: (n: UiNode) => keys.includes(n) });
  it.each([
    ['a corroborated reading only: its line', window(1285), order(undefined), window(1285)],
    ['idb\'s band only: its line, no reading stands by it', undefined, order(589), IDB_589],
    ['both, the band higher: the band\'s', window(600), order(589), IDB_589],
    ['both, the reading higher: the reading\'s', window(500), order(589), window(500)],
    ['neither: none', undefined, order(undefined), undefined],
  ] as const)('%s', (_name, reading, drawn, expected) => {
    expect(edge(reading, drawn)).toEqual(expected);
  });
  it('a subject of the band itself (one of idb\'s keys) is under no band line — the reading\'s still holds', () => {
    const key = node({ role: 'button', label: 'Q', rect: { x: 4, y: 600, width: 36, height: 46 } });
    expect(edge(undefined, order(589, key), key)).toBeUndefined();
    expect(edge(window(1285), order(589, key), key)).toEqual(window(1285));
    expect(edge(undefined, order(589, key), node({ role: 'button', label: 'row' }))).toEqual(IDB_589);
  });
  it('over a parsed idb number pad (run2-ios #250): the band at 589, its key `5` exempt', async () => {
    const { readFile } = await import('node:fs/promises');
    const { parseIdbDescribeAll } = await import('../../src/adapters/ios-tree-source.js');
    const tree = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
    const five = tree.children.find((n) => n.label === '5')!;
    const drawn = drawOrder(tree);
    expect(edge(undefined, drawn)).toEqual(IDB_589);
    expect(edge(undefined, drawn, five)).toBeUndefined();
    expect(edge(undefined, drawn, tree.children[1])).toEqual(IDB_589);
  });
});

/**
 * Which nodes of idb's band are the keyboard's OWN (exempt from its line): the keys tile the band in rows, so a key
 * shares its row (top and height) with another node of the run, or is listed after the band's background (Dictate);
 * an app row listed right before the keys, wholly inside the band, stands alone on its row and is under the line.
 */
describe('line — a key of idb\'s band, against an app row listed right before the keys', () => {
  const login = async () => {
    const { parseIdbDescribeAll } = await import('../../src/adapters/ios-tree-source.js');
    const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number) => ({ type, AXLabel, AXUniqueId: null, frame: { x, y, width, height } });
    return parseIdbDescribeAll(
      JSON.stringify([
        el('Application', 'App', 0, 0, 402, 874),
        el('TextField', 'User', 20, 200, 362, 44),
        el('Button', 'Sign in', 20, 700, 362, 50),
        ...['Q', 'W', 'E', 'R'].map((k, i) => el('Button', k, 2 + 40 * i, 780, 38, 46)),
        el('Other', null, 0, 590, 402, 284),
        el('Button', 'Dictate', 325, 805, 68, 69),
      ]),
    );
  };
  const IDB_590: KeyboardLine = { y: 590, witnessed: false };
  it('Sign in at 20,700 362x50, listed right before the keys and alone on its row: under the band line', async () => {
    const tree = await login();
    expect(edge(undefined, drawOrder(tree), tree.children.find((n) => n.label === 'Sign in'))).toEqual(IDB_590);
  });
  it('a row is its top AND its height: an app button at the keys\' top but taller (170,780 220x50 beside keys 46 tall) is no key', async () => {
    const tree = await login();
    tree.children.find((n) => n.label === 'Sign in')!.rect = { x: 170, y: 780, width: 220, height: 50 };
    expect(edge(undefined, drawOrder(tree), tree.children.find((n) => n.label === 'Sign in'))).toEqual(IDB_590);
  });
  it('keys tile a row WITHOUT overlapping: a field and its placeholder label behind the keyboard (42,700 318x20 and 42,700 60x20, one top and height), and a button with its same-rect title, are no keys — under the line', async () => {
    const { parseIdbDescribeAll } = await import('../../src/adapters/ios-tree-source.js');
    const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number) => ({ type, AXLabel, AXUniqueId: null, frame: { x, y, width, height } });
    const tree = parseIdbDescribeAll(
      JSON.stringify([
        el('Application', 'App', 0, 0, 402, 874),
        el('TextField', 'Field', 42, 700, 318, 20),
        el('StaticText', 'Label', 42, 700, 60, 20),
        el('Button', 'Go', 20, 740, 362, 30),
        el('StaticText', 'Go title', 20, 740, 362, 30),
        ...['Q', 'W', 'E', 'R'].map((k, i) => el('Button', k, 2 + 40 * i, 780, 38, 46)),
        el('Other', null, 0, 590, 402, 284),
      ]),
    );
    const drawn = drawOrder(tree);
    for (const label of ['Field', 'Label', 'Go', 'Go title']) expect([label, edge(undefined, drawn, tree.children.find((n) => n.label === label))]).toEqual([label, IDB_590]);
  });
  it('real keys that overlap their neighbour by 1 pt (rounded frames) stay the keyboard\'s own', async () => {
    const { parseIdbDescribeAll } = await import('../../src/adapters/ios-tree-source.js');
    const el = (type: string, AXLabel: string | null, x: number, y: number, width: number, height: number) => ({ type, AXLabel, AXUniqueId: null, frame: { x, y, width, height } });
    const tree = parseIdbDescribeAll(
      JSON.stringify([el('Application', 'App', 0, 0, 402, 874), ...['1', '2', '3'].map((k, i) => el('Button', k, 5 + 132 * i, 596, 133, 54)), el('Other', null, 0, 589, 402, 285)]),
    );
    const drawn = drawOrder(tree);
    for (const label of ['1', '2', '3']) expect([label, edge(undefined, drawn, tree.children.find((n) => n.label === label))]).toEqual([label, undefined]);
  });
  it('a key sharing its row (`Q`), and Dictate listed after the background: the keyboard\'s own, under no line', async () => {
    const tree = await login();
    const drawn = drawOrder(tree);
    for (const label of ['Q', 'R', 'Dictate']) expect([label, edge(undefined, drawn, tree.children.find((n) => n.label === label))]).toEqual([label, undefined]);
  });
});

describe('readingLine — a reading\'s line, only when it stands by a shown cover', () => {
  const BAND = { x: 0, y: 1285, width: 1080, height: 935 };
  it('the window model, corroborated: the cover\'s top, witnessed', async () => {
    expect(await readingLineOf(readKeyboard(withOracle({ state: 'shown', frame: BAND }, 'shown').fake))).toEqual({ y: 1285, witnessed: true });
  });
  it('the window model, its witness denying the band: none', async () => {
    expect(await readingLineOf(readKeyboard(withOracle({ state: 'shown', frame: BAND }, 'hidden').fake))).toBeUndefined();
  });
  it('the window model, hidden: none', async () => {
    expect(await readingLineOf(readKeyboard(withOracle({ state: 'hidden' }).fake))).toBeUndefined();
  });
  it('the in-tree model (WDA\'s marked band): witnessed — read off the very tree', async () => {
    const tree = screen(node({ role: KEYBOARD_ROLE, rect: { x: 0, y: 539, width: 402, height: 335 } }));
    expect(await readingLineOf(readKeyboard(new FakeAdapter({ s: tree }, 's'), tree))).toEqual({ y: 539, witnessed: true });
  });
  it('the in-tree model with no mark (every idb tree): none — idb\'s band is `line`\'s, never the reading\'s (K5d)', async () => {
    const tree = screen(node({ role: 'other', rect: { x: 0, y: 589, width: 402, height: 285 } }));
    expect(await readingLineOf(readKeyboard(new FakeAdapter({ s: tree }, 's'), tree))).toBeUndefined();
  });
});

describe('coverLine — the line a shown cover stands for, whoever asked the witness', () => {
  const BAND = { x: 0, y: 1285, width: 1080, height: 935 };
  it('witnessed, at the cover\'s top — the window model\'s (`back`) and the in-tree model\'s (`none`) alike: the line reads no remedy', () => {
    expect(coverLine({ rects: [BAND], top: BAND, band: BAND, remedy: { dismissal: 'back', advice: undefined } })).toEqual({ y: 1285, witnessed: true });
    expect(coverLine({ rects: [BAND], top: BAND, band: BAND, remedy: { dismissal: 'none', advice: 'ADVICE' } })).toEqual({ y: 1285, witnessed: true });
  });
  it('the in-tree model\'s band: witnessed, at its top', () => {
    const band = { x: 0, y: 539, width: 402, height: 335 };
    expect(coverLine({ rects: [band], top: band, band, remedy: { dismissal: 'none', advice: 'ADVICE' } })).toEqual({ y: 539, witnessed: true });
  });
  it('a floating Gboard: the PANEL\'s top (the highest covered rect), not the band\'s', () => {
    const panel = { x: 359, y: 1269, width: 681, height: 643 };
    const strip = { x: 0, y: 2088, width: 1080, height: 132 };
    expect(coverLine({ rects: [strip, panel], top: panel, band: strip, remedy: { dismissal: 'back', advice: undefined } })).toEqual({ y: 1269, witnessed: true });
  });
});

describe('line — every source combination, every kind of subject (one look, one table)', () => {
  const KEY = node({ role: 'button', label: 'Q', rect: { x: 4, y: 600, width: 36, height: 46 } });
  const WDA_KEY = node({ role: 'other', label: 'q', rect: { x: 4, y: 600, width: 40, height: 54 }, ofKeyboard: true });
  const ROW = node({ role: 'button', label: 'row', rect: { x: 0, y: 400, width: 402, height: 50 } });
  const BAND = (top: number | undefined): Order => ({ keyboardBandTop: top, ofKeyboardBand: (n) => top !== undefined && n === KEY });
  const READ = { y: 539, witnessed: true } as const;
  it.each([
    ['no source, no subject: none', undefined, BAND(undefined), undefined, undefined],
    ['no source, an ordinary node: none', undefined, BAND(undefined), ROW, undefined],
    ['a reading only, no subject: the reading\'s', READ, BAND(undefined), undefined, READ],
    ['a reading only, an ordinary node: the reading\'s', READ, BAND(undefined), ROW, READ],
    ['a reading only, a WDA-marked key: the reading\'s still — a WDA key is exempt from the reading\'s questions, not its line', READ, BAND(undefined), WDA_KEY, READ],
    ['idb\'s band only, no subject: the band\'s, unwitnessed', undefined, BAND(589), undefined, { y: 589, witnessed: false }],
    ['idb\'s band only, an ordinary node: the band\'s', undefined, BAND(589), ROW, { y: 589, witnessed: false }],
    ['idb\'s band only, a key of the band: none', undefined, BAND(589), KEY, undefined],
    ['idb\'s band only, a WDA-marked key (not the band\'s): the band\'s', undefined, BAND(589), WDA_KEY, { y: 589, witnessed: false }],
    ['both (never today; a synthetic order), the reading higher: the reading\'s', READ, BAND(589), ROW, READ],
    ['both, the band higher: the band\'s', { y: 700, witnessed: true }, BAND(589), ROW, { y: 589, witnessed: false }],
    ['both at one height: the reading\'s (a tie keeps the reading)', { y: 589, witnessed: true }, BAND(589), ROW, { y: 589, witnessed: true }],
    ['both, a key of the band: the reading\'s alone', { y: 700, witnessed: true }, BAND(589), KEY, { y: 700, witnessed: true }],
  ] as const)('%s', (_name, reading, order, subject, expected) => {
    expect(keyboardPosition(order).line(subject, reading)).toEqual(expected);
  });
});

/** The keyboard's own UI: the reading's marks (WDA) or idb's band's nodes — the union, which the scroll read alone asks. */
describe('owns — the keyboard\'s own UI, the union of the reading\'s marks and idb\'s band', () => {
  const KEY = node({ role: 'button', label: 'Q', rect: { x: 4, y: 600, width: 36, height: 46 } });
  const ROW = node({ role: 'button', label: 'row', rect: { x: 0, y: 400, width: 402, height: 50 } });
  it('a node of WDA\'s marks: owned, by the reading', () => {
    const wdaKey = node({ role: 'other', label: 'q', rect: { x: 4, y: 590, width: 40, height: 54 } });
    const tree = screen(ROW, node({ role: 'container', ofKeyboard: true, children: [node({ role: KEYBOARD_ROLE, rect: { x: 0, y: 539, width: 402, height: 335 } }), wdaKey] }));
    const position = keyboardPosition(drawOrder(tree), readKeyboard(new FakeAdapter({ s: tree }, 's'), tree));
    expect([position.owns(wdaKey), position.owns(ROW)]).toEqual([true, false]);
  });
  it('a node of idb\'s band only: owned, by the draw order', () => {
    const position = keyboardPosition({ keyboardBandTop: 589, ofKeyboardBand: (n) => n === KEY }, { ofKeyboard: () => false });
    expect([position.owns(KEY), position.owns(ROW)]).toEqual([true, false]);
  });
  it('the union: either one owns it', () => {
    const wda = node({ role: 'other', label: 'w' });
    const position = keyboardPosition({ keyboardBandTop: 589, ofKeyboardBand: (n) => n === KEY }, { ofKeyboard: (n) => n === wda });
    expect([position.owns(KEY), position.owns(wda), position.owns(ROW)]).toEqual([true, true, false]);
  });
  it('an Android tree (no mark, no flat list) and no reading: nothing is owned', () => {
    const tree = screen(ROW);
    expect(keyboardPosition(drawOrder(tree)).owns(ROW)).toBe(false);
    expect(keyboardPosition(drawOrder(tree), readKeyboard(withOracle({ state: 'shown', frame: { x: 0, y: 1285, width: 1080, height: 935 } }).fake, tree)).owns(ROW)).toBe(false);
  });
});

describe('readingLine — asked of the reading at most once, and only when asked', () => {
  const BAND = { x: 0, y: 1285, width: 1080, height: 935 };
  /** A hand-made reading that counts its own asks. */
  const counting = (cover: KeyboardCover | undefined, corroborated: boolean) => {
    const asked = { cover: 0, corroborated: 0 };
    const reading = {
      ofKeyboard: () => false,
      cover: async () => (asked.cover++, cover),
      corroborated: async () => (asked.corroborated++, corroborated),
    };
    return { reading, asked };
  };
  it('not shown: none, and the witness is never asked (the window state alone)', async () => {
    const { fake, oracle } = withOracle({ state: 'hidden' }, 'shown');
    expect(await readingLineOf(readKeyboard(fake))).toBeUndefined();
    expect(calls(oracle)).toEqual([1, 0, 0]);
  });
  it('shown and corroborated: the cover\'s top, witnessed', async () => {
    const { fake, oracle } = withOracle({ state: 'shown', frame: BAND }, 'shown');
    expect(await readingLineOf(readKeyboard(fake))).toEqual({ y: 1285, witnessed: true });
    expect(calls(oracle)).toEqual([1, 1, 1]);
  });
  it('a floating Gboard: the panel\'s top, read from the touchable region beside the strip', async () => {
    const { fake } = withOracle({ state: 'shown', frame: GBOARD_STRIP }, 'shown');
    fake.attachedKeyboard.touchableAnswers.current = { witness: parseInputShown(GBOARD.floating.touchable), region: parseTouchableRegion(GBOARD.floating.touchable) };
    expect(await readingLineOf(readKeyboard(fake))).toEqual({ y: 1269, witnessed: true });
  });
  it('asked twice: the reading\'s cover and corroborated are each asked once', async () => {
    const { reading, asked } = counting({ rects: [BAND], top: BAND, band: BAND, remedy: { dismissal: 'back', advice: undefined } }, true);
    const position = keyboardPosition(NO_BAND, reading);
    expect([await position.readingLine(), await position.readingLine()]).toEqual([{ y: 1285, witnessed: true }, { y: 1285, witnessed: true }]);
    expect(asked).toEqual({ cover: 1, corroborated: 1 });
  });
  it('never called: nothing asked — building a position asks nothing, and neither do `line` and `owns`', () => {
    const { reading, asked } = counting({ rects: [BAND], top: BAND, band: BAND, remedy: { dismissal: 'back', advice: undefined } }, true);
    const position = keyboardPosition({ keyboardBandTop: 589, ofKeyboardBand: () => false }, reading);
    position.line(undefined, undefined);
    position.owns(node({ role: 'button' }));
    expect(asked).toEqual({ cover: 0, corroborated: 0 });
  });
  it('without a reading (or one with no cover to ask): none, nothing asked', async () => {
    expect(await keyboardPosition(NO_BAND).readingLine()).toBeUndefined();
    expect(await keyboardPosition(NO_BAND, { ofKeyboard: () => true }).readingLine()).toBeUndefined();
  });
});

/**
 * ONE KEYBOARD LINE for the pixel assert and `scroll_until`. Each asks the position of its read's look
 * (ui-tree/look.ts#Look.keyboard): the pixel poll's (verify/pixel-poll.ts#overElement) over the adapter's whole reading
 * (ui-tree/look.ts#lookOn), the scroll read's — its judgement (interact/scroll-read.ts#judgeRead) and its stroke line
 * (#strokeLine) — over the read's `ofKeyboard` alone (scroll-read.ts#factsOf) — so the two verbs could part on the
 * band's line only if a position's `line` read the reading, or a tree carried both idb's band and WDA's marks (the one synthetic row of
 * the `line` table above where the pixel poll's exemption, `line`'s subject, is narrower than the scroll read's,
 * `owns`). Neither holds, and these pin both: `line` is the draw order's and the subject's alone, whatever the
 * reading; a band comes only with idb's flat list (draw-order.ts#drawOrder) and marks only from WDA's source
 * (adapters/wda-source.ts), so on each real keyboard tree the pixel poll's line for a node — `line(node)` — is the
 * scroll read's: none for a node it `owns`, else `line()`, the stroke line's when no reading's cover applies. Swept
 * 2026-10-16 over the 601 trees of corpus-r19 and the lab truth: 75 with a band, 57 with marks, none with both, no
 * node of any where the two differ. The reading's own question — the pixel poll's `overlapping` rects against the
 * scroll read's cover line — is not a position's and stays as ADR 0010 (pixel: any overlap) and the floating-Gboard
 * note's stated cost (scroll_until: full-width cut) decide.
 * These MODEL each verb's exemption on a position (the scroll read's as `owns(n) ? none : line()`); that the verbs
 * take it there — overElement passing its element as `line`'s subject, judgeRead exempting through `owns` — is pinned
 * through the verbs themselves in tests/interact/keyboard-line-agreement.test.ts.
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */
describe('one line for the pixel assert and scroll_until — `line` reads no reading, and no tree has both a band and marks', () => {
  const fixture = async (name: string): Promise<string> => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  const trees: [string, 'band' | 'marks', () => Promise<UiNode>][] = [
    ['idb-swift-form-number-pad.json (idb\'s band)', 'band', async () => parseIdbDescribeAll(JSON.stringify(JSON.parse(await fixture('idb-swift-form-number-pad.json')).elements))],
    ['wda-source-myport-login-keyboard.json (WDA\'s marks)', 'marks', async () => parseWdaSource(await fixture('wda-source-myport-login-keyboard.json'))],
    ['wda-source-myport-2fa-keyboard-toolbar.json (WDA\'s marks, an accessory toolbar)', 'marks', async () => parseWdaSource(await fixture('wda-source-myport-2fa-keyboard-toolbar.json'))],
  ];
  const every = (n: UiNode): UiNode[] => [n, ...n.children.flatMap(every)];
  it.each(trees)('%s: one source only, and every node\'s pixel line is the scroll read\'s as a position models it (owns ? none : line())', async (_name, source, read) => {
    const tree = await read();
    const order = sceneOf(tree).order;
    // As the pixel poll builds its look: the adapter's whole reading (lookOn).
    const pixelLook = lookOn(new FakeAdapter({ s: tree }, 's'), tree);
    // As the scroll read builds its look: the reading's `ofKeyboard` alone (scroll.ts hands the round's reading's to the read).
    const { ofKeyboard } = pixelLook.reading;
    const scrollLook = lookAt(tree, { ofKeyboard });
    const nodes = every(tree);
    expect([order.keyboardBandTop !== undefined, nodes.some(ofKeyboard)]).toEqual([source === 'band', source === 'marks']);
    const pixel = pixelLook.keyboard;
    const scroll = scrollLook.keyboard;
    const stroke = strokeLine(undefined, scrollLook);
    for (const n of nodes) {
      expect(pixel.line(n)).toEqual(scroll.owns(n) ? undefined : scroll.line());
      if (!scroll.owns(n)) expect(pixel.line(n)).toEqual(stroke);
    }
  });
  it('`line` is the same with any reading or none — one that claims every node and offers a corroborated cover included', async () => {
    const BAND_RECT = { x: 0, y: 1285, width: 1080, height: 935 };
    const claimsAll = { ofKeyboard: () => true, cover: async () => ({ rects: [BAND_RECT], top: BAND_RECT, band: BAND_RECT, remedy: { dismissal: 'back' as const, advice: undefined } }), corroborated: async () => true };
    for (const [, , read] of trees) {
      const tree = await read();
      const order = sceneOf(tree).order;
      for (const reading of [undefined, { ofKeyboard: () => false }, claimsAll, readKeyboard(new FakeAdapter({ s: tree }, 's'), tree)]) {
        for (const n of [undefined, ...every(tree)]) {
          for (const given of [undefined, { y: 300, witnessed: true }]) expect(keyboardPosition(order, reading).line(n, given)).toEqual(keyboardPosition(order).line(n, given));
        }
      }
    }
  });
});

/**
 * The structural guarantee the one line rests on, over every committed raw iOS capture: idb's parser marks the flat
 * list (the only tree draw order reads a band off) and never a node `ofKeyboard`; WDA's parser marks keyboard nodes
 * and never a node `flatList`. A parser that one day sets both would put a band and marks in one tree — the one case
 * the pixel assert and scroll_until's read exempt the keyboard's own UI differently (the describe above).
 */
describe('no parser gives one tree both idb\'s flat list and WDA\'s keyboard marks — every committed raw capture', () => {
  const FIXTURES = new URL('../fixtures/', import.meta.url);
  const json = async (file: string): Promise<Record<string, unknown> | unknown[]> => JSON.parse(await readFile(new URL(file, FIXTURES), 'utf8'));
  const flagged = (tree: UiNode, flag: 'ofKeyboard' | 'flatList'): boolean => [...everyNode(tree)].some((n) => n[flag] === true);
  it('idb (describe-all): flat lists, none with an `ofKeyboard` node', async () => {
    const payloads: [string, unknown][] = [];
    for (const file of (await readdir(FIXTURES)).filter((f) => f.startsWith('idb-swift-form') || f.startsWith('idb-modal'))) {
      const v = await json(file);
      if (Array.isArray(v)) payloads.push([file, v]);
      else if (Array.isArray(v.elements)) payloads.push([file, v.elements]);
      else for (const [k, screen] of Object.entries((v.screens ?? v.positions) as Record<string, unknown>)) payloads.push([`${file} ${k}`, screen]);
    }
    expect(payloads.length).toBeGreaterThanOrEqual(6);
    for (const [name, payload] of payloads) {
      const tree = parseIdbDescribeAll(JSON.stringify(payload));
      expect([name, tree.flatList === true, flagged(tree, 'ofKeyboard')]).toEqual([name, true, false]);
    }
  });
  it('WDA (/source): no `flatList` node, keyboard marks on the keyboard captures', async () => {
    const files = (await readdir(FIXTURES)).filter((f) => /^wda-(source|capture|synthetic)-.*\.json$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(13);
    const marked: string[] = [];
    for (const file of files) {
      const tree = parseWdaSource(await readFile(new URL(file, FIXTURES), 'utf8'));
      expect([file, flagged(tree, 'flatList')]).toEqual([file, false]);
      if (flagged(tree, 'ofKeyboard')) marked.push(file);
    }
    expect(marked).toEqual(expect.arrayContaining(['wda-source-myport-login-keyboard.json', 'wda-source-myport-2fa-keyboard-toolbar.json']));
  });
});
