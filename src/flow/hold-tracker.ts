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
   * One fresh read, at `nowMs` (the clock the poll's deadline uses): its tree, or `undefined` for a read that FAILED.
   * Returns how long the tree has held — since the first read of that tree in an unbroken run — once that is at least
   * `holdMs`; otherwise undefined. The run is broken, and starts at the next rendered read, by a tree with another
   * `treeFingerprint`, a BARE tree (the screen went back to decor: it did not hold), a tree that shows a progress
   * indicator (`showsProgress`: a spinner keeps one fingerprint while it loads, so a screen saying it is still loading
   * never holds), and a failed read (code review, 2026-10-31: the same tree before and after reads that saw nothing
   * did not provably hold across them — "held across reads spanning `holdMs`" means reads that each saw it).
   *
   * Not shown, and so not counted either way: a handed-on read (ADR 0030 — the probe asks it `yes` alone).
   *
   * The known gap, backlog row D27: a loading screen whose indicator a tree source does not report as `progress`
   * holds like any other. On iOS through WDA an XCUI ActivityIndicator — React Native's ActivityIndicator — maps to
   * `other` (the type is not in adapters/ios-node.ts#IOS_ROLE_MAP, which wda-source.ts extends; only
   * ProgressIndicator is `progress`), so it does not break a hold there.
   */
  observe(tree: UiNode | undefined, nowMs: number): number | undefined;
}

/**
 * A `HoldTracker` that ends a run once it has held `holdMs` (the ladder passes reachRecheckMs).
 * Pure: no clock, no device.
 */
export function holdTracker(holdMs: number): HoldTracker {
  let run: { fingerprint: string; since: number } | undefined;
  return {
    observe(tree, nowMs) {
      if (tree === undefined || isBareTreeMemo(tree) || showsProgress(tree)) {
        run = undefined;
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
  };
}
