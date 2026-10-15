import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import { loadCorpus, type Recording } from '../../scripts/differential/corpus.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { goldenRecording, type GoldenResult } from '../../scripts/differential/golden.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';

// The golden mode over the committed ground truth (tests/fixtures/truth, captured from the lab app by
// scripts/truth/capture.ts): each verb's answer against what the truth implies, no device. The mismatches this
// checkout is known to have are listed in KNOWN — a ratchet: one fixed fails this test until it is struck off, and a
// new one fails it until it is fixed or listed with its note.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TRUTH = fileURLToPath(new URL('../fixtures/truth/', import.meta.url));

const KNOWN: Record<string, string> = {
  // docs/bugs/2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md — the alert's dim, a bare
  // childless layer, is no cover. Target C lies under the alert card and is refused.
  ...Object.fromEntries(
    ['A', 'B', 'D'].flatMap((t) => ['tap', 'colour', 'scroll_until'].map((v) => [`alert-dim.wda.json ${t} ${v}`, 'r18 alert dim'])),
  ),
  // idb lists only the presented layer: a target beneath it is not in the tree. The tap answers "not found" (no false
  // Tapped, but no "close it first"), and scroll_until swipes twice beneath the presented layer looking for it.
  ...Object.fromEntries(
    [
      ['alert-dim', ['A', 'B', 'C', 'D']],
      ['sheet-medium', ['A', 'B', 'C', 'D']],
      // The form beneath the country picker sheet: the same class, a form's fields and its submit.
      ['form-picker', ['name', 'country', 'submit']],
    ].flatMap(([cell, tags]) => (tags as string[]).flatMap((t) => ['tap', 'scroll_until'].map((v) => [`${cell as string}.idb.json ${t} ${v}`, 'idb: beneath a presented layer is not in the tree']))),
  ),
  // LAB FINDING, docs/bugs/2026-10-15-lab-android-scroll-until-strokes-the-presented-layer-over-its-target.md —
  // uiautomator dumps the active window only, so beneath an AlertDialog or a ModalBottomSheet the targets are not in
  // the tree, as on idb. The tap waits 5 s "to appear" (no false Tapped, no "close it first"); scroll_until strokes
  // 1776 → 444 twice, and on the device that stroke dismisses the dialog (it lands on its dim) or expands the sheet.
  ...Object.fromEntries(
    ['alert-dim', 'sheet-medium'].flatMap((cell) =>
      ['A', 'B', 'C', 'D'].flatMap((t) => [
        [`${cell}.xml ${t} tap`, 'lab finding: uiautomator lists only the presented window; tap times out without "close it first"'],
        [`${cell}.xml ${t} scroll_until`, 'lab finding: scroll_until strokes the presented layer (dismisses the dialog / expands the sheet)'],
      ]),
    ),
  ),
};

let side: Side;
let corpus: Recording[];
beforeAll(async () => {
  installFakeDevice();
  installVirtualClock();
  side = await loadSide(ROOT);
  corpus = await loadCorpus(TRUTH);
});

describe('golden over the lab app truth', { timeout: 120_000 }, () => {
  it('every truth is consistent and every verb answers as the truth implies, but for the known mismatches', async () => {
    const results: GoldenResult[] = [];
    for (const r of corpus) results.push(await goldenRecording(r, side));
    expect(results.flatMap((r) => r.broken.map((b) => `${r.recording} ${b}`))).toEqual([]);
    const checks = results.flatMap((r) => r.checks);
    expect(checks.length).toBeGreaterThan(180);
    const mismatches = checks.filter((c) => c.mismatch !== undefined).map((c) => `${c.recording.split('/')[1]} ${c.target} ${c.verb}`).sort();
    expect(mismatches).toEqual(Object.keys(KNOWN).sort());
  });
});
