import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { everyNode, type Point, type Rect, type UiNode } from '../../src/adapters/types.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { AfterDismissalTap, KeyboardWithoutDismissal, type KeyboardDismissal } from '../../src/interact/keyboard.js';
import { dismissalStrategies, nextMove, type DismissalGround } from '../../src/interact/keyboard-dismissal.js';
import { KEYBOARD_HIDE_CONFIRM_LOOKS } from '../../src/interact/keyboard-in-tree.js';
import { KEYBOARD_HIDE_DELAY_MS } from '../../src/interact/keyboard-model.js';
import { dismissKeyboard } from '../../src/interact/keyboard.js';
import { tapElement } from '../../src/interact/tap.js';
import { lookOn } from '../../src/ui-tree/look.js';
import { usableScreen } from '../../src/ui-tree/usable-screen.js';
import { bandNode, dropBand, FAST, FakeAdapter, hidesKeyboardOn, iosLoginFake, node } from '../helpers/fake.js';

// The in-tree model's dismissal strategies (interact/keyboard-dismissal.ts): the configured ones, then — some being
// configured — averi's own blank-point tap and drag, tried one move at a time until the keyboard is gone
// (docs/adr/0022-averi-hides-the-keyboard-when-the-configured-dismissal-does-not.md). Through the guard's interface
// (tapElement) on the lab's real form-keyboard capture, and through the strategy list's own (`nextMove`) for where a
// blank point may lie.
vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} }));

/** The lab's form-keyboard cell as WDA read it (tests/fixtures/wda-capture-lab-form-keyboard.json's comment). */
const CAPTURE = readFileSync(new URL('../fixtures/wda-capture-lab-form-keyboard.json', import.meta.url), 'utf8');
const TITLE: KeyboardDismissal = { kind: 'tap', target: { text: 'Transfer details' } };
const VS = 'id:lab.form-keyboard.vs';
/** iOS's status band on the iPhone 17 (adapters/ios-status-band.ts), as IosAdapter's viewport reports it. */
const IPHONE_17 = { width: 402, height: 874, statusBand: 62 };

/** What the app does on each move: `hides` the move that hides the keyboard (the title never does — it has no gesture, the lab's cell); taps go to the tree's hit test only for the target. */
type Move = 'title' | 'blank' | 'drag';
function labFake(hides?: Move): FakeAdapter & { moves: string[] } {
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
    if (y < 573 && x > 0 && !isField(fake.live(), { x, y })) {
      fake.moves.push(`blank (${x},${y})`);
      return hideIf('blank');
    }
    fake.moves.push(`tap (${x},${y})`);
    return tap(x, y);
  };
  fake.swipe = async (from: Point, to: Point, durationMs?: number) => {
    fake.moves.push(`drag (${from.x},${from.y})→(${to.x},${to.y}) ${durationMs}ms`);
    hideIf('drag');
  };
  return fake;
}
/** The keyboard leaving the WDA tree: the band and its two Windows' marks go with it — dropBand on the Window that holds the band. */
const dropKeyboard = (live: UiNode): void => {
  for (const n of everyNode(live)) if (n.children.some((c) => c.role === 'keyboard')) dropBand(n);
};
const isField = (tree: UiNode, p: Point): boolean =>
  [...everyNode(tree)].some((n) => n.role === 'textfield' && p.x >= n.rect.x && p.x < n.rect.x + n.rect.width && p.y >= n.rect.y && p.y < n.rect.y + n.rect.height);

const COVERED = 'the soft keyboard covered id:lab.form-keyboard.vs';

describe('the guard: when the configured dismissal leaves the keyboard up, averi tries its own (the lab form-keyboard capture, k2)', () => {
  it('a blank point of the target\'s scroll view hides it: the title tapped, then the blank point just under the navigation bar, then the target at its centre — the note says which move hid it', async () => {
    const fake = labFake('blank');
    const result = await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] });
    expect(fake.moves).toEqual(['title (201,84)', 'blank (201,126)', 'tap (201,621)']);
    expect(fake.swipes).toEqual([]);
    const note = `${COVERED}; tapped text:"Transfer details", the keyboard stayed up; hidden by tapping a blank point of the target's scroll view before tapping`;
    expect(result.keyboardHidden).toBe(note);
  });

  it('the blank point leaves it up too: the target\'s scroll view is dragged UP, slowly, from its blank point nearest the keyboard (a downward drag would pull a sheet down); then the target', async () => {
    const fake = labFake('drag');
    const result = await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] });
    expect(fake.moves).toEqual(['title (201,84)', 'blank (201,126)', 'drag (201,502)→(201,382) 500ms', 'tap (201,621)']);
    expect(result.keyboardHidden).toBe(
      `${COVERED}; tapped text:"Transfer details", tapped a blank point of the target's scroll view, the keyboard stayed up; hidden by dragging the target's scroll view up before tapping`,
    );
  });

  it('a target deeper under the keyboard (note, centre 843): the drag is long enough to lift its centre above the keyboard\'s top, not only DRAG_LENGTH — so a scroll view that keeps its keyboard still brings the target out (k3)', async () => {
    const fake = labFake();
    await tapElement(fake, 'id:lab.form-keyboard.note', { ...FAST, dismissals: [TITLE] }).catch(() => undefined);
    expect(fake.moves.at(-1)).toBe('drag (201,502)→(201,224) 500ms'); // 843 − (573 − 8) = 278 pt
  });

  it('nothing hides it: AfterDismissalTap naming every move, in order — the target never tapped, no move repeated', async () => {
    const fake = labFake();
    const error = (await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(fake.moves).toEqual(['title (201,84)', 'blank (201,126)', 'drag (201,502)→(201,382) 500ms']);
    expect(error.message).toBe(
      'Tapped text:"Transfer details" at (201,84), then tapped a blank point of the target\'s scroll view at (201,126), then dragged the target\'s scroll view up ' +
        'from (201,502) to (201,382) to hide the soft keyboard covering id:lab.form-keyboard.vs, but it is still up: the band [0,573][402,874] still contains the tap point ' +
        `(201,621) on ${KEYBOARD_HIDE_CONFIRM_LOOKS} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart after each; nothing else was done. Those moves may have changed the screen ` +
        '(the keyboard was raised again, an element tapped did something of its own, or a drag scrolled the content) — look at it (ui_snapshot / screenshot) before ' +
        'retrying. From the MCP tools: hide the keyboard another way, then tap id:lab.form-keyboard.vs again. In a flow: configure a dismissal that hides the keyboard ' +
        'on THIS screen, or lay the screen out so id:lab.form-keyboard.vs is not under it',
    );
    expect(error.traceLine).toBe(`${COVERED}; tapped text:"Transfer details", tapped a blank point of the target's scroll view, dragged the target's scroll view up to hide it, still covered`);
  });

  it('no dismissal configured: today\'s refusal, nothing moved — averi\'s own are tried only where the author opted into dismissals (k1)', async () => {
    const fake = labFake('blank');
    const error = (await tapElement(fake, VS, FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toContain('and no dismissal is configured. Nothing was tapped');
    expect(fake.moves).toEqual([]);
    expect(fake.swipes).toEqual([]);
  });

  it('the configured title absent from the screen: averi\'s own are still tried — the refusal it would have been is a blank-point tap that hides it', async () => {
    const fake = labFake('blank');
    const result = await tapElement(fake, VS, { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'nowhere' } }] });
    expect(fake.moves).toEqual(['blank (201,126)', 'tap (201,621)']);
    expect(result.keyboardHidden).toBe(`${COVERED}; hidden by tapping a blank point of the target's scroll view before tapping`);
  });

  it('the target gone after the blank point (the tap did something of its own): AfterDismissalTap at once, saying both taps — no drag on a screen the target has left', async () => {
    const fake = labFake();
    const tap = fake.tap;
    fake.tap = async (x, y) => {
      await tap(x, y);
      if (fake.moves.at(-1)?.startsWith('blank')) for (const n of everyNode(fake.live())) n.children = n.children.filter((c) => c.identifier !== 'lab.form-keyboard.vs');
    };
    const error = (await tapElement(fake, VS, { ...FAST, dismissals: [TITLE] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(error.message.split('\n')[0]).toMatch(
      /^After tapping text:"Transfer details" at \(201,84\), then tapping a blank point of the target's scroll view at \(201,126\) to hide the soft keyboard that covered id:lab\.form-keyboard\.vs at \(201,621\): Timed out .* Those moves may have changed the screen/,
    );
    expect(fake.moves).toEqual(['title (201,84)', 'blank (201,126)']);
    expect(fake.swipes).toEqual([]);
  });
});

/** A WDA-shaped screen: the app's window holding `content` under an identified navigation bar, and the band 0,573 402x301. */
const FULL: Rect = { x: 0, y: 0, width: 402, height: 874 };
const BAND: Rect = { x: 0, y: 573, width: 402, height: 301 };
const NAV = node({ role: 'container', identifier: 'Title', rect: { x: 0, y: 62, width: 402, height: 54 } });
const TARGET = () => node({ role: 'textfield', identifier: 'target', rect: { x: 20, y: 604, width: 362, height: 34 } });
function screenWith(content: UiNode[], after: UiNode[] = []): { tree: UiNode; target: UiNode } {
  const target = TARGET();
  const scroller = node({ role: 'scrollable', rect: FULL, children: [node({ role: 'container', rect: { x: 0, y: 116, width: 402, height: 764 }, children: [...content, target] })] });
  const tree = node({ role: 'container', rect: FULL, children: [node({ role: 'container', rect: FULL, children: [NAV, scroller, ...after] }), bandNode(BAND)] });
  return { tree, target };
}
/** The first move of averi's own strategies on `tree`, the configured one absent: its point, or every skip line. */
async function blankOn({ tree, target }: { tree: UiNode; target: UiNode }, device = IPHONE_17): Promise<Point | string[]> {
  const fake = new FakeAdapter({ s: tree }, 's');
  fake.keyboard = undefined;
  fake.viewportSize = device;
  const look = lookOn(fake, tree);
  const ground: DismissalGround = { look, screen: await usableScreen(fake, look), ambiguous: 'first', target };
  const { move, skipped } = await nextMove(dismissalStrategies([{ kind: 'tap', target: { id: 'absent' } }], { fallbacks: true }), ground);
  if (move === undefined) return skipped.map((s) => s.line);
  if (move.move.kind !== 'tap') throw new Error('a drag before a blank tap');
  return move.move.at;
}

describe('a blank point: where averi\'s own tap may land (keyboard-dismissal.ts#blankPoint)', () => {
  it('the first row whose square holds only bare wrappers, below the status band and the identified navigation bar, from the middle of the row outward', async () => {
    expect(await blankOn(screenWith([]))).toEqual({ x: 201, y: 126 });
  });

  it('a text, a control or a labelled node in the square stops the point: the middle of the row is skipped for the nearest clear column, a full-width one pushes it to the next row', async () => {
    const text = node({ role: 'text', label: 'Payment reference', rect: { x: 150, y: 120, width: 100, height: 18 } });
    expect(await blankOn(screenWith([text]))).toEqual({ x: 137, y: 126 });
    const field = node({ role: 'textfield', identifier: 'f', rect: { x: 0, y: 116, width: 402, height: 40 } });
    expect(await blankOn(screenWith([field]))).toEqual({ x: 201, y: 166 });
  });

  it('a bare leaf INSIDE the scroll view is a spacer of its content (no stop); a bare leaf listed AFTER it, outside, is drawn over it (a dimming view) and stops every point it lies on', async () => {
    const spacer = node({ role: 'other', rect: { x: 0, y: 116, width: 402, height: 400 } });
    expect(await blankOn(screenWith([spacer]))).toEqual({ x: 201, y: 126 });
    const dim = node({ role: 'other', rect: { x: 0, y: 116, width: 402, height: 400 } });
    expect(await blankOn(screenWith([], [dim]))).toEqual({ x: 201, y: 526 });
  });

  it('a hidden subtree (WDA\'s isVisible=0, drawn nowhere — the SwiftUI screen-sized toolbar host) does not stop it', async () => {
    const host = node({ role: 'toolbar', label: 'Toolbar', identifier: 'Toolbar', hidden: true, rect: FULL, children: [node({ role: 'container', hidden: true, rect: FULL })] });
    expect(await blankOn(screenWith([], [host]))).toEqual({ x: 201, y: 126 });
  });

  it('never in the band or under the status band: a screen full of controls above the keyboard has no blank point, and says so — the drag none either', async () => {
    const wall = node({ role: 'button', identifier: 'wall', rect: { x: 0, y: 116, width: 402, height: 457 } });
    expect(await blankOn(screenWith([wall]))).toEqual([
      'tap id:"absent": not found',
      "a blank point: none in the target's scroll view above the keyboard",
      'a drag: no blank point to drag from',
    ]);
  });

  it('no scroll view holds the target: none — averi taps no point of a screen it cannot tie to the target', async () => {
    const target = TARGET();
    const tree = node({ role: 'container', rect: FULL, children: [node({ role: 'container', rect: FULL, children: [NAV, target] }), bandNode(BAND)] });
    expect(await blankOn({ tree, target })).toEqual(['tap id:"absent": not found', 'a blank point: no scroll view holds the target', 'a drag: no blank point to drag from']);
  });

  it('the target beneath something else (an alert\'s card over it, besides the keyboard): it cannot be tapped where it stands — no point is sought', async () => {
    const card = node({ role: 'button', label: 'OK', rect: { x: 0, y: 590, width: 402, height: 60 } });
    const skipped = await blankOn(screenWith([], [card]));
    expect(skipped).toEqual(['tap id:"absent": not found', 'a blank point: the target cannot be tapped where it stands (covered by button "OK")', 'a drag: no blank point to drag from']);
  });

  it('a scroll view that scrolls sideways is tapped at its blank point but never dragged', async () => {
    const { tree, target } = screenWith([]);
    const scroller = [...everyNode(tree)].find((n) => n.role === 'scrollable')!;
    scroller.scrollAxis = 'horizontal';
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.keyboard = undefined;
    fake.viewportSize = IPHONE_17;
    const look = lookOn(fake, tree);
    const ground: DismissalGround = { look, screen: await usableScreen(fake, look), ambiguous: 'first', target };
    const [, ...own] = dismissalStrategies([TITLE], { fallbacks: true });
    const first = await nextMove(own, ground);
    expect(first.move?.move).toEqual({ kind: 'tap', what: "a blank point of the target's scroll view", at: { x: 201, y: 126 } });
    const second = await nextMove(first.move!.rest, ground);
    expect(second).toEqual({ skipped: [{ line: "a drag: the target's scroll view scrolls sideways", origin: 'fallback' }] });
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

describe('the list itself', () => {
  it('averi\'s own follow the configured ones, and only when some are configured and the caller can anchor them (the guard; never the post-fill dismissal)', () => {
    const names = (list: ReturnType<typeof dismissalStrategies>) => list.map((s) => `${s.origin}:${s.name}`);
    expect(names(dismissalStrategies([TITLE, { kind: 'accessory' }], { fallbacks: true }))).toEqual([
      'configured:tap text:"Transfer details"',
      'configured:accessory',
      'fallback:a blank point',
      'fallback:a drag',
    ]);
    expect(names(dismissalStrategies([], { fallbacks: true }))).toEqual([]);
    expect(names(dismissalStrategies([TITLE], { fallbacks: false }))).toEqual(['configured:tap text:"Transfer details"']);
  });
});
