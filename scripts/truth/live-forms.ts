import { minTapPiece } from '../../src/ui-tree/draw-order.js';
import { firedSince, touchesSince, touchPointsText, type LiveVerdict } from './live-visibility.js';
import { claimsDone, claimsTap, isError, presentedRemedySaid, replyKind, windowHintSaid } from './replies.js';
import type { LabState, Rect } from './schema.js';

/**
 * The live golden's forms judges that are more than a value held (live.ts runs the cases): pure over the lab app's
 * form model, so they are pinned without a device (tests/truth/live-forms.test.ts). `holds` is every fill case's;
 * the two below it are lab note F2A1's form-keyboard cases, whose submit bar riding on the IME has no node — the app's
 * frames (`submit.bar`) say what of a field it covers, which the tree cannot; `judgeUnderSheet` is the taps beneath
 * form-picker's sheet.
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
 * centre under the bar (the surface with no node) or the IME is no stop; clear of both, a stop is right — and what of
 * it the bar's top padding still covers is said: a `fully visible` there overstates by those px, ADR 0013's accepted
 * residual (the tree has no node for the padding).
 */
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
    const overstates = covered > 0 && /fully visible/.test(reply) ? ` — "fully" overstates by ${covered} px (ADR 0013 residual)` : '';
    return { outcome: 'ok', why: `stopped with phone's centre clear of the bar and the IME (${where}); ${strokes}: ${short(reply)}${overstates}` };
  }
  return { outcome: 'ok', why: `no stop, nothing submitted (${where}); ${strokes}: ${short(reply)}` };
}

/**
 * c2–c4: a tap on form-picker's name, country or submit beneath the picker sheet, open at launch and fully expanded —
 * a sheet uiautomator's dump marks no presented window (no scrim: ADR 0018's residual 18, accepted with the
 * active-window hint). Nothing may fire — no row selected, no submit, the sheet not dismissed, no field focused — and
 * no `Tapped`. The reply must then say to close the sheet, once: the presented remedy (a sheet the tree source marks)
 * or the active-window hint (uiautomator: src/ui-tree/standing.ts#ACTIVE_WINDOW_HINT) — ok; neither, or "close it
 * first" said twice, is LOUD (idb lists only the sheet and says nothing of it).
 */
export const judgeUnderSheet =
  (tag: string) =>
  (s: LabState, [reply]: string[], _source: string, launched: LabState): LiveVerdict => {
    const kind = replyKind(reply);
    const fired = firedSince(s, launched);
    const focused = s.focus != null && s.focus !== launched.focus ? s.focus : undefined;
    const logged = [...fired.map((e) => `${e.kind} ${e.tag}`), ...(focused === undefined ? [] : [`focus ${focused}`])];
    if (claimsTap(reply)) return { outcome: 'MISMATCH', kind, why: `averi says ${short(reply)} — ${tag} lies beneath the picker sheet; the app logged ${logged.join(', ') || 'nothing'}` };
    if (logged.length > 0) return { outcome: 'MISMATCH', kind, why: `refused, but the app logged ${logged.join(', ')} — averi: ${short(reply)}` };
    const by = presentedRemedySaid(reply) ? 'the presented remedy' : windowHintSaid(reply) ? 'the active-window hint' : undefined;
    const times = reply.split('close it first').length - 1;
    if (by === undefined) return { outcome: 'LOUD', kind, why: `not tapped, nothing fired, but no "close it first": ${short(reply)}` };
    if (times > 1) return { outcome: 'LOUD', kind, why: `not tapped, nothing fired, but "close it first" said ${times} times: ${short(reply)}` };
    return { outcome: 'ok', kind, why: `not tapped, nothing fired; ${by}, once: ${short(reply)}` };
  };
