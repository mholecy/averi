/**
 * Type a value into a focused field and CONFIRM it is there — the one module
 * that decides when typed text has landed, how long to wait for it, and what
 * to send again when it has not. interact/fill.ts drives it after the focus
 * tap and the clear; nothing else types into a field it then reads back.
 *
 * Interface: `typeAndConfirm(io, intent) → Typed`. `io` is the device as the
 * field sees it (type, delete, read the field's text); `intent` is what the
 * field should end up holding and how to compare. The outcome is facts:
 * landed or not, the last reading, and what was typed again. Every wording is
 * interact/fill-text.ts's; every verdict interact/fill-verdict.ts's.
 *
 * The rules it owns:
 * - `landed`: an input must SHOW the value (with clear: exactly; without: the
 *   value inside what it holds — a named placeholder is no content); a masked
 *   reading is compared by length (bullets only); a non-input proves it took
 *   the text only by CHANGING to show it (`tookText`). The history of each
 *   clause is in the comments below; they moved here unchanged from fill.ts
 *   (2026-10-19).
 * - the poll: five reads at `pollMs` until the reading lands, never stopping
 *   early on an unchanged mismatch (`pollValue`).
 * - what is sent again, bounded, in this order:
 *   1. A DROPPED TAIL (2026-10-19, docs/bugs/2026-10-19-ios-fill-loses-the-
 *      tail-of-its-text-in-a-react-native-single-line-field.md, ADR 0023):
 *      the field holds a strict prefix of what it should hold — some of the
 *      typed characters landed, the end did not — and the reading held still
 *      over the poll's last two reads. Only the missing tail is typed, up to
 *      `MAX_TAIL_RETYPES` times, and again only while each retype moved the
 *      field. Never on a reading with a bullet (a masked field's content
 *      cannot be compared, so a prefix cannot be seen), never when nothing of
 *      the typing landed (the focus may not be in the field — the typing went
 *      somewhere else), never when the field's earlier text changed: only a
 *      strict prefix proves which characters are missing, so a retype can
 *      never duplicate one that is there. Measured on React Native 0.88's
 *      controlled single-line TextInput under `idb ui text`: 6 of 12 fills
 *      kept a prefix (up to 6 of 9 characters lost), the field itself holding
 *      the short value; the measurement of the remedy is in the note.
 *   2. With clear only: one wipe of what the field holds and a retype of the
 *      whole value — the content is ours (unchanged since 2026-08-05: Compose
 *      async state swallowing synthetic input).
 *   Without clear and without a prefix nothing is sent again: the field came
 *   with content that is not ours to delete.
 */

import { hasBullet, isMaskedValue } from '../ui-tree/masked-value.js';
import { sleep } from '../util/sleep.js';
import { heldText } from './fill-facts.js';

/** The field as the typing sees it: send text, delete characters, read what it shows. */
export interface FieldIo {
  type(text: string): Promise<void>;
  /** Delete `count` characters (DeviceAdapter.clearText). */
  wipe(count: number): Promise<void>;
  /** The field's text on a fresh read — "" for an empty input; undefined when the node withholds text or was not found. */
  read(): Promise<string | undefined>;
}

/** What the field should hold, and how it is compared. */
export interface TypingIntent {
  /** The value to type; non-empty (an empty fill types nothing and reads nothing back). */
  value: string;
  /** The field was cleared first: it must EQUAL the value, and a mismatch may be wiped and retyped. */
  clear: boolean;
  /** The matched node is an input (INPUT_ROLE); otherwise it proves it took the text only by changing to show it. */
  isInput: boolean;
  /** The matched node's value when it was resolved, before the focus tap — what a non-input shows of itself. */
  resolvedValue: string | null;
  /** What the field showed when typing began (null: nothing) — the text the typing appends to. */
  before: string | null;
  /** The field's named placeholder (UiNode.placeholder): shown while empty, never content. */
  placeholder: string | undefined;
  /** The bullets a masked field held after focus — a masked read-back must show these plus the typed length. */
  maskedHeld: number;
  pollMs: number;
}

/**
 * What typing achieved, as facts:
 * - `landed`: a read showed the value (`observed`, the last reading);
 * - `not-taken`: a non-input whose reading never took the text — not the field;
 * - `unread`: no reading to compare (the node withholds its text, or the last read did not find the field);
 * - `missed`: the last reading is not the value after everything was sent again.
 * `retyped`: each dropped tail typed again, by its length, in order (empty: none). `retried`: the clear's wipe and
 * retype of the whole value ran — `wiped` when it deleted what the field held first.
 */
export type Typed =
  | { kind: 'landed'; observed: string; retyped: number[] }
  | { kind: 'not-taken'; observed: string }
  | { kind: 'unread' }
  | { kind: 'missed'; observed: string; retyped: number[]; retried?: { wiped: boolean } };

/** How many times a dropped tail is typed again (ADR 0023): the second covers a tail the first retype lost a part of. */
export const MAX_TAIL_RETYPES = 2;

/** Type the value and confirm it landed; send again what the rules above allow. */
export async function typeAndConfirm(io: FieldIo, intent: TypingIntent): Promise<Typed> {
  const { value, clear } = intent;
  // A masked (secure) field shows one bullet per character to uiautomator
  // and WDA alike, so its content can never EQUAL the value — measured
  // 2026-09-17 (finportal login): `typed 16 characters but the field shows
  // 16` on both platforms, for a fill that had landed. Its LENGTH still says
  // whether every keystroke arrived, which is the check that matters on a
  // loaded emulator (dropped characters there surfaced as a backend
  // `invalid_grant`), so a bullets-only read-back is compared by count,
  // never by content. The rule detects the SHORT direction only — dropped
  // keystrokes; without `clear` the field must show at least what it held
  // after focus plus what was typed. It cannot tell a correct append from
  // typing onto an autofilled password (both read `held + typed`); that
  // case is fill.ts's `maskedAppend`, not a failure.
  // A non-input proves it took the text only by CHANGING to show it: a WDA
  // StaticText exposes its label as its value, and "Meno".includes("e") is
  // no fill; a label that changes on focus (`Name` → `Name*`) is no fill
  // either, and the clear's wipe and retype would delete ITS length into the
  // focused field (review 2026-10-08, rounds 1 and 2). An input-like node
  // of another role (an iOS search field reads `other`) shows the typed
  // text, so it still gets the retry. Masked values cannot show it: for
  // them the change alone is the proof, as their length is for inputs.
  const tookText = (observed: string) =>
    intent.isInput || (observed !== intent.resolvedValue && (isMaskedValue(observed) || observed.includes(value)));
  const landed = (observed: string) =>
    tookText(observed) &&
    (isMaskedValue(observed)
      ? clear
        ? observed.length === value.length
        : observed.length >= intent.maskedHeld + value.length
      : clear
        ? observed === value
        : // A placeholder is not content: on an empty field showing
          // `Search`, nothing typed must not pass for a typed `ear`.
          // Raw equality first: a value equal to the placeholder is the
          // one reading that cannot be told from it (see `fill-facts.ts#heldText`).
          observed === value || heldText(observed, intent.placeholder).includes(value));

  await io.type(value);
  let read = await pollValue(io.read, landed, intent.pollMs);
  const retyped: number[] = [];
  let retried: { wiped: boolean } | undefined;
  for (;;) {
    const { observed } = read;
    // undefined: the node withholds its text, or was not found — nothing to compare.
    if (observed === undefined) return { kind: 'unread' };
    // A non-input that never took the text is not the field: never wiped (its length is not the field's), never
    // retyped. Asked of the first reading only, as it always was: after a retry the last reading is a mismatch.
    if (retried === undefined && !tookText(observed)) return { kind: 'not-taken', observed };
    if (landed(observed)) return { kind: 'landed', observed, retyped };
    const tail = read.steady && retyped.length < MAX_TAIL_RETYPES ? droppedTail(observed, intent) : undefined;
    if (tail !== undefined && (retyped.length === 0 || observed !== read.prior)) {
      await io.type(tail);
      retyped.push(tail.length);
    } else if (clear && retried === undefined) {
      // What the field holds: a field showing only its placeholder (the typing never landed) gets no deletes.
      const wipe = heldText(observed, intent.placeholder).length;
      if (wipe > 0) await io.wipe(wipe);
      retried = { wiped: wipe > 0 };
      await io.type(value);
    } else {
      return { kind: 'missed', observed, retyped, ...(retried !== undefined && { retried }) };
    }
    const prior = observed;
    read = { ...(await pollValue(io.read, landed, intent.pollMs)), prior };
  }
}

/**
 * The characters the field dropped from the END of the typing, or undefined when its reading does not prove that:
 * the field must hold a STRICT prefix of what it should (its text before typing, unless cleared, then the value),
 * longer than that earlier text — some typed character landed — and no bullet (a masked reading has no comparable
 * content). Pure.
 */
export function droppedTail(observed: string, intent: Pick<TypingIntent, 'value' | 'clear' | 'before' | 'placeholder'>): string | undefined {
  if (hasBullet(observed)) return undefined;
  const held = heldText(observed, intent.placeholder);
  const prior = intent.clear ? '' : heldText(intent.before, intent.placeholder);
  if (hasBullet(prior)) return undefined;
  const whole = prior + intent.value;
  if (held.length <= prior.length || held.length >= whole.length || !whole.startsWith(held)) return undefined;
  return whole.slice(held.length);
}

/**
 * A poll's end: the last reading, whether it held still over the last two reads (`steady` — a tail is retyped only
 * then, so a late keystroke still arriving is not sent twice), and — after a retype — the reading the retype was
 * sent on (`prior`), so a retype that moved nothing is not repeated.
 */
interface PollEnd {
  observed: string | undefined;
  steady: boolean;
  prior?: string;
}

/**
 * Poll the field until its exposed value satisfies `ok`; returns the last observation.
 *
 * It does NOT stop early on a stable mismatch (considered 2026-10-09: the
 * auto-capitalised fill in docs/bugs/2026-10-09-fill-mismatch-error-says-
 * equal-counts-when-app-transforms-text.md ran its whole budget, 36 s on a
 * WDA tree that reads in ~4 s). Two equal reads 400 ms apart are what a field
 * still waiting on its input looks like too: the reason this poll exists is
 * synthetic input arriving late (Compose async state, an IME queue on a
 * loaded emulator — 3 of 11 characters measured landed at first, 2026-08-05),
 * and a stop on "unchanged" would fail exactly those fills, or with clear
 * wipe and retype them — or, since 2026-10-19, type their tail twice. The
 * cost of a transformed value is paid on a fill that fails anyway; the price
 * of stopping early would be paid by ones that pass.
 */
async function pollValue(read: () => Promise<string | undefined>, ok: (observed: string) => boolean, pollMs: number): Promise<PollEnd> {
  let observed: string | undefined;
  let previous: string | undefined;
  for (let i = 0; i < 5; i++) {
    previous = observed;
    observed = await read();
    if (observed !== undefined && ok(observed)) return { observed, steady: false };
    // No text (a non-input withholding it) or no field — stop waiting. An
    // empty input reads "" and keeps the five rounds: its text may be late.
    if (observed === undefined && i >= 1) return { observed, steady: false };
    await sleep(pollMs);
  }
  return { observed, steady: observed !== undefined && observed === previous };
}
