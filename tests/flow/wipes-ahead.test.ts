import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/flow/config.js';
import { WipesAhead } from '../../src/flow/wipes-ahead.js';

/**
 * "Is a wipe ahead?" for the reach ladder (docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-rung.md),
 * through `flow/wipes-ahead.ts#WipesAhead` alone; the ladder's own pins are in tests/flow/bare-tree-ladder.test.ts.
 */
const cfg = parseConfig(`
app:
  android: { package: md.bank.app }
states:
  wiped:
    detect: { element: { id: login_root } }
    reach: [wipe]
  looped:
    detect: { element: { id: loop_root } }
    reach: [cyclic]
flows:
  cheap:
    steps:
      - tap: { id: later }
  cheap2:
    steps:
      - tap: { id: close }
  wipe:
    steps:
      - launch: { clearState: true }
  via_wipe:
    requires: wiped
    steps:
      - tap: { id: tab }
  cyclic:
    requires: looped
    steps:
      - tap: { id: loop }
`);

const fresh = (): WipesAhead => new WipesAhead(cfg);

describe('WipesAhead.noneAheadOf', () => {
  it('all cheap rungs: no wipe ahead', () => {
    expect(fresh().noneAheadOf(['cheap', 'cheap2'], 0)).toBe(true);
  });

  it('the rung at i itself counts', () => {
    expect(fresh().noneAheadOf(['wipe'], 0)).toBe(false);
    expect(fresh().noneAheadOf(['cheap', 'wipe'], 1)).toBe(false);
  });

  it('a wipe after i counts, one before i does not', () => {
    expect(fresh().noneAheadOf(['cheap', 'wipe'], 0)).toBe(false);
    expect(fresh().noneAheadOf(['wipe', 'cheap'], 1)).toBe(true);
  });

  it('transitive: a `requires:` into a ladder that wipes is a wipe', () => {
    expect(fresh().noneAheadOf(['via_wipe'], 0)).toBe(false);
  });

  it('a `requires:` cycle counts as a wipe (flowIsDestructive is conservative)', () => {
    expect(fresh().noneAheadOf(['cyclic'], 0)).toBe(false);
  });
});

describe('WipesAhead.running', () => {
  it("a ladder entered inside a rung sees the enclosing ladder's later wipes; outside it does not", async () => {
    const wipes = fresh();
    const inside = await wipes.running(['cheap', 'wipe'], 0, async () => wipes.noneAheadOf(['cheap'], 0));
    expect(inside).toBe(false);
    expect(wipes.noneAheadOf(['cheap'], 0)).toBe(true);
  });

  it('the running rung itself is not ahead of the ladders inside it', async () => {
    const wipes = fresh();
    expect(await wipes.running(['wipe', 'cheap'], 0, async () => wipes.noneAheadOf(['cheap'], 0))).toBe(true);
    expect(await wipes.running(['cheap', 'wipe'], 1, async () => wipes.noneAheadOf(['cheap'], 0))).toBe(true);
  });

  it('nests: an outer wipe stays ahead through a cheap inner ladder', async () => {
    const wipes = fresh();
    const deep = await wipes.running(['cheap', 'wipe'], 0, () =>
      wipes.running(['cheap', 'cheap2'], 0, async () => wipes.noneAheadOf(['cheap'], 0)),
    );
    expect(deep).toBe(false);
    expect(wipes.noneAheadOf(['cheap'], 0)).toBe(true);
  });

  it('restores on throw', async () => {
    const wipes = fresh();
    await expect(
      wipes.running(['cheap', 'wipe'], 0, async () => {
        throw new Error('rung failed');
      }),
    ).rejects.toThrow('rung failed');
    expect(wipes.noneAheadOf(['cheap'], 0)).toBe(true);
  });
});
