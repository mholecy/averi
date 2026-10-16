/**
 * averi's reply wording that both judges read — the replayed golden (scripts/differential/golden-spec) and the live one
 * (live.ts, live-visibility.ts): spelled once, so a rewording of averi's replies is fixed in one place. Nothing in
 * those judges tests a reply's opening words but through these.
 */

/** The reply claims the tap: `Tapped …` (src/mcp/tool-text.ts), not an error. */
export const claimsTap = (reply: string) => reply.startsWith('Tapped');

/** A one-assert call passed: its summary `All 1 asserts passed` (every golden and live assert asks one). */
export const allPassed = (reply: string) => reply.startsWith('All 1 asserts passed');

/** An assert call failed: its summary `N/M asserts FAILED`. */
export const ASSERTS_FAILED = /^\d+\/\d+ asserts FAILED/;

/** An assert call's summary line (`N/M asserts …`, `All N asserts …`), above its first verdict line. */
export const ASSERT_SUMMARY = /^\d+\/\d+ asserts|^All \d+ asserts/;

/** averi refused or failed: `ERROR …` — a refusal, a timeout, a stop that gave up. */
export const isError = (reply: string) => reply.startsWith('ERROR');

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
