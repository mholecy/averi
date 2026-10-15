import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import { loadCorpus, type Recording } from '../../scripts/differential/corpus.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { goldenRecording, type GoldenCheck, type GoldenResult } from '../../scripts/differential/golden.js';
import type { ReplyKind } from '../../scripts/differential/golden-spec.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';

// The golden mode over the committed ground truth (tests/fixtures/truth, captured from the lab apps by
// scripts/truth/capture.ts and capture-android.ts): each verb's answer against what the truth implies, no device. The
// mismatches this checkout is known to have are listed in KNOWN — a ratchet (docs/adr/0020): one fixed fails this test
// until it is struck off, and a new one fails it until it is fixed or listed with its note. A known mismatch is pinned
// by what the reply DID: its class (what the judge's reason says first — golden-spec.ts#classed: the judge's own
// reason where it rejects the reply, `not in the tree` only where it would accept a reply that is no evidence), its
// kind (golden-spec.ts#replyKind: not found, Tapped, visible, PASS, FAIL, refused, other) and the taps and swipes the
// device was sent. A known row that changes any of them — a stroke moved under the keyboard, a swipe fewer, a timeout
// turned into a refusal with the wrong remedy, a stop turned into `fully visible` — fails here, though it still
// mismatches.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TRUTH = fileURLToPath(new URL('../fixtures/truth/', import.meta.url));

const IOS = 'ios-iphone17-ios27';
const ANDROID = 'android-averi_lab-api33';

interface Known {
  /** What the mismatch says first, up to its `: ` — the judge's reason, or `not in the tree` (vacuous). */
  cls: string;
  /** What kind of reply it is (GoldenCheck.kind, golden-spec.ts#replyKind): a timeout turned refusal fails here. */
  kind: ReplyKind;
  /** The taps and swipes the device was sent (GoldenCheck.calls), in order. */
  calls: readonly string[];
  note: string;
}
const keys = (file: string, tags: readonly string[], verbs: readonly string[], cls: string, kind: ReplyKind, calls: readonly string[], note: string) =>
  tags.flatMap((t) => verbs.map((v) => [`${file} ${t} ${v}`, { cls, kind, calls, note }] as const));

const NOT_IN_TREE = 'not in the tree';
const NO_CLOSE_IT_FIRST = 'refused without "close it first"';
const twice = (swipe: string) => [swipe, swipe];
/** idb's scroll_until stroke on a 402x874 screen: from 80 % to 20 % of it. */
const IDB_STROKE = 'idb ui swipe 201 699 201 175 --duration 0.3';
/** The same stroke above the keyboard (its top at y 573): touching down at 472. */
const IDB_STROKE_ABOVE_KEYBOARD = 'idb ui swipe 201 472 201 118 --duration 0.3';
const ADB_STROKE = 'adb shell input swipe 540 1776 540 444 1334';

const KNOWN: Record<string, Known> = Object.fromEntries([
  // alert-dim.wda.json — the round-18 bug (the alert's dim, a bare childless layer, was no cover: A, B, D answered
  // Tapped, passed the colour on the dim, and scroll_until called them fully visible) went green with round 19's alert
  // fix, merged into this branch with arch/round-20 at 8600176: all 12 rows now answer "close it first". Struck off.
  // idb lists only the presented layer: a target beneath it is not in the tree. The tap times out "to appear" — no
  // false Tapped, but no "close it first"; the colour assert fails "not found" (no evidence either way: vacuous); and
  // scroll_until swipes twice beneath the presented layer looking for it.
  ...['alert-dim', 'sheet-medium'].flatMap((cell) => [
    ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['tap'], NO_CLOSE_IT_FIRST, 'not found', [], 'idb lists only the presented layer: the tap times out'),
    ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['colour'], NOT_IN_TREE, 'not found', [], 'idb lists only the presented layer'),
    ...keys(`${IOS}/${cell}.idb.json`, ['A', 'B', 'C', 'D'], ['scroll_until'], 'swiped 2× beneath a presented layer', 'not found', twice(IDB_STROKE), 'idb lists only the presented layer: scroll_until swipes twice beneath it'),
  ]),
  // The form beneath the country picker sheet: the same, a form's fields and its submit.
  ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['tap'], NO_CLOSE_IT_FIRST, 'not found', [], 'idb lists only the presented sheet: the tap times out'),
  ...keys(`${IOS}/form-picker.idb.json`, ['name', 'country', 'submit'], ['scroll_until'], 'swiped 2× beneath the sheet', 'not found', twice(IDB_STROKE), 'idb lists only the presented sheet: scroll_until swipes twice beneath it'),
  // idb lists nothing under the keyboard (src/mcp/tools.ts, tap: "a covered node was absent from idb's tree and the tap
  // timed out waiting for it to appear"): the tap times out — no false Tapped, but no keyboard advice; scroll_until
  // swipes twice ABOVE the keyboard (pinned: a stroke moved under it fails here) and stops "never appeared in the tree"
  // — its touch-downs are right, but a replayed tree cannot show whether they would bring the field out (vacuous).
  ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['tap'], 'refused without naming the keyboard', 'not found', [], 'idb lists nothing under the keyboard: the tap times out'),
  ...keys(`${IOS}/form-keyboard.idb.json`, ['vs', 'ks', 'ss', 'note'], ['scroll_until'], NOT_IN_TREE, 'not found', twice(IDB_STROKE_ABOVE_KEYBOARD), 'idb lists nothing under the keyboard'),
  // LAB FINDING, docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md — under idb
  // the submit pinned in the bottom safe-area inset, over the phone field's centre, is no cover: tap answers Tapped and
  // sends `idb ui tap 201 547`, which submits the form; scroll_until calls it fully visible after 0 swipes.
  ...keys(`${IOS}/form-keyboard.idb.json`, ['phone'], ['tap'], 'Tapped', 'Tapped', ['idb ui tap 201 547'], 'lab finding: idb reads the pinned submit bar as no cover — the tap submits the form'),
  ...keys(`${IOS}/form-keyboard.idb.json`, ['phone'], ['scroll_until'], 'reached with no swipe where a tap fires submit invalid', 'visible', [], 'lab finding: idb reads the pinned submit bar as no cover'),
  // LAB FINDING, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
  // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
  // the tree, as on idb. The tap waits 5 s "to appear" (no false Tapped, no "close it first"); the colour assert fails
  // "not found" (vacuous); scroll_until strokes 1776 → 444 twice, and on the device that stroke dismisses the dialog
  // (it lands on its dim) or expands the sheet.
  ...['alert-dim', 'sheet-medium'].flatMap((cell) => [
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['tap'], NO_CLOSE_IT_FIRST, 'not found', [], 'lab finding: uiautomator lists only the presented window; the tap times out'),
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['colour'], NOT_IN_TREE, 'not found', [], 'lab finding: uiautomator lists only the presented window'),
    ...keys(`${ANDROID}/${cell}.xml`, ['A', 'B', 'C', 'D'], ['scroll_until'], 'swiped 2× beneath a presented layer', 'not found', twice(ADB_STROKE), 'lab finding: strokes beneath the presented layer (dismisses the dialog / expands the sheet)'),
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
    const fixed = Object.keys(KNOWN).filter((k) => !mismatches.has(k)).map((k) => `${k} — ${KNOWN[k].note}`);
    expect(fixed).toEqual([]);
  });

  it('every mismatch is known', () => {
    const fresh = results
      .flatMap((r) => r.checks)
      .filter((c) => c.mismatch !== undefined && !Object.hasOwn(KNOWN, key(c)))
      .map((c) => `${key(c)} — expected ${c.says} — ${c.mismatch}`);
    expect(fresh).toEqual([]);
  });

  it('a known mismatch is of its noted class and reply kind, and sends the device what it is noted to', () => {
    const changed = results
      .flatMap((r) => r.checks)
      .filter((c) => c.mismatch !== undefined && Object.hasOwn(KNOWN, key(c)))
      .flatMap((c) => {
        const k = KNOWN[key(c)];
        const cls = c.mismatch!.startsWith(`${k.cls}: `) ? [] : [`${key(c)} — noted ${k.cls} — judged: ${c.mismatch}`];
        const kind = c.kind === k.kind ? [] : [`${key(c)} — noted a ${k.kind} reply — got ${c.kind}: ${c.reply.split('\n')[0]}`];
        const calls = JSON.stringify(c.calls) === JSON.stringify(k.calls) ? [] : [`${key(c)} — noted ${JSON.stringify(k.calls)} — sent ${JSON.stringify(c.calls)}`];
        return [...cls, ...kind, ...calls];
      });
    expect(changed).toEqual([]);
  });
});
