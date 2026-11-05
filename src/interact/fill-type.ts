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
 * landed or not, the last reading, what was typed again, and for a typing that
 * missed what can be said of the difference. Whether a reading landed, what
 * tail it proves dropped and the difference are interact/fill-landing.ts's
 * (`landingOf` for the poll, then `readingOf`, one answer about the reading it
 * ended on) — this module goes by the answer, never judges a reading itself.
 * Every wording is interact/fill-text.ts's.
 *
 * The rules it owns:
 * - the poll: READ_BACK_POLLS (five) reads at `pollMs` until the reading lands, never stopping
 *   early on an unchanged mismatch (`pollValue`).
 * - what is sent again, bounded, in this order:
 *   1. A DROPPED TAIL (2026-10-19, docs/bugs/2026-10-19-ios-fill-loses-the-
 *      tail-of-its-text-in-a-react-native-single-line-field.md, docs/adr/0023-fill-types-a-dropped-tail-again.md):
 *      the field holds a strict prefix of what it should hold — some of the
 *      typed characters landed, the end did not — the reading held still
 *      over the poll's last two reads, the adapter retypes a tail
 *      (`retypesTail`), and the typing provably stayed
 *      in the field (`whereTyped`: every other input the screen showed before
 *      the typing is there with its value — an auto-advancing code box that
 *      moved the focus would get the tail too; a sibling the app recomputed
 *      proves nothing either way, and stops the tail too). Since D28 the
 *      prefix may be REFORMATTED (fill-landing.ts#NotLanded): a field that groups as it is
 *      typed shows `1 234 567,` for a typed `1234567,89` that lost `89` —
 *      exact by typed characters, only grouping added, `reformatOf`'s rules
 *      judged over the whole typing (iOS React Native, rf2, 2026-10-31: the
 *      wipe and retype it got instead dropped the tail again). Since D60 the
 *      prefix may end in a mark an EAGER field added once a group was
 *      complete (`SK31 1200 ` for `SK3112000000`), judged as if the next
 *      typed character followed it (fill-reformat.ts#prefixOf). The tail is
 *      typed at the caret, which the field keeps at the end as it regroups
 *      (React Native's controlled TextInput, ADR 0034; rf3's typing on after
 *      a reformatting fill landed in order on iOS). Only the missing tail is typed, up to
 *      `MAX_TAIL_RETYPES` times, and again only while each retype moved the
 *      field. Which reading proves a dropped tail — a strict prefix with some
 *      of the typing in it, no bullet, the earlier text unchanged — is
 *      fill-landing.ts's (`NotLanded.tail`, `retypable`): only a strict prefix proves which
 *      characters are missing, so a retype can never duplicate one that is
 *      there. Measured on React Native 0.88's
 *      controlled single-line TextInput under `idb ui text`: 6 of 12 fills
 *      kept a prefix (up to 6 of 9 characters lost), the field itself holding
 *      the short value; the measurements that chose this remedy over chunked typing are the ADR's.
 *      A typing that LANDED through a tail typed again is reported
 *      (`FieldIo.reportDroppedTail`; a capped field whose retype moves
 *      nothing, never), so the adapter can type into that app differently
 *      from then on — on iOS the first key alone, a wait of
 *      adapters/ios.ts#FIRST_KEY_ALONE_MS, then the rest (D24, the ADR's
 *      amendment of 2026-10-31); this retype stays the safety net, unchanged.
 *   2. With clear only: one wipe of what the field holds and a retype of the
 *      whole value — the content is ours (since 2026-08-05: Compose async
 *      state swallowing synthetic input). Not when another input provably
 *      took part of the typing (2026-10-19, `elsewhere`): its deletes and its
 *      typing would go there; a sibling the app recomputed does not stop it.
 *   Without clear and without a prefix nothing is sent again: the field came
 *   with content that is not ours to delete.
 */

import { everyNode, INPUT_ROLE, type TypingDelivery, type UiNode } from '../adapters/types.js';
import { sleep } from '../util/sleep.js';
import { heldText, type Difference, type FocusUnread, type OtherInput, type Reformat, type SentAgain } from './fill-facts.js';
import { landingOf, readingOf, withoutWholeToo, type Expectation, type Landing } from './fill-landing.js';

/** The field as the typing sees it: send text, delete characters, read what it shows. */
export interface FieldIo {
  type(text: string): Promise<void>;
  /** Delete `count` characters (DeviceAdapter.clearText). */
  wipe(count: number): Promise<void>;
  /** The field's text on a fresh read — "" for an empty input; undefined when the node withholds text or was not found. */
  read(): Promise<string | undefined>;
  /** The newest tree read — before the typing, the screen it starts on; after it, the read-back's. undefined: none yet. */
  screen(): UiNode | undefined;
  /**
   * The field dropped the tail of a typing and the tail typed again repaired it (DeviceAdapter.noteDroppedTail): said
   * once a fill, when the typing has landed whole through a tail retype — never for a field that keeps its prefix for
   * good (capped, trimming: its fill fails) — so the adapter may type into this app differently from then on (D24 —
   * iOS sends the first key alone). The tail retypes of this fill are typed as before (ADR 0023: a retyped tail lands
   * whole, 45 of 45); the fill's own rules do not change.
   */
  reportDroppedTail(): void;
}

/**
 * What the field should hold and how its reading is judged (fill-landing.ts#Expectation — with clear, a mismatch may
 * be wiped and retyped), and how to type it.
 */
export interface TypingIntent extends Expectation {
  pollMs: number;
  /** The field as the newest read before typing found it — left out of the other inputs the typing must not change. */
  field: UiNode;
  /** When the adapter's typing has reached the field (DeviceAdapter.typingDelivery): whether a tail is typed again (`retypesTail`). */
  delivery: TypingDelivery;
}

/**
 * What typing achieved, as facts:
 * - `landed`: a read showed the value (`observed`, the last reading) — exactly, or `reformatted` (`reformatOf`: the field
 *   added separators of its own as it was typed; absent when the reading is exact); `placeholder` when the reading is
 *   exactly the field's named placeholder (fill-landing.ts#Landing: not verified); `focusUnread` when it holds the value
 *   among text that may not all be the typing (fill-landing.ts#Landing, D64b-3);
 * - `not-taken`: a non-input whose reading never took the text — not the field;
 * - `unread`: no reading to compare (the node withholds its text, or the last read did not find the field);
 * - `missed`: the last reading is not the value after everything was sent again — `differs` what can be said of the
 *   difference (fill-landing.ts#NotLanded); `elsewhere` when another input changed while typing (the focus left the
 *   field — nothing was sent again then), `differs` without its whole-landing hedge then (fill-landing.ts#withoutWholeToo).
 * `again`: what was sent again, in the order sent (fill-facts.ts#SentAgain; empty: nothing).
 */
export type Typed =
  | { kind: 'landed'; observed: string; again: SentAgain[]; reformatted?: Reformat; placeholder?: true; focusUnread?: FocusUnread }
  | { kind: 'not-taken'; observed: string }
  | { kind: 'unread' }
  | { kind: 'missed'; observed: string; again: SentAgain[]; differs: Difference; elsewhere?: OtherInput };

/**
 * Whether a dropped tail is typed again on this adapter (docs/adr/0023-fill-types-a-dropped-tail-again.md): only when
 * its typing has arrived when its call returns (`on-return`: iOS) — on Android a key still arriving would be doubled.
 * Asked here and by fill.ts's post-focus re-read gate, whose proof (`whereTyped`) only a retype needs.
 */
export const retypesTail = (delivery: TypingDelivery): boolean => delivery === 'on-return';

/** How many times a dropped tail is typed again (docs/adr/0023-fill-types-a-dropped-tail-again.md): the second covers a tail the first retype lost a part of. */
export const MAX_TAIL_RETYPES = 2;

/** Type the value and confirm it landed; send again what the rules above allow. */
export async function typeAndConfirm(io: FieldIo, intent: TypingIntent): Promise<Typed> {
  const { value, clear } = intent;
  // Whether a reading landed, and how — the poll's question, of every read; `readingOf` asks it again of the reading a
  // poll ended on without a landing.
  const landing = (observed: string): Landing | undefined => landingOf(observed, intent);

  // What every other input held when typing began: the proof that the typing stayed in the field (`whereTyped`).
  const before = io.screen();
  const others = before === undefined ? undefined : inputsOf(before, inputKey(intent.field));
  await io.type(value);
  let read = await pollValue(io.read, landing, intent.pollMs);
  const again: SentAgain[] = [];
  const tails = () => again.filter((a) => a.kind === 'tail').length;
  for (;;) {
    const { observed } = read;
    // undefined: the node withholds its text, or was not found — nothing to compare.
    if (observed === undefined) return { kind: 'unread' };
    // What the reading is, whole: the poll's landing where it ended on one, else a reading that missed.
    const answer = read.landed ?? readingOf(observed, intent);
    switch (answer.kind) {
      case 'not-taken':
        // A non-input that never took the text is not the field: never wiped (its length is not the field's), never
        // retyped. Asked of the first reading only, as it always was: after a retry the last reading is a mismatch.
        if (again.length === 0) return { kind: 'not-taken', observed };
        break;
      case 'said-plain':
        // Final, but no landing: the field said plain shows bullets of another length (fill-landing.ts#Landing). Before
        // reportDroppedTail: a held count 'unread' means no tail was retyped (fill.ts skips the re-read only where
        // !retypesTail).
        return { kind: 'missed', observed, again, differs: answer.differs };
      case 'landed':
      case 'placeholder':
        // A drop is proven only by its repair: the typing landed whole through a tail typed again. A capped or
        // trimming field (maxLength, an IBAN or phone mask) keeps its strict prefix for good — its retype moves nothing
        // and the fill fails — and is no drop: reported, it would make every later typing into that app pay the split
        // (D24 review).
        if (tails() > 0) io.reportDroppedTail();
        if (answer.kind === 'placeholder') return { kind: 'landed', observed, again, placeholder: true };
        return {
          kind: 'landed',
          observed,
          again,
          ...(answer.reformatted !== undefined && { reformatted: answer.reformatted }),
          ...(answer.focusUnread !== undefined && { focusUnread: answer.focusUnread }),
        };
      case 'missed':
        break;
      default: {
        // A new kind of reading must say here whether it goes on to what is sent again.
        const unhandled: never = answer;
        return unhandled;
      }
    }
    const where = whereTyped(others, io.screen(), answer.tail?.missing);
    const tail =
      retypesTail(intent.delivery) && where.kind === 'field' && read.steady && tails() < MAX_TAIL_RETYPES && answer.tail?.retypable === true
        ? answer.tail.missing
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
      // D64: keys proven typed elsewhere are no select-all, so a whole landing's hedge is not said beside that clause.
      if (where.kind === 'elsewhere') return { kind: 'missed', observed, again, differs: withoutWholeToo(answer.differs), elsewhere: where.input };
      return { kind: 'missed', observed, again, differs: answer.differs };
    }
    const prior = observed;
    read = { ...(await pollValue(io.read, landing, intent.pollMs)), prior };
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

/**
 * A poll's end: the last reading, whether it held still over the last two reads (`steady` — a tail is retyped only
 * then, so a late keystroke still arriving is not sent twice), and — after a retype — the reading the retype was
 * sent on (`prior`), so a retype that moved nothing is not repeated.
 */
interface PollEnd {
  observed: string | undefined;
  steady: boolean;
  prior?: string;
  /** The last reading landed, and how (fill-landing.ts#Landing); absent when it did not. */
  landed?: Landing;
}

/** How many reads `pollValue` takes of the field at most, `pollMs` apart — a round count, not a deadline (ui-tree/read-tree.ts's module doc says why). */
const READ_BACK_POLLS = 5;

/**
 * Poll the field until its exposed value lands (`ok`: how it landed, else undefined); returns the last observation.
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
async function pollValue(read: () => Promise<string | undefined>, ok: (observed: string) => Landing | undefined, pollMs: number): Promise<PollEnd> {
  let observed: string | undefined;
  let previous: string | undefined;
  for (let i = 0; i < READ_BACK_POLLS; i++) {
    previous = observed;
    observed = await read();
    const landed = observed === undefined ? undefined : ok(observed);
    if (landed !== undefined) return { observed, steady: false, landed };
    // No text (a non-input withholding it) or no field — stop waiting. An
    // empty input reads "" and keeps every round: its text may be late.
    if (observed === undefined && i >= 1) return { observed, steady: false };
    await sleep(pollMs);
  }
  return { observed, steady: observed !== undefined && observed === previous };
}
