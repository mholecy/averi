import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { fillField } from '../../src/interact/fill.js';
import {
  AfterKeyboardDismissal,
  KEYBOARD_DISAGREEMENT_BUDGET_MS,
  KEYBOARD_DISAGREEMENT_POLL_MS,
  KEYBOARD_HIDE_DELAY_MS,
  KeyboardStateDisagreement,
  dismissKeyboard,
  keyboardAction,
  resolveClearOfKeyboard,
  windowAnywhere,
  windowOver,
  type KeyboardAction,
  type KeyboardSample,
} from '../../src/interact/keyboard.js';
import { tapElement } from '../../src/interact/tap.js';
import { FakeAdapter, node, screen } from '../helpers/fake.js';

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

describe('keyboardAction — THE table, one row per case (2026-10-04)', () => {
  it.each<[string, KeyboardSample, KeyboardAction]>([
    // Nothing over the point, or nothing readable: tap, as before the question existed — in every phase of the guard.
    ['first · window clear', { phase: 'first', window: 'clear' }, 'proceed'],
    ['first · window unknown: fail open for a tap', { phase: 'first', window: 'unknown' }, 'proceed'],
    ['recheck · window clear', { phase: 'recheck', window: 'clear' }, 'proceed'],
    ['recheck · window unknown', { phase: 'recheck', window: 'unknown' }, 'proceed'],
    ['afterBack · window clear', { phase: 'afterBack', window: 'clear' }, 'proceed'],
    ['afterBack · window unknown: the tap goes ahead, the note says the state could not be read', { phase: 'afterBack', window: 'unknown' }, 'proceed'],
    // The first look at a covering keyboard: back unless the input method DENIES it.
    ['first · covering · witness shown', { phase: 'first', window: 'covering', witness: 'shown' }, 'back'],
    ['first · covering · witness unknown (cannot be asked): the decision the window state alone made', { phase: 'first', window: 'covering', witness: 'unknown' }, 'back'],
    ['first · covering · witness hidden: the veto — nothing sent on one disagreeing sample', { phase: 'first', window: 'covering', witness: 'hidden' }, 'hold'],
    // The bounded re-check: only a witness that has come round confirms; unknown confirms nothing; the budget ends in a refusal.
    ['recheck · covering · witness shown', { phase: 'recheck', window: 'covering', witness: 'shown', last: false }, 'back'],
    ['recheck · covering · witness shown on the LAST round: still back, not a refusal', { phase: 'recheck', window: 'covering', witness: 'shown', last: true }, 'back'],
    ['recheck · covering · witness hidden', { phase: 'recheck', window: 'covering', witness: 'hidden', last: false }, 'hold'],
    ['recheck · covering · witness unknown: a witness that cannot be reached now has confirmed nothing', { phase: 'recheck', window: 'covering', witness: 'unknown', last: false }, 'hold'],
    ['recheck · covering · witness hidden · last', { phase: 'recheck', window: 'covering', witness: 'hidden', last: true }, 'refuse'],
    ['recheck · covering · witness unknown · last', { phase: 'recheck', window: 'covering', witness: 'unknown', last: true }, 'refuse'],
    // After the one back: still covered is a refusal — never a second back.
    ['afterBack · covering', { phase: 'afterBack', window: 'covering' }, 'refuse'],
    // The dismissal after a fill: hidden is nothing to dismiss; unknown is THE one place unknown means back.
    ['dismiss · window clear (hidden): nothing to dismiss — back would navigate', { phase: 'dismiss', window: 'clear' }, 'proceed'],
    ['dismiss · window unknown: back, as before 2026-10-03 — the witness is not asked', { phase: 'dismiss', window: 'unknown' }, 'back'],
    ['dismiss · covering · witness shown', { phase: 'dismiss', window: 'covering', witness: 'shown' }, 'back'],
    ['dismiss · covering · witness unknown', { phase: 'dismiss', window: 'covering', witness: 'unknown' }, 'back'],
    ['dismiss · covering · witness hidden: the veto, nothing pressed', { phase: 'dismiss', window: 'covering', witness: 'hidden' }, 'hold'],
  ])('%s → %s', (_name, sample, expected) => {
    expect(keyboardAction(sample)).toBe(expected);
  });

  it('is pure: the same sample judged twice is the same action, and nothing is touched', () => {
    const sample: KeyboardSample = Object.freeze({ phase: 'recheck', window: 'covering', witness: 'hidden', last: true });
    expect([keyboardAction(sample), keyboardAction(sample)]).toEqual(['refuse', 'refuse']);
  });
});

describe('the two window readings — geometry for the guard, presence for the dismissal', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };
  it.each([
    ['shown, point inside the frame', { state: 'shown', frame: FRAME }, { x: 249, y: 1466 }, 'covering'],
    ['shown, point outside the frame (beside it)', { state: 'shown', frame: FRAME }, { x: 249, y: 1000 }, 'clear'],
    ['hidden', { state: 'hidden' }, { x: 249, y: 1466 }, 'clear'],
    ['unknown: kept apart, not folded into clear', { state: 'unknown' }, { x: 249, y: 1466 }, 'unknown'],
  ] as const)('windowOver — %s → %s', (_name, keyboard, point, expected) => {
    expect(windowOver(keyboard, point)).toBe(expected);
  });

  it.each([
    ['shown anywhere', { state: 'shown', frame: FRAME }, 'covering'],
    ['hidden', { state: 'hidden' }, 'clear'],
    ['unknown', { state: 'unknown' }, 'unknown'],
  ] as const)('windowAnywhere — %s → %s', (_name, keyboard, expected) => {
    expect(windowAnywhere(keyboard)).toBe(expected);
  });
});

describe('dismissKeyboard — the table\'s `dismiss` rows (moved here from fill.ts 2026-10-04)', () => {
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };
  const withOracle = (window: Parameters<FakeAdapter['attachKeyboard']>[0], witness?: Parameters<FakeAdapter['attachKeyboard']>[1]) => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    fake.attachKeyboard(window, witness);
    return fake;
  };

  it('an adapter WITHOUT the oracle takes enter, blind, and asks nothing — the iOS shape, whatever the platform label says', async () => {
    for (const platform of ['ios', 'android'] as const) {
      const fake = new FakeAdapter({ s: screen() }, 's');
      fake.platform = platform;
      await dismissKeyboard(fake);
      expect(fake.keys).toEqual(['enter']);
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
