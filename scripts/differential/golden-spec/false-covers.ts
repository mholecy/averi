import type { Platform, SourceKind } from '../corpus.js';
import type { CellTruth, TargetTruth } from '../../truth/schema.js';
import { openRows } from './base.js';
import { dismissRow } from './rows.js';
import { classed, type Expectation } from './judges.js';

/**
 * The false-covers family's rows (fixtures/apps/cells/false-covers.json, phase 3 B5): what lies over a target in a
 * tree yet is no cover.
 *
 * | truth | verb | expected | decided by |
 * |---|---|---|---|
 * | a text target (CatalogTarget.text) drawn on its own control, reached (a raw tap at its centre fires the control) | tap `text:"…"` | `Tapped` | docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md; docs/bugs/2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md |
 * | the same | scroll_until `text:"…"` | reached with no swipe | the same notes (the "layout defect" stop on a screen that does not scroll) |
 * | a form field under the keyboard, the cell's `config.ios.keyboardDismiss` tapping its principal title (FormTruth.title, whose probe ended the editing), a toolbar laid over that title in the tree | tap (WDA) | R-dismiss (rows.ts#dismissRow): the title tapped, not refused for the toolbar, nothing else tapped (no tap inside the keyboard, no `Tapped`: in a replayed tree the keyboard stays) — in place of the form's "refused naming the keyboard, nothing tapped" row | docs/bugs/2026-10-08-wda-dismissal-shadowed-by-fullscreen-swiftui-toolbar.md, docs/bugs/2026-10-09-ios-wda-childless-toolbar-refuses-keyboard-dismissal.md; ADR 0016 |
 *
 * A text target's colour is not asked: what the assert samples of a text is its glyphs on the control, not one colour.
 * R-dismiss is asked of the WDA capture only: the keyboardDismiss list is inert under idb (flow/config.ts — idb marks no
 * node as the keyboard), so there the form's own under-keyboard row stands. What a replayed tree cannot show — the
 * keyboard going after the dismissal, and the field then tapped — is the live golden's (phase 5).
 */

/** A text target's rows: base.ts's open tap and scroll_until, asked by its text, as a test names a label. */
export function ownPartsRows(platform: Platform, t: TargetTruth): Expectation[] {
  return openRows(platform, t, `text:"${t.text}"`).filter((e) => e.verb !== 'colour');
}

/**
 * The dismissal a form cell configures: its `config.ios.keyboardDismiss` names a `tap` on the principal title's
 * identifier, and the title's probe ended the editing. undefined: the cell configures none, or not that one.
 */
export function dismissalOf(truth: CellTruth): NonNullable<NonNullable<CellTruth['form']>['title']> | undefined {
  const title = truth.form?.title;
  const list = truth.config?.ios?.keyboardDismiss;
  if (title === undefined || !title.reached || !Array.isArray(list)) return undefined;
  const taps = list.some((d: unknown) => (d as { tap?: { id?: unknown } } | null)?.tap?.id === title.id);
  return taps ? title : undefined;
}

/**
 * R-dismiss of a form cell (WDA only, see above): per field under the keyboard, its tap sends the configured dismissal.
 * `replaces` the form rows it stands in for (golden-spec/forms.ts's "refused naming the keyboard" tap of each).
 */
export function dismissRows(platform: Platform, truth: CellTruth, source: SourceKind): { rows: (Expectation & { target: string })[]; replaces: Set<string> } {
  const title = dismissalOf(truth);
  const keyboard = truth.form?.keyboard?.frame;
  const under = source === 'wda' && title !== undefined ? (truth.form?.controls ?? []).filter((c) => c.kind === 'field' && c.situation === 'under-keyboard') : [];
  // A field under the keyboard with no keyboard frame is a truth that contradicts itself: refused loudly rather than
  // judged by the looser row (no "nothing else tapped" without the keyboard's frame).
  if (under.length > 0 && keyboard === undefined) throw new Error(`${truth.cell}: ${under.map((c) => c.tag).join(', ')} under the keyboard, but the truth holds no keyboard frame — R-dismiss cannot judge "nothing else tapped"`);
  return {
    rows: under.map((c) => classed(dismissRow(platform, c, { label: `id:"${title!.id}"`, frame: title!.frame }, keyboard))),
    replaces: new Set(under.map((c) => c.tag)),
  };
}
