import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { DEFAULT_FOCUS_DELAY_MS, DEFAULT_VALUE_POLL_MS, fillField } from '../../src/interact/fill.js';
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
    expect(fake.typed).toEqual(['']); // deliberate: the "" reaches the adapter, whose contract makes it a no-op — fillField adds no second guard
    expect(reads).toBe(2); // the settle wait only — no value poll
  });

  // docs/bugs/2026-10-07-ios-fill-empty-value-fails-in-idb.md: a `fill` with
  // value "" is "clear this field" with clear and "focus without typing"
  // without. On iOS it threw idb's bare error after the tap — and after the
  // clear, so the field ended as asked and the step failed. The guard is the
  // adapter's (DeviceAdapter.typeText: "" types nothing); what is pinned here
  // is that the fill still hands "" over, clears, and asks nothing more.
  it('value "" with clear: true clears the field and passes — the "" goes to the adapter, nothing is read back or retyped', async () => {
    const fake = formFake('2.50');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    const result = await fillField(fake, { id: 'amount_input' }, '', { ...FAST, clear: true });
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([4]); // "2.50".length
    expect(fake.typed).toEqual(['']); // deliberate: the "" reaches the adapter, whose contract makes it a no-op — fillField adds no second guard
    expect(fake.focused?.value ?? '').toBe(''); // the fake appends the "" to a cleared (null) field: nothing held
    expect(reads).toBe(4); // the settle wait, the post-focus read the loop counts from, the one that confirms the clear — no value poll
    expect(result).toEqual({ note: undefined, warning: undefined });
  });

  it('value "" with clear: true clears what the field holds AFTER focus — a field that autofills on focus ends empty', async () => {
    // A clear alone has no read-back to catch an autofill (review 2026-09-18
    // measured Android populating a password field on focus), so the loop
    // counts from a post-focus read, not the pre-tap tree that showed nothing.
    const fake = formFake(null);
    const origTap = fake.tap.bind(fake);
    fake.tap = async (x: number, y: number) => {
      await origTap(x, y);
      if (fake.focused) fake.focused.value = '•'.repeat(20); // autofill on focus
    };
    await fillField(fake, { id: 'amount_input' }, '', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([20]);
    expect(fake.focused?.value ?? '').toBe('');
  });

  it('value "" without clear is the focus tap alone: nothing deleted, no post-focus re-read, and no append warning on a held masked field', async () => {
    // The masked-append warning names a typing; a focus-only fill did none,
    // so the post-focus re-read that feeds it (and the length rule, which an
    // empty value never runs) is skipped too.
    const fake = formFake('•'.repeat(20));
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    const result = await fillField(fake, { id: 'amount_input' }, '', FAST);
    expect(fake.taps).toEqual(['amount_input']);
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['']); // deliberate: the "" reaches the adapter, whose contract makes it a no-op — fillField adds no second guard
    expect(fake.focused?.value).toHaveLength(20);
    expect(reads).toBe(2); // the settle wait only
    expect(result).toEqual({ note: undefined, warning: undefined });
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

// The dismissal itself (`dismissKeyboard`) is keyboard.ts's since 2026-10-04 and
// is pinned in tests/interact/keyboard.test.ts. What stays here is the seam
// between the two calls.
describe('fillField and the keyboard dismissal are two calls', () => {
  it('fillField itself never presses a key — the caller dismisses after it has the warning in hand', async () => {
    const fake = formFake();
    fake.attachKeyboard({ state: 'shown', frame: { x: 0, y: 1285, width: 1080, height: 935 } }, 'shown');
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
