import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type DeviceRound, stateOf } from '../../scripts/truth/device-state.js';

// T16's rule against every label T11's and T12's runs wrote (their label-group.mjs, from the raw-strokes reads beside
// the records): device-state.ts#stateOf reads each the same. Apart from device-state.test.ts so the mutation sandbox
// (stryker.config.mjs) does not copy the folders' every record.

const RECORDS = new URL('../../docs/truth/live-records/', import.meta.url);
const roundsIn = (file: string): DeviceRound[] =>
  readFileSync(new URL(file, RECORDS), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as DeviceRound);

describe('stateOf against the labelled records', () => {
  it('agrees with every label label-group.mjs wrote into the T11 and T12 records', () => {
    type Label = { file: string; strokes: number; short: number; state: 'short' | 'fast' };
    let seen = 0;
    for (const dir of ['t11-carousel-visible/final-ab', 't12-first-probe']) {
      for (const f of readdirSync(new URL(`${dir}/`, RECORDS)).filter((x) => x.endsWith('.json'))) {
        const { deviceState } = JSON.parse(readFileSync(new URL(`${dir}/${f}`, RECORDS), 'utf8')) as { deviceState?: { before: Label; after: Label } };
        if (deviceState === undefined) continue;
        for (const label of [deviceState.before, deviceState.after]) {
          expect(stateOf(roundsIn(`${dir}/${label.file}`))).toEqual({ state: label.state, short: label.short, strokes: label.strokes });
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

});
