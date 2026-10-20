import type { UiNode } from '../../src/adapters/types.js';
import type { Cover, CoverOrder } from '../../src/ui-tree/cover.js';

/** The nodes of `covers`, in their order — for a test that asks only which nodes cover. */
export const coverNodes = (covers: readonly Cover[]): UiNode[] => covers.map((c) => c.node);

/** Each of `covers` as the sentences and the remedy read it: the node, its order's kind and whether it is a presented screen's surface. */
export const tagged = (covers: readonly Cover[]): { node: UiNode; order: CoverOrder['kind']; presented: boolean }[] =>
  covers.map(({ node, order, presented }) => ({ node, order: order.kind, presented }));
