import type { Platform } from '../corpus.js';
import type { Call } from '../differential.js';
import type { CellTruth, ControlTruth, FieldTruth, Rect } from '../../truth/schema.js';
import { otherControlsFired } from '../../truth/truth.js';
import { BUDGET_MS, classed, closeFirst, failed, first, notTapped, ownWords, passed, said, swipes, touchDowns, type Expectation } from './judges.js';

/** The forms family's rows (fixtures/apps/cells/forms.json, phase 1b) — see formExpectations. */

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

const PAIRS: ReadonlySet<PairingRule> = new Set(['same identifier below the field', 'own error identifier close under the field']);

/** One row of a form cell: `target` names what it is about (a field's tag, `<tag>.title`, `screenError`). */
export type FormExpectation = Expectation & { target: string };

/**
 * The form cells' static rows — what a replayed tree can judge, from the truth the app reported:
 *
 * | truth | verb | expected |
 * |---|---|---|
 * | a field shows an error the rules pair (verification.md, Field errors: same identifier below; own `_error` id close under) | `assert {element:{id}, error}` | passes |
 * | a field shows an error named neither way (`IbanError`) | `assert … error` | fails: not seen |
 * | a screen-level message far under the nearest field above it | `assert {element:{id: that field}, error: message}` | fails: pairs with none |
 * | a field's title (the P5 text sample: ’ “ ” – — … NBSP & diacritics) | `assert {element:{id: titleId}, text: title}` | passes: the tree reads the text as drawn |
 * | a non-secure field the model holds a value in (prefilled) | `assert … text: value` | passes |
 * | a secure field the model holds a value in | `assert … text: value` | fails: a masked field never reads back as its value |
 * | a control open (centre on screen, clear of keyboard and pinned bar; a probe tap reached it) | tap | `Tapped` |
 * | the pinned submit above the keyboard, open | scroll_until | reached with no swipe |
 * | a control wholly under the keyboard (probe tap pressed a key) | tap | refused naming the keyboard, nothing tapped (tools.ts tap: "a target COVERED by the on-screen keyboard … REFUSED"; idb: "a target whose centre lies below that line is REFUSED") |
 * | the same | scroll_until down | never "reached" without a swipe; every swipe touches down above the keyboard's top (tools.ts scroll_until: "the swipes touch down clear of it") |
 * | a control under the picker sheet | tap / scroll_until | refused / stopped before any swipe: `close it first` (ADR 0018, as presented-over) |
 * | a control partly hidden whose probe tap fired ANOTHER control (a field under the pinned submit's bar: the tap submitted the form) | tap | not tapped, nothing sent (tools.ts tap: "a target whose centre lies under another element of the app drawn over it (a pinned button bar …) … with less showing it is REFUSED, naming the cover, nothing tapped") |
 * | the same | scroll_until down | never "reached" without a swipe |
 * | a picker row off the screen or not laid out (lazy list) | tap | not tapped, nothing sent |
 * | the same | scroll_until down | swipes for it, every touch-down on the sheet ("a row of the presented sheet itself is still swiped for on the sheet") |
 */
export function formExpectations(platform: Platform, truth: CellTruth): FormExpectation[] {
  const form = truth.form;
  if (form === undefined) return [];
  const out: FormExpectation[] = [];
  const assertCall = (spec: Record<string, unknown>): Call => ({ tool: 'assert', args: { platform, asserts: [{ ...spec, timeout: BUDGET_MS }] } });
  for (const f of form.fields) {
    if (f.error !== null && f.errorFrame !== undefined) {
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
    if (truth.cell === 'form-basic') {
      out.push({
        target: `${f.tag}.title`,
        verb: 'text',
        says: `passes: reads ${JSON.stringify(f.title)}`,
        call: assertCall({ element: { id: f.titleId }, text: f.title }),
        judge: (o) => (passed(o) ? undefined : `failed: ${first(o)}`),
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
  if (form.screenError !== null) {
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
  for (const c of form.controls) out.push(...controlRows(platform, c, truth));
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
        { target, verb: 'tap', says: 'Tapped', call: tap, judge: (o) => (o.reply.startsWith('Tapped') ? undefined : `not tapped: ${first(o)}`) },
      ];
      if (c.kind === 'button' && keyboard !== null && keyboard !== undefined) {
        rows.push({
          target,
          verb: 'scroll_until',
          says: 'reached with no swipe (pinned above the keyboard)',
          call: scroll,
          judge: (o) => (o.reply.startsWith('ERROR') ? `stopped: ${first(o)}` : swipes(o) > 0 ? `swiped ${swipes(o)}×: ${first(o)}` : undefined),
        });
      }
      return rows;
    }
    case 'under-keyboard': {
      const top = keyboard?.frame.y ?? Infinity;
      return [
        {
          target,
          verb: 'tap',
          says: 'refused naming the keyboard, nothing tapped',
          call: tap,
          judge: (o) => notTapped(o) ?? (/\bsoft keyboard\b/i.test(ownWords(o)) ? undefined : said(o, 'refused without naming the keyboard')),
        },
        {
          target,
          verb: 'scroll_until',
          says: `not reached without a swipe; every touch-down above the keyboard's top (y ${top})`,
          call: scroll,
          judge: (o) => {
            if (!o.reply.startsWith('ERROR') && swipes(o) === 0) return `reached with no swipe, under the keyboard: ${first(o)}`;
            const under = touchDowns(o).filter((p) => p.y >= top);
            return under.length > 0 ? `touched down under the keyboard at ${under.map((p) => `(${p.x},${p.y})`).join(' ')}: ${first(o)}` : undefined;
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
          judge: (o) => notTapped(o) ?? (closeFirst(o) ? undefined : said(o, 'refused without "close it first"')),
        },
        {
          target,
          verb: 'scroll_until',
          says: 'stops before any swipe: close it first',
          call: scroll,
          judge: (o) => (swipes(o) > 0 ? said(o, `swiped ${swipes(o)}× beneath the sheet`) : !closeFirst(o) ? said(o, 'no "close it first"') : undefined),
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
            return off.length > 0 ? `touched down off the sheet at ${off.map((p) => `(${p.x},${p.y})`).join(' ')}: ${first(o)}` : undefined;
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
        { target, verb: 'tap', says: `not tapped, nothing sent (a tap at its centre fires ${other})`, call: tap, judge: notTapped },
        {
          target,
          verb: 'scroll_until',
          says: `not reached with no swipe (a tap at its centre fires ${other})`,
          call: scroll,
          judge: (o) => (!o.reply.startsWith('ERROR') && swipes(o) === 0 ? `reached with no swipe where a tap fires ${other}: ${first(o)}` : undefined),
        },
      ];
    }
  }
}
