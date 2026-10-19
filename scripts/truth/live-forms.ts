import { minTapPiece } from '../../src/ui-tree/draw-order.js';
import { firedSince, touchesSince, touchPointsText, type LiveVerdict } from './live-visibility.js';
import { ASSERTS_FAILED, claimsDone, claimsTap, isError, presentedRemedySaid, replyKind, windowHintSaid } from './replies.js';
import type { LabState, Rect } from './schema.js';

/**
 * The live golden's forms judges that are more than a value held (live.ts runs the cases): pure over the lab app's
 * form model, so they are pinned without a device (tests/truth/live-forms.test.ts). `holds` is every fill case's;
 * the two below it are lab note F2A1's form-keyboard cases, whose submit bar riding on the IME has no node — the app's
 * frames (`submit.bar`) say what of a field it covers, which the tree cannot; `judgeUnderSheet` is the taps beneath
 * form-picker's sheet, `judgeMissUnderSheet` the asserts and the flow's `wait:` there.
 */

export const valueOf = (s: LabState, tag: string) => s.fields?.[tag]?.value;
export const short = (reply: string) => reply.split('\n')[0].slice(0, 220);

/** The model must hold `want` in `tag`; the last reply's claim is held to it (LOUD / MISMATCH as above). */
export const holds =
  (tag: string, want: string) =>
  (s: LabState, replies: string[], _source?: string, launched?: LabState): LiveVerdict => {
    const got = valueOf(s, tag);
    // LOUD splits by what averi left behind: the field as the launch left it, or changed (a part typed, a part cleared).
    const before = launched === undefined ? undefined : valueOf(launched, tag);
    const left = before === undefined ? '' : got === before ? ' — field untouched' : ` — field CHANGED (was ${JSON.stringify(before)})`;
    const last = replies[replies.length - 1];
    if (got === want) {
      return isError(last) ? { outcome: 'MISMATCH', why: `the app holds ${JSON.stringify(got)}, but averi failed: ${short(last)}` } : { outcome: 'ok', why: short(last) };
    }
    return claimsDone(last)
      ? { outcome: 'MISMATCH', why: `averi says ${short(last)} — the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}` }
      : { outcome: 'LOUD', why: `the app holds ${JSON.stringify(got)}, not ${JSON.stringify(want)}${left}; averi: ${short(last)}` };
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
export function judgeNoteFill(s: LabState, replies: string[], source: string, launched: LabState): LiveVerdict {
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
 * and fully expanded (the not-founds round 7's A3 asked by a scratch driver: docs/truth/live-android-2026-10-19-hint-everywhere.md). name lies
 * beneath the sheet, so the call must FAIL — an assert's `N/M asserts FAILED`, the flow's `ERROR Timed out …`; a pass
 * (or a flow done) is a MISMATCH — nothing may fire, and its not-found says the sheet's remedy exactly once
 * (`remedyUnderSheet`): none, or "close it first" twice, is LOUD.
 */
export const judgeMissUnderSheet =
  (tag: string) =>
  (s: LabState, [reply]: string[], source: string, launched: LabState): LiveVerdict => {
    const kind = replyKind(reply);
    const logged = loggedSince(s, launched);
    if (!ASSERTS_FAILED.test(reply) && !isError(reply)) return { outcome: 'MISMATCH', kind, why: `averi says ${short(reply)} — ${tag} lies beneath the picker sheet; the app logged ${logged.join(', ') || 'nothing'}` };
    if (logged.length > 0) return { outcome: 'MISMATCH', kind, why: `failed, but the app logged ${logged.join(', ')} — averi: ${short(reply)}` };
    const { said, times } = remedyUnderSheet(reply, source);
    if (times > 1) return { outcome: 'LOUD', kind, why: `failed, nothing fired, but "close it first" said ${times} times: ${short(reply)}` };
    if (said === undefined) return { outcome: 'LOUD', kind, why: `failed, nothing fired, but no "close it first": ${short(reply)}` };
    return { outcome: 'ok', kind, why: `failed, nothing fired; ${said}: ${short(reply)}` };
  };
