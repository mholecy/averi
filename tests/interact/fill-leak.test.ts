import { inspect } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { parseConfig } from '../../src/flow/config.js';
import { FlowEngine, FlowError } from '../../src/flow/engine.js';
import { EngineSession } from '../../src/flow/launch.js';
import { fillField, type FillOptions } from '../../src/interact/fill.js';
import { fillReply, fillStepText } from '../../src/interact/fill-text.js';
import type { Target } from '../../src/interact/resolve.js';
import { isMaskedValue } from '../../src/ui-tree/masked-value.js';
import { el, FAKE_TYPEABLE, FakeAdapter, PERMISSIVE, resetLayout, screen } from '../helpers/fake.js';
import { NO_EYES } from '../helpers/eyes.js';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

// The LEAK SWEEP one level above tests/adapters/typed-text-leak.test.ts (A54): what a fill says — the error fillField
// throws, the MCP type_text reply (fillReply), the flow line (fillStepText) — never carries the typed value, which may
// be a credential, nor the field's text other than as lengths or bullets. A selector is echoed as the caller wrote it,
// so text inside the selector is the one exception: it is the caller's own, and the flow engine redacts a secret from
// it (the last describe). Each case below is a fill whose field the fake drives to one FillFailure, Difference,
// refusal, verdict or caveat; its sentence is asserted first, so a case that stops reaching its path fails as such.

/** The typed value and the field's own text: strings no sentence of averi holds. */
const TYPED = 'hunter2§';
const PREFILL = 'PREFILL¤';
/** A digit value, for the fields that group or mark what they are typed. */
const DIGITS = '73198462';

const FAST: FillOptions = { eyes: NO_EYES, ambiguous: 'first', timeoutMs: 200, pollMs: 2 };
const ID: Target = { id: 'field' };
const SELECTOR = 'id:field';

interface FieldFake {
  fake: FakeAdapter;
  /** Every text the fake's inputs and the matched node showed on a tree read. */
  readings: Set<string>;
}

/**
 * A screen with the matched node (`field`, a textfield unless `node` says otherwise) and a second input, `other`. The
 * fake types anything (PERMISSIVE) and its typing may arrive late (no tail typed again) unless the case says so.
 */
function fieldFake(node: Partial<UiNode> = {}, other: Partial<UiNode> = {}): FieldFake {
  resetLayout();
  const fake = new FakeAdapter({ form: screen(el({ role: 'textfield', identifier: 'field', ...node }), el({ role: 'textfield', identifier: 'other', ...other })) }, 'form');
  fake.typeable = PERMISSIVE;
  fake.typingDelivery = 'may-arrive-late';
  const readings = new Set<string>();
  const read = fake.uiTree.bind(fake);
  fake.uiTree = async () => {
    const tree = await read();
    for (const n of tree.children) for (const text of [n.value, n.role === 'textfield' ? null : n.label]) if (text !== null) readings.add(text);
    return tree;
  };
  return { fake, readings };
}

/** The field's typing: what the field shows after `typed` is typed into what it `held`. */
function typing(fake: FakeAdapter, show: (held: string, typed: string) => string): void {
  fake.typeText = async (text: string) => {
    fake.typed.push(text);
    if (fake.focused) fake.focused.value = show(fake.focused.value ?? '', text) || null;
  };
}

/** Run `then` on the live field right after the focus tap lands. */
function onFocus(fake: FakeAdapter, then: (f: UiNode) => void): void {
  const tap = fake.tap.bind(fake);
  fake.tap = async (x: number, y: number) => {
    await tap(x, y);
    if (fake.focused) then(fake.focused);
  };
}

/**
 * Every piece of content a sentence must not hold: the typed value (in any letter case), the sentinels, and every
 * reading of the field but bullets. A reading of one character is too short to look for.
 */
function forbidden(value: string, readings: Set<string>): string[] {
  return [...new Set([value, TYPED, PREFILL, ...readings])].filter((t) => t.length >= 2 && !isMaskedValue(t));
}

/** No forbidden piece in any of `shown`, once the caller's own selector is taken out of it. */
function expectNoContent(shown: Record<string, string>, pieces: readonly string[], selector: string): void {
  for (const [where, text] of Object.entries(shown)) {
    const said = text.split(selector).join('<selector>').toLowerCase();
    for (const piece of pieces) expect(said.includes(piece.toLowerCase()), `${JSON.stringify(piece)} in ${where}: ${text}`).toBe(false);
  }
}

async function rejection(fill: Promise<unknown>): Promise<Error> {
  const error = await fill.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

function errorShown(error: Error): Record<string, string> {
  return { message: error.message, stack: error.stack ?? '', inspected: inspect(error, { depth: 5 }) };
}

interface FailureCase {
  build: () => FieldFake;
  value?: string;
  opts?: Partial<FillOptions>;
  /** The error's own words: proof the case reached its path. */
  says: RegExp;
}

const FAILURES: Record<string, FailureCase> = {
  'reread-failed': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      let reads = 0;
      const read = f.fake.uiTree.bind(f.fake);
      f.fake.uiTree = async () => {
        if (reads++ >= 2) throw new Error('adb: device offline');
        return read();
      };
      return f;
    },
    opts: { clear: true },
    says: /^fill: could not re-read id:"field" after focusing it — adb: device offline\./,
  },
  'clear-twice: deletes landing short': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      f.fake.clearText = async (n: number) => {
        f.fake.deletes.push(n);
        if (f.fake.focused) f.fake.focused.value = (f.fake.focused.value ?? '').slice(0, -1) || null;
      };
      return f;
    },
    opts: { clear: true },
    says: /^fill: field still shows 6 characters after clearing twice$/,
  },
  'clear-twice: a masked field the deletes do not change': {
    build: () => {
      const f = fieldFake({ value: '••••••••' });
      f.fake.clearText = async (n: number) => void f.fake.deletes.push(n);
      return f;
    },
    opts: { clear: true },
    says: /^fill: field still shows 8 characters after clearing twice$/,
  },
  'mismatch: unchanged': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      typing(f.fake, (held) => held);
      return f;
    },
    says: /the field did not change/,
  },
  'mismatch: masked': {
    build: () => {
      const f = fieldFake({ secure: true });
      typing(f.fake, (held, typed) => held + '•'.repeat(typed.length - 1));
      return f;
    },
    says: /\(masked field — compared by length; it held 0 after focus\)$/,
  },
  'mismatch: masked-said-plain': {
    build: () => {
      const f = fieldFake({ secure: false });
      onFocus(f.fake, (field) => (field.value = '•••••'));
      typing(f.fake, (held, typed) => held + '•'.repeat(typed.length - 2));
      return f;
    },
    says: /\(masked field, though its source said it is plain/,
  },
  'mismatch: case': {
    build: () => {
      const f = fieldFake();
      typing(f.fake, (held, typed) => held + typed.charAt(0).toUpperCase() + typed.slice(1));
      return f;
    },
    says: /the typed text is there but for letter case, 1 character differing/,
  },
  'mismatch: case, after one wipe and retype over the field\'s text': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      typing(f.fake, (held, typed) => held + typed.charAt(0).toUpperCase() + typed.slice(1));
      return f;
    },
    opts: { clear: true },
    says: /^fill: typed 8 characters \(after one wipe and retype\) but the field shows 8 — the typed text is there but for letter case/,
  },
  'mismatch: same-length': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      typing(f.fake, (held, typed) => held + typed.replace('u', 'v'));
      return f;
    },
    says: /as many characters as were typed, 1 differing/,
  },
  'mismatch: dropped-tail': {
    build: () => {
      const f = fieldFake();
      typing(f.fake, (held, typed) => (held.replace(/ /g, '') + typed.slice(0, 6)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '));
      return f;
    },
    value: DIGITS,
    says: /the first 6 typed characters are there, grouped by the field .* the last 2 did not land/,
  },
  'mismatch: separated': {
    build: () => {
      const f = fieldFake();
      typing(f.fake, (held, typed) => (held + typed).replace(/^(\d{6})(\d+)$/, '$1.$2'));
      return f;
    },
    value: DIGITS,
    says: /every typed character is there, in order, with 1 separator added/,
  },
  'mismatch: length': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      typing(f.fake, (held, typed) => held + typed.slice(0, 5));
      return f;
    },
    says: /^fill: typed 8 characters but the field shows 13 \(content withheld from this error\)$/,
  },
  'mismatch: length, the value itself (select-all)': {
    build: () => {
      const f = fieldFake({ value: 'h§' });
      typing(f.fake, (_held, typed) => typed);
      return f;
    },
    value: 'h§h§',
    says: /the field shows only the typed text, where an append would show 6 — the field may have replaced its text/,
  },
  'mismatch: length, padded by the earlier text': {
    build: () => {
      const f = fieldFake({ value: 'PRE¤' });
      typing(f.fake, (held, typed) => held + typed.slice(0, 4));
      return f;
    },
    says: /the field shows 8, only 4 of them past its earlier text/,
  },
  'mismatch: length, exactly its placeholder': {
    build: () => {
      const f = fieldFake({ value: 'PRE¤', placeholder: PREFILL });
      typing(f.fake, () => PREFILL);
      return f;
    },
    says: /the field shows 8, exactly its placeholder: empty, or the typing turned into that text/,
  },
  'mismatch: length, partly masked': {
    build: () => {
      const f = fieldFake();
      typing(f.fake, (held, typed) => held + '•'.repeat(typed.length - 1) + typed.slice(-1));
      return f;
    },
    says: /the field shows 8, some of them bullets/,
  },
  'mismatch: the typing left the field (elsewhere)': {
    build: () => {
      const f = fieldFake();
      f.fake.typingDelivery = 'on-return';
      const other = f.fake.live().children[1];
      f.fake.typeText = async (text: string) => {
        f.fake.typed.push(text);
        for (const ch of text) {
          const box = f.fake.focused;
          if (box === undefined) return;
          box.value = (box.value ?? '') + ch;
          if (box !== other) f.fake.focused = other;
        }
      };
      return f;
    },
    says: /; the typing left the field: textfield id:"other" .* changed while it typed/,
  },
  'refused: a character the adapter cannot type': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      f.fake.typeable = FAKE_TYPEABLE;
      return f;
    },
    opts: { clear: true },
    says: /U\+00A7/,
  },
  'refused: a control character': {
    build: () => fieldFake({ value: PREFILL }),
    value: `${TYPED}\u0007`,
    says: /U\+0007/,
  },
};

describe('the leak sweep: every error a fill throws', () => {
  it.each(Object.keys(FAILURES))('%s: its own words, and no piece of the value or the field\'s text', async (name) => {
    const c = FAILURES[name];
    const { fake, readings } = c.build();
    const value = c.value ?? TYPED;
    const error = await rejection(fillField(fake, ID, value, { ...FAST, ...c.opts }));
    expect(error.message).toMatch(c.says);
    expectNoContent(errorShown(error), forbidden(value, readings), 'id:"field"');
  });
});

interface VerdictCase {
  build: () => FieldFake;
  value?: string;
  opts?: Partial<FillOptions>;
  /** The reply's own words: proof the case reached its verdict and caveat. */
  says: RegExp;
}

/** A label laid over an input of its own (an iOS idb floating label): a `text` node whose label and value are `PREFILL`. */
const overLabel = (): FieldFake => fieldFake({ role: 'text', label: PREFILL, value: PREFILL });

const VERDICTS: Record<string, VerdictCase> = {
  filled: { build: () => fieldFake(), says: /^Filled id:field \(8 characters\)$/ },
  'filled, the field\'s text cleared first': {
    build: () => fieldFake({ value: PREFILL }),
    opts: { clear: true },
    says: /^Filled id:field \(8 characters, cleared 8 characters first\)$/,
  },
  'typed, not-input': {
    build: overLabel,
    says: /^Typed 8 characters into id:field — NOT verified: .*\n⚠ the matched node is role text, not a textfield — typing goes/,
  },
  'cleared: deletes the field ignored': {
    build: () => {
      const f = fieldFake({ value: PREFILL });
      f.fake.clearText = async (n: number) => void f.fake.deletes.push(n);
      return f;
    },
    value: '',
    opts: { clear: true },
    says: /^Cleared id:field \(8 deletes sent\) — NOT verified: the field still shows 8 characters that the deletes did not change/,
  },
  'focused, not-input (a clear sent no delete)': {
    build: overLabel,
    value: '',
    opts: { clear: true },
    says: /^Focused id:field — NOT verified: clear sent no delete .*\n⚠ the matched node is role text, not a textfield — nothing was deleted/,
  },
  'filled, masked-append': {
    build: () => {
      const f = fieldFake({ secure: true, value: '••••' });
      typing(f.fake, (held, typed) => held + '•'.repeat(typed.length));
      return f;
    },
    says: /^Filled id:field \(8 characters\)\n⚠ masked field already held 4 characters and clear is not set/,
  },
  'filled, reformatted-point': {
    build: () => {
      const f = fieldFake();
      typing(f.fake, (held, typed) => (held.replace(/\./g, '') + typed).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
      return f;
    },
    value: DIGITS,
    says: /^Filled id:field \(8 characters\)\n⚠ the field shows them reformatted: 2 separators added — it added '\.': check it is a thousands separator/,
  },
  'filled, focus-unread': {
    build: () => {
      const f = fieldFake({ secure: false });
      onFocus(f.fake, (field) => (field.value = `${PREFILL} `));
      return f;
    },
    says: /^Filled id:field \(8 characters\)\n⚠ the field shows 17 characters for the 8 typed, and its text after focus was not read/,
  },
};

describe('the leak sweep: every verdict and caveat, in both media', () => {
  it.each(Object.keys(VERDICTS))('%s: its own words, and no piece of the value or the field\'s text', async (name) => {
    const c = VERDICTS[name];
    const { fake, readings } = c.build();
    const value = c.value ?? TYPED;
    const result = await fillField(fake, ID, value, { ...FAST, ...c.opts });
    const reply = fillReply(result, SELECTOR);
    expect(reply).toMatch(c.says);
    const step = fillStepText(result, { step: SELECTOR, shown: '***' });
    const shown = {
      reply,
      line: step.line.text,
      caveats: step.caveats.map((l) => l.text).join('\n'),
      facts: inspect(result, { depth: 5 }),
    };
    expectNoContent(shown, forbidden(value, readings), SELECTOR);
  });
});

describe('the rule\'s one exception: the selector is echoed as the caller wrote it', () => {
  it('reread-failed under a `value:"PREFILL¤"` selector quotes the selector verbatim, and nothing else of the field', async () => {
    const { fake, readings } = FAILURES['reread-failed'].build();
    const selector = `value:"${PREFILL}"`;
    const error = await rejection(fillField(fake, selector, TYPED, { ...FAST, clear: true }));
    expect(error.message).toMatch(/^fill: could not re-read value:"PREFILL¤" after focusing it — adb: device offline\./);
    expectNoContent(errorShown(error), forbidden(TYPED, readings), selector);
  });

  describe('a flow: a secret written into a `text:` selector is redacted by the engine, `***` on every line', () => {
    const config = parseConfig(`
app:
  android: { package: md.bank.app }
credentials:
  secret: \${LEAK_SECRET}
flows:
  f:
    steps:
      - fill: { text: "${TYPED}", value: $secret }
`);
    const opts = { pollMs: 5, tapTimeoutMs: 200, waitTimeoutMs: 300, ensureTimeoutMs: 300, optionalTimeoutMs: 50, assertTimeoutMs: 100, pinKeyDelayMs: 1, env: { LEAK_SECRET: TYPED } };
    const labelled = () => fieldFake({ label: TYPED });

    it('the trace of a fill that lands', async () => {
      const { fake } = labelled();
      const trace = await FlowEngine.run(config, fake, { ...opts, session: new EngineSession() }, { flow: 'f' });
      expect(trace).toContainEqual({ action: 'fill', detail: 'text:"***" = ***' });
      expect(JSON.stringify(trace)).not.toContain(TYPED);
    });

    it('the error of a fill whose re-read fails', async () => {
      const { fake } = labelled();
      let reads = 0;
      const read = fake.uiTree.bind(fake);
      fake.uiTree = async () => {
        if (reads++ >= 2) throw new Error('adb: device offline');
        return read();
      };
      const error = await rejection(FlowEngine.run(config, fake, { ...opts, session: new EngineSession() }, { flow: 'f' }));
      expect(error).toBeInstanceOf(FlowError);
      expect(error.message).toMatch(/^fill: could not re-read text:"\*\*\*" after focusing it/);
      expect(`${error.message}\n${JSON.stringify((error as FlowError).trace)}`).not.toContain(TYPED);
    });
  });
});
