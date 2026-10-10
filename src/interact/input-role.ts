/**
 * The normalised role of every text input — the one role a fill expects to
 * type into. Defined in adapters/types.ts beside UiNode since round 7 (review
 * of fix/r7-covers: ui-tree's draw order reads it too, and ui-tree sits below
 * interaction); re-exported here so the fill's modules keep their import.
 *
 * A leaf of its own (2026-10-09, code review of the fill-verdict branch):
 * fill.ts acts on it and fill-text.ts names it in the not-an-input
 * caveat's sentence. It sat in fill.ts until the caveat's sentence moved out, then
 * briefly in fill-verdict.ts — which made fill.ts import its own domain
 * constant from the judgement module.
 */
export { INPUT_ROLE } from '../adapters/types.js';
