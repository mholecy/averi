import type { UiNode } from '../adapters/types.js';
import { showsProgress, treeFingerprint } from '../ui-tree/read-tree.js';
import { isBareTreeMemo } from '../ui-tree/verdict.js';

/**
 * Has a rendered screen held still? The second look's early end before a cheap rung (D2, 2026-10-31,
 * docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-rung.md): `detects` shows it each fresh read
 * that did not answer "yes", and ends its window `no` once `observe` returns a number.
 */
export interface HoldTracker {
  /**
   * One fresh read, at `nowMs` (the clock the poll's deadline uses). Returns how long its tree has held — since the
   * first read of that tree in an unbroken run — once that is at least `holdMs`; otherwise undefined. The run is
   * broken, and starts at the next rendered read, by a tree with another `treeFingerprint`, a BARE tree (the screen
   * went back to decor: it did not hold), and a tree that shows a progress indicator (`showsProgress`: a spinner keeps
   * one fingerprint while it loads, so a screen saying it is still loading never holds).
   *
   * Not shown, and so not counted either way: a handed-on read (ADR 0030 — the probe asks it `yes` alone) and a read
   * that failed (it read nothing; the time still counts, from the first read of the run).
   *
   * The known gap: a loading screen whose indicator a tree source does not report as `progress` holds like any other.
   * On iOS through WDA an XCUI ActivityIndicator — React Native's ActivityIndicator — maps to `other` (the type is
   * not in adapters/ios-node.ts#IOS_ROLE_MAP, which wda-source.ts extends; only ProgressIndicator is `progress`), so
   * it does not break a hold there. Left for its own backlog row (the coordinator, D2 round-1 review).
   */
  observe(tree: UiNode, nowMs: number): number | undefined;
  /** Start over: the next rendered read begins a new run. */
  reset(): void;
}

/** A `HoldTracker` that ends a run once it has held `holdMs` (the ladder passes reachRecheckMs). Pure: no clock, no device. */
export function holdTracker(holdMs: number): HoldTracker {
  let run: { fingerprint: string; since: number } | undefined;
  const reset = (): void => {
    run = undefined;
  };
  return {
    observe(tree, nowMs) {
      if (isBareTreeMemo(tree) || showsProgress(tree)) {
        reset();
        return undefined;
      }
      const fingerprint = treeFingerprint(tree);
      if (run?.fingerprint !== fingerprint) {
        run = { fingerprint, since: nowMs };
        return undefined;
      }
      const held = nowMs - run.since;
      return held >= holdMs ? held : undefined;
    },
    reset,
  };
}
