import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FOCUS_TEXT_NOT_READ } from '../../src/interact/fill-text.js';
import { boundText, HEDGE_WHATS, HEDGED_LEAD, type HedgeWhat, TREE_READ_FAILED, UNTRIED_END, UNTRIED_LEAD } from '../../src/interact/scroll-text.js';
import { ACTIVE_WINDOW_HINT, COVERED_FIRST, IDB_UNLISTS, KEYBOARD_UNLISTED, NO_ID_LISTED } from '../../src/ui-tree/miss.js';
import { UNLOCATED_KEYBOARD } from '../../src/ui-tree/keyboard-cover.js';
import type { Flush } from '../../src/interact/flush-check.js';
import { untriedSideText } from '../../src/interact/target-text.js';
import { EDGES, rectText } from '../../src/ui-tree/geometry.js';
import type { Rect } from '../../src/adapters/types.js';
import type { Direction } from '../../src/ui-tree/sides.js';
import { escapeRegExp } from '../../src/verify/text-hint.js';

/**
 * averi's reply wording, read in ONE place: every judge that reads what averi said — the replayed golden
 * (scripts/differential/golden-spec, golden.ts) and the live one (live.ts, live-visibility.ts, live-forms.ts) — reads
 * it through these, and nothing else in those judges tests a reply's words but the reads live-forms.ts's header names
 * (ADR 0020's A14 amendment). A rewording of averi's replies is fixed here, beside the src line that writes each one.
 * What a reply DID (the taps and swipes the device was sent) is not a reply's wording: golden-spec/judges.ts reads
 * that from the fake device's log, live-visibility.ts from the app's.
 *
 * Everything here takes the reply as averi returned it: its text, `ERROR ` prefixed when the tool call was an error
 * (differential.ts and live.ts#callTool both spell it so).
 */

// --- a reply as the live harnesses read it ---

/**
 * One tool call through a real MCP client, its reply as the judges read it: the text blocks joined (any other block
 * `[<type>]`), `ERROR ` prefixed when the call was an error, `ERROR (thrown) …` when the client threw (a timeout, a
 * closed transport). The live golden (live.ts) and the performance baseline (scripts/perf/baseline.ts) call through it.
 */
export async function callReply(client: Client, name: string, args: Record<string, unknown>, timeoutMs = 300_000): Promise<string> {
  try {
    const r = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
    const text = (r.content as { type: string; text?: string }[]).map((c) => (c.type === 'text' ? c.text ?? '' : `[${c.type}]`)).join('\n');
    return `${r.isError === true ? 'ERROR ' : ''}${text}`;
  } catch (e) {
    return `ERROR (thrown) ${(e as Error).message}`;
  }
}

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
export const isError = (reply: string | undefined) => reply?.startsWith('ERROR') === true;

/**
 * scroll_until stopped on its target: `Element … visible after N swipes` — plain, `fully visible`, the eyes unjudged
 * (`fully visible by the tree after`), or hedged (`visible [by the tree ]after N swipes, NOT CONFIRMED …`, T17).
 */
export const VISIBLE_STOP = /^Element .* visible (?:by the tree )?after /;

/**
 * A `fully: true` stop whose opening claims nothing whole or uncovered (T17, ADR 0013's T17 amendment), read apart:
 * src's lead `Element … visible [by the tree ]after N swipes, NOT CONFIRMED <what>: …` (scroll-text.ts
 * #describeScrollResult, its words `HEDGED_LEAD` and `HEDGE_WHATS`), `preT17: false`; or the pre-T17 opening the committed
 * live records hold (the t11/t12 records, tests/fixtures/d59-b9-lazy-predrag.json), `fully visible [by the tree ]after
 * N swipes[, judged above …]; but …` — always a flush hedge, so `WHOLE`, `preT17: true`. Undefined on any other reply.
 */
export interface HedgedLead {
  readonly what: HedgeWhat;
  readonly preT17: boolean;
}
// Longest first, so no alternative is read as a shorter one's prefix: belt and braces, since the `): ` after the group
// makes the regex backtrack to the longest anyway (T13: the sort's mutants survive, equivalent).
const HEDGE_WHAT_PATTERN = [...HEDGE_WHATS].sort((a, b) => b.length - a.length).join('|');
const HEDGED_STOP = new RegExp(`^Element .* visible (?:by the tree )?after \\d+ swipes?, ${HEDGED_LEAD} (${HEDGE_WHAT_PATTERN}): `);
const OLD_HEDGED_STOP = /^Element .* fully visible (?:by the tree )?after \d+ swipes?[^;]*; but /;
export function hedgedLead(reply: string): HedgedLead | undefined {
  return hedged(reply)?.lead;
}

/** `hedgedLead`, with the reply's words after it: the hedge's clauses, first. */
function hedged(reply: string): { lead: HedgedLead; clauses: string } | undefined {
  const lead = HEDGED_STOP.exec(reply);
  if (lead !== null) return { lead: { what: lead[1] as HedgeWhat, preT17: false }, clauses: reply.slice(lead[0].length) };
  const old = OLD_HEDGED_STOP.exec(reply);
  return old === null ? undefined : { lead: { what: 'WHOLE', preT17: true }, clauses: reply.slice(old[0].length) };
}

/** What `hedgeWhy` reads a hedged stop's reason as (T15): every unchecked flush `why`, and the unlocated keyboard. */
export const HEDGE_WHYS = ['held', 'budget', 'room', 'axis', 'tap', 'fills', 'keyboard'] as const;
export type HedgeWhy = (typeof HEDGE_WHYS)[number];
/** A flush edge no probe checked: its `why`, src's (src/interact/flush-check.ts, `Flush`). */
type UncheckedWhy = Extract<Flush, { checked: false }>['why'];
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Holds<T extends true> = T;
/** Compile-time: HEDGE_WHYS less `keyboard` is src's set of unchecked `why`s, so a `why` src adds or drops fails tsc here. */
export type HedgeWhysAreSrcs = Holds<Equals<Exclude<HedgeWhy, 'keyboard'>, UncheckedWhy>>;
/** The flush clause's reason, in flushText's words for each `why`, read in the clause before ` — it may be cut there`. */
const FLUSH_WHYS: readonly (readonly [UncheckedWhy, RegExp])[] = [
  ['held', /, and a swipe toward it showed \d+ px more of it, then 2 swipes after it moved nothing — the content ended there or the app did not take them/],
  ['budget', /, and no swipe or time was left to check it/],
  ['room', /, and no scroll container around it has room for a probe swipe to check it/],
  ['axis', new RegExp(`, so no probe swipe can move its (?:${EDGES.join('|')}) edge into view to check it`)],
  ['tap', /, and the probe swipe was too short to tell from a tap/],
  ['fills', /it (?:fills|spans) its scroll container /],
];
/**
 * Why a hedged stop (`hedgedLead`) is hedged, T15: the `why` of the flush edge no probe checked (src/interact/
 * flush-check.ts#Flush, its clause scroll-text.ts#flushText) — `held` (a swipe showed more, then two moved nothing),
 * `budget`, `room`, `axis`, `tap`, `fills` (both edges on the container's) — or `keyboard`, a soft keyboard the window
 * state gives no area (the `UNCOVERED` hedge alone). A `WHOLE OR UNCOVERED` hedge reads its flush reason: the cut is
 * the claim the eyes can measure, the keyboard's beside it. Undefined on a reply not hedged, and on a hedge whose
 * clause names no reason src writes — a rewording read nowhere rather than guessed.
 */
export function hedgeWhy(reply: string): HedgeWhy | undefined {
  const stop = hedged(reply);
  if (stop === undefined) return undefined;
  if (stop.lead.what === 'UNCOVERED') return stop.clauses.startsWith(UNLOCATED_KEYBOARD) ? 'keyboard' : undefined;
  const [clause, ...after] = stop.clauses.split(' — it may be cut there');
  return after.length === 0 ? undefined : FLUSH_WHYS.find(([, words]) => words.test(clause))?.[0];
}

/** A hedged `fully: true` stop (`hedgedLead`), of either form: a stop, never a claim. */
export const fullyHedged = (reply: string) => hedgedLead(reply) !== undefined;

/** The hedge covers a cut (`WHOLE`, alone or with `UNCOVERED`): what a flush edge no probe checked leaves unconfirmed. */
export const hedgesCut = (lead: HedgedLead | undefined): boolean => lead !== undefined && lead.what !== 'UNCOVERED';

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
 * The call failed on not finding its target: `notInTree`, or a flow's `wait:` that timed out on it
 * (src/ui-tree/read-tree.ts:192, "Timed out after Nms waiting for element X" — no "to appear", so not `notInTree`, and
 * not a reply kind of its own: the ratchets' kinds stay as recorded). The live forms cases c5–c7 (live-forms.ts#judgeMissUnderSheet) ask it.
 */
export const missedTarget = (reply: string) => notInTree(reply) || /^ERROR Timed out after \d+ms waiting for element /.test(reply);

/**
 * ensure_state's held "no" (D2, docs/adr/0033-a-held-rendered-no-ends-the-second-look-before-a-cheap-rung.md): the trace
 * line a second look the hold ended writes before its rung (src/flow/engine.ts:772, "second look: not detected, the
 * screen held still <s> — running <rung> before the <window> window's end") — how long the screen held and the rung it
 * ran; undefined when the reply has none (a look that ran its full window, or none at all). The live ensure cases
 * (live-ensure.ts) ask it.
 */
export function heldStill(reply: string): { heldS: number; flow: string } | undefined {
  const m = /second look: not detected, the screen held still ([\d.]+) s — running (\S+) before /.exec(reply);
  return m === null ? undefined : { heldS: Number(m[1]), flow: m[2] };
}

/**
 * ensure_state's ENTRY probe read only bare trees — the evidence that a second look was earned (src/flow/engine.ts
 * #detects: `⚠ detect: <condition> treated as not detected — every UI tree read was bare, …`). The second look's own bare
 * line names itself (`… (second look over 20 s) — …`) and a failed read says `last UI tree read failed`: neither counts.
 * Only the trace's FIRST line is the entry probe's (FlowEngine.run logs an `environment …` line before it, if any): a
 * rung's re-check later writes the same bare line, which says nothing of the entry. Both readers are pinned against
 * the engine's own trace (tests/truth/live-ensure-engine.test.ts).
 */
export function bareEntry(reply: string): boolean {
  const first = reply.split('\n').find((line) => !line.startsWith('environment '));
  return first !== undefined && /^⚠ detect: .* treated as not detected — every UI tree read was bare\b/.test(first);
}

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
 * tool-text.ts: a fill whose read-back did not confirm it says so) — the live forms cases' claim (live-forms.ts#holds).
 */
export const claimsDone = (reply: string) => /^(Filled|Cleared|Tapped)/.test(reply) && !/NOT verified/.test(reply);

// --- what a reply says beyond its kind ---

/**
 * A fill's reply hedges its Filled on a ⚠ line of its own: the field's text after focus was not read, so it may not all
 * come from the keys (D64b-3, fill-text.ts's `focus-unread` caveat). Only a line that starts `⚠ ` counts, so a selector
 * the head echoes is no hedge, and no more is a plain Filled. What it is worth is live-forms.ts#refusedOnFocus's to say.
 */
export const focusTextNotReadSaid = (reply: string) =>
  claimsDone(reply) && reply.split('\n').some((line) => line.startsWith('⚠ ') && line.includes(FOCUS_TEXT_NOT_READ));

/** The reply's first line — an assert's first verdict line, under its `N/N asserts …` summary — at most 200 characters. */
export const firstLine = (reply: string) => {
  const lines = reply.split('\n');
  return (ASSERT_SUMMARY.test(lines[0]) && lines.length > 1 ? lines[1] : lines[0]).slice(0, 200);
};

/** The reply without the selectors it echoes: `id:"lab.form-keyboard.vs"` must not read as the word keyboard. */
export const ownWords = (reply: string) => reply.replace(/\b[a-z]+:"(?:[^"\\]|\\.)*"/gi, '<selector>');

/**
 * The reply's remedy for a target under a presented screen, in its own words: "<a layer> is presented over it (or the
 * element) … — close it first" (src/ui-tree/standing.ts#presentedRemedy, and #presentedStop, which ends with it). Not
 * the conditional active-window hint, whose "close it first" follows "if a sheet or a dialog is open" (`windowHintSaid`):
 * that one says a window MAY hide the target, this one that one does.
 */
export const presentedRemedySaid = (reply: string) => /is presented over (?:it|the element)\b[^\n]*? — close it first/.test(reply);

/**
 * The reply carries the active-window hint (src/ui-tree/miss.ts#ACTIVE_WINDOW_HINT, imported, not copied):
 * uiautomator's not-found on a tree that marks no presented window — "the tree lists only the active window: if a sheet
 * or a dialog is open over the screen, close it first", a possibility, never the presented remedy.
 */
export const windowHintSaid = (reply: string) => reply.includes(ACTIVE_WINDOW_HINT);

/**
 * The reply names idb's limit on a read that lists no identifier (src/ui-tree/miss.ts#NO_ID_LISTED, imported, not
 * copied): "idb's read lists no id on any element". Keyed on the fact, not on the remedy it ends with
 * (miss.ts#TREE_SOURCE_REMEDY), which the note of an id unlisted among others (`idUnlisted`) says too.
 */
export const noIdListedSaid = (reply: string) => reply.includes(NO_ID_LISTED);

/**
 * The reply carries idb's reasons for a miss, as both of its dialect notes say them (src/ui-tree/miss.ts#missNote,
 * `noIdListed` and `idUnlisted`): why an idb list may lack the element (miss.ts#IDB_UNLISTS: nothing beneath the
 * keyboard or a presented sheet, alert or cover) and the way out (miss.ts#COVERED_FIRST: "If something covers it,
 * close that first") — both imported, not copied.
 */
export const idbReasonsSaid = (reply: string) => reply.includes(IDB_UNLISTS) && reply.includes(COVERED_FIRST);

/**
 * scroll_until's changed stop (src/interact/scroll-text.ts#changedText, scroll-rounds.ts#ScreenChange): its swipe
 * replaced the screen — "stopped after N swipe(s) — the swipe CHANGED THE SCREEN: …" — and nothing found after it is
 * claimed. In its own words, not in a selector it echoes.
 */
export const screenChangedSaid = (reply: string) => /stopped after \d+ swipes? — the swipe CHANGED THE SCREEN: /.test(ownWords(reply));

/**
 * The reply names scroll_until as the remedy (the off-screen, outside-its-scroll-view and sliver refusals do: src/
 * interact/tap-judgement.ts:336, "scroll_until it first") — in its own words, not in a selector it echoes.
 */
export const scrollAdvice = (reply: string) => /scroll_until/.test(ownWords(reply));

/** The reply names the soft keyboard in its own words — a tap refused under it (golden-spec/forms.ts's under-keyboard row). */
export const namesKeyboard = (reply: string) => /\bsoft keyboard\b/i.test(ownWords(reply));

/**
 * The tap's and fill's wait names the soft keyboard as what idb lists nothing beneath (src/interact/target-text.ts
 * #keyboardMayCoverText, D32 K1): the soft keyboard named and src/ui-tree/miss.ts#KEYBOARD_UNLISTED's words, imported.
 */
export const keyboardUnlistedSaid = (reply: string) => namesKeyboard(reply) && ownWords(reply).includes(KEYBOARD_UNLISTED.idb);

/**
 * averi's reply for a tap it moved off a node's centre to an uncovered piece (src/interact/tap-judgement.ts:325,
 * `Aim.moved`): `Tapped <selector> at (x,y) — its centre (x,y) is under …; tapped the uncovered part WxH`
 * (golden-spec/base.ts#atProbe) — read in its own words.
 */
const MOVED_TAP = / at \(-?[\d.]+,-?[\d.]+\) — its centre \(-?[\d.]+,-?[\d.]+\) is .*; tapped the uncovered part \d+x\d+/;
export const movedTap = (reply: string) => MOVED_TAP.test(ownWords(reply));

/** The checked flush clause's claim, both forms (`flushProbesSaid`): "a probe swipe" (before T12), or "n probe swipes" — n its second group. */
const PROBES_HELD = /(a probe swipe|(\d+) probe swipes) toward it moved nothing/;

/**
 * The side of a flush edge the `fully` stop says it probed (src/interact/scroll-text.ts#flushText, the wording since
 * 9c7885e: "its <side> edge lies on its scroll container's (…), and a probe swipe toward it moved nothing" — or, at a
 * node pinned in it (VA1), "its <side> edge lies on the edge of <node> (…), pinned at its scroll container's (…) <side>
 * and drawn after it, and a probe swipe toward it moved nothing"; since T12 "2 probe swipes toward it moved nothing",
 * both read, as records keep the older), or undefined when it says none
 * (golden-spec/rows.ts#flushProbe).
 */
export function flushProbedSide(reply: string): 'top' | 'bottom' | 'left' | 'right' | undefined {
  return new RegExp(`its (top|bottom|left|right) edge lies on (?:its scroll container's|the edge of) .*${PROBES_HELD.source}`).exec(reply)?.[1] as 'top' | 'bottom' | 'left' | 'right' | undefined;
}

/**
 * How many probes the checked flush clause claims moved nothing (src/interact/scroll-text.ts#flushText): 1 for "a probe
 * swipe toward it moved nothing" (before T12), n for "n probe swipes toward it moved nothing" (since); undefined when
 * the reply says neither.
 */
export function flushProbesSaid(reply: string): number | undefined {
  const m = PROBES_HELD.exec(reply);
  return m === null ? undefined : m[2] === undefined ? 1 : Number(m[2]);
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

// --- a carousel's `fully: true` reply (T7a, the carousel group: live-carousel.ts) ---

/**
 * The bound's own words, derived from src's exported builder (src/interact/scroll-text.ts#boundText: `after N swipes
 * (maxSwipes)`): its parenthesis.
 */
const bound = boundText({ of: 'maxSwipes' }, 1);
export const MAX_SWIPES = bound.slice(bound.indexOf('('));

/**
 * The other words carouselReply keys on, pinned, each as src/interact/scroll-text.ts writes it: no export there
 * produces them alone — they are inline in unexported builders (#unaimableText, #unfitText, #flushCutText) reached only
 * through a whole ScrollOutcome, or (the held hedge) inside #flushText's sentence around a container's rect — so
 * tests/truth/replies.test.ts holds each one to that file and drives the builders that write them. The unaimable
 * stop's end (D68), the unfit stop's remedy (D52), the flush cut a probe proved (the hedge D62 keeps), the inferred
 * axis (D59), and the hedge on two held reveals (T11). The unchecked flush clause (`it may be cut there`) is no longer
 * keyed on: since T17 a hedged stop's lead says it (`fullyHedged`, which reads the pre-T17 records' `; but` too).
 */
export const CAROUSEL_REPLY_WORDS = [
  'more swipes are unlikely to help',
  '— drop fully: true, or accept what it shows',
  'so it may still be cut there',
  '(the tree does not say which way it scrolls: ',
  'the content ended there or the app did not take them',
] as const;
const [UNAIMABLE, UNFIT, PROVEN_CUT, INFERRED_AXIS, HELD_CUT] = CAROUSEL_REPLY_WORDS;

/**
 * What a carousel's `scroll_until … fully: true` replied, from a closed set (T7a; the carousel judges read it): `unaimable`
 * (D68's stop: no swipe can bring it whole, the round sent nothing more — it says "drop fully: true" too, so it is
 * asked first), `unfit` (D52's: as wide as its scroll view), `maxSwipes-hedged` (the bound, with the flush cut a probe
 * proved: "may still be cut there" — D62's honest end and ADR 0021's residual), `fully-visible` (the stop claimed whole,
 * by the tree or the eyes, its lead no hedge — `fullyHedged`, T17 — batch-9's false pass reads so),
 * and `other` (a bound without that hedge, a stuck stop, a plain stop, any other error).
 */
export type CarouselReply = 'unaimable' | 'unfit' | 'maxSwipes-hedged' | 'fully-visible' | 'other';
export function carouselReply(reply: string): CarouselReply {
  if (isError(reply)) {
    if (reply.includes(UNAIMABLE)) return 'unaimable';
    if (reply.includes(UNFIT)) return 'unfit';
    if (reply.includes(MAX_SWIPES) && reply.includes(PROVEN_CUT)) return 'maxSwipes-hedged';
    return 'other';
  }
  return /^Element .* fully visible (?:by the tree )?after /.test(reply) && !fullyHedged(reply) ? 'fully-visible' : 'other';
}

/** A stop hedged on a cut a swipe proved and two swipes after it that moved nothing (T11, scroll-text.ts#flushText's `held`): it claims nothing whole. */
export const heldCutHedged = (reply: string) => reply.includes(HELD_CUT);

/** The unfit stop says the tree told no axis of its scroll view, the swipes over it did (D59: scroll-text.ts#unfitText). */
export const inferredAxisSaid = (reply: string) => reply.includes(INFERRED_AXIS);

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

// --- the live forms and turn judges' words (live-forms.ts, live-visibility.ts) ---

/**
 * The words the live forms judges and the Android turn judge key on, pinned, each as src writes it: the src file that
 * writes each one is tests/truth/replies.test.ts#WRITTEN_IN's, which holds each word to that file's code.
 */
export const LIVE_REPLY_WORDS = [
  'Refused before anything was sent',
  'did not change',
  'scroll_until it out from under',
  'dismiss it first',
  'PARTLY UNDER a surface',
  'direction: "',
] as const;
const [UNSENT, UNCHANGED, OUT_FROM_UNDER, DISMISS_FIRST, BAND, DIRECTION] = LIVE_REPLY_WORDS;

/** A typing refusal says nothing was sent (D43a: live-forms.ts#refusedKept). */
export const refusedUnsentSaid = (reply: string) => reply.includes(UNSENT);

/**
 * What a fill's error says of a field the typing left as it was (src/interact/fill-text.ts's `unchanged` caveat, "the
 * field did not change: …"): the phrase live-forms.ts#refusedUnchanged and #refusedOnFocus ask. Bare, so it also
 * accepts the deletes' sentence (fill-text.ts, "… that the deletes did not change") and scroll_until's "did not change
 * the screen"; tightening it to "the field did not change" would be a judge change, not this read's move here.
 */
export const UNCHANGED_SAID = UNCHANGED;

/** A refusal names the remedy for a field under a bar: scroll it out from under, or dismiss the keyboard first (live-forms.ts#judgeNoteFill). */
export const underBarRemedySaid = (reply: string) => reply.includes(OUT_FROM_UNDER) || reply.includes(DISMISS_FIRST);

/** The eyes' band over a stop's target: "PARTLY UNDER a surface the tree does not list: …" (live-forms.ts#judgePhoneScroll). */
const BAND_SAID = new RegExp(`\\b${escapeRegExp(BAND)}\\b`);
export const bandSaid = (reply: string) => BAND_SAID.test(reply);

/**
 * The reply names `direction` to scroll: `direction: "up"` (live-visibility.ts#judgeAndroidTurn). The producer judged
 * is src/ui-tree/sides.ts#revealText (`scroll_until it with direction: "up"`), the pin's anchor; untriedSideText
 * (src/interact/target-text.ts) and scroll-text.ts's turn-back sentence (`— try direction: "<back>"`) write the
 * fragment too, unpinned. Not derived from revealText: that would narrow the judge.
 */
export const directionNamed = (reply: string, direction: Direction) => reply.includes(`${DIRECTION}${direction}"`);

/**
 * scroll_until's own refusal (src/interact/scroll-text.ts: `scroll_until <target> failed …` / `stopped …`, the tool's
 * ERROR prefix before it), not the device failing its tree read (TREE_READ_FAILED) and not another tool error
 * (live-forms.ts's kf3).
 */
export const scrollVerdictSaid = (reply: string): boolean => /^ERROR scroll_until [^\s:]/.test(reply) && !reply.includes(TREE_READ_FAILED);

/**
 * A scroll_until failure that names a side it never read: `if it lies above, try direction: "up"` (src/interact/
 * target-text.ts#untriedSideText, each side's sentence built by it, not copied) — false of a list that never moved
 * (live-visibility.ts#judgeAbsentAtEnd). Deliberately exact: A14 asked to derive it, and untriedSideText is its only
 * producer, so the whole sentence is matched. Unlike directionNamed, kept wide (the `direction: "…"` fragment, which
 * three producers write) so as not to narrow its judge: this one derives every word it reads, that one pins a
 * fragment.
 */
const UNTRIED_SIDES = EDGES.map(untriedSideText);
export const untriedSideSaid = (reply: string) => UNTRIED_SIDES.some((words) => reply.includes(words));

/** A rect as averi's replies quote it: src/ui-tree/geometry.ts#rectText's `x,y wxh`, not a copy. */
export const replyRect = rectText;

/**
 * A scroll_until stop names the scroll view of `rect` among those the swipes did not go over (D76,
 * src/interact/scroll-text.ts#besideText): `(x,y wxh)` between UNTRIED_LEAD and UNTRIED_END, both src's words — not
 * the rect quoted elsewhere (the scroll view swiped, a miss's scroll view), nor past that clause. Bounded by
 * UNTRIED_END, not the first dash: a node's label may hold one.
 */
export function namesUntried(reply: string, rect: Rect): boolean {
  const lead = reply.indexOf(UNTRIED_LEAD);
  if (lead < 0) return false;
  const from = lead + UNTRIED_LEAD.length;
  const end = reply.indexOf(UNTRIED_END, from);
  return end >= 0 && reply.slice(from, end).includes(`(${rectText(rect)})`);
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

/**
 * An OCR assert that could not read at all on this host — src/verify/ocr.ts's fail-closed lines, word for word: no
 * Vision here (ocrUnavailableReason), no swiftc (the probe), a recognizer that did not compile, or one that ran and
 * whose Vision request failed (the Swift helper's `recognizer failed: <error>`; in a sandbox Vision answers nilError).
 * Nothing else: an OCR that read other text is a failed assert. tests/truth/replies.test.ts pins each in the source.
 */
export const OCR_FAILED_CLOSED = /OCR needs the macOS Vision framework|OCR needs the Swift compiler|the OCR recognizer did not compile|recognizer failed: /;

// --- T7b: launch_app's and open_deep_link's replies, read by the chooser group (live-chooser.ts) ---

/**
 * The app launch_app's headline names: `Launched <app>[/<Activity>] on <platform>[ (state cleared)]` on the reply's first
 * line (src/mcp/tool-text.ts#launchText, flow/launch.ts#launchedLine); undefined for any other reply, an error included.
 */
export const launchedAs = (reply: string): string | undefined => /^Launched (\S+) on (?:android|ios)\b/.exec(reply.split('\n')[0])?.[1];

/**
 * The chooser a reply names in front, by its component: a launch's ⚠ line and a link's headline alike ("its chooser
 * (<component>) is in front", src/interact/app-holder-text.ts#chooserText, with D55c's sheet or without); undefined when
 * the reply names none.
 */
export const chooserSaid = (reply: string): string | undefined => /\bits chooser \(([^\s()]+)\) is in front\b/.exec(reply)?.[1];

/** open_deep_link's headline is the chooser, not `Opened` (src/mcp/tool-text.ts#deepLinkText: a holder named leads). */
export const linkHeldSaid = (reply: string): boolean => /^Android has not opened \S+ yet: its chooser \(/.test(reply);

/** The reply carries a ⚠ line under its headline (src/mcp/tool-text.ts#warnLine, and the `⚠ clearState` line). */
export const warnedSaid = (reply: string): boolean => /\n⚠ /.test(reply);
