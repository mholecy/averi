import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import { keyboardPosition } from '../../src/ui-tree/keyboard-position.js';
import type { KeyboardRemedy } from '../../src/ui-tree/soft-keyboard.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { usableScreen } from '../../src/ui-tree/usable-screen.js';
import { ClippedRefusal, CoveredRefusal, judgeTap, OffScreenRefusal, tapStandings, type Aim } from '../../src/interact/resolve.js';
import { node } from '../helpers/fake.js';

// THE tap judgement of one look (interact/resolve.ts#judgeTap), as a table over a look and a screen — no settle loop, no
// keyboard guard: a fake `viewport` that counts its fresh reads, static trees, and a hand-made reading that counts what
// it is asked. Each row's sentence is the one the tap's integration cases pin through `tapElement`
// (tests/interact/resolve.test.ts); here it is the rule, one row per standing kind.

const BACK: KeyboardRemedy = { dismissal: 'back', advice: undefined };
const NONE: KeyboardRemedy = { dismissal: 'none', advice: 'tap the title' };

/** A reading that counts its asks: `cover` the keyboard's band from `top` (none when undefined), always stood by. */
function reading(top: number | undefined, width = 1080, height = 2220) {
  const band: Rect | undefined = top === undefined ? undefined : { x: 0, y: top, width, height: height - top };
  const cover: KeyboardCover | undefined = band === undefined ? undefined : { rects: [band], top: band, band, remedy: BACK };
  const asked = { cover: 0, corroborated: 0 };
  return {
    asked,
    reading: { ofKeyboard: () => false, cover: async () => (asked.cover++, cover), corroborated: async () => (asked.corroborated++, cover !== undefined) },
  };
}

/** A viewport that answers `first`, then `fresh` once re-read; `fresh` counts the re-reads. */
function viewport(first: DeviceScreen, again: DeviceScreen = first) {
  let now = first;
  const freshReads: boolean[] = [];
  return {
    freshReads,
    adapter: {
      viewport: async (o?: { fresh?: boolean }) => {
        freshReads.push(o?.fresh === true);
        if (o?.fresh === true) now = again;
        return now;
      },
    },
  };
}

const find = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id || n.label === id)!;

/** Judge `id` on `tree` as the guard's first look does: the usable screen read off the adapter, a position over the look's scene and `kb`'s reading. */
async function judge(
  tree: UiNode,
  id: string,
  device: { first: DeviceScreen; again?: DeviceScreen },
  { kb = reading(undefined), remedy = BACK, sent }: { kb?: ReturnType<typeof reading>; remedy?: KeyboardRemedy; sent?: string } = {},
) {
  const { adapter, freshReads } = viewport(device.first, device.again);
  const look = { node: find(tree, id), tree, scene: sceneOf(tree) };
  const screen = await usableScreen(adapter, { tree });
  freshReads.length = 0;
  const outcome = await judgeTap(adapter, id, look, screen, { position: keyboardPosition(look.scene.order, kb.reading), remedy }, sent)
    .then((j) => j.aim())
    .catch((e: unknown) => e as Error);
  return { outcome, freshReads, asked: kb.asked };
}
const said = (outcome: Aim | Error): string => (outcome instanceof Error ? `${outcome.constructor.name}: ${outcome.message}` : JSON.stringify(outcome));

const PIXEL = { width: 1080, height: 2220, statusBand: 66, navigationBand: 2154 };
const IPHONE = { width: 402, height: 874 };

/** mp-native's SWIFT form on the Pixel_3a as measured: the form's scroller `0,242 1080x1736`, `inside` in it, the CONTINUE bar below. */
const swiftForm = (...inside: UiNode[]): UiNode =>
  node({
    role: 'container',
    rect: { x: 0, y: 0, width: 1080, height: 2220 },
    children: [
      node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 242, width: 1080, height: 1736 }, children: inside }),
      node({ role: 'button', label: 'CONTINUE', identifier: 'continue', rect: { x: 66, y: 1979, width: 948, height: 132 } }),
    ],
  });
/** The "Payment details" toggle at `y`, `height` of it showing, its leaf label and its button cut with it. */
const toggle = (y: number, height: number): UiNode =>
  node({
    role: 'container',
    identifier: 'toggle',
    rect: { x: 66, y, width: 948, height },
    children: [node({ role: 'other', label: 'Payment details', rect: { x: 66, y: y + 12, width: 948, height: Math.min(108, 1978 - (y + 12)) } })],
  });
/** The SWIFT form as idb lists it, flat under a 0×0 root, `priority` at `y` under the CONTINUE bar. */
const idbForm = (y: number): UiNode =>
  node({
    role: 'container',
    rect: { x: 0, y: 0, width: 0, height: 0 },
    flatList: true,
    children: [
      node({ role: 'other', label: 'mp-native', rect: { x: 0, y: 0, width: 402, height: 874 } }),
      node({ role: 'button', label: 'Priority*', identifier: 'priority', rect: { x: 24, y, width: 354, height: 52 } }),
      node({ role: 'button', label: 'Continue to summary', identifier: 'continue', rect: { x: 24, y: 780, width: 354, height: 44 } }),
    ],
  });
const CONTINUE = 'button "Continue to summary" (24,780 354x44)';
/** Android: a 300-px row whose top 200 px lie under a bar laid after its list — its centre (540,1250) on the bar. */
const sheet = (): UiNode =>
  node({
    role: 'container',
    rect: { x: 0, y: 0, width: 1080, height: 2220 },
    children: [
      node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, clipsDescendants: true, children: [node({ role: 'button', identifier: 'row', rect: { x: 0, y: 1100, width: 1080, height: 300 } })] }),
      node({ role: 'button', label: 'Next', identifier: 'next', rect: { x: 0, y: 1100, width: 1080, height: 200 } }),
    ],
  });
const numberPad = async (edit: (t: UiNode) => void = () => {}): Promise<UiNode> => {
  const tree = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
  edit(tree);
  return tree;
};

describe('judgeTap — the on-screen rule, before the guard', () => {
  it('a centre off the screen: an OffScreenRefusal after ONE fresh read of the screen, naming the size read again and the one it replaced', async () => {
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 100, y: 2500, width: 100, height: 40 } })] });
    const { outcome, freshReads } = await judge(tree, 'ok', { first: { width: 1080, height: 2200 }, again: { width: 1080, height: 2400 } });
    expect(said(outcome)).toBe(
      'OffScreenRefusal: ok is off screen at (150,2520) on a 1080x2400 screen (read again before refusing; it was 1080x2200) (rect 100,2500 100x40) — scroll_until it first; nothing was tapped',
    );
    expect(freshReads).toEqual([true, false]);
  });
  it('a centre the fresh read puts on the screen (an unfold the memo missed): judged on the screen read again, and aimed', async () => {
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 2208, height: 1840 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 1550, y: 1630, width: 100, height: 40 } })] });
    const { outcome, freshReads } = await judge(tree, 'ok', { first: { width: 1080, height: 2400 }, again: { width: 2208, height: 1840 } });
    expect(said(outcome)).toBe('{"point":{"x":1600,"y":1650}}');
    expect(freshReads).toEqual([true, false]);
  });
  it('a centre on the screen: no fresh read', async () => {
    const { freshReads } = await judge(sheet(), 'next', { first: PIXEL });
    expect(freshReads).toEqual([]);
  });
  it.each([
    [
      'under the navigation bar, in no scroll view: pinned',
      () => node({ role: 'other', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'button', label: 'Pay', identifier: 'pay', rect: { x: 0, y: 2160, width: 1080, height: 60 } })] }),
      'pay',
      PIXEL,
      'pay is under the navigation bar at (540,2190), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 0,2160 1080x60) — ' +
        'it lies in no scroll view, so no scroll moves it out: it is pinned under the navigation bar (a layout that does not keep clear of it?) — fix the layout, or tap something else; nothing was tapped',
    ],
    [
      'under the navigation bar, in a scroll view: scroll_until it out',
      () => node({ role: 'other', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'container', clipsDescendants: true, rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'button', identifier: 'row', rect: { x: 0, y: 2160, width: 1080, height: 60 } })] })] }),
      'row',
      PIXEL,
      'row is under the navigation bar at (540,2190), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 0,2160 1080x60) — ' +
        'it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped',
    ],
    [
      'under the status bar, in idb\'s flat list (the tree cannot say): both remedies',
      () => idbForm(-20),
      'priority',
      { ...IPHONE, statusBand: 62 },
      'priority is under the status bar at (201,6), in the top 62 of the screen (tree units), where a tap goes to the status bar ' +
        '(rect 24,-20 354x52) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; ' +
        'if not, no scroll moves it out: it is pinned under the status bar (a layout that does not keep clear of it?) — fix the layout, or tap something else; nothing was tapped',
    ],
  ])('a centre under a system bar — %s', async (_name, tree, id, device, sentence) => {
    const { outcome } = await judge(tree(), id, { first: device });
    expect(outcome).toBeInstanceOf(OffScreenRefusal);
    expect((outcome as Error).message).toBe(sentence);
  });
});

describe('judgeTap(…).aim() — cut, cover, keyboard, after the guard', () => {
  it.each([
    [
      'cut, its own: ClippedRefusal with its own way past',
      () => swiftForm(toggle(1924, 55)),
      'toggle',
      'ClippedRefusal: toggle is cut at its scroll container\'s bottom edge (container 0,242 1080x1736); only a 948x55 part of it shows, ' +
        '55 deep across that edge, under the 65 a tap needs — scroll_until it first' +
        ' (if it is whole and only its own content runs to that edge, no scroll shows more: tap a child of it that lies clear of that edge, or tap by coordinates); nothing was tapped',
    ],
    [
      'cut, inherited from what it lies in: ClippedRefusal naming it',
      () => swiftForm(toggle(1924, 55)),
      'Payment details',
      'ClippedRefusal: Payment details is cut at its scroll container\'s bottom edge (container 0,242 1080x1736), as is the 66,1924 948x55 it lies in; ' +
        'only a 948x42 part of it shows, 42 deep across that edge, under the 65 a tap needs — scroll_until it first' +
        ' (if what it lies in is whole and only its content runs to that edge, no scroll shows more: tap something in it that lies clear of that edge, or tap by coordinates); nothing was tapped',
    ],
    [
      'covered, a piece too small: CoveredRefusal naming the cover and the piece',
      () => idbForm(771),
      'priority',
      `CoveredRefusal: priority is under ${CONTINUE} at its centre (201,797), drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped`,
    ],
    [
      'covered, a piece large enough: moved there, said',
      () => idbForm(754),
      'priority',
      `{"point":{"x":201,"y":767},"moved":"at (201,767) — its centre (201,780) is under ${CONTINUE.replaceAll('"', '\\"')}, drawn over it; tapped the uncovered part 354x26"}`,
    ],
    ['reachable at its centre: the centre, nothing said', () => idbForm(300), 'priority', '{"point":{"x":201,"y":326}}'],
  ])('%s', async (_name, tree, id, sentence) => {
    const { outcome } = await judge(tree(), id, { first: tree().rect.width === 0 ? IPHONE : PIXEL });
    expect(said(outcome)).toBe(sentence);
  });

  it('covered, with nothing of it showing above idb\'s band: CoveredRefusal, "above the soft keyboard"', async () => {
    const { outcome } = await judge(await numberPad(), 'swift_payment.form.value_date_select', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: swift_payment.form.value_date_select is under button "Continue to summary" (24,512 354x44) at its centre (201,571), drawn over it; nothing of it shows above the soft keyboard — scroll_until it first; nothing was tapped',
    );
  });

  it('under idb\'s band (no reading stands by it): CoveredRefusal with the keyboard\'s remedy', async () => {
    const tree = await numberPad((t) => {
      t.children.find((n) => n.identifier === 'swift_payment.form.value_date_select')!.rect = { x: 24, y: 565, width: 354, height: 52 };
    });
    const { outcome } = await judge(tree, 'swift_payment.form.value_date_select', { first: IPHONE }, { remedy: NONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: swift_payment.form.value_date_select is under the soft keyboard: its centre (201,591) lies below the keyboard\'s top edge at y 589, where a tap presses the keyboard — ' +
        'scroll_until it first, or hide the keyboard (tap a neutral element such as the screen title — a tap: step in a flow); this adapter cannot hide it on its own (tap the title); nothing was tapped',
    );
  });

  it('a covered centre and a reading\'s band: moved to a piece above the soft keyboard, said; or refused when the piece above it is too small', async () => {
    expect(said((await judge(sheet(), 'row', { first: PIXEL }, { kb: reading(1380) })).outcome)).toBe(
      '{"point":{"x":540,"y":1340},"moved":"at (540,1340) — its centre (540,1250) is under button \\"Next\\" (0,1100 1080x200), drawn over it; tapped the uncovered part 1080x80 above the soft keyboard"}',
    );
    expect(said((await judge(sheet(), 'row', { first: PIXEL }, { kb: reading(1350) })).outcome)).toBe(
      'CoveredRefusal: row is under button "Next" (0,1100 1080x200) at its centre (540,1250), drawn over it; only a 1080x50 part of it shows above the soft keyboard, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped',
    );
  });

  it('`sent`: the headline says what the guard sent first', async () => {
    const sent = 'back was pressed to hide the soft keyboard';
    expect(said((await judge(idbForm(771), 'priority', { first: IPHONE }, { sent })).outcome)).toBe(
      `CoveredRefusal: priority was not tapped: after ${sent}, it is under ${CONTINUE} at its centre (201,797), drawn over it; only a 354x9 part of it shows, under the 24x24 a tap may be moved to — scroll_until it first`,
    );
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 100, y: 2500, width: 100, height: 40 } })] });
    expect(said((await judge(tree, 'ok', { first: { width: 1080, height: 2220 } }, { sent })).outcome)).toBe(
      `OffScreenRefusal: ok was not tapped: after ${sent}, it is off screen at (150,2520) on a 1080x2220 screen (rect 100,2500 100x40) — scroll_until it first`,
    );
  });
});

describe('the reading\'s line — asked lazily, once (D-C3c)', () => {
  it('asked once when a node covers the centre', async () => {
    const { asked } = await judge(sheet(), 'row', { first: PIXEL }, { kb: reading(1380) });
    expect(asked).toEqual({ cover: 1, corroborated: 1 });
  });
  it('never asked for a cut target, nor for a centre nothing covers, nor before aim()', async () => {
    expect((await judge(swiftForm(toggle(1924, 55)), 'toggle', { first: PIXEL }, { kb: reading(1380) })).asked).toEqual({ cover: 0, corroborated: 0 });
    expect((await judge(sheet(), 'next', { first: PIXEL }, { kb: reading(1380) })).asked).toEqual({ cover: 0, corroborated: 0 });
    const kb = reading(1380);
    const tree = sheet();
    const look = { node: find(tree, 'row'), tree, scene: sceneOf(tree) };
    await judgeTap(viewport(PIXEL).adapter, 'row', look, undefined, { position: keyboardPosition(look.scene.order, kb.reading), remedy: BACK });
    expect(kb.asked).toEqual({ cover: 0, corroborated: 0 });
  });
});

describe('tapStandings — the tap\'s two standings of a node', () => {
  it('`full()` IS `first` when the reading\'s line changes no line (none to merge, or the same line)', async () => {
    const tree = sheet();
    const scene = sceneOf(tree);
    const standings = tapStandings(scene, find(tree, 'row'), undefined, keyboardPosition(scene.order, reading(undefined).reading));
    expect(await standings.full()).toBe(standings.first);
  });
  it('`full()` judges again with the merged line when the reading has one', async () => {
    const tree = sheet();
    const scene = sceneOf(tree);
    const standings = tapStandings(scene, find(tree, 'row'), undefined, keyboardPosition(scene.order, reading(1350).reading));
    expect(standings.first.kind).toBe('reachable');
    expect((await standings.full()).kind).toBe('covered');
  });
  it('idb\'s band alone: the line is the tree\'s own, so `full()` is `first`, asking the reading once', async () => {
    const tree = await numberPad();
    const scene = sceneOf(tree);
    const kb = reading(undefined);
    const standings = tapStandings(scene, find(tree, 'swift_payment.form.value_date_select'), undefined, keyboardPosition(scene.order, kb.reading));
    expect(await standings.full()).toBe(standings.first);
    expect(kb.asked).toEqual({ cover: 1, corroborated: 0 });
  });
});
