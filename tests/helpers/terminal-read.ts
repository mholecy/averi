import type { UiNode } from '../../src/adapters/types.js';

/**
 * A bound for a test that pins "a read no wait cures (PersistentReadError) is not polled": past the reads the test
 * expects, the fake's read answers a tree that throws `polled past a terminal read` the moment anything looks at it
 * (D38, 2026-11-01). Such a pin runs its poll under a long deadline on purpose — that is what "not polled to the
 * deadline" means — so if the read seam regresses (ui-tree/read-tree.ts#readTreeOrMiss takes the error for a miss)
 * the poll would spin to that deadline, starve its worker, and so time out and fail its neighbours too.
 *
 * Why a poisoned TREE and not a read that throws: under exactly that regression the seam catches whatever the read
 * throws and polls on, so a thrown bound would be swallowed like the error it guards. The poll's predicate (or the
 * scroll loop, the resolver, the flow engine's detect) is outside the seam, and an error it throws ends the poll at
 * once (read-tree.ts#pollTree). So the regression fails that test alone, at once, under any sleep and any deadline,
 * naming the cause. `then` stays undefined so the tree can be awaited as a read's result.
 */
export function boundReads<A extends unknown[]>(limit: number, read: (...args: A) => Promise<UiNode>): (...args: A) => Promise<UiNode> {
  let reads = 0;
  return async (...args: A) => (++reads > limit ? polledPast(reads, limit) : read(...args));
}

function polledPast(read: number, limit: number): UiNode {
  const stop = (): never => {
    throw new Error(`polled past a terminal read (read ${read}; the test expects at most ${limit})`);
  };
  return new Proxy({} as UiNode, {
    get: (_target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : stop()),
    has: stop,
    ownKeys: stop,
  });
}
