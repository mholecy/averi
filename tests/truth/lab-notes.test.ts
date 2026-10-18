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
//      the live-only notes below, each excluded from the calibration with its reason, the live cases of a note
//      calibrated on the replay that still await a live record at its fix (AWAITING_LIVE, below, case by case), and a
//      static row or live entry a note calibrated PARTIALLY lists as left open (its `open` by row, its `openLive` by
//      case: `partiallyOpen`, `partiallyOpenLive`, below).
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
  '2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md': "LV3: the turned stroke's touch-down, live only (idb: fixed under WDA)",
  '2026-10-17-lab-ios-scroll-until-never-turns-toward-a-target-past-the-far-edge-when-no-stroke-moved-the-list.md': 'LV4: no turn after strokes that moved nothing, live only (a replayed tree never moves)',
  '2026-10-18-lab-ios-wda-scrolled-tables-parked-row-text-reads-above-the-screen.md': "LV6: a scrolled table's parked rows, live only (the golden captures at rest)",
  '2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md': 'a fling in a lazy list: scroll dynamics, live only',
};

/**
 * The live KNOWN entries (by their case, `<platform> <source> <case id>`) of notes calibrated on the replay
 * (calibration.json `calibrate`, their static rows struck off) that stand until the device check: the committed live
 * record is an older src's, whose replies `--rejudge` reads as they were, so these cases still fail there by their
 * rule; struck off — with their line here — once a live record at the fix reads them ok (live.ts then exits 1 on each,
 * as for any fixed case). Keyed by CASE, not by note: an entry filed under one of these notes later, for a case not
 * listed here, is held to the note being open like any other. Empty since round 5's device check (ios-vis.json at
 * b71cbbb's src): LE4's and L3's cases read ok there and were struck off, but LE4's two cases of F, refiled as LV4 and
 * LV5 (LIVE_ONLY, above).
 */
const AWAITING_LIVE: Readonly<Record<string, { note: string; why: string }>> = {};

/**
 * Notes calibration.json lists that are not committed on this branch: fixed notes (calibrated, or a residual, or
 * excluded). Empty since the 31 notes that sat untracked in the main checkout were committed (83059cb,
 * docs/device-checks-r5-r20, merged here). calibrate.ts reads no note's text, only its rows; a note listed here may not
 * be open or be named by a KNOWN row (checked below), and a note that lands here must be struck off this list.
 */
const NOT_ON_THIS_BRANCH: readonly string[] = [];

/**
 * A static KNOWN row (`key`) may stay filed as a note calibrated PARTIALLY — calibration.json `calibrate` with a
 * `partial` saying what of the note its fix covers — only when that note's `open` lists the row: the part `partial`
 * leaves open, red until a fix or a decision of the owner's (L1: its fix marks the AlertDialog and the half-expanded
 * sheet; form-picker's fully expanded sheet stays open, round 6's code review P1). Keyed by ROW, as AWAITING_LIVE is
 * by case: a row filed as a partial note that its `open` does not list is held to the note being open like any other.
 * Round 6 extended the rule for it: an open note expects every row red (OPEN-RED), a calibrated one every row green
 * after its fix, and neither says "calibrated, some rows still open".
 */
const partiallyOpen = (note: string, key: string): boolean =>
  table.notes.some((e) => e.note === note && e.status === 'calibrate' && e.partial !== undefined && (e.open ?? []).includes(key));

/**
 * The same for a live KNOWN entry (`key`, `<platform> <source> <case id>`): it may stay filed as a note calibrated
 * PARTIALLY only when that note's `openLive` lists it (#10: the replayed rows calibrated, the default direction's turn
 * on uiautomator left to the owner by ADR 0021 — the live case `turn:scroll-collapsing.A`, measured red at the fix's
 * src and at round 6's, docs/truth/live-android-2026-10-18-visibility.md).
 */
const partiallyOpenLive = (note: string, key: string): boolean =>
  table.notes.some((e) => e.note === note && e.status === 'calibrate' && e.partial !== undefined && (e.openLive ?? []).includes(key));

/** Rule 3 over `entries` (every place a note is named, `named`): each `bug:` of a KNOWN row that is filed where it may not be. */
function misfiled(entries: readonly { where: string; name: string }[]): string[] {
  const open = new Set(table.notes.filter((e) => expected(e) === 'OPEN-RED').map((e) => e.note));
  return entries
    .filter(({ where, name }) => !where.startsWith('calibration.json') && name.startsWith('bug:'))
    .filter(({ where, name }) => !(where.startsWith('live ') && AWAITING_LIVE[where.slice('live '.length)]?.note === name.slice(4)))
    .filter(({ where, name }) => !(where.startsWith('static ') && partiallyOpen(name.slice(4), where.slice('static '.length))))
    .filter(({ where, name }) => !(where.startsWith('live ') && partiallyOpenLive(name.slice(4), where.slice('live '.length))))
    .flatMap(({ where, name }) => (open.has(name.slice(4)) || LIVE_ONLY[name.slice(4)] !== undefined ? [] : [`${where}: ${name} is no open note of calibration.json`]));
}

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
  it('each row a partial calibration leaves open (`open`) is a static KNOWN row filed as that note, none of the rows it calibrates, on a note with a `partial`', () => {
    const bad = table.notes.flatMap((e) =>
      (e.open ?? []).flatMap((k) => [
        ...(e.status === 'calibrate' && e.partial !== undefined ? [] : [`#${e.n}: \`open\` without a partial calibration`]),
        ...(KNOWN[k] === undefined ? [`#${e.n}: ${k} is no KNOWN row`] : KNOWN[k].as === `bug:${e.note}` ? [] : [`#${e.n}: ${k} is filed as ${KNOWN[k].as ?? 'nothing'}`]),
        ...((e.checks ?? []).includes(k) ? [`#${e.n}: ${k} is one of the rows it calibrates`] : []),
      ]),
    );
    expect(bad).toEqual([]);
    expect(table.notes.find((e) => e.n === 'L1')?.open).toHaveLength(6);
  });

  it('each live entry a partial calibration leaves open (`openLive`) is a live KNOWN entry filed as that note, on a note with a `partial`', () => {
    const bad = table.notes.flatMap((e) =>
      (e.openLive ?? []).flatMap((k) => [
        ...(e.status === 'calibrate' && e.partial !== undefined ? [] : [`#${e.n}: \`openLive\` without a partial calibration`]),
        ...(LIVE_KNOWN[k] === undefined ? [`#${e.n}: ${k} is no live KNOWN entry`] : LIVE_KNOWN[k].note === `bug:${e.note}` ? [] : [`#${e.n}: ${k} is filed as ${LIVE_KNOWN[k].note}`]),
      ]),
    );
    expect(bad).toEqual([]);
  });

  it('a live entry filed as a partially calibrated note that its `openLive` does not list is misfiled — keyed by case, not by note', () => {
    const ten = table.notes.find((e) => e.n === '10')!;
    expect(misfiled([{ where: 'live android uiautomator turn:scroll-collapsing.A', name: `bug:${ten.note}` }])).toEqual([]);
    // another case of the same note, and the listed case under another source: neither is listed, both misfiled
    expect(misfiled([{ where: 'live android uiautomator scroll:scroll-collapsing.A', name: `bug:${ten.note}` }])).toHaveLength(1);
    expect(misfiled([{ where: 'live ios wda turn:scroll-collapsing.A', name: `bug:${ten.note}` }])).toHaveLength(1);
  });

  it('a row filed as a partially calibrated note that its `open` does not list is misfiled — fab.xml\'s L and K refiled as #2 or as L1', () => {
    const noteOf = (n: string) => table.notes.find((e) => e.n === n)!.note;
    const refiled = [
      { where: 'static android-averi_lab-api33/fab.xml L tap', name: `bug:${noteOf('2')}` },
      { where: 'static android-averi_lab-api33/fab.xml K tap', name: `bug:${noteOf('L1')}` },
    ];
    expect(misfiled(refiled)).toHaveLength(2);
    expect(misfiled([{ where: 'static android-averi_lab-api33/form-picker.xml name tap', name: `bug:${noteOf('L1')}` }])).toEqual([]);
  });

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

  it('every `bug:` a KNOWN row (static or live) is filed as is an open note of calibration.json, or live-only and excluded there, or a live entry awaiting its live record, or a static row or live entry a partial calibration leaves open', () => {
    expect(misfiled(named)).toEqual([]);
  });

  it('each live case awaiting its live record is a live KNOWN entry filed as its note, a note calibrated in calibration.json — no static row, no stale exemption', () => {
    const calibrated = new Set(table.notes.filter((e) => e.status === 'calibrate').map((e) => e.note));
    const statics = new Set(Object.values(KNOWN).map((v) => v.as));
    const bad = Object.entries(AWAITING_LIVE).flatMap(([key, { note }]) => [
      ...(LIVE_KNOWN[key] === undefined ? [`${key}: no live KNOWN entry — strike the exemption off`] : []),
      ...(LIVE_KNOWN[key] !== undefined && LIVE_KNOWN[key].note !== `bug:${note}` ? [`${key}: filed as ${LIVE_KNOWN[key].note}, not ${note}`] : []),
      ...(calibrated.has(note) ? [] : [`${key}: ${note} is not calibrated in calibration.json`]),
      ...(statics.has(`bug:${note}`) ? [`${key}: a static row files ${note} — the replay still reads it red`] : []),
    ]);
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
