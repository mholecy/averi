import { describe, expect, it } from 'vitest';
import type { FillResult } from '../../src/interact/fill.js';
import { judgeFill } from '../../src/interact/fill-verdict.js';
import { fillText } from '../../src/interact/fill-text.js';

/**
 * Both media of one fill, side by side — the MCP reply and the flow trace
 * lines — from the same facts through judgeFill, so a layout change that
 * makes the two say different things fails here in one place (df8a91a: a
 * clear alone read `(N deletes sent)` in the reply and `cleared N characters
 * first` on the flow line). Every shape the reply tests pinned until
 * 2026-10-09 (tests/mcp/tool-text.test.ts) is here byte for byte, with its
 * flow line beside it. The judgement itself (codes) is
 * fill-verdict.test.ts's; the end-to-end agreement through a fake device
 * stays with tools.test.ts and engine.test.ts.
 */
const fact = (f: Partial<FillResult> & Pick<FillResult, 'readBack' | 'typed'>): FillResult => ({ role: 'textfield', ...f });
const landed = { kind: 'landed' } as const;

/** The reply for `sel`, and the flow lines for the step `sel` showing `shown`, as `[action, text]` in log order (caveats, then the line). */
const both = (sel: string, f: FillResult, shown = 'x'.repeat(f.typed)) => {
  const v = judgeFill(f);
  const step = fillText(v, { step: sel, shown });
  return { reply: fillText(v, { reply: sel }), flow: [...step.caveats, step.line].map((l) => [l.action, l.text]) };
};

describe('fillText — the MCP reply and the flow line of the same fill', () => {
  it('filled: the length and what the clear deleted in the reply, the shown value and the same clause on the line', () => {
    expect(both('id:amount', fact({ typed: 4, readBack: landed }), '2.50')).toEqual({
      reply: 'Filled id:amount (4 characters)',
      flow: [['fill', 'id:amount = 2.50']],
    });
    expect(both('id:amount', fact({ typed: 4, readBack: landed, cleared: 7 }), '2.50')).toEqual({
      reply: 'Filled id:amount (4 characters, cleared 7 characters first)',
      flow: [['fill', 'id:amount = 2.50 (cleared 7 characters first)']],
    });
    expect(both('role:textfield value:"1.5"', fact({ typed: 1, readBack: landed, cleared: 3 }), '7')).toEqual({
      reply: 'Filled role:textfield value:"1.5" (1 character, cleared 3 characters first)',
      flow: [['fill', 'role:textfield value:"1.5" = 7 (cleared 3 characters first)']],
    });
    expect(both('id:amount', fact({ typed: 4, readBack: landed, cleared: 1 })).reply).toBe('Filled id:amount (4 characters, cleared 1 character first)');
  });

  it('a clear that sent no delete says nothing of clearing, on either medium', () => {
    expect(both('id:amount', fact({ typed: 4, readBack: landed, cleared: 0 }), '2.50')).toEqual({
      reply: 'Filled id:amount (4 characters)',
      flow: [['fill', 'id:amount = 2.50']],
    });
    // A clear whose read-back LANDED needs no caveat: the field shows exactly the value.
    expect(both('id:search', fact({ typed: 4, role: 'other', readBack: landed, cleared: 'unmeasured' }), 'beer')).toEqual({
      reply: 'Filled id:search (4 characters)',
      flow: [['fill', 'id:search = beer']],
    });
  });

  it('the resolution note is the reply\'s only; the masked-append caveat is a ⚠ line on both, logged before the step line', () => {
    expect(both('id:pw', fact({ typed: 16, readBack: landed, note: '2 matches; picked the only interactive one (textfield)' }), '***')).toEqual({
      reply: 'Filled id:pw (16 characters) (2 matches; picked the only interactive one (textfield))',
      flow: [['fill', 'id:pw = ***']],
    });
    const masked = 'masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace';
    expect(both('id:pw', fact({ typed: 16, readBack: landed, maskedAppend: { held: 20 } }), '***')).toEqual({
      reply: `Filled id:pw (16 characters)\n⚠ ${masked}`,
      flow: [
        ['⚠ fill', `id:pw: ${masked}`],
        ['fill', 'id:pw = ***'],
      ],
    });
  });

  // docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md:
  // the reply printed the REQUESTED clear and passed an unreadable read-back.
  it('typed, not verified: "Typed … into" in the reply, a ⚠ fill line in the flow, the same reasons on both', () => {
    expect(both('id:pw', fact({ typed: 6, readBack: { kind: 'no-value' }, cleared: 0 }), '***')).toEqual({
      reply:
        'Typed 6 characters into id:pw — NOT verified: the matched node exposes no value (role textfield); ' +
        'clear sent no delete — the node gave no length to delete',
      flow: [
        [
          '⚠ fill',
          'id:pw = *** — NOT verified: the matched node exposes no value (role textfield); clear sent no delete — the node gave no length to delete',
        ],
      ],
    });
    expect(both('text:"IBAN*"', fact({ typed: 22, role: 'text', readBack: { kind: 'no-value' }, cleared: 'unmeasured' })).reply).toBe(
      'Typed 22 characters into text:"IBAN*" — NOT verified: the matched node exposes no value (role text); ' +
        "clear sent no delete — a role text node's length is not the field's",
    );
    expect(both('id:title', fact({ typed: 1, role: 'text', readBack: { kind: 'not-taken' } }), 'a')).toEqual({
      reply: "Typed 1 character into id:title — NOT verified: the matched node's value does not show the typed text (role text) — it is not the field",
      flow: [['⚠ fill', "id:title = a — NOT verified: the matched node's value does not show the typed text (role text) — it is not the field"]],
    });
    expect(both('id:bic', fact({ typed: 1, role: 'scrollable', readBack: { kind: 'no-value' } })).reply).toBe(
      'Typed 1 character into id:bic — NOT verified: the matched node exposes no value (role scrollable)',
    );
  });

  it('a field the read-back could not find again is said as not found — the clause of a clear that deleted stays in characters when text was typed', () => {
    expect(both('role:textfield value:"XX12345"', fact({ typed: 22, readBack: { kind: 'lost', why: 'screen-changed' }, cleared: 7 }), 'DE89370400440532013000')).toEqual({
      reply:
        'Typed 22 characters into role:textfield value:"XX12345" (cleared 7 characters first) — ' +
        'NOT verified: the field could not be found again (the screen changed while typing)',
      flow: [
        [
          '⚠ fill',
          'role:textfield value:"XX12345" = DE89370400440532013000 (cleared 7 characters first) — ' +
            'NOT verified: the field could not be found again (the screen changed while typing)',
        ],
      ],
    });
    expect(both('role:textfield value:"XX"', fact({ typed: 3, readBack: { kind: 'lost', why: 'unmatched' } })).reply).toBe(
      'Typed 3 characters into role:textfield value:"XX" — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
  });

  // m-1 (review 2026-10-08, bundle C round 1) and df8a91a: a clear alone
  // whose read after the delete lost the field — deletes on BOTH media.
  it('a clear alone: "Cleared … (N deletes sent)" in the reply and `=  (N deletes sent)` on the line; verified keeps "Filled" and characters', () => {
    expect(both('role:textfield value:"XX12345"', fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 7 }))).toEqual({
      reply:
        'Cleared role:textfield value:"XX12345" (7 deletes sent) — ' +
        'NOT verified: the field could not be found again (the selector no longer matches it)',
      flow: [['⚠ fill', 'role:textfield value:"XX12345" =  (7 deletes sent) — NOT verified: the field could not be found again (the selector no longer matches it)']],
    });
    expect(both('role:textfield value:"X"', fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 1 })).reply).toBe(
      'Cleared role:textfield value:"X" (1 delete sent) — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
    expect(both('id:amount', fact({ typed: 0, readBack: { kind: 'nothing-typed' }, cleared: 4 }))).toEqual({
      reply: 'Filled id:amount (0 characters, cleared 4 characters first)',
      flow: [['fill', 'id:amount =  (cleared 4 characters first)']],
    });
  });

  it('focused: nothing typed, no delete sent, not verified — never "Cleared", never "Typed 0 characters"', () => {
    // M-1 (review 2026-10-08): a clear ALONE on a label was "Filled … (0 characters)".
    expect(both('text:"IBAN*"', fact({ typed: 0, role: 'text', readBack: { kind: 'nothing-typed' }, cleared: 'unmeasured' }))).toEqual({
      reply: 'Focused text:"IBAN*" — NOT verified: clear sent no delete — a role text node\'s length is not the field\'s',
      flow: [['⚠ fill', 'text:"IBAN*" =  — NOT verified: clear sent no delete — a role text node\'s length is not the field\'s']],
    });
    // Not produced by fillField (a lost clear has deleted).
    expect(both('id:x', fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' }, cleared: 0 })).reply).toBe(
      'Focused id:x — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
    // Not produced by fillField either (no clear: an empty value is `nothing-typed`, verified).
    // Until 2026-10-09 the reply fell through to "Typed 0 characters into id:x — …" here.
    expect(both('id:x', fact({ typed: 0, readBack: { kind: 'lost', why: 'unmatched' } })).reply).toBe(
      'Focused id:x — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
  });

  it('the not-an-input finding is its own ⚠ line on both media, naming the input', () => {
    const finding =
      'the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; ' +
      'the input overlapping it is textfield id:"TextFieldWithComponentStyle" at 26,343 350x56 — ' +
      'select the input itself (role:textfield with its id:, or its current value: when inputs share an id)';
    const input = { identifier: 'TextFieldWithComponentStyle', rect: { x: 26, y: 343, width: 350, height: 56 }, overlaps: true };
    expect(both('text:"IBAN*"', fact({ typed: 22, role: 'text', readBack: { kind: 'no-value' }, notInput: { input } }), 'DE89370400440532013000')).toEqual({
      reply: `Typed 22 characters into text:"IBAN*" — NOT verified: the matched node exposes no value (role text)\n⚠ ${finding}`,
      flow: [
        ['⚠ fill', `text:"IBAN*": ${finding}`],
        ['⚠ fill', 'text:"IBAN*" = DE89370400440532013000 — NOT verified: the matched node exposes no value (role text)'],
      ],
    });
    expect(both('text:"Hi"', fact({ typed: 2, role: 'text', readBack: { kind: 'no-value' }, notInput: { input: 'none' } })).reply).toBe(
      'Typed 2 characters into text:"Hi" — NOT verified: the matched node exposes no value (role text)\n' +
        '⚠ the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; no textfield is on the screen',
    );
    const unread =
      'the matched node is role text, not a textfield — nothing was deleted, and the focus is wherever the tap left it; the screen could not be read again to name the input';
    expect(both('text:"Hi"', fact({ typed: 0, role: 'text', readBack: { kind: 'nothing-typed' }, notInput: { input: 'unread' } }))).toEqual({
      reply: `Filled text:"Hi" (0 characters)\n⚠ ${unread}`,
      flow: [
        ['⚠ fill', `text:"Hi": ${unread}`],
        ['fill', 'text:"Hi" = '],
      ],
    });
  });
});
