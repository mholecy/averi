import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
import type { UiNode } from '../../src/adapters/types.js';
import { PollMiss, pollTimeoutMessage, pollTree, readErrorLine, readTreeOrError } from '../../src/ui-tree/read-tree.js';

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
    expect(read).toEqual({ timedOut: true, detail: undefined, readError: undefined, treesRead: 1 });
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
  it('a late round still inside the deadline IS taken: an element appearing at 2.5 s of 3 s is found by it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const start = Date.now();
      let reads = 0;
      const adapter = {
        uiTree: async () => {
          const at = Date.now() - start;
          reads += 1;
          vi.setSystemTime(Date.now() + 1000); // a slow dump
          return { ...tree, children: at >= 2500 ? [tree] : [] };
        },
      };
      const outcome = await pollTree(adapter, (t) => (t.children.length > 0 ? 'found' : undefined), { timeoutMs: 3000, pollMs: 300 });
      // Reads at 0, 1300 and 2600 (each 1 s, then a 300 ms pause): the third starts inside the deadline and finds it.
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
          vi.setSystemTime(Date.now() + 700);
          return tree;
        },
      };
      const outcome = await pollTree(adapter, () => undefined, { timeoutMs: 1000, pollMs: 400 });
      // Read 0→700, pause →1100 (past the deadline), one more read →1800, then the check ends it.
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
