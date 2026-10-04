import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { DEFAULT_FOCUS_DELAY_MS, DEFAULT_VALUE_POLL_MS, dismissKeyboard, fillField } from '../../src/interact/fill.js';
import { el, FakeAdapter, resetLayout, screen } from '../helpers/fake.js';

// The one sleep owner (util/sleep.ts) is recorded, not waited on: a cadence
// is a sequence of delays, and asserting the sequence is exact where a wall
// clock is a flake (review 2026-10-03). Every test in this file runs on the
// no-op; the deadline-based ones still end, on Date.now.
const { sleeps } = vi.hoisted(() => ({ sleeps: [] as number[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    sleeps.push(ms);
  },
}));

/** Tests must not pay the real focus delay; the default is pinned once below. */
const FAST = { ambiguous: 'first' as const, timeoutMs: 200, pollMs: 2 };

function formFake(amountValue: string | null = null) {
  resetLayout();
  return new FakeAdapter(
    {
      form: screen(
        el({ role: 'textfield', identifier: 'amount_input', value: amountValue }),
        el({ role: 'button', identifier: 'submit_button' }),
      ),
    },
    'form',
  );
}

const appendBullets = (fake: FakeAdapter, drop = 0) => {
  fake.typeText = async (text: string) => {
    fake.typed.push(text);
    if (fake.focused) fake.focused.value = (fake.focused.value ?? '') + '•'.repeat(text.length - drop);
  };
};

describe('fillField — focus, clear, type, verify', () => {
  it('taps the field then types; no clearing by default (pre-filled login fields must survive)', async () => {
    const fake = formFake('9.99');
    const result = await fillField(fake, { id: 'amount_input' }, '2.50', FAST);
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['2.50']);
    expect(result).toEqual({ note: undefined, warning: undefined });
  });

  it('accepts the selector-string vocabulary too', async () => {
    const fake = formFake();
    await fillField(fake, 'id:amount_input', '1', FAST);
    expect(fake.typed).toEqual(['1']);
  });

  it('the default focus delay is the measured 350 ms, and the value poll keeps the 400 ms the type_text tool always had', () => {
    expect(DEFAULT_FOCUS_DELAY_MS).toBe(350);
    expect(DEFAULT_VALUE_POLL_MS).toBe(400);
  });

  it('with no timing options the delays are: one settle pause (500), the focus delay (350), then five value rounds at 400', async () => {
    // Derived from the code: resolveSettled reads twice with one sleep(500)
    // between (DEFAULT_POLL_MS); the focus tap is followed by sleep(350);
    // a fill whose text never lands runs pollValue's five rounds, each ending
    // in sleep(400) (DEFAULT_VALUE_POLL_MS); without `clear` there is no
    // retry. Had the value poll quietly taken the settle default, the last
    // five would read 500.
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
    };
    sleeps.length = 0;
    await expect(fillField(fake, { id: 'amount_input' }, '12.34', { ambiguous: 'first' })).rejects.toThrow(/typed 5 characters/);
    expect(sleeps).toEqual([500, 350, 400, 400, 400, 400, 400]);
  });

  it('clear: true deletes the existing value length before typing', async () => {
    const fake = formFake('2.50');
    await fillField(fake, { id: 'amount_input' }, '7', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([4]); // "2.50".length
    expect(fake.typed).toEqual(['7']);
  });

  it('clear on an empty field skips deleting', async () => {
    const fake = formFake(null);
    await fillField(fake, { id: 'amount_input' }, '1.00', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['1.00']);
  });

  it('verifies the typed value landed and retries a clear-fill whose input was dropped', async () => {
    // Compose async state can swallow synthetic input (measured 2026-08-05:
    // bulk typing landed 3 of 11 chars). First typeText drops chars; the
    // verify pass must wipe and retype.
    const fake = formFake('9.99');
    let drops = 1;
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      if (drops-- > 0) return origType(text.slice(-1)); // only the last char lands
      return origType(text);
    };
    await fillField(fake, { id: 'amount_input' }, '12.34', { ...FAST, clear: true });
    // cleared prefill (4), dropped attempt left "4", verify wiped it (1) and retyped
    expect(fake.deletes).toEqual([4, 1]);
    expect(fake.typed).toEqual(['4', '12.34']);
  });

  it('re-clears once when the first clear leaves content behind, and fails after the second', async () => {
    const fake = formFake('2.50');
    let swallow = 1;
    const origClear = fake.clearText.bind(fake);
    fake.clearText = async (count: number) => {
      if (swallow-- > 0) return origClear(Math.max(0, count - 2)); // 2 deletes dropped
      return origClear(count);
    };
    await fillField(fake, { id: 'amount_input' }, '7', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([2, 2]); // first pass left "2.", second cleared the remainder
    expect(fake.typed).toEqual(['7']);

    const stubborn = formFake('2.50');
    stubborn.clearText = async (count: number) => {
      stubborn.deletes.push(count); // nothing ever leaves the field
    };
    await expect(fillField(stubborn, { id: 'amount_input' }, '7', { ...FAST, clear: true })).rejects.toThrow(
      'fill: field still shows 4 characters after clearing twice',
    );
    expect(stubborn.typed).toEqual([]);
  });

  it('fill WITHOUT clear never wipes the field when verification mismatches — it fails instead, lengths only', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text); // drop everything: value never changes
    };
    await expect(fillField(fake, { id: 'amount_input' }, '12.34', FAST)).rejects.toThrow(
      'fill: typed 5 characters but the field shows 4 (content withheld from this error)',
    );
    expect(fake.deletes).toEqual([]); // clear stays opt-in even during verification
  });

  it('an empty value types nothing to verify and returns at once', async () => {
    const fake = formFake('9.99');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    await fillField(fake, { id: 'amount_input' }, '', FAST);
    expect(fake.typed).toEqual(['']);
    expect(reads).toBe(2); // the settle wait only — no value poll
  });

  it("in 'refuse' mode a second match appearing MID-fill is a refusal in its own wording, not a device hint", async () => {
    resetLayout();
    const field = el({ role: 'textfield', identifier: 'amount_input' });
    const before = screen(field);
    const after = screen(field, el({ role: 'textfield', identifier: 'amount_input' })); // a suggestion row / duplicated field
    class SplittingFake extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        return structuredClone(this.typed.length > 0 ? after : before);
      }
    }
    const fake = new SplittingFake({ before }, 'before');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
    };
    const error = await fillField(fake, { id: 'amount_input' }, '1', { ...FAST, ambiguous: 'refuse' }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Selector matches 2 elements: id:"amount_input"/);
    expect((error as Error).message).not.toMatch(/could not re-read|still online/);
  });

  it('a tree that cannot be read mid-fill THROWS rather than passing the fill unverified', async () => {
    const fake = formFake();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (reads++ >= 2) throw new Error('adb: device offline'); // the settle wait succeeded; the value poll cannot read
      return real();
    };
    await expect(fillField(fake, { id: 'amount_input' }, '1', FAST)).rejects.toThrow(
      'fill: could not re-read id:"amount_input" after focusing it — adb: device offline. The field was tapped and may hold partial text; ' +
        'check the device is still online (adb devices / xcrun simctl list), then retry with clear: true so the field is reset',
    );
  });
});

describe('fillField — masked fields verify by length', () => {
  // Measured 2026-09-17 (finportal login, both platforms): a password field reads
  // back as bullets, so `observed === value` could never pass — "typed 16
  // characters but the field shows 16" for a fill that had landed.
  it('a MASKED field (bullets read-back) is verified by LENGTH, so a password fill passes', async () => {
    const fake = formFake(null);
    appendBullets(fake);
    await fillField(fake, { id: 'amount_input' }, 's3cret-passw0rd!', { ...FAST, clear: true });
    expect(fake.typed).toEqual(['s3cret-passw0rd!']);
    expect(fake.deletes).toEqual([]); // nothing to clear, nothing retyped
  });

  it('a masked field that DROPPED characters still fails, and says the comparison was by length', async () => {
    const fake = formFake(null);
    appendBullets(fake, 1);
    await expect(fillField(fake, { id: 'amount_input' }, '12345', FAST)).rejects.toThrow(
      'fill: typed 5 characters but the field shows 4 (masked field — compared by length; it held 0 after focus)',
    );
  });

  it('dropped keystrokes are caught even on a PRE-FILLED masked field (length must reach held + typed)', async () => {
    const fake = formFake('•'.repeat(20));
    appendBullets(fake, 4); // the emulator swallowed 4 of 16
    await expect(fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST)).rejects.toThrow(
      /typed 16 characters but the field shows 32 \(masked field — compared by length; it held 20 after focus\)/,
    );
  });

  it('typing onto a pre-filled masked field without clear is a legal APPEND — it passes, with a warning', async () => {
    // The length rule cannot see content, so it cannot tell this from a correct
    // fill (finportal 2026-09-17: the backend said invalid_grant). The caller says it.
    const fake = formFake('•'.repeat(20));
    appendBullets(fake);
    const { warning } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(36);
    expect(warning).toBe('masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace');
  });

  // Review 2026-09-18: the pre-tap read is stale for both shapes below, and a
  // `preLen` taken from it failed two correct fills.
  it('autofill that POPULATES a masked field on focus does not fail the fill (pre-fill re-read after focus)', async () => {
    const fake = formFake(null);
    const origTap = fake.tap.bind(fake);
    fake.tap = async (x: number, y: number) => {
      await origTap(x, y);
      if (fake.focused) fake.focused.value = '•'.repeat(20); // autofill on focus
    };
    appendBullets(fake);
    const { warning } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(36);
    expect(warning).toContain('typing APPENDS'); // and the append is still named
  });

  it('a re-entry screen that CLEARS the masked field on focus does not fail the fill', async () => {
    const fake = formFake('•'.repeat(20));
    const origTap = fake.tap.bind(fake);
    fake.tap = async (x: number, y: number) => {
      await origTap(x, y);
      if (fake.focused) fake.focused.value = null; // wrong-PIN re-entry clears on focus
    };
    appendBullets(fake);
    const { warning } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(16);
    expect(warning).toBeUndefined(); // nothing was held after focus
  });
});

describe('dismissKeyboard — the per-platform key, as its own call', () => {
  const keyed = (platform: 'android' | 'ios') => {
    const fake = formFake();
    fake.platform = platform;
    return fake;
  };
  const FRAME = { x: 0, y: 1285, width: 1080, height: 935 };

  it('Android, keyboard shown: back — it hides the keyboard', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'shown', frame: FRAME };
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(['back']);
    expect(fake.keyboardQueries).toBe(1);
  });

  it('Android, window state shown and the independent witness CONFIRMS it: back, the witness asked once', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'shown', frame: FRAME };
    fake.keyboardWitness = 'shown';
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(['back']);
    expect(fake.witnessQueries).toBe(1);
  });

  it('Android, window state shown but the witness DENIES it (stale window state): no key pressed — back would navigate', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'shown', frame: FRAME };
    fake.keyboardWitness = 'hidden';
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual([]);
    expect(fake.witnessQueries).toBe(1);
  });

  it('Android, window state shown and the witness cannot tell: back, as before 2026-10-04', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'shown', frame: FRAME };
    fake.keyboardWitness = 'unknown';
    const order: string[] = [];
    const ask = fake.softKeyboardWitness.bind(fake);
    fake.softKeyboardWitness = async () => (order.push('witness?'), ask());
    fake.onKey = (key) => void order.push(`key:${key}`);
    await dismissKeyboard(fake);
    expect(order).toEqual(['witness?', 'key:back']); // asked BEFORE the key
  });

  it('Android, window state hidden or unknown: the witness is not asked (hidden presses nothing, unknown presses back as before)', async () => {
    for (const [state, keys] of [['hidden', []], ['unknown', ['back']]] as const) {
      const fake = keyed('android');
      fake.keyboard = { state };
      fake.keyboardWitness = 'hidden';
      await dismissKeyboard(fake);
      expect(fake.keys).toEqual(keys);
      expect(fake.witnessQueries).toBe(0);
    }
  });

  it('Android, keyboard HIDDEN: no key at all — back with no keyboard up would navigate away', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'hidden' };
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual([]);
  });

  it('Android, adapter cannot tell (unknown): back, exactly as before 2026-10-03', async () => {
    const fake = keyed('android');
    fake.keyboard = { state: 'unknown' };
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(['back']);
  });

  it('iOS has no back key: it takes enter, and asks nothing — even of an adapter that would say hidden', async () => {
    const fake = keyed('ios');
    fake.keyboard = { state: 'hidden' };
    await dismissKeyboard(fake);
    expect(fake.keys).toEqual(['enter']);
    expect(fake.keyboardQueries).toBe(0);
    expect(fake.witnessQueries).toBe(0);
  });

  it('fillField itself never presses a key — the caller dismisses after it has the warning in hand', async () => {
    const fake = keyed('android');
    await fillField(fake, { id: 'amount_input' }, '2.50', FAST);
    expect(fake.keys).toEqual([]);
  });
});

describe('fillField — resolution is the shared policy', () => {
  it('prefers the interactive match when the title label shares the field id, and reports it', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        form: screen(
          el({ role: 'text', identifier: 'amount_input', label: 'Amount' }),
          el({ role: 'textfield', identifier: 'amount_input' }),
        ),
      },
      'form',
    );
    const { note } = await fillField(fake, 'id:amount_input', '5', FAST);
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.focused?.role).toBe('textfield');
    expect(note).toBe('2 matches; picked the only interactive one (textfield)');
  });

  it('a field that never appears fails with the settle wording before anything is typed', async () => {
    const fake = formFake();
    await expect(fillField(fake, { id: 'nope' }, '1', { ...FAST, timeoutMs: 10 })).rejects.toThrow(
      /Timed out after 10ms waiting for element id:"nope" \(visible and settled\)/,
    );
    expect(fake.typed).toEqual([]);
  });

  it("in 'refuse' mode two password-shaped fields are refused, and nothing is tapped or typed", async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { s: screen(el({ role: 'textfield', identifier: 'username' }), el({ role: 'textfield', identifier: 'password' })) },
      's',
    );
    await expect(fillField(fake, 'role:textfield', 'hunter2', { ...FAST, ambiguous: 'refuse' })).rejects.toThrow(
      /Selector matches 2 elements: role:textfield\n  textfield id=username label=null\n  textfield id=password label=null/,
    );
    expect(fake.taps).toEqual([]);
    expect(fake.typed).toEqual([]);
  });
});
