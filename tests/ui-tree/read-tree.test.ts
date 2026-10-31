import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
import { resetSleeps, sleeps } from '../helpers/sleep-recorder.js';
import type { UiNode } from '../../src/adapters/types.js';
import { PollMiss, Undecided, type HandedRead, pollTimeoutMessage, pollTree, SETTLE_FLOOR_MS, readErrorLine, readTreeOrError, screenChangedUnder, screenIdentity, sheetDetent, showsProgress, treeFingerprint, type IdentifiedRead } from '../../src/ui-tree/read-tree.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';

const tree: UiNode = {
  role: 'container',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  children: [],
};

describe('readTreeOrError', () => {
  it('returns the tree and no error on a successful read', async () => {
    const read = await readTreeOrError({ uiTree: async () => tree });
    expect(read.tree).toBe(tree);
    expect(read.error).toBeUndefined();
  });

  // The rule the pollers depend on: a read that throws must come back as a
  // VALUE (so the loop treats it as a miss and keeps waiting) while still
  // carrying the reason (so a genuinely dead device stays diagnosable).
  it('reports a failed read as a value, preserving the message', async () => {
    const read = await readTreeOrError({
      uiTree: async () => {
        throw new Error('null root node returned by UiTestAutomationBridge');
      },
    });
    expect(read.tree).toBeUndefined();
    expect(read.error?.message).toMatch(/null root node/);
  });

  // Adapters shell out, and a rejected child process can surface as a string.
  it('wraps a non-Error rejection so callers can always read .message', async () => {
    const read = await readTreeOrError({
      uiTree: async () => {
        throw 'adb: device offline';
      },
    });
    expect(read.error).toBeInstanceOf(Error);
    expect(read.error?.message).toBe('adb: device offline');
  });

  // Callers assign both fields each round, so `error` must be absent on
  // success — that is what clears a previous round's error for free.
  it('leaves error unset on success so callers self-clear', async () => {
    let fail = true;
    const adapter = {
      uiTree: async () => {
        if (fail) throw new Error('transient');
        return tree;
      },
    };
    const first = await readTreeOrError(adapter);
    fail = false;
    const second = await readTreeOrError(adapter);
    expect(first.error).toBeDefined();
    expect('error' in second && second.error !== undefined).toBe(false);
  });
});

describe('pollTree — the one deadline loop', () => {
  const FAST = { timeoutMs: 60, pollMs: 2 };

  it('returns the predicate\'s value and reads the tree exactly once on a first-round hit', async () => {
    let reads = 0;
    const outcome = await pollTree(
      { uiTree: async () => (reads++, tree) },
      (t) => t.rect.width,
      FAST,
    );
    expect(outcome).toEqual({ timedOut: false, value: 10 });
    expect(reads).toBe(1);
  });

  it('a failed read is a miss that keeps polling, and the deadline reports the LAST read error', async () => {
    let reads = 0;
    const outcome = await pollTree(
      {
        uiTree: async () => {
          throw new Error(`null root node (read ${++reads})`);
        },
      },
      () => true,
      FAST,
    );
    expect(outcome.timedOut).toBe(true);
    expect(reads).toBeGreaterThan(1);
    if (outcome.timedOut) expect(outcome.readError?.message).toBe(`null root node (read ${reads})`);
  });

  it('a successful read clears an earlier read error — the timeout quotes only a device that is STILL unreadable', async () => {
    let reads = 0;
    const outcome = await pollTree(
      {
        uiTree: async () => {
          if (reads++ === 0) throw new Error('transient');
          return tree;
        },
      },
      () => undefined, // never satisfied
      FAST,
    );
    expect(outcome).toMatchObject({ timedOut: true, detail: undefined, readError: undefined });
    if (outcome.timedOut) expect(outcome.treesRead).toBeGreaterThan(0);
  });

  it('a PollMiss detail survives later rounds that have nothing to say', async () => {
    let round = 0;
    const outcome = await pollTree(
      { uiTree: async () => tree },
      () => (round++ === 0 ? new PollMiss('element found but content was: WRONG') : undefined),
      FAST,
    );
    expect(outcome).toMatchObject({ timedOut: true, detail: 'element found but content was: WRONG' });
  });

  it('a later PollMiss replaces an earlier one — the deadline reports the most recent observation', async () => {
    let round = 0;
    const outcome = await pollTree({ uiTree: async () => tree }, () => new PollMiss(`seen ${round++}`), FAST);
    expect(outcome.timedOut).toBe(true);
    if (outcome.timedOut) expect(outcome.detail).toBe(`seen ${round - 1}`);
  });

  // The optional-tap finding (2026-08-19): a budget shorter than one device
  // read must still get one honest look, and a 0 ms budget is a single probe.
  it('timeoutMs 0 is exactly one read and one evaluation, and that one can hit', async () => {
    let reads = 0;
    let evaluations = 0;
    const adapter = { uiTree: async () => (reads++, tree) };
    const hit = await pollTree(adapter, () => (evaluations++, 'yes'), { timeoutMs: 0, pollMs: 2 });
    expect(hit).toEqual({ timedOut: false, value: 'yes' });
    const miss = await pollTree(adapter, () => (evaluations++, undefined), { timeoutMs: 0, pollMs: 2 });
    expect(miss.timedOut).toBe(true);
    expect(reads).toBe(2);
    expect(evaluations).toBe(2);
  });

  // 2026-10-06 (docs/bugs/2026-10-06-ios-idb-empty-tree-persists-on-pin-
  // screen.md): the ladder refuses a destructive rung when the probe before
  // it never read a tree, and the probe is a 0 ms poll — so its count must
  // be exactly the one read it made, 0 when that read failed.
  it('timeoutMs 0 is one uiTree call, and treesRead says whether that one read a tree', async () => {
    let reads = 0;
    const unreadable = await pollTree(
      {
        uiTree: async () => {
          reads++;
          throw new Error('idb returned an empty accessibility tree');
        },
      },
      () => 'never evaluated',
      { timeoutMs: 0, pollMs: 2 },
    );
    expect(reads).toBe(1);
    expect(unreadable).toMatchObject({ timedOut: true, treesRead: 0 });
    reads = 0;
    const read = await pollTree({ uiTree: async () => (reads++, tree) }, () => undefined, { timeoutMs: 0, pollMs: 2 });
    expect(reads).toBe(1);
    expect(read).toEqual({ timedOut: true, detail: undefined, readError: undefined, treesRead: 1, lastTree: tree });
  });

  it('lastTree is the last tree READ: a failed read after it leaves it standing, beside the read error', async () => {
    const second: UiNode = { ...tree, label: 'second' };
    const script: (UiNode | Error)[] = [tree, second, new Error('transient')];
    let reads = 0;
    const outcome = await pollTree(
      {
        uiTree: async () => {
          const next = script[Math.min(reads++, script.length - 1)];
          if (next instanceof Error) throw next;
          return next;
        },
      },
      () => undefined,
      FAST,
    );
    expect(reads).toBeGreaterThan(3);
    if (!outcome.timedOut) throw new Error('expected a timeout');
    expect(outcome.lastTree).toBe(second);
    expect(outcome.readError?.message).toBe('transient');
  });

  it('treesRead counts only the rounds that READ a tree — a read error after good reads does not reset it, and every failed round adds nothing', async () => {
    let reads = 0;
    const outcome = await pollTree(
      {
        uiTree: async () => {
          // read, fail, read, fail, fail, …: two trees in however many rounds
          const n = reads++;
          if (n === 0 || n === 2) return tree;
          throw new Error('transient');
        },
      },
      () => undefined,
      FAST,
    );
    expect(reads).toBeGreaterThan(3);
    expect(outcome).toMatchObject({ timedOut: true, treesRead: 2 });
    if (outcome.timedOut) expect(outcome.readError?.message).toBe('transient');
  });

  // 2026-10-05: the loop's deadline rule is HEAD's — checked after each
  // round, never before a read — and that is pinned here because two
  // tightenings were tried and withdrawn: projecting the previous round's
  // cost (a static element under a 600 ms dump threw after ONE read at
  // 615 ms of a 1500 ms budget; a `wait:` landing at 8.5 s of 10 timed out
  // at 9.6 s) and refusing a round after a pause that crossed the deadline
  // (the same two cases, timed out AT the deadline where HEAD found them).
  // A predicate that waits bounds its own wait with the deadline it is
  // handed; the loop keeps the slack a late element is found by.
  it('a late round still inside the deadline IS taken: an element appearing at 2 s of 2.5 s is found by a read that ends past it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now();
      let reads = 0;
      const adapter = {
        uiTree: async () => {
          const at = Date.now() - start;
          reads += 1;
          vi.setSystemTime(Date.now() + 1000); // a slow dump
          return { ...tree, children: at >= 2000 ? [tree] : [] };
        },
      };
      const outcome = await pollTree(adapter, (t) => (t.children.length > 0 ? 'found' : undefined), { timeoutMs: 2500, pollMs: 300 });
      // Reads at 0, 1150 and 2300 (each 1 s, slower than the 300 ms poll, so only the 150 ms floor between them —
      // pauseAfterRead, ADR 0029): the third starts inside the deadline, ends 800 ms past it, and finds it.
      expect(outcome).toEqual({ timedOut: false, value: 'found' });
      expect(reads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a pause that crosses the deadline still gets one last read — the slack HEAD always had, kept (2026-10-05)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      let reads = 0;
      const adapter = {
        uiTree: async () => {
          reads += 1;
          vi.setSystemTime(Date.now() + 300);
          return tree;
        },
      };
      const outcome = await pollTree(adapter, () => undefined, { timeoutMs: 500, pollMs: 1000 });
      // Read 0→300, pause of the 700 left of the poll →1000 (past the deadline), one more read →1300, then the check ends it.
      expect(outcome.timedOut).toBe(true);
      expect(reads).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the predicate\'s own error propagates at once — it is the caller\'s bug, not a miss', async () => {
    let reads = 0;
    await expect(
      pollTree(
        { uiTree: async () => (reads++, tree) },
        () => {
          throw new Error('Unknown state "nope"');
        },
        FAST,
      ),
    ).rejects.toThrow(/Unknown state "nope"/);
    expect(reads).toBe(1);
  });

  // docs/adr/0029-poll-cadence-counts-the-read.md (2026-10-31): the pause after a round is `pauseAfterRead` of the
  // round's read — the rule, its floor and why are documented there, on ui-tree/read-tree.ts.
  describe('the cadence counts the read (ADR 0029)', () => {
    /** A fake device whose every read costs `readMs` of the faked Date, and the starts of its reads. */
    const timedAdapter = (readMs: number) => {
      const starts: number[] = [];
      return {
        starts,
        adapter: {
          uiTree: async () => {
            starts.push(Date.now());
            vi.setSystemTime(Date.now() + readMs);
            return tree;
          },
        },
      };
    };

    it('a read faster than pollMs is followed by the remainder: a 200 ms read under a 500 ms poll sleeps 300', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        const start = Date.now();
        const { adapter, starts } = timedAdapter(200);
        const outcome = await pollTree(adapter, () => undefined, { timeoutMs: 1000, pollMs: 500 });
        expect(outcome.timedOut).toBe(true);
        expect(sleeps).toEqual([300, 300]);
        // Reads start a whole pollMs apart, not pollMs after the last one ENDED (which was 0, 700, 1400).
        expect(starts.map((t) => t - start)).toEqual([0, 500, 1000]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a read slower than pollMs leaves only the floor: two snapshots are never back to back', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        const start = Date.now();
        const { adapter, starts } = timedAdapter(2300); // one uiautomator dump
        const outcome = await pollTree(adapter, () => undefined, { timeoutMs: 5000, pollMs: 500 });
        expect(outcome.timedOut).toBe(true);
        expect(SETTLE_FLOOR_MS).toBe(150);
        expect(sleeps).toEqual([SETTLE_FLOOR_MS, SETTLE_FLOOR_MS]);
        expect(starts.map((t) => t - start)).toEqual([0, 2450, 4900]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a pollMs below the floor is slept whole, never more: the floor never lengthens the caller\'s cadence', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        await pollTree(timedAdapter(0).adapter, () => undefined, { timeoutMs: 200, pollMs: 100 });
        expect(sleeps).toEqual([100, 100]); // reads at 0, 100, 200 (the deadline)
        resetSleeps();
        await pollTree(timedAdapter(2300).adapter, () => undefined, { timeoutMs: 5000, pollMs: 100 });
        expect(sleeps).toEqual([100, 100]); // reads at 0, 2400, 4800: the 100, not the 150 floor
      } finally {
        vi.useRealTimers();
      }
    });

    it('a clock that steps BACKWARDS during a read never lengthens the pause past pollMs', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        let first = true;
        const adapter = {
          uiTree: async () => {
            if (first) vi.setSystemTime(Date.now() - 1000); // the read "took" −1000 ms
            first = false;
            return tree;
          },
        };
        await pollTree(adapter, () => undefined, { timeoutMs: 100, pollMs: 500 });
        expect(sleeps).toEqual([500, 500, 500]);
      } finally {
        vi.useRealTimers();
      }
    });

    // ADR 0029, R2 — the ACCEPTED RESIDUAL. The deadline is checked after each round; under the old cadence the whole
    // pause pushed the last read's start up to pollMs later, past where the denser cadence puts it, and an element
    // appearing at 2.5 s of a 3 s budget behind 1 s reads was found by the read that pause happened to push to 2.6 s.
    // Now the reads start at 0, 1150 and 2300; the third ends at 3300, past the deadline, and the poll times out.
    // Neither cadence ever guaranteed finding an element that appears DURING the last read; the cure (always one read
    // starting at or after the deadline) would cost a full read on every timeout, ensure_state's detect probe included.
    it('accepted residual (R2): an element appearing at 2.5 s of a 3 s budget behind 1 s reads is no longer found by a read the pause pushed late', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const start = Date.now();
        const starts: number[] = [];
        const adapter = {
          uiTree: async () => {
            const at = Date.now() - start;
            starts.push(at);
            vi.setSystemTime(Date.now() + 1000);
            return { ...tree, children: at >= 2500 ? [tree] : [] };
          },
        };
        const outcome = await pollTree(adapter, (t) => (t.children.length > 0 ? 'found' : undefined), { timeoutMs: 3000, pollMs: 300 });
        expect(outcome.timedOut).toBe(true);
        expect(starts).toEqual([0, 1150, 2300]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('only the READ is counted: a predicate that spends its own time (a color or ocr capture) does not shrink the pause', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        const { adapter } = timedAdapter(100);
        const outcome = await pollTree(
          adapter,
          () => {
            vi.setSystemTime(Date.now() + 1500); // the predicate's settled frame
            return undefined;
          },
          { timeoutMs: 3000, pollMs: 500 },
        );
        expect(outcome.timedOut).toBe(true);
        // Rounds of 100 + 1500 + 400: the pause is pollMs less the read's 100 ms, never less the predicate's 1500.
        expect(sleeps).toEqual([400]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a failed read is timed like a good one: an error that took 200 ms leaves 300 of a 500 ms poll', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      resetSleeps();
      try {
        const outcome = await pollTree(
          {
            uiTree: async () => {
              vi.setSystemTime(Date.now() + 200);
              throw new Error('null root node');
            },
          },
          () => undefined,
          { timeoutMs: 600, pollMs: 500 },
        );
        expect(outcome.timedOut).toBe(true);
        expect(sleeps).toEqual([300]);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

describe('pollTree — a handed-on first sample (ADR 0030)', () => {
  const marked = (id: string): UiNode => ({ ...tree, identifier: id });
  const handing = (read: HandedRead | undefined) => {
    let asked = 0;
    return {
      first: {
        take: () => {
          asked++;
          return read;
        },
      },
      asked: () => asked,
    };
  };
  const counting = (t: UiNode = marked('fresh')) => {
    let reads = 0;
    return { adapter: { uiTree: async () => (reads++, t) }, reads: () => reads };
  };

  it('a value on the handed tree ends the poll with no device read', async () => {
    const { adapter, reads } = counting();
    const h = handing({ tree: marked('handed'), startedAt: Date.now(), endedAt: Date.now() });
    const outcome = await pollTree(adapter, (t) => (t.identifier === 'handed' ? 'yes' : undefined), { timeoutMs: 0, pollMs: 5, first: h.first });
    expect(outcome).toEqual({ timedOut: false, value: 'yes' });
    expect(reads()).toBe(0);
    expect(h.asked()).toBe(1);
  });

  it('a miss on the handed tree never ends the poll: a 0 ms budget still reads the device once, and the outcome counts that read only', async () => {
    const { adapter, reads } = counting();
    const seen: (string | null)[] = [];
    const h = handing({ tree: marked('handed'), startedAt: Date.now(), endedAt: Date.now() });
    const outcome = await pollTree(adapter, (t, round) => (seen.push(`${t.identifier}${round.handedOn ? '*' : ''}`), undefined), { timeoutMs: 0, pollMs: 5, first: h.first });
    expect(seen).toEqual(['handed*', 'fresh']);
    expect(reads()).toBe(1);
    expect(outcome).toMatchObject({ timedOut: true, treesRead: 1 });
    expect(outcome.timedOut && outcome.lastTree?.identifier).toBe('fresh');
    expect(h.asked()).toBe(1); // asked once, never again on later rounds
  });

  it('a PollMiss, an Undecided or a throw on the handed tree leaves nothing in the outcome', async () => {
    const { adapter } = counting();
    const now = Date.now();
    for (const handedSays of [() => new PollMiss('handed detail'), () => Undecided, () => { throw new Error('handed throw'); }]) {
      const outcome = await pollTree(adapter, (_t, round) => (round.handedOn ? handedSays() : undefined), {
        timeoutMs: 0,
        pollMs: 5,
        first: handing({ tree: marked('handed'), startedAt: now, endedAt: now }).first,
      });
      expect(outcome).toMatchObject({ timedOut: true, treesRead: 1 });
      expect(outcome.timedOut && outcome.detail).toBeUndefined();
      expect(outcome.timedOut && outcome.undecidedTree).toBeUndefined();
    }
  });

  it('the fresh read starts as after this poll\'s own previous round: a 2300 ms handed read is followed by the floor, less what has passed since it ended', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    resetSleeps();
    try {
      const now = Date.now();
      await pollTree(counting().adapter, () => undefined, { timeoutMs: 0, pollMs: 500, first: handing({ tree, startedAt: now - 2340, endedAt: now - 40 }).first });
      expect(sleeps).toEqual([SETTLE_FLOOR_MS - 40]);
      resetSleeps();
      // A 100 ms handed read under a 500 ms poll that ended 50 ms ago: 400 − 50.
      await pollTree(counting().adapter, () => undefined, { timeoutMs: 0, pollMs: 500, first: handing({ tree, startedAt: Date.now() - 150, endedAt: Date.now() - 50 }).first });
      expect(sleeps).toEqual([350]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('nothing handed: the poll is the poll it always was', async () => {
    const { adapter, reads } = counting();
    const outcome = await pollTree(adapter, () => 'yes', { timeoutMs: 0, pollMs: 5, first: handing(undefined).first });
    expect(outcome).toEqual({ timedOut: false, value: 'yes' });
    expect(reads()).toBe(1);
  });
});

describe('pollTimeoutMessage — the thrown timeout\'s shape, shared by the flow engine and interact/', () => {
  it('headline alone when nothing else is known', () => {
    expect(pollTimeoutMessage('element id:"x"', 300)).toBe('Timed out after 300ms waiting for element id:"x"');
  });

  it('the last read error and a caller\'s hint each take one indented parenthesis line beneath the headline', () => {
    expect(pollTimeoutMessage('element id:"x"', 300, new Error('null root node'))).toBe(
      'Timed out after 300ms waiting for element id:"x"\n  (last UI tree read failed: null root node)',
    );
    expect(pollTimeoutMessage('element id:"x"', 300, undefined, 'no tree read contained id:"x"')).toBe(
      'Timed out after 300ms waiting for element id:"x"\n  (no tree read contained id:"x")',
    );
  });

  // 2026-10-06: the idb empty-tree error puts its advice on a second line;
  // inside the parenthesis it is indented under the cause, not flush left.
  it('a multi-line read error keeps its later lines inside the parenthesis, indented under the first', () => {
    expect(pollTimeoutMessage('state s', 300, new Error('idb returned an empty accessibility tree (an empty list)\nCompare with screenshot'))).toBe(
      'Timed out after 300ms waiting for state s\n  (last UI tree read failed: idb returned an empty accessibility tree (an empty list)\n   Compare with screenshot)',
    );
  });

  // The rule the flow engine relied on until it moved here (2026-10-06): a
  // hint about what the trees held is dropped when the last read failed —
  // the reads are the story then. Conservative on purpose; the docblock
  // says why.
  it('drops the hint when the last read failed — the read error is the whole "why"', () => {
    expect(pollTimeoutMessage('element id:"x"', 300, new Error('null root node'), 'no tree read contained id:"x"')).toBe(
      'Timed out after 300ms waiting for element id:"x"\n  (last UI tree read failed: null root node)',
    );
  });
});

describe('readErrorLine — a poll timeout\'s read error on one line, read back from pollTimeoutMessage\'s own shape (2026-10-08)', () => {
  it('the parenthesis beneath the headline, as one line', () => {
    expect(readErrorLine(pollTimeoutMessage('element id:"x"', 300, new Error('device offline')))).toBe('(last UI tree read failed: device offline)');
  });

  it('a multi-line read error gives its FIRST line only, the parenthesis closed after it — the cause, never the advice', () => {
    const message = pollTimeoutMessage('state s', 300, new Error('idb returned an empty accessibility tree (an empty list)\nCompare with screenshot'));
    expect(readErrorLine(message)).toBe('(last UI tree read failed: idb returned an empty accessibility tree (an empty list))');
  });

  it('a message with no read error — a bare timeout, a hint, a one-line error — has none', () => {
    expect(readErrorLine(pollTimeoutMessage('element id:"x"', 300))).toBeUndefined();
    expect(readErrorLine(pollTimeoutMessage('element id:"x"', 300, undefined, 'no tree read contained id:"x"'))).toBeUndefined();
    expect(readErrorLine('fill: typed 5 characters but the field shows 4')).toBeUndefined();
  });

  it('only directly beneath the headline: a later line quoting the shape (a trace) is not this message\'s own', () => {
    expect(readErrorLine('Flow f failed\n  trace line\n  (last UI tree read failed: device offline)')).toBeUndefined();
  });

  it('a one-line read error followed by a line of something else keeps its own closing parenthesis, nothing added', () => {
    expect(readErrorLine('Timed out\n  (last UI tree read failed: a)\nsomething else')).toBe('(last UI tree read failed: a)');
  });
});

describe('treeFingerprint — the whole tree, as 8 hex digits (2026-10-09)', () => {
  const leaf = (label: string, y: number) => ({ role: 'text', label, identifier: null, value: null, rect: { x: 0, y, width: 10, height: 10 }, children: [] });
  const root = (...children: ReturnType<typeof leaf>[]) => ({ role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 100, height: 100 }, children });
  it('the same for an unchanged tree read twice; different for a node moved, renamed, added or removed', () => {
    const f = treeFingerprint(root(leaf('a', 0), leaf('b', 10)));
    expect(f).toMatch(/^[0-9a-f]{8}$/);
    expect(treeFingerprint(root(leaf('a', 0), leaf('b', 10)))).toBe(f);
    for (const other of [root(leaf('a', 0), leaf('b', 11)), root(leaf('a', 0), leaf('c', 10)), root(leaf('a', 0)), root(leaf('a', 0), leaf('b', 10), leaf('c', 20))]) {
      expect(treeFingerprint(other)).not.toBe(f);
    }
  });
});

describe('showsProgress — a progress node with area (2026-10-09)', () => {
  const n = (role: string, height: number, children: UiNode[] = []): UiNode => ({ role, label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 80, height }, children });
  it('true for a ProgressBar / Compose indicator anywhere in the tree; false for none, or one with no area', () => {
    expect(showsProgress(n('container', 100, [n('text', 10), n('container', 50, [n('progress', 80)])]))).toBe(true);
    expect(showsProgress(n('container', 100, [n('text', 10)]))).toBe(false);
    expect(showsProgress(n('container', 100, [n('progress', 0)]))).toBe(false);
  });
});

describe('sheetDetent — the detent a sheet\'s grabber reports', () => {
  const grabber = (value: string | null): UiNode => ({ role: 'button', label: 'Sheet Grabber', identifier: null, value, rect: { x: 152, y: 411, width: 98, height: 24 }, children: [] });
  const screen = (...children: UiNode[]): UiNode => ({ role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 402, height: 874 }, children });

  it('reads the grabber\'s value, the top sheet\'s (the last in tree order) when sheets are stacked, with how many grabbers the tree holds', () => {
    expect(sheetDetent(screen(grabber('Half screen')))).toEqual({ detent: 'Half screen', grabbers: 1 });
    expect(sheetDetent(screen(grabber('Expanded'), screen(grabber('Half screen'))))).toEqual({ detent: 'Half screen', grabbers: 2 });
  });

  it('is undefined with no grabber, or when the top sheet\'s exposes no value — a lower sheet\'s value is not taken for it', () => {
    expect(sheetDetent(screen())).toBeUndefined();
    expect(sheetDetent(screen(grabber(null)))).toBeUndefined();
    expect(sheetDetent(screen(grabber('Expanded'), grabber(null)))).toBeUndefined();
  });
});

// THE SCREEN CHANGED UNDER THE STROKE, asked of two reads directly (ui-tree/read-tree.ts#screenChangedUnder): the lab's
// large sheet as idb lists it (sheet-background.idb.json) and the plain host (open.idb.json), which share no id.
describe('screenChangedUnder — another screen by identity, and nothing the strokes touched down on still listed', () => {
  const TRUTH = new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url);
  const read = (cell: string): IdentifiedRead => {
    const tree = parseIdbDescribeAll(readFileSync(new URL(`${cell}.idb.json`, TRUTH), 'utf8'));
    return { tree, identity: screenIdentity(tree) };
  };
  const node = (role: string, label: string | null, identifier: string | null, rect: UiNode['rect'], children: UiNode[] = []): UiNode => ({ role, label, identifier, value: null, rect, children });
  const screen = { x: 0, y: 0, width: 402, height: 874 };
  const listRead = (from: number): IdentifiedRead => {
    const tree = node('application', 'App', null, screen, [
      node('scrollable', null, null, { x: 0, y: 100, width: 402, height: 700 }, Array.from({ length: 4 }, (_, i) => node('button', null, `row_${from + i}`, { x: 0, y: 100 + 64 * i, width: 402, height: 64 }))),
    ]);
    return { tree, identity: screenIdentity(tree) };
  };

  it("the sheet, then the host, a stroke from (201,175) on idb's screen-sized Application alone: changed, the sheet's id gone", () => {
    expect(screenChangedUnder(read('sheet-background'), read('open'), [{ x: 201, y: 175 }])).toEqual({ touchDowns: [{ x: 201, y: 175 }], gone: ['lab.sheet-background.S'] });
  });

  it('the same two reads with no stroke between them: no change told', () => {
    expect(screenChangedUnder(read('sheet-background'), read('open'), [])).toBeUndefined();
  });

  it('a list that keeps its scroll view at the very same rect while every row id changes: a scroll, not a change', () => {
    expect(screenChangedUnder(listRead(0), listRead(40), [{ x: 201, y: 600 }])).toBeUndefined();
  });
});
