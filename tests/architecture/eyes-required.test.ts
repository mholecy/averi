import { describe, expectTypeOf, it } from 'vitest';
import type { FillOptions } from '../../src/interact/fill.js';
import type { ScrollOptions } from '../../src/interact/scroll.js';
import type { TapOptions } from '../../src/interact/tap.js';
import type { Eyes, OrderEyes } from '../../src/ui-tree/eyes.js';

/**
 * A30 (ADR 0024, amendment A30): the verbs that ask the eyes take them as a REQUIRED option, so a caller cannot forget
 * them — the composition root (mcp/tools.ts, flow/engine.ts) wires verify/eyes.ts#eyesOn, a test hands a fake
 * (tests/helpers/eyes.ts). Until A30 `eyes?` was optional at each verb, and a production site that forgot
 * `eyesOn(adapter)` typechecked and silently lost ADR 0024: the tap's order untold, `scroll_until`'s `fully visible`
 * said as the tree's, "no screenshot was taken".
 *
 * Type-level: `npm run lint` (tsconfig.test.json) is what fails, not the run — an optional `eyes` is `X | undefined`
 * here and `toEqualTypeOf` refuses it.
 */
describe('the verbs that ask the eyes require them (A30)', () => {
  it('tap: the order question', () => {
    expectTypeOf<TapOptions['eyes']>().toEqualTypeOf<OrderEyes>();
  });

  it('fill: the order question, as its focus tap asks it', () => {
    expectTypeOf<FillOptions['eyes']>().toEqualTypeOf<OrderEyes>();
  });

  it('scroll_until: both questions', () => {
    expectTypeOf<ScrollOptions['eyes']>().toEqualTypeOf<Eyes>();
  });
});
