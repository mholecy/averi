import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import { loadCorpus, type Recording } from '../../scripts/differential/corpus.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { cellOf, goldenRecording, ocrAvailability, type GoldenResult } from '../../scripts/differential/golden.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';
import { familyOf, loadCatalog } from '../../scripts/truth/catalog.js';
import { captureOf, keyOf as key } from '../../scripts/truth/side-run.js';
import { FAMILIES } from '../../scripts/truth/schema.js';
import { COUNTS, KNOWN, KNOWN_FILES as FILES } from './golden/files.js';
import type { KnownFile } from './golden/known.js';

// The golden mode over the committed ground truth (tests/fixtures/truth, captured from the lab apps by
// scripts/truth/capture.ts and capture-android.ts): each verb's answer against what the truth implies, no device. The
// mismatches this checkout is known to have are listed in KNOWN — one file per cell family,
// tests/differential/golden/<family>.known.ts, aggregated here — a ratchet (docs/adr/0020): one fixed fails this test
// until it is struck off, and a new one fails it until it is fixed or listed with its note. A known mismatch is pinned
// by what the reply DID: its class (what the judge's reason says first — golden-spec/judges.ts#classed: the judge's own
// reason where it rejects the reply, `not in the tree` only where it would accept a reply that is no evidence), its
// kind (scripts/truth/replies.ts#replyKind: not found, Tapped, visible, PASS, FAIL, refused, other) and the taps and
// swipes the device was sent. A known row that changes any of them — a stroke moved under the keyboard, a swipe fewer,
// a timeout turned into a refusal with the wrong remedy, a stop turned into `fully visible` — fails here, though it
// still mismatches.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TRUTH = fileURLToPath(new URL('../fixtures/truth/', import.meta.url));

// Whether the `ocr` rows are asked on this host (golden.ts#ocrAvailability: the harness's own probe): undefined, or why
// not — not macOS, no swiftc, Vision refusing with nilError (a sandbox). A skip shows as a skipped test below; with
// GOLDEN_OCR=require it is an error instead (ocrAvailability throws), so a run that must judge them cannot pass without.
const noOcr = await ocrAvailability();

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

describe('the ratchet\'s files', () => {
  it('one per family; each files the rows and counts of its own cells only, none twice', async () => {
    const catalog = await loadCatalog();
    expect(FILES.map((f) => f.family)).toEqual([...FAMILIES]);
    const misfiled = FILES.flatMap((f) =>
      [...Object.keys(f.known), ...Object.keys(f.counts)].flatMap((k) => {
        const file = captureOf(k).split('/').pop()!;
        const family = familyOf(catalog, cellOf({ file }));
        return family === f.family ? [] : [`${f.family}: ${k} (cell of ${family ?? 'no family'})`];
      }),
    );
    expect(misfiled).toEqual([]);
    const twice = (pick: (f: KnownFile) => object) => FILES.flatMap((f) => Object.keys(pick(f))).filter((k, i, all) => all.indexOf(k) !== i);
    expect([...twice((f) => f.known), ...twice((f) => f.counts)]).toEqual([]);
  });

  // What a row is filed as (`as`: a bug note, a residual) is checked against docs/bugs and calibration.json with the
  // live KNOWN's notes, in tests/truth/lab-notes.test.ts.
});

describe('golden over the lab app truth', () => {
  it('every truth is consistent: the probe reached the app, and its sources tell one story', () => {
    expect(results.flatMap((r) => r.broken.map((b) => `${r.recording} ${b}`))).toEqual([]);
  });

  it('asks every capture its rows', () => {
    expect(Object.fromEntries(results.map((r) => [r.recording, r.checks.length]))).toEqual(COUNTS);
  });

  it('no known mismatch is fixed without being struck off KNOWN', () => {
    const mismatches = new Set(results.flatMap((r) => r.checks).filter((c) => c.mismatch !== undefined).map(key));
    // An `ocr` row skipped on a host with no working recognizer (golden.ts#ocrAvailability) was not asked: its KNOWN
    // entry is held where it is.
    const skipped = new Set(results.flatMap((r) => r.checks).filter((c) => c.skipped !== undefined).map(key));
    const fixed = Object.keys(KNOWN).filter((k) => !mismatches.has(k) && !skipped.has(k)).map((k) => `${k} — ${KNOWN[k].note}`);
    expect(fixed).toEqual([]);
  });

  it.skipIf(noOcr !== undefined)('the ocr rows are asked (the host\'s recognizer reads the screenshots)', () => {
    const ocr = results.flatMap((r) => r.checks).filter((c) => c.verb === 'ocr');
    expect(ocr.length).toBeGreaterThan(0);
    expect(ocr.filter((c) => c.skipped !== undefined).map(key)).toEqual([]);
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
