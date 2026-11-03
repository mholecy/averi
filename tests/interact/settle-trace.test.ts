import { describe, expect, it, vi } from 'vitest';

// No-yield sleep: the fake never reacts on a timer, so a sleep only moves the faked clock (sleep-recorder.ts's
// setTimeout(0) per sleep costs ~30 s over this corpus, with identical results).
vi.mock('../../src/util/sleep.js', () => ({
  sleep: async (ms: number): Promise<void> => {
    vi.setSystemTime(Date.now() + ms);
  },
}));
import { readFileSync } from 'node:fs';
import { type DeviceAdapter, PersistentReadError, type UiNode } from '../../src/adapters/types.js';
import { IDB_SETTLE_CADENCE_MS } from '../../src/adapters/ios-tree-source.js';
import { resolveSettled } from '../../src/interact/resolve.js';

/**
 * T5 (ADR 0040, amendment T5): batch-11 B2's d35-motion trace, replayed through the production settle —
 * resolveSettled → settleCadence → pollTree → pauseAfterRead, all unmodified — at the iOS idb adapter's fact
 * (IDB_SETTLE_CADENCE_MS, no pollMs).
 *
 * The fixture (tests/fixtures/d35-b11-settle.json) is trimmed from a device batch: 60 trials (20 each of
 * sheet-long-list M1a, scroll-bounded M1b, carousel-in-list M2), every idb read for 3 s after the trigger, its times
 * at 0.1 ms, each id's rects as equality classes (the settle compares the resolved target's rect for equality only).
 * One resolveSettled per (trial, id), over every id recorded.
 *
 * Virtual time: only Date is faked. A read asked for at trace time T is the first recorded read starting at or after
 * T; the clock then advances by that read's own length, so pollTree's readMs is the device's. The settle starts at the
 * first read after the trigger ended (d35's rule, the worst case). When the recorded window ends the fake throws a
 * PersistentReadError, which ends the settle at once: not settled in the window.
 *
 * The limit, stated: on this batch no cadence from 125 to 500 shows a wrong settle (100 shows one), so the corpus
 * cannot show 300 is necessary. A cut of the fact is caught only as a changed settle count (change detection, not
 * safety evidence); a raise to 400 keeps 160 settles and is not caught. Residuals: the probe kept lab.* ids and the
 * tracked labels only, last node winning on a duplicate key, and no roles — a duplicate match in the real tree is not
 * recorded; Date is whole ms where the probe's clock was fractional.
 */

interface Trial {
  motion: 'M1a' | 'M1b' | 'M2';
  cell: string;
  trial: number;
  trigger: [number, number];
  reads: [number, number][];
  rects: Record<string, string>;
}
const FIXTURE = JSON.parse(readFileSync(new URL('../fixtures/d35-b11-settle.json', import.meta.url), 'utf8')) as {
  trials: Trial[];
};

/** Per read, per id: its rect's equality class (absent: no key). Tokens: '-' absent, '.' as before, '+' new, '(k)' the k-th again. */
function classesOf(t: Trial): Record<string, number>[] {
  const out = t.reads.map((): Record<string, number> => ({}));
  for (const [id, s] of Object.entries(t.rects)) {
    const tokens = s.match(/\(\d+\)|[-.+]/g) ?? [];
    expect(tokens.join(''), `${t.motion}#${t.trial} ${id}: a token per read`).toBe(s);
    expect(tokens.length, `${t.motion}#${t.trial} ${id}: a token per read`).toBe(t.reads.length);
    let next = 0;
    let cur: number | undefined;
    tokens.forEach((c, k) => {
      if (c === '-') cur = undefined;
      else if (c === '+') cur = next++;
      else if (c !== '.') cur = Number(c.slice(1, -1));
      if (cur !== undefined) out[k][id] = cur;
    });
  }
  return out;
}

/**
 * The wrong settle, defined once: a settle of id X at read k is wrong when a later read in the window has X present
 * at another rect. X vanishing later is not wrong — this is a motion corpus (d35-motion's motion mode).
 */
const settledWrong = (classes: Record<string, number>[], id: string, k: number): boolean =>
  classes.slice(k + 1).some((c) => c[id] !== undefined && c[id] !== classes[k][id]);

/** The class as a rect: equal JSON iff the device's rects were equal, and every rect has area. */
const leaf = (id: string, cls: number): UiNode => {
  const rect = { x: cls, y: 0, width: 1, height: 1 };
  return id.startsWith('label:')
    ? { role: 'text', label: id.slice('label:'.length), identifier: null, value: null, rect, children: [] }
    : { role: 'other', label: null, identifier: id, value: null, rect, children: [] };
};
const selectorOf = (id: string): string => (id.startsWith('label:') ? `text:"${id.slice('label:'.length)}"` : `id:${id}`);

class WindowEnded extends PersistentReadError {}

type SettleAdapter = Pick<DeviceAdapter, 'uiTree' | 'focusedWindow' | 'keyboard' | 'keyboardAdvice' | 'settleCadenceMs'>;

/** The device's reads, served in virtual time (the doc above). */
function tracedAdapter(t: Trial, trees: UiNode[]): SettleAdapter {
  let shift = 0; // trace time − Date.now()
  return {
    settleCadenceMs: IDB_SETTLE_CADENCE_MS,
    uiTree: async () => {
      const at = Date.now() + shift;
      const k = t.reads.findIndex(([start]) => start >= at);
      if (k === -1) throw new WindowEnded('the recorded window ended');
      const [start, end] = t.reads[k];
      shift += start - at;
      vi.setSystemTime(Date.now() + (end - start));
      return trees[k];
    },
  };
}

interface Pass {
  settles: Record<Trial['motion'], number>;
  wrong: string[];
}

async function replay(opts: { pollMs?: number }): Promise<Pass> {
  const pass: Pass = { settles: { M1a: 0, M1b: 0, M2: 0 }, wrong: [] };
  for (const t of FIXTURE.trials) {
    const classes = classesOf(t);
    const trees = classes.map(
      (c): UiNode => ({
        role: 'container',
        label: null,
        identifier: null,
        value: null,
        rect: { x: 0, y: 0, width: 402, height: 874 },
        children: Object.entries(c).map(([id, cls]) => leaf(id, cls)),
      }),
    );
    const readOf = new Map(trees.map((tree, k) => [tree, k]));
    const first = t.reads.findIndex(([start]) => start >= t.trigger[1] - 1);
    for (const id of Object.keys(t.rects).sort()) {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(t.reads[first][0]);
      try {
        const settled = await resolveSettled(tracedAdapter(t, trees), selectorOf(id), {
          ambiguous: 'refuse',
          ...(opts.pollMs !== undefined && { pollMs: opts.pollMs }),
        });
        const k = readOf.get(settled.tree);
        if (k === undefined) throw new Error('the settle returned a tree the trace never served');
        pass.settles[t.motion]++;
        if (settledWrong(classes, id, k)) pass.wrong.push(`${t.motion}#${t.trial} ${id} @${k}`);
      } catch (e) {
        if (!(e instanceof WindowEnded)) throw e;
      } finally {
        vi.useRealTimers();
      }
    }
  }
  return pass;
}

describe('T5: batch-11 B2 settle corpus through production resolveSettled (ADR 0040)', () => {
  it('the fixture is the batch: 60 trials, 20 per motion, 8569 reads', () => {
    const per = { M1a: 0, M1b: 0, M2: 0 };
    for (const t of FIXTURE.trials) per[t.motion]++;
    expect(per).toEqual({ M1a: 20, M1b: 20, M2: 20 });
    expect(FIXTURE.trials.reduce((n, t) => n + t.reads.length, 0)).toBe(8569);
  });

  // M1a's rows (sheet-long-list's fling) never hold still for two reads 300 ms apart inside the 3 s window, as in
  // d35's own replay; they do resolve (at 100, below, they settle).
  it('at the idb fact (300, no pollMs): 0 wrong settles in 160 (M1a 0, M1b 100, M2 60)', async () => {
    const pass = await replay({});
    expect(pass).toEqual({ settles: { M1a: 0, M1b: 100, M2: 60 }, wrong: [] });
  });

  it('sensitivity — at pollMs 100 the carousel settles wrong once, in its late deceleration (M2#14, C)', async () => {
    const pass = await replay({ pollMs: 100 });
    expect(pass.wrong).toEqual(['M2#14 lab.carousel-in-list.C @20']);
    expect(pass.settles.M1a, "sheet-long-list's label rows resolve and settle").toBeGreaterThan(0);
  });
});
