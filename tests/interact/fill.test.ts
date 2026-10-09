import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { DEFAULT_FOCUS_DELAY_MS, DEFAULT_VALUE_POLL_MS, fillField } from '../../src/interact/fill.js';
import type { ReadBack } from '../../src/interact/fill-facts.js';
import { judgeFill } from '../../src/interact/fill-verdict.js';
import { fillReply, wordingOf } from '../../src/interact/fill-text.js';
import { el, FakeAdapter, idbFloatingLabelFake, node, resetLayout, screen } from '../helpers/fake.js';

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
    expect(result).toEqual({ note: undefined, maskedAppend: undefined, role: 'textfield', typed: 4, readBack: { kind: 'landed' } });
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

  it('re-clears once when the first clear leaves content behind, and fails after the second if the deletes keep landing short', async () => {
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

    // Every round CHANGES the field (one delete of each lands), and none
    // empties it: deletes are being dropped — still the clear-twice failure,
    // before anything is typed.
    const leaky = formFake('2.50');
    const leakyClear = leaky.clearText.bind(leaky);
    leaky.clearText = async (count: number) => {
      await leakyClear(1);
      leaky.deletes.splice(-1, 1, count); // record what was SENT
    };
    await expect(fillField(leaky, { id: 'amount_input' }, '7', { ...FAST, clear: true })).rejects.toThrow(
      'fill: field still shows 2 characters after clearing twice',
    );
    expect(leaky.deletes).toEqual([4, 3]);
    expect(leaky.typed).toEqual([]);
  });

  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md.
  // Until 2026-10-09 this field threw `field still shows 4 characters after
  // clearing twice` before typing. A field whose deletes change NOTHING is
  // indistinguishable, in the tree, from an EMPTY field showing its hint or
  // placeholder as its value — which every tree source reports, and which
  // that throw failed on every hinted stock EditText. So the clear stops on
  // the unchanged round and the exact read-back decides: a field that truly
  // ignores deletes still fails, but only after the value was typed into it
  // (twice: the mismatch retry's wipe is ignored as well).
  it('a field whose deletes change nothing (indistinguishable from an empty hinted field): one round, then typed, and the exact read-back fails it', async () => {
    const stubborn = formFake('2.50');
    stubborn.clearText = async (count: number) => {
      stubborn.deletes.push(count); // nothing ever leaves the field
    };
    await expect(fillField(stubborn, { id: 'amount_input' }, '7', { ...FAST, clear: true })).rejects.toThrow(
      'fill: typed 1 character but the field shows 6 (content withheld from this error)',
    );
    expect(stubborn.deletes).toEqual([4, 5]); // the unchanged round, then the retry's wipe of "2.507"
    expect(stubborn.typed).toEqual(['7', '7']);
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
    expect(result).toEqual({ note: undefined, maskedAppend: undefined, role: 'textfield', typed: 0, cleared: 4, readBack: { kind: 'nothing-typed' } });
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
    expect(result).toEqual({ note: undefined, maskedAppend: undefined, role: 'textfield', typed: 0, readBack: { kind: 'nothing-typed' } });
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
    const { maskedAppend } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(36);
    expect(maskedAppend).toEqual({ held: 20 }); // its sentence is fill-text.ts's (fill-text.test.ts)
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
    const { maskedAppend } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(36);
    expect(maskedAppend).toEqual({ held: 20 }); // and the append is still named — what autofill put there, read after focus
  });

  it('a re-entry screen that CLEARS the masked field on focus does not fail the fill', async () => {
    const fake = formFake('•'.repeat(20));
    const origTap = fake.tap.bind(fake);
    fake.tap = async (x: number, y: number) => {
      await origTap(x, y);
      if (fake.focused) fake.focused.value = null; // wrong-PIN re-entry clears on focus
    };
    appendBullets(fake);
    const { maskedAppend } = await fillField(fake, { id: 'amount_input' }, 'hunter2-password', FAST);
    expect(fake.focused?.value).toHaveLength(16);
    expect(maskedAppend).toBeUndefined(); // nothing was held after focus
  });
});

// The dismissal itself (`dismissKeyboard`) is keyboard.ts's since 2026-10-04 and
// is pinned per model in tests/interact/keyboard-window.test.ts and
// keyboard-in-tree.test.ts. What stays here is the seam between the two calls.
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
      /Timed out after 10ms waiting for element id:"nope" to appear/,
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

/**
 * What text averi types (interact/type-text.ts, code review 2026-10-07): a
 * value holding a control character is refused BEFORE any device call. The
 * refusal used to be the Android adapter's alone — reached after the fill's
 * focus tap and clear, so a refused value wiped the field and then failed —
 * and iOS typed the characters. Every adapter method is recorded through a
 * proxy, so "no device call" means none at all, a tree read included.
 */
describe('fillField refuses a control character before anything is sent', () => {
  const recorded = (fake: FakeAdapter) => {
    const calls: string[] = [];
    const proxy = new Proxy(fake, {
      get(target, prop, receiver) {
        const v = Reflect.get(target, prop, receiver);
        if (typeof v !== 'function') return v;
        return (...args: unknown[]) => {
          calls.push(String(prop));
          return (v as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    return { proxy, calls };
  };
  const cases: [string, string][] = [
    ['\n', 'U+000A'],
    ['\r', 'U+000D'],
    ['\t', 'U+0009'],
    ['\x1b', 'U+001B'],
    ['\v', 'U+000B'],
    ['\f', 'U+000C'],
    ['\x00', 'U+0000'],
    ['\x7f', 'U+007F'],
  ];
  for (const platform of ['android', 'ios'] as const) {
    for (const [ch, code] of cases) {
      it(`${platform}: ${code} with clear: true → refused, no tree read, no tap, no clear, nothing typed; the field keeps its text`, async () => {
        const fake = formFake('9.99');
        fake.platform = platform;
        const { proxy, calls } = recorded(fake);
        const fill = fillField(proxy, { id: 'amount_input' }, `ab${ch}cd`, { ...FAST, clear: true });
        await expect(fill).rejects.toThrow(`cannot type ${code}`);
        await expect(fill).rejects.toThrow(/pressKey\('enter'\)/);
        expect(calls).toEqual([]);
        expect(fake.taps).toEqual([]);
        expect(fake.deletes).toEqual([]);
        expect(fake.typed).toEqual([]);
      });
    }
  }

  it('the error names the character by code point and never quotes the value around it (values may be credentials)', async () => {
    const fake = formFake();
    await expect(fillField(fake, { id: 'amount_input' }, 'hunter2\n', FAST)).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('hunter2') }),
    );
  });

  it('printable text — a space, non-ASCII, a C1-range letter — is typed as before', async () => {
    const fake = formFake();
    await fillField(fake, { id: 'amount_input' }, 'a b é\u0085', FAST);
    expect(fake.typed).toEqual(['a b é\u0085']);
  });
});

// docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md:
// a floating-label `text` node selected by its label was reported "Filled …
// (22 characters, cleared first)" with nothing cleared and nothing typed.
describe('fillField — what it did, not what was asked (measured iOS idb shapes, 2026-10-08)', () => {
  const inputOf = (fake: FakeAdapter) => fake.live().children.find((n) => n.role === 'textfield');

  it('a floated label (value held, label above the input): no delete, nothing typed — NOT verified, clear unmeasured, the input named', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const result = await fillField(fake, 'text:"IBAN*"', 'DE89370400440532013000', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([]); // the label has no value: no length, no delete
    expect(inputOf(fake)?.value).toBe('XX12345'); // nothing reached the field — as measured
    expect(result).toMatchObject({ role: 'text', cleared: 'unmeasured', readBack: { kind: 'no-value' } });
    expect(result.notInput).toEqual({
      input: { identifier: 'TextFieldWithComponentStyle', rect: { x: 26, y: 366, width: 350, height: 30 }, overlaps: false },
    });
  });

  it('a label over the empty input: the tap focuses the field and the text lands — still NOT verified (the label is read back), warned not refused', async () => {
    const fake = idbFloatingLabelFake('Value*', null);
    const result = await fillField(fake, 'text:"Value*"', '7.25', { ...FAST, clear: true });
    expect(inputOf(fake)?.value).toBe('7.25'); // a refusal would have broken this fill
    expect(result).toMatchObject({ role: 'text', cleared: 'unmeasured', readBack: { kind: 'no-value' } });
    expect(result.notInput).toEqual({ input: expect.objectContaining({ overlaps: true }) });
  });

  it('the input itself by its old value: the clear and the read-back find it again by identity, so the fill is verified', async () => {
    // Before 2026-10-08 the `value:` selector stopped matching after the
    // clear, which read as "empty" (clear done) and as "no value" (read-back).
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const result = await fillField(fake, 'role:textfield value:"XX12345"', 'DE89370400440532013000', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([7]);
    expect(inputOf(fake)?.value).toBe('DE89370400440532013000');
    expect(result).toMatchObject({ role: 'textfield', cleared: 7, readBack: { kind: 'landed' }, notInput: undefined });
  });

  it('a field that MOVED after focus is not found by identity: the read-back stays NOT verified rather than guessing', async () => {
    const fake = idbFloatingLabelFake('IBAN*', null);
    fake.onTap = (_id, self) => {
      const input = self.live().children.find((n) => n.role === 'textfield');
      if (input !== undefined) input.rect = { ...input.rect, y: 200 }; // the keyboard pushed the form up
    };
    const result = await fillField(fake, 'role:textfield', 'abc', FAST);
    expect(result).toMatchObject({ role: 'textfield', readBack: { kind: 'landed' } }); // a role selector still matches the moved field
    const byValue = idbFloatingLabelFake('IBAN*', 'XX');
    byValue.onTap = fake.onTap;
    const moved = await fillField(byValue, 'role:textfield value:"XX"', 'abc', { ...FAST, clear: true });
    expect(moved).toMatchObject({ readBack: { kind: 'lost', why: 'unmatched' } }); // not found — not "exposes no value"
  });

  it('a node of another role whose value TOOK the text is an input whatever its role: no not-input finding', async () => {
    resetLayout();
    const search = el({ role: 'other', identifier: 'search', value: null }); // an iOS SearchField reads `other`
    const fake = new FakeAdapter({ s: screen(search) }, 's');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      const live = fake.live().children[0];
      live.value = (live.value ?? '') + text;
    };
    const result = await fillField(fake, 'id:search', 'milk', FAST);
    expect(result).toMatchObject({ role: 'other', readBack: { kind: 'landed' }, notInput: undefined });
  });

  // m-4 (review 2026-10-08): a WDA StaticText exposes its label as its value.
  it('a non-input whose value never changes is NOT the field: no throw, no delete, readBack not-taken, the input named', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { s: screen(node({ role: 'text', identifier: 'title', value: 'Meno', rect: { x: 0, y: 0, width: 100, height: 10 } }), el({ role: 'textfield', identifier: 'name' })) },
      's',
    );
    const appended = await fillField(fake, 'id:title', 'e', FAST); // "Meno".includes("e") — no proof
    expect(appended).toMatchObject({ role: 'text', readBack: { kind: 'not-taken' }, notInput: { input: expect.objectContaining({ identifier: 'name' }) } });
    const cleared = await fillField(fake, 'id:title', 'abc', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([]); // m-5: "Meno".length is not the field's
    expect(cleared).toMatchObject({ cleared: 'unmeasured', readBack: { kind: 'not-taken' } });
  });

  // m2-1 (review 2026-10-08, round 2): the retry deleted the label's length into the focused field.
  it('a label whose value changes on focus (`Name` → `Name*`) is not the field: no delete into the focused one, not-taken', async () => {
    resetLayout();
    const label = node({ role: 'text', identifier: 'name_label', value: 'Name', rect: { x: 0, y: 0, width: 100, height: 10 } });
    const field = node({ role: 'textfield', identifier: 'name', value: 'jan.novak', rect: { x: 0, y: 20, width: 100, height: 10 } });
    const fake = new FakeAdapter({ s: screen(label, field) }, 's');
    const liveField = () => fake.live().children[1];
    fake.onTap = (_id, self) => {
      self.live().children[0].value = 'Name*'; // the label marks focus
      self.focused = liveField(); // and the tap focused the field under it
    };
    const result = await fillField(fake, 'id:name_label', 'abc', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([]); // not clearText(5) into "jan.novak"
    expect(liveField().value).toBe('jan.novakabc'); // typed, unchecked — as the reply says
    expect(result).toMatchObject({ cleared: 'unmeasured', readBack: { kind: 'not-taken' }, notInput: { input: expect.objectContaining({ identifier: 'name' }) } });
  });

  it('a non-input that shows the typed text but never exactly the value fails after the retry, and the error names the input it is not', async () => {
    resetLayout();
    const title = node({ role: 'text', identifier: 'title', value: null, rect: { x: 0, y: 0, width: 100, height: 10 } });
    const fake = new FakeAdapter({ s: screen(title, el({ role: 'textfield', identifier: 'name' })) }, 's');
    const live = () => fake.live().children[0];
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      live().value = (live().value ?? '') + text + '!'; // it takes the text, and decorates it
    };
    fake.clearText = async (count: number) => {
      fake.deletes.push(count);
      live().value = (live().value ?? '').slice(0, -count) || null;
    };
    await expect(fillField(fake, 'id:title', 'abc', { ...FAST, clear: true })).rejects.toThrow(
      /^fill: typed 3 characters but the field shows 4 \(content withheld from this error\); the matched node is role text, not a textfield — .* the nearest input is textfield id:"name"/,
    );
    expect(fake.deletes).toEqual([4]); // the retry's wipe of what it showed: "abc!"
  });

  it('M-1: a clear ALONE on a label with no value sends no delete and says so — not an empty field', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const result = await fillField(fake, 'text:"IBAN*"', '', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([]);
    expect(inputOf(fake)?.value).toBe('XX12345');
    expect(result).toMatchObject({ role: 'text', cleared: 'unmeasured', readBack: { kind: 'nothing-typed' } });
  });

  it('an input-like node of another role (an iOS search field reads `other`) with clear still ends as the value: the retry wipes it', async () => {
    resetLayout();
    const search = el({ role: 'other', identifier: 'search', value: 'old' });
    const fake = new FakeAdapter({ s: screen(search) }, 's');
    const live = () => fake.live().children[0];
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      live().value = (live().value ?? '') + text;
    };
    fake.clearText = async (count: number) => {
      fake.deletes.push(count);
      live().value = (live().value ?? '').slice(0, -count) || null;
    };
    const result = await fillField(fake, 'id:search', 'milk', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([7]); // "oldmilk" — the observed value, not the unmeasured start
    expect(live().value).toBe('milk');
    expect(result).toMatchObject({ role: 'other', cleared: 'unmeasured', readBack: { kind: 'landed' }, notInput: undefined });
  });

  // m-2 (review 2026-10-08): identity is not screen identity.
  it('the identity fallback does not read a NEXT screen whose field shares the id and rect', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const next = node({
      role: 'container',
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [
        node({ role: 'textfield', identifier: 'TextFieldWithComponentStyle', value: 'DE89370400440532013000', rect: { x: 26, y: 366, width: 350, height: 30 } }),
        node({ role: 'button', identifier: 'confirm', rect: { x: 26, y: 600, width: 350, height: 40 } }),
      ],
    });
    (fake as unknown as { screens: Record<string, UiNode> }).screens.next = next;
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      await origType(text);
      fake.current = 'next'; // typing submitted and navigated
    };
    const result = await fillField(fake, 'role:textfield value:"XX12345"', 'abc', { ...FAST, clear: true });
    expect(result).toMatchObject({ readBack: { kind: 'lost', why: 'screen-changed' } }); // not a false "landed" off screen B's field
  });

  // iOS device check (2026-10-08, re-run at e9e6509): the IBAN field held
  // `XX12345` with an inline `iban_input_error` under it; the clear and the
  // typing landed, the error went away and an `iban_notice` appeared — the
  // screen's id set changed, so the identity fallback rightly refused. The
  // reply then said the TEXTFIELD "exposes no value" — a node that had just
  // had 7 characters deleted. Not found is said as not found, and an input
  // that was not found gets no not-a-textfield ⚠.
  it('the screen\'s ids change while typing (an inline error goes, a notice comes): readBack lost, screen-changed — not no-value, no not-input finding', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const children = () => fake.live().children;
    children().push(node({ role: 'text', identifier: 'iban_input_error', label: 'Invalid IBAN', rect: { x: 26, y: 400, width: 350, height: 15 } }));
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      await origType(text);
      const at = children().findIndex((n) => n.identifier === 'iban_input_error');
      children().splice(at, 1, node({ role: 'text', identifier: 'iban_notice', label: 'Check the IBAN', rect: { x: 26, y: 400, width: 350, height: 15 } }));
    };
    const result = await fillField(fake, 'role:textfield value:"XX12345"', 'DE89370400440532013000', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([7]);
    expect(inputOf(fake)?.value).toBe('DE89370400440532013000'); // the field DID hold the text — as measured
    expect(result).toMatchObject({ role: 'textfield', cleared: 7, readBack: { kind: 'lost', why: 'screen-changed' }, notInput: undefined });
    expect(judgeFill(result)).toMatchObject({ did: 'typed', reasons: [{ code: 'lost', why: 'screen-changed' }], caveats: [] });
  });

  it('counts are singular for one: `1 character` in the clear-twice error', async () => {
    resetLayout();
    const fake = new FakeAdapter({ s: screen(el({ role: 'textfield', identifier: 'pin', value: 'xyz' })) }, 's');
    fake.clearText = async (count: number) => {
      fake.deletes.push(count);
      const f = fake.live().children[0];
      f.value = (f.value ?? '').slice(0, -1); // one delete per round lands: "xy", then "x"
    };
    await expect(fillField(fake, 'id:pin', '', { ...FAST, clear: true })).rejects.toThrow('fill: field still shows 1 character after clearing twice');
  });

  // m-2 (review 2026-10-08, bundle C round 1): `lost` is the LAST read's finding, reset on every read.
  it('a first read after typing that misses the field, then one that finds it with no value: no-value, no `lost`', async () => {
    const fake = idbFloatingLabelFake('IBAN*', null);
    const real = fake.uiTree.bind(fake);
    let typed = false;
    let hidden = false;
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (text: string) => {
      await origType(text);
      typed = true;
    };
    fake.uiTree = async () => {
      const tree = await real();
      if (!typed || hidden) return tree;
      hidden = true; // only the first read after typing misses the label
      return { ...tree, children: tree.children.filter((n) => n.role !== 'text') };
    };
    const result = await fillField(fake, 'text:"IBAN*"', 'DE89', FAST);
    expect(hidden).toBe(true);
    expect(result.readBack.kind).toBe('no-value');
    expect(result.readBack).toEqual({ kind: 'no-value' }); // no reason rides on any kind but lost
  });

  // m-1 (review 2026-10-08, bundle C round 1): the read after the first
  // delete lost the field (the keyboard moved it, the value selector no
  // longer matches), which read as "empty" — `Filled … (0 characters,
  // cleared 7 characters first)` while the field still held `XX`.
  describe('a clear whose read after the delete does not find the field', () => {
    const probe = () => {
      const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
      const input = () => fake.live().children.find((n) => n.role === 'textfield')!;
      fake.clearText = async (count: number) => {
        fake.deletes.push(count);
        const f = input();
        f.value = (f.value ?? '').slice(0, -5) || null; // only 5 of the 7 went
        f.rect = { ...f.rect, y: 200 }; // and the keyboard pushed the form up
      };
      return { fake, input };
    };

    it('a clear alone is NOT verified: readBack lost, unmatched — never a verified empty field', async () => {
      const { fake, input } = probe();
      const result = await fillField(fake, 'role:textfield value:"XX12345"', '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([7]); // sent once; the loop does not delete blind
      expect(input().value).toBe('XX');
      expect(result).toMatchObject({ role: 'textfield', cleared: 7, readBack: { kind: 'lost', why: 'unmatched' }, notInput: undefined });
      expect(judgeFill(result)).toMatchObject({ did: 'cleared', sent: { what: 'deletes', n: 7 }, reasons: [{ code: 'lost', why: 'unmatched' }] });
    });

    it('with a value, the read-back decides: not landed, and still lost', async () => {
      const { fake } = probe();
      const result = await fillField(fake, 'role:textfield value:"XX12345"', 'DE89', { ...FAST, clear: true });
      expect(result).toMatchObject({ cleared: 7, readBack: { kind: 'lost' } });
    });
  });

  it('a lost read-back carries its reason into the verdict — a lost without one does not compile (code review of round 2)', () => {
    expect(judgeFill({ role: 'textfield', typed: 3, readBack: { kind: 'lost', why: 'unmatched' } }).reasons).toEqual([{ code: 'lost', why: 'unmatched' }]);
    expect(judgeFill({ role: 'textfield', typed: 3, readBack: { kind: 'lost', why: 'screen-changed' } }).reasons).toEqual([{ code: 'lost', why: 'screen-changed' }]);
    // @ts-expect-error — the reason is part of the kind: a `lost` read-back cannot be built without it.
    const reasonless: ReadBack = { kind: 'lost' };
    expect(reasonless.kind).toBe('lost');
  });

  it('a node that IS found but shows no value is still no-value, with no `lost`', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    const result = await fillField(fake, 'text:"IBAN*"', 'DE89', FAST);
    expect(result.readBack.kind).toBe('no-value');
    expect(result.readBack).toEqual({ kind: 'no-value' }); // no reason rides on any kind but lost
  });

  it('the identity fallback is not asked after typing when nothing was read before it', async () => {
    // Without clear on a plain field holding text, no tree is read before
    // typing: there is no screen to compare with, so the value selector's
    // read-back is honestly unverifiable.
    const fake = idbFloatingLabelFake('IBAN*', 'XX');
    const result = await fillField(fake, 'role:textfield value:"XX"', 'abc', FAST);
    expect(inputOf(fake)?.value).toBe('XXabc');
    expect(result).toMatchObject({ readBack: { kind: 'lost', why: 'unmatched' } });
  });

  describe('sameField matches exactly one node of the same role, id and rect', () => {
    const at = { x: 26, y: 366, width: 350, height: 30 };
    const fill = (extra: UiNode) => {
      const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
      fake.live().children.push(extra);
      return fillField(fake, 'role:textfield value:"XX12345"', 'DE89', { ...FAST, clear: true });
    };
    it('a second twin (same role, id, rect) makes it refuse: NOT verified', async () => {
      // With the twin the selector is two matches pre-tap; 'first' picks the real field.
      const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
      fake.live().children.push(node({ role: 'textfield', identifier: 'TextFieldWithComponentStyle', value: 'other', rect: { ...at } }));
      const result = await fillField(fake, 'role:textfield value:"XX12345"', 'DE89', { ...FAST, clear: true });
      expect(result).toMatchObject({ readBack: { kind: 'lost', why: 'unmatched' } });
    });
    it('a node at the same rect with another role, or another id, is not a twin: verified', async () => {
      expect((await fill(node({ role: 'text', identifier: 'TextFieldWithComponentStyle', rect: { ...at } }))).readBack.kind).toBe('landed');
      expect((await fill(node({ role: 'textfield', identifier: 'other_id', rect: { ...at } }))).readBack.kind).toBe('landed');
    });
  });

  it('the nearest input is named by its identifier only — never its label or value, which may be a credential', async () => {
    resetLayout();
    const fake = new FakeAdapter(
      {
        s: screen(
          node({ role: 'text', identifier: 'pw_label', label: 'Password', rect: { x: 0, y: 0, width: 100, height: 10 } }),
          node({ role: 'textfield', identifier: null, label: 'hunter2', value: 'hunter2', rect: { x: 0, y: 20, width: 100, height: 10 } }),
          node({ role: 'textfield', identifier: 'collapsed', rect: { x: 50, y: 0, width: 0, height: 10 } }), // zero-area, touching the label: never a candidate
        ),
      },
      's',
    );
    const result = await fillField(fake, 'id:pw_label', 'x', FAST);
    expect(result.notInput).toEqual({ input: { identifier: null, rect: { x: 0, y: 20, width: 100, height: 10 }, overlaps: false } });
    const sentence = wordingOf(judgeFill(result)).caveats.join('\n');
    expect(sentence).not.toContain('hunter2');
    expect(sentence).toContain('the nearest input is textfield at 0,20 100x10');
  });

  it('the not-input finding reuses the read-back\'s tree; only a fill with no read at all reads one', async () => {
    const fake = idbFloatingLabelFake('IBAN*', 'XX12345');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    await fillField(fake, 'text:"IBAN*"', 'a', FAST);
    expect(reads).toBe(5); // settle (2) + post-focus length read (1) + value poll (2) — no extra read for the finding
    reads = 0;
    await fillField(fake, 'text:"IBAN*"', '', FAST);
    expect(reads).toBe(3); // settle (2) + the one read the finding needs
  });

  it('a dropped clear re-cleared on its second pass still reports what the field held when the clear BEGAN', async () => {
    const fake = formFake('2.50');
    let swallow = 1;
    const origClear = fake.clearText.bind(fake);
    fake.clearText = async (count: number) => {
      if (swallow-- > 0) return origClear(Math.max(0, count - 2));
      return origClear(count);
    };
    const result = await fillField(fake, { id: 'amount_input' }, '7', { ...FAST, clear: true });
    expect(result.cleared).toBe(4); // not the 2 the second pass deleted
  });

  it('Android: an EditText resolved directly is verified, says what it cleared, and carries no finding', async () => {
    const fake = formFake('2.50');
    const result = await fillField(fake, { id: 'amount_input' }, '7', { ...FAST, clear: true });
    expect(result).toEqual({ note: undefined, keyboardHidden: undefined, maskedAppend: undefined, role: 'textfield', typed: 1, cleared: 4, readBack: { kind: 'landed' }, notInput: undefined });
  });
});

/**
 * docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md: every
 * tree source reports an EMPTY field's hint or placeholder AS its value —
 * uiautomator's `text` on API 33 (`text="Last name"`, the Contacts editor),
 * idb's AXValue and WDA's `value` (`value 'Company'`, the iOS Contacts sheet),
 * all measured 2026-10-09 — and `clear: true` threw `field still shows 9
 * characters after clearing twice` on each, after the field had emptied.
 *
 * `hintedField` plays that widget: the field holds `content`, and the tree
 * shows `hint` whenever it holds nothing. `placeholder` set: the source also
 * NAMES the placeholder (WDA's placeholderValue, a dump's `hint` attribute);
 * unset: it does not (idb, the API 33 dump) — the measured shape.
 */
function hintedField(content: string, { hint = 'Last name', named = false } = {}) {
  resetLayout();
  const field = el({ role: 'textfield', identifier: 'last_name', value: content || hint, ...(named ? { placeholder: hint } : {}) });
  const fake = new FakeAdapter({ form: screen(field) }, 'form');
  let real = content;
  const show = () => {
    if (fake.focused) fake.focused.value = real === '' ? hint : real;
  };
  fake.typeText = async (t: string) => {
    fake.typed.push(t);
    real += t;
    show();
  };
  fake.clearText = async (n: number) => {
    fake.deletes.push(n);
    real = real.slice(0, Math.max(0, real.length - n));
    show();
  };
  return { fake, real: () => real };
}

describe('fillField — a field that shows its hint or placeholder as its value (2026-10-09)', () => {
  describe('the source names no placeholder (API 33 dump, idb): the unchanged delete round', () => {
    it('clear + value on a field holding "Q": one round deletes it, the next finds the hint unchanged, the value is typed and lands', async () => {
      const { fake, real } = hintedField('Q');
      const result = await fillField(fake, { id: 'last_name' }, 'Probe', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([1, 9]); // "Q", then the hint's length into the empty field — measured as 1 + 9 DEL
      expect(fake.typed).toEqual(['Probe']);
      expect(real()).toBe('Probe');
      expect(result).toMatchObject({ cleared: 1, clearUnchanged: { shows: 9 }, readBack: { kind: 'landed' } });
      expect(fillReply(result, 'id:last_name')).toBe('Filled id:last_name (5 characters, cleared 1 character first)'); // landed: the clear did its job
    });

    it('a clear ALONE on the EMPTY field: no throw — a clear that sent its deletes, NOT verified, naming hint and deaf field alike', async () => {
      const { fake, real } = hintedField('');
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([9]); // one round, unchanged — not 2 × 9 and a throw
      expect(real()).toBe('');
      expect(result).toMatchObject({ cleared: 9, clearUnchanged: { shows: 9 }, readBack: { kind: 'nothing-typed' } });
      expect(judgeFill(result)).toMatchObject({ did: 'cleared', sent: { what: 'deletes', n: 9 }, reasons: [{ code: 'clear-unchanged', shows: 9 }] });
      expect(fillReply(result, 'id:last_name')).toBe(
        'Cleared id:last_name (9 deletes sent) — NOT verified: the field still shows 9 characters that the deletes did not change — ' +
          'its hint or placeholder (shown while empty), or a field that ignores deletes',
      );
    });

    it('a clear ALONE on a field holding "Probe": deleted, then the hint unchanged — same unverified clear', async () => {
      const { fake, real } = hintedField('Probe');
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([5, 9]);
      expect(real()).toBe('');
      expect(result).toMatchObject({ cleared: 5, clearUnchanged: { shows: 9 } });
    });

    it('an emptied field is not "unchanged": a clear that empties in one round carries no clearUnchanged', async () => {
      const fake = formFake('2.50');
      const result = await fillField(fake, { id: 'amount_input' }, '', { ...FAST, clear: true });
      expect(result.clearUnchanged).toBeUndefined();
      expect(judgeFill(result).did).toBe('filled');
    });
  });

  describe('the source names the placeholder (WDA placeholderValue, a dump hint): a value equal to it is empty', () => {
    it('clear + value on the EMPTY field: no delete at all, typed, landed', async () => {
      const { fake, real } = hintedField('', { hint: 'Company', named: true });
      const result = await fillField(fake, { id: 'last_name' }, 'Acme', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([]); // `Company` was never content
      expect(real()).toBe('Acme');
      expect(result).toMatchObject({ cleared: 0, readBack: { kind: 'landed' } });
      expect(result.clearUnchanged).toBeUndefined();
    });

    it('clear + value on a field holding "Zed": one round, stopped by the placeholder, no deletes into the empty field', async () => {
      const { fake, real } = hintedField('Zed', { hint: 'First name', named: true });
      await fillField(fake, { id: 'last_name' }, 'Ann', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([3]);
      expect(real()).toBe('Ann');
    });

    it('a clear ALONE on the EMPTY field is a verified empty field — nothing to delete', async () => {
      const { fake } = hintedField('', { hint: 'Company', named: true });
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([]);
      expect(fillReply(result, 'id:last_name')).toBe('Filled id:last_name (0 characters)');
    });

    it('without clear, a placeholder is not content: nothing typed does not pass for a substring of it; a value EQUAL to it does pass', async () => {
      const { fake } = hintedField('', { hint: 'Search', named: true });
      fake.typeText = async (t: string) => {
        fake.typed.push(t); // the typing never lands: the field still shows `Search`
      };
      await expect(fillField(fake, { id: 'last_name' }, 'ear', FAST)).rejects.toThrow(/^fill: typed 3 characters but the field shows 6/);
      // The one reading the tree cannot tell apart: the value IS the placeholder's text.
      const same = hintedField('', { hint: 'Search', named: true });
      await expect(fillField(same.fake, { id: 'last_name' }, 'Search', FAST)).resolves.toMatchObject({ readBack: { kind: 'landed' } });
    });

    it('the clear-fill retry wipes what the field HOLDS: a field showing only its placeholder gets no deletes', async () => {
      const { fake, real } = hintedField('', { hint: 'Company', named: true });
      const origType = fake.typeText.bind(fake);
      let drop = 1;
      fake.typeText = async (t: string) => {
        if (drop-- > 0) return void fake.typed.push(t); // the first typing is dropped whole
        return origType(t);
      };
      await fillField(fake, { id: 'last_name' }, 'Acme', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([]);
      expect(fake.typed).toEqual(['Acme', 'Acme']);
      expect(real()).toBe('Acme');
    });
  });

  describe('a masked field whose hint read as text before typing (inferred from the plain EditText, not seen on a device)', () => {
    const hintedPassword = (drop = 0) => {
      resetLayout();
      const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'pw', value: 'Password' })) }, 'form');
      let n = 0;
      fake.typeText = async (t: string) => {
        fake.typed.push(t);
        n += t.length - drop;
        if (fake.focused) fake.focused.value = '•'.repeat(n);
      };
      return fake;
    };

    it('the hint is not held bullets: a fill that landed passes (it read `typed 6 but the field shows 6 … it held 8 after focus`)', async () => {
      await expect(fillField(hintedPassword(), { id: 'pw' }, 'secret', FAST)).resolves.toMatchObject({ readBack: { kind: 'landed' }, maskedAppend: undefined });
    });

    it('a NAMED placeholder is an empty field before the tap, so the post-focus re-read runs and sees an autofill on focus', async () => {
      resetLayout();
      const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'pw', value: 'Password', placeholder: 'Password' })) }, 'form');
      const origTap = fake.tap.bind(fake);
      fake.tap = async (x: number, y: number) => {
        await origTap(x, y);
        if (fake.focused) fake.focused.value = '•'.repeat(8); // autofill on focus (Android, measured 2026-09-18)
      };
      appendBullets(fake);
      await expect(fillField(fake, { id: 'pw' }, 'secret', FAST)).resolves.toMatchObject({ readBack: { kind: 'landed' }, maskedAppend: { held: 8 } });
    });

    it('a dropped keystroke still fails, counted from nothing held', async () => {
      await expect(fillField(hintedPassword(1), { id: 'pw' }, 'secret', FAST)).rejects.toThrow(
        'fill: typed 6 characters but the field shows 5 (masked field — compared by length; it held 0 after focus)',
      );
    });
  });
});
