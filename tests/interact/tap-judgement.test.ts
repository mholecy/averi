import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { everyNode, type DeviceScreen, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import type { KeyboardCover } from '../../src/ui-tree/keyboard-cover.js';
import { lookAt, type Look } from '../../src/ui-tree/look.js';
import { usableScreen } from '../../src/ui-tree/usable-screen.js';
import type { KeyboardRemedy } from '../../src/ui-tree/soft-keyboard.js';
import type { Scene } from '../../src/ui-tree/standing.js';
import { judgeTap, OffScreenRefusal, tapStandings, type Aim, type TapReading } from '../../src/interact/tap-judgement.js';
import { node } from '../helpers/fake.js';
import { stackedLayers } from '../helpers/stacked-layers.js';
import { parseDump } from '../helpers/android-dumps.js';
import { remedyThenEscape } from '../helpers/escape-order.js';

// THE tap judgement of one look (interact/tap-judgement.ts#judgeTap), as a table over a look (ui-tree/look.ts#lookAt)
// and a screen — no settle loop, no keyboard guard: a fake `viewport` that counts its fresh reads, static trees, and a
// hand-made reading that counts what it is asked. Each row's sentence is the one the tap's integration cases pin through `tapElement`
// (tests/interact/resolve.test.ts); here it is the rule, one row per standing kind.

// sceneOf (ui-tree/standing.ts), counted: the look's-scene rows below pin that a judgement derives no scene of its own.
const { walks } = vi.hoisted(() => ({ walks: { n: 0 } }));
vi.mock('../../src/ui-tree/standing.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/ui-tree/standing.js')>();
  return { ...real, sceneOf: (tree: UiNode) => (walks.n++, real.sceneOf(tree)) };
});

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

/** The look of `tree` with `kb`'s reading and `remedy` — what the tap's judgement asks of a reading (`TapReading`). */
const lookWith = (tree: UiNode, kb: ReturnType<typeof reading>, remedy: KeyboardRemedy = BACK): Look<TapReading> => lookAt(tree, { ...kb.reading, remedy });

/** Judge `id` on `tree` as the guard's first look does: the usable screen of the look's tree read off the adapter, the look's keyboard position over its scene and `kb`'s reading. */
async function judge(
  tree: UiNode,
  id: string,
  device: { first: DeviceScreen; again?: DeviceScreen },
  { kb = reading(undefined), remedy = BACK, sent }: { kb?: ReturnType<typeof reading>; remedy?: KeyboardRemedy; sent?: string } = {},
) {
  const { adapter, freshReads } = viewport(device.first, device.again);
  const look = lookWith(tree, kb, remedy);
  const screen = await usableScreen(adapter, look);
  freshReads.length = 0;
  const outcome = await judgeTap(adapter, id, { node: find(tree, id), look }, screen, sent === undefined ? {} : { sent })
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
/** Named with its reach: idb lists no node for the pinned bar's background, which runs down to the screen's bottom. */
const CONTINUE = 'button "Continue to summary" (24,780 354x44, reaching 24,780 354x94)';
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
      'CoveredRefusal: swift_payment.form.value_date_select is under button "Continue to summary" (24,512 354x44, reaching 24,512 354x77) at its centre (201,571), drawn over it; nothing of it shows above the soft keyboard — scroll_until it first; nothing was tapped',
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

/**
 * A later STACKED screen-sized layer's own surface covers the screen beneath it when it carries content (ADR 0018) —
 * the two bug notes it answers (docs/bugs/2026-10-13-ios-wda-*), each a tap reported "Tapped"
 * that landed on the layer, on the real ui_snapshots of those calls (tests/fixtures/wda-ui-snapshot-stacked-layers.json).
 */
describe('judgeTap(…).aim() — outside what its scroll view draws (a WDA tree\'s drawn frame), after the guard', () => {
  /** The at-rest SWIFT form's shape under WDA: its ScrollView `0,0 402x780`, CONTINUE pinned below it, `rows` listed in the form. */
  const atRest = (...rows: UiNode[]): UiNode =>
    node({
      role: 'container',
      unclippedFrames: true,
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        node({ role: 'scrollable', identifier: 'form', rect: { x: 0, y: 0, width: 402, height: 780 }, children: rows }),
        node({ role: 'button', label: 'Continue to summary', identifier: 'continue', rect: { x: 24, y: 780, width: 354, height: 44 } }),
      ],
    });
  const name = () => node({ role: 'textfield', identifier: 'payee_name_input', rect: { x: 24, y: 801, width: 354, height: 52 } });

  it('payee_name_input, listed below the form, its centre (201,827) on the bare background: refused naming the scroll view — never "Tapped", and no fresh read of the screen', async () => {
    const { outcome, freshReads } = await judge(atRest(name()), 'payee_name_input', { first: IPHONE });
    expect(said(outcome)).toBe(
      'OffScreenRefusal: payee_name_input is outside its scroll view scrollable id:form (0,0 402x780) at (201,827): nothing of it is drawn (rect 24,801 354x52) — scroll_until it first; nothing was tapped',
    );
    expect(freshReads).toEqual([]);
  });

  it('a card partly drawn, its centre outside what its scroll views draw (a carousel at the form\'s foot): refused as at the screen\'s edge, "fully: true first" — not tapped on its drawn part', async () => {
    // low_card 750–830 in the carousel 740–840, inside the form ending at 780: 30 of its 80 pt drawn, its centre (124,790) not.
    const low = node({ role: 'button', identifier: 'low_card', rect: { x: 24, y: 750, width: 200, height: 80 } });
    const carousel = node({ role: 'scrollable', identifier: 'carousel_low', rect: { x: 0, y: 740, width: 402, height: 100 }, children: [low] });
    const { outcome } = await judge(atRest(carousel), 'low_card', { first: IPHONE });
    expect(said(outcome)).toBe(
      'OffScreenRefusal: low_card is outside its scroll view scrollable id:form (0,0 402x780) at (124,790): only 38% of it (rect 24,750 200x80) is drawn, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped',
    );
  });

  it('not by the on-screen rule before the guard: judgeTap lets the look through (the guard may hide a keyboard its scroll view was laid out above), and aim() refuses it', async () => {
    const tree = atRest(name());
    const look = lookWith(tree, reading(undefined));
    const { adapter } = viewport(IPHONE);
    const judged = await judgeTap(adapter, 'payee_name_input', { node: find(tree, 'payee_name_input'), look }, await usableScreen(adapter, look));
    await expect(judged.aim()).rejects.toBeInstanceOf(OffScreenRefusal);
  });

  it('a row across the form\'s bottom edge, its centre outside it: refused as at the screen\'s edge, what is drawn of it quoted', async () => {
    const across = node({ role: 'button', identifier: 'across', rect: { x: 24, y: 760, width: 354, height: 60 } });
    const { outcome } = await judge(atRest(across), 'across', { first: IPHONE });
    expect(said(outcome)).toBe(
      'OffScreenRefusal: across is outside its scroll view scrollable id:form (0,0 402x780) at (201,790): only 33% of it (rect 24,760 354x60) is drawn, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped',
    );
  });
});

describe('judgeTap(…).aim() — a later stacked screen layer over the target (docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md)', () => {
  const screens = stackedLayers;

  it('the RN transparent Modal\'s dimming root over the login screen (#248): lang_sk is refused as under `forgot_overlay`, never tapped (device: "Tapped", the shim\'s tap at 290,251 swallowed)', async () => {
    const { outcome } = await judge((await screens()).finportalForgot, 'lang_sk', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: lang_sk is under container id:forgot_overlay (0,0 402x874) at its centre (290,251), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('…and login_title, its centre under the modal\'s card: nothing of it shows — the strip beside the card the device reply said "shows" is the overlay\'s', async () => {
    const { outcome } = await judge((await screens()).finportalForgot, 'login_title', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: login_title is under container id:forgot_modal (16,301 370x220) at its centre (201,303), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('the Contacts New Contact page sheet over the list (#146): a row\'s photo button under the sheet\'s bare background is refused as under the sheet (device: "Tapped" at 41,290)', async () => {
    const { outcome } = await judge((await screens()).contactsSheet, 'Contact photo for Kate Bell', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: Contact photo for Kate Bell is under scrollable (0,62 402x812) at its centre (41,290), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('the remedy is the presented screen\'s only where the cover lies on it: a row of the sheet under another of the sheet\'s rows (`add address` under `add field`, both scrolled to the form\'s top) is refused as before — scroll_until it first', async () => {
    const { outcome } = await judge((await screens()).contactsSheet, 'add address', { first: IPHONE });
    expect(said(outcome)).toMatch(/ — scroll_until it first; nothing was tapped$/);
  });

  it('…nor where the later layer carries only a bar: Safari\'s page B (#158), a link under the capsule\'s bottom bar — a pinned bar, so "scroll_until it first"', async () => {
    const { outcome } = await judge((await screens()).safariPageB, 'Link number 12', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: Link number 12 is under button "Page Menu" (90,792 48x48) at its centre (105,817), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped',
    );
  });

  it('the SWIFT form\'s Fees sheet at its half detent: the From row under the sheet\'s LABELLED dim, UIKit\'s `PopoverDismissRegion`, is refused as under a presented screen — close it first, never "scroll_until it first"', async () => {
    const { outcome } = await judge((await screens()).swiftFeesSheet, 'swift_payment.form.debit_select', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: swift_payment.form.debit_select is under container "dismiss popup" (-402,-874 1206x2622) at its centre (201,195), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('Contacts\' discard popover over the New Contact sheet: a row of the sheet under the popover\'s labelled `PopoverDismissRegion` is refused as under a presented screen — close it first', async () => {
    const { outcome } = await judge((await screens()).contactsDiscardPopover, 'Insert add instant message', { first: IPHONE });
    expect(said(outcome)).toBe(
      'CoveredRefusal: Insert add instant message is under container "dismiss popup" (0,0 402x874) at its centre (52,271), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('…and with the sheet Expanded, its dim an unlabelled bare frame and no cover: the sheet\'s form `scrollable 24,105 354x711` gives the same remedy', async () => {
    expect(said((await judge((await screens()).swiftFeesSheetExpanded, 'swift_payment.form.debit_select', { first: IPHONE })).outcome)).toMatch(
      / — a screen is presented over it \(a modal or a sheet\) — close it first; no scroll moves it out from under that screen; nothing was tapped$/,
    );
  });

  it('…and the Fees sheet\'s own row, laid after the labelled dim on the presented layer, is tapped at its centre', async () => {
    expect(said((await judge((await screens()).swiftFeesSheet, 'swift_payment.form.fees_sheet.row_1', { first: IPHONE })).outcome)).toMatch(/^\{"point":/);
  });

  it('no regression: the login screen with no modal (#218) — lang_sk tapped at its centre; and the modal\'s own Close is tapped at its centre', async () => {
    expect(said((await judge((await screens()).finportalLogin, 'lang_sk', { first: IPHONE })).outcome)).toBe('{"point":{"x":290,"y":251}}');
    expect(said((await judge((await screens()).finportalForgot, 'forgot_close', { first: IPHONE })).outcome)).toBe('{"point":{"x":201,"y":800}}');
  });
});

/**
 * A non-interactive wrapper laid after the content whose only child is a small control (Android's floating action
 * button host: Clock's `fab_container` 0,1582 1080x352 holding the 264x264 FAB, about 18 % of it) still counts as drawn
 * over its whole rect — the tree cannot tell it from a tab bar's host that swallows touches — but the refusal says the
 * wrapper may only position that child. Small: the child's area at most a quarter of the wrapper's.
 */
describe('judgeTap(…).aim() — a wrapper over the target holding one small control', () => {
  const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
  /** Clock's Alarm tab as dumped (the 9:00 card collapsed under the FAB host), the host's child `child`. */
  const clock = (child: UiNode = node({ role: 'button', label: 'Add alarm', identifier: 'fab', rect: rect(408, 1626, 264, 264) })): UiNode =>
    node({
      role: 'container',
      rect: rect(0, 0, 1080, 2220),
      children: [
        node({
          role: 'container',
          identifier: 'desk_clock_pager_frame',
          rect: rect(0, 242, 1080, 1692),
          children: [
            node({
              role: 'scrollable',
              identifier: 'alarm_recycler_view',
              clipsDescendants: true,
              rect: rect(0, 242, 1080, 1692),
              children: [
                node({
                  role: 'container',
                  rect: rect(44, 1533, 992, 367),
                  children: [
                    node({ role: 'button', identifier: 'arrow', label: 'Expand 9:00 AM alarm', rect: rect(882, 1533, 110, 132) }),
                    node({ role: 'text', label: '9:00 AM', rect: rect(88, 1577, 360, 191) }),
                    node({ role: 'switch', identifier: 'onoff', label: '9:00 AM alarm', rect: rect(849, 1768, 143, 132) }),
                  ],
                }),
              ],
            }),
          ],
        }),
        node({ role: 'container', identifier: 'fab_container', rect: rect(0, 1582, 1080, 352), children: [child] }),
      ],
    });

  it('Clock\'s chevron beside the FAB: refused naming the host, and the refusal says the host may only position its FAB — tap that when it is the target, otherwise scroll_until the target out of the host\'s band', async () => {
    expect(said((await judge(clock(), 'Expand 9:00 AM alarm', { first: PIXEL })).outcome)).toBe(
      'CoveredRefusal: Expand 9:00 AM alarm is under container id:fab_container (0,1582 1080x352) at its centre (937,1599), drawn over it; only a 110x49 part of it shows, under the 65x65 a tap may be moved to — ' +
        'the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first; nothing was tapped',
    );
    expect(said((await judge(clock(), 'onoff', { first: PIXEL })).outcome)).toBe(
      'CoveredRefusal: onoff is under container id:fab_container (0,1582 1080x352) at its centre (921,1834), drawn over it; nothing of it shows — ' +
        'the wrapper may only position its one child, button "Add alarm" (408,1626 264x264): tap that child when it is the target; otherwise scroll_until this element out of the wrapper\'s band first; nothing was tapped',
    );
  });

  it('small is a quarter of the wrapper at most: a child of 26 % of it gets no hint — scroll_until it first', async () => {
    // 1080x352 = 380160; a 330x300 child is 99000, 26.0 % of it.
    const big = node({ role: 'button', label: 'Add alarm', identifier: 'fab', rect: rect(375, 1600, 330, 300) });
    expect(said((await judge(clock(big), 'Expand 9:00 AM alarm', { first: PIXEL })).outcome)).toMatch(/ — scroll_until it first; nothing was tapped$/);
    // …a 320x297 child is 95040, exactly 25 %: the hint.
    const quarter = node({ role: 'button', label: 'Add alarm', identifier: 'fab', rect: rect(380, 1600, 320, 297) });
    expect(said((await judge(clock(quarter), 'Expand 9:00 AM alarm', { first: PIXEL })).outcome)).toMatch(/ — the wrapper may only position its one child, button "Add alarm" \(380,1600 320x297\)/);
  });

  it('a child that is no control (a text) gets no hint', async () => {
    const label = node({ role: 'text', label: 'Add alarm', rect: rect(408, 1626, 264, 264) });
    expect(said((await judge(clock(label), 'Expand 9:00 AM alarm', { first: PIXEL })).outcome)).toMatch(/ — scroll_until it first; nothing was tapped$/);
  });

  it('a screen presented over the target wins over the hint: the RN modal\'s card made a wrapper of one small button still says close it first', async () => {
    const tree = (await stackedLayers()).finportalForgot;
    const modal = find(tree, 'forgot_modal');
    modal.children = [node({ role: 'button', identifier: 'forgot_send', label: 'Send', rect: rect(32, 317, 80, 40) })];
    expect(said((await judge(tree, 'login_title', { first: IPHONE })).outcome)).toBe(
      'CoveredRefusal: login_title is under container id:forgot_modal (16,301 370x220) at its centre (201,303), drawn over it; nothing of it shows — a screen is presented over it (a modal or a sheet) — close it first; no scroll moves it out from under that screen; nothing was tapped',
    );
  });

  it('a child of no area is no control to point at: no hint', async () => {
    const empty = node({ role: 'button', label: 'Add alarm', identifier: 'fab', rect: rect(408, 1626, 0, 0) });
    expect(said((await judge(clock(empty), 'Expand 9:00 AM alarm', { first: PIXEL })).outcome)).toMatch(/ — scroll_until it first; nothing was tapped$/);
  });

  it('a tab bar\'s host (several tabs, mp-native\'s Compose host 66,1840 948x248) gets no hint: it may swallow touches — scroll_until it first', async () => {
    const tab = (i: number, id: string): UiNode => node({ role: 'button', identifier: id, rect: rect(102 + 219 * i, 1876, 219, 176) });
    const tree = node({
      role: 'container',
      rect: rect(0, 0, 1080, 2220),
      children: [
        node({ role: 'scrollable', clipsDescendants: true, rect: rect(0, 242, 1080, 1912), children: [node({ role: 'button', identifier: 'row', rect: rect(66, 1900, 948, 132) })] }),
        node({ role: 'container', rect: rect(66, 1840, 948, 248), children: [tab(0, 'nav.tab_home'), tab(1, 'nav.tab_transactions'), tab(2, 'nav.tab_cards'), tab(3, 'nav.tab_more')] }),
      ],
    });
    expect(said((await judge(tree, 'row', { first: PIXEL })).outcome)).toMatch(/ — scroll_until it first; nothing was tapped$/);
  });
});

describe('the reading\'s line — asked lazily, once', () => {
  it('asked once when a node covers the centre', async () => {
    const { asked } = await judge(sheet(), 'row', { first: PIXEL }, { kb: reading(1380) });
    expect(asked).toEqual({ cover: 1, corroborated: 1 });
  });
  it('never asked for a cut target, nor for a centre nothing covers, nor before aim()', async () => {
    expect((await judge(swiftForm(toggle(1924, 55)), 'toggle', { first: PIXEL }, { kb: reading(1380) })).asked).toEqual({ cover: 0, corroborated: 0 });
    expect((await judge(sheet(), 'next', { first: PIXEL }, { kb: reading(1380) })).asked).toEqual({ cover: 0, corroborated: 0 });
    const kb = reading(1380);
    const tree = sheet();
    await judgeTap(viewport(PIXEL).adapter, 'row', { node: find(tree, 'row'), look: lookWith(tree, kb) }, undefined);
    expect(kb.asked).toEqual({ cover: 0, corroborated: 0 });
  });
});

describe('the look\'s scene — judgeTap reads it and derives none', () => {
  /** The look of `tree` with its scene a spy: what judgeTap asks of it (`standing`, `clips`) is recorded, and answered by the look's real scene. */
  function spyScene(tree: UiNode, kb: ReturnType<typeof reading>) {
    const look = lookWith(tree, kb);
    const real = look.scene;
    const asked: string[] = [];
    const scene: Scene = {
      get order() {
        return real.order;
      },
      get clips() {
        asked.push('clips');
        return real.clips;
      },
      standing: ((...args: Parameters<Scene['standing']>) => (asked.push('standing'), real.standing(...args))) as Scene['standing'],
      pixelRegion: (...args) => (asked.push('pixelRegion'), real.pixelRegion(...args)),
      presentedAt: (...args) => (asked.push('presentedAt'), real.presentedAt(...args)),
      flushNeighbours: (...args) => (asked.push('flushNeighbours'), real.flushNeighbours(...args)),
      pinnedEdges: (...args) => (asked.push('pinnedEdges'), real.pinnedEdges(...args)),
    };
    Object.defineProperty(look, 'scene', { get: () => scene });
    return { look, asked };
  }
  async function judgeOn(tree: UiNode, id: string, kb: ReturnType<typeof reading>) {
    const { look, asked } = spyScene(tree, kb);
    walks.n = 0;
    const outcome = await judgeTap(viewport(PIXEL).adapter, id, { node: find(tree, id), look }, undefined)
      .then((j) => j.aim())
      .catch((e: unknown) => e as Error);
    return { outcome, asked, walks: walks.n };
  }

  it('a covered centre judged again with the reading\'s line: the standing asked of the look\'s scene, no scene walked', async () => {
    const { outcome, asked, walks } = await judgeOn(sheet(), 'row', reading(1380));
    expect(outcome).not.toBeInstanceOf(Error);
    expect(asked).toContain('standing');
    expect(walks).toBe(0);
  });
  it("a centre under the navigation bar: refused with the remedy the look's scene's standing carries (in no scroll view) — judgeTap asks the scene's standing, not its clips, and walks no scene", async () => {
    const tree = node({ role: 'other', rect: { x: 0, y: 0, width: 1080, height: 2220 }, children: [node({ role: 'button', label: 'Pay', identifier: 'pay', rect: { x: 0, y: 2160, width: 1080, height: 60 } })] });
    const { look, asked } = spyScene(tree, reading(undefined));
    const { adapter } = viewport(PIXEL);
    const screen = await usableScreen(adapter, look);
    walks.n = 0;
    const refused = await judgeTap(adapter, 'pay', { node: find(tree, 'pay'), look }, screen).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(OffScreenRefusal);
    expect(asked).toContain('standing');
    expect((refused as Error).message).toContain('it lies in no scroll view');
    expect(asked).not.toContain('clips');
    expect(walks.n).toBe(0);
  });
});

describe('tapStandings — the tap\'s two standings of a node', () => {
  it('`full()` IS `first` when the reading\'s line changes no line (none to merge, or the same line)', async () => {
    const tree = sheet();
    const standings = tapStandings(lookWith(tree, reading(undefined)), find(tree, 'row'), undefined);
    expect(await standings.full()).toBe(standings.first);
  });
  it('`full()` judges again with the merged line when the reading has one', async () => {
    const tree = sheet();
    const standings = tapStandings(lookWith(tree, reading(1350)), find(tree, 'row'), undefined);
    expect(standings.first.kind).toBe('reachable');
    expect((await standings.full()).kind).toBe('covered');
  });
  it('idb\'s band alone: the line is the tree\'s own, so `full()` is `first`, asking the reading once', async () => {
    const tree = await numberPad();
    const kb = reading(undefined);
    const standings = tapStandings(lookWith(tree, kb), find(tree, 'swift_payment.form.value_date_select'), undefined);
    expect(await standings.full()).toBe(standings.first);
    expect(kb.asked).toEqual({ cover: 1, corroborated: 0 });
  });
});

/**
 * Lab note F2A1 (docs/bugs/2026-10-16-lab-android-scroll-until-calls-a-field-under-the-ime-riding-bar-visible.md), the
 * owner's decision of 2026-10-17: a control Compose dumped as the strip a node drawn after it leaves — the submit bar
 * riding on the IME — is refused under the tap minimum, naming that node, where the strip lies and how much of it shows,
 * with the remedy "dismiss the keyboard first, or scroll the list". Measured: averi tapped note's strip after `back` at
 * y 2133, 7 px below Continue, and reached it only because the lab's bar lets touches through; a tap at the field's own
 * centre submitted the form. Real captures of the lab's `form-keyboard` (averi_lab, API 33, 1080x2220).
 */
describe('judgeTap(…).aim() — a sliver cut by a node drawn after it: ClippedRefusal naming that node', () => {
  const capture = async (name: string): Promise<UiNode> => parseDump(await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));
  const CUTTER = 'container id:lab.form-keyboard.submit';
  it('phone under the bar riding on the IME, the keyboard up (its line 1398): dismiss it first, or scroll', async () => {
    const kb = reading(1398);
    const { outcome } = await judge(await capture('android-lab-form-keyboard.xml'), 'lab.form-keyboard.phone', { first: PIXEL }, { kb });
    expect(said(outcome)).toBe(
      `ClippedRefusal: lab.form-keyboard.phone is cut at its top edge by ${CUTTER} (55,1238 970x132), drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, ` +
        'so the rest of it may lie under that container; only a 970x28 part of it shows above the soft keyboard, at 55,1370, 42 deep across that edge, under the 65 a tap needs — ' +
        'the soft keyboard is up (its top edge at y 1398): dismiss it first (press_key back from the MCP tools; `dismissKeyboard: true` on the fill before this step in a flow) — ' +
        'a bar riding on it goes down with it — or scroll_until it out from under that container first (only if a screenshot shows it whole — a control that thin laid flush against that container — no scroll shows more: tap by coordinates); nothing was tapped',
    );
    // The reading is asked once, for the remedy's words.
    expect(kb.asked.cover).toBe(1);
  });
  it('note after back, the keyboard down: scroll it out from under the bar', async () => {
    const { outcome } = await judge(await capture('android-lab-form-keyboard-after-back.xml'), 'lab.form-keyboard.note', { first: PIXEL });
    expect(said(outcome)).toBe(
      `ClippedRefusal: lab.form-keyboard.note is cut at its top edge by ${CUTTER} (55,1994 970x132), drawn after it — the dump (Compose's, on Android) leaves out of a node's bounds what a later node covers, ` +
        'so the rest of it may lie under that container; only a 970x14 part of it shows, at 55,2126, 14 deep across that edge, under the 65 a tap needs — ' +
        'scroll_until it out from under that container first (only if a screenshot shows it whole — a control that thin laid flush against that container — no scroll shows more: tap by coordinates); nothing was tapped',
    );
  });
  it('the adapter that cannot hide the keyboard says so, with its advice', async () => {
    const { outcome } = await judge(await capture('android-lab-form-keyboard.xml'), 'lab.form-keyboard.phone', { first: PIXEL }, { kb: reading(1398), remedy: NONE });
    expect(said(outcome)).toContain(
      'dismiss it first (tap a neutral element such as the screen title — a tap: step in a flow; this adapter cannot hide it on its own (tap the title)) — a bar riding on it goes down with it — or scroll_until',
    );
  });
  // The owner's decision of 2026-10-18 on F2A1's wording: the coordinate tap stays, as the way past a control that only
  // READS cut — but every remedy the refusal names (hide the keyboard, scroll) comes before it, and it is the last clause.
  it('the remedy first, the coordinate escape last — phone with the IME up, note after back', async () => {
    const replies = [
      said((await judge(await capture('android-lab-form-keyboard.xml'), 'lab.form-keyboard.phone', { first: PIXEL }, { kb: reading(1398) })).outcome),
      said((await judge(await capture('android-lab-form-keyboard-after-back.xml'), 'lab.form-keyboard.note', { first: PIXEL })).outcome),
    ];
    for (const reply of replies) expect(remedyThenEscape(reply), reply).toEqual({ remedies: expect.any(Number), escapeLast: true });
    expect(remedyThenEscape(replies[0]).remedies).toBe(2); // dismiss it first, then scroll_until
  });
  it('a field whole above the bar is tapped at its centre, the reading never asked', async () => {
    const kb = reading(1398);
    const { outcome } = await judge(await capture('android-lab-form-keyboard.xml'), 'lab.form-keyboard.postcode', { first: PIXEL }, { kb });
    expect(said(outcome)).toBe('{"point":{"x":540,"y":1164}}');
    expect(kb.asked.cover).toBe(0);
  });
});

describe('judgeTap(…).aim() — a cut by a later node names the keyboard only when that node rides on it', () => {
  /** A field `55,y 970x42` cut at its top by a bar laid after it, ending at `barBottom` — the keyboard's line at 1398. */
  const cutAt = (barBottom: number) =>
    node({
      role: 'container',
      rect: { x: 0, y: 0, width: 1080, height: 2220 },
      children: [
        node({ role: 'textfield', identifier: 'field', rect: { x: 55, y: barBottom, width: 970, height: 42 } }),
        node({ role: 'button', identifier: 'bar', rect: { x: 0, y: barBottom - 132, width: 1080, height: 132 } }),
      ],
    });
  it('a bar ending 28 px above the line (the lab\'s Continue): dismiss the keyboard first, or scroll', async () => {
    const { outcome } = await judge(cutAt(1370), 'field', { first: PIXEL }, { kb: reading(1398) });
    expect(said(outcome)).toContain('— the soft keyboard is up (its top edge at y 1398): dismiss it first');
  });
  it('a strip wholly under the keyboard\'s line: nothing of it shows above the soft keyboard, its strip quoted', async () => {
    const { outcome } = await judge(cutAt(1370), 'field', { first: PIXEL }, { kb: reading(1360) });
    expect(said(outcome)).toContain('so the rest of it may lie under that button; nothing of it shows above the soft keyboard (its strip lies at 55,1370 970x42), 42 deep across that edge');
  });
  it('a bar ending 10 px BELOW the line (the keyboard drawn over its bottom): the keyboard unnamed', async () => {
    const { outcome } = await judge(cutAt(1370), 'field', { first: PIXEL }, { kb: reading(1360) });
    expect(said(outcome)).not.toContain('dismiss it first');
    expect(said(outcome)).toContain('— scroll_until it out from under that button first (');
  });
  it('a bar ending 66 px above the line, one past the minimum (a button stacked over another): the scroll alone, the safe direction', async () => {
    const { outcome } = await judge(cutAt(1332), 'field', { first: PIXEL }, { kb: reading(1398) });
    expect(said(outcome)).not.toContain('dismiss it first');
  });
  it('a top bar ending at 300, far above the line: the scroll alone, the keyboard unnamed', async () => {
    const { outcome } = await judge(cutAt(300), 'field', { first: PIXEL }, { kb: reading(1398) });
    expect(said(outcome)).toContain('under the 65 a tap needs — scroll_until it out from under that button first (');
    expect(said(outcome)).not.toContain('soft keyboard');
  });
});
