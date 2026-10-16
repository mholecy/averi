import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expected, type Calibration } from '../../scripts/truth/calibrate.js';
import { LIVE_KNOWN } from '../../scripts/truth/live-known.js';
import { KNOWN } from '../differential/golden/files.js';

// One lab note lives in three places, and nothing but these tests ties them together (round 5's B4, slim: no ledger
// file, ADR 0020 §4): the static KNOWN (tests/differential/golden/<family>.known.ts, a row's `as`), the live KNOWN
// (scripts/truth/live-known.ts, an entry's `note`) and the calibration table (scripts/truth/calibration.json, a note's
// `note`, `status` and `checks`; docs/truth/calibration.md is generated from it). Each names a note of docs/bugs as
// `bug:<file>` (calibration.json by the bare file name), or a decision as `residual:<what>`. Held here:
//   1. every `bug:` names a file of docs/bugs, and every `residual:` is a decision this repo records;
//   2. every note calibration.json expects OPEN-RED has its rows in the static KNOWN, each filed as that note — so
//      ≥ 1 KNOWN row (calibrate.ts asks an open note for rows) and, when its fix strikes them off, its calibration is
//      what turns, not a row filed elsewhere;
//   3. conversely, every note a KNOWN row (static or live) is filed as is an open note of calibration.json — except
//      the live-only notes below, each excluded from the calibration with its reason.
// Filing a note, or striking one off when it is fixed, therefore touches all three places in one commit or fails here.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const table = JSON.parse(readFileSync(`${ROOT}scripts/truth/calibration.json`, 'utf8')) as Calibration;

/**
 * Notes a KNOWN row is filed as that are no open note of calibration.json — each a live-only finding (scroll dynamics,
 * a stroke's reach on the device): no captured tree reproduces it, so the replay has no row to calibrate it on, and
 * calibration.json lists it under `excluded` (checked below, with the reason it gives).
 */
const LIVE_ONLY: Readonly<Record<string, string>> = {
  '2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md': 'LV1: a list moving through blank content, live only',
  '2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md': "LV2: the flush probe's reach, live only (and intermittent)",
  '2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md': "LV3: the turned stroke's touch-down, live only",
  '2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md': 'a fling in a lazy list: scroll dynamics, live only',
};

/**
 * Notes calibration.json lists that are not committed on this branch: fixed notes (calibrated, or a residual, or
 * excluded). 20 of the 31 are committed in 5f1996e (docs/device-check-r5-r12, not merged here); the other 11 — the
 * 2026-10-14/15 notes, ios-color-assert-on-a-row-outside… through ocr-assert-fails-on-a-typographic-apostrophe…, and
 * the excluded android-numeric-character-references… — are in no commit on any ref, only untracked in the main
 * checkout (the owner's to commit). calibrate.ts reads no note's text, only its rows, so they calibrate without it; but
 * none of them may be open or be named by a KNOWN row (checked below), and a note that lands here must be struck off
 * this list.
 */
const NOT_ON_THIS_BRANCH: readonly string[] = [
  '2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md',
  '2026-10-09-android-fill-into-a-field-that-drops-everything-reads-exposes-no-value.md',
  '2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md',
  '2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md',
  '2026-10-09-android-tap-on-a-sliver-at-scroll-container-edge-reports-tapped-and-does-nothing.md',
  '2026-10-09-hold-still-timeout-after-one-read-blames-a-moving-element.md',
  '2026-10-09-ios-floating-tab-bar-surface-above-its-buttons-takes-a-rows-tap.md',
  '2026-10-09-ios-idb-modal-listed-before-content-reads-covered-by-the-content-behind-it.md',
  '2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md',
  '2026-10-09-ios-scroll-until-never-turns-back-when-target-stays-clipped-or-in-status-band.md',
  '2026-10-09-ios-wda-cell-background-and-textfield-scroll-bar-read-as-covers.md',
  '2026-10-10-android-tap-and-scroll-until-treat-the-system-status-bar-as-app-screen.md',
  '2026-10-10-ios-pixel-asserts-sample-the-chrome-over-their-element.md',
  '2026-10-12-android-pixel-asserts-read-a-text-cut-at-the-navigation-bar.md',
  '2026-10-12-ios-scroll-until-never-reads-a-bouncing-list-end-as-exhausted.md',
  '2026-10-13-android-fab-host-layer-refuses-taps-beside-the-fab.md',
  '2026-10-13-ios-idb-quicktype-bar-lies-above-the-keyboard-band-and-is-tapped.md',
  '2026-10-13-ios-wda-hidden-host-tab-bar-covers-a-pushed-screens-rows.md',
  '2026-10-13-ios-wda-rn-transparent-modal-dim-overlay-is-no-cover-tap-reported-done.md',
  '2026-10-13-ios-wda-sheet-background-is-no-cover-tap-goes-through-to-the-screen-beneath.md',
  '2026-10-14-ios-color-assert-on-a-row-outside-its-scroll-view-measures-the-background-and-passes.md',
  '2026-10-14-ios-color-assert-on-a-sliver-beneath-a-presented-sheet-measures-the-sheet-and-passes.md',
  '2026-10-14-ios-field-error-with-its-own-identifier-is-never-paired-with-its-field.md',
  '2026-10-14-ios-field-errors-pair-a-shared-component-id-with-the-next-fields-title.md',
  '2026-10-14-ios-swiftui-blur-overlay-has-no-node-tap-beneath-reported-done.md',
  '2026-10-14-ios-wda-scroll-until-swipes-under-a-presented-screen-when-the-target-is-below-the-fold.md',
  '2026-10-14-ios-wda-sheet-dim-labelled-dismiss-region-is-no-presented-screen-scroll-until-swipes-the-sheet.md',
  '2026-10-14-ios-wda-tap-and-pixel-assert-beneath-a-presented-screen-give-scroll-or-status-bar-advice-when-nothing-of-the-target-shows-below-the-bar.md',
  '2026-10-15-android-numeric-character-references-in-uiautomator-attributes-are-not-decoded.md',
  '2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md',
  '2026-10-15-ocr-assert-fails-on-a-typographic-apostrophe-the-recognizer-reads-as-straight.md',
];

/** Every place a note is named: where, and the name (`bug:<file>`, `residual:<what>`, or anything else, refused). */
const named: readonly { where: string; name: string }[] = [
  ...Object.entries(KNOWN).flatMap(([k, v]) => (v.as === undefined ? [] : [{ where: `static ${k}`, name: v.as as string }])),
  ...Object.entries(LIVE_KNOWN).map(([k, v]) => ({ where: `live ${k}`, name: v.note })),
  ...[...table.notes, ...table.excluded]
    .filter((e) => !NOT_ON_THIS_BRANCH.includes(e.note))
    .map((e) => ({ where: `calibration.json ${'n' in e ? `#${e.n}` : 'excluded'}`, name: `bug:${e.note}` })),
];

/** The residuals calibration.json records, by note number: the decision is its status (`residual:<what>`). */
const residualNotes = new Map(table.notes.filter((e) => e.status.startsWith('residual:')).map((e) => [e.n, e.status]));

/** The numbered items of an ADR's "Residuals accepted" section (docs/adr/<nnnn>-*.md), or undefined: no such ADR. */
function adrResiduals(adr: string): Set<number> | undefined {
  const file = readdirSync(`${ROOT}docs/adr`).find((f) => f.startsWith(`${adr}-`));
  if (file === undefined) return undefined;
  const text = readFileSync(`${ROOT}docs/adr/${file}`, 'utf8');
  const section = /^## Residuals accepted\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return new Set([...section.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])));
}

/**
 * Why a `residual:` is not one this repo records, or undefined. Two forms: a calibration.json residual's status
 * verbatim (`residual:accepted (round 13: …)`, the decision that note records), or an ADR's numbered residual —
 * `residual:ADR <nnnn> residual <k> — <what>`, optionally ending `(calibration.json #<n>)` where a calibration note
 * records the same residual (that note's status must then be a residual).
 */
function residualProblem(name: string): string | undefined {
  if ([...residualNotes.values()].includes(name)) return undefined;
  const m = /^residual:ADR (\d{4}) residual (\d+) — \S.*?(?: \(calibration\.json #(\w+)\))?$/.exec(name);
  if (m === null) return 'neither a calibration.json residual status nor `ADR <nnnn> residual <k> — <what>`';
  const [, adr, k, n] = m;
  const residuals = adrResiduals(adr);
  if (residuals === undefined) return `no docs/adr/${adr}-*.md`;
  if (!residuals.has(Number(k))) return `ADR ${adr} lists no residual ${k}`;
  if (n !== undefined && !residualNotes.has(n)) return `calibration.json #${n} is no residual note`;
  return undefined;
}

describe('every note a lab ratchet names is filed', () => {
  it('a `bug:` names a file of docs/bugs; a `residual:` a decision recorded (calibration.json, an ADR\'s residuals); nothing else', () => {
    const bad = named.flatMap(({ where, name }) => {
      if (name.startsWith('bug:')) return existsSync(`${ROOT}docs/bugs/${name.slice(4)}`) ? [] : [`${where}: no docs/bugs/${name.slice(4)}`];
      if (!name.startsWith('residual:')) return [`${where}: ${name}: neither bug: nor residual:`];
      const problem = residualProblem(name);
      return problem === undefined ? [] : [`${where}: ${name}: ${problem}`];
    });
    expect(bad).toEqual([]);
  });

  it('the residual forms: what is recognised and what is not', () => {
    for (const ok of ['residual:accepted (round 13: the FAB host layer is a cover)', 'residual:ADR 0018 residual 9 — an in-window overlay with no node is not seen (calibration.json #31)', 'residual:ADR 0018 residual 6 — anything'])
      expect(residualProblem(ok), ok).toBeUndefined();
    for (const bad of ['residual:accepted (round 13)', 'residual:ADR 0018 residual 99 — no such', 'residual:ADR 9999 residual 1 — no such ADR', 'residual:ADR 0018 residual 9 — x (calibration.json #1)', 'residual:ADR 0018 residual 9', 'residual:'])
      expect(residualProblem(bad), bad).toBeDefined();
  });
});

describe('calibration.json ↔ the KNOWN rows', () => {
  it('the notes calibration.json lists that this branch has not got: exactly NOT_ON_THIS_BRANCH, none open', () => {
    const listed = [...table.notes, ...table.excluded];
    expect(listed.map((e) => e.note).filter((f) => !existsSync(`${ROOT}docs/bugs/${f}`)).sort()).toEqual([...NOT_ON_THIS_BRANCH].sort());
    expect(table.notes.filter((e) => NOT_ON_THIS_BRANCH.includes(e.note) && expected(e) === 'OPEN-RED').map((e) => e.n)).toEqual([]);
  });

  it('every note expected OPEN-RED has rows, each a static KNOWN row filed as that note', () => {
    const open = table.notes.filter((e) => expected(e) === 'OPEN-RED');
    expect(open.length).toBeGreaterThan(0);
    const bad = open.flatMap((e) => {
      if ((e.checks ?? []).length === 0) return [`#${e.n}: no rows`];
      return e.checks!.flatMap((k) => {
        const row = KNOWN[k];
        if (row === undefined) return [`#${e.n}: ${k} is no KNOWN row`];
        return row.as === `bug:${e.note}` ? [] : [`#${e.n}: ${k} is filed as ${row.as ?? 'nothing'}`];
      });
    });
    expect(bad).toEqual([]);
  });

  it('every `bug:` a KNOWN row (static or live) is filed as is an open note of calibration.json, or live-only and excluded there', () => {
    const open = new Set(table.notes.filter((e) => expected(e) === 'OPEN-RED').map((e) => e.note));
    const bad = named
      .filter(({ where, name }) => !where.startsWith('calibration.json') && name.startsWith('bug:'))
      .flatMap(({ where, name }) => (open.has(name.slice(4)) || LIVE_ONLY[name.slice(4)] !== undefined ? [] : [`${where}: ${name} is no open note of calibration.json`]));
    expect(bad).toEqual([]);
  });

  it('each live-only exemption is excluded from calibration.json and filed by a live KNOWN entry — no static row, no stale exemption', () => {
    const excluded = new Set(table.excluded.map((e) => e.note));
    const live = new Set(Object.values(LIVE_KNOWN).map((e) => e.note));
    const statics = new Set(Object.values(KNOWN).map((v) => v.as));
    const bad = Object.keys(LIVE_ONLY).flatMap((f) => [
      ...(excluded.has(f) ? [] : [`${f}: not excluded in calibration.json`]),
      ...(live.has(`bug:${f}`) ? [] : [`${f}: no live KNOWN entry files it`]),
      ...(statics.has(`bug:${f}`) ? [`${f}: a static row files it — a replayed row calibrates it`] : []),
    ]);
    expect(bad).toEqual([]);
  });
});
