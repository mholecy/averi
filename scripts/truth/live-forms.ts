import { minTapPiece } from '../../src/ui-tree/draw-order.js';
import { rectText } from '../../src/ui-tree/geometry.js';
import { firedSince, touchesSince, touchPointsText, type LiveVerdict } from './live-visibility.js';
import { allPassed, ASSERTS_FAILED, claimsDone, claimsTap, firstLine, isError, missedTarget, presentedRemedySaid, replyKind, swipesOf, windowHintSaid } from './replies.js';
import type { IosTreeSourceKind } from '../../src/adapters/ios-node.js';
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
export const short = (reply: string) => reply.split('\n')[0].slice(0, 220);

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
 * A second fill without clear that the field refuses, though its text already holds the value — so `holds` cannot catch
 * a false Filled: the app does hold `kept`. Ok only when the app holds `kept`, the first fill did not fail, and the last
 * reply is an error (saying `phrase`, when given). A claim of done is a MISMATCH `fill-claim`; the field other than
 * `kept` is LOUD `loud-changed`; the first fill failed over `kept` is a MISMATCH `failed-holds` (its kind); kept, but
 * no error saying `phrase` and no claim either, is LOUD `loud-untouched`. f15's and f16's judge (below).
 */
export const refusedHolding =
  (tag: string, kept: string, phrase?: string) =>
  (s: LabState, replies: string[], _source: Source, _launched: LabState): LiveVerdict => {
    const got = valueOf(s, tag);
    const [first] = replies;
    const last = replies[replies.length - 1];
    const kind = replyKind(last);
    const refused = phrase === undefined ? 'refused' : `refused as "${phrase}"`;
    if (claimsDone(last)) return { outcome: 'MISMATCH', cls: 'fill-claim', kind, why: `averi says ${short(last)} — the field refused the typing; the app holds ${JSON.stringify(got)}` };
    if (got !== kept) return { outcome: 'LOUD', cls: 'loud-changed', kind, why: `the app holds ${JSON.stringify(got)}, not ${JSON.stringify(kept)}; averi: ${short(last)}` };
    if (isError(first)) return { outcome: 'MISMATCH', cls: 'failed-holds', kind: replyKind(first), why: `the app holds ${JSON.stringify(kept)}, but averi failed the first fill: ${short(first)}` };
    if (!isError(last) || (phrase !== undefined && !last.includes(phrase))) return { outcome: 'LOUD', cls: 'loud-untouched', kind, why: `the field kept ${JSON.stringify(kept)}, but not ${refused}: ${short(last)}` };
    return { outcome: 'ok', kind, why: `${refused}, the field kept ${JSON.stringify(kept)}: ${short(last)}` };
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
 * Where the lab's hand-floated Gboard panel was measured (the IME window's touchable region beside its 132-px strip):
 * the capture's `SkRegion((71,1092,1008,1884)(0,2088,1080,2220))`
 * (tests/fixtures/truth/android-averi_lab-api33/form-keyboard-floating.ime.json) and the 2026-10-23 live run's
 * `SkRegion((359,1269,1040,1912)(0,2088,1080,2220))` (docs/truth/live-android-2026-10-23-floating-gap.md, also the
 * 2026-10-08 device check's). No adb setting places it; a run that finds it elsewhere reads its region and adds it here.
 * kf3 refuses a visible claim on ks whose centre lies in ANY of them.
 */
export const LAB_FLOATING_PANELS: readonly Rect[] = [
  { x: 71, y: 1092, width: 937, height: 792 },
  { x: 359, y: 1269, width: 681, height: 643 },
];

/**
 * The kf cases' precondition: the IME is FLOATING at launch — the app hears of only its strip (the inset the panel's
 * window gives, 132 px on the lab AVD), not a docked keyboard's 822 px. No adb setting floats Gboard, so a run whose
 * Gboard came up docked is not run, never ok. WEAK on its own: the app's state cannot tell a floating panel from an
 * IME collapsed to its strip with no panel (a hardware-keyboard toolbar), where kf1 and kf2 would pass with no gap
 * rule at all; the record keeps no region. So each case evidences the panel in a reply of its own, which must quote a
 * measured one (`judgeFloatingGap`).
 */
export function floatingAtLaunch(launched: LabState): LiveVerdict | undefined {
  const ime = launched.keyboard;
  if (ime?.visible !== true) return { outcome: 'SKIP', why: 'no IME at launch' };
  return ime.frame.height > 200 ? { outcome: 'SKIP', why: `keyboard docked (the app hears an IME ${ime.frame.height} px tall, not the floating strip)` } : undefined;
}

/** Whether a frame's centre, as a probe taps it, lies in any measured panel. */
const inAPanel = (r: Rect | undefined | null): boolean => r != null && LAB_FLOATING_PANELS.some((p) => within(probePoint(r), p));

/** Whether a reply quotes a measured panel, as its sentence spells a rect (`spell`): the run's evidence that the IME was floating. */
const panelQuoted = (reply: string | undefined, spell: (p: Rect) => string): boolean => LAB_FLOATING_PANELS.some((p) => reply?.includes(spell(p)) === true);

/** The kf1/kf2 evidence call, sent first (a submit lays the form out again): a colour assert on ks, which the pixel poll refuses naming the panel over it (`keyboard x,y wxh`) — no touch, no key, the IME left up. */
export const FLOATING_PANEL_EVIDENCE = { tool: 'assert', args: { asserts: [{ element: { id: 'lab.form-keyboard-floating.ks' }, color: { expected: '#FFFFFF' }, timeout: 5_000 }] } } as const;

/**
 * kf1–kf3, form-keyboard-floating under a floating Gboard: the pinned submit lies wholly in the strip between the panel
 * and the strip the app hears of, drawn and tappable (ADR 0027).
 * - `kf1` scroll_until submit: a visible claim with no stroke (0 swipes, no touch the app logged); a refusal is the
 *   false refusal of the note, a stroke one the bar never needed.
 * - `kf2` scroll_until submit, then tap it: one submit, the IME still up (no `back` sent for it), the tap the one
 *   touch the app logged.
 * - kf1 and kf2 start with `FLOATING_PANEL_EVIDENCE`: SKIP unless its reply quotes a measured panel over ks.
 * - `kf3` scroll_until ks: never a visible claim while ks's centre lies in the panel; postcode, focused under it, as
 *   the launch left it (no key typed).
 * docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md
 */
export const judgeFloatingGap =
  (kind: 'kf1' | 'kf2' | 'kf3') =>
  (s: LabState, replies: string[], _source: string, launched: LabState): LiveVerdict => {
    const docked = floatingAtLaunch(launched);
    if (docked !== undefined) return docked;
    const submits = (s.submits ?? []).length;
    const touches = touchesSince(s, launched);
    const logged = `${touches.length} touch(es) the app logged${touches.length === 0 ? '' : ` at ${touchPointsText(touches)}`}`;
    if (kind === 'kf3') {
      const [scroll] = replies;
      if (valueOf(s, 'postcode') !== valueOf(launched, 'postcode')) return { outcome: 'MISMATCH', why: `postcode CHANGED to ${JSON.stringify(valueOf(s, 'postcode'))} — a key was typed; averi: ${short(scroll)}` };
      if (submits > 0) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×); averi: ${short(scroll)}` };
      // Not run unless ks starts under a measured panel: elsewhere a visible claim is no evidence either way.
      if (!inAPanel(launched.frames.ks)) return { outcome: 'SKIP', why: 'ks\'s centre at launch lies in no measured panel' };
      const ks = s.frames.ks;
      const where = ks == null ? 'ks not laid out' : `ks ${ks.y}–${ks.y + ks.height}`;
      if (replyKind(scroll) === 'visible' && (ks == null || inAPanel(ks))) return { outcome: 'MISMATCH', why: `averi says ${short(scroll)} — ks's centre lies in a measured panel (${where}); ${logged}` };
      // An ok refusal names a panel (not the 132-px strip alone): the run's evidence that the IME was floating.
      if (!panelQuoted(scroll, (p) => `over [${p.x},${p.y}][${p.x + p.width},${p.y + p.height}]`)) return { outcome: 'SKIP', why: `no measured panel named in the reply — the IME was not floating there: ${short(scroll)}` };
      return { outcome: 'ok', why: `${replyKind(scroll) === 'visible' ? `stopped with ks's centre clear of the measured panels (${where})` : `no stop (${where})`}, postcode untouched; ${logged}: ${short(scroll)}` };
    }
    const [evidence, scroll, tap] = replies;
    // Damage is judged before the evidence: a submit the case never asked for is wrong with a panel up or not.
    if (submits > (kind === 'kf2' ? 1 : 0)) return { outcome: 'MISMATCH', why: `the form was SUBMITTED (${submits}×) — more than the case's ${kind === 'kf2' ? 'one tap' : 'none'}: ${short(scroll)}${kind === 'kf2' ? ` / ${short(tap)}` : ''}` };
    if (!panelQuoted(evidence, (p) => `keyboard ${rectText(p)}`)) return { outcome: 'SKIP', why: `no measured panel quoted over ks — the IME was not floating there: ${short(evidence)}` };
    if (replyKind(scroll) !== 'visible') return { outcome: 'MISMATCH', why: `refused, though the submit lies wholly between the panel and the strip: ${short(scroll)}` };
    // kf2's one touch is its tap, sent after the scroll; any other is a stroke.
    if (swipesOf(scroll) !== 0 || touches.length > (kind === 'kf2' ? 1 : 0)) return { outcome: 'MISMATCH', why: `a stroke the pinned submit never needed (${swipesOf(scroll) ?? '?'} swipes; ${logged}): ${short(scroll)}` };
    if (kind === 'kf1') return { outcome: 'ok', why: short(scroll) };
    if (!claimsTap(tap) || submits !== 1) return { outcome: claimsTap(tap) ? 'MISMATCH' : 'LOUD', why: `${submits} submit(s); averi: ${short(tap)}` };
    if (s.keyboard?.visible !== true) return { outcome: 'MISMATCH', why: `submitted, but the IME went (a back sent for a tap clear of it): ${short(tap)}` };
    return { outcome: 'ok', why: `1 submit, the IME still up: ${short(scroll)} / ${short(tap)}` };
  };
