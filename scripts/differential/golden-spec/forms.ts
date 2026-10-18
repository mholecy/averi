import type { Platform } from '../corpus.js';
import type { Call, Outcome } from '../differential.js';
import { claimsTap, closeFirst, isError, namesKeyboard, snapshotNodes, type SnapshotNode } from '../../truth/replies.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect } from '../../truth/schema.js';
import { nearPoint, otherControlsFired, probePoint } from '../../truth/truth.js';
import { ocrFailsClosed } from './text.js';
import { BUDGET_MS, classed, failed, first, notTapped, passed, passes, pointsText, reachedWithNoSwipe, said, swipes, tappedInside, tapPoints, touchDowns, within, type Expectation } from './judges.js';

/**
 * The forms family's rows (fixtures/apps/cells/forms.json, phase 1b) — see formRows; golden-spec.ts#formExpectations
 * asks them.
 */

/** docs/verification.md, "Forms & validation", "Field errors" — the rule a field-error row relies on. */
export type PairingRule =
  | 'same identifier below the field'
  | 'own error identifier close under the field'
  | 'named neither way: not seen'
  | 'another field between: pairs with none'
  | 'too far under the field: pairs with none';

const ERROR_ID = /[._-]error$/i;
/** verification.md: "at most 24 pt above it, or the field's height when that is more". */
const MAX_GAP = 24;
const bottom = (r: Rect) => r.y + r.height;
const overlapX = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);

/**
 * Which rule of verification.md pairs a message laid at `frame` with identifier `id`, applied to the APP's frames (not
 * the tree's): the same identifier as `field` and below it — the first rule; else an identifier ending in `_error`,
 * `.error` or `-error`, `field` the nearest field above it in its column, at most 24 pt (or the field's height) above
 * it with no field of the column between them — the second; else none.
 */
export function pairingOf(fields: readonly FieldTruth[], field: FieldTruth, id: string, frame: Rect): PairingRule {
  if (id === field.id && frame.y >= bottom(field.frame)) return 'same identifier below the field';
  if (!ERROR_ID.test(id)) return 'named neither way: not seen';
  const column = fields.filter((f) => overlapX(f.frame, frame) > 0 && bottom(f.frame) <= frame.y);
  const nearest = column.reduce<FieldTruth | undefined>((a, f) => (a === undefined || bottom(f.frame) > bottom(a.frame) ? f : a), undefined);
  if (nearest !== field) return 'another field between: pairs with none';
  return frame.y - bottom(field.frame) <= Math.max(MAX_GAP, field.frame.height) ? 'own error identifier close under the field' : 'too far under the field: pairs with none';
}

/**
 * The text a same-identifier rule would read as a pristine field's error: the nearest title BELOW the field, in its
 * column, that carries the field's own identifier — another field's title, where a design-system component gives every
 * field and its title one identifier (form-shared-id; docs/bugs/2026-10-14-ios-field-errors-pair-a-shared-component-id-
 * with-the-next-fields-title.md). undefined: none lies there. Its row cannot name the one field it is about — `id:`
 * matches all of them (and their titles; `role: textfield` keeps the fields): it fails only when none of them reads the
 * title as its error.
 */
export function sharedTitleBelow(fields: readonly FieldTruth[], field: FieldTruth): FieldTruth | undefined {
  const below = fields.filter((g) => g !== field && g.titleId === field.id && g.titleFrame !== undefined && g.titleFrame.y >= bottom(field.frame) && overlapX(g.titleFrame, field.frame) > 0);
  return below.reduce<FieldTruth | undefined>((a, g) => (a === undefined || g.titleFrame!.y < a.titleFrame!.y ? g : a), undefined);
}

const PAIRS: ReadonlySet<PairingRule> = new Set(['same identifier below the field', 'own error identifier close under the field']);

/** One row of a form cell: `target` names what it is about (a field's tag, `<tag>.title`, `screenError`). */
export type FormExpectation = Expectation & { target: string };

/**
 * The form cells' static rows — what a replayed tree can judge, from the truth the app reported:
 *
 * | truth | verb | expected |
 * |---|---|---|
 * | a field shows an error the rules pair (verification.md, Field errors: same identifier below; own `_error` id close under) | `assert {element:{id}, error}` | passes |
 * | Android: a field shows an error, by any identifier (Android sets no `error` on a field: verification.md, Field errors) | `assert {element:{text: message}}` | passes: the message is read as drawn |
 * | a field shows an error named neither way (`IbanError`) | `assert … error` | fails: not seen |
 * | a screen-level message far under the nearest field above it | `assert {element:{id: that field}, error: message}` | fails: pairs with none |
 * | Android: the same message | `assert {element:{text: message}}` | passes |
 * | a field showing NO error, another field's title below it carrying the field's identifier (one component id shared by every field and its floating title: sharedTitleBelow) | `assert {element:{id, role: textfield}, error: that title}` | fails: a title is no error (verification.md, Field errors: a same-identifier text overlapping a same-identifier field is a title) |
 * | iOS: a field whose shown error the rules pair (above) | `ui_snapshot {filter: role:textfield}`, the textfield at its centre | its `error` is that message (whitespace collapsed) |
 * | iOS: any other field — no error shown, or one the rules pair with none (a title of a field sharing its identifier, FE2; `IbanError`) | the same | no `error` |
 * | Android: every field (averi sets no `error` on a field: verification.md's contract, not the truth) | the same | no `error`, or the field's own shown message — never another string |
 * | a field not open (under the keyboard, covered, under the sheet: ControlTruth.situation) that the snapshot does not list | the same | accepted: no error claimed of it (whether it is listed is visibility, judged by the control's rows) |
 * | a field's title (the P5 text sample: ’ “ ” – — … NBSP & diacritics) | `assert {element:{id: titleId}, text: title}` | passes: the tree reads the text as drawn |
 * | a non-secure field the model holds a value in (prefilled) | `assert … text: value` | passes |
 * | a secure field the model holds a value in | `assert … text: value` | fails: a masked field never reads back as its value |
 * | a control open (centre on screen, clear of keyboard and pinned bar; a probe tap reached it) | tap | `Tapped` |
 * | a field sharing its identifier with another field | tap / scroll_until | not asked: `id:` names every field of the component, not this one |
 * | the pinned submit above the keyboard, open | scroll_until | reached with no swipe |
 * | a control wholly under the keyboard (probe tap pressed a key) | tap | refused naming the keyboard, nothing tapped (tools.ts tap: "a target COVERED by the on-screen keyboard … REFUSED"; idb: "a target whose centre lies below that line is REFUSED") |
 * | Android: the same, a raw tap at its centre after one `back` reached it (ControlTruth.afterBack.reached) | tap | `Tapped`, the keyboard hidden by `back` before the one tap, sent inside its frame (tools.ts tap: "On Android a selector target lying under the soft keyboard is not tapped through it: the keyboard is hidden (back) and the element found again first") |
 * | Android: the same, NOT reached by a tap at its centre after one `back` (the bar dropped back over it: afterBack.probe says what fired) | tap | no tap at that centre where it fired another control; refused with nothing sent, or `Tapped` with every tap inside its piece after back (afterBack.piece, its touch target clear of the submit) where a probe there reached it — replayed over the layout after back (CellTruth.afterBack, the fake device's dump once `back` is sent); live only when no such layout was captured |
 * | a control under the keyboard, the colour the screen shows over it captured (ControlTruth.seen: the keyboard's) | colour, asked with that colour | fails: a pass measured the keyboard (tools.ts assert: "A color/ocr assert never samples what lies over its element: one under the soft keyboard … fails closed"; docs/bugs/2026-10-06-pixel-assert-measures-the-keyboard-over-its-element.md) |
 * | the same | ocr, asked for the field's own copy (its value, else its title) | fails closed: a reading measured the keyboard (the note's `ocr CONTINUE` read the keyboard's `?123`; golden-spec/text.ts#ocrFailsClosed; skipped where the host has no recognizer) |
 * | the same | scroll_until down | never "reached" without a swipe; every swipe touches down above the keyboard's top (tools.ts scroll_until: "the swipes touch down clear of it") |
 * | a control under the picker sheet | tap / scroll_until | refused / stopped before any swipe: `close it first` (ADR 0018, as presented-over) |
 * | a control partly hidden whose probe tap fired ANOTHER control (a field under the pinned submit's bar: the tap submitted the form) | tap | not tapped, nothing sent (tools.ts tap: "a target whose centre lies under another element of the app drawn over it (a pinned button bar …) … with less showing it is REFUSED, naming the cover, nothing tapped") — or, where a probe at its piece clear of the keyboard and the submit reached it (ControlTruth.atPiece), `Tapped` with every tap inside that piece (ADR 0005: a covered target's tap moved to its piece) |
 * | the same | scroll_until down | never "reached" without a swipe |
 * | a picker row off the screen or not laid out (lazy list) | tap | not tapped, nothing sent |
 * | the same | scroll_until down | swipes for it, every touch-down on the sheet ("a row of the presented sheet itself is still swiped for on the sheet") |
 */
/**
 * Android's under-keyboard tap (ControlTruth.afterBack.reached): `Tapped`, a `back` (`input keyevent 4`) sent before the
 * tap, and exactly one tap, inside the control's frame.
 */
export const tappedAfterBack =
  (frame: Rect) =>
  (o: Outcome): string | undefined => {
    if (!claimsTap(o.reply)) return `not tapped: ${first(o)}`;
    const back = o.device.findIndex((d) => d.startsWith('adb shell input keyevent 4'));
    const tapAt = o.device.findIndex((d) => /^adb shell input tap /.test(d));
    if (back < 0 || back > tapAt) return said(o, 'Tapped without a back before the tap');
    const points = tapPoints(o);
    if (points.length !== 1 || !within(points[0], frame)) return said(o, `Tapped at ${pointsText(points)}, not once inside its frame`);
    return undefined;
  };

/** A covered control's tap where its piece was reached (ControlTruth.atPiece): refused with nothing sent, or `Tapped` with every tap inside the piece. */
export const notTappedOrInPiece =
  (piece: Rect) =>
  (o: Outcome): string | undefined => {
    if (!claimsTap(o.reply)) return notTapped(o);
    return tappedInside(o, piece, 'its piece');
  };

/**
 * Android's under-keyboard tap where a tap at its centre after back did NOT reach it (ControlTruth.afterBack.reached
 * false): no tap within TOUCH_SLACK of that centre where it fired another control (`fires`, the probe's words); a
 * refusal sends nothing; `Tapped` only with every tap inside `piece` — its piece after back, given only where a probe
 * there reached it (none: no Tapped is right).
 */
export const tapAfterBackOnPiece =
  (centre: { x: number; y: number }, fires: string | undefined, piece: Rect | undefined) =>
  (o: Outcome): string | undefined => {
    const atCentre = tapPoints(o).filter((p) => nearPoint(p, centre));
    if (fires !== undefined && atCentre.length > 0) return said(o, `tapped at its centre ${pointsText(atCentre)}, which after back ${fires}`);
    if (!claimsTap(o.reply)) return notTapped(o);
    if (piece === undefined) return said(o, 'Tapped, where no tap after back reached it');
    return tappedInside(o, piece, 'its piece after back');
  };

/**
 * What ui_snapshot's `error` column may say of `field` (snapshotRow): `error`, the message it must carry (undefined:
 * none), and `or`, its own shown message accepted beside none (`why`: the reason). On iOS the message the field shows where the rules of
 * verification.md (Field errors, pairingOf) pair it, else none. On Android none, or the field's own message: that averi
 * sets no `error` there is verification.md's contract, not the truth — the truth is the message the field shows (ADR
 * 0020, decision 1), so an averi that pairs it is right too; only another string is wrong.
 */
export function snapshotErrorOf(platform: Platform, fields: readonly FieldTruth[], field: FieldTruth): { error: string | undefined; or?: string; why?: string } {
  if (field.error === null) return { error: undefined };
  if (platform === 'android') return { error: undefined, or: field.error.text, why: 'Android sets none' };
  // No frame of the message captured: the rules cannot be applied to it, so neither answer is ruled out.
  if (field.errorFrame === undefined) return { error: undefined, or: field.error.text, why: `${field.error.id}: no frame of it captured, no pairing judged` };
  return { error: PAIRS.has(pairingOf(fields, field, field.error.id, field.errorFrame)) ? field.error.text : undefined };
}

/**
 * The textfield of a snapshot that is the field at `centre`: of those whose rect holds it, the smallest — a textfield
 * nested in a larger one (a wrapper some trees list with the field's role) is the field itself.
 */
const textfieldAt = (nodes: readonly SnapshotNode[], centre: { x: number; y: number }): SnapshotNode | undefined =>
  nodes.filter((n) => within(centre, n.rect)).reduce<SnapshotNode | undefined>((a, n) => (a === undefined || n.rect.width * n.rect.height < a.rect.width * a.rect.height ? n : a), undefined);

/** Whitespace as averi's text compare reads it (src/verify/text-parity.ts#normalizeText: every space one, trimmed). */
const spaced = (v: string) => v.replace(/\s+/g, ' ').trim();

/**
 * The `snapshot` row of a field: ui_snapshot's error column (filtered to the textfields), judged by the field's own
 * truth (snapshotErrorOf) on the textfield node whose rect holds the field's centre — matched by place, not by
 * identifier, which a design-system component may share with every field (form-shared-id, FE2). `listedOrNot`: the
 * field is not open (ControlTruth.situation), so a snapshot that lists no textfield there is no claim either way.
 */
function snapshotRow(platform: Platform, fields: readonly FieldTruth[], f: FieldTruth, listedOrNot: boolean): FormExpectation {
  const { error: expected, or, why } = snapshotErrorOf(platform, fields, f);
  const centre = { x: f.frame.x + f.frame.width / 2, y: f.frame.y + f.frame.height / 2 };
  return {
    target: f.tag,
    verb: 'snapshot',
    says:
      expected !== undefined
        ? `its error is ${JSON.stringify(expected)}`
        : or !== undefined
          ? `no error (${why}), or its own ${JSON.stringify(or)}`
          : `no error${platform === 'android' ? ' (Android sets none)' : f.error === null ? ' (none shown)' : ` (${f.error.id}: the rules pair it with none)`}`,
    call: { tool: 'ui_snapshot', args: { platform, filter: 'role:textfield' } },
    judge: (o) => {
      const nodes = snapshotNodes(o.reply);
      if (nodes === undefined) return `no snapshot: ${first(o)}`;
      const node = textfieldAt(nodes, centre);
      if (node === undefined) return listedOrNot ? undefined : `no textfield at its centre (${Math.round(centre.x)},${Math.round(centre.y)}) in the snapshot`;
      const got = node.error === undefined || node.error === null ? undefined : node.error;
      if (got === undefined) return expected === undefined ? undefined : `no error, where it shows ${JSON.stringify(expected)}`;
      if (expected === undefined) return or !== undefined && spaced(got) === spaced(or) ? undefined : `reads ${JSON.stringify(got)} as its error, where none is paired`;
      return spaced(got) === spaced(expected) ? undefined : `its error ${JSON.stringify(got)}, not ${JSON.stringify(expected)}`;
    },
  };
}

export function formRows(platform: Platform, truth: CellTruth): FormExpectation[] {
  const form = truth.form;
  if (form === undefined) return [];
  const out: FormExpectation[] = [];
  const assertCall = (spec: Record<string, unknown>): Call => ({ tool: 'assert', args: { platform, asserts: [{ ...spec, timeout: BUDGET_MS }] } });
  for (const f of form.fields) {
    if (platform === 'android' && f.error !== null) {
      // Android sets no `error` on a field (verification.md, Field errors): the message is asserted as text.
      out.push({ target: f.tag, verb: 'error', says: `passes: the message read as text (${f.error.id})`, call: assertCall({ element: { text: f.error.text } }), judge: passes });
    } else if (f.error !== null && f.errorFrame !== undefined) {
      const rule = pairingOf(form.fields, f, f.error.id, f.errorFrame);
      const pairs = PAIRS.has(rule);
      out.push({
        target: f.tag,
        verb: 'error',
        says: `${pairs ? 'passes' : 'fails'} (${rule}: ${f.error.id})`,
        call: assertCall({ element: { id: f.id }, error: f.error.text }),
        judge: (o) => (pairs === passed(o) ? undefined : `${passed(o) ? 'passed' : 'failed'}: ${first(o)}`),
      });
    }
    const shared = f.error === null ? sharedTitleBelow(form.fields, f) : undefined;
    if (shared !== undefined) {
      out.push({
        target: f.tag,
        verb: 'error',
        says: `fails: no error shown (${shared.tag}'s title below it shares its identifier: a title, no error)`,
        call: assertCall({ element: { id: f.id, role: 'textfield' }, error: shared.title }),
        judge: (o) => (failed(o) ? undefined : `passed: ${first(o)}`),
      });
    }
    const situation = form.controls.find((c) => c.tag === f.tag)?.situation;
    out.push(snapshotRow(platform, form.fields, f, situation !== undefined && situation !== 'open'));
    if (truth.cell === 'form-basic') {
      out.push({
        target: `${f.tag}.title`,
        verb: 'text',
        says: `passes: reads ${JSON.stringify(f.title)}`,
        call: assertCall({ element: { id: f.titleId }, text: f.title }),
        judge: passes,
      });
    }
    if (f.value !== '' && f.kind !== 'country') {
      const secure = f.kind === 'pin';
      out.push({
        target: f.tag,
        verb: 'text',
        says: secure ? 'fails: a secure field never reads back as its value' : `passes: reads the model's ${JSON.stringify(f.value)}`,
        call: assertCall({ element: { id: f.id }, text: f.value }),
        judge: (o) => (secure ? (failed(o) ? undefined : `passed: the secure field's value is in the tree`) : passed(o) ? undefined : `failed: ${first(o)}`),
      });
    }
  }
  if (form.screenError !== null && platform === 'android') {
    const e = form.screenError;
    out.push({ target: 'screenError', verb: 'error', says: `passes: the message read as text (${e.id})`, call: assertCall({ element: { text: e.text } }), judge: passes });
  } else if (form.screenError !== null) {
    const e = form.screenError;
    const above = form.fields.filter((f) => overlapX(f.frame, e.frame) > 0 && bottom(f.frame) <= e.frame.y);
    const nearest = above.reduce<FieldTruth | undefined>((a, f) => (a === undefined || bottom(f.frame) > bottom(a.frame) ? f : a), undefined);
    if (nearest !== undefined) {
      const rule = pairingOf(form.fields, nearest, e.id, e.frame);
      const pairs = PAIRS.has(rule);
      out.push({
        target: 'screenError',
        verb: 'error',
        says: `${pairs ? 'passes' : 'fails'} as ${nearest.tag}'s (${rule}: ${Math.round(e.frame.y - bottom(nearest.frame))} pt under it)`,
        call: assertCall({ element: { id: nearest.id }, error: e.text }),
        judge: (o) => (pairs === passed(o) ? undefined : `${passed(o) ? 'passed' : 'failed'}: ${first(o)}`),
      });
    }
  }
  const sharedId = (c: ControlTruth) => form.fields.filter((f) => f.id === c.id).length > 1;
  for (const c of form.controls) if (!sharedId(c)) out.push(...controlRows(platform, c, truth));
  return out.map(classed);
}

function controlRows(platform: Platform, c: ControlTruth, truth: CellTruth): FormExpectation[] {
  const selector = `id:"${c.id}"`;
  const tap: Call = { tool: 'tap', args: { platform, selector } };
  const scroll: Call = { tool: 'scroll_until', args: { platform, selector, direction: 'down' } };
  const target = c.tag;
  const keyboard = truth.form?.keyboard;
  const sheet = truth.form?.sheet;
  switch (c.situation) {
    case 'open': {
      const rows: FormExpectation[] = [
        { target, verb: 'tap', says: 'Tapped', call: tap, judge: (o) => (claimsTap(o.reply) ? undefined : `not tapped: ${first(o)}`) },
      ];
      if (c.kind === 'button' && keyboard !== null && keyboard !== undefined) {
        rows.push({
          target,
          verb: 'scroll_until',
          says: 'reached with no swipe (pinned above the keyboard)',
          call: scroll,
          judge: reachedWithNoSwipe,
        });
      }
      return rows;
    }
    case 'under-keyboard': {
      // What of the screen the keyboard takes: its band (from its top down) and, under a floating IME, its panels
      // (FormTruth.keyboard.panels) — rects, not bands: beside a panel and between it and the strip the screen is the
      // app's (lab finding FU1: src's full-width cut at the panel's top is a defect there, not the truth).
      const top = keyboard?.frame.y ?? Infinity;
      const panels = keyboard?.panels ?? [];
      const underKeyboard = (p: { x: number; y: number }) => p.y >= top || panels.some((r) => within(p, r));
      const rows: FormExpectation[] = [];
      if (platform !== 'android') {
        rows.push({
          target,
          verb: 'tap',
          says: 'refused naming the keyboard, nothing tapped',
          call: tap,
          judge: (o) => notTapped(o) ?? (namesKeyboard(o.reply) ? undefined : said(o, 'refused without naming the keyboard')),
        });
      } else if (c.afterBack?.reached === true) {
        const frame = c.frame!;
        rows.push({
          target,
          verb: 'tap',
          says: 'Tapped after one back hid the keyboard, one tap sent inside it',
          call: tap,
          judge: tappedAfterBack(frame),
        });
      } else if (c.afterBack?.reached === false) {
        // After `back` the layout changes (the bar drops back to the screen's bottom): a raw tap at its centre then did
        // not reach it — what it fired is the probe's (ControlTruth.afterBack.probe). averi finds the element again in
        // the layout after back: with that layout captured (CellTruth.afterBack, served by the fake device once `back`
        // is sent) the row is replayed — never a tap where the centre's probe fired another control, and Tapped only
        // inside its piece there where a probe reached it (afterBack.piece); without it, the live golden's (live.ts k5).
        const fired = otherControlsFired(c.afterBack.probe, c.tag);
        const what = fired.length > 0 ? `fires ${fired.map((e) => `${e.kind} ${e.tag}`).join(', ')}` : 'does not reach it';
        const piece = c.afterBack.piece?.piece;
        rows.push({
          target,
          verb: 'tap',
          says: `never a tap at its centre (after one back a tap there ${what}); Tapped only inside its piece after back${piece === undefined ? '' : ` ${pointsText([{ x: piece.x, y: piece.y }])} ${piece.width}x${piece.height}`}, where a probe reached it`,
          call: tap,
          judge: tapAfterBackOnPiece(probePoint(c.frame!), fired.length > 0 ? what : undefined, c.afterBack.piece?.reached === true ? piece : undefined),
          ...(truth.afterBack === undefined && { live: 'no layout after back captured: averi finds the element again in the new tree, which a replayed tree (the IME-up layout) does not hold; live.ts k5 judges it on the model' }),
        });
      }
      if (c.seen !== undefined) {
        const expected = c.seen;
        rows.push({
          target,
          verb: 'colour',
          says: `fails: the keyboard over it (asked for the colour the screen shows there, ${expected})`,
          call: { tool: 'assert', args: { platform, asserts: [{ element: { id: c.id }, color: { expected }, timeout: BUDGET_MS }] } },
          judge: (o) => (passed(o) ? `passed on ${expected}, the keyboard's: ${first(o)}` : undefined),
        });
        // Its OCR half (phase 4): the recognizer on the real pixels reads the keyboard there.
        const field = truth.form?.fields.find((f) => f.tag === c.tag);
        rows.push({ target, ...ocrFailsClosed(platform, { id: c.id }, field === undefined ? c.tag : field.value !== '' ? field.value : field.title, 'the soft keyboard over it') });
      }
      return [
        ...rows,
        {
          target,
          verb: 'scroll_until',
          says: `not reached without a swipe; every touch-down above the keyboard's top (y ${top})${panels.length === 0 ? '' : ` and off its panel${panels.length === 1 ? '' : 's'} ${panels.map((r) => `${r.x},${r.y} ${r.width}x${r.height}`).join(', ')}`}`,
          call: scroll,
          judge: (o) => {
            if (!isError(o.reply) && swipes(o) === 0) return `reached with no swipe, under the keyboard: ${first(o)}`;
            const under = touchDowns(o).filter(underKeyboard);
            return under.length > 0 ? `touched down under the keyboard at ${pointsText(under)}: ${first(o)}` : undefined;
          },
        },
      ];
    }
    case 'presented-over':
      return [
        {
          target,
          verb: 'tap',
          says: 'refused: close it first, nothing tapped',
          call: tap,
          judge: (o) => notTapped(o) ?? (closeFirst(o.reply) ? undefined : said(o, 'refused without "close it first"')),
        },
        {
          target,
          verb: 'scroll_until',
          says: 'stops before any swipe: close it first',
          call: scroll,
          judge: (o) => (swipes(o) > 0 ? said(o, `swiped ${swipes(o)}× beneath the sheet`) : !closeFirst(o.reply) ? said(o, 'no "close it first"') : undefined),
        },
      ];
    case 'off-screen':
    case 'not-rendered': {
      const absent = `${c.situation}: a row of a lazy list need not be in the tree until it is scrolled to`;
      return [
        { target, verb: 'tap', says: 'not tapped, nothing sent', call: tap, judge: notTapped, absent },
        {
          target,
          verb: 'scroll_until',
          says: 'swipes for it on the sheet',
          call: scroll,
          absent,
          judge: (o) => {
            const downs = touchDowns(o);
            if (downs.length === 0) return `no swipe: ${first(o)}`;
            const off = sheet === undefined ? [] : downs.filter((p) => p.y < sheet.y || p.y > sheet.y + sheet.height);
            return off.length > 0 ? `touched down off the sheet at ${pointsText(off)}: ${first(o)}` : undefined;
          },
        },
      ];
    }
    case 'covered': {
      // Partly hidden. Judged when the probe shows what a tap at its centre does: it fires ANOTHER control (the pinned
      // submit over the field) — so a tap must not be sent, and scroll_until must not call it reached where it is.
      const fired = otherControlsFired(c.probe, c.tag);
      if (fired.length === 0) return [];
      const other = fired.map((e) => `${e.kind} ${e.tag}`).join(', ');
      return [
        c.atPiece?.reached === true
          ? {
              target,
              verb: 'tap',
              says: `not tapped, or Tapped inside its piece ${pointsText([{ x: c.atPiece.piece.x, y: c.atPiece.piece.y }])} ${c.atPiece.piece.width}x${c.atPiece.piece.height} (a tap at its centre fires ${other}; one at its piece reached it)`,
              call: tap,
              judge: notTappedOrInPiece(c.atPiece.piece),
            }
          : { target, verb: 'tap', says: `not tapped, nothing sent (a tap at its centre fires ${other})`, call: tap, judge: notTapped },
        {
          target,
          verb: 'scroll_until',
          says: `not reached with no swipe (a tap at its centre fires ${other})`,
          call: scroll,
          judge: (o) => (!isError(o.reply) && swipes(o) === 0 ? `reached with no swipe where a tap fires ${other}: ${first(o)}` : undefined),
        },
      ];
    }
  }
}
