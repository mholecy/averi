import type { Rect, Stroke } from '../adapters/types.js';
import { axisOfEdge, EDGES, flushEdges, quoted, sameRectWithinPixel, type Edge, type QuotedNode } from '../ui-tree/geometry.js';
import type { PinnedEdge } from '../ui-tree/later-edges.js';
import { probeOf } from './course.js';
import { strokeLine, type AppliedKeyboard, type Judged, type TreeFacts } from './scroll-read.js';
import { planProbe, probeAcrossOnly, type PlannedStroke, type StrokeMemory } from './stroke-plan.js';
import { axisOf, strokeLength, TOUCH_SLOP, type Direction } from './swipe.js';

/**
 * THE FLUSH CHECK of a `fully: true` stop, and its probe: whether a stop whose edge along the scroll lies on a clipping
 * scroll container's is cut there, asked of the device by one short stroke, and what that stroke proved. The round
 * (interact/scroll-rounds.ts#round) holds one, shows it each read that read once (`seeFlush`) and reads one verdict;
 * it sends the probe the verdict carries, and the stop, the stuck and the bound failures say what the verdict says.
 * What the probe touches down on and the box it is drawn over are the stroke plan's (interact/stroke-plan.ts#planProbe);
 * its way, reach and travel the course's (interact/course.ts#probeOf); whether a read may settle otherwise, the
 * round's and the motion ledger's.
 * docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md
 * docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md (refined 2026-10-20, 2026-10-23; D62 amendment)
 *
 * The interface, which is also the test surface (tests/interact/flush-check.test.ts; the wiring in the round's play
 * tables, tests/interact/scroll-flush-reveal.test.ts, scroll-rounds.test.ts — all of it but two guards no play reaches:
 * `waits` against a slowing read, which needs two settle reads in a row on a proven cut, and `probing` against the
 * carry sample, which only a tree listing the target where it lies offers — WDA's, where nothing clips):
 * - `startFlush(direction)` — the caller's direction, along whose axis alone a match is asked flush; no probe in
 *   flight, no cut proven.
 * - `seeFlush(check, stop)` — once per read that read: the judged match of a `fully: true` stop this read judges
 *   (`FlushStop`), or undefined when it judges none. Answers `FlushSeen`: the check after this read, whether the probe
 *   came back with the stop held still (`settles`), whether the read may wait for it to settle (`waits`), and the
 *   verdict (`FlushVerdict`).
 * - `probing(check)` — a probe is in flight: sent, and no read that read since — the read after it is the probe's.
 *
 * WHAT THE PROBE IS. The one short stroke (its reach course.ts#PROBE_REACH) a `fully: true` stop is answered with when
 * the judged match's edge along the scroll lies exactly — within a pixel — on its scroll container's edge
 * (`flushWith`). On Android that is where uiautomator cuts a node's bounds: a row half behind a pinned bar, or half
 * past the fold of a list with no chrome, or half below the display in an edge-to-edge scroller (the display clips
 * too), reads SHORTER, inside the container, with no edge past the viewport — measured: the SWIFT form's Fees row read
 * `{y:242, height:92}` of 143 against a container starting at 242, and was "fully visible after 0 swipes". The cut is
 * not in the tree, so it is asked of the device: a stroke TOWARD revealing that edge (content that lies up, for a top
 * edge — the finger moves down), drawn inside the container. Moves nothing: the content is at its end that way,
 * nothing lies beyond the edge, the stop is accepted as it stood (the first row of a list at rest is flush with its
 * container's top and is not cut). Moves it, and it lies flush on the same edge with more of it showing
 * (`revealedBy`): the cut is PROVED — content lay past that edge, and part of the match with it — so that read claims
 * no stop and confirms none (`FlushSeen.waits`): the next stroke is a REVEAL (course.ts#Revealing: the whole stroke,
 * its travel half the room the match leaves in that container, `roomPast`), a probe in every other respect. The proof
 * is kept while the match lies flush on that edge of that container (`ProvenCut`, `stillProven`), so no later read
 * claims it fully visible there either; with no reveal to send (no swipe or time left, or a tree changed since the
 * probe with no room or only a scroll view across the axis) the read is short of the cut (`FlushCut`), which the bound
 * or a stuck stop names — never "fully visible". Measured on the lab's bounded list
 * (docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md): a
 * 74-px probe moved S 57–61 px of its 154-px cut (21 or 38 on a loaded host), and quarter-strokes with a confirming
 * read each — ~5.1 s a round — ended cut at the deadline in 2 of the runs recorded. Moves it otherwise: the round
 * judges the new read like any other, and a stop flush again after it is a new candidate with a probe of its own.
 *
 * A REVEAL THAT MOVED NOTHING after a stroke that CARRIED the match its whole drawn length — less CARRY_LOSS, twice
 * the most a drag was measured to lose to the slop and the content's give — is DOUBTED once (D62): that stroke did not
 * end at the content's end, so the stillness after it says the app did not take the reveal, not that nothing lies past
 * the edge (measured, batch-9: a 142-px probe carried a carousel card 135 px, and the reveal after it was never
 * delivered — read as "fully visible"). No `checked`: the cut stays proven (`ProvenCut.carry` `doubted`) and the same
 * reveal is sent again, or, with none to send, the read is short of the cut. A second held reveal is checked; a held
 * reveal after a stroke that ran short (the content ended more than CARRY_LOSS before the stroke's end) and every
 * first probe that held are checked at once, as before. The doubt is the proof's, kept with it (`stillProven`): a read
 * between that moved the match without proving the cut anew (a stroke that was no reveal) leaves it owed, so the next
 * held reveal is doubted all the same — once per proof, at most one extra stroke. Cost: one stroke and one read, in
 * the doubted case only — a legitimate one too when the content ended within CARRY_LOSS of the stroke's end (a row cut
 * by 40 px, which a 74-px probe brings whole, pays one retry before `checked`, and at the bound fails hedged).
 * Residuals: a first probe the app did not take still reads checked (no stroke before it to doubt by); so does a
 * reveal dropped after a stroke that ran short for another reason (a loaded host), or two strokes dropped in a row.
 *
 * Toward the edge, never the caller's way (course.ts#probeOf). Along the scroll's axis only (the caller's
 * direction's): a vertical list's cell flush with the left edge of its container is the ordinary grid layout, and a
 * sideways stroke there could turn a page of a pager around it. Not when BOTH edges on the axis are flush — the match
 * fills its container, and one probe cannot tell which side, if either, is cut: unless an outer ancestor gives it a
 * one-edge flush (below), such a stop is reported unchecked, `flush.why` `fills` (`Flush`), and the reply says so. One
 * probe per candidate stop: a probe (or a reveal) after which the match is where it was settles it (`settles`).
 *
 * Every clipping ancestor, not the nearest alone: the match is flush with one of them on one edge — a card that fills
 * a carousel's height is flush with both of the carousel's edges, but the carousel is cut by the list around it, and
 * the card with it, on the list's edge — and the probe answers the nearest ancestor flush on ONE edge. Exempt only
 * when no ancestor is. The probe is drawn over that ancestor, or an outer one, whichever is the first with room for a
 * stroke (interact/stroke-plan.ts#planProbe) — a carousel cut to a 30-px strip has none, and a stroke there is a tap
 * on the card — room ABOVE the keyboard the probe keeps clear of (a list running on under the IME from 58 px above it
 * has room on the screen and none above the keyboard; a probe over the whole screen lands off the list and reports
 * "nothing of it is cut there"). When no ancestor has room (a lone 79-px scroller, that list), no probe is sent — over
 * the screen it would touch down off the container and move nothing whatever is cut — and the stop is reported with
 * `flush.checked` false. A probe drawn shorter than twice TOUCH_SLOP anyway (a tiny screen) never reports `checked`:
 * it may have been a tap that moved nothing.
 *
 * A node PINNED in the nearest scroll view counts as its edge (ui-tree/later-edges.ts#PinnedEdge,
 * `Scene.pinnedEdges`): Compose also subtracts what a later node covers, so a row under a merged sticky header pinned
 * at its list's top is dumped from the header's bottom — and so is a first row at rest, whole under it: the same tree
 * (measured, the lab's scroll-sticky-cut R `128,457 825x110` under the header `0,303 1080x154`;
 * docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md). The probe goes toward the header
 * from inside the list; the stop names it (`Flush.pinned`). At the content's start only (top, left), where a sticky
 * header pins: at the far edge that shape is the next row cut at the fold.
 *
 * Residuals, stated: Android's View bounds are cut to every ancestor, not only scrollers, and Compose also subtracts
 * what an overlay sibling covers — a row cut by a pinned bar drawn over the list reads cut at the bar's edge, not flush
 * with any scroller, so it is not probed (the bar itself is a cover, ui-tree/standing.ts#Scene's; a bar outside the
 * list is a flush neighbour, the eyes'); a RecyclerView with padding and clipToPadding draws a row cut at its padding
 * edge while the row's rect runs to the view's edge — not flush, not probed.
 *
 * Cost, stated: one stroke (it spends one of `maxSwipes` and counts in the reply's swipes), one settle and one tree
 * read — a probe that moves the match also its confirming read, unless it proved the cut — plus, on Android, what a
 * round's keyboard reading costs (ui-tree/keyboard-cover.ts) — on every `fully: true` stop flush with a clipping
 * container or under a node pinned in it, legitimate ones included (a first row at rest, under a sticky header or
 * not). iOS has no clipping container (types.ts#UiNode.clipsDescendants), so it never probes. At the bound — no swipe
 * or time left — a stop never probed is reported with `flush.checked` false and a sentence saying it may be cut; a cut
 * a probe proved is no stop (`FlushCut`).
 *
 * Pure: no adapter, no clock, no I/O.
 */

/**
 * A `fully: true` stop whose edge along the scroll lies on its scroll container's edge (`seeFlush`): `checked` when a
 * probe toward that edge moved nothing — nothing of it is cut there — and false, so it may be, `why`: no swipe or time
 * was left (`budget`); no clipping ancestor from the flush one outward has room for a stroke (`room`: a probe drawn
 * over the screen instead would touch down off the container and move nothing whatever lies beyond, so none is sent);
 * every one of them scrolls only across the edge (`axis`: a probe along it moves none of them —
 * interact/stroke-plan.ts#probeAcrossOnly); or the probe was drawn under twice TOUCH_SLOP and may have been a tap
 * (`tap`).
 *
 * `fills`: flush with BOTH of its nearest container's `edges` along the scroll, and with ONE edge of no clipping
 * ancestor — a row taller than its list, cut at both ends, reads exactly the list's rect. Never probed (one probe
 * cannot tell which side, if either, is cut), so never checked — and never a plain "fully visible".
 *
 * `pinned`: the flush edge lies not on the container's own edge but on the inner edge of a node pinned in it at that
 * side, drawn after the match (ui-tree/later-edges.ts#PinnedEdge: a merged sticky header) — the scroll view shows
 * nothing of its content past it, so it is that edge the probe asks about. With `fills`, the pinned one of the two is
 * always `edges[0]`: a node pins at the content's start only (top, left), and the far edge is the container's own.
 */
export type Flush =
  | ({ edge: Edge; container: Rect; pinned?: QuotedNode } & ({ checked: true } | { checked: false; why: 'budget' | 'room' | 'axis' | 'tap' }))
  | { edges: readonly [Edge, Edge]; container: Rect; pinned?: QuotedNode; checked: false; why: 'fills' };

/**
 * A `fully: true` match on a cut the flush check's probe PROVED (`ProvenCut`) that no reveal could be sent for this
 * read: it lies flush on that `edge` of that `container` (or `pinned` node), and the probe had shown `revealed` px more
 * of it — content lay past that edge, and part of the match with it. `why` no reveal showed the rest: no swipe or time
 * left (`budget`), no scroll container around it with room for one (`room`), or every one from that edge outward
 * scrolling only across it (`axis`) — those two only when the tree changed since the probe — or a reveal that moved
 * nothing drawn too short to tell from a tap (`tap`: the driver drew it under twice the slop). Never a stop: it is
 * what the target was short of, at the bound or a stuck stop, never "fully visible" with a hedge. The flush check's,
 * never scroll-read.ts#shortOf's: the tree alone reads it whole.
 * docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md
 */
export interface FlushCut {
  of: 'flushCut';
  judged: Judged;
  edge: Edge;
  container: Rect;
  pinned?: QuotedNode;
  revealed: number;
  why: 'budget' | 'room' | 'axis' | 'tap';
}

/**
 * A cut the flush check's probe PROVED (`revealedBy`): after the probe the match lay flush on the same `edge` of the
 * same `container` — its own edge or a `pinned` node's there, alike — with `revealed` px more of it showing. Kept
 * (`Memory.proven`) while every later stop the check is shown finds the judged match flush on that edge of that
 * container (`stillProven`): such a read claims no stop and confirms none (`FlushSeen.waits`), and its next stroke is a
 * reveal (course.ts#Revealing) — or, with none to send, the read is short of the cut (`FlushCut`). A read that finds it
 * anywhere else lets it go: the round judges that read like any other. Kept by edge and container, not by node:
 * another match judged there (a selector matching two rows) is taken for the same — the cost a failure naming the cut,
 * never a false "fully visible"; reads that judge no stop leave it as it was.
 */
interface ProvenCut {
  readonly edge: Edge;
  readonly container: Rect;
  readonly revealed: number;
  /** How far the stroke that proved it carried the match, and the doubt that follows (`Carry`, D62). */
  readonly carry: Carry;
}

/**
 * The stroke that proved a cut (`revealedBy`), against its drawn length (D62): `short` — it carried the match less
 * than that length less `CARRY_LOSS`, the content ended under it, or no stroke was drawn (the round requires the stroke
 * after every one, scroll-rounds.ts#RoundSeen.drawn, so a proving read always has its own); `carried` — it carried it
 * the whole way, so the next reveal that moves nothing is doubted, sent again; `doubted` — one was, and the next that
 * moves nothing is checked. A fresh proof starts anew.
 */
type Carry = 'short' | 'carried' | 'doubted';

declare const opaque: unique symbol;

/** The flush check — opaque: only this module reads it (the fields are `Memory`'s). */
export interface FlushCheck {
  readonly [opaque]: 'flush-check';
}

/** A probe sent: the judged match's rect and flush edge when it was sent. */
interface SentProbe {
  readonly rect: Rect;
  readonly edge: Edge;
}

/** Everything the flush check remembers between reads, one record with one writer (this module). */
interface Memory {
  /** The probe in flight (`SentProbe`). Cleared by the next read that reads. */
  readonly probe: SentProbe | undefined;
  /** The cut a probe proved (`ProvenCut`), while the match lies flush on it; undefined until one is. */
  readonly proven: ProvenCut | undefined;
  /** The caller's direction (scroll-rounds.ts#RoundRules): the scroll's axis, along which alone the match is asked flush. */
  readonly direction: Direction;
}

const open = (check: FlushCheck): Memory => check as unknown as Memory;
const close = (m: Memory): FlushCheck => m as unknown as FlushCheck;

/**
 * The most px a stroke that carried the match its whole way may fall short of its drawn length (`Carry`, D62): twice
 * TOUCH_SLOP — measured losses to the slop and the content's give 7–24 px; batch-9's probe carried C 135 px of 142
 * (or of the 177-px cap, which one slop would miss).
 */
const CARRY_LOSS = 2 * TOUCH_SLOP;

/** The check before the first read, for a scroll toward `direction`: no probe in flight, no cut proven. */
export function startFlush(direction: Direction): FlushCheck {
  return close({ probe: undefined, proven: undefined, direction });
}

/** A probe is in flight: sent, and no read that read since — the read after it is the probe's (the round reads a failed one again, and offers no carry sample of it). */
export const probing = (check: FlushCheck): boolean => open(check).probe !== undefined;

/** What the flush check is shown of a read that judges a `fully: true` stop (`seeFlush`). */
export interface FlushStop {
  /** The judged match, a stop in the frame. */
  readonly judged: Judged;
  /** The read's facts: its scene (the match's clipping ancestors and pinned edges, the scroll views' axes) and keyboard. */
  readonly facts: TreeFacts;
  /** The last stroke drawn, as the driver handed it back (motion-ledger.ts#lastDrawn): whether a probe that held was a stroke, not a tap. */
  readonly drawn: Stroke | undefined;
  /** What a probe would be sent with (`ProbeMeans`). */
  readonly means: ProbeMeans;
}

/** What the round can send a probe with this read. */
export interface ProbeMeans {
  /** The screen the round judges in (scroll-rounds.ts#State.frame's `box`): the probe's travel cap (course.ts#probeOf). */
  readonly screen: Rect;
  /** The round's gesture box (`RoundSeen.screen`'s `oriented`), the probe drawn inside it; undefined when there is none. */
  readonly gesture: Rect | undefined;
  /** The stroke plan's memory (interact/stroke-plan.ts#StrokeMemory), which plans the probe. */
  readonly strokes: StrokeMemory;
  /** The keyboard cover the read applied, and the one it offered the witness (scroll-read.ts#ReadJudgement). */
  readonly cover: AppliedKeyboard | undefined;
  readonly offered: AppliedKeyboard | undefined;
  /** The witness's answer this round (`RoundSeen.corroborated`), when it was asked. */
  readonly corroborated: boolean | undefined;
  /** A swipe and time are left for one more stroke. */
  readonly budget: boolean;
}

/**
 * What the flush check says of a read's `fully: true` stop — one answer a read:
 * - `none`: no stop shown, or the match flush on no edge of a clipping ancestor along the scroll: the check has nothing
 *   to say;
 * - `flush`: the stop stands as far as the check goes, with its `Flush` — `fills`, `checked` by the probe that came
 *   back, or unchecked for `tap`, `room`, `axis` or `budget`;
 * - `cut`: no stop — the read is short of the cut a probe proved, with no reveal sent (`FlushCut`);
 * - `witness`: ask the witness first, about a band the moot rule left unasked (the probe touches down on the
 *   container's lower part for a bottom edge, which may be under the band) — the round asks, and shows the check the
 *   same read again with the answer;
 * - `probe`: send this probe or reveal (`toward`, the stroke the plan made and the plan's memory after it) — and keep
 *   `check`, the check with it in flight, once it is sent.
 */
export type FlushVerdict =
  | { readonly of: 'none' }
  | { readonly of: 'flush'; readonly flush: Flush }
  | { readonly of: 'cut'; readonly cut: FlushCut }
  | { readonly of: 'witness' }
  | { readonly of: 'probe'; readonly toward: Direction; readonly stroke: PlannedStroke; readonly memory: StrokeMemory; readonly check: FlushCheck };

/** What one read did to the check (`seeFlush`). */
export interface FlushSeen {
  /** The check after this read: the probe in flight answered, the proven cut kept, taken, or let go. */
  readonly check: FlushCheck;
  /** The probe in flight came back with the match where it was sent from (within a pixel): the stop held still through a stroke — settled without a confirming read. */
  readonly settles: boolean;
  /** No proven cut holds: an unsettled stop may wait out a fling or spend a confirming read. False on a proven cut: the next stroke reveals the rest, at once. */
  readonly waits: boolean;
  readonly verdict: FlushVerdict;
}

/**
 * One read that read, as the flush check sees it: `stop`, the judged match of a `fully: true` stop this read judges
 * (in the frame, a stop by its standing, not refused again by the eyes, not held back by the motion's region), or
 * undefined when it judges none — such a read answers the probe in flight and leaves a proven cut as it was. Of a stop:
 * the probe came back held (`settles`), or moved it and proved its cut (`revealedBy`), or the cut kept still holds
 * (`stillProven`); then the verdict — where the match lies flush (`flushWith`) and what that asks. The verdict is made
 * on every stop shown, a read that then waits out a fling or confirms included: the round reads it only past those.
 */
export function seeFlush(check: FlushCheck, stop: FlushStop | undefined): FlushSeen {
  const m = open(check);
  if (stop === undefined) return { check: close({ ...m, probe: undefined }), settles: false, waits: true, verdict: { of: 'none' } };
  const probed = m.probe;
  const rect = stop.judged.node.rect;
  // The probe moved nothing: the match is where it was sent from — the stop holds (it held still through a stroke),
  // and nothing lies beyond its flush edge…
  const held = probed !== undefined && sameRectWithinPixel(probed.rect, rect);
  // …and was a stroke: one drawn shorter than twice the slop may have been a tap, and a tap moves nothing whatever
  // lies beyond the edge.
  const stroked = held && stop.drawn !== undefined && strokeLength(stop.drawn) >= 2 * TOUCH_SLOP;
  // The probe moved it and it lies flush on the same edge with more of it showing (`revealedBy`), or it still lies
  // flush on a cut an earlier probe proved (`stillProven`).
  const at = flushOf(stop.judged, stop.facts, m.direction);
  const fresh = probed !== undefined && !held ? revealedBy(probed, rect, at, stop.drawn) : undefined;
  const proof = fresh ?? stillProven(m.proven, at);
  // A reveal that moved nothing after a stroke that carried the match its whole length: doubted once — the cut stays
  // proven, its doubt spent, and the same reveal goes again (D62).
  const doubted = stroked && proof?.carry === 'carried';
  const proven = doubted ? { ...proof, carry: 'doubted' as const } : proof;
  const after: Memory = { ...m, probe: undefined, proven };
  const came: Came = !held ? 'moved' : !stroked ? 'tap' : doubted ? 'doubted' : 'held';
  return { check: close(after), settles: held, waits: proven === undefined, verdict: verdictOf(after, stop, at, came) };
}

/**
 * What the probe in flight came back with, as the verdict reads it (`seeFlush`): `moved` — no probe came back held (none
 * in flight, or the match moved); `held` — the match where it was sent from, after a stroke; `tap` — held, the stroke
 * drawn under twice the slop, which may have been a tap; `doubted` — held after a reveal on a proof whose stroke
 * carried the match its whole length (`Carry` `carried`): no stop, the reveal again (D62).
 */
type Came = 'moved' | 'held' | 'tap' | 'doubted';

/** A flush edge of the match: on its container's own edge, or on a node `pinned` in its nearest at that side (`Flush`). */
interface FlushEdge {
  readonly edge: Edge;
  readonly pinned?: QuotedNode;
}

/** Where the match lies flush (`flushWith`): one edge and the ancestor's index, both edges of the nearest, or neither. */
type Flushed = (FlushEdge & { at: number }) | { fills: readonly [Edge, Edge]; pinned?: QuotedNode } | undefined;

/** Where the judged match lies flush (`flushWith`) of its clipping ancestors in this read: the chain, nearest first, and the answer. */
interface FlushAt {
  readonly chain: readonly Rect[];
  readonly flushed: Flushed;
}

/**
 * Where the match lies flush, of `chain` (clipping ancestors, nearest first; `flushEdges`, ui-tree/geometry.ts, along
 * the scroll's axis, within a pixel — and, for the NEAREST, the match's `pinned` edges along it, laid flush under a
 * node pinned in it, ui-tree/later-edges.ts#PinnedEdge: where that scroll view's content ends as it shows): the nearest
 * it is flush with on ONE edge along the scroll — that edge and the ancestor's index, the probe's question — else, when
 * it fills the NEAREST along the scroll, both edges (`fills`: reported, never probed); undefined when neither.
 */
function flushWith(rect: Rect, chain: readonly Rect[], pinned: readonly PinnedEdge[], direction: Direction): Flushed {
  const axis = axisOf(direction);
  const edgesAt = (at: number): FlushEdge[] => {
    const own: FlushEdge[] = flushEdges(rect, chain[at], axis).map((edge) => ({ edge }));
    if (at !== 0) return own;
    const under = pinned.filter((p) => axisOfEdge(p.edge) === axis && !own.some((o) => o.edge === p.edge)).map((p) => ({ edge: p.edge, pinned: quoted(p.by) }));
    return [...own, ...under].sort((a, b) => EDGES.indexOf(a.edge) - EDGES.indexOf(b.edge));
  };
  for (const at of chain.keys()) {
    const edges = edgesAt(at);
    if (edges.length === 1) return { ...edges[0], at };
  }
  const nearest = chain.length === 0 ? [] : edgesAt(0);
  if (nearest.length !== 2) return undefined;
  const under = nearest.find((e) => e.pinned !== undefined)?.pinned;
  return { fills: [nearest[0].edge, nearest[1].edge], ...(under !== undefined && { pinned: under }) };
}

/** Where the judged match lies flush (`flushWith`) of its clipping ancestors (`chain`, nearest first) in this read. */
function flushOf(best: Judged, facts: TreeFacts, direction: Direction): FlushAt {
  const chain = facts.scene.clips.scrollersOf(best.node);
  return { chain, flushed: flushWith(best.node.rect, chain, facts.scene.pinnedEdges(best.node), direction) };
}

/**
 * The cut the probe in flight (`probed`: its rect and flush edge when sent) proved (`ProvenCut`): the match, now at
 * `now`, lies flush (`flushed`, of `chain`) on that same edge, its extent along the edge's axis grew by more than a
 * pixel, and its uncut edge moved toward revealing the flush one by that growth, within a pixel — the content carried
 * it out from past that edge. Undefined otherwise: no longer flush, flush on another edge or filling its container, no
 * more of it showing (a match that moved but did not grow says nothing of a cut), or grown with its uncut edge where
 * the content did not carry it (a container that grew, another match in its place). Its `carry` (`Carry`): `carried`
 * when it grew by more than `drawn`'s length less `CARRY_LOSS`, else `short` — never `doubted`, a fresh proof.
 */
function revealedBy(probed: SentProbe, now: Rect, { chain, flushed }: FlushAt, drawn: Stroke | undefined): ProvenCut | undefined {
  if (flushed === undefined || 'fills' in flushed || flushed.edge !== probed.edge) return undefined;
  const was = probed.rect;
  const grown = axisOfEdge(probed.edge) === 'vertical' ? now.height - was.height : now.width - was.width;
  const uncutMoved = uncutToward(now, probed.edge) - uncutToward(was, probed.edge);
  const carry: Carry = drawn !== undefined && grown > strokeLength(drawn) - CARRY_LOSS ? 'carried' : 'short';
  return grown > 1 && Math.abs(uncutMoved - grown) <= 1 ? { edge: probed.edge, container: chain[flushed.at], revealed: grown, carry } : undefined;
}

/** `cut` (`Memory.proven`) while the match still lies flush on its edge of its container (`flushed`, of `chain`), within a pixel; undefined once it lies anywhere else. */
function stillProven(cut: ProvenCut | undefined, { chain, flushed }: FlushAt): ProvenCut | undefined {
  if (cut === undefined || flushed === undefined || 'fills' in flushed) return undefined;
  return flushed.edge === cut.edge && sameRectWithinPixel(chain[flushed.at], cut.container) ? cut : undefined;
}

/** px from `rect`'s edge opposite `edge` to `container`'s same side: what the content may move toward revealing `edge` before that edge leaves the container. */
const roomPast = (rect: Rect, container: Rect, edge: Edge): number => uncutToward(container, edge) - uncutToward(rect, edge);

/**
 * Where `rect`'s side opposite `edge` lies, measured the way content moves to reveal `edge` (up for `bottom`, down for
 * `top`, left for `right`, right for `left`): the difference of two is how far that side moved toward revealing it, or
 * how far it may.
 */
function uncutToward(rect: Rect, edge: Edge): number {
  switch (edge) {
    case 'bottom':
      return -rect.y;
    case 'top':
      return rect.y + rect.height;
    case 'right':
      return -rect.x;
    case 'left':
      return rect.x + rect.width;
  }
}

/**
 * The verdict on a stop (`FlushVerdict`), the check `after` this read: where the match lies flush with its clipping
 * ancestors (`at`, `flushWith`), and either the stop's `Flush`, the cut a probe proved with no reveal sent
 * (`FlushCut`), or the step that answers it first: the witness asked about a band the moot rule left unasked, or the
 * probe sent, as the stroke plan makes it (interact/stroke-plan.ts#planProbe: over the first of the ancestors from the
 * flush one outward with room above the keyboard — none, and no probe is sent). `came`: what the probe in flight came
 * back with (`Came`).
 */
function verdictOf(after: Memory, { judged, facts, means }: FlushStop, { chain, flushed }: FlushAt, came: Came): FlushVerdict {
  if (flushed === undefined) return { of: 'none' };
  const { proven } = after;
  if ('fills' in flushed) return { of: 'flush', flush: { edges: flushed.fills, container: chain[0], ...(flushed.pinned !== undefined && { pinned: flushed.pinned }), checked: false, why: 'fills' } };
  const { edge, at } = flushed;
  const container = chain[at];
  const where = { edge, container, ...(flushed.pinned !== undefined && { pinned: flushed.pinned }) };
  // A check that cannot be made: the stop's hedge — or, on a cut a probe proved, no stop at all but that cut, with why
  // no reveal was sent (`FlushCut`).
  const unchecked = (why: 'budget' | 'room' | 'axis' | 'tap'): FlushVerdict =>
    proven === undefined ? { of: 'flush', flush: { ...where, checked: false, why } } : { of: 'cut', cut: { of: 'flushCut', judged, ...where, revealed: proven.revealed, why } };
  // A probe or reveal that moved nothing: checked — nothing lies past the edge now — unless drawn too short to tell
  // from a tap, which on a proven cut is no stop but that cut; or doubted (D62), when the reveal goes again below.
  if (came === 'held') return { of: 'flush', flush: { ...where, checked: true } };
  if (came === 'tap') return unchecked('tap');
  // With no gesture box (`RoundSeen.screen` absent) nothing has room and the stop says `room` — the wrong reason (it
  // is "no screen box"), accepted as unreachable in practice: screenBox throws only when the device's size is
  // unusable AND the tree has no window, and adapters/viewport-memo.ts keeps a successful size for the session — so it
  // takes a device reporting 0×0 throughout, and a tree whose window stood in on an earlier round (else the frame is
  // 0×0 and no stop is ever visible) but not on this one.
  // Its way and reach are the course's (interact/course.ts#probeOf): toward revealing the edge, a short stroke capped
  // by the screen's long side — or, once a probe proved the cut, the reveal sized from the room the match leaves in
  // that container.
  const revealing = proven === undefined ? undefined : { room: roomPast(judged.node.rect, container, edge) };
  const way = probeOf(edge, means.screen, revealing);
  const scrollViews = chain.slice(at);
  if (probeAcrossOnly({ toward: way.toward, facts, scrollViews })) return unchecked('axis');
  const probeOver = (keyboardTop: number | undefined) => planProbe(means.strokes, { ...way, gesture: means.gesture, facts, scrollViews, keyboardTop });
  if (probeOver(undefined) === undefined) return unchecked('room');
  if (!means.budget) return unchecked('budget');
  // Clear of a keyboard as any stroke is — and one the moot rule never asked about (the stop was clean either way) is
  // asked about now: the probe touches down on the container's lower part for a bottom edge, which may be under the
  // band.
  let probeCover = means.cover;
  if (probeCover === undefined && means.offered !== undefined) {
    if (means.corroborated === undefined) return { of: 'witness' };
    if (means.corroborated) probeCover = means.offered;
  }
  // Room judged again ABOVE that keyboard: a list running on under the IME may have room on the screen and none above
  // it — the probe would touch down off it and move nothing. Twice only to keep the ask order: no room even over the
  // whole screen is `room` with no witness asked.
  const planned = probeOver(strokeLine(probeCover, facts)?.y);
  if (planned === undefined) return unchecked('room');
  return { of: 'probe', toward: way.toward, stroke: planned.stroke, memory: planned.memory, check: close({ ...after, probe: { rect: { ...judged.node.rect }, edge } }) };
}
