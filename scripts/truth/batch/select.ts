import { refusedLine, stepLine } from './words.js';

/**
 * What a run does, decided before anything is done: which blocks (ONLY=) and with which knobs. Pure — the env is a
 * plain record. A refusal is a list of lines for the batch to print before it exits 2 (words.ts#EXIT.nothingDone), with
 * no device call, no build and no folder made.
 */

/** The blocks a run does, in the batch's order; or why it must not start. */
export type Selection = { ok: true; wanted: string[]; warnings: string[] } | { ok: false; errors: string[] };

/**
 * ONLY=: the blocks named (commas or spaces between), in the batch's order, each once. No ONLY, or an empty one: every
 * block. A name that is no block of the batch is a WARN and ignored; when no block is left the run must not start.
 * Names are case-sensitive, as the batch's own.
 */
export function selectBlocks(blocks: readonly string[], only: string | undefined): Selection {
  if (only === undefined || only === '') return { ok: true, wanted: [...blocks], warnings: [] };
  const named = only.split(/[\s,]/).filter((n) => n !== '');
  const warnings = [...new Set(named.filter((n) => !blocks.includes(n)))].map(
    (n) => stepLine('WARN', `ONLY names '${n}', which is not a block of this batch (${blocks.join(', ')}): ignored`),
  );
  const wanted = blocks.filter((b) => named.includes(b));
  if (wanted.length === 0) return { ok: false, errors: [...warnings, refusedLine(`ONLY=${only} names no block of this batch`)] };
  return { ok: true, wanted, warnings };
}

/** A whole-number knob: its default, its least value, its greatest (none: unbounded), and a reason or unit to name. */
export interface CountKnob {
  default: number;
  min: number;
  max?: number;
  /** Said after the rule when the knob is refused (`0 is refused: …`). */
  why?: string;
  /** Named in the rule (`a whole number of seconds >= 30`). */
  unit?: string;
}

/**
 * A text knob: empty (its default) or matching `pattern` whole — anchors are added, so `/[0-9a-f]{7,40}/` takes a sha
 * and nothing around it. No g or y flag (their lastIndex would make the same value pass once and fail the next time),
 * and no m flag (its anchors would match one line of a value that holds several).
 * `what` says what it must be.
 */
export interface TextKnob {
  default: string;
  pattern: RegExp;
  what: string;
}

/** A batch's knobs: counts, texts, and the cross checks (`low` ≤ `high`, both counts). */
export interface KnobSpec {
  counts?: Readonly<Record<string, CountKnob>>;
  texts?: Readonly<Record<string, TextKnob>>;
  atMost?: readonly { low: string; high: string; why: string }[];
}

/** The values of a spec's knobs, typed from it: each count a number, each text a string. */
export type KnobValues<S extends KnobSpec> = (S extends { counts: infer C } ? { [K in keyof C]: number } : unknown) &
  (S extends { texts: infer T } ? { [K in keyof T]: string } : unknown);

export type Knobs<S extends KnobSpec = KnobSpec> = { ok: true; values: KnobValues<S> } | { ok: false; errors: string[] };

const WHOLE = /^\d+$/;
/** An env variable's name, as a batch's knobs are named. */
const KNOB_NAME = /^[A-Z][A-Z0-9_]*$/;

/** `pattern` matching the whole value: the source wrapped in anchors, its flags kept. */
const matchingWhole = (pattern: RegExp): RegExp => new RegExp(`^(?:${pattern.source})$`, pattern.flags);

/** Whether `v` keeps the count knob's rule: a safe whole number within its floor and ceiling. */
const keepsRule = (k: CountKnob, v: number): boolean => Number.isSafeInteger(v) && v >= k.min && (k.max === undefined || v <= k.max);

/** The rule a count knob is held to, in words. */
function ruleOf(k: CountKnob): string {
  if (k.max === k.min + 1) return `${k.min} or ${k.max}`;
  const number = k.unit === undefined ? 'a whole number' : `a whole number of ${k.unit}`;
  const range = k.max === undefined ? `>= ${k.min}` : `from ${k.min} to ${k.max}`;
  return `${number} ${range} is needed${k.why === undefined ? '' : ` (${k.why})`}`;
}

/** The spec's own mistakes — a programming error, thrown, never a refusal line. */
function checkSpec(spec: KnobSpec): void {
  const names = [...Object.keys(spec.counts ?? {}), ...Object.keys(spec.texts ?? {})];
  for (const name of names) {
    if (!KNOB_NAME.test(name)) throw new Error(`knob name ${JSON.stringify(name)}: an env variable's name (A-Z, 0-9, _) is needed`);
    if (names.indexOf(name) !== names.lastIndexOf(name)) throw new Error(`knob ${name} is declared twice`);
  }
  for (const [name, k] of Object.entries(spec.counts ?? {})) {
    if (!keepsRule(k, k.default)) throw new Error(`${name}'s default ${k.default} breaks its own rule (${ruleOf(k)})`);
  }
  for (const [name, k] of Object.entries(spec.texts ?? {})) {
    if (/[gmy]/.test(k.pattern.flags)) throw new Error(`${name}'s pattern ${k.pattern} has the g, m or y flag: a knob's pattern holds no state and matches the whole value, not a line of it`);
    if (k.default !== '' && !matchingWhole(k.pattern).test(k.default)) throw new Error(`${name}'s default ${JSON.stringify(k.default)} breaks its own rule (${k.what})`);
  }
  for (const { low, high } of spec.atMost ?? []) {
    for (const n of [low, high]) if (spec.counts?.[n] === undefined) throw new Error(`atMost names ${n}, which is no count knob`);
  }
}

/**
 * Whether `env` sets the knob `name`: any value but the empty one (zsh's `${K:-d}` reads empty as unset), as knobs()
 * reads it — unset, the knob takes its default.
 */
export const knobGiven = (env: Readonly<Record<string, string | undefined>>, name: string): boolean => env[name] !== undefined && env[name] !== '';

/**
 * Every knob from `env`, each checked: a count must be a whole number (digits only: no sign, fraction, exponent or
 * space) within its rule; a text empty or matching its pattern. An unset or empty variable takes the default (zsh's
 * `${K:-d}`). Then the cross checks, each only when both sides passed. Every error at once, in the spec's order.
 */
export function knobs<S extends KnobSpec>(spec: S, env: Readonly<Record<string, string | undefined>>): Knobs<S> {
  checkSpec(spec);
  const values: Record<string, number | string> = {};
  const counted = new Map<string, number>();
  const errors: string[] = [];
  const given = (name: string): string | undefined => (knobGiven(env, name) ? env[name] : undefined);
  for (const [name, k] of Object.entries(spec.counts ?? {})) {
    const raw = given(name);
    const v = raw === undefined ? k.default : WHOLE.test(raw) ? Number(raw) : Number.NaN;
    if (keepsRule(k, v)) {
      values[name] = v;
      counted.set(name, v);
    } else errors.push(refusedLine(`${name}=${raw}: ${ruleOf(k)}`));
  }
  for (const [name, k] of Object.entries(spec.texts ?? {})) {
    const raw = given(name) ?? k.default;
    if (raw === '' || matchingWhole(k.pattern).test(raw)) values[name] = raw;
    else errors.push(refusedLine(`${name}=${raw}: ${k.what}`));
  }
  // A side already refused has no value: NaN, which compares false, so the cross check adds no second error.
  for (const { low, high, why } of spec.atMost ?? []) {
    const [l, h] = [counted.get(low) ?? Number.NaN, counted.get(high) ?? Number.NaN];
    if (l > h) errors.push(refusedLine(`${low}=${l} > ${high}=${h}: ${why}`));
  }
  // The keys are exactly the spec's counts and texts, set above: KnobValues<S> by construction.
  return errors.length === 0 ? { ok: true, values: values as KnobValues<S> } : { ok: false, errors };
}
