/**
 * What one leg contributes to a parity table: its artifact — with any caveats
 * the measurement raised, which the table prints as notes — or why it cannot
 * contribute one.
 *
 * One type for the three dimensions: rect contributes the tree and the window
 * width judged at capture, color the measured frame, text its capture with the
 * OCR pass — and run/verify.ts's section loop reads them all through this
 * shape, so the producer in verify/ and the consumer in run/ share one
 * definition rather than two that happen to line up.
 *
 * The success arm has its own name because one producer — the text
 * measurement, which always has a tree to stand on — returns it alone, and
 * its tests read `.value` and `.notes` without narrowing.
 */
export interface Contributed<T> {
  value: T;
  /** Caveats the measurement raised; the table prints them as notes. */
  notes?: string[];
}

export type Contribution<T> = Contributed<T> | { note: string };
