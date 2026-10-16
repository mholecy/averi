/**
 * averi's reply wording that both judges read — the replayed golden (scripts/differential/golden-spec) and the live one
 * (live-visibility.ts): spelled once, so a rewording of averi's replies is fixed in one place.
 */

/** scroll_until stopped on its target: `Element … visible after N swipes` (plain or `fully visible`). */
export const VISIBLE_STOP = /^Element .* visible after /;

/** The swipes a scroll_until reply counts (`after N swipes`, `failed after N swipes`), undefined when it names none. */
export function swipesOf(reply: string): number | undefined {
  const m = /after (\d+) swipes?/.exec(reply);
  return m === null ? undefined : Number(m[1]);
}

/**
 * A scroll_until failure that says its last strokes changed nothing on the screen (src/interact/scroll-text.ts: "the
 * last N, swiping <dir>, did not change the screen") — the whole tree unchanged, the target not in it. The count of
 * those strokes, or undefined. (Not "did not move it": that is about the target, which another scroll view's motion
 * leaves where it was.)
 */
export function screenUnchangedFor(reply: string): number | undefined {
  const m = /the last (\d+), swiping \w+, did not change the screen/.exec(reply);
  return m === null ? undefined : Number(m[1]);
}
