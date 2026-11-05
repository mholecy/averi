import { describe, expect, it, vi } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import type { Difference, FillFailure, OtherInput } from '../../src/interact/fill-facts.js';
import { landingOf, readingOf, type Expectation, type Reading } from '../../src/interact/fill-landing.js';
import { fillFailureText } from '../../src/interact/fill-text.js';
import { typeAndConfirm, type FieldIo, type Typed, type TypingIntent } from '../../src/interact/fill-type.js';
import { node } from '../helpers/fake.js';
import * as old from './fill-landing.js';
import { fillFailureText as oldFailureText } from './fill-text.js';
import { typeAndConfirm as oldTypeAndConfirm } from './fill-type.js';

/**
 * A9's temporary differential: the frozen base fill-landing.ts, fill-type.ts and fill-text.ts against the new ones.
 * Deleted with slice 7. Golden never types, so this and the unit tests are the only pin that A9 changed nothing.
 */

const log: { current: unknown[] } = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number) => {
    log.current.push(['sleep', ms]);
  },
}));

/** The old modules' five questions composed as the new `Reading`. */
function composedOld(observed: string, e: Expectation): Reading {
  const landing = old.landingOf(observed, e);
  if (landing !== undefined) {
    if (landing.kind === 'said-plain') return { kind: 'said-plain', differs: old.differenceOf(observed, e) as { kind: 'masked-said-plain' } };
    return landing;
  }
  const tail = old.tailOf(observed, e);
  const retyped = old.droppedTail(observed, e);
  return {
    kind: old.tookText(observed, e) ? 'missed' : 'not-taken',
    ...(tail !== undefined && { tail: { missing: tail.missing, retypable: retyped !== undefined } }),
    differs: old.differenceOf(observed, e),
  } as Reading;
}

/** Canonical: keys sorted, undefined dropped — two equal values print alike. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x !== null && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

const VALUES = ['a', 'ab', '11', '1', '-5', ' 42', '12', '1234', '1234,5', '12345678', 'SK3112', 'hello', 'Jan Novak', '1 ', '12/', 'Ab', '••', 'world', '+421903'];
const BEFORES: (string | null)[] = [null, '', 'a', '1', '-5', 'a1', 'ab', 'Search', '__.__', '+421', '1,000', '••', 'hello', 'Note: hello', 'SK31'];
const PLACEHOLDERS: (string | undefined)[] = [undefined, 'Search', 'a'];
const HELDS: Expectation['held'][] = [0, 2, 'unread'];
const INPUTS: Pick<Expectation, 'isInput' | 'resolvedValue'>[] = [
  { isInput: true, resolvedValue: null },
  { isInput: false, resolvedValue: null },
  { isInput: false, resolvedValue: 'Meno' },
];

/** The readings a typing can leave: prefixes of what should be held, grouped, decorated, replaced, masked. */
function readingsFor(value: string, before: string | null, placeholder: string | undefined): string[] {
  const whole = (before ?? '') + value;
  const out = new Set<string>(['', 'Meno', 'x', value, whole, value.toUpperCase(), whole.toUpperCase(), value + value, whole + value[0], '•', '••', '•••', '••••', '••••••', '•••t', `${value} `, `${whole} `, `${value}-`, `-${value}`, `${value[0]}x`, `(${value})`]);
  if (before !== null) out.add(before);
  if (placeholder !== undefined) out.add(placeholder);
  for (const t of [whole, value])
    for (let k = 1; k < t.length; k++) {
      const head = t.slice(0, k);
      out.add(head);
      out.add(`${head} `);
      out.add(`${head}.`);
      out.add(`${head} ${t.slice(k)}`);
      out.add(`${head}.${t.slice(k)}`);
      out.add(`${head} ${t.slice(k)}`);
      out.add(`${head},${t.slice(k, k + 1)}`);
    }
  return [...out];
}

const expectations = function* (): Generator<Expectation> {
  for (const value of VALUES)
    for (const before of BEFORES)
      for (const clear of [false, true])
        for (const placeholder of [...PLACEHOLDERS, ...(before !== null && before !== '' && !PLACEHOLDERS.includes(before) ? [before] : [])])
          for (const held of HELDS) for (const input of INPUTS) yield { value, before, clear, placeholder, held, ...input };
};

describe('A9 differential: readingOf against the old composition', () => {
  it('every row of reading × value × before × clear × placeholder × held × isInput', () => {
    let rows = 0;
    const kinds = new Map<string, number>();
    for (const e of expectations()) {
      const readings = readingsFor(e.value, e.before, e.placeholder);
      for (const observed of readings) {
        rows++;
        const was = composedOld(observed, e);
        const is = readingOf(observed, e);
        if (canon(was) !== canon(is)) expect(is, canon({ observed, e })).toEqual(was);
        const landingWas = old.landingOf(observed, e);
        const landingIs = landingOf(observed, e);
        if (landingWas?.kind !== landingIs?.kind || canon(landingWas?.kind === 'landed' ? landingWas : undefined) !== canon(landingIs?.kind === 'landed' ? landingIs : undefined)) expect(landingIs).toEqual(landingWas);
        const key = is.kind + ('differs' in is ? `:${is.differs.kind}` : '') + ('tail' in is && is.tail !== undefined ? (is.tail.retypable ? ':retypable' : ':tail') : '');
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
        if ('differs' in is) {
          const failure = { code: 'mismatch', typed: e.value.length, shows: observed.length, differs: is.differs } as const;
          if (fillFailureText(failure) !== oldFailureText(failure)) expect(fillFailureText(failure)).toBe(oldFailureText(failure));
        }
      }
    }
    console.log(`A9 differential rows: ${rows}`, Object.fromEntries([...kinds].sort()));
    expect(rows).toBeGreaterThan(500_000);
    for (const kind of ['landed', 'placeholder', 'said-plain:masked-said-plain', 'missed:unchanged', 'missed:unchanged:retypable', 'missed:length:retypable', 'missed:dropped-tail:retypable', 'missed:dropped-tail:tail', 'missed:length:tail', 'not-taken:length', 'missed:masked', 'missed:separated', 'missed:case', 'missed:same-length']) {
      expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(0);
    }
  }, 300_000);
});

/** A small seeded generator: the scripts are the same on every run. */
function random(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)];
  return { next, pick };
}

interface Script {
  intent: Omit<TypingIntent, 'field'>;
  /** Per typing sent (the 1st, 2nd, …; the last repeats): the read results of its poll (the last repeats). */
  rounds: (string | undefined)[][];
  /** The sibling's value after each typing (undefined: unchanged; 'gone': off the tree; 'moved': another rect). */
  sibling: (string | null | undefined | 'gone' | 'moved')[];
  sibling0: string | null;
  noScreenBefore: boolean;
  noScreenAfter: boolean;
}

function scriptOf(seed: number): Script {
  const r = random(seed);
  const e: Expectation = {
    value: r.pick(VALUES),
    before: r.pick(BEFORES),
    clear: r.next() < 0.4,
    placeholder: r.pick(PLACEHOLDERS),
    held: r.next() < 0.75 ? 0 : r.pick(HELDS),
    ...(r.next() < 0.85 ? INPUTS[0] : r.pick(INPUTS)),
  };
  const readings = readingsFor(e.value, e.before, e.placeholder);
  // Mostly a strict prefix (what a retype can act on), or what the rows sweep at large.
  const whole = (e.clear ? '' : (e.before ?? '')) + e.value;
  const prefixes = whole.length > 1 ? Array.from({ length: whole.length - 1 }, (_, i) => whole.slice(0, i + 1)) : [whole];
  const reading = () => (r.next() < 0.5 ? r.pick(prefixes) : r.pick(readings));
  const rounds = Array.from({ length: 1 + Math.floor(r.next() * 4) }, () => {
    const steady = reading();
    const shape = r.next();
    if (shape < 0.7) return [steady];
    if (shape < 0.85) return [reading(), steady];
    if (shape < 0.95) return [steady, steady, steady, steady, reading()];
    return [r.next() < 0.5 ? undefined : steady, undefined];
  });
  const part = () => e.value.slice(Math.floor(r.next() * e.value.length));
  const missingEnd = () => whole.slice(-1 - Math.floor(r.next() * 2));
  const sibling0 = r.pick([null, 'o', '']);
  const sibling = Array.from({ length: 4 }, (): Script['sibling'][number] => {
    const shape = r.next();
    if (shape < 0.55) return undefined;
    if (shape < 0.8) return (sibling0 ?? '') + (r.next() < 0.5 ? missingEnd() : part());
    if (shape < 0.9) return 'recomputed';
    return r.pick(['gone', 'moved'] as const);
  });
  return {
    intent: { ...e, pollMs: r.pick([1, 7]), delivery: r.next() < 0.8 ? 'on-return' : 'may-arrive-late' },
    rounds,
    sibling,
    sibling0,
    noScreenBefore: r.next() < 0.03,
    noScreenAfter: r.next() < 0.03,
  };
}

const FIELD_RECT = { x: 0, y: 0, width: 100, height: 20 };

async function runScript(type: (io: FieldIo, intent: TypingIntent) => Promise<Typed>, s: Script): Promise<{ io: unknown[]; typed: Typed }> {
  const calls: unknown[] = [];
  log.current = calls;
  const field = node({ role: 'textfield', identifier: 'f', rect: FIELD_RECT, value: s.intent.before });
  let typings = 0;
  let reads = 0;
  let screens = 0;
  let sibling: string | null = s.sibling0;
  let gone = false;
  let moved = false;
  const tree = (): UiNode =>
    node({
      role: 'container',
      rect: { x: 0, y: 0, width: 400, height: 800 },
      children: [field, ...(gone ? [] : [node({ role: 'textfield', identifier: 'o', rect: { x: 0, y: moved ? 50 : 40, width: 100, height: 20 }, value: sibling })])],
    });
  const io: FieldIo = {
    type: async (text) => {
      calls.push(['type', text]);
      const change = s.sibling[Math.min(typings, s.sibling.length - 1)];
      typings++;
      reads = 0;
      if (change === 'gone') gone = true;
      else if (change === 'moved') moved = true;
      else if (change !== undefined) sibling = change;
    },
    wipe: async (count) => {
      calls.push(['wipe', count]);
    },
    read: async () => {
      const round = s.rounds[Math.min(typings - 1, s.rounds.length - 1)];
      const v = round[Math.min(reads, round.length - 1)];
      reads++;
      calls.push(['read', v ?? null]);
      return v;
    },
    screen: () => {
      calls.push(['screen']);
      const first = screens === 0;
      screens++;
      if ((first && s.noScreenBefore) || (!first && s.noScreenAfter)) return undefined;
      return tree();
    },
    reportDroppedTail: () => {
      calls.push(['report']);
    },
  };
  const typed = await type(io, { ...s.intent, field });
  return { io: calls, typed };
}

const NOT_INPUT = { role: 'other', input: 'none' } as const;
const failures = (t: Extract<Typed, { kind: 'missed' }>, value: string): FillFailure[] => {
  const base = { code: 'mismatch', typed: value.length, shows: t.observed.length, differs: t.differs, ...(t.again.length > 0 && { again: t.again }), ...(t.elsewhere !== undefined && { elsewhere: t.elsewhere as OtherInput }) } as const;
  return [base, { ...base, notInput: NOT_INPUT }];
};

describe('A9 differential: scripted reads through both typeAndConfirm', () => {
  it('ordered io and sleep logs, Typed and the failure bytes', async () => {
    const SCRIPTS = 150_000;
    const seen = new Map<string, number>();
    const note = (k: string) => seen.set(k, (seen.get(k) ?? 0) + 1);
    for (let seed = 1; seed <= SCRIPTS; seed++) {
      const s = scriptOf(seed);
      const was = await runScript(oldTypeAndConfirm as (io: FieldIo, intent: TypingIntent) => Promise<Typed>, s);
      const is = await runScript(typeAndConfirm, s);
      if (canon(was.io) !== canon(is.io)) expect(is.io, canon({ seed, s })).toEqual(was.io);
      const elsewhere = was.typed.kind === 'missed' && was.typed.elsewhere !== undefined;
      if (elsewhere) {
        // the elsewhere branch's differs may lose wholeToo (A9): bytes, not differs
        const { differs: _w, ...restWas } = was.typed as Extract<Typed, { kind: 'missed' }>;
        const { differs: _i, ...restIs } = is.typed as Extract<Typed, { kind: 'missed' }>;
        if (canon(restWas) !== canon(restIs)) expect(restIs, canon({ seed, s })).toEqual(restWas);
      } else if (canon(was.typed) !== canon(is.typed)) expect(is.typed, canon({ seed, s })).toEqual(was.typed);
      if (was.typed.kind === 'missed' && is.typed.kind === 'missed') {
        const a = failures(was.typed, s.intent.value).map(oldFailureText);
        const b = failures(is.typed, s.intent.value).map(fillFailureText);
        if (canon(a) !== canon(b)) expect(b, canon({ seed, s })).toEqual(a);
      }
      note(was.typed.kind);
      if (was.io.some((c) => (c as unknown[])[0] === 'report')) note('reported');
      if (was.io.some((c) => (c as unknown[])[0] === 'wipe')) note('wiped');
      if (was.typed.kind === 'missed') {
        const d: Difference = was.typed.differs;
        note(`missed:${d.kind}`);
        const whole = 'wholeToo' in d && d.wholeToo === true;
        if (whole) note('missed:wholeToo');
        if (elsewhere) note('missed:elsewhere');
        if (whole && elsewhere) note('missed:wholeToo+elsewhere');
        for (const a of was.typed.again) note(`again:${a.kind}`);
        if (was.typed.again.filter((a) => a.kind === 'tail').length === 2) note('again:two tails');
      }
      if (was.typed.kind === 'landed' && was.typed.again.some((a) => a.kind === 'tail')) note('landed through a tail');
    }
    console.log(`A9 differential scripts: ${SCRIPTS}`, Object.fromEntries([...seen].sort()));
    for (const k of ['landed', 'not-taken', 'unread', 'missed', 'reported', 'wiped', 'again:tail', 'again:whole', 'again:two tails', 'missed:elsewhere', 'missed:wholeToo', 'missed:wholeToo+elsewhere', 'missed:masked-said-plain', 'landed through a tail']) {
      expect(seen.get(k) ?? 0, k).toBeGreaterThan(0);
    }
  }, 600_000);
});
