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
      'fill: typed 1 character (after one wipe and retype) but the field shows 6 (content withheld from this error)',
    );
    expect(stubborn.deletes).toEqual([4, 5]); // the unchanged round, then the retry's wipe of "2.507"
    expect(stubborn.typed).toEqual(['7', '7']);
  });

  it('fill WITHOUT clear never wipes the field when verification mismatches — it fails instead, lengths only', async () => {
    const fake = formFake('9.99');
    fake.typeText = async (text: string) => {
      fake.typed.push(text); // drop everything: value never changes
    };
    // The field still shows what it showed before typing: since 2026-10-09
    // the error says so instead of leaving two bare lengths.
    await expect(fillField(fake, { id: 'amount_input' }, '12.34', FAST)).rejects.toThrow(
      'fill: typed 5 characters but the field shows 4 — the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)',
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
        // The remedy names pressKey('enter') for a newline and a return only (code review of round 7, P2).
        await expect(fill).rejects.toThrow(ch === '\n' || ch === '\r' ? /pressKey\('enter'\)/ : /^(?!.*pressKey).*cannot be typed\.$/);
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

  it('the refusal is a FillValueFailure marked `refused`, carrying type-text.ts\'s own error as its cause', async () => {
    const error = await fillField(formFake(), { id: 'amount_input' }, 'ab\ncd', FAST).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'FillValueFailure', fillValue: 'refused' });
    const { cause, message } = error as Error;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe(message);
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
      /^fill: typed 3 characters \(after one wipe and retype\) but the field shows 4 \(content withheld from this error\); the matched node is role text, not a textfield — .* the nearest input is textfield id:"name"/,
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
      expect(result).toMatchObject({ cleared: 1, clearUnchanged: { shows: 9, deletes: 10 }, readBack: { kind: 'landed' } });
      expect(fillReply(result, 'id:last_name')).toBe('Filled id:last_name (5 characters, cleared 1 character first)'); // landed: the clear did its job
    });

    it('a clear ALONE on the EMPTY field: no throw — a clear that sent its deletes, NOT verified, naming hint and deaf field alike', async () => {
      const { fake, real } = hintedField('');
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([9]); // one round, unchanged — not 2 × 9 and a throw
      expect(real()).toBe('');
      // Nothing was SEEN deleted (the first round changed nothing): cleared 0; the deletes that went out are counted apart.
      expect(result).toMatchObject({ cleared: 0, clearUnchanged: { shows: 9, deletes: 9 }, readBack: { kind: 'nothing-typed' } });
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
      expect(result).toMatchObject({ cleared: 5, clearUnchanged: { shows: 9, deletes: 14 } });
      expect(fillReply(result, 'id:last_name')).toMatch(/^Cleared id:last_name \(14 deletes sent\) — NOT verified: the field still shows 9 characters/); // every round, not the first's 5
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

    // Review of this branch, probe C: a field that shows exactly its
    // placeholder may be empty or may HOLD that very text; a clear alone that
    // deleted nothing never saw which. Not verified — never "Filled".
    it('a clear ALONE on a field showing only its placeholder: nothing deleted, and NOT verified — empty, or holding that text', async () => {
      const { fake } = hintedField('', { hint: 'Company', named: true });
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([]);
      expect(result).toMatchObject({ cleared: 0, clearPlaceholder: 'shown', readBack: { kind: 'nothing-typed' } }); // the facts; judgeFill makes them the placeholder reason
      expect(fillReply(result, 'id:last_name')).toBe(
        "Focused id:last_name — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text; the tree cannot tell which",
      );
    });

    it('a clear ALONE that deleted INTO the placeholder saw the field empty: verified', async () => {
      const { fake } = hintedField('Zed', { hint: 'Company', named: true });
      const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
      expect(fake.deletes).toEqual([3]);
      expect(fillReply(result, 'id:last_name')).toBe('Filled id:last_name (0 characters, cleared 3 characters first)');
    });

    it('without clear, a placeholder is not content: nothing typed does not pass for a substring of it; a value EQUAL to it is not verified', async () => {
      const { fake } = hintedField('', { hint: 'Search', named: true });
      fake.typeText = async (t: string) => {
        fake.typed.push(t); // the typing never lands: the field still shows `Search`
      };
      await expect(fillField(fake, { id: 'last_name' }, 'ear', FAST)).rejects.toThrow(/^fill: typed 3 characters but the field shows 6/);
      // The one reading the tree cannot tell apart: the value IS the placeholder's text (probe B's shape, without clear).
      const same = hintedField('', { hint: 'Search', named: true });
      await expect(fillField(same.fake, { id: 'last_name' }, 'Search', FAST)).resolves.toMatchObject({ readBack: { kind: 'placeholder' } });
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

/**
 * docs/bugs/2026-10-09-fill-mismatch-error-says-equal-counts-when-app-transforms-text.md:
 * UIKit's sentence auto-capitalisation turned a typed `hello` into `Hello`
 * (iOS 27.0, Contacts Notes, measured 2026-10-09) and the error read `typed 5
 * characters but the field shows 5 (content withheld from this error)`. Still
 * a failure — the field does not hold the value asked for — but the message
 * says what differs, in counts, never in content.
 */
describe('fillField — the mismatch error says what differs, without content (2026-10-09)', () => {
  /** A Notes-like field: `transform` is the app's hand on the whole text after each change. */
  const transforming = (held: string | null, transform: (s: string) => string) => {
    resetLayout();
    const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'notes', value: held })) }, 'form');
    fake.typeText = async (t: string) => {
      fake.typed.push(t);
      if (fake.focused) fake.focused.value = transform((fake.focused.value ?? '') + t);
    };
    return fake;
  };
  const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const failureOf = async (p: Promise<unknown>) => ((await p.catch((e: unknown) => e)) as Error).message;

  it('auto-capitalised, no clear: equal lengths, and the error says only the case differs, at how many characters — no content', async () => {
    const message = await failureOf(fillField(transforming(null, capitalise), { id: 'notes' }, 'hello', FAST));
    expect(message).toBe(
      'fill: typed 5 characters but the field shows 5 — the typed text is there but for letter case, 1 character differing: ' +
        'the app transformed the input (auto-capitalisation?); content withheld from this error',
    );
    expect(message).not.toMatch(/hello/i);
  });

  it('with clear: the same, after the retry (which the app transforms again)', async () => {
    const fake = transforming('old', capitalise);
    const message = await failureOf(fillField(fake, { id: 'notes' }, 'hello world', { ...FAST, clear: true }));
    expect(fake.typed).toEqual(['hello world', 'hello world']);
    expect(message).toMatch(/^fill: typed 11 characters \(after one wipe and retype\) but the field shows 11 — the typed text is there but for letter case, 1 character differing:/);
  });

  it('no clear onto held text: the typed text is found in the field but for case, however long the field', async () => {
    const message = await failureOf(fillField(transforming('Note: ', (s) => s.toUpperCase()), { id: 'notes' }, 'hi there', FAST));
    expect(message).toMatch(/^fill: typed 8 characters but the field shows 14 — the typed text is there but for letter case, 7 characters differing:/);
  });

  it('no clear: of several runs that match but for case, the closest one is counted', async () => {
    const fake = transforming('HELLO ', (s) => s.replace(/hello$/, 'Hello'));
    const message = await failureOf(fillField(fake, { id: 'notes' }, 'hello', FAST));
    expect(message).toMatch(/^fill: typed 5 characters but the field shows 11 — the typed text is there but for letter case, 1 character differing:/); // not the 5 of `HELLO`
  });

  it('with clear the field must EQUAL the value: a longer field holding it but for case is a length difference, not a case one', async () => {
    const message = await failureOf(fillField(transforming(null, (s) => `Re: ${capitalise(s)}`), { id: 'notes' }, 'hello', { ...FAST, clear: true }));
    expect(message).toBe('fill: typed 5 characters (after one wipe and retype) but the field shows 9 (content withheld from this error)');
  });

  it('a masked field with clear says it compared by length, and names no held count (the clear emptied it)', async () => {
    resetLayout();
    const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'pw', value: '••••' })) }, 'form');
    appendBullets(fake, 1);
    const message = await failureOf(fillField(fake, { id: 'pw' }, 'secret', { ...FAST, clear: true }));
    expect(message).toBe('fill: typed 6 characters (after one wipe and retype) but the field shows 5 (masked field — compared by length)');
  });

  it('same length, more than case (autocorrect `teh` → `the`): how many characters differ', async () => {
    const message = await failureOf(fillField(transforming(null, (s) => s.replace('teh', 'the')), { id: 'notes' }, 'teh', FAST));
    expect(message).toBe(
      'fill: typed 3 characters but the field shows 3 — as many characters as were typed, 2 differing: ' +
        'the app transformed the input (autocorrect, smart punctuation, a mask?); content withheld from this error',
    );
  });

  it('a length difference says the lengths alone, as before (a mask that inserts a space)', async () => {
    const message = await failureOf(fillField(transforming(null, (s) => s.replace(/^(\d{4})(\d)/, '$1 $2')), { id: 'notes' }, '12345', FAST));
    expect(message).toBe('fill: typed 5 characters but the field shows 6 (content withheld from this error)');
  });
});

/**
 * docs/bugs/2026-10-09-android-fill-into-a-field-that-drops-everything-reads-
 * exposes-no-value.md (round-6b device check, F-1.1): mp-native's SWIFT
 * `amount_input` (a Compose TextField, digits only) fed `abc` dropped all
 * three letters and stayed empty — and an empty field dumps no `text`, so
 * the read-back saw null and said "the matched node exposes no value (role
 * textfield)": NOT verified, never "did not land", so `optional:` passed
 * over it. An input's null value is empty (types.ts#UiNode.value).
 */
describe('fillField — a textfield whose null value is empty: a dropped fill is a mismatch (2026-10-09)', () => {
  /** The SWIFT amount field: empty (null), and it keeps only digits. */
  const digitsOnly = () => {
    const fake = formFake(null);
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      const kept = text.replace(/\D/g, '');
      if (fake.focused && kept !== '') fake.focused.value = (fake.focused.value ?? '') + kept;
    };
    return fake;
  };
  const failureOf = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as Error & { fillValue?: string };

  it('`abc` into the empty digits-only field: typed 3 but the field shows 0 — did not change; a did-not-land FillValueFailure, after the five value rounds', async () => {
    const fake = digitsOnly();
    sleeps.length = 0;
    const error = await failureOf(fillField(fake, { id: 'amount_input' }, 'abc', FAST));
    expect(error).toMatchObject({ name: 'FillValueFailure', fillValue: 'did-not-land' });
    expect(error.message).toBe(
      'fill: typed 3 characters but the field shows 0 — the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)',
    );
    expect(sleeps.slice(sleeps.indexOf(DEFAULT_FOCUS_DELAY_MS) + 1)).toEqual([2, 2, 2, 2, 2]); // the whole poll, not a stop on the second empty read
  });

  it('with clear: no delete (nothing held), one retype, then the same mismatch', async () => {
    const fake = digitsOnly();
    const error = await failureOf(fillField(fake, { id: 'amount_input' }, 'abc', { ...FAST, clear: true }));
    expect(fake.deletes).toEqual([]);
    expect(fake.typed).toEqual(['abc', 'abc']);
    expect(error.message).toMatch(/^fill: typed 3 characters \(after typing it once more\) but the field shows 0 — the field did not change/); // nothing held: no wipe
  });

  it('digits into the same field still land', async () => {
    const result = await fillField(digitsOnly(), { id: 'amount_input' }, '250', FAST);
    expect(result.readBack).toEqual({ kind: 'landed' });
  });

  it('a field whose text appears late (empty for the first reads) still gets the polls, and lands', async () => {
    const fake = formFake(null);
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      reads = 0;
      const field = fake.focused;
      fake.uiTree = async () => {
        if (++reads === 3 && field) field.value = text; // Compose state catches up on the third read
        return real();
      };
    };
    const result = await fillField(fake, { id: 'amount_input' }, '250', FAST);
    expect(reads).toBe(3);
    expect(result.readBack).toEqual({ kind: 'landed' });
  });

  it('a non-input that shows no value is still `no-value` (the iOS floating-label fill, unchanged)', async () => {
    const result = await fillField(idbFloatingLabelFake('IBAN*', null), 'text:"IBAN*"', 'DE89', FAST);
    expect(result).toMatchObject({ role: 'text', readBack: { kind: 'no-value' } });
  });
});

/**
 * The review of fix/r3-fill (2026-10-09) probed the hint-aware clear and the
 * mismatch wording with shapes the first round missed (its probes A–K; the
 * letters are kept in the test names). Since the fill-clear deepening
 * (2026-10-09) the clear's RULES behind A, E, I, J, K and the third round
 * are rows of tests/interact/fill-clear.test.ts (clearStep, one reading at a
 * time) and the mismatch's kinds rows of fill-verdict.test.ts
 * (differenceOf); what stays here for those is the driver's part — the
 * device calls in their order and count, and the facts it hands on.
 */
describe('fillField — the review probes of the hint-aware clear (2026-10-09)', () => {
  it('A: a MASKED field the deletes and the typing never reach (the focus tap missed) fails as clear-twice — bullets are no hint', async () => {
    // Stopping on the unchanged bullets let the typing go nowhere too, and the
    // masked read-back (by length: 8 bullets for an 8-character value)
    // reported "Filled" with the OLD password in place — the finportal
    // `invalid_grant` class.
    resetLayout();
    const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'pw', value: '••••••••' })) }, 'form');
    fake.onTap = (_id, self) => {
      self.focused = undefined; // the tap focused nothing
    };
    await expect(fillField(fake, { id: 'pw' }, 'newpass1', { ...FAST, clear: true })).rejects.toThrow('fill: field still shows 8 characters after clearing twice');
    expect(fake.deletes).toEqual([8, 8]);
    expect(fake.typed).toEqual([]);
  });

  it('B: clear + a value EQUAL to the named placeholder, the typing dropped: the field shows the placeholder — NOT verified', async () => {
    const { fake, real } = hintedField('Zed', { hint: 'Company', named: true });
    fake.typeText = async (t: string) => {
      fake.typed.push(t); // dropped: the empty field keeps showing `Company`
    };
    const result = await fillField(fake, { id: 'last_name' }, 'Company', { ...FAST, clear: true });
    expect(real()).toBe('');
    expect(result).toMatchObject({ cleared: 3, readBack: { kind: 'placeholder' } });
    expect(fillReply(result, 'id:last_name')).toBe(
      "Typed 7 characters into id:last_name (cleared 3 characters first) — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text; the tree cannot tell which",
    );
  });

  // Review round 2, probe K: deletes go from the end, so a reading that
  // STARTED with the placeholder's text can end on it with text left.
  it('K: a clear alone that ends on the placeholder from a reading that started with it is NOT verified — `Company` may be held text', async () => {
    const { fake, real } = hintedField('Companyabc', { hint: 'Company', named: true });
    const origClear = fake.clearText.bind(fake);
    fake.clearText = async (n: number) => {
      await origClear(3); // 3 of the 10 deletes land
      fake.deletes.splice(-1, 1, n);
    };
    const result = await fillField(fake, { id: 'last_name' }, '', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([10]);
    expect(real()).toBe('Company'); // held, not the placeholder
    expect(result).toMatchObject({ cleared: 10, clearPlaceholder: 'prefix', readBack: { kind: 'nothing-typed' } });
    expect(fillReply(result, 'id:last_name')).toBe(
      "Cleared id:last_name (10 deletes sent) — NOT verified: the field shows exactly its placeholder's text — empty, or holding that very text; the tree cannot tell which",
    );
  });

  it('K, with a value: the exact read-back sees the held text under the typing, and the retry wipes it', async () => {
    const { fake, real } = hintedField('Companyabc', { hint: 'Company', named: true });
    const origClear = fake.clearText.bind(fake);
    let short = 1;
    fake.clearText = async (n: number) => {
      if (short-- > 0) {
        await origClear(3);
        fake.deletes.splice(-1, 1, n);
        return;
      }
      return origClear(n);
    };
    const result = await fillField(fake, { id: 'last_name' }, 'Acme', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([10, 11]); // the retry wipes `CompanyAcme`
    expect(real()).toBe('Acme');
    expect(result.readBack).toEqual({ kind: 'landed' });
  });

  it('D: no clear, the typing dropped on a field showing only its named placeholder: "did not change", never "transformed"', async () => {
    const { fake } = hintedField('', { hint: 'Search', named: true });
    fake.typeText = async (t: string) => void fake.typed.push(t);
    await expect(fillField(fake, { id: 'last_name' }, 'search', FAST)).rejects.toThrow(
      'fill: typed 6 characters but the field shows 6 — the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)',
    );
  });

  it('a field that falls back to its named placeholder is never "the typed text but for case": the placeholder holds no text', async () => {
    const { fake } = hintedField('Zed', { hint: 'Company', named: true });
    fake.typeText = async (t: string) => {
      fake.typed.push(t);
      if (fake.focused) fake.focused.value = 'Company'; // the app rejected the input and emptied the field
    };
    await expect(fillField(fake, { id: 'last_name' }, 'company', FAST)).rejects.toThrow(
      'fill: typed 7 characters but the field shows 7 (content withheld from this error)',
    );
  });

  it('D2: no clear, the typing dropped on a field holding text that matches the value but for case: "did not change"', async () => {
    const fake = formFake('Hello');
    fake.typeText = async (t: string) => void fake.typed.push(t);
    await expect(fillField(fake, { id: 'amount_input' }, 'hello', FAST)).rejects.toThrow(
      'fill: typed 5 characters but the field shows 5 — the field did not change: the typing did not reach it, or the field refused it (content withheld from this error)',
    );
  });

  it('without clear only the text typed is compared: held `HELLo` is not read as a case-transformed `hello`', async () => {
    const fake = formFake('HELLo');
    const origType = fake.typeText.bind(fake);
    fake.typeText = async (t: string) => origType(t.replace('hello', 'hxllo')); // autocorrect
    await expect(fillField(fake, { id: 'amount_input' }, 'hello', FAST)).rejects.toThrow(
      'fill: typed 5 characters but the field shows 10 — as many characters as were typed, 1 differing: ',
    );
  });

  it('a partly masked read-back (`•••••t`, show-the-last-character) is said by its lengths only', async () => {
    const fake = formFake(null);
    fake.typeText = async (t: string) => {
      fake.typed.push(t);
      if (fake.focused) fake.focused.value = '•'.repeat(t.length - 1) + t.slice(-1);
    };
    await expect(fillField(fake, { id: 'amount_input' }, 'secret', FAST)).rejects.toThrow('fill: typed 6 characters but the field shows 6 (content withheld from this error)');
  });

  it('I: an unchanged reading after the deletes costs one poll cadence and one tree read more — then the late deletes are seen', async () => {
    const fake = formFake('abc');
    let pending = 0;
    let readsSince = 0;
    fake.clearText = async (n: number) => {
      fake.deletes.push(n);
      pending = n;
      readsSince = 0;
    };
    const real = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async (...a: Parameters<FakeAdapter['uiTree']>) => {
      reads++;
      if (pending > 0 && ++readsSince === 2 && fake.focused) {
        fake.focused.value = (fake.focused.value ?? '').slice(0, -pending) || null; // lands now, a read late
        pending = 0;
      }
      return real(...a);
    };
    sleeps.length = 0;
    const result = await fillField(fake, { id: 'amount_input' }, '', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([3]);
    expect(sleeps).toEqual([FAST.pollMs, DEFAULT_FOCUS_DELAY_MS, FAST.pollMs]); // the settle pause, the focus delay, the re-read's cadence
    expect(reads).toBe(5); // settle (2), post-focus (1), after the deletes (1), the re-read (1)
    expect(result).toMatchObject({ cleared: 3, readBack: { kind: 'nothing-typed' } });
    expect(result.clearUnchanged).toBeUndefined();
  });

  it('J: clear + value on an EMPTY hinted field (the headline device case): nothing claimed deleted — the deletes went into an empty field', async () => {
    const { fake } = hintedField('');
    const result = await fillField(fake, { id: 'last_name' }, 'Probe', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([9]); // one round, then the re-read — no second round into the empty field
    expect(fake.typed).toEqual(['Probe']);
    expect(result).toMatchObject({ cleared: 0, clearUnchanged: { shows: 9, deletes: 9 }, readBack: { kind: 'landed' } }); // judged: "Filled … (5 characters)", fill-verdict.test.ts
  });

  it('E: a short first round, then the hint (not a shortening of what was left): one more round, and the unchanged rule decides', async () => {
    const { fake, real } = hintedField('Probe!');
    const origClear = fake.clearText.bind(fake);
    let short = 1;
    fake.clearText = async (n: number) => {
      if (short-- > 0) {
        await origClear(3); // half the deletes land: `Pro`
        fake.deletes.splice(-1, 1, n);
        return;
      }
      return origClear(n);
    };
    const result = await fillField(fake, { id: 'last_name' }, 'Ann', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([6, 3, 9]); // it threw `still shows 9 characters after clearing twice` on the empty field
    expect(real()).toBe('Ann');
    expect(result).toMatchObject({ cleared: 6, readBack: { kind: 'landed' } });
  });

  it('a third round that still changes the field without emptying it fails, and says how many rounds', async () => {
    const fake = formFake('abc');
    const readings = ['Hint A', 'Hint B', 'Hint C'];
    fake.clearText = async (n: number) => {
      fake.deletes.push(n);
      if (fake.focused) fake.focused.value = readings.shift() ?? null;
    };
    await expect(fillField(fake, { id: 'amount_input' }, '', { ...FAST, clear: true })).rejects.toThrow('fill: field still shows 6 characters after clearing 3 times');
    expect(fake.deletes).toEqual([3, 6, 6]);
  });
});

describe('fillField — a field that drops the tail of the typing gets the tail typed again', () => {
  // docs/bugs/2026-10-19-ios-fill-loses-the-tail-of-its-text-in-a-react-native-single-line-field.md: React Native's
  // controlled single-line TextInput kept a prefix of an `idb ui text` burst in 6 of 12 fills (`Jan` of `Jan Novak`).
  /** typeText lands only the first `keep(text)` characters of each typing, in order of the calls. */
  const dropping = (fake: FakeAdapter, ...keeps: number[]) => {
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      const keep = keeps.shift() ?? text.length;
      if (fake.focused) fake.focused.value = (fake.focused.value ?? '') + text.slice(0, keep);
    };
  };

  it('types only the missing tail, once, and says so: `Filled … (9 characters, the last 6 characters typed again …)`', async () => {
    const fake = formFake(null);
    dropping(fake, 3);
    const result = await fillField(fake, { id: 'amount_input' }, 'Jan Novak', FAST);
    expect(fake.typed).toEqual(['Jan Novak', ' Novak']);
    expect(fake.focused?.value).toBe('Jan Novak');
    expect(result.retyped).toEqual([6]);
    expect(result.readBack).toEqual({ kind: 'landed' });
    expect(fillReply(result, 'id:amount_input')).toBe(
      'Filled id:amount_input (9 characters, the last 6 characters typed again after the field dropped them)',
    );
  });

  it('a retyped tail that loses its own end is typed again once more — never past the bound', async () => {
    const fake = formFake(null);
    dropping(fake, 3, 3);
    const result = await fillField(fake, { id: 'amount_input' }, 'Jan Novak', FAST);
    expect(fake.typed).toEqual(['Jan Novak', ' Novak', 'vak']);
    expect(result.retyped).toEqual([6, 3]);
  });

  it('after two retypes the field still short is the mismatch, and the error says what was typed again', async () => {
    const fake = formFake(null);
    dropping(fake, 3, 1, 1);
    await expect(fillField(fake, { id: 'amount_input' }, 'Jan Novak', FAST)).rejects.toThrow(
      'fill: typed 9 characters (the last 6 characters typed again after the field dropped them, then the last 5 characters) but the field shows 5',
    );
    expect(fake.typed).toEqual(['Jan Novak', ' Novak', 'Novak']);
  });

  it('a retype that moved nothing is not repeated (a field at its maxLength keeps a prefix too)', async () => {
    const fake = formFake(null);
    dropping(fake, 3, 0);
    await expect(fillField(fake, { id: 'amount_input' }, 'abcde', FAST)).rejects.toThrow(/typed 5 characters \(the last 2 characters typed again after the field dropped them\) but the field shows 3/);
    expect(fake.typed).toEqual(['abcde', 'de']);
  });

  it('with clear the tail is typed again too — no wipe: the clear deletes once, the prefix stays', async () => {
    const fake = formFake('9.99');
    dropping(fake, 2);
    const result = await fillField(fake, { id: 'amount_input' }, '12.34', { ...FAST, clear: true });
    expect(fake.deletes).toEqual([4]);
    expect(fake.typed).toEqual(['12.34', '.34']);
    expect(result.retyped).toEqual([3]);
  });

  it('without clear the tail is what the field misses of its earlier text plus the value', async () => {
    // Nothing is read after the focus tap here (the field held text, no clear): the tree that resolved it is the
    // proof of what the other inputs held before the typing.
    const fake = formFake('9.99');
    dropping(fake, 2);
    const result = await fillField(fake, { id: 'amount_input' }, '12.34', FAST);
    expect(fake.focused?.value).toBe('9.9912.34');
    expect(fake.typed).toEqual(['12.34', '.34']);
    expect(result.retyped).toEqual([3]);
  });

  it('nothing of the typing landed: nothing is typed again (the focus may not be in the field)', async () => {
    const fake = formFake('9.99');
    dropping(fake, 0);
    await expect(fillField(fake, { id: 'amount_input' }, '12.34', FAST)).rejects.toThrow(/the field did not change/);
    expect(fake.typed).toEqual(['12.34']);
  });

  it('a reading that is no prefix (the app changed the text) is not typed into again', async () => {
    const fake = formFake(null);
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      if (fake.focused) fake.focused.value = 'Jan';
    };
    await expect(fillField(fake, { id: 'amount_input' }, 'jan novak', FAST)).rejects.toThrow(/typed 9 characters but the field shows 3/);
    expect(fake.typed).toEqual(['jan novak']);
  });

  it('a masked field that dropped characters is never typed into again — bullets show no prefix', async () => {
    const fake = formFake(null);
    appendBullets(fake, 2);
    await expect(fillField(fake, { id: 'amount_input' }, '12345', FAST)).rejects.toThrow(/typed 5 characters but the field shows 3/);
    expect(fake.typed).toEqual(['12345']);
  });

  it('an adapter whose keys may arrive late (Android\'s IME queue) gets no retype: a short reading proves no drop', async () => {
    const fake = formFake(null);
    fake.typingDelivery = 'may-arrive-late';
    dropping(fake, 3);
    await expect(fillField(fake, { id: 'amount_input' }, 'Jan Novak', FAST)).rejects.toThrow('fill: typed 9 characters but the field shows 3 (content withheld from this error)');
    expect(fake.typed).toEqual(['Jan Novak']);
  });

  /** Two auto-advancing one-digit code boxes and a note under them: a box that has its digit moves the focus on. */
  const otpFake = () => {
    resetLayout();
    const otp1 = el({ role: 'textfield', identifier: 'otp1', value: null });
    const otp2 = el({ role: 'textfield', identifier: 'otp2', value: null });
    const note = el({ role: 'textfield', identifier: 'note', value: null });
    const fake = new FakeAdapter({ form: screen(otp1, otp2, note) }, 'form');
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      for (const ch of text) {
        const box = fake.focused;
        if (box === undefined) return;
        box.value = (box.value ?? '') + ch;
        if (box === otp1) fake.focused = otp2;
        else if (box === otp2) fake.focused = note;
      }
    };
    return { fake, otp2, note };
  };

  it('typing that moved the focus to another input is never typed again — it would go there too — and the error names that input', async () => {
    // Review of this branch: `1234` into otp1 left `1` there, `2` in otp2 and `34` in the note, and the tail `234`
    // typed again made the note `34234`, the reply saying the field had dropped them.
    const { fake, otp2, note } = otpFake();
    await expect(fillField(fake, { id: 'otp1' }, '1234', FAST)).rejects.toThrow(
      /^fill: typed 4 characters but the field shows 1 .*; the typing left the field: textfield id:"otp2" \(0,40 100x10\) changed while it typed \(the focus moved\), so nothing was typed again$/,
    );
    expect(fake.typed).toEqual(['1234']);
    expect([otp2.value, note.value]).toEqual(['2', '34']);
  });

  it('with clear, the clear\'s wipe and retype is not sent either: its deletes and its typing would go into the other input', async () => {
    const { fake, note } = otpFake();
    await expect(fillField(fake, { id: 'otp1' }, '1234', { ...FAST, clear: true })).rejects.toThrow(/the typing left the field: textfield id:"otp2"/);
    expect(fake.typed).toEqual(['1234']);
    expect(fake.deletes).toEqual([]);
    expect(note.value).toBe('34');
  });

  /**
   * An exchange form: the amount typed, and a sibling the app recomputes from it (twice the amount) — the bank app's
   * send/receive pairs. The first typing lands only `keep` characters of the amount.
   */
  const fxFake = (sibling: (amount: string) => string | null, keep = 2) => {
    resetLayout();
    const amount = el({ role: 'textfield', identifier: 'amount', value: null });
    const converted = el({ role: 'textfield', identifier: 'converted', value: null });
    const fake = new FakeAdapter({ form: screen(amount, converted) }, 'form');
    let first = true;
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      amount.value = (amount.value ?? '') + (first ? text.slice(0, keep) : text);
      first = false;
      converted.value = sibling(amount.value);
    };
    return { fake, amount, converted };
  };
  const doubled = (a: string) => String(Number(a) * 2);

  it('a sibling the app recomputes proves nothing of where the typing went: with clear, the wipe and retype runs as it always did', async () => {
    // Review round 2: `converted` going "" → "24" read as the focus moving, and a clear fill that recovered failed.
    const { fake, amount } = fxFake(doubled);
    const result = await fillField(fake, { id: 'amount' }, '1234', { ...FAST, clear: true });
    expect(fake.typed).toEqual(['1234', '1234']);
    expect(fake.deletes).toEqual([2]);
    expect(amount.value).toBe('1234');
    expect(result.readBack).toEqual({ kind: 'landed' });
  });

  it('without clear the recomputed sibling stops the tail too, and the error does not claim the focus moved', async () => {
    const { fake } = fxFake(doubled);
    await expect(fillField(fake, { id: 'amount' }, '1234', FAST)).rejects.toThrow(/^fill: typed 4 characters but the field shows 2 \(content withheld from this error\)$/);
    expect(fake.typed).toEqual(['1234']);
  });

  it('a sibling that by coincidence gains a part of the missing text reads as the typing gone there: nothing is sent again, the fill fails loudly', async () => {
    const { fake } = fxFake((a) => (a.length >= 2 ? '3' : null));
    await expect(fillField(fake, { id: 'amount' }, '1234', { ...FAST, clear: true })).rejects.toThrow(/the typing left the field: textfield id:"converted"/);
    expect(fake.typed).toEqual(['1234']);
    expect(fake.deletes).toEqual([]);
  });

  it('a prefix still growing at the end of the poll is not typed again (a late keystroke would be sent twice)', async () => {
    const fake = formFake(null);
    fake.typeText = async (text: string) => {
      fake.typed.push(text);
      if (fake.focused) fake.focused.value = 'J';
    };
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      // after the typing, one more character arrives before every read: the reading never holds still
      if (fake.typed.length > 0 && fake.focused && (fake.focused.value ?? '').length < 8) fake.focused.value = 'Jan Novak'.slice(0, (fake.focused.value ?? '').length + 1);
      return real();
    };
    await expect(fillField(fake, { id: 'amount_input' }, 'Jan Novak', FAST)).rejects.toThrow('fill: typed 9 characters but the field shows 6 (content withheld from this error)');
    expect(fake.typed).toEqual(['Jan Novak']);
  });
});
