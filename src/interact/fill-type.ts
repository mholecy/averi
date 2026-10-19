/**
 * Type a value into a focused field and CONFIRM it is there — the one module
 * that decides when typed text has landed, how long to wait for it, and what
 * to send again when it has not. interact/fill.ts drives it after the focus
 * tap and the clear; nothing else types into a field it then reads back.
 *
 * Interface: `typeAndConfirm(io, intent) → Typed`. `io` is the device as the
 * field sees it (type, delete, read the field's text, the newest tree read);
 * `intent` is what the
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
 * - the poll: READ_BACK_POLLS (five) reads at `pollMs` until the reading lands, never stopping
 *   early on an unchanged mismatch (`pollValue`).
 * - what is sent again, bounded, in this order:
 *   1. A DROPPED TAIL (2026-10-19, docs/bugs/2026-10-19-ios-fill-loses-the-
 *      tail-of-its-text-in-a-react-native-single-line-field.md, docs/adr/0023-fill-types-a-dropped-tail-again.md):
 *      the field holds a strict prefix of what it should hold — some of the
 *      typed characters landed, the end did not — the reading held still
 *      over the poll's last two reads, the adapter's typing has arrived when
 *      its call returns (DeviceAdapter.typingDelivery `on-return`: iOS; on
 *      Android a late key could be doubled), and the typing provably stayed
 *      in the field (`whereTyped`: every other input the screen showed before
 *      the typing is there with its value — an auto-advancing code box that
 *      moved the focus would get the tail too; a sibling the app recomputed
 *      proves nothing either way, and stops the tail too). Only the missing tail is typed, up to
 *      `MAX_TAIL_RETYPES` times, and again only while each retype moved the
 *      field. Never on a reading with a bullet (a masked field's content
 *      cannot be compared, so a prefix cannot be seen), never when nothing of
 *      the typing landed (the focus may not be in the field — the typing went
 *      somewhere else), never when the field's earlier text changed: only a
 *      strict prefix proves which characters are missing, so a retype can
 *      never duplicate one that is there. Measured on React Native 0.88's
 *      controlled single-line TextInput under `idb ui text`: 6 of 12 fills
 *      kept a prefix (up to 6 of 9 characters lost), the field itself holding
 *      the short value; the measurements that chose this remedy over chunked typing are the ADR's.
 *   2. With clear only: one wipe of what the field holds and a retype of the
 *      whole value — the content is ours (since 2026-08-05: Compose async
 *      state swallowing synthetic input). Not when another input provably
 *      took part of the typing (2026-10-19, `elsewhere`): its deletes and its
 *      typing would go there; a sibling the app recomputed does not stop it.
 *   Without clear and without a prefix nothing is sent again: the field came
 *   with content that is not ours to delete.
 */

import { everyNode, INPUT_ROLE, type TypingDelivery, type UiNode } from '../adapters/types.js';
import { hasBullet, isMaskedValue } from '../ui-tree/masked-value.js';
import { sleep } from '../util/sleep.js';
import { heldText, type OtherInput, type SentAgain } from './fill-facts.js';

/** The field as the typing sees it: send text, delete characters, read what it shows. */
export interface FieldIo {
  type(text: string): Promise<void>;
  /** Delete `count` characters (DeviceAdapter.clearText). */
  wipe(count: number): Promise<void>;
  /** The field's text on a fresh read — "" for an empty input; undefined when the node withholds text or was not found. */
  read(): Promise<string | undefined>;
  /** The newest tree read — before the typing, the screen it starts on; after it, the read-back's. undefined: none yet. */
  screen(): UiNode | undefined;
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
  /** The field as the newest read before typing found it — left out of the other inputs the typing must not change. */
  field: UiNode;
  /** When the adapter's typing has reached the field (DeviceAdapter.typingDelivery): a tail is typed again only `on-return`. */
  delivery: TypingDelivery;
}

/**
 * What typing achieved, as facts:
 * - `landed`: a read showed the value (`observed`, the last reading);
 * - `not-taken`: a non-input whose reading never took the text — not the field;
 * - `unread`: no reading to compare (the node withholds its text, or the last read did not find the field);
 * - `missed`: the last reading is not the value after everything was sent again; `elsewhere` when another input
 *   changed while typing (the focus left the field — nothing was sent again then).
 * `again`: what was sent again, in the order sent (fill-facts.ts#SentAgain; empty: nothing).
 */
export type Typed =
  | { kind: 'landed'; observed: string; again: SentAgain[] }
  | { kind: 'not-taken'; observed: string }
  | { kind: 'unread' }
  | { kind: 'missed'; observed: string; again: SentAgain[]; elsewhere?: OtherInput };

/** How many times a dropped tail is typed again (docs/adr/0023-fill-types-a-dropped-tail-again.md): the second covers a tail the first retype lost a part of. */
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

  // What every other input held when typing began: the proof that the typing stayed in the field (`whereTyped`).
  const before = io.screen();
  const others = before === undefined ? undefined : inputsOf(before, inputKey(intent.field));
  await io.type(value);
  let read = await pollValue(io.read, landed, intent.pollMs);
  const again: SentAgain[] = [];
  const tails = () => again.filter((a) => a.kind === 'tail').length;
  for (;;) {
    const { observed } = read;
    // undefined: the node withholds its text, or was not found — nothing to compare.
    if (observed === undefined) return { kind: 'unread' };
    // A non-input that never took the text is not the field: never wiped (its length is not the field's), never
    // retyped. Asked of the first reading only, as it always was: after a retry the last reading is a mismatch.
    if (again.length === 0 && !tookText(observed)) return { kind: 'not-taken', observed };
    if (landed(observed)) return { kind: 'landed', observed, again };
    const where = whereTyped(others, io.screen(), missingOf(observed, intent));
    const tail =
      intent.delivery === 'on-return' && where.kind === 'field' && read.steady && tails() < MAX_TAIL_RETYPES
        ? droppedTail(observed, intent)
        : undefined;
    if (tail !== undefined && (tails() === 0 || observed !== read.prior)) {
      await io.type(tail);
      again.push({ kind: 'tail', length: tail.length });
    } else if (clear && !again.some((a) => a.kind === 'whole') && where.kind !== 'elsewhere') {
      // What the field holds: a field showing only its placeholder (the typing never landed) gets no deletes. Not when
      // the typing went into another input: the deletes would go there too.
      const wipe = heldText(observed, intent.placeholder).length;
      if (wipe > 0) await io.wipe(wipe);
      again.push({ kind: 'whole', wiped: wipe > 0 });
      await io.type(value);
    } else {
      return { kind: 'missed', observed, again, ...(where.kind === 'elsewhere' && { elsewhere: where.input }) };
    }
    const prior = observed;
    read = { ...(await pollValue(io.read, landed, intent.pollMs)), prior };
  }
}

/** Every input on a screen but the field, by role, identifier and rect, with the value it shows. */
type OtherInputs = Map<string, { input: OtherInput; value: string | null }>;

const inputKey = (n: Pick<UiNode, 'role' | 'identifier' | 'rect'>) => `${n.role}\u0000${n.identifier ?? ''}\u0000${n.rect.x},${n.rect.y},${n.rect.width},${n.rect.height}`;

/** The inputs of `tree` but the one keyed `except` (the field: its role, identifier and rect), their values copied — the read is the proof. */
function inputsOf(tree: UiNode, except?: string): OtherInputs {
  const out: OtherInputs = new Map();
  for (const n of everyNode(tree)) {
    if (n.role !== INPUT_ROLE || inputKey(n) === except) continue;
    out.set(inputKey(n), { input: { role: n.role, identifier: n.identifier, rect: { ...n.rect } }, value: n.value });
  }
  return out;
}

/**
 * Where the typing went, as far as the screen proves (2026-10-19, docs/adr/0023-fill-types-a-dropped-tail-again.md:
 * an auto-advancing code box moved the focus to the next box, and a tail typed again went into the note below — `34234`):
 * - `field`: every input the screen had when typing began is there with the value it had — nothing else took it;
 * - `elsewhere`: one of them GAINED typed text — its old value is a prefix of its new one, and what was appended is
 *   part of what the field is missing of the typing (`missing`): the typing provably went there (the code boxes:
 *   `2` and `34`, both inside the missing `234`);
 * - `unproven`: any other change — a sibling the app recomputed, replaced or shortened (ADR 0023: an exchange
 *   form's `converted` amount, set to twice the `amount` typed, made a clear fill that had always recovered fail) —
 *   or nothing read before typing, the read-back's tree missing, an input of then gone or moved, or no `missing`
 *   to compare with (the field's reading is no prefix of what it should hold).
 * The residuals: an input the tree does not list (off the screen, or none before typing) can take the focus unseen;
 * a sibling the app changes by appending, by coincidence, a part of the missing text reads `elsewhere` — the fill
 * then sends nothing again and fails loudly, the safe direction.
 */
type Whereabouts = { kind: 'field' } | { kind: 'elsewhere'; input: OtherInput } | { kind: 'unproven' };

function whereTyped(before: OtherInputs | undefined, now: UiNode | undefined, missing: string | undefined): Whereabouts {
  if (before === undefined || now === undefined) return { kind: 'unproven' };
  const after = inputsOf(now);
  let unproven = false;
  for (const [key, was] of before) {
    const is = after.get(key);
    if (is === undefined) {
      unproven = true;
      continue;
    }
    if (is.value === was.value) continue;
    const old = was.value ?? '';
    const gained = (is.value ?? '').startsWith(old) ? (is.value ?? '').slice(old.length) : '';
    if (gained !== '' && missing !== undefined && missing.includes(gained)) return { kind: 'elsewhere', input: was.input };
    unproven = true;
  }
  return unproven ? { kind: 'unproven' } : { kind: 'field' };
}

/** The text the typing lands after: the field's text before the typing (its placeholder aside), or none once cleared. */
const priorText = (intent: Pick<TypingIntent, 'clear' | 'before' | 'placeholder'>): string => (intent.clear ? '' : heldText(intent.before, intent.placeholder));

/**
 * What the field is missing of what it should hold (its text before the typing, unless cleared, then the value),
 * when its reading is a prefix of that and shows no bullet — else undefined. Pure.
 */
function missingOf(observed: string, intent: Pick<TypingIntent, 'value' | 'clear' | 'before' | 'placeholder'>): string | undefined {
  const held = heldText(observed, intent.placeholder);
  const prior = priorText(intent);
  const whole = prior + intent.value;
  if (hasBullet(held) || hasBullet(prior) || held.length >= whole.length || !whole.startsWith(held)) return undefined;
  return whole.slice(held.length);
}

/**
 * The characters the field dropped from the END of the typing, or undefined when its reading does not prove that:
 * the field must hold a STRICT prefix of what it should (its text before typing, unless cleared, then the value),
 * longer than that earlier text — some typed character landed — and no bullet (a masked reading has no comparable
 * content). Pure.
 */
export function droppedTail(observed: string, intent: Pick<TypingIntent, 'value' | 'clear' | 'before' | 'placeholder'>): string | undefined {
  if (heldText(observed, intent.placeholder).length <= priorText(intent).length) return undefined;
  return missingOf(observed, intent);
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

/** How many reads `pollValue` takes of the field at most, `pollMs` apart — a round count, not a deadline (ui-tree/read-tree.ts's module doc says why). */
const READ_BACK_POLLS = 5;

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
  for (let i = 0; i < READ_BACK_POLLS; i++) {
    previous = observed;
    observed = await read();
    if (observed !== undefined && ok(observed)) return { observed, steady: false };
    // No text (a non-input withholding it) or no field — stop waiting. An
    // empty input reads "" and keeps every round: its text may be late.
    if (observed === undefined && i >= 1) return { observed, steady: false };
    await sleep(pollMs);
  }
  return { observed, steady: observed !== undefined && observed === previous };
}
