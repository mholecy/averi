import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import { loadCorpus, type Recording } from '../../scripts/differential/corpus.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { goldenRecording, type GoldenCheck, type GoldenResult } from '../../scripts/differential/golden.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';

// The golden mode over the committed ground truth (tests/fixtures/truth, captured from the lab apps by
// scripts/truth/capture.ts and capture-android.ts): each verb's answer against what the truth implies, no device. The
// mismatches this checkout is known to have are listed in KNOWN — a ratchet (docs/adr/0020): one fixed fails this test
// until it is struck off, and a new one fails it until it is fixed or listed with its note.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TRUTH = fileURLToPath(new URL('../fixtures/truth/', import.meta.url));

const IOS = 'ios-iphone17-ios27';
const ANDROID = 'android-averi_lab-api33';
/** A note whose class is "the target is not in the tree": its mismatch must say so first (golden-spec.ts#notInTree). */
const NOT_IN_TREE = 'not in the tree';
const keys = (file: string, tags: readonly string[], verbs: readonly string[], note: string) => tags.flatMap((t) => verbs.map((v) => [`${file} ${t} ${v}`, note] as const));

const KNOWN: Record<string, string> = Object.fromEntries([
  // alert-dim.wda.json — the round-18 bug (the alert's dim, a bare childless layer, was no cover: A, B, D answered
  // Tapped, passed the colour on the dim, and scroll_until called them fully visible) went green with round 19's alert
  // fix, merged into this branch with arch/round-20 at 8600176: all 12 rows now answer "close it first". Struck off.
  // idb lists only the presented layer: a target beneath it is not in the tree. The tap answers "not found" (no false
  // Tapped, but no "close it first"), the colour assert fails "not found" (no evidence either way), and scroll_until
  // swipes twice beneath the presented layer looking for it.
  ...keys(`${IOS}/alert-dim.idb.json`, ['A', 'B', 'C', 'D'], ['tap', 'colour', 'scroll_until'], `${NOT_IN_TREE}: idb lists only the presented layer`),
  ...keys(`${IOS}/sheet-medium.idb.json`, ['A', 'B', 'C', 'D'], ['tap', 'colour', 'scroll_until'], `${NOT_IN_TREE}: idb lists only the presented layer`),
  // The form beneath the country picker sheet: the same class, a form's fields and its submit.
  ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['tap', 'scroll_until'], `${NOT_IN_TREE}: idb lists only the presented layer`),
  // idb lists nothing under the keyboard (src/mcp/tools.ts, tap: "a covered node was absent from idb's tree and the tap
  // timed out waiting for it to appear"): the tap answers "not found" — no false Tapped, but no keyboard advice; and
  // scroll_until swipes above the keyboard and stops "never appeared in the tree" — its touch-downs are right, but a
  // replayed tree cannot show whether the swipes would bring the field out, so the reply is no evidence (classed).
  ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['tap', 'scroll_until'], `${NOT_IN_TREE}: idb lists nothing under the keyboard`),
  // LAB FINDING, docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md — under idb
  // the submit pinned in the bottom safe-area inset, over the phone field's centre, is no cover: tap answers Tapped and
  // sends `idb ui tap 201 547`, which submits the form; scroll_until calls it fully visible after 0 swipes.
  ...keys(`${IOS}/form-keyboard.idb.json`, ['phone'], ['tap', 'scroll_until'], 'lab finding: idb reads the pinned submit bar as no cover — the tap submits the form'),
  // LAB FINDING, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
  // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
  // the tree, as on idb. The tap waits 5 s "to appear" (no false Tapped, no "close it first"); the colour assert fails
  // "not found"; scroll_until strokes 1776 → 444 twice, and on the device that stroke dismisses the dialog (it lands on
  // its dim) or expands the sheet.
  ...['alert-dim', 'sheet-medium'].flatMap((cell) => [
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['tap'], `${NOT_IN_TREE} — lab finding: uiautomator lists only the presented window; tap times out without "close it first"`),
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['colour'], `${NOT_IN_TREE} — lab finding: uiautomator lists only the presented window; the assert fails "not found"`),
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['scroll_until'], `${NOT_IN_TREE} — lab finding: scroll_until strokes the presented layer (dismisses the dialog / expands the sheet)`),
  ]),
]);

/** The checks per capture: the spec's rows for each truth, pinned so a row that silently stops being asked fails here. */
const COUNTS: Record<string, number> = {
  [`${ANDROID}/alert-dim.xml`]: 12,
  [`${ANDROID}/open.xml`]: 12,
  [`${ANDROID}/sheet-medium.xml`]: 15,
  [`${IOS}/alert-dim.idb.json`]: 12,
  [`${IOS}/alert-dim.wda.json`]: 12,
  [`${IOS}/form-basic.idb.json`]: 11,
  [`${IOS}/form-basic.wda.json`]: 11,
  [`${IOS}/form-errors.idb.json`]: 12,
  [`${IOS}/form-errors.wda.json`]: 12,
  [`${IOS}/form-keyboard.idb.json`]: 17,
  [`${IOS}/form-keyboard.wda.json`]: 17,
  [`${IOS}/form-picker.idb.json`]: 9,
  [`${IOS}/form-picker.wda.json`]: 9,
  [`${IOS}/form-prefilled.idb.json`]: 11,
  [`${IOS}/form-prefilled.wda.json`]: 11,
  [`${IOS}/open.idb.json`]: 12,
  [`${IOS}/open.wda.json`]: 12,
  [`${IOS}/sheet-medium.idb.json`]: 15,
  [`${IOS}/sheet-medium.wda.json`]: 15,
};

const key = (c: GoldenCheck) => `${c.recording} ${c.target} ${c.verb}`;

let side: Side;
let corpus: Recording[];
let results: GoldenResult[];
beforeAll(async () => {
  installFakeDevice();
  installVirtualClock();
  side = await loadSide(ROOT);
  corpus = await loadCorpus(TRUTH);
  results = [];
  for (const r of corpus) results.push(await goldenRecording(r, side));
}, 120_000);

describe('golden over the lab app truth', () => {
  it('every truth is consistent: the probe reached the app, and its sources tell one story', () => {
    expect(results.flatMap((r) => r.broken.map((b) => `${r.recording} ${b}`))).toEqual([]);
  });

  it('asks every capture its rows', () => {
    expect(Object.fromEntries(results.map((r) => [r.recording, r.checks.length]))).toEqual(COUNTS);
  });

  it('no known mismatch is fixed without being struck off KNOWN', () => {
    const mismatches = new Set(results.flatMap((r) => r.checks).filter((c) => c.mismatch !== undefined).map(key));
    const fixed = Object.keys(KNOWN).filter((k) => !mismatches.has(k)).map((k) => `${k} — ${KNOWN[k]}`);
    expect(fixed).toEqual([]);
  });

  it('every mismatch is known', () => {
    const fresh = results
      .flatMap((r) => r.checks)
      .filter((c) => c.mismatch !== undefined && !Object.hasOwn(KNOWN, key(c)))
      .map((c) => `${key(c)} — expected ${c.says} — ${c.mismatch}`);
    expect(fresh).toEqual([]);
  });

  it('a known mismatch noted "not in the tree" is one the judge classes so, and no other is', () => {
    const misclassed = results
      .flatMap((r) => r.checks)
      .filter((c) => c.mismatch !== undefined && Object.hasOwn(KNOWN, key(c)) && KNOWN[key(c)].startsWith(NOT_IN_TREE) !== c.mismatch.startsWith(`${NOT_IN_TREE}:`))
      .map((c) => `${key(c)} — note: ${KNOWN[key(c)]} — judged: ${c.mismatch}`);
    expect(misclassed).toEqual([]);
  });
});
