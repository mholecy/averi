import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { fillField } from '../../src/interact/fill.js';
import {
  AfterDismissalTap,
  AfterKeyboardDismissal,
  KEYBOARD_DISAGREEMENT_BUDGET_MS,
  KEYBOARD_DISAGREEMENT_POLL_MS,
  KEYBOARD_HIDE_CONFIRM_LOOKS,
  KEYBOARD_HIDE_DELAY_MS,
  KeyboardStateDisagreement,
  KeyboardWithoutDismissal,
  afterBack,
  dismissKeyboard,
  dismissal,
  firstLook,
  inTreeLook,
  recheck,
  resolveClearOfKeyboard,
  windowOver,
  type KeyboardDismissal,
} from '../../src/interact/keyboard.js';
import { tapElement } from '../../src/interact/tap.js';
import { AmbiguityRefusal } from '../../src/interact/resolve.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';
import { readFile } from 'node:fs/promises';
import { parseWdaSource } from '../../src/adapters/wda-source.js';

// The one sleep owner (util/sleep.ts) is recorded, not waited on (as in
// fill.test.ts): the pause after `back` is asserted as a delay in a sequence.
const { sleeps } = vi.hoisted(() => ({ sleeps: [] as number[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
}));
beforeEach(() => {
  sleeps.length = 0;
});

const FAST = { ambiguous: 'first' as const, timeoutMs: 200, pollMs: 2 };

/**
 * The measured screen (finportal login, Pixel_3a, 1080x2220, 2026-10-03), in
 * its real pixels: the keyboard raised by the password fill covers y ≥ 1285,
 * `login_submit` (centre 249,1466) lies under it, the password field (centre
 * 540,1166) does not. `back` hides the keyboard (the fake's own reaction) and
 * the activity re-lays-out, as an adjustResize one does: the button moves
 * down to y=1700 (centre 249,1766).
 */
const KEYBOARD: Rect = { x: 0, y: 1285, width: 1080, height: 935 };
const SUBMIT_AFTER_RESIZE_Y = 1700;

function loginFake() {
  const fake = new FakeAdapter(
    {
      login: node({
        role: 'container',
        rect: { x: 0, y: 0, width: 1080, height: 2220 },
        children: [
          node({ role: 'textfield', identifier: 'login_password', rect: { x: 99, y: 1100, width: 882, height: 132 } }),
          node({ role: 'button', identifier: 'login_submit', rect: { x: 99, y: 1400, width: 300, height: 132 } }),
        ],
      }),
    },
    'login',
  );
  fake.attachKeyboard({ state: 'shown', frame: KEYBOARD }, 'shown'); // a keyboard that is really up: both sources say so
  fake.onKey = (key, self) => {
    if (key === 'back') submit(self).rect.y = SUBMIT_AFTER_RESIZE_Y;
  };
  return fake;
}
const submit = (fake: FakeAdapter): UiNode => fake.live().children[1];

/** One ordered log of everything the guard does to the device — and asks of its keyboard oracle, when it has one. */
function recorded(fake: FakeAdapter) {
  const events: string[] = [];
  const wrap = <T extends object, K extends keyof T>(on: T, name: K, label: (...args: never[]) => string) => {
    const real = (on[name] as (...args: unknown[]) => Promise<unknown>).bind(on);
    (on as unknown as Record<string, unknown>)[name as string] = async (...args: unknown[]) => {
      events.push((label as (...a: unknown[]) => string)(...args));
      return real(...args);
    };
  };
  wrap(fake, 'uiTree', () => 'read');
  if (fake.keyboard !== undefined) {
    wrap(fake.keyboard, 'state', () => 'keyboard?');
    wrap(fake.keyboard, 'witness', () => 'witness?');
  }
  wrap(fake, 'pressKey', (key: string) => `key:${key}`);
  wrap(fake, 'tap', (x: number, y: number) => `tap:${x},${y}`);
  return events;
}

const NOTE = 'the soft keyboard covered id:login_submit; hidden before tapping';

describe('tapElement — a target under the Android soft keyboard is not tapped through it', () => {
  it('target OUTSIDE the keyboard frame: one keyboard query, no back, the tap lands on the point first resolved, no note', async () => {
    const fake = loginFake();
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_password', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'tap:540,1166']);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0); // the independent witness is never asked on an ordinary tap
    expect(fake.keys).toEqual([]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
    expect(sleeps).toEqual([FAST.pollMs]); // the settle pause only
  });

  it('target INSIDE the frame: back once, the hide delay, the target resolved AGAIN, a second query, then the tap at the NEW centre — and the note says so', async () => {
    const fake = loginFake();
    const events = recorded(fake);
    let sleptBeforeBack: number[] | undefined;
    const move = fake.onKey!;
    fake.onKey = (key, self) => {
      sleptBeforeBack = [...sleeps];
      move(key, self);
    };
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'key:back', 'read', 'read', 'keyboard?', 'tap:249,1766']);
    expect(sleptBeforeBack).toEqual([FAST.pollMs]); // the hide delay comes AFTER the key press, not before it
    expect(fake.tapPoints).toEqual([{ x: 249, y: SUBMIT_AFTER_RESIZE_Y + 66 }]); // not the stale (249,1466)
    expect(result).toEqual({ note: NOTE, keyboardHidden: NOTE });
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
  });

  it('a keyboard that STAYS after the one dismissal: nothing is tapped, back is not pressed twice, and the error says how to recover', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD }; // back did not hide it, and nothing re-laid-out
    };
    const error = await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AfterKeyboardDismissal);
    expect((error as AfterKeyboardDismissal).message).toBe(
      'Pressed back to hide the soft keyboard covering id:login_submit, but back did not close it: the keyboard frame ' +
        '[0,1285][1080,2220] still contains the tap point (249,1466); nothing was tapped. From the MCP tools: inspect ' +
        'the screen with ui_snapshot, then press_key back once more or tap a control above the keyboard. In a flow: ' +
        'no step can recover this — the screen keeps a keyboard that back does not close over id:login_submit — fix the ' +
        'screen (or the test data) so the target is not under the keyboard',
    );
    expect((error as AfterKeyboardDismissal).backPressed).toBe('the soft keyboard covered id:login_submit; back pressed');
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual(['back']);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(2);
  });

  it('the keyboard is gone but the layout did NOT move (adjustPan / adjustNothing): the tap lands on the same point, now uncovered', async () => {
    const fake = loginFake();
    fake.onKey = undefined;
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
    expect(result.keyboardHidden).toBe(NOTE);
  });

  it('the frame is half-open like a rect: a centre ON its top edge is covered, one pixel above is not', async () => {
    const at = async (y: number) => {
      const fake = loginFake();
      submit(fake).rect = { x: 99, y, width: 300, height: 132 }; // centre y + 66
      await tapElement(fake, 'id:login_submit', FAST);
      return fake.keys;
    };
    expect(await at(KEYBOARD.y - 66)).toEqual(['back']); // centre y = 1285
    expect(await at(KEYBOARD.y - 67)).toEqual([]); // centre y = 1284
  });

  it('a point beside a keyboard that does not span the screen (floating / split) is not covered', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: { x: 500, y: 1285, width: 580, height: 935 } };
    await tapElement(fake, 'id:login_submit', FAST); // centre x = 249 < 500
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
  });

  it.each([['hidden'], ['unknown']] as const)('keyboard %s: one query, no back, the tap as before', async (state) => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state };
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('a keyboard the second query cannot read (unknown) fails open — the point is tapped — but the note does not claim it was hidden', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'unknown' };
    };
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.taps).toEqual(['login_submit']);
    const sentence = "the soft keyboard covered id:login_submit; back pressed; the keyboard's state afterwards could not be read";
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
  });

  it('all four edges: left and top inclusive, right (x+width) and bottom (y+height) exclusive', async () => {
    const at = async (x: number, y: number) => {
      const fake = loginFake();
      fake.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: { x: 160, y: 1285, width: 240, height: 300 } }; // covers x in [160,400), y in [1285,1585)
      submit(fake).rect = { x: x - 150, y: y - 66, width: 300, height: 132 }; // centre exactly (x,y)
      await tapElement(fake, 'id:login_submit', FAST);
      return fake.keys;
    };
    expect(await at(160, 1400)).toEqual(['back']); // first covered column
    expect(await at(159, 1400)).toEqual([]);
    expect(await at(200, 1285)).toEqual(['back']); // first covered row
    expect(await at(200, 1284)).toEqual([]);
    expect(await at(399, 1400)).toEqual(['back']); // last covered column
    expect(await at(400, 1400)).toEqual([]); // x + width: outside
    expect(await at(200, 1584)).toEqual(['back']); // last covered row
    expect(await at(200, 1585)).toEqual([]); // y + height: outside
  });

  it('an adapter WITHOUT the keyboard oracle (iOS): nothing is asked, no key is pressed, the tap lands where the target resolved — the guard has no platform branch', async () => {
    const fake = loginFake();
    fake.platform = 'ios';
    fake.keyboard = undefined; // as IosAdapter (tests/adapters/ios.test.ts): no oracle, no device query
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'tap:249,1466']);
    expect(fake.keys).toEqual([]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('the oracle alone decides, not the platform: whatever adapter says "shown" over the point gets the dismissal', async () => {
    const fake = loginFake();
    fake.platform = 'ios'; // no real iOS adapter has an oracle; the policy does not look at the label
    await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.keys).toEqual(['back']);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1766 }]);
  });

  it('the resolution note of the node actually tapped is kept, with the keyboard sentence after it', async () => {
    const fake = loginFake();
    fake.live().children.push(node({ role: 'text', identifier: 'login_submit', label: 'Sign in', rect: { x: 99, y: 1000, width: 300, height: 40 } }));
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(result.note).toBe(`2 matches; picked the only interactive one (button); ${NOTE}`);
    expect(result.keyboardHidden).toBe(NOTE);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1766 }]);
  });

  it('the second resolution uses the SAME options: in refuse mode a second interactive match revealed by the dismissal is refused, and nothing is tapped', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.live().children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 600, y: 1700, width: 300, height: 132 } }));
    };
    await expect(tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse' })).rejects.toThrow(/Selector matches 2 elements: id:login_submit/);
    expect(fake.taps).toEqual([]);
  });

  it('the refusal on the second look keeps its FIRST line (the headline) and says below it that back was pressed', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.live().children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 600, y: 1700, width: 300, height: 132 } }));
    };
    const error = (await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse' }).catch((e: unknown) => e)) as AfterKeyboardDismissal;
    expect(error).toBeInstanceOf(AfterKeyboardDismissal);
    const lines = error.message.split('\n');
    expect(lines[0]).toBe('Selector matches 2 elements: id:login_submit');
    expect(lines.at(-1)).toBe(
      '(This was the second look, after pressing back to hide the soft keyboard that covered id:login_submit at (249,1466). ' +
        'If no keyboard was really up at that moment, back may have navigated away — check the screen (ui_snapshot / screenshot))',
    );
    expect(error.backPressed).toBe('the soft keyboard covered id:login_submit; back pressed');
    expect((error.cause as Error).message).toMatch(/^Selector matches 2 elements/);
  });

  /** A second screen for `back` to navigate to when no keyboard is really up. */
  function raceFake() {
    const fake = loginFake();
    const login = fake.live();
    const raced = new FakeAdapter({ login, previous: screen(node({ role: 'text', identifier: 'previous_title' })) }, 'login');
    raced.backTo = 'previous';
    raced.attachKeyboard({ state: 'unknown' }, 'shown'); // the witness wrong too, for this test: the worst case, both sources stale
    return raced;
  }
  const TIMEOUT_AFTER_BACK =
    'After pressing back to hide the soft keyboard that covered id:login_submit at (249,1466): Timed out after 200ms ' +
    'waiting for element id:login_submit (visible and settled). If no keyboard was really up at that moment, back may ' +
    'have navigated away — check the screen (ui_snapshot / screenshot)';

  it('the RACE: shown at query time, gone by the key press — back navigates away, and the failure says back was pressed', async () => {
    const fake = raceFake();
    fake.attachedKeyboard.state = async () => ({ state: 'shown', frame: KEYBOARD }); // what the adapter saw; fake.keyboard is not shown, so back navigates
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as AfterKeyboardDismissal;
    expect(fake.current).toBe('previous');
    expect(error).toBeInstanceOf(AfterKeyboardDismissal);
    expect(error.message).toBe(TIMEOUT_AFTER_BACK);
    expect(error.backPressed).toBe('the soft keyboard covered id:login_submit; back pressed');
    expect((error.cause as Error).message).toBe('Timed out after 200ms waiting for element id:login_submit (visible and settled)');
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual(['back']);
  });

  it('when the witness COULD NOT BE ASKED (the fallback pressed back on the window state alone) the failure says so', async () => {
    const fake = raceFake();
    fake.attachedKeyboard.state = async () => ({ state: 'shown', frame: KEYBOARD });
    fake.attachedKeyboard.witnessAnswers.current = 'unknown';
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(
      'After pressing back to hide the soft keyboard that covered id:login_submit at (249,1466): Timed out after 200ms ' +
        'waiting for element id:login_submit (visible and settled). If no keyboard was really up at that moment (the input ' +
        'method could not be asked whether a keyboard was shown), back may have navigated away — check the screen ' +
        '(ui_snapshot / screenshot)',
    );
    expect(fake.keys).toEqual(['back']);
  });

  it('the target VANISHES after a real dismissal: the same wording — the timeout is never bare', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.live().children.pop(); // the button is gone once the keyboard is
    };
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(TIMEOUT_AFTER_BACK);
    expect(fake.taps).toEqual([]);
  });

  it('a timeout that quotes a dead tree read keeps that line beneath the prefixed headline', async () => {
    const fake = loginFake();
    fake.onKey = (_key, self) => {
      self.uiTree = async () => {
        throw new Error('device offline');
      };
    };
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as Error;
    expect(error.message.split('\n')).toEqual([TIMEOUT_AFTER_BACK, '  (last UI tree read failed: device offline)']);
  });

  it('an ElementSpec target is named in the flow vocabulary', async () => {
    const fake = loginFake();
    const { keyboardHidden } = await resolveClearOfKeyboard(fake, { id: 'login_submit' }, FAST);
    expect(keyboardHidden).toBe('the soft keyboard covered id:"login_submit"; hidden before tapping');
  });
});

describe('the independent witness vetoes the back — and a disagreement is re-checked, never acted on (2026-10-04)', () => {
  const POLL = KEYBOARD_DISAGREEMENT_POLL_MS;
  const DISAGREEMENT = 'the window state reported a soft keyboard over id:login_submit that the input method denied';
  const SHOWN = { state: 'shown' as const, frame: KEYBOARD };

  /** The stale case: the window state says shown over the target, the input method says none is shown. */
  function staleFake() {
    const fake = loginFake();
    fake.attachedKeyboard.witnessAnswers.current = 'hidden';
    return fake;
  }

  const REFUSAL = (inputMethod: string, point = '(249,1466)') =>
    `The window state reports a soft keyboard over id:login_submit — its frame [0,1285][1080,2220] contains the tap point ${point} — ` +
    `but ${inputMethod}. Neither back nor the tap was sent: back would navigate away if no keyboard is up, and the tap would press a ` +
    'key if one is. From the MCP tools: look at the screen (ui_snapshot / screenshot), then tap again, or press_key back yourself if ' +
    'a keyboard is visibly up. In a flow: wait for an element or state that only holds once the screen has settled after the previous ' +
    'step (wait: { element: … } / wait: { state: … }), or fix the screen so the target is not under a keyboard — no flow step waits ' +
    'on the keyboard itself';

  it('the budget is 3 s in 500 ms rounds — six rounds', () => {
    expect([POLL, KEYBOARD_DISAGREEMENT_BUDGET_MS]).toEqual([500, 3_000]);
  });

  it('window shown + covered + witness SHOWN: back, re-resolve, tap, the note as before', async () => {
    const fake = loginFake();
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'key:back', 'read', 'read', 'keyboard?', 'tap:249,1766']);
    expect(result).toEqual({ note: NOTE, keyboardHidden: NOTE });
  });

  it('vetoed, and the window state CLEARS on the first re-check: no key, one 500 ms wait, the target resolved again, the tap, and a note that explains the delay', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, { state: 'hidden' }];
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'keyboard?', 'read', 'read', 'tap:249,1466']);
    expect(fake.keys).toEqual([]);
    expect(sleeps).toEqual([FAST.pollMs, POLL, FAST.pollMs]);
    const sentence = `${DISAGREEMENT}; waited 500ms for it to clear`;
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
  });

  it('vetoed, clearing on the THIRD re-check: three waits, the witness asked again while it still covers, and the tap lands where the target is NOW', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, SHOWN, SHOWN, { state: 'hidden' }];
    const events = recorded(fake);
    let checks = 0;
    const ask = fake.attachedKeyboard.state;
    fake.attachedKeyboard.state = async () => {
      if (++checks === 4) submit(fake).rect.y = 1500; // the screen moved while averi waited
      return ask.call(fake.attachedKeyboard);
    };
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'keyboard?', 'witness?', 'keyboard?', 'witness?', 'keyboard?', 'read', 'read', 'tap:249,1566']);
    expect(sleeps).toEqual([FAST.pollMs, POLL, POLL, POLL, FAST.pollMs]);
    expect(fake.keys).toEqual([]);
    expect(result.keyboardHidden).toBe(`${DISAGREEMENT}; waited 1500ms for it to clear`);
  });

  it('vetoed, then the frame MOVES off the point (still shown, elsewhere): that is clear too', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, { state: 'shown', frame: { ...KEYBOARD, y: 1900, height: 320 } }];
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual(['login_submit']);
    expect(result.keyboardHidden).toBe(`${DISAGREEMENT}; waited 500ms for it to clear`);
  });

  it('vetoed, then the window state turns UNKNOWN: fail open — the tap goes ahead — and the note does not claim it cleared', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, SHOWN, { state: 'unknown' }];
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1466 }]);
    expect(result.keyboardHidden).toBe(`${DISAGREEMENT}; waited 1000ms, then the window state could not be read`);
  });

  it('vetoed, then the witness FLIPS to shown: back once, and the normal confirmed path — hide delay, second look, re-check — with the wait in the note', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'hidden', 'shown'];
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual([
      'read', 'read', 'keyboard?', 'witness?', // vetoed
      'keyboard?', 'witness?', // still disagreeing
      'keyboard?', 'witness?', 'key:back', // the witness now confirms
      'read', 'read', 'keyboard?', 'tap:249,1766',
    ]);
    expect(sleeps).toEqual([FAST.pollMs, POLL, POLL, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
    expect(fake.keys).toEqual(['back']);
    const sentence = `${NOTE} (after waiting 1000ms for the input method to confirm it)`;
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
  });

  it('vetoed, and the witness turns SHOWN only on the LAST round (3000ms): back, not a refusal — the normal confirmed path, with the full wait in the note', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'shown']; // the first ask, then six rounds
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.keys).toEqual(['back']);
    expect(fake.taps).toEqual(['login_submit']);
    expect(sleeps.filter((ms) => ms === POLL)).toHaveLength(6);
    const sentence = `${NOTE} (after waiting ${KEYBOARD_DISAGREEMENT_BUDGET_MS}ms for the input method to confirm it)`;
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
  });

  it('vetoed, then the witness CANNOT BE ASKED: that confirms nothing — no back; the wait goes on to its end', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.witnessAnswers.queue = ['hidden', 'unknown'];
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardStateDisagreement;
    expect(error).toBeInstanceOf(KeyboardStateDisagreement);
    // …and the refusal does not claim an answer the input method did not give at the end.
    expect(error.message).toBe(
      REFUSAL('the input method said none was shown at first, then could not be asked, and nothing had confirmed a keyboard after 3000ms'),
    );
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual([]);
  });

  /** The frame leaves the original point (249,1466) but the layout moves the target under where it now is. */
  function movingFake() {
    const fake = staleFake();
    const LOW = { state: 'shown' as const, frame: { x: 0, y: 1700, width: 1080, height: 520 } };
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, LOW];
    let checks = 0;
    const ask = fake.attachedKeyboard.state;
    fake.attachedKeyboard.state = async () => {
      if (++checks === 2) submit(fake).rect.y = 1800; // centre (249,1866): under the frame's new place
      return ask.call(fake.attachedKeyboard);
    };
    return fake;
  }

  it('the frame leaves the old point but the target has MOVED under it: no tap on that round — the wait goes on with the new point, and refuses at the budget naming it', async () => {
    const fake = movingFake();
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardStateDisagreement;
    expect(error).toBeInstanceOf(KeyboardStateDisagreement);
    expect(error.message).toBe(
      REFUSAL('the input method says no keyboard is shown, and the two still disagreed after 3000ms', '(249,1866)').replace(
        '[0,1285][1080,2220]',
        '[0,1700][1080,2220]',
      ),
    );
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
    expect(sleeps.filter((ms) => ms === POLL)).toHaveLength(6); // the same budget, not a fresh one
  });

  it('…and taps once the frame is clear of the NEW point', async () => {
    const fake = movingFake();
    fake.attachedKeyboard.windowAnswers.queue.push({ state: 'shown', frame: { x: 0, y: 1700, width: 1080, height: 520 } }, { state: 'hidden' });
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.tapPoints).toEqual([{ x: 249, y: 1866 }]);
    expect(fake.keys).toEqual([]);
    expect(result.keyboardHidden).toBe(`${DISAGREEMENT}; waited 1500ms for it to clear`);
  });

  it('STILL disagreeing when the budget ends: the refusal — no key, no tap, six rounds, and a message that says what each source said and what to do', async () => {
    const fake = staleFake();
    const events = recorded(fake);
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardStateDisagreement;
    expect(error).toBeInstanceOf(KeyboardStateDisagreement);
    expect(error).not.toBeInstanceOf(AfterKeyboardDismissal); // no back was pressed
    expect(error.message).toBe(REFUSAL('the input method says no keyboard is shown, and the two still disagreed after 3000ms'));
    expect(error.traceLine).toBe(`${DISAGREEMENT}; nothing sent`);
    expect(fake.keys).toEqual([]);
    expect(fake.taps).toEqual([]);
    expect(sleeps).toEqual([FAST.pollMs, POLL, POLL, POLL, POLL, POLL, POLL]);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', ...Array(6).fill(['keyboard?', 'witness?']).flat()]);
  });

  it('witness CANNOT TELL at the first ask: back as before the veto existed (the fallback), asked once and before the key', async () => {
    const fake = loginFake();
    fake.attachedKeyboard.witnessAnswers.current = 'unknown';
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'key:back', 'read', 'read', 'keyboard?', 'tap:249,1766']);
    expect(result.keyboardHidden).toBe(NOTE);
  });

  it.each([['hidden'], ['unknown']] as const)('window %s: the witness is never asked, whatever it would say', async (state) => {
    const fake = loginFake();
    fake.attachedKeyboard.windowAnswers.current = { state };
    await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0);
    expect(fake.keys).toEqual([]);
  });

  it('the wait note follows the resolution note of the node that was tapped', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, { state: 'hidden' }];
    fake.live().children.push(node({ role: 'text', identifier: 'login_submit', label: 'Sign in', rect: { x: 99, y: 1000, width: 300, height: 40 } }));
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(result.note).toBe(`2 matches; picked the only interactive one (button); ${DISAGREEMENT}; waited 500ms for it to clear`);
  });

  it('the look after the wait uses the SAME options: a target that has gone by then is the ordinary settle timeout (nothing was pressed, so no back in the message)', async () => {
    const fake = staleFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, { state: 'hidden' }];
    let checks = 0;
    const ask = fake.attachedKeyboard.state;
    fake.attachedKeyboard.state = async () => {
      if (++checks === 2) fake.live().children.pop();
      return ask.call(fake.attachedKeyboard);
    };
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/^Timed out after 200ms waiting for element id:login_submit \(visible and settled\)$/);
    expect(fake.taps).toEqual([]);
  });

  /** A field under the stale frame, for the fill. */
  function staleFieldFake() {
    const fake = staleFake();
    fake.live().children[0].rect = { x: 99, y: 1400, width: 882, height: 132 };
    fake.live().children[1].rect = { x: 99, y: 900, width: 300, height: 132 };
    return fake;
  }

  it('fillField follows the same rule — cleared: no key, the focus tap after the wait, the text typed, the result says so', async () => {
    const fake = staleFieldFake();
    fake.attachedKeyboard.windowAnswers.queue = [SHOWN, SHOWN, { state: 'hidden' }];
    const result = await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1466 }]);
    expect(fake.typed).toEqual(['abc']);
    expect(result.keyboardHidden).toBe(
      'the window state reported a soft keyboard over id:login_password that the input method denied; waited 1000ms for it to clear',
    );
  });

  it('fillField follows the same rule — never agreeing: the refusal, nothing tapped, nothing typed', async () => {
    const fake = staleFieldFake();
    await expect(fillField(fake, 'id:login_password', 'abc', FAST)).rejects.toBeInstanceOf(KeyboardStateDisagreement);
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
    expect(fake.keys).toEqual([]);
  });
});

describe('fillField — the focus tap goes through the same guard', () => {
  /** The NEXT field under the keyboard the previous one raised: here the password field itself sits at y=1400. */
  function nextFieldFake() {
    const fake = loginFake();
    const [password, button] = fake.live().children;
    password.rect = { x: 99, y: 1400, width: 882, height: 132 }; // centre (540,1466), under the keyboard
    button.rect = { x: 99, y: 900, width: 300, height: 132 };
    fake.onKey = (key) => {
      if (key === 'back') password.rect.y = 1000; // re-layout: centre (540,1066)
    };
    return fake;
  }

  it('a field under the keyboard: back once, the focus tap lands on the re-resolved centre, the text is typed there, and the result says so', async () => {
    const fake = nextFieldFake();
    const result = await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.keys).toEqual(['back']);
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1066 }]);
    expect(fake.typed).toEqual(['abc']);
    const sentence = 'the soft keyboard covered id:login_password; hidden before tapping';
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence, warning: undefined });
  });

  it('a field clear of the keyboard: exactly one query, no key, nothing reported', async () => {
    const fake = loginFake();
    const result = await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1166 }]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined, warning: undefined });
  });

  it('a keyboard that stays over the field: the fill throws the recovery error and neither taps nor types', async () => {
    const fake = nextFieldFake();
    fake.onKey = (_key, self) => {
      self.attachedKeyboard.windowAnswers.current = { state: 'shown', frame: KEYBOARD };
    };
    await expect(fillField(fake, 'id:login_password', 'abc', FAST)).rejects.toThrow(
      /^Pressed back to hide the soft keyboard covering id:login_password, but back did not close it/,
    );
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
  });

  it('iOS (no oracle): a fill asks nothing and presses no key; the focus tap lands where the field resolved', async () => {
    const fake = nextFieldFake();
    fake.platform = 'ios';
    fake.keyboard = undefined;
    await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.keys).toEqual([]);
    expect(fake.tapPoints).toEqual([{ x: 540, y: 1466 }]);
  });
});

describe('the four decisions — one pure function per phase, each reached only where its phase decides (2026-10-05)', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };

  it.each([
    ['witness shown', 'shown', 'back'],
    ['witness unknown (cannot be asked): the decision the window state alone made', 'unknown', 'back'],
    ['witness hidden: the veto — nothing sent on one disagreeing sample', 'hidden', 'hold'],
  ] as const)('firstLook (the window covers the point) — %s → %s', (_name, witness, expected) => {
    expect(firstLook(witness)).toBe(expected);
  });

  it.each([
    ['witness shown', 'shown', 500, 'back'],
    ['witness shown on the LAST round: still back, not a refusal', 'shown', KEYBOARD_DISAGREEMENT_BUDGET_MS, 'back'],
    ['witness hidden', 'hidden', 500, 'hold'],
    ['witness unknown: a witness that cannot be reached now has confirmed nothing', 'unknown', 500, 'hold'],
    ['witness hidden · one round short of the budget', 'hidden', KEYBOARD_DISAGREEMENT_BUDGET_MS - KEYBOARD_DISAGREEMENT_POLL_MS, 'hold'],
    ['witness hidden · the budget spent', 'hidden', KEYBOARD_DISAGREEMENT_BUDGET_MS, 'refuse'],
    ['witness unknown · the budget spent', 'unknown', KEYBOARD_DISAGREEMENT_BUDGET_MS, 'refuse'],
  ] as const)('recheck (the window still covers the point) — %s → %s', (_name, witness, waitedMs, expected) => {
    expect(recheck(witness, waitedMs)).toBe(expected);
  });

  it.each([
    ['window clear', { over: 'clear' }, { action: 'proceed' }],
    ['window unknown: the tap goes ahead, the note says the state could not be read', { over: 'unknown' }, { action: 'proceed' }],
    ['covering: a refusal that carries the frame — never a second back', { over: 'covering', frame: FRAME }, { action: 'refuse', frame: FRAME }],
  ] as const)('afterBack — %s → %s', (_name, window, expected) => {
    expect(afterBack(window)).toEqual(expected);
  });

  it.each([
    ['window clear (hidden): nothing to dismiss — back would navigate', ['clear'], 'nothing'],
    ['window unknown: back, as before 2026-10-03 — the witness is not asked', ['unknown'], 'back'],
    ['covering · witness shown', ['covering', 'shown'], 'back'],
    ['covering · witness unknown', ['covering', 'unknown'], 'back'],
    ['covering · witness hidden: the veto, nothing pressed', ['covering', 'hidden'], 'nothing'],
  ] as const)('dismissal — %s → %s', (_name, args, expected) => {
    const decided = args.length === 1 ? dismissal(args[0]) : dismissal(args[0], args[1]);
    expect(decided).toBe(expected);
  });
});

describe('the guard\'s window reading — geometry, with the frame when it covers', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };
  it.each([
    ['shown, point inside the frame', { state: 'shown', frame: FRAME }, { x: 249, y: 1466 }, { over: 'covering', frame: FRAME }],
    ['shown, point outside the frame (beside it)', { state: 'shown', frame: FRAME }, { x: 249, y: 1000 }, { over: 'clear' }],
    ['hidden', { state: 'hidden' }, { x: 249, y: 1466 }, { over: 'clear' }],
    ['unknown: kept apart, not folded into clear', { state: 'unknown' }, { x: 249, y: 1466 }, { over: 'unknown' }],
  ] as const)('windowOver — %s → %s', (_name, keyboard, point, expected) => {
    expect(windowOver(keyboard, point)).toEqual(expected);
  });
});

describe('dismissKeyboard — the `dismissal` decision, witness-vetoed (moved here from fill.ts 2026-10-04)', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };
  const withOracle = (window: Parameters<FakeAdapter['attachKeyboard']>[0], witness?: Parameters<FakeAdapter['attachKeyboard']>[1]) => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    fake.attachKeyboard(window, witness);
    return fake;
  };

  it('an adapter WITHOUT the oracle reads ONE tree and, with no band in it, presses and taps nothing — never the blind `enter` it pressed before stage B (measured to submit, K5d) — whatever the platform label says', async () => {
    for (const platform of ['ios', 'android'] as const) {
      const fake = new FakeAdapter({ s: screen() }, 's');
      fake.platform = platform;
      const events = recorded(fake);
      expect(await dismissKeyboard(fake)).toEqual({});
      expect(events).toEqual(['read']);
      expect(fake.keys).toEqual([]);
      expect(fake.taps).toEqual([]);
    }
  });

  it('window shown, witness confirms: back, the witness asked once and BEFORE the key', async () => {
    const fake = withOracle({ state: 'shown', frame: FRAME }, 'shown');
    const order: string[] = [];
    const ask = fake.attachedKeyboard.witness.bind(fake.attachedKeyboard);
    fake.attachedKeyboard.witness = async () => (order.push('witness?'), ask());
    fake.onKey = (key) => void order.push(`key:${key}`);
    await dismissKeyboard(fake);
    expect(order).toEqual(['witness?', 'key:back']);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
  });

  it('window shown, witness DENIES (stale window state): nothing pressed, nothing waited for', async () => {
    const fake = withOracle({ state: 'shown', frame: FRAME }, 'hidden');
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual([]);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('window shown, witness cannot tell: back, as before the veto existed', async () => {
    const fake = withOracle({ state: 'shown', frame: FRAME }, 'unknown');
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(['back']);
  });

  it.each([
    ['hidden', 'nothing is pressed', [] as string[]],
    ['unknown', 'back is pressed, as before 2026-10-03', ['back']],
  ] as const)('window %s: the witness is not asked, and %s', async (state, _what, keys) => {
    const fake = withOracle({ state }, 'hidden');
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(keys);
    expect(fake.attachedKeyboard.witnessAnswers.queries).toBe(0);
  });
});

/**
 * The in-tree keyboard (2026-10-07, docs/bugs/2026-10-05-ios-tap-lands-on-
 * soft-keyboard.md): the measured iOS login, in points — `login_submit` at
 * {36,547,141,48} (centre 107,571), the keyboard's band {0,539,402,335}
 * with the AutoFill bar, as the WDA source marks it (role `keyboard`,
 * tests/adapters/wda-source-keyboard.test.ts pins the parser). No oracle on
 * the adapter: the guard reads the band off the tree that resolved the
 * target, takes a second look when it covers, and there is nothing to press.
 */
describe('tapElement — an in-tree keyboard (no oracle) covering the target: a refusal, nothing sent (2026-10-07)', () => {
  const BAND: Rect = { x: 0, y: 539, width: 402, height: 335 };
  const SUBMIT: Rect = { x: 36, y: 547, width: 141, height: 48 };
  const TITLE: Rect = { x: 36, y: 291, width: 330, height: 24 };
  /** The adapter's own sentence (DeviceAdapter.keyboardAdvice) — quoted, never composed, by the guard. */
  const ADVICE = 'no key hides it here, says the adapter';
  const bandNode = (band: Rect) => node({ role: 'keyboard', rect: { ...band }, children: [node({ role: 'container', rect: { x: 0, y: 583, width: 402, height: 233 } })] });
  function iosFake(band: Rect | null = BAND) {
    const fake = new FakeAdapter(
      {
        login: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 402, height: 874 },
          children: [
            node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { ...TITLE } }),
            node({ role: 'textfield', identifier: 'login_password', rect: { x: 90, y: 479, width: 222, height: 20 } }),
            node({ role: 'button', identifier: 'login_submit', rect: { ...SUBMIT } }),
            ...(band === null ? [] : [bandNode(band)]),
          ],
        }),
      },
      'login',
    );
    fake.platform = 'ios';
    fake.keyboard = undefined; // as IosAdapter: no oracle
    fake.keyboardAdvice = ADVICE;
    return fake;
  }
  /** Let the Nth tree read (1-based) see the screen changed by `change` — the keyboard leaving, the target going — without touching the live screen's earlier reads. */
  const onRead = (fake: FakeAdapter, n: number, change: (live: UiNode) => void) => {
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === n) change(fake.live());
      return real();
    };
  };
  const dropBand = (live: UiNode) => {
    live.children = live.children.filter((c) => c.role !== 'keyboard');
  };
  /** The refusal's shape; `configured` is the stage B clause — "no dismissal is configured", or the list that was and is not on screen. */
  const refusal = (configured: string) =>
    'The soft keyboard covers id:login_submit: the band it draws over [0,539][402,874] contains the tap point (107,571) on two looks ' +
    `${KEYBOARD_HIDE_DELAY_MS}ms apart; this adapter cannot hide it (${ADVICE}), and ${configured}. Nothing was tapped: the tap would have pressed the ` +
    'keyboard and been reported done. From the MCP tools: hide the keyboard first, then tap id:login_submit again. In a flow: hide it ' +
    'with a step before this one (a tap: on an element the keyboard does not cover), configure a dismissal for the guard to tap, or lay the screen out so id:login_submit is not under the keyboard';
  const REFUSAL = refusal('no dismissal is configured');

  it('the bug: the target\'s centre inside the band on both looks → KeyboardWithoutDismissal; no tap, no key, no oracle, four reads and the hide delay between the looks', async () => {
    const fake = iosFake();
    const events = recorded(fake);
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error).not.toBeInstanceOf(AfterKeyboardDismissal); // nothing was pressed
    expect(error.message).toBe(REFUSAL);
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; no dismissal, nothing sent');
    expect(events).toEqual(['read', 'read', 'read', 'read']); // two settle reads per look; the band came from those, no read of its own
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
  });

  it('an adapter without a sentence of its own: the refusal says only that it cannot hide it', async () => {
    const fake = iosFake();
    fake.keyboardAdvice = undefined;
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/; this adapter cannot hide it, and no dismissal is configured\. Nothing was tapped/);
  });

  /**
   * Stage B (2026-10-07): the configured dismissals. The guard's two looks
   * are as above; on the second covering look the first usable strategy is
   * tapped ONCE, the hide delay waited, the target resolved a third time
   * and the band read off that look. The measured facts behind the
   * strategies: a tap on the title hid the keyboard without submitting
   * (K5b), the accessory Done hid the 2FA pad (K4), the return key submits
   * (K5d). The fake's `onTap` plays the app: the title tap drops the band.
   */
  describe('stage B — a configured dismissal is tapped first, once, and the target tapped after a third look', () => {
    const TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };
    const OTHER_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'twofactor_title' } };
    const ACCESSORY: KeyboardDismissal = { kind: 'accessory' };
    /** The screen reacts to the dismissal tap as the measured app did (K5b): the keyboard's band is gone on the next read. */
    const hiding = (fake: FakeAdapter, on = 'login_title') => {
      fake.onTap = (id, self) => {
        if (id === on) dropBand(self.live());
      };
      return fake;
    };
    const HIDDEN = 'the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" before tapping';

    it('the configured title hides the keyboard: the title tapped at its centre, the hide delay, a third look, then the target — both taps in order, the note says so', async () => {
      const fake = hiding(iosFake());
      const events = recorded(fake);
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'tap:107,571']);
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(fake.keys).toEqual([]);
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(result).toEqual({ note: HIDDEN, keyboardHidden: HIDDEN });
    });

    it('the target is tapped where the THIRD look finds it: a layout that moves when the keyboard goes is followed', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') {
          dropBand(self.live());
          self.live().children[2].rect.y = 600; // centre (107,624)
        }
      };
      await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 624 }]);
    });

    it('the first strategy is absent from the screen: the second is used; the order is the config\'s', async () => {
      const fake = hiding(iosFake());
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [OTHER_TAP, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    it('every strategy absent: the refusal names them, in order, and nothing is tapped', async () => {
      const fake = iosFake();
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [OTHER_TAP, ACCESSORY] }).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
      expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toBe(refusal('none of the configured dismissals is usable on this screen (tap id:"twofactor_title": not found; accessory: no accessory toolbar on screen)'));
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; no dismissal, nothing sent');
      expect(fake.taps).toEqual([]);
    });

    it('none configured (undefined, or an empty list): the stage A refusal, saying no dismissal is configured', async () => {
      for (const dismissals of [undefined, []]) {
        const fake = iosFake();
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals })).rejects.toThrow(REFUSAL);
        expect(fake.taps).toEqual([]);
      }
    });

    it('a configured element whose centre lies UNDER the band is skipped — it would be the very tap the guard refuses — and the next strategy is used', async () => {
      const fake = hiding(iosFake());
      fake.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 600, width: 330, height: 24 } })); // centre (201,612): in the band
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_footer' } }, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
      // …and alone it is as good as absent.
      const alone = iosFake();
      alone.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 600, width: 330, height: 24 } }));
      await expect(tapElement(alone, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'login_footer' } }] })).rejects.toThrow(
        'none of the configured dismissals is usable on this screen (tap id:"login_footer": under the keyboard)',
      );
      expect(alone.taps).toEqual([]);
    });

    it('the tap does NOT hide the keyboard: AfterDismissalTap, exactly one strategy tap, no second strategy, the target untapped, and the message says the screen may have changed', async () => {
      const fake = iosFake(); // onTap does nothing: the band stays
      const events = recorded(fake);
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP, OTHER_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      expect(error).not.toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toBe(
        'Tapped id:"login_title" at (201,303) to hide the soft keyboard covering id:login_submit, but it is still up: the band [0,539][402,874] ' +
          `still contains the tap point (107,571) on ${KEYBOARD_HIDE_CONFIRM_LOOKS} looks ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. That tap may have changed the screen (the keyboard was raised again, ` +
          'or the element did something of its own) — look at it (ui_snapshot / screenshot) before retrying. From the MCP tools: hide the keyboard ' +
          'another way, then tap id:login_submit again. In a flow: configure a dismissal that hides the keyboard on THIS screen, or lay the screen out ' +
          'so id:login_submit is not under it',
      );
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; tapped id:"login_title" to hide it, still covered');
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'read', 'read']); // two confirming looks after the tap, each a settled resolution
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(fake.taps).toEqual(['login_title']);
      expect(fake.keys).toEqual([]);
    });

    it('the target does not come back after the dismissal tap: AfterDismissalTap wrapping the timeout, saying what was tapped and that the screen may have changed', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') self.live().children = self.live().children.filter((c) => c.identifier !== 'login_submit');
      };
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      expect(error.message).toBe(
        'After tapping id:"login_title" at (201,303) to hide the soft keyboard that covered id:login_submit at (107,571): Timed out after 200ms ' +
          'waiting for element id:login_submit (visible and settled). That tap may have changed the screen — check it (ui_snapshot / screenshot)',
      );
      expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; tapped id:"login_title" to hide it, and the look after it failed');
      expect((error.cause as Error).message).toBe('Timed out after 200ms waiting for element id:login_submit (visible and settled)');
      expect(fake.taps).toEqual(['login_title']);
    });

    it('an ambiguous refusal on the look after the dismissal tap keeps its headline and says below it what was tapped', async () => {
      const fake = iosFake();
      fake.onTap = (id, self) => {
        if (id === 'login_title') {
          dropBand(self.live());
          self.live().children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 200, y: 400, width: 100, height: 40 } }));
        }
      };
      const error = (await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [TITLE_TAP] }).catch((e: unknown) => e)) as AfterDismissalTap;
      expect(error).toBeInstanceOf(AfterDismissalTap);
      const lines = error.message.split('\n');
      expect(lines[0]).toBe('Selector matches 2 elements: id:login_submit');
      expect(lines.at(-1)).toBe(
        '(This was the look after tapping id:"login_title" at (201,303) to hide the soft keyboard that covered id:login_submit at (107,571). ' +
          'That tap may have changed the screen — check it (ui_snapshot / screenshot))',
      );
      expect(error.cause).toBeInstanceOf(AmbiguityRefusal);
    });

    it('an ambiguous STRATEGY under refuse mode counts as absent (the guard never picks one of two titles); under first mode the first is taken', async () => {
      const twoTitles = () => {
        const fake = hiding(iosFake());
        fake.live().children.push(node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { x: 36, y: 330, width: 330, height: 24 } }));
        return fake;
      };
      const refused = twoTitles();
      await expect(tapElement(refused, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [TITLE_TAP] })).rejects.toThrow(
        'none of the configured dismissals is usable on this screen (tap id:"login_title": 2 matches)',
      );
      expect(refused.taps).toEqual([]);
      const first = twoTitles();
      const result = await tapElement(first, 'id:login_submit', { ...FAST, ambiguous: 'first', dismissals: [TITLE_TAP] });
      expect(first.tapPoints[0]).toEqual({ x: 201, y: 303 });
      expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping id:"login_title" (2 matches, the first) before tapping'); // the choice is in the trace
    });

    it('a configured element that is the keyboard\'s OWN UI is skipped even where it lies outside the band (constructed: an ofKeyboard subtree above the band) — the band check alone would let it through', async () => {
      const fake = hiding(iosFake());
      fake.live().children.push(
        node({ role: 'container', ofKeyboard: true, rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'text', identifier: 'kb_hide', rect: { x: 300, y: 500, width: 60, height: 30 } })] }), // centre (330,515): above the band at 539; a text, so not dropped as interactive
      );
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target: { id: 'kb_hide' } }, TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    it('the strategies are judged on the SECOND look\'s tree: a title that is only there by then is used', async () => {
      const fake = hiding(iosFake());
      const title = fake.live().children.shift()!; // no title on the first look…
      onRead(fake, 3, (live) => live.children.unshift(title)); // …and there from the second look on
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_submit']);
      expect(result.keyboardHidden).toBe(HIDDEN);
    });

    /**
     * Review round 1: the resolution policy prefers the sole interactive
     * match, so a `tap: { text: "Sign in" }` on a screen where a title and a
     * BUTTON share the label would have tapped the button — the one thing a
     * dismissal must never do. Interactive matches are dropped before any
     * choice, in both ambiguity modes and on both callers.
     */
    describe('a dismissal is never an interactive element', () => {
      const shared = () => {
        const fake = hiding(iosFake(), 'login_heading');
        fake.live().children.push(
          node({ role: 'text', identifier: 'login_heading', label: 'Sign in', rect: { x: 36, y: 200, width: 330, height: 30 } }), // centre (201,215)
          node({ role: 'button', identifier: 'login_cta', label: 'Sign in', rect: { x: 36, y: 400, width: 330, height: 48 } }), // the control: the same label, above the band
        );
        return fake;
      };
      const BY_TEXT: KeyboardDismissal = { kind: 'tap', target: { text: 'Sign in' } };

      it('tapElement under refuse: a title and a button sharing the label → the TITLE is tapped, never the button', async () => {
        const fake = shared();
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse', dismissals: [BY_TEXT] });
        expect(fake.taps).toEqual(['login_heading', 'login_submit']);
        expect(fake.tapPoints[0]).toEqual({ x: 201, y: 215 });
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping text:"Sign in" before tapping');
      });

      it('dismissKeyboard under first: the same — the title, never the button', async () => {
        const fake = shared();
        expect(await dismissKeyboard(fake, { ambiguous: 'first', dismissals: [BY_TEXT] })).toEqual({ hidden: 'tapping text:"Sign in"' });
        expect(fake.taps).toEqual(['login_heading']);
      });

      it.each([
        ['a label only a button carries', { label: 'Submit' } as const, 'tap label:"Submit": only interactive match (button) — a dismissal must be a non-interactive element'],
        ['role: button (refused by the config schema; interact/ must still never act on it)', { role: 'button' } as const, 'tap role:"button": only interactive matches (button, button) — a dismissal must be a non-interactive element'],
      ])('only controls match — %s: the strategy is absent with the reason, nothing tapped', async (_name, target, reason) => {
        const fake = shared();
        fake.live().children.find((c) => c.identifier === 'login_cta')!.label = 'Submit';
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [{ kind: 'tap', target }] })).rejects.toThrow(
          `none of the configured dismissals is usable on this screen (${reason})`,
        );
        expect(fake.taps).toEqual([]);
      });
    });

    /**
     * Review round 1: "there" is not "on screen" — WDA keeps off-screen nodes
     * in the tree, and a title scrolled above the viewport or under an
     * alert's text is still found by its selector. The tap point must lie
     * inside the root's rect and must not be drawn over by later content.
     */
    describe('a dismissal must be on screen and not drawn over', () => {
      const title = (fake: FakeAdapter) => fake.live().children[0];

      it('scrolled above the viewport (negative y): skipped as off screen, the next strategy used', async () => {
        const fake = hiding(iosFake(), 'login_footer');
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 }; // centre (201,-48)
        fake.live().children.push(node({ role: 'text', identifier: 'login_footer', rect: { x: 36, y: 500, width: 330, height: 24 } }));
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP, { kind: 'tap', target: { id: 'login_footer' } }] });
        expect(fake.taps).toEqual(['login_footer', 'login_submit']);
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:login_submit; hidden by tapping id:"login_footer" before tapping');
        const alone = iosFake();
        title(alone).rect = { x: 36, y: -60, width: 330, height: 24 };
        await expect(tapElement(alone, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] })).rejects.toThrow('(tap id:"login_title": off screen at (201,-48))');
        expect(alone.taps).toEqual([]);
      });

      it('below the screen, or past its right edge: off screen too; on the last row or column: on screen', async () => {
        const at = async (rect: Rect) => {
          const fake = hiding(iosFake());
          title(fake).rect = rect;
          return tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] }).then(() => 'tapped', (e: unknown) => (e as Error).message.match(/\(tap id:"login_title": (.*?\))\)/)?.[1]);
        };
        expect(await at({ x: 36, y: 900, width: 330, height: 24 })).toBe('off screen at (201,912)');
        expect(await at({ x: 400, y: 100, width: 100, height: 24 })).toBe('off screen at (450,112)');
        expect(await at({ x: 0, y: 500, width: 2, height: 2 })).toBe('tapped'); // (1,501)
        expect(await at({ x: 400, y: 100, width: 2, height: 2 })).toBe('tapped'); // (401,101): the last column of a 402-wide screen
      });

      it('drawn over by later content (an alert\'s text over the title): skipped naming what covers it', async () => {
        const fake = iosFake();
        fake.live().children.push(node({ role: 'text', label: 'Session expired', rect: { x: 20, y: 280, width: 362, height: 120 } })); // a sheet's text over (201,303)
        await expect(tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] })).rejects.toThrow('(tap id:"login_title": covered by text "Session expired")');
        expect(fake.taps).toEqual([]);
      });

      it('a later full-screen structural wrapper, an earlier sibling, an ancestor, the node\'s own descendants and the keyboard\'s UI do NOT count as cover', async () => {
        const fake = hiding(iosFake());
        const [heading] = fake.live().children.splice(0, 1);
        fake.live().children.unshift(
          node({ role: 'image', label: 'background', rect: { x: 0, y: 0, width: 402, height: 874 } }), // earlier sibling: beneath
          node({ role: 'scrollable', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [{ ...heading, children: [node({ role: 'text', label: 'inner', rect: { ...heading.rect } })] }] })] }), // ancestors and a descendant
        );
        fake.live().children.push(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 } })); // a later Window's wrapper: structural
        fake.onTap = (id, self) => {
          if (id === 'login_title') dropBand(self.live());
        };
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 571 }]);
        expect(result.keyboardHidden).toBe(HIDDEN);
      });

      it('a root without a rect (no screen to judge by) skips the on-screen check, not the strategy', async () => {
        const fake = hiding(iosFake());
        fake.live().rect = { x: 0, y: 0, width: 0, height: 0 };
        fake.viewportSize = { width: 402, height: 874 };
        title(fake).rect = { x: 36, y: -60, width: 330, height: 24 };
        await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
        expect(fake.taps).toEqual(['login_title', 'login_submit']);
      });
    });

    it('the keyboard is gone only on the SECOND confirming look after the dismissal tap (a hide animation caught mid-way): the target is tapped, not refused', async () => {
      const fake = iosFake();
      let reads = 0;
      const real = fake.uiTree.bind(fake);
      fake.uiTree = async () => {
        if (++reads === 7) dropBand(fake.live()); // looks 1–2: reads 1–4; the tap; look 3 (first confirm): reads 5–6 still covered; look 4: reads 7–8 clear
        return real();
      };
      const events = recorded(fake);
      const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:201,303', 'read', 'read', 'read', 'read', 'tap:107,571']);
      expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
      expect(result.keyboardHidden).toBe(HIDDEN);
      expect(KEYBOARD_HIDE_CONFIRM_LOOKS).toBe(2);
    });

    it('the keyboard LEAVES by the second look: no strategy is tapped at all — the dismissals are read only where stage A would refuse', async () => {
      const fake = iosFake();
      onRead(fake, 3, dropBand);
      await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_submit']);
    });

    it('fillField: a field under the band is focused after the configured dismissal, the text typed, the result says so', async () => {
      const fake = hiding(iosFake());
      fake.live().children[1].rect = { x: 90, y: 600, width: 222, height: 20 };
      const result = await fillField(fake, 'id:login_password', 'abc', { ...FAST, dismissals: [TITLE_TAP] });
      expect(fake.taps).toEqual(['login_title', 'login_password']);
      expect(fake.typed).toEqual(['abc']);
      const sentence = 'the soft keyboard covered id:login_password; hidden by tapping id:"login_title" before tapping';
      expect(result).toEqual({ note: sentence, keyboardHidden: sentence, warning: undefined });
    });

    it('an adapter WITH an oracle never reads the dismissals: the Android event log with them is byte-identical to the log without', async () => {
      const run = async (dismissals?: KeyboardDismissal[]) => {
        const fake = loginFake();
        const events = recorded(fake);
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals });
        return { events, result, keys: fake.keys, taps: fake.taps };
      };
      const without = await run();
      const withThem = await run([TITLE_TAP, ACCESSORY]);
      expect(withThem).toEqual(without);
      expect(withThem.events).toEqual(['read', 'read', 'keyboard?', 'witness?', 'key:back', 'read', 'read', 'keyboard?', 'tap:249,1766']);
      expect(withThem.taps).toEqual(['login_submit']);
    });

    describe('on the real dumps', () => {
      const fixture = async (name: string) => parseWdaSource(await readFile(new URL(`../fixtures/wda-source-myport-${name}.json`, import.meta.url), 'utf8'));

      it('the keyboard\'s own `done` RETURN key (id Done, label done, y 752 — it SUBMITS, K5d) is never chosen, however it is named: a Button, so dropped as interactive before any other check, and the refusal says so', async () => {
        for (const name of ['login-keyboard', 'login-keyboard-bar']) {
          const fake = new FakeAdapter({ dump: await fixture(name) }, 'dump');
          fake.platform = 'ios';
          fake.keyboard = undefined;
          const dismissals: KeyboardDismissal[] = [{ kind: 'tap', target: { id: 'Done' } }, { kind: 'tap', target: { label: 'done' } }, { kind: 'accessory' }];
          await expect(resolveClearOfKeyboard(fake, 'id:login_submit', { ...FAST, dismissals })).rejects.toThrow(
            'none of the configured dismissals is usable on this screen (tap id:"Done": only interactive match (button) — a dismissal must be a non-interactive element; ' +
              'tap label:"done": only interactive match (button) — a dismissal must be a non-interactive element; accessory: no accessory toolbar on screen)',
          );
          expect(fake.taps).toEqual([]);
        }
      });

      it('K1 with the title configured: the title {36,291} is tapped, and once the app hides the keyboard (the dump swapped for K3, nothing focused) login_submit is tapped at (107,571)', async () => {
        const fake = new FakeAdapter({ up: await fixture('login-keyboard-bar'), down: await fixture('login-no-keyboard') }, 'up', (id, self) => {
          if (id === 'login_title') self.current = 'down';
        });
        fake.platform = 'ios';
        fake.keyboard = undefined;
        const result = await tapElement(fake, 'id:login_submit', { ...FAST, dismissals: [ACCESSORY, TITLE_TAP] }); // no accessory on the login screen: the title
        expect(fake.tapPoints).toEqual([{ x: 201, y: 303 }, { x: 107, y: 571 }]);
        expect(fake.taps).toEqual(['login_title', 'login_submit_label']); // the fake's hit test lands on the deepest identified node: the button's label, inside the button
        expect(result.keyboardHidden).toBe(HIDDEN);
      });

      it('the 2FA pad with the accessory configured: a target constructed under the band (the real submit sits above it, the screen shrinks to 518) is reached through Done {317,523} → the pad hidden (the dump swapped for the parked one)', async () => {
        const up = await fixture('2fa-keyboard-toolbar');
        const submit = up.children[0].children[0].children[0]; // the app's Window's wrapper: a button of the app's, under the band
        submit.children.push(node({ role: 'button', identifier: 'twofactor_footer', rect: { x: 36, y: 600, width: 330, height: 48 } }));
        const down = await fixture('2fa-keyboard-parked');
        down.children[0].children[0].children[0].children.push(node({ role: 'button', identifier: 'twofactor_footer', rect: { x: 36, y: 600, width: 330, height: 48 } }));
        const fake = new FakeAdapter({ up, down }, 'up', (id, self) => {
          if (id === 'Toolbar') self.current = 'down'; // the fake's hit test lands on the identified Toolbar; Done itself has no identifier
        });
        fake.platform = 'ios';
        fake.keyboard = undefined;
        const result = await tapElement(fake, 'id:twofactor_footer', { ...FAST, dismissals: [TITLE_TAP, ACCESSORY] }); // no login_title on 2FA: the accessory
        expect(fake.tapPoints).toEqual([{ x: 349, y: 542 }, { x: 201, y: 624 }]);
        expect(result.keyboardHidden).toBe('the soft keyboard covered id:twofactor_footer; hidden by tapping the accessory toolbar\'s "Done" before tapping');
      });
    });
  });

  it('the keyboard LEAVES between the looks (still sliding away after the step before): the tap lands on the second look\'s node, with a note', async () => {
    const fake = iosFake();
    onRead(fake, 3, dropBand);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'read', 'read', 'tap:107,571']);
    expect(sleeps).toEqual([FAST.pollMs, KEYBOARD_HIDE_DELAY_MS, FAST.pollMs]);
    const sentence = 'the soft keyboard covered id:login_submit; gone on the second look';
    expect(result).toEqual({ note: sentence, keyboardHidden: sentence });
    expect(fake.keys).toEqual([]);
  });

  it('the band is read from the read that SETTLED the target (the second agreeing one), not the first: band in read 1, none in read 2 → no second look, no delay, no note', async () => {
    const fake = iosFake();
    onRead(fake, 2, dropBand);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'tap:107,571']);
    expect(sleeps).toEqual([FAST.pollMs]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('the target VANISHES by the second look: the settle timeout, wrapped so the trace shows the first look found it covered — and that nothing was pressed', async () => {
    const fake = iosFake();
    onRead(fake, 3, (live) => {
      live.children = live.children.filter((c) => c.identifier !== 'login_submit');
    });
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toBe(
      'After the soft keyboard covered id:login_submit at (107,571) on a first look, the second look failed: Timed out after 200ms ' +
        'waiting for element id:login_submit (visible and settled). Nothing was pressed; the screen is as the step found it',
    );
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; nothing sent, and the second look failed');
    expect((error.cause as Error).message).toBe('Timed out after 200ms waiting for element id:login_submit (visible and settled)');
    expect(fake.taps).toEqual([]);
    expect(fake.keys).toEqual([]);
  });

  it('a second look that reads a dead tree keeps the read error beneath the headline', async () => {
    const fake = iosFake();
    onRead(fake, 3, () => {
      fake.uiTree = async () => {
        throw new Error('device offline');
      };
    });
    const error = (await tapElement(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as Error;
    expect(error.message.split('\n')).toEqual([
      'After the soft keyboard covered id:login_submit at (107,571) on a first look, the second look failed: Timed out after 200ms ' +
        'waiting for element id:login_submit (visible and settled). Nothing was pressed; the screen is as the step found it',
      '  (last UI tree read failed: device offline)',
    ]);
  });

  it('a refusal on the second look (refuse mode, a second interactive match revealed) keeps its FIRST line as the headline and says below it that nothing was pressed', async () => {
    const fake = iosFake();
    onRead(fake, 3, (live) => {
      live.children.push(node({ role: 'button', identifier: 'login_submit', label: 'Other', rect: { x: 200, y: 400, width: 100, height: 40 } }));
    });
    const error = (await tapElement(fake, 'id:login_submit', { ...FAST, ambiguous: 'refuse' }).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    const lines = error.message.split('\n');
    expect(lines[0]).toBe('Selector matches 2 elements: id:login_submit');
    expect(lines.at(-1)).toBe('(This was the second look, after the soft keyboard covered id:login_submit at (107,571) on a first look. Nothing was pressed)');
    expect(error.traceLine).toBe('the soft keyboard covered id:login_submit; nothing sent, and the second look failed');
    expect(error.cause).toBeInstanceOf(AmbiguityRefusal);
    expect(fake.taps).toEqual([]);
  });

  it('an app element named inputView (an RN testID) does not disable the guard: the K1 dump with login_card renamed still refuses login_submit', async () => {
    const renamed = (await readFile(new URL('../fixtures/wda-source-myport-login-keyboard-bar.json', import.meta.url), 'utf8')).replace('"rawIdentifier":"login_card"', '"rawIdentifier":"inputView"');
    const fake = new FakeAdapter({ dump: parseWdaSource(renamed) }, 'dump');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    const error = (await resolveClearOfKeyboard(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
    expect(error.message).toContain('the band it draws over [0,539][402,874] contains the tap point (107,571)');
  });

  it('a target clear of the band (the title) is tapped as before: two reads, no delay, no note', async () => {
    const fake = iosFake();
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_title', FAST);
    expect(events).toEqual(['read', 'read', 'tap:201,303']);
    expect(sleeps).toEqual([FAST.pollMs]);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('no band in the tree (no keyboard on screen, or an idb tree): exactly what happened before — the tap lands on the centre', async () => {
    const fake = iosFake(null);
    const events = recorded(fake);
    const result = await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'tap:107,571']);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined });
  });

  it('the band is half-open like a frame: a centre on its top row (539) is covered, one point above (538) is clear', async () => {
    const at = async (centreY: number) => {
      const fake = iosFake();
      fake.live().children[2].rect = { x: 36, y: centreY - 24, width: 141, height: 48 };
      return tapElement(fake, 'id:login_submit', FAST).then(() => 'tapped', (e: unknown) => (e as Error).name);
    };
    expect(await at(539)).toBe('KeyboardWithoutDismissal');
    expect(await at(538)).toBe('tapped');
  });

  it('the band without the bar ({0,566,402,308}, the K2 shape) still covers the centre at 571', async () => {
    const fake = iosFake({ x: 0, y: 566, width: 402, height: 308 });
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/the band it draws over \[0,566\]\[402,874\] contains the tap point \(107,571\)/);
    expect(fake.taps).toEqual([]);
  });

  it('fillField: a field under the band on both looks is refused before the focus tap — nothing tapped, nothing typed', async () => {
    const fake = iosFake();
    fake.live().children[1].rect = { x: 90, y: 600, width: 222, height: 20 };
    await expect(fillField(fake, 'id:login_password', 'abc', FAST)).rejects.toBeInstanceOf(KeyboardWithoutDismissal);
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
    expect(fake.keys).toEqual([]);
  });

  it('fillField: a field clear of the band is focused and typed into, asking nothing', async () => {
    const fake = iosFake();
    const result = await fillField(fake, 'id:login_password', 'abc', FAST);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 489 }]);
    expect(fake.typed).toEqual(['abc']);
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined, warning: undefined });
  });

  it('an ElementSpec target is named in the flow vocabulary, in the message and the trace line', async () => {
    const fake = iosFake();
    const error = (await resolveClearOfKeyboard(fake, { id: 'login_submit' }, FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
    expect(error.traceLine).toBe('the soft keyboard covered id:"login_submit"; no dismissal, nothing sent');
    expect(error.message).toMatch(/^The soft keyboard covers id:"login_submit": /);
  });

  it('the band must have area: a zero-area keyboard node is not a keyboard on screen', async () => {
    const fake = iosFake({ x: 0, y: 539, width: 0, height: 0 });
    await tapElement(fake, 'id:login_submit', FAST);
    expect(fake.taps).toEqual(['login_submit']);
  });

  it('an adapter WITH an oracle never reads the tree for the keyboard: the oracle says hidden, the band in the tree changes nothing (Android untouched)', async () => {
    const fake = iosFake();
    fake.platform = 'android';
    fake.attachKeyboard({ state: 'hidden' });
    const events = recorded(fake);
    await tapElement(fake, 'id:login_submit', FAST);
    expect(events).toEqual(['read', 'read', 'keyboard?', 'tap:107,571']);
    expect(fake.attachedKeyboard.windowAnswers.queries).toBe(1);
  });

  it('the guard\'s answer carries the node and its note only — never the tree the resolution rode in on (in-tree clear, and oracle hidden)', async () => {
    const clear = await resolveClearOfKeyboard(iosFake(), 'id:login_title', FAST);
    expect(Object.keys(clear)).toEqual(['node', 'note']);
    const android = iosFake();
    android.attachKeyboard({ state: 'hidden' });
    const hidden = await resolveClearOfKeyboard(android, 'id:login_submit', FAST);
    expect(Object.keys(hidden)).toEqual(['node', 'note']);
  });

  it('the resolution note of the node tapped is kept, unchanged, when the band does not cover it', async () => {
    const fake = iosFake();
    fake.live().children.push(node({ role: 'text', identifier: 'login_title', label: 'Prihlásenie', rect: { x: 36, y: 320, width: 330, height: 24 } }));
    fake.live().children.push(node({ role: 'button', identifier: 'login_title', label: 'x', rect: { x: 36, y: 350, width: 30, height: 24 } }));
    const result = await tapElement(fake, 'id:login_title', FAST);
    expect(result.note).toBe('3 matches; picked the only interactive one (button)');
    expect(result.keyboardHidden).toBeUndefined();
  });

  /**
   * The keyboard's OWN controls (review 2026-10-07): a tap on a key, on the
   * accessory toolbar's Done, on the Passwords bar or on dictation lands
   * inside the band and is what the user does — an OTP digit, the one
   * non-submitting dismissal. The WDA source marks their Windows
   * (`ofKeyboard`); the guard reads them as not covered. On the REAL dumps.
   */
  describe('the keyboard\'s own controls are tappable on the real dumps — only the app\'s element under the band is refused', () => {
    const fixture = async (name: string) => parseWdaSource(await readFile(new URL(`../fixtures/wda-source-myport-${name}.json`, import.meta.url), 'utf8'));
    const onDump = async (name: string) => {
      const fake = new FakeAdapter({ dump: await fixture(name) }, 'dump');
      fake.platform = 'ios';
      fake.keyboard = undefined;
      return fake;
    };
    const resolves = async (name: string, selector: string) => {
      const fake = await onDump(name);
      const events = recorded(fake);
      const { node: found, keyboardHidden } = await resolveClearOfKeyboard(fake, selector, FAST);
      expect(events).toEqual(['read', 'read']); // one look, no delay
      expect(keyboardHidden).toBeUndefined();
      return found;
    };

    it.each([
      ['2fa-keyboard-toolbar', 'label:Done', { x: 317, y: 523, width: 64, height: 38 }], // the inputAccessoryView Done — the natural non-submitting dismissal, in a DIFFERENT Window than the band
      ['2fa-keyboard-toolbar', 'id:Toolbar', { x: 0, y: 518, width: 402, height: 48 }],
      ['2fa-keyboard-toolbar', 'label:1', { x: 4, y: 590, width: 133, height: 54 }], // an OTP digit
      ['login-keyboard-bar', 'label:Passwords', { x: 30, y: 539, width: 342, height: 44 }],
      ['login-keyboard-bar', 'label:q', { x: 4, y: 590, width: 40, height: 54 }],
      ['login-keyboard-bar', 'id:dictation', { x: 325, y: 805, width: 69, height: 70 }],
      ['login-keyboard', 'id:dictation', { x: 325, y: 805, width: 69, height: 70 }],
    ])('%s: %s resolves clear, inside the band', async (name, selector, rect) => {
      expect((await resolves(name, selector)).rect).toEqual(rect);
    });

    it.each([
      ['login-keyboard-bar', '[0,539][402,874]'],
      ['login-keyboard', '[0,566][402,874]'],
    ])('%s: login_submit (centre 107,571) is still refused, naming the band %s', async (name, band) => {
      const fake = await onDump(name);
      const error = (await resolveClearOfKeyboard(fake, 'id:login_submit', FAST).catch((e: unknown) => e)) as KeyboardWithoutDismissal;
      expect(error).toBeInstanceOf(KeyboardWithoutDismissal);
      expect(error.message).toContain(`the band it draws over ${band} contains the tap point (107,571)`);
    });

    it('the parked dump (no band): the toolbar\'s Done and the app\'s submit both resolve clear', async () => {
      expect((await resolves('2fa-keyboard-parked', 'label:Done')).rect).toEqual({ x: 317, y: 831, width: 64, height: 38 });
      expect((await resolves('2fa-keyboard-parked', 'id:twofactor_submit')).rect).toEqual({ x: 225, y: 501, width: 141, height: 49 });
    });
  });
});

/**
 * Stage B (2026-10-07): the in-tree dismissal after a fill. One tree read;
 * a band → the configured strategy tapped once and one re-read to confirm;
 * no band → nothing. `enter` is never pressed on this path any more: it was
 * measured to SUBMIT the login from the password field (K5d).
 */
describe('dismissKeyboard — the in-tree model (no oracle), stage B', () => {
  const BAND: Rect = { x: 0, y: 539, width: 402, height: 335 };
  const TITLE_TAP: KeyboardDismissal = { kind: 'tap', target: { id: 'login_title' } };
  const withBand = (reactsTo = 'login_title') =>
    new FakeAdapter(
      {
        login: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 402, height: 874 },
          children: [
            node({ role: 'text', identifier: 'login_title', rect: { x: 36, y: 291, width: 330, height: 24 } }),
            node({ role: 'textfield', identifier: 'login_password', rect: { x: 90, y: 479, width: 222, height: 20 } }),
            node({ role: 'keyboard', rect: { ...BAND } }),
          ],
        }),
      },
      'login',
      (id, self) => {
        if (id === reactsTo) self.live().children = self.live().children.filter((c) => c.role !== 'keyboard');
      },
    );
  const FIRST = { ambiguous: 'first' as const };

  it('a band in the tree and a usable strategy: ONE tap at its centre, the hide delay, one re-read — the band gone, the result says what hid it; no key', async () => {
    const fake = withBand();
    const events = recorded(fake);
    const result = await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] });
    expect(events).toEqual(['read', 'tap:201,303', 'read']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS]);
    expect(fake.keys).toEqual([]);
    expect(result).toEqual({ hidden: 'tapping id:"login_title"' });
  });

  it('no band in the tree (none on screen, the keyboard parked by the HID typing, an idb tree): one read, nothing tapped, nothing pressed, an empty result', async () => {
    const fake = withBand();
    fake.live().children = fake.live().children.filter((c) => c.role !== 'keyboard');
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({});
    expect(events).toEqual(['read']);
    expect(fake.keys).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it('a band and nothing usable: a WARNING, not a throw — none configured, or none on screen — and nothing is pressed or tapped', async () => {
    const none = withBand();
    expect(await dismissKeyboard(none)).toEqual({ warning: 'the soft keyboard is up and was left up: no dismissal is configured — the next tap under it will be refused' });
    expect(await dismissKeyboard(none, { ...FIRST, dismissals: [] })).toEqual({ warning: 'the soft keyboard is up and was left up: no dismissal is configured — the next tap under it will be refused' });
    const absent = withBand();
    expect(await dismissKeyboard(absent, { ...FIRST, dismissals: [{ kind: 'tap', target: { id: 'twofactor_title' } }, { kind: 'accessory' }] })).toEqual({
      warning:
        'the soft keyboard is up and was left up: none of the configured dismissals is usable on this screen (tap id:"twofactor_title": not found; accessory: no accessory toolbar on screen) — the next tap under it will be refused',
    });
    for (const fake of [none, absent]) {
      expect(fake.keys).toEqual([]);
      expect(fake.taps).toEqual([]);
    }
  });

  it('the strategy tap does not hide the keyboard: AfterDismissalTap — the screen was touched — and no second strategy', async () => {
    const fake = withBand('nothing'); // the band stays
    const error = (await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP, { kind: 'tap', target: { id: 'login_password' } }] }).catch((e: unknown) => e)) as AfterDismissalTap;
    expect(error).toBeInstanceOf(AfterDismissalTap);
    expect(error.message).toBe(
      `Tapped id:"login_title" at (201,303) to hide the soft keyboard after the fill, but it is still up over [0,539][402,874] on ${KEYBOARD_HIDE_CONFIRM_LOOKS} reads ${KEYBOARD_HIDE_DELAY_MS}ms apart; nothing else was tapped. ` +
        'That tap may have changed the screen (the keyboard was raised again, or the element did something of its own) — look at it (ui_snapshot / screenshot). ' +
        'In a flow: configure a dismissal that hides the keyboard on THIS screen, or drop dismissKeyboard from this fill',
    );
    expect(error.traceLine).toBe('the soft keyboard was up after the fill; tapped id:"login_title" to hide it, still up');
    expect(fake.taps).toEqual(['login_title']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS, KEYBOARD_HIDE_DELAY_MS]); // two confirming reads, then the refusal
  });

  it('the band is gone only on the SECOND confirming read (a hide animation caught mid-way): hidden, not a refusal', async () => {
    const fake = withBand('nothing');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === 3) fake.live().children = fake.live().children.filter((c) => c.role !== 'keyboard'); // read 1: the band; read 2 (first confirm): still; read 3: gone
      return real();
    };
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({ hidden: 'tapping id:"login_title"' });
    expect(events).toEqual(['read', 'tap:201,303', 'read', 'read']);
    expect(sleeps).toEqual([KEYBOARD_HIDE_DELAY_MS, KEYBOARD_HIDE_DELAY_MS]);
  });

  it('`enter` is never in the keys on this path, with or without a band or a strategy', async () => {
    for (const fake of [withBand(), withBand('nothing')]) {
      await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] }).catch(() => undefined);
      await dismissKeyboard(fake).catch(() => undefined);
      expect(fake.keys).toEqual([]);
    }
  });

  it('the oracle path reads no dismissal and no tree: with them passed, Android presses back on the window state and taps nothing', async () => {
    const fake = withBand();
    fake.attachKeyboard({ state: 'shown', frame: BAND }, 'shown');
    const events = recorded(fake);
    expect(await dismissKeyboard(fake, { ...FIRST, dismissals: [TITLE_TAP] })).toEqual({});
    expect(events).toEqual(['keyboard?', 'witness?', 'key:back']);
    expect(fake.taps).toEqual([]);
  });
});

describe('inTreeLook — the in-tree decision (2026-10-07)', () => {
  const FRAME = { x: 0, y: 539, width: 402, height: 335 };
  it.each([
    ['window clear: proceed', { over: 'clear' }, { action: 'proceed' }],
    ['window unknown (no band in the tree — none on screen, an idb tree, or a target that is the keyboard\'s own UI): proceed, the fail-open rule', { over: 'unknown' }, { action: 'proceed' }],
    ['covering: refuse with the band — there was never a key to press', { over: 'covering', frame: FRAME }, { action: 'refuse', frame: FRAME }],
  ] as const)('%s', (_name, window, expected) => {
    expect(inTreeLook(window)).toEqual(expected);
  });
});
