import { minTapPiece } from '../../src/ui-tree/draw-order.js';
import { frameText, rectText } from '../../src/ui-tree/geometry.js';
import { firedSince, touchesSince, touchPointsText, type LiveVerdict } from './live-visibility.js';
import { allPassed, ASSERTS_FAILED, claimsDone, claimsTap, firstLine, isError, missedTarget, presentedRemedySaid, replyKind, swipesOf, windowHintSaid } from './replies.js';
import { parseInputShown, parseTouchableRegion } from '../../src/adapters/android.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
import { rectIntersection, sameRect } from '../../src/adapters/types.js';
import { TREE_READ_FAILED } from '../../src/interact/scroll-text.js';
import { panelsBeyond } from '../../src/ui-tree/keyboard-cover.js';
import type { SourceKind } from '../differential/corpus.js';
import type { LabState, Rect } from './schema.js';
import { probePoint, within } from './truth.js';

/**
 * The live golden's forms judges that are more than a value held (live.ts runs the cases): pure over the lab app's
 * form model, so they are pinned without a device (tests/truth/live-forms.test.ts). `holds` is every fill case's;
 * the two below it are lab note F2A1's form-keyboard cases, whose submit bar riding on the IME has no node — the app's
 * frames (`submit.bar`) say what of a field it covers, which the tree cannot; `judgeUnderSheet` is the taps beneath
 * form-picker's sheet, `judgeMissUnderSheet` the asserts and the flow's `wait:` there.
 */

/** The tree sources the live cases run under: iOS's (idb, wda), Android's one. */
export type Source = IosTreeSourceKind | Extract<SourceKind, 'uiautomator'>;

export const valueOf = (s: LabState, tag: string) => s.fields?.[tag]?.value;
export const short = (reply: string | undefined) => (reply === undefined ? '(no reply)' : reply.split('\n')[0].slice(0, 220));

/**
 * The model must hold `want` in `tag`; the last reply's claim is held to it (LOUD / MISMATCH as above). Not ok, the
 * verdict names its rule (`cls`, live-visibility.ts#VerdictClass): `failed-holds` where the app holds `want` but averi
 * failed; `fill-claim` where averi claims done and the app holds another value; else LOUD, `loud-untouched` with the
 * field as the launch left it, `loud-changed` with it changed (a part typed, a part cleared). Every verdict carries the
 * kind of the last reply (replies.ts#replyKind): live-known.ts pins a case's `cls` and `kind`.
 */
export const holds =
  (tag: string, want: string) =>
  (s: LabState, replies: string[], _source: Source, launched: LabState): LiveVerdict => {
    const got = valueOf(s, tag);
    // The launch is the baseline: a field it did not lay out (undefined) is untouched only while it stays so.
    const before = valueOf(launched, tag);
    const untouched = got === before;
    const left = before === undefined ? '' : untouched ? ' — field untouched' : ` — field CHANGED (was ${JSON.stringify(before)})`;
    const last = replies[replies.length - 1];
    const kind = replyKind(last);
    if (got === want) {
      return isError(last) ? { outcome: 'MISMATCH', cls: 'failed-holds', kind, why: `the app holds ${JSON.stringify(got)}, but averi failed: ${short(last)}` } : { outcome: 'ok', kind, why: short(last) };
    }
    return claimsDone(last)
      ? { outcome: 'MISMATCH', cls: 'fill-claim', kind, why: `averi says ${short(last)} — the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}` }
      : { outcome: 'LOUD', cls: untouched ? 'loud-untouched' : 'loud-changed', kind, why: `the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}${left}; averi: ${short(last)}` };
  };

/**
 * p7 (D43a, docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md): a no-clear fill of a
 * character neither platform's typing can type (`Š`) into a field the launch prefilled. averi must refuse it before
 * anything is sent — its words, "Refused before anything was sent" — and the prefill must stay as the launch left it:
 * ok only so. The field changed is LOUD `loud-changed` (a tap, a clear or a part typed reached it); kept, but the
 * refusal not said so — another error, or none — is LOUD `loud-untouched`; a claim of done is a MISMATCH `fill-claim`.
 * Since D43 (ADR 0037's D43 amendment) iOS under WDA types `Š` through `/wda/keys`: p7 runs under idb and uiautomator
 * only, and p7w, the same fill under WDA, is judged by `holds` (live-cases.ts).
 */
export const refusedKept =
  (tag: string) =>
  (s: LabState, replies: string[], _source: Source, launched: LabState): LiveVerdict => {
    const got = valueOf(s, tag);
    const before = valueOf(launched, tag);
    const last = replies[replies.length - 1];
    const kind = replyKind(last);
    if (claimsDone(last)) return { outcome: 'MISMATCH', cls: 'fill-claim', kind, why: `averi says ${short(last)} — it cannot type the value; the app holds ${JSON.stringify(got)}` };
    if (got !== before) return { outcome: 'LOUD', cls: 'loud-changed', kind, why: `the app holds ${JSON.stringify(got)} — field CHANGED (was ${JSON.stringify(before)}); averi: ${short(last)}` };
    if (!isError(last) || !last.includes('Refused before anything was sent')) return { outcome: 'LOUD', cls: 'loud-untouched', kind, why: `the prefill kept, but not refused before anything was sent: ${short(last)}` };
    return { outcome: 'ok', kind, why: `refused before anything was sent, the prefill kept: ${short(last)}` };
  };

/**
 * The ladder `refusedHolding` and `refusedOnFocus` share, once their premises hold: a claim of done is a MISMATCH
 * `fill-claim`; the field other than `kept` is LOUD `loud-changed`; then `firstFailed`'s verdict, when it gives one
 * (refusedHolding's first fill failed over `kept`); kept, but no error saying `phrase` (when given), LOUD
 * `loud-untouched`; else ok.
 */
const refusedLadder = (got: string | undefined, kept: string, last: string, phrase: string | undefined, firstFailed?: () => LiveVerdict | undefined): LiveVerdict => {
  const kind = replyKind(last);
  const refused = phrase === undefined ? 'refused' : `refused as "${phrase}"`;
  if (claimsDone(last)) return { outcome: 'MISMATCH', cls: 'fill-claim', kind, why: `averi says ${short(last)} — the field refused the typing; the app holds ${JSON.stringify(got)}` };
  if (got !== kept) return { outcome: 'LOUD', cls: 'loud-changed', kind, why: `the app holds ${JSON.stringify(got)}, not ${JSON.stringify(kept)}; averi: ${short(last)}` };
  const failed = firstFailed?.();
  if (failed !== undefined) return failed;
  if (!isError(last) || (phrase !== undefined && !last.includes(phrase))) return { outcome: 'LOUD', cls: 'loud-untouched', kind, why: `the field kept ${JSON.stringify(kept)}, but not ${refused}: ${short(last)}` };
  return { outcome: 'ok', kind, why: `${refused}, the field kept ${JSON.stringify(kept)}: ${short(last)}` };
};

/**
 * A second fill without clear that the field refuses, though its text already holds the value — so `holds` cannot catch
 * a false Filled: the app does hold `kept`. Ok only when the app holds `kept`, the first fill did not fail, and the last
 * reply is an error (saying `phrase`, when given). A claim of done is a MISMATCH `fill-claim`; the field other than
 * `kept` is LOUD `loud-changed`; the first fill failed over `kept` is a MISMATCH `failed-holds` (its kind); kept, but
 * no error saying `phrase` and no claim either, is LOUD `loud-untouched` (refusedLadder). f15's and f16's judge
 * (below).
 */
export const refusedHolding =
  (tag: string, kept: string, phrase?: string) =>
  (s: LabState, replies: string[], _source: Source, _launched: LabState): LiveVerdict => {
    const [first] = replies;
    return refusedLadder(valueOf(s, tag), kept, replies[replies.length - 1], phrase, () =>
      isError(first) ? { outcome: 'MISMATCH', cls: 'failed-holds', kind: replyKind(first), why: `the app holds ${JSON.stringify(kept)}, but averi failed the first fill: ${short(first)}` } : undefined,
    );
  };

/**
 * f15 (D63): a field that refuses the keys while its text already holds the value — form-format's `date` at its 8-digit
 * cap, `31.12.2026` after a first fill, typed `2026` without clear. Before D63 averi passed that unchanged reading by
 * containment. The error must say the field did not change (`refusedHolding`).
 */
export const refusedUnchanged = (tag: string, kept: string) => refusedHolding(tag, kept, 'did not change');

/**
 * f16 (D64): a field at its length cap that keeps only the head of the typing while its earlier text holds the value —
 * form-format's `date` holding `31.12.202` after a first fill, typed `12` without clear, keeps the `1`: `31.12.2021`.
 * Before D64 averi passed that reading by containment (the `12` inside `31.12`). The error's wording is not judged: a
 * tail typed again on iOS and the poll on Android word it alike, by length (`refusedHolding`).
 */
export const refusedCapped = (tag: string, kept: string) => refusedHolding(tag, kept);

/**
 * refusedOnFocus's lab fault, worded by what the field holds: missing from the state or empty, it did not insert its
 * prefix; the prefix and more, it took the keys; anything else, neither (D64b-1's reviews).
 */
const labFaultWhy = (got: string | undefined, inserted: string): string =>
  got === undefined ? "lab fault: the field did not insert its prefix (is missing from the app's state)"
  : got === '' ? 'lab fault: the field did not insert its prefix (holds "")'
  : got.startsWith(inserted) ? `lab fault: the field took the keys (holds ${JSON.stringify(got)})`
  : `lab fault: the field holds ${JSON.stringify(got)}, neither the prefix nor the prefix and keys`;

/**
 * fp2 (D64b): one fill without clear into a field that puts `inserted` in itself on focus and refuses every key —
 * form-focus-prefix's dialRefuses, `+421 ` held whatever `421` is typed. The one-call sibling of `refusedHolding`, its
 * premise its own, checked first: the field missing or empty means the prefix was never inserted — the lab's fault, a
 * SKIP whatever averi replied, where the app logged a `focus` event for the field; with none, averi's tap never focused
 * it — LOUD `loud-untouched`, said so (D64b-1's final review); a claim of done over anything but `inserted` means the
 * field took the keys it must refuse — a SKIP too (labFaultWhy), averi's Filled maybe true. No KNOWN entry matches a
 * SKIP. Then refusedLadder with "did not change": ok only on an error saying so with `inserted` held (what the
 * post-focus re-read lets averi say: it read `inserted` before typing); a claim of done over `inserted` is a MISMATCH
 * `fill-claim` — Android's today, where that re-read is skipped and the reading passes by containment (ADR 0028
 * residual 3).
 */
export const refusedOnFocus =
  (tag: string, inserted: string) =>
  (s: LabState, replies: string[], _source: Source, _launched: LabState): LiveVerdict => {
    const got = valueOf(s, tag);
    const last = replies[replies.length - 1];
    if (got === undefined || got === '') {
      // No prefix: the lab's fault only where the tap focused the field (the app logs a `focus` event per field); else
      // averi's tap never reached it.
      if (s.events.some((e) => e.kind === 'focus' && e.tag === tag)) return { outcome: 'SKIP', why: labFaultWhy(got, inserted) };
      const held = got === undefined ? "is missing from the app's state" : 'holds ""';
      return { outcome: 'LOUD', cls: 'loud-untouched', kind: replyKind(last), why: `the tap never focused the field (no focus event for ${tag}), which ${held}; averi: ${short(last)}` };
    }
    if (claimsDone(last) && got !== inserted) return { outcome: 'SKIP', why: labFaultWhy(got, inserted) };
    return refusedLadder(got, inserted, last, 'did not change');
  };

/**
 * D18 review round 1 (MINOR-4): the model holds `want` after the fill (holds, over the fill's reply), AND the tree shows
 * the same text (the `shows` assert after it) — a format applied to the model alone, or to the screen alone (SwiftUI's
 * binding setter may leave the TextField showing what was typed), is a MISMATCH here even when the fill passed:
 * `failed-holds` on the assert's kind (the model holds it, averi's read of the screen failed).
 */
export const holdsShown =
  (tag: string, want: string) =>
  (s: LabState, replies: string[], source: Source, launched: LabState): LiveVerdict => {
    const v = holds(tag, want)(s, replies.slice(0, 1), source, launched);
    if (v.outcome !== 'ok') return v;
    const shown = replies[1];
    return allPassed(shown)
      ? { outcome: 'ok', kind: replyKind(shown), why: `${v.why}; the tree shows the model's text` }
      : { outcome: 'MISMATCH', cls: 'failed-holds', kind: replyKind(shown), why: `the model holds ${JSON.stringify(want)}, the tree does not show it: ${short(shown)}` };
  };

/** How many px of `field`'s height the bar (`submit.bar`, the surface with no node) lies over. */
export const underBar = (field: Rect | undefined | null, bar: Rect | undefined | null): number =>
  field == null || bar == null ? 0 : Math.max(0, Math.min(field.y + field.height, bar.y + bar.height) - Math.max(field.y, bar.y));


/**
 * k3: fill note under the keyboard (Android: no dismissal configured — `back` hides it). idb cannot hide the keyboard:
 * a refusal with the field untouched is the documented answer there. Android: once back hid the IME, note lies under
 * the bar dropped to the bottom, its dump a 14-px strip cut by Continue (F2A1). A fill is REFUSED BY DESIGN there, as
 * the tap (the owner's decision of 2026-10-18, ADR 0013): ok when refused naming the remedy (scroll it out from under
 * the bar, or dismiss the keyboard first), note really a strip — what of it the bar leaves showing under the tap
 * minimum, by the app's frames at the refusal — every field as the launch left it, nothing submitted.
 */
export function judgeNoteFill(s: LabState, replies: string[], source: Source, launched: LabState): LiveVerdict {
  const v = holds('note', 'Thanks - ok')(s, replies, source, launched);
  if (source === 'idb' && v.outcome === 'LOUD' && valueOf(s, 'note') === '') return { outcome: 'ok', why: `refused (idb): ${short(replies[0])}` };
  if (source !== 'uiautomator' || v.outcome !== 'LOUD') return v;
  const note = s.frames.note;
  const shows = note == null ? undefined : note.height - underBar(note, s.frames['submit.bar']);
  const strip = shows !== undefined && shows < minTapPiece(s.screen);
  const untouched = Object.entries(s.fields ?? {}).every(([k, f]) => f.value === launched.fields?.[k]?.value);
  const submits = (s.submits ?? []).length;
  if (strip && untouched && submits === 0 && /scroll_until it out from under|dismiss it first/.test(replies[0])) {
    return { outcome: 'ok', why: `refused by design (F2A1: note shows ${shows} px past the bar, under the ${minTapPiece(s.screen)} a tap needs), every field untouched, no submit: ${short(replies[0])}` };
  }
  const why = !strip ? `note shows ${shows ?? '?'} px past the bar — no strip` : !untouched ? 'a field CHANGED' : submits > 0 ? `the form was SUBMITTED (${submits}×)` : 'no remedy named';
  return { ...v, why: `${v.why} (not the refusal by design: ${why})` };
}

/**
 * k7: scroll_until phone, under the bar riding on the IME. Where the app lays phone out when scroll_until returns: its
 * centre under the bar (the surface with no node) or the IME is no stop; clear of both, a stop is right — and where the
 * bar's top padding still covers part of it, by the app's frames, the reply must say so: "PARTLY UNDER a surface the
 * tree does not list" (src/ui-tree/eyes.ts's band, read from one screenshot: round 7's A6, ADR 0013 refined). A stop
 * that leaves the band unsaid — "fully visible", or a plain "visible" — is a MISMATCH: the tree has no node for the
 * padding, so the claim overstates by what it covers (ADR 0013's residual until the eyes, no allowance since).
 */
/** The eyes' band over a stop's target, in the reply's words (src/ui-tree/eyes.ts): "PARTLY UNDER a surface …". */
const BAND_SAID = /\bPARTLY UNDER a surface\b/;

export function judgePhoneScroll(s: LabState, [reply]: string[], _source: string, launched: LabState): LiveVerdict {
  const submits = (s.submits ?? []).length;
  const touches = touchesSince(s, launched);
  const strokes = `${touches.length} stroke(s) the app logged${touches.length === 0 ? '' : ` at ${touchPointsText(touches)}`}`;
  if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×); ${strokes}; averi: ${short(reply)}` };
  const phone = s.frames.phone;
  const bar = s.frames['submit.bar'];
  const ime = s.keyboard?.visible === true ? s.keyboard.frame : undefined;
  const cy = phone === undefined ? undefined : phone.y + phone.height / 2;
  const under = (r: { y: number; height: number } | undefined | null) => r != null && cy !== undefined && cy >= r.y && cy < r.y + r.height;
  const covered = underBar(phone, bar);
  const where = phone == null ? 'phone not laid out' : `phone ${phone.y}–${phone.y + phone.height} (launched ${launched.frames.phone?.y ?? '?'}), ${covered} px of it under the bar`;
  if (replyKind(reply) === 'visible') {
    if (under(bar) || under(ime) || phone == null) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — phone's centre lies under the ${under(bar) ? 'bar' : 'IME'}; ${where}; ${strokes}` };
    if (covered > 0 && !BAND_SAID.test(reply)) return { outcome: 'MISMATCH', why: `averi says ${short(reply)} — ${covered} px of phone under the bar, unsaid (no PARTLY UNDER a surface); ${where}; ${strokes}` };
    return { outcome: 'ok', why: `stopped with phone's centre clear of the bar and the IME (${where}); ${strokes}: ${short(reply)}` };
  }
  return { outcome: 'ok', why: `no stop, nothing submitted (${where}); ${strokes}: ${short(reply)}` };
}

/**
 * k7f: once `back` has hidden the IME of k7's launch, scroll_until phone with `fully: true`. Compose dumps phone's
 * 48-dp touch target, which the next field's title `vs.title` overlaps by 6 px though what phone draws ends 11 px above
 * it; the eyes judge that overlap on one screenshot (ADR 0026). Judged on the app's model: where phone is drawn whole on
 * the screen, clear of the bar dropped to the bottom and of `vs.title`, the right answer is "fully visible" — a failure
 * there is the false refusal of the note; a "fully visible" while any of phone is off the screen, under the bar, or
 * under the title is a MISMATCH. No submit, ever.
 * docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md
 */
export function judgePhoneAfterBack(s: LabState, replies: string[], _source: string, launched: LabState): LiveVerdict {
  const reply = replies.at(-1) ?? '';
  const submits = (s.submits ?? []).length;
  if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×); averi: ${short(reply)}` };
  if (s.keyboard?.visible === true) return { outcome: 'LOUD', why: `back did not hide the IME: ${short(replies[0])}` };
  const phone = s.frames.phone;
  const title = s.frames['vs.title'];
  if (phone == null) return { outcome: 'LOUD', why: `phone not laid out: ${short(reply)}` };
  const onScreen = phone.y >= 0 && phone.y + phone.height <= s.screen.height;
  const barOver = underBar(phone, s.frames['submit.bar']);
  const titleClear = title == null || title.y >= phone.y + phone.height || title.y + title.height <= phone.y;
  const whole = onScreen && barOver === 0 && titleClear;
  const touches = touchesSince(s, launched);
  const where = `phone ${phone.y}–${phone.y + phone.height}${title == null ? '' : `, vs.title from ${title.y}`}, ${barOver} px under the bar; ${touches.length} stroke(s)`;
  if (replyKind(reply) === 'visible') {
    return whole ? { outcome: 'ok', why: `${where}: ${short(reply)}` } : { outcome: 'MISMATCH', why: `averi says ${short(reply)} — phone is not drawn whole (${where})` };
  }
  return whole ? { outcome: 'MISMATCH', why: `refused, though phone is drawn whole (${where}): ${short(reply)}` } : { outcome: 'ok', why: `no stop, phone not drawn whole (${where}): ${short(reply)}` };
}

/**
 * What a reply beneath form-picker's sheet must say, once, per tree source — as much as the source can know: WDA marks
 * the sheet, so the presented remedy ("close it first"); uiautomator's dump marks no presented window here (no scrim:
 * ADR 0018's residual 18, accepted with the active-window hint), so the hint (src/ui-tree/miss.ts#ACTIVE_WINDOW_HINT);
 * idb lists the presented sheet alone and carries no mark (ADR 0018, "iOS unchanged"; measured live 2026-10-19,
 * docs/truth/live-ios-2026-10-19-lab-fixes.md), so the target not in its tree is all it can say. `said` names which,
 * undefined when the reply says none of them; `times` how often it says "close it first" (once is the rule).
 */
function remedyUnderSheet(reply: string, source: string): { said?: string; times: number } {
  const times = reply.split('close it first').length - 1;
  const said =
    presentedRemedySaid(reply) ? 'the presented remedy, once'
    : windowHintSaid(reply) ? 'the active-window hint, once'
    : source === 'idb' && replyKind(reply) === 'not found' ? "not in idb's tree (it lists the presented sheet alone)"
    : undefined;
  return { said, times };
}

/** What the app logged beneath the sheet since the launch: an event (a row selected, the sheet dismissed, a submit) or a field focused. */
function loggedSince(s: LabState, launched: LabState): string[] {
  const focused = s.focus != null && s.focus !== launched.focus ? s.focus : undefined;
  return [...firedSince(s, launched).map((e) => `${e.kind} ${e.tag}`), ...(focused === undefined ? [] : [`focus ${focused}`])];
}

/**
 * c2–c4: a tap on form-picker's name, country or submit beneath the picker sheet, open at launch and fully expanded.
 * Nothing may fire — no row selected, no submit, the sheet not dismissed, no field focused — and no `Tapped`; the reply
 * says the sheet's remedy once (`remedyUnderSheet`). Anything else, or "close it first" said twice, is LOUD.
 */
export const judgeUnderSheet =
  (tag: string) =>
  (s: LabState, [reply]: string[], source: string, launched: LabState): LiveVerdict => {
    const kind = replyKind(reply);
    const logged = loggedSince(s, launched);
    if (claimsTap(reply)) return { outcome: 'MISMATCH', kind, why: `averi says ${short(reply)} — ${tag} lies beneath the picker sheet; the app logged ${logged.join(', ') || 'nothing'}` };
    if (logged.length > 0) return { outcome: 'MISMATCH', kind, why: `refused, but the app logged ${logged.join(', ')} — averi: ${short(reply)}` };
    const { said, times } = remedyUnderSheet(reply, source);
    if (times > 1) return { outcome: 'LOUD', kind, why: `not tapped, nothing fired, but "close it first" said ${times} times: ${short(reply)}` };
    if (said === undefined) return { outcome: 'LOUD', kind, why: `not tapped, nothing fired, but no "close it first": ${short(reply)}` };
    return { outcome: 'ok', kind, why: `not tapped, nothing fired; ${said}: ${short(reply)}` };
  };

/**
 * c5–c7: an element assert, a colour assert and a flow's `wait:` on name beneath form-picker's sheet, open at launch
 * and fully expanded (the not-founds round 7's A3 asked by a scratch driver:
 * docs/truth/live-android-2026-10-19-hint-everywhere.md). name lies beneath the sheet, so the call must fail on not
 * finding it (replies.ts#missedTarget: the assert's `not found within …`, the flow's `Timed out … waiting for element`),
 * nothing may fire, and the not-found says the sheet's remedy exactly once (`remedyUnderSheet`): none, or "close it
 * first" twice, is LOUD. A MISMATCH otherwise: a pass or a flow done; an assert that FAILED on an element it found (the
 * colour wrong) — averi resolved an element beneath the sheet; and an ERROR that is no wait for the target (a flow the
 * config lacks, a bad argument) — a harness fault, named so, never an honest LOUD. The why quotes an assert's verdict
 * line, not its summary.
 */
export const judgeMissUnderSheet =
  (tag: string) =>
  (s: LabState, [reply]: string[], source: string, launched: LabState): LiveVerdict => {
    const kind = replyKind(reply);
    const logged = loggedSince(s, launched);
    if (!ASSERTS_FAILED.test(reply) && !isError(reply)) return { outcome: 'MISMATCH', kind, why: `averi says ${firstLine(reply)} — ${tag} lies beneath the picker sheet; the app logged ${logged.join(', ') || 'nothing'}` };
    if (logged.length > 0) return { outcome: 'MISMATCH', kind, why: `failed, but the app logged ${logged.join(', ')} — averi: ${firstLine(reply)}` };
    if (!missedTarget(reply)) {
      return ASSERTS_FAILED.test(reply)
        ? { outcome: 'MISMATCH', kind, why: `averi found ${tag} beneath the picker sheet and failed it on what it read there: ${firstLine(reply)}` }
        : { outcome: 'MISMATCH', kind, why: `a harness fault, not a verdict on ${tag}: ${firstLine(reply)}` };
    }
    const { said, times } = remedyUnderSheet(reply, source);
    if (times > 1) return { outcome: 'LOUD', kind, why: `failed, nothing fired, but "close it first" said ${times} times: ${firstLine(reply)}` };
    if (said === undefined) return { outcome: 'LOUD', kind, why: `failed, nothing fired, but no "close it first": ${firstLine(reply)}` };
    return { outcome: 'ok', kind, why: `failed, nothing fired; ${said}: ${firstLine(reply)}` };
  };

/**
 * The kf cases' precondition: the IME is FLOATING at launch — the app hears of only its strip (the inset the panel's
 * window gives, 132 px on the lab AVD), not a docked keyboard's 822 px. No adb setting floats Gboard, so a run whose
 * Gboard came up docked is not run, never ok. WEAK on its own: the app's state cannot tell a floating panel from an
 * IME collapsed to its strip with no panel (a hardware-keyboard toolbar), where kf1 and kf2 would pass with no gap
 * rule at all. So the panel is measured at launch (`measuredPanel`), and each case evidences it in a reply of its own.
 */
export function floatingAtLaunch(launched: LabState): LiveVerdict | undefined {
  const ime = launched.keyboard;
  if (ime?.visible !== true) return { outcome: 'SKIP', why: 'no IME at launch' };
  return ime.frame.height > 200 ? { outcome: 'SKIP', why: `keyboard docked (the app hears an IME ${ime.frame.height} px tall, not the floating strip)` } : undefined;
}

/**
 * The floating panel, as the IME window's touchable region named it right after the launch (LabState.imeTouchable,
 * live.ts's first device read for the kf cases — averi's own query, src/adapters/android.ts#TOUCHABLE_COMMAND), read by
 * averi's own readers (src/adapters/android.ts#parseInputShown, #parseTouchableRegion) and admitted by averi's own
 * rules (src/ui-tree/keyboard-cover.ts#panelsBeyond, beside `strip`, the inset the app hears of) — no second parser,
 * no rule of the harness's. The panel lies wherever the hand dragged it: no list of placements. Anything but one
 * admitted panel is "no measured panel", saying why: no read (a record before D67), a failed read, the input method
 * not saying shown, a region that does not read, one that does not hold the strip, rects off the screen, no rect
 * beyond the strip, or several panels. The read after the calls (D69, on the final state) is admitted by it too.
 */
export function measuredPanel(launched: LabState, strip: Rect): { panel: Rect } | { why: string } {
  const dump = launched.imeTouchable;
  const none = (why: string) => ({ why: `no measured panel (${why})` });
  if (dump === undefined) return none('no IME region read at launch');
  if (typeof dump !== 'string') return none('the IME region read failed');
  const region = parseTouchableRegion(dump);
  const { panels, refused } = panelsBeyond(strip, { witness: parseInputShown(dump), region });
  if (panels.length === 1) return { panel: panels[0] };
  if (panels.length > 1) return none(`${panels.length} panels beyond the strip: ${panels.map(rectText).join(', ')}`);
  switch (refused?.kind) {
    case 'unreadable':
      return none('the IME region unreadable');
    case 'witness-not-shown':
      return none('the input method did not say shown');
    case 'no-band-rect':
      return none(`the region does not hold the strip ${rectText(strip)}`);
    case 'rects-dropped':
      return none(`${refused.dropped} rect(s) of the region off the screen or of no area`);
    case undefined:
      return none(region === undefined ? 'the input method did not say shown' : `the region holds no rect beyond the strip ${rectText(strip)}`);
  }
}

/** The panel measured at launch and the strip beside it (the inset the app hears of). */
interface Measured {
  panel: Rect;
  strip: Rect;
}

/** The measured panel and the strip beside it, or the SKIP that says why there is none: both kf branches' first read. */
function panelAtLaunch(launched: LabState): Measured | { skip: LiveVerdict } {
  const strip = launched.keyboard?.frame;
  if (strip === undefined) return { skip: { outcome: 'SKIP', why: 'no IME at launch' } };
  const measured = measuredPanel(launched, strip);
  return 'why' in measured ? { skip: { outcome: 'SKIP', why: measured.why } } : { panel: measured.panel, strip };
}

/**
 * D69: the panel read again once the calls are done (`s.imeTouchable`, live.ts's second lab-device.ts#withMeasuredPanel)
 * against the one the launch measured — admitted by the same `measuredPanel`, beside the launch's strip. No second read
 * (a record before D69): `unread`, the judge as it was. The same panel: `agreed`, so a reply quoting another panel (or
 * none) is averi's reading wrong — a MISMATCH, not "not run". Another panel, or none: the SKIP naming both reads, since
 * a moved panel voids the premise and the evidence alike.
 */
export function panelAfterCalls(s: LabState, { panel, strip }: Measured): AfterCalls | { skip: LiveVerdict } {
  if (s.imeTouchable === undefined) return 'unread';
  const after = measuredPanel(s, strip);
  if ('why' in after) return { skip: { outcome: 'SKIP', why: `the panel not measured again after the calls (launch ${rectText(panel)}, after: ${after.why})` } };
  if (sameRect(after.panel, panel)) return 'agreed';
  return { skip: { outcome: 'SKIP', why: `the panel moved (launch ${rectText(panel)}, after ${rectText(after.panel)})` } };
}

/** What the read after the calls says of the launch's panel when it does not void the case: none taken, or the same. */
type AfterCalls = 'unread' | 'agreed';

/** Each distinct quote in the reply matching `pattern` (every panel averi named, a `g` regex), or "no panel". */
const quoted = (reply: string, pattern: RegExp): string => [...new Set([...reply.matchAll(pattern)].map((m) => m[0]))].join(', ') || 'no panel';
/** The MISMATCH's measured side: the one panel both reads admitted. */
const MEASURED_TWICE = 'the panel measured at launch and again after the calls is';
/** The pixel poll's panel quote, `keyboard x,y wxh` (src/verify/pixel-poll.ts#keyboardCovers: `keyboard ${rectText(keyboard)}`). */
const KEYBOARD_QUOTE = /keyboard \d+,\d+ \d+x\d+/g;
/** scroll_until's panel quote, `over [l,t][r,b]` (src/interact/scroll-text.ts: `the soft keyboard over ${frameText(…)}`). */
const OVER_QUOTE = /over \[\d+,\d+\]\[\d+,\d+\]/g;
/**
 * kf3's refusal as averi words it (src/interact/scroll-text.ts: `scroll_until <target> failed …` / `stopped …`, the
 * tool's ERROR prefix before it), not the device failing its tree read (TREE_READ_FAILED) and not another tool error.
 */
const scrollVerdict = (reply: string): boolean => /^ERROR scroll_until [^\s:]/.test(reply) && !reply.includes(TREE_READ_FAILED);
/** An averi call that errored (or none recorded), not a reading of the panel: a harness fault, named so (as judgeMissUnderSheet names one). */
const harnessFault = (said: string): LiveVerdict => ({ outcome: 'MISMATCH', why: `a harness fault, not a verdict on the panel over ks: ${said}` });

/**
 * A reply that does not quote the measured panel, past the reads' own checks (panelAfterCalls): with no second read
 * (a record before D69), the one-read SKIP (`oneRead`); with both reads agreeing, a reply that is no reading of the
 * panel (`reads` false: an errored call) a harness fault, else averi's misreading — the MISMATCH naming what it quoted
 * (`verb`, `pattern`, `where`) and what both reads measured (`measured`). kf1/kf2's evidence and kf3's refusal alike.
 */
function misquoted(afterCalls: AfterCalls, reply: string, reads: boolean, q: { oneRead: string; verb: 'quoted' | 'named'; pattern: RegExp; where: string; measured: string }): LiveVerdict {
  if (afterCalls === 'unread') return { outcome: 'SKIP', why: `${q.oneRead}: ${short(reply)}` };
  if (!reads) return harnessFault(short(reply));
  return { outcome: 'MISMATCH', why: `averi ${q.verb} ${quoted(reply, q.pattern)}${q.where} — ${MEASURED_TWICE} ${q.measured}: ${short(reply)}` };
}

const NOT_THE_PREMISE = "not the case's premise (the submit wholly between the panel and the strip)";

/**
 * kf1/kf2's premise, at launch: the submit lies wholly in the gap — its top at or below the measured panel's bottom,
 * its bottom at or above the strip's top. Else why not, naming what covers it and by how many px (the rows they share):
 * batch-11's panel at 87,1243 937x792 covered the submit 55,1928 970x132 by 107 px, and averi's refusal there is ADR
 * 0027's fail-closed case, not a MISMATCH.
 */
export function gapPremise(submit: Rect | undefined, panel: Rect, strip: Rect): { holds: true } | { why: string } {
  if (submit === undefined) return { why: 'the submit not laid out at launch' };
  if (submit.y >= panel.y + panel.height && submit.y + submit.height <= strip.y) return { holds: true };
  const underPanel = rectIntersection(submit, panel);
  if (underPanel !== undefined) return { why: `the measured panel ${rectText(panel)} covers the submit ${rectText(submit)} by ${underPanel.height} px — ${NOT_THE_PREMISE}` };
  const underStrip = rectIntersection(submit, strip);
  if (underStrip !== undefined) return { why: `the strip ${rectText(strip)} covers the submit ${rectText(submit)} by ${underStrip.height} px — ${NOT_THE_PREMISE}` };
  return { why: `the submit ${rectText(submit)} is not wholly between the measured panel ${rectText(panel)} and the strip ${rectText(strip)} — not the case's premise` };
}

/** Whether a frame's centre, as a probe taps it, lies in the measured panel. */
const inPanel = (r: Rect | undefined | null, panel: Rect): boolean => r != null && within(probePoint(r), panel);

/** The kf1/kf2 evidence call, sent first (a submit lays the form out again): a colour assert on ks, which the pixel poll refuses naming the panel over it (`keyboard x,y wxh`) — no touch, no key, the IME left up. */
export const FLOATING_PANEL_EVIDENCE = { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-keyboard-floating.ks' }, color: { expected: '#FFFFFF' }, timeout: 5_000 }] } } as const;

/**
 * kf1–kf3, form-keyboard-floating under a floating Gboard, judged against the panel measured at launch
 * (`measuredPanel`; none: SKIP "no measured panel") and measured again after the calls (`panelAfterCalls`: moved or
 * gone, SKIP naming both reads; no second read, a record before D69, judged on the launch's alone): the pinned submit
 * lies wholly in the strip between the panel and the strip the app hears of, drawn and tappable (ADR 0027).
 * - `kf1` scroll_until submit: a visible claim with no stroke (0 swipes, no touch the app logged); a refusal is the
 *   false refusal of the note, a stroke one the bar never needed.
 * - `kf2` scroll_until submit, then tap it: one submit, the IME still up (no `back` sent for it), the tap the one
 *   touch the app logged.
 * - kf1 and kf2 are SKIP unless the submit lies wholly in the gap at launch (`gapPremise`, naming the cover), and
 *   start with `FLOATING_PANEL_EVIDENCE`: its reply must quote the measured panel over ks — else MISMATCH where the
 *   two reads agree (averi's reading wrong), SKIP where there is no second read.
 * - `kf3` scroll_until ks: SKIP unless ks's centre lies in the measured panel at launch; never a visible claim while it
 *   lies there; postcode, focused under it, as the launch left it (no key typed); its refusal names the measured panel
 *   (`over [l,t][r,b]`) — else MISMATCH where the two reads agree, SKIP where there is no second read.
 * docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md
 */
export const judgeFloatingGap =
  (kind: 'kf1' | 'kf2' | 'kf3') =>
  (s: LabState, replies: string[], _source: string, launched: LabState): LiveVerdict => {
    const docked = floatingAtLaunch(launched);
    if (docked !== undefined) return docked;
    // A record short of the case's replies (live-cases.ts: kf1 two calls, kf2 three, kf3 one) holds no verdict on averi:
    // asked once the reads are judged, right before a reply is.
    const calls = { kf1: 2, kf2: 3, kf3: 1 }[kind];
    const holds = `the record holds ${replies.length} of the case's ${calls} replies`;
    const missing: LiveVerdict | undefined = replies.length >= calls ? undefined : s.imeTouchable === undefined ? { outcome: 'SKIP', why: holds } : harnessFault(holds);
    const submits = (s.submits ?? []).length;
    const touches = touchesSince(s, launched);
    const logged = `${touches.length} touch(es) the app logged${touches.length === 0 ? '' : ` at ${touchPointsText(touches)}`}`;
    if (kind === 'kf3') {
      const [scroll] = replies;
      if (valueOf(s, 'postcode') !== valueOf(launched, 'postcode')) return { outcome: 'MISMATCH', why: `postcode CHANGED to ${JSON.stringify(valueOf(s, 'postcode'))} — a key was typed; averi: ${short(scroll)}` };
      if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×); averi: ${short(scroll)}` };
      const measured = panelAtLaunch(launched);
      if ('skip' in measured) return measured.skip;
      const { panel } = measured;
      const afterCalls = panelAfterCalls(s, measured);
      if (typeof afterCalls === 'object') return afterCalls.skip;
      // Not run unless ks starts under the measured panel: elsewhere a visible claim is no evidence either way.
      if (!inPanel(launched.frames.ks, panel)) return { outcome: 'SKIP', why: `ks's centre at launch lies outside the measured panel ${rectText(panel)}` };
      if (missing !== undefined) return missing;
      const ks = s.frames.ks;
      const where = ks == null ? 'ks not laid out' : `ks ${ks.y}–${ks.y + ks.height}`;
      if (replyKind(scroll) === 'visible' && (ks == null || inPanel(ks, panel))) return { outcome: 'MISMATCH', why: `averi says ${short(scroll)} — ks's centre lies in the measured panel (${where}); ${logged}` };
      // An ok refusal names the panel (not the 132-px strip alone): averi read the panel the launch measured.
      const panelAsNamed = `over ${frameText(panel)}`;
      if (!scroll.includes(panelAsNamed)) {
        // Only averi's own scroll_until verdict read the panel: a failed tree read, or another error, is no reading.
        return misquoted(afterCalls, scroll, !isError(scroll) || scrollVerdict(scroll), { oneRead: `averi's reply does not name the measured panel ${panelAsNamed}`, verb: 'named', pattern: OVER_QUOTE, where: '', measured: panelAsNamed });
      }
      return { outcome: 'ok', why: `${replyKind(scroll) === 'visible' ? `stopped with ks's centre clear of the measured panel (${where})` : `no stop (${where})`}, postcode untouched; ${logged}: ${short(scroll)}` };
    }
    const [evidence, scroll, tap] = replies;
    // Damage is judged before the evidence: a submit the case never asked for is wrong with a panel up or not.
    if (submits > (kind === 'kf2' ? 1 : 0)) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×) — more than the case's ${kind === 'kf2' ? 'one tap' : 'none'}: ${short(scroll)}${kind === 'kf2' ? ` / ${short(tap)}` : ''}` };
    const measured = panelAtLaunch(launched);
    if ('skip' in measured) return measured.skip;
    const { panel, strip } = measured;
    const afterCalls = panelAfterCalls(s, measured);
    if (typeof afterCalls === 'object') return afterCalls.skip;
    const premise = gapPremise(launched.frames.submit, panel, strip);
    if ('why' in premise) return { outcome: 'SKIP', why: premise.why };
    if (missing !== undefined) return missing;
    if (!evidence.includes(`keyboard ${rectText(panel)}`)) {
      // An errored assert ran no poll: it never read the panel.
      return misquoted(afterCalls, evidence, !isError(evidence), { oneRead: `averi's reply does not quote the measured panel ${rectText(panel)} over ks`, verb: 'quoted', pattern: KEYBOARD_QUOTE, where: ' over ks', measured: rectText(panel) });
    }
    if (replyKind(scroll) !== 'visible') return { outcome: 'MISMATCH', why: `refused, though the submit lies wholly between the panel and the strip: ${short(scroll)}` };
    // kf2's one touch is its tap, sent after the scroll; any other is a stroke.
    if (swipesOf(scroll) !== 0 || touches.length > (kind === 'kf2' ? 1 : 0)) return { outcome: 'MISMATCH', why: `a stroke the pinned submit never needed (${swipesOf(scroll) ?? '?'} swipes; ${logged}): ${short(scroll)}` };
    if (kind === 'kf1') return { outcome: 'ok', why: short(scroll) };
    if (!claimsTap(tap) || submits !== 1) return { outcome: claimsTap(tap) ? 'MISMATCH' : 'LOUD', why: `${submits} submit(s); averi: ${short(tap)}` };
    if (s.keyboard?.visible !== true) return { outcome: 'MISMATCH', why: `submitted, but the IME went (a back sent for a tap clear of it): ${short(tap)}` };
    return { outcome: 'ok', why: `1 submit, the IME still up: ${short(scroll)} / ${short(tap)}` };
  };
