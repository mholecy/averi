import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { falseCovers } from '../differential/golden/false-covers.known.js';
import { IOS } from '../differential/golden/known.js';
import { FLAT, IOS_TRUTH, idbListing, predictedIdb, predictedWda, wdaListing, type RawIdb, type RawWda } from '../helpers/flat-catcher.js';

// A43 (ADR 0018, the A43 amendment): the listing tap-catcher-beneath-flat's capture brings, against the one predicted.
// Keyed on false-covers.known.ts: while it holds no count for a source's capture, the capture must be absent (the cell
// awaits its first capture); once it holds one, the capture must be there and list as predicted — WDA as the ungrouped
// blur-menu less its card's rows, idb as tap-catcher-beneath. Red after the capture means WDA (or idb) lists the cell
// otherwise: that difference is the evidence the amendment's "Listed otherwise" files, and this expectation is replaced
// with the listing measured.

const SOURCES = [
  { source: 'wda', listing: async (text: string) => wdaListing((JSON.parse(text) as { value: RawWda }).value), predicted: async () => wdaListing((await predictedWda()).value) },
  { source: 'idb', listing: async (text: string) => idbListing(JSON.parse(text) as RawIdb[]), predicted: async () => idbListing(await predictedIdb()) },
] as const;

describe('A43: tap-catcher-beneath-flat\'s capture, against its predicted listing', () => {
  for (const { source, listing, predicted } of SOURCES) {
    const file = `${FLAT}.${source}.json`;
    const counted = falseCovers.counts[`${IOS}/${file}`] !== undefined;
    it(counted ? `${source}: captured (counted) — lists as predicted` : `${source}: not counted in false-covers.known.ts — no capture committed yet`, async () => {
      const path = join(IOS_TRUTH, file);
      expect(existsSync(path)).toBe(counted);
      if (counted) expect(await listing(await readFile(path, 'utf8'))).toEqual(await predicted());
    });
  }

  it('the predicted listings hold the flat cell\'s four targets and no card row', async () => {
    const ids = (lines: string[]) => lines.map((l) => /id=(lab\.\S+)$/.exec(l)?.[1]).filter((x) => x !== undefined);
    const four = ['A', 'B', 'C', 'D'].map((t) => `lab.${FLAT}.${t}`);
    expect(ids(wdaListing((await predictedWda()).value))).toEqual(four);
    expect(ids(idbListing(await predictedIdb()))).toEqual(four);
    // WDA's: the hidden catcher, childless, listed first of the targets' siblings.
    expect(wdaListing((await predictedWda()).value).slice(6, 8)).toEqual(['6 Other {{0, 0}, {402, 874}} vis=0 id=null', `6 Button {{51, 110}, {300, 64}} vis=1 id=lab.${FLAT}.A`]);
  });
});
