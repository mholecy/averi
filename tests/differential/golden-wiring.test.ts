import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import { loadCorpus } from '../../scripts/differential/corpus.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { goldenRecording, type GoldenResult } from '../../scripts/differential/golden.js';
import { loadSide } from '../../scripts/differential/side.js';
import type { CellTruth, TargetTruth } from '../../scripts/truth/schema.js';

// The golden mode's wiring of phase 3's truth (golden.ts#goldenRecording), on a synthetic capture: the committed
// Android `open` capture (its tree and screenshot) with a truth whose targets carry a measured geometry — none of the
// committed corpus does, so golden.test.ts cannot see whether golden hands expectations() the cell's truth,
// consistency() the platform and the screen, or drops the live-only rows.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = fileURLToPath(new URL('../fixtures/truth/android-averi_lab-api33/', import.meta.url));

let dir: string;
let result: GoldenResult;
beforeAll(async () => {
  installFakeDevice();
  installVirtualClock();
  dir = await mkdtemp(join(tmpdir(), 'averi-golden-wiring-'));
  const run = join(dir, 'android-wiring');
  await mkdir(run);
  for (const f of ['open.xml', 'open.png']) await copyFile(join(RUN, f), join(run, f));
  const truth = JSON.parse(await readFile(join(RUN, 'open.truth.json'), 'utf8')) as CellTruth;
  const [a, b, c, d] = truth.targets;
  const targets: TargetTruth[] = [
    // A system band on Android swallows the probe: no touch, not reached — consistent only told the platform.
    { ...a, geometry: 'status-band', reached: false, probe: [], visible: a.frame, piece: null },
    // Off the screen: R-off's three rows and R-direction, live only — never asked.
    { ...b, frame: { ...b.frame, y: 2300 }, geometry: 'off-screen', reached: false, probe: [], visible: null, piece: null, unprobed: 'its centre (540,2388) lies off the 1080x2220 screen' },
    // Cut by the screen's bottom with its centre (540,2238) past it: never probed there — consistent only told the
    // screen.
    {
      ...c,
      frame: { ...c.frame, y: 2150 },
      geometry: 'centre-out',
      reached: false,
      probe: [],
      visible: { ...c.frame, y: 2150, height: 70 },
      piece: { ...c.frame, y: 2150, height: 70 },
      unprobed: 'its centre (540,2238) lies off the 1080x2220 screen',
    },
    d,
  ];
  await writeFile(join(run, 'open.truth.json'), JSON.stringify({ ...truth, targets, safeArea: { top: 66, left: 0, bottom: 0, right: 0 } }));
  await writeFile(
    join(run, 'manifest.json'),
    JSON.stringify({
      platform: 'android',
      app: 'AveriLab',
      device: truth.device,
      note: 'synthetic: golden-wiring.test.ts',
      captures: [{ file: 'open.xml', source: 'uiautomator', form: 'raw', screen: truth.screen, screenshot: 'open.png', truth: 'open.truth.json' }],
    }),
  );
  const [recording] = await loadCorpus(dir);
  result = await goldenRecording(recording, await loadSide(ROOT));
}, 120_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const asked = (tag: string) => result.checks.filter((c) => c.target === tag).map((c) => `${c.verb}: ${c.says.split(':')[0]}`);

describe('golden over a capture whose truth carries a measured geometry', () => {
  it('judges every target: consistency told the platform (A, the swallowed band probe) and the screen (C, its centre past it)', () => {
    expect(result.broken).toEqual([]);
    expect(result.checks.flatMap((c) => c.faults ?? [])).toEqual([]);
  });
  // D's tap at its node's centre: golden handed expectations() the replayed tree (recording.payload).
  it('asks each geometry its rows — expectations() handed the cell\'s truth and the tree', () => {
    expect(asked('A')).toEqual(['tap: R-band', 'colour: fails (R-band', 'scroll_until: R-band']);
    expect(asked('C')).toEqual(['tap: R-land', 'fully: R-fully']);
    expect(asked('D')).toEqual(["tap: Tapped at its node's centre (539.5,1876) in the tree", 'colour: passes on its own colour #FB8C00', 'scroll_until: reached with no swipe']);
  });
  it('never asks a live-only row: off the screen, R-off\'s three and not R-direction', () => {
    expect(asked('B')).toEqual(['tap: R-off', 'colour: fails (R-off', 'scroll_until: R-off, R-stroke']);
  });
});
