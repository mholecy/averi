import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rect, UiNode } from '../../src/adapters/types.js';
import { fillField } from '../../src/interact/fill.js';
import {
  AfterKeyboardDismissal,
  KEYBOARD_DISAGREEMENT_BUDGET_MS,
  KEYBOARD_DISAGREEMENT_POLL_MS,
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
  const REFUSAL =
    'The soft keyboard covers id:login_submit: the band it draws over [0,539][402,874] contains the tap point (107,571) on two looks ' +
    `${KEYBOARD_HIDE_DELAY_MS}ms apart, and this adapter cannot hide it (${ADVICE}). Nothing was tapped: the tap would have pressed the ` +
    'keyboard and been reported done. From the MCP tools: hide the keyboard first, then tap id:login_submit again. In a flow: hide it ' +
    'with a step before this one (a tap: on an element the keyboard does not cover), or lay the screen out so id:login_submit is not under the keyboard';

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
    await expect(tapElement(fake, 'id:login_submit', FAST)).rejects.toThrow(/and this adapter cannot hide it\. Nothing was tapped/);
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
