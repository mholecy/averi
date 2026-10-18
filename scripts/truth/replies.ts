/**
 * averi's reply wording, read in ONE place: every judge that reads what averi said — the replayed golden
 * (scripts/differential/golden-spec, golden.ts) and the live one (live.ts, live-visibility.ts) — reads it through
 * these, and nothing else in those judges tests a reply's words. A rewording of averi's replies is fixed here, beside
 * the src line that writes each one. What a reply DID (the taps and swipes the device was sent) is not a reply's
 * wording: golden-spec/judges.ts reads that from the fake device's log, live-visibility.ts from the app's.
 *
 * Everything here takes the reply as averi returned it: its text, `ERROR ` prefixed when the tool call was an error
 * (differential.ts and live.ts#callTool both spell it so).
 */

// --- the kind of reply: one closed set, the ratchets pin it ---

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

/** The reply claims scroll_until's stop on its target (VISIBLE_STOP), fully or not. */
export const claimsVisible = (reply: string) => VISIBLE_STOP.test(reply);

/**
 * The reply says the element is not in the tree — no evidence of what covers it: the resolver's timeout (src/interact/
 * resolve.ts:358, "…waiting for element X to appear"), scroll_until's give-up (src/interact/scroll-text.ts:593,
 * "element never appeared in the tree"), the assert poll's (src/verify/poll-verdict.ts:78, "not found within N s"). Not
 * a timeout whose hint says the selector MATCHED nodes, none of them usable (src/interact/resolve.ts#ZERO_AREA_HINT and
 * the clipped-out hint: "it matched only 0×0 nodes …", "it matched only nodes clipped out above its scroll container …")
 * — the target is in the tree, refused for where it lies (edges/scroll-collapsing's A, its uiautomator bounds inverted:
 * calibration.json #10).
 */
export const notInTree = (reply: string) => /waiting for element .* to appear(?![\s\S]*\(it matched only )|never appeared in the tree|not found within/.test(reply);

/**
 * What kind of reply it is, from a closed set — recorded on every golden check (golden.ts), so a known mismatch whose
 * reply turns into another kind (a timeout into a refusal, a stop into `fully visible`) fails the ratchet though its
 * class and its device calls stay; and what the live judges classify a reply by (live-visibility.ts, LiveVerdict.kind).
 * `not found` (the target not in the tree: notInTree), `Tapped`, `visible` (scroll_until stopped on it), `PASS` and
 * `FAIL` (an assert's verdict), `refused` (any other ERROR), `other` — in that precedence: `not found` first, so a reply
 * that says the target never appeared is that, whatever else it opens with. The live judges test `Tapped` and `visible`
 * through it since round 5 (they read claimsTap and VISIBLE_STOP before): a `Tapped …` or `Element … visible …` reply
 * that also said "never appeared in the tree" or "waiting for element … to appear" would now count as no claim. No
 * committed live record holds one (the rejudges are unchanged); a claim that also says it never found its target is
 * no claim to hold the app to.
 */
export type ReplyKind = 'not found' | 'Tapped' | 'visible' | 'PASS' | 'FAIL' | 'refused' | 'other';
export function replyKind(reply: string): ReplyKind {
  if (notInTree(reply)) return 'not found';
  if (claimsTap(reply)) return 'Tapped';
  if (claimsVisible(reply)) return 'visible';
  if (allPassed(reply)) return 'PASS';
  if (ASSERTS_FAILED.test(reply)) return 'FAIL';
  if (isError(reply)) return 'refused';
  return 'other';
}

/**
 * A form call claims it did what it was asked: `Filled …`, `Cleared …`, `Tapped …`, and not `NOT verified` (src/mcp/
 * tool-text.ts: a fill whose read-back did not confirm it says so) — the live forms cases' claim (live.ts#holds).
 */
export const claimsDone = (reply: string) => /^(Filled|Cleared|Tapped)/.test(reply) && !/NOT verified/.test(reply);

// --- what a reply says beyond its kind ---

/** The reply's first line — an assert's first verdict line, under its `N/N asserts …` summary — at most 200 characters. */
export const firstLine = (reply: string) => {
  const lines = reply.split('\n');
  return (ASSERT_SUMMARY.test(lines[0]) && lines.length > 1 ? lines[1] : lines[0]).slice(0, 200);
};

/** The reply without the selectors it echoes: `id:"lab.form-keyboard.vs"` must not read as the word keyboard. */
export const ownWords = (reply: string) => reply.replace(/\b[a-z]+:"(?:[^"\\]|\\.)*"/gi, '<selector>');

/** The reply's remedy for a target under a presented screen (src/ui-tree/standing.ts:425-426, "— close it first"). */
export const closeFirst = (reply: string) => /close it first/.test(reply);

/**
 * The reply names scroll_until as the remedy (the off-screen, outside-its-scroll-view and sliver refusals do: src/
 * interact/tap-judgement.ts:336, "scroll_until it first") — in its own words, not in a selector it echoes.
 */
export const scrollAdvice = (reply: string) => /scroll_until/.test(ownWords(reply));

/** The reply names the soft keyboard in its own words — a tap refused under it (golden-spec/forms.ts's under-keyboard row). */
export const namesKeyboard = (reply: string) => /\bsoft keyboard\b/i.test(ownWords(reply));

/**
 * averi's reply for a tap it moved off a node's centre to an uncovered piece (src/interact/tap-judgement.ts:325,
 * `Aim.moved`): `Tapped <selector> at (x,y) — its centre (x,y) is under …; tapped the uncovered part WxH`
 * (golden-spec/base.ts#atProbe) — read in its own words.
 */
const MOVED_TAP = / at \(-?[\d.]+,-?[\d.]+\) — its centre \(-?[\d.]+,-?[\d.]+\) is .*; tapped the uncovered part \d+x\d+/;
export const movedTap = (reply: string) => MOVED_TAP.test(ownWords(reply));

/**
 * The side of a flush edge the `fully` stop says it probed (src/interact/scroll-text.ts:226-227, the wording since
 * 9c7885e: "its <side> edge lies on its scroll container's (…), and a probe swipe toward it moved nothing"), or
 * undefined when it says none (golden-spec/rows.ts#flushProbe).
 */
export function flushProbedSide(reply: string): 'top' | 'bottom' | 'left' | 'right' | undefined {
  return /its (top|bottom|left|right) edge lies on its scroll container's .*a probe swipe toward it moved nothing/.exec(reply)?.[1] as 'top' | 'bottom' | 'left' | 'right' | undefined;
}

/**
 * What a refused dismissal names as lying over it — `toolbar` (#7's first half: SwiftUI's screen-sized Toolbar host, #19's
 * bar), `scrollable` (#7's second half: a scroll view shorter than the screen, its frame over the title) — read from the
 * guard's own clause (src/interact/keyboard-in-tree.ts:361, `none of the configured dismissals is usable on this screen
 * (…)`, each skipped dismissal's `covered by <role> …` from :335-345), not from any "toolbar" in the reply: its advice
 * names the input-accessory toolbar whatever covered the dismissal (golden-spec/rows.ts#dismissRow). undefined: no such
 * clause.
 */
// Errs safe: a `)` inside an earlier part of the clause (a selector's text) ends the match before `covered by`, and
// the row then names no cover — the mismatch stays red, only its wording loses the role.
export const dismissalCover = (reply: string): string | undefined => /none of the configured dismissals is usable[^(]*\([^)]*covered by ([a-z]+)/.exec(reply)?.[1];

/**
 * A tap refused only after the configured dismissal hid the keyboard (src/interact/keyboard-in-tree.ts: `… was not
 * tapped: after <dismissal> was tapped … to hide the soft keyboard, …`) — the field then refused for where it lies once
 * the keyboard is gone (live-visibility.ts#judgeDismissal).
 */
export const refusedAfterDismissal = (reply: string) => /was not tapped: after .* was tapped .* to hide the soft keyboard/.test(reply);

// --- the numbers a reply counts ---

/**
 * How many times a scroll_until reply says averi turned its strokes round (`It was turned round 3 times`, the fling's
 * turns; `… so averi turned down`, ADR 0021's end turn, one): 0 when it says neither.
 */
export function turnsSaid(reply: string): number {
  const fling = /It was turned round (\d+) times?\b/.exec(reply);
  return (fling === null ? 0 : Number(fling[1])) + (/\bso averi turned (?:up|down|left|right)\b/.test(reply) ? 1 : 0);
}

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

// --- the ocr assert's readings ---

/** The ocr assert's fail-closed tail (src/verify/fail-closed.ts: `failing closed, rendered text unchecked`). */
export const failedClosedUnchecked = (reply: string) => /rendered text unchecked/.test(reply);

/** An ocr reply that read something (src/verify/text-parity.ts#evaluateOcrAssert: `read "…"`), failed closed or not. */
const READ = / read "/;

/** What an `ocr` reply read (src/verify/text-parity.ts#evaluateOcrAssert: `read "…"`), or undefined when it read nothing or failed closed. */
export function readingOf(reply: string): string | undefined {
  if (failedClosedUnchecked(reply)) return undefined;
  const m = / read ("(?:[^"\\]|\\.)*")/.exec(reply);
  return m === null ? undefined : (JSON.parse(m[1]) as string);
}

/** An `ocr` reply reports a reading (`read "…"`) without failing closed. */
export const readSomething = (reply: string) => !failedClosedUnchecked(reply) && READ.test(reply);

// --- ui_snapshot ---

/** A node of a filtered `ui_snapshot` reply (src/mcp/tools.ts ui_snapshot: the matched nodes, children stripped). */
export interface SnapshotNode {
  role: string;
  identifier: string | null;
  rect: { x: number; y: number; width: number; height: number };
  /** The field error averi paired with an input (src/adapters/field-errors.ts#attachFieldErrors); absent: none. */
  error?: string;
}

/**
 * The nodes a filtered `ui_snapshot` reply lists — its first block, the JSON array (a note, when there is one, follows
 * as a second block: tools.ts keeps "a parser of the first block sees what it always saw"); undefined for an error or a
 * reply whose first block is no array. The array is pretty-printed, so it ends at the first line that is `]` alone (or
 * is `[]`).
 */
export function snapshotNodes(reply: string): SnapshotNode[] | undefined {
  if (isError(reply) || !reply.startsWith('[')) return undefined;
  const end = reply.startsWith('[]') ? 2 : reply.indexOf('\n]') + 2;
  if (end < 2) return undefined;
  try {
    const nodes = JSON.parse(reply.slice(0, end)) as unknown;
    return Array.isArray(nodes) ? (nodes as SnapshotNode[]) : undefined;
  } catch {
    return undefined;
  }
}
