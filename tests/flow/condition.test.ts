import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import type { Condition } from '../../src/flow/config.js';
import { conditionStateRefs, describeCondition, evaluateCondition, type ConditionContext } from '../../src/flow/condition.js';
import { isBareTree } from '../../src/ui-tree/bare-tree.js';
import type { Verdict } from '../../src/ui-tree/verdict.js';
import { node, screen } from '../helpers/fake.js';

/**
 * flow/condition.ts as a table, no adapter (2026-10-08, flow-engine review
 * candidate 2): the three-valued leaf rule against a rendered and a bare
 * tree, and Kleene's any/all over arms of every value.
 */

const VIEWPORT = { width: 1000, height: 2000 };

/** The Android decor's shape: a full-screen wrapper and an identified, unlabeled `content` — bare. */
const BARE = (): UiNode => screen(node({ identifier: 'content', rect: { x: 0, y: 0, width: 1000, height: 2000 } }));
/** The same with one rendered thing on it: a labelled text. */
const RENDERED = (): UiNode =>
  screen(
    node({ identifier: 'content', rect: { x: 0, y: 0, width: 1000, height: 2000 } }),
    node({ role: 'text', label: 'Prehľad', identifier: 'title', rect: { x: 0, y: 100, width: 300, height: 40 } }),
  );

const ctx = (states: Record<string, Condition> = {}, onViewport?: () => void): ConditionContext => ({
  detectOf: (name) => {
    const detect = states[name];
    if (detect === undefined) throw new Error(`asked for state ${name}`);
    return detect;
  },
  viewport: async () => {
    onViewport?.();
    return VIEWPORT;
  },
});

const evaluate = (cond: Condition, tree: UiNode, c = ctx()) => evaluateCondition(cond, tree, c);

describe('the fixtures', () => {
  it('BARE is bare and RENDERED is not', () => {
    expect(isBareTree(BARE())).toBe(true);
    expect(isBareTree(RENDERED())).toBe(false);
  });
});

describe('a leaf: present and absent, on a rendered and on a bare tree', () => {
  const present = (id: string): Condition => ({ element: { id } });
  const absent = (id: string): Condition => ({ element: { id }, absent: true });

  it.each<[string, Condition, Verdict, Verdict]>([
    // condition,                              rendered, bare
    ['present, found', present('content'), 'yes', 'yes'],
    ['present, not found', present('modal'), 'no', 'unknown'],
    ['absent, visible', absent('content'), 'no', 'no'],
    ['absent, not in the tree', absent('modal'), 'yes', 'unknown'],
  ])('%s: rendered %s, bare %s', async (_, cond, onRendered, onBare) => {
    expect(await evaluate(cond, RENDERED())).toBe(onRendered);
    expect(await evaluate(cond, BARE())).toBe(onBare);
  });

  it('absent, in the tree but off the viewport: yes on a rendered tree, unknown on a bare one', async () => {
    const offscreen = node({ identifier: 'card', rect: { x: 0, y: -300, width: 100, height: 100 } });
    const rendered = RENDERED();
    rendered.children.push(offscreen);
    const bare = BARE();
    bare.children.push(structuredClone(offscreen));
    expect(await evaluate(absent('card'), rendered)).toBe('yes');
    expect(await evaluate(absent('card'), bare)).toBe('unknown');
  });

  it('a state is its detect on the same tree, with the same three values', async () => {
    const c = ctx({ no_modal: absent('modal') });
    expect(await evaluate({ state: 'no_modal' }, RENDERED(), c)).toBe('yes');
    expect(await evaluate({ state: 'no_modal' }, BARE(), c)).toBe('unknown');
  });
});

describe("any:/all: are Kleene's three-valued or/and", () => {
  // On ONE bare tree, three leaves with each answer.
  const ARM: Record<Verdict, Condition> = {
    yes: { element: { id: 'content' } },
    no: { element: { id: 'content' }, absent: true },
    unknown: { element: { id: 'modal' } },
  };
  const VALUES: Verdict[] = ['yes', 'no', 'unknown'];
  const any = (a: Verdict, b: Verdict): Verdict =>
    a === 'yes' || b === 'yes' ? 'yes'
    : a === 'unknown' || b === 'unknown' ? 'unknown'
    : 'no';
  const all = (a: Verdict, b: Verdict): Verdict =>
    a === 'no' || b === 'no' ? 'no'
    : a === 'unknown' || b === 'unknown' ? 'unknown'
    : 'yes';

  it('the leaves answer what their names say', async () => {
    for (const v of VALUES) expect(await evaluate(ARM[v], BARE())).toBe(v);
  });

  const pairs = VALUES.flatMap((a) => VALUES.map((b) => [a, b] as const));
  it.each(pairs)('any(%s, %s)', async (a, b) => {
    expect(await evaluate({ any: [ARM[a], ARM[b]] }, BARE())).toBe(any(a, b));
  });
  it.each(pairs)('all(%s, %s)', async (a, b) => {
    expect(await evaluate({ all: [ARM[a], ARM[b]] }, BARE())).toBe(all(a, b));
  });

  it('the table, spelled out where it differs from two-valued logic', async () => {
    expect(await evaluate({ any: [ARM.unknown, ARM.no] }, BARE())).toBe('unknown');
    expect(await evaluate({ any: [ARM.unknown, ARM.yes] }, BARE())).toBe('yes');
    expect(await evaluate({ all: [ARM.unknown, ARM.yes] }, BARE())).toBe('unknown');
    expect(await evaluate({ all: [ARM.unknown, ARM.no] }, BARE())).toBe('no');
    expect(await evaluate({ any: [] }, BARE())).toBe('no');
    expect(await evaluate({ all: [] }, BARE())).toBe('yes');
  });

  it('nested combinators and states carry unknown up', async () => {
    const c = ctx({ s: { all: [ARM.yes, ARM.unknown] } });
    expect(await evaluate({ any: [ARM.no, { state: 's' }] }, BARE(), c)).toBe('unknown');
    expect(await evaluate({ all: [ARM.yes, { any: [ARM.no, ARM.unknown] }] }, BARE(), c)).toBe('unknown');
  });

  it('each stops at the arm that decides it: any at a yes, all at a no — the arms after it are never asked', async () => {
    let viewportReads = 0;
    const c = ctx({}, () => viewportReads++);
    const asked = { element: { id: 'never' }, absent: true }; // would read the viewport
    expect(await evaluate({ any: [ARM.unknown, ARM.yes, asked] }, BARE(), c)).toBe('yes');
    expect(viewportReads).toBe(0);
    expect(await evaluate({ all: [ARM.unknown, { element: { id: 'modal' }, absent: false }, ARM.no, asked] }, BARE(), c)).toBe('no');
    expect(viewportReads).toBe(1); // ARM.no's own read, not `asked`'s
    // An unknown does not stop either: the arm after it still decides.
    expect(await evaluate({ any: [ARM.unknown, { state: 'missing' }] }, BARE(), c).catch((e: Error) => e.message)).toBe('asked for state missing');
  });
});

describe('the name and the references', () => {
  it('describeCondition names every shape as the trace always did', () => {
    expect(describeCondition({ all: [{ element: { id: 'a' } }, { any: [{ state: 's' }, { element: { text: 'OK' }, absent: true }] }] })).toBe(
      'all(element id:"a", any(state s, element text:"OK"))',
    );
  });

  it('conditionStateRefs finds a state at any depth', () => {
    expect(conditionStateRefs({ any: [{ state: 'a' }, { all: [{ element: { id: 'x' } }, { state: 'b' }] }] })).toEqual(['a', 'b']);
  });
});
