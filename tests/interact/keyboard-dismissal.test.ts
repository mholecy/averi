import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { everyNode, type Point, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { AfterDismissalTap, KeyboardWithoutDismissal, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { AVERIS_OWN, configuredStrategies, nextMove, type DismissalGround } from '../../src/interact/keyboard-dismissal.js';
import { KEYBOARD_HIDE_CONFIRM_LOOKS } from '../../src/interact/keyboard-in-tree.js';
import { KEYBOARD_HIDE_DELAY_MS } from '../../src/interact/keyboard-model.js';
import { dismissKeyboard } from '../../src/interact/keyboard.js';
import { tapElement } from '../../src/interact/tap.js';
import { lookOn } from '../../src/ui-tree/look.js';
import { usableScreen } from '../../src/ui-tree/usable-screen.js';
import { bandNode, dropBand, FAST, FakeAdapter, hidesKeyboardOn, iosLoginFake, node } from '../helpers/fake.js';

// The in-tree model's dismissal strategies (interact/keyboard-dismissal.ts): the configured ones, then — after a
// configured move left the keyboard up — averi's own upward drag, tried one move at a time
// (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md). Through the guard's interface
// (tapElement) on the lab's real form-keyboard capture, and through the strategy list's own (`nextMove`) for where the
// drag may touch down.
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));

/** The lab's form-keyboard cell as WDA read it (tests/fixtures/wda-capture-lab-form-keyboard.json's comment). */
const CAPTURE = readFileSync(new URL('../fixtures/wda-capture-lab-form-keyboard.json', import.meta.url), 'utf8');
const TITLE: KeyboardDismissal = { kind: 'tap', target: { text: 'Transfer details' } };
const VS = 'id:lab.form-keyboard.vs';
/** iOS's status band on the iPhone 17 (adapters/ios-status-band.ts), as IosAdapter's viewport reports it. */
const IPHONE_17 = { width: 402, height: 874, statusBand: 62 };

/**
 * What the app does on each move: `hides` the move that hides the keyboard (the title never does on the lab's cell — it
 * has no gesture); `lifts`, a drag that scrolls the form by its length, the keyboard staying (the lab's SwiftUI form,
 * measured live). Taps go to the tree's hit test only for the target.
 */
type Move = 'title' | 'drag';
function labFake({ hides, lifts = false }: { hides?: Move; lifts?: boolean } = {}): FakeAdapter & { moves: string[] } {
  const fake = Object.assign(new FakeAdapter({ form: parseWdaSource(CAPTURE) }, 'form'), { moves: [] as string[] });
  fake.platform = 'ios';
  fake.keyboard = undefined;
  fake.keyboardAdvice = 'ADVICE';
  fake.viewportSize = IPHONE_17;
  const hideIf = (m: Move) => {
    if (m === hides) dropKeyboard(fake.live());
  };
  const tap = fake.tap.bind(fake);
  fake.tap = async (x: number, y: number) => {
    if (y < 116) {
      fake.moves.push(`title (${x},${y})`);
      return hideIf('title');
    }
    fake.moves.push(`tap (${x},${y})`);
    return tap(x, y);
  };
  fake.swipe = async (from: Point, to: Point, durationMs?: number) => {
    fake.moves.push(`drag (${from.x},${from.y})→(${to.x},${to.y}) ${durationMs}ms`);
    hideIf('drag');
    if (lifts) for (const n of everyNode(fake.live())) if (n.identifier?.startsWith('lab.form-keyboard.')) n.rect.y -= from.y - to.y;
  };
  return fake;
}
/** The keyboard leaving the WDA tree: the band and its two Windows' marks go with it — dropBand on the Window that holds the band. */
const dropKeyboard = (live: UiNode): void => {
  for (const n of everyNode(live)) if (n.children.some((c) => c.role === 'keyboard')) dropBand(n);
};

const COVERED = 'the soft keyboard covered id:lab.form-keyboard.vs';

describe('the guard: when the configured dismissal leaves the keyboard up, averi drags the target\'s scroll view up (the lab form-keyboard capture, k2)', () => {
  it('a scroll view that keeps its keyboard: the title tapped, then the form dragged UP 120 pt at 240 pt/s from its blank point nearest the keyboard, which lifts vs above it — vs tapped where it now is; the note says where the drag went', async () => {
    const fake = labFake({ lifts: true });
    const result = await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] });
    expect(fake.moves).toEqual(['title (201,84)', 'drag (201,502)→(201,382) 500ms', 'tap (201,501)']);
    expect(result.keyboardHidden).toBe(
      `${COVERED}; tapped text:"Transfer details", the keyboard stayed up; dragged the target's scroll view up from (201,502) to (201,382), and the keyboard is still up but no longer over it`,
    );
  });

  it('a scroll view that hides its keyboard on a drag (onDrag, as Contacts): hidden by the drag, then vs tapped', async () => {
    const fake = labFake({ hides: 'drag' });
    const result = await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] });
    expect(fake.moves).toEqual(['title (201,84)', 'drag (201,502)→(201,382) 500ms', 'tap (201,621)']);
    expect(result.keyboardHidden).toBe(
      `${COVERED}; tapped text:"Transfer details", the keyboard stayed up; hidden by dragging the target's scroll view up from (201,502) to (201,382) before tapping`,
    );
  });

  it('a target deeper under the keyboard (note, centre 843): the drag lifts its centre above the keyboard\'s top, plus the pan\'s slop — 294 pt, not only DRAG_LENGTH — at the same speed, so it takes longer (k3)', async () => {
    const fake = labFake();
    await tapElement(fake, 'id:lab.form-keyboard.note', { ...FAST, dismissals: [TITLE] }).catch(() => undefined);
    expect(fake.moves.at(-1)).toBe('drag (201,502)→(201,208) 1225ms'); // 843 − (573 − 8) + 16 = 294 pt at 240 pt/s
  });

  it('the title already hides it: no drag at all', async () => {
    const fake = labFake({ hides: 'title' });
    await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] });
    expect(fake.moves).toEqual(['title (201,84)', 'tap (201,621)']);
  });

  it('nothing gets it clear: AfterDismissalTap naming every move, in order — the target never tapped, no move repeated', async () => {
    const fake = labFake();
    const error = (await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(fake.moves).toEqual(['title (201,84)', 'drag (201,502)→(201,382) 500ms']);
    expect(error.message).toBe(
      'Tapped text:"Transfer details" at (201,84), then dragged the target\'s scroll view up from (201,502) to (201,382) to hide the soft keyboard covering ' +
        'id:lab.form-keyboard.vs, but it is still up: the band [0,573][402,874] still contains the tap point ' +
        `(201,621) on ${KEYBOARD_HIDE_CONFIRM_LOOKS} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart after each; nothing else was done. Those moves may have changed the screen ` +
        '(the keyboard was raised again, an element tapped did something of its own, or a drag scrolled the content) — look at it (ui_snapshot / screenshot) before ' +
        'retrying. From the MCP tools: hide the keyboard another way, then tap id:lab.form-keyboard.vs again. In a flow: configure a dismissal that hides the keyboard ' +
        'on THIS screen, or lay the screen out so id:lab.form-keyboard.vs is not under it',
    );
    expect(error.traceLine).toBe(`${COVERED}; tapped text:"Transfer details", dragged the target's scroll view up to hide it, still covered`);
  });

  it('no dismissal configured: today\'s refusal, nothing moved (k1)', async () => {
    const fake = labFake({ hides: 'drag' });
    const error = (await tapElement(fake, VS, FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toContain('and no dismissal is configured. Nothing was tapped');
    expect(fake.moves).toEqual([]);
  });

  it('the configured title absent from the screen: the refusal, nothing moved — averi\'s own follow a configured move that left the keyboard up, never stand in for one', async () => {
    const fake = labFake({ hides: 'drag' });
    const error = (await tapElement(fake, VS, { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'nowhere' } }] }).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toContain('and none of the configured dismissals is usable on this screen (tap id:"nowhere": not found). Nothing was tapped');
    expect(fake.moves).toEqual([]);
  });

  it('the target gone after the title tap: AfterDismissalTap at once — no drag on a screen the target has left', async () => {
    const fake = labFake();
    const tap = fake.tap;
    fake.tap = async (x, y) => {
      await tap(x, y);
      for (const n of everyNode(fake.live())) n.children = n.children.filter((c) => c.identifier !== 'lab.form-keyboard.vs');
    };
    const error = (await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(fake.moves).toEqual(['title (201,84)']);
  });
});

/** A WDA-shaped screen: the app's window holding `content` under an identified navigation bar, and the band 0,573 402x301. */
const FULL: Rect = { x: 0, y: 0, width: 402, height: 874 };
const BAND: Rect = { x: 0, y: 573, width: 402, height: 301 };
const NAV = node({ role: 'container', identifier: 'Title', rect: { x: 0, y: 62, width: 402, height: 54 } });
const TARGET = () => node({ role: 'textfield', identifier: 'target', rect: { x: 20, y: 604, width: 362, height: 34 } });
function screenWith(content: UiNode[], after: UiNode[] = [], band: Rect = BAND): { tree: UiNode; target: UiNode } {
  const target = TARGET();
  const scroller = node({ role: 'scrollable', rect: FULL, children: [node({ role: 'container', rect: { x: 0, y: 116, width: 402, height: 764 }, children: [...content, target] })] });
  const tree = node({ role: 'container', rect: FULL, children: [node({ role: 'container', rect: FULL, children: [NAV, scroller, ...after] }), bandNode(band)] });
  return { tree, target };
}
/** Averi's own strategies on `tree`: the drag's from/to, or every skip line. */
async function dragOn({ tree, target }: { tree: UiNode; target: UiNode }): Promise<{ from: Point; to: Point } | readonly string[]> {
  const fake = new FakeAdapter({ s: tree }, 's');
  fake.keyboard = undefined;
  fake.viewportSize = IPHONE_17;
  const look = lookOn(fake, tree);
  const ground: DismissalGround = { look, screen: await usableScreen(fake, look), ambiguous: 'first', target };
  const { move, skipped } = await nextMove(AVERIS_OWN, ground);
  if (move === undefined) return skipped;
  if (move.move.kind !== 'drag') throw new Error('averi\'s own only drag');
  return { from: move.move.from, to: move.move.to };
}

describe('the drag: where it touches down and how far it goes (keyboard-dismissal.ts#blankPoint)', () => {
  it('from the lowest row above the keyboard whose square holds only bare wrappers, the middle of the row first, up DRAG_LENGTH', async () => {
    expect(await dragOn(screenWith([]))).toEqual({ from: { x: 201, y: 558 }, to: { x: 201, y: 438 } });
  });

  it('a text, a control or a labelled node in the square stops the point: the middle of the row is skipped for the nearest clear column, a full-width one pushes it to a higher row', async () => {
    const text = node({ role: 'text', label: 'Payment reference', rect: { x: 150, y: 556, width: 100, height: 18 } });
    expect(await dragOn(screenWith([text]))).toEqual({ from: { x: 137, y: 558 }, to: { x: 137, y: 438 } });
    const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 530, width: 402, height: 43 } });
    expect(await dragOn(screenWith([field]))).toEqual({ from: { x: 201, y: 518 }, to: { x: 201, y: 398 } });
  });

  it('a bare leaf INSIDE the scroll view is a spacer of its content (no stop); a bare leaf listed AFTER it, outside, is drawn over it (a dimming view) and stops every point it lies on', async () => {
    const spacer = node({ role: 'other', rect: { x: 0, y: 300, width: 402, height: 273 } });
    expect(await dragOn(screenWith([spacer]))).toEqual({ from: { x: 201, y: 558 }, to: { x: 201, y: 438 } });
    const dim = node({ role: 'other', rect: { x: 0, y: 300, width: 402, height: 273 } });
    expect(await dragOn(screenWith([], [dim]))).toEqual({ from: { x: 201, y: 286 }, to: { x: 201, y: 166 } });
  });

  it('a hidden subtree (WDA\'s isVisible=0, drawn nowhere — the SwiftUI screen-sized toolbar host) does not stop it', async () => {
    const host = node({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', hidden: true, rect: FULL, children: [node({ role: 'container', hidden: true, rect: FULL })] });
    expect(await dragOn(screenWith([], [host]))).toEqual({ from: { x: 201, y: 558 }, to: { x: 201, y: 438 } });
  });

  it('never past the status band: a lift longer than the room above stops at the area\'s top', async () => {
    // A keyboard (with an accessory bar) up to y 200: the target's centre 621 asks a lift of 621 − 192 + 16 = 445 pt.
    const { tree, target } = screenWith([], [], { x: 0, y: 200, width: 402, height: 674 });
    expect(await dragOn({ tree, target })).toEqual({ from: { x: 201, y: 190 }, to: { x: 201, y: 62 } });
  });

  it('a screen full of controls above the keyboard: no point, and the skip line says so', async () => {
    const wall = node({ role: 'button', identifier: 'wall', rect: { x: 0, y: 116, width: 402, height: 457 } });
    expect(await dragOn(screenWith([wall]))).toEqual(["a drag: none in the target's scroll view above the keyboard"]);
  });

  it('no scroll view holds the target: no drag — nothing to tie it to the target', async () => {
    const target = TARGET();
    const tree = node({ role: 'container', rect: FULL, children: [node({ role: 'container', rect: FULL, children: [NAV, target] }), bandNode(BAND)] });
    expect(await dragOn({ tree, target })).toEqual(['a drag: no scroll view holds the target']);
  });

  it('the target beneath something else (an alert\'s card over it, besides the keyboard): it cannot be tapped where it stands — no drag', async () => {
    const card = node({ role: 'button', label: 'OK', rect: { x: 0, y: 590, width: 402, height: 60 } });
    expect(await dragOn(screenWith([], [card]))).toEqual(['a drag: the target cannot be tapped where it stands (covered by button "OK")']);
  });

  it('a scroll view that scrolls sideways is never dragged', async () => {
    const { tree, target } = screenWith([]);
    [...everyNode(tree)].find((n) => n.role === 'scrollable')!.scrollAxis = 'horizontal';
    expect(await dragOn({ tree, target })).toEqual(["a drag: the target's scroll view scrolls sideways"]);
  });
});

describe('the configured ones, each its own strategy: a second is tried once the first, tapped, left the keyboard up (the measured login, no scroll view)', () => {
  const HEADING = { role: 'text', identifier: 'login_heading', label: 'Vitajte', rect: { x: 36, y: 250, width: 330, height: 24 } } as const;
  const twoTitles = () => {
    const fake = iosLoginFake({ onTap: hidesKeyboardOn('login_heading') });
    fake.live().children.unshift(node(HEADING));
    return fake;
  };
  const BOTH: KeyboardDismissal[] = [
    { kind: 'tap', target: { id: 'login_title' } },
    { kind: 'tap', target: { id: 'login_heading' } },
  ];

  it('the guard: the title, then the heading, then the target — the note names both', async () => {
    const fake = twoTitles();
    const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: BOTH });
    expect(fake.taps).toEqual(['login_title', 'login_heading', 'login_submit']);
    expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; tapped id:"login_title", the keyboard stayed up; hidden by tapping id:"login_heading" before tapping');
  });

  it('the post-fill dismissal: the same order, judged on the read that found the keyboard still up; `hiddenBy` names the move that hid it', async () => {
    const fake = twoTitles();
    expect(await dismissKeyboard(fake, { ambiguous: 'first', dismissals: BOTH })).toEqual({ hiddenBy: 'tapping id:"login_heading", after tapping id:"login_title" left it up' });
    expect(fake.taps).toEqual(['login_title', 'login_heading']);
  });
});

describe('the lists themselves', () => {
  it('the configured ones in the config\'s order; averi\'s own the drag alone — no tap of its own', () => {
    expect(configuredStrategies([TITLE, { kind: 'accessory' }]).map((s) => s.name)).toEqual(['tap text:"Transfer details"', 'accessory']);
    expect(AVERIS_OWN.map((s) => s.name)).toEqual(['a drag']);
  });
});
