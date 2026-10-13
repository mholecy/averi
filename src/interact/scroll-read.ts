import type { DeviceScreen, Rect, UiNode } from '../adapters/types.js';
import { largestScroller, type Cut } from '../ui-tree/geometry.js';
import { coverLine, keyboardEdge, keyboardSide, type KeyboardCover, type KeyboardLine } from '../ui-tree/keyboard-cover.js';
import { showsProgress, treeFingerprint } from '../ui-tree/read-tree.js';
import type { KeyboardRemedy } from '../ui-tree/soft-keyboard.js';
import { bandRect, farEdgeFrames, sceneOf, type Scene, type Standing, type StandingScreen, type SystemBar, type TouchPurpose } from '../ui-tree/standing.js';

/**
 * What ONE read of the screen means for `scroll_until`: `judgeRead(read,
 * screen, fully, corroborated?)` — a pure function of the read (its tree,
 * the matches the driver found in it and the synchronous facts of its
 * keyboard reading), the round's frame (the usable screen's judging part)
 * and the stop's `fully`. Its answer is the read's judgement, or that the
 * witness must be asked first:
 * - the tree's facts (`TreeFacts`), derived once;
 * - the keyboard cover that applies — a reading's (`coverOf`), the
 *   witness standing by it, or idb's band (`bandCoverOf`), which no
 *   witness stands by — and the reading's offered cover, applied or not;
 * - the best match judged (`judge`), box by box over the boxes that count
 *   (`judgeOver`), and judged again above the cover when one applies;
 * - the frames the far edge is judged in, and the frames the short-of test
 *   reads;
 * - the line this read's strokes stay above (`strokeLine`).
 * What it means ACROSS reads — motion, settle, the probe, stuck, the bound
 * and the next stroke — is interact/scroll-rounds.ts#round's, which calls
 * this once per read that read and keeps nothing of it but what the next
 * steps read.
 *
 * THE WITNESS RULE, decided here: the round judges twice when a keyboard is
 * up — over the whole screen, and over the screen ABOVE the cover. When the
 * two say the same and the match stops the round cleanly either way, the
 * cover is MOOT: it changes nothing, and is neither asked about nor
 * reported. Otherwise a reading's cover is applied only once the witness
 * (the reading's `corroborated()`) stands by it, asked THIS read and never
 * remembered — a scroll can hide a keyboard (a list that dismisses it on
 * drag) and leave the window state stale-shown behind it — so the answer is
 * `{ ask: 'witness' }` until the round re-enters with `corroborated`, and
 * the covered judgement replaces the whole one only when the witness stood
 * by it. idb's band asks no witness: it is read off the very tree being
 * judged. At most one witness a read, asked before anything the round does
 * with the read — so before the deadline is consulted (the round's ORDER).
 * The probe's late witness, for a cover the moot rule left unasked, is the
 * round's (it needs the stop and the probe first); it reads `offered`.
 *
 * Pure: no adapter, no clock, no I/O. Cost: one `factsOf` (the scene, the
 * largest scroller, the fingerprint, the progress check), one standing per
 * match per box that counts, and per match again above an applied cover.
 */

/**
 * A tree that read, as the round needs it: the TREE itself — the round
 * derives what it asks of it (`TreeFacts`) — the matches the driver found
 * in it, the judged screen, and the SYNCHRONOUS facts of the round's
 * keyboard reading (ui-tree/keyboard-cover.ts#readKeyboard), never the
 * reading itself: its two async questions reach the round only as answers
 * to an `ask`, and a reading is never held across rounds (the
 * keyboard-cover.ts doc's rule) — the driver builds one per round.
 *
 * Five fields. The facts derived from the tree — the matches' clipping
 * ancestors, the largest clipping container, the tree's fingerprint and
 * whether it showed progress — are pure functions of the tree, so the read's
 * judgement derives them (`factsOf`): a driver cannot omit one and silently
 * disable a rule.
 */
export interface RoundRead {
  /**
   * This round's tree, as read (in-process data: the round stays pure).
   * Never mutated once handed in — by the driver, a test or the round:
   * its facts (`factsOf`) are derived from it on each call, so a tree
   * changed between an `ask` and the re-entry would be judged by two
   * different trees in one round.
   */
  tree: UiNode;
  /** The matches of the target to judge, in tree order (resolve.ts#matchesToJudge: the one the next tap acts on when the preference picks one, else every match) — nodes OF `tree`: their clipping ancestors are looked up by identity. */
  found: readonly UiNode[];
  /** The reading's `cover()`: everything a shown keyboard covers; undefined when hidden or unknown. */
  cover?: KeyboardCover;
  /** The reading's `ofKeyboard`: is this node the keyboard's own UI (judged against the whole screen, never under the band)? */
  ofKeyboard: (node: UiNode) => boolean;
  /** The reading's `remedy` — what the adapter can do about a covering keyboard — for the sentences of a round that applied idb's band, which no `cover` carries. */
  remedy: KeyboardRemedy;
}

/** What the round asks of a tree that read — derived by `factsOf` (`judgeRead`), never handed in. */
export interface TreeFacts {
  /**
   * The tree's scene (ui-tree/standing.ts#sceneOf), once a round: the
   * judgement (`judge`, `Scene.standing`); a match's clipping ancestors,
   * nearest first (`clips.scrollersOf`) — Android's scroll containers, to
   * whose edges uiautomator has already cut the match's bounds; empty when
   * it has none (every node of an iOS tree) — for the `fully: true` stop's
   * flush check (PROBE_REACH) and the box the strokes are drawn in
   * (swipe.ts#strokeRoom); what is drawn OVER a clipping container (the
   * floating tab bar) — `order.drawnOver`, what a stroke over it keeps
   * clear of (swipe.ts#strokeRoom cuts the box above them), and
   * `order.drawnOverAt`, the one a stroke that still touched down on it
   * names (`touchedOn`), asked of the rects `clips.scrollersOf` and
   * `mainScroller` give, undefined when this tree has no container with
   * that rect (one remembered from an earlier read: the list has moved
   * since), never any on iOS, which has no clipping container; and idb's
   * keyboard band (ui-tree/keyboard-cover.ts#keyboardEdge over `order`),
   * the line the strokes stay above (`strokeLine`) and the round judges
   * under (`bandCoverOf`).
   */
  scene: Scene;
  /**
   * The largest clipping container (ui-tree/geometry.ts#largestScroller) —
   * the screen's own scroll view, for a stroke while the target's own
   * container is not known (it has not been read yet). Undefined when the
   * tree has none (iOS).
   */
  mainScroller: Rect | undefined;
  /**
   * A cheap fingerprint of the WHOLE tree (ui-tree/read-tree.ts
   * #treeFingerprint) — every node's role, text, id and rect — for "the
   * strokes changed nothing at all" when the target is not in the tree
   * (UNMOVED_STROKES_EXHAUST).
   */
  fingerprint: string;
  /**
   * The tree shows a progress indicator (ui-tree/read-tree.ts#showsProgress:
   * a `progress` node with area — Android's ProgressBar, which a Compose
   * progress indicator also dumps as) — the screen may be loading, so an
   * unchanged fingerprint does not say the content is exhausted.
   */
  loading: boolean;
}

/**
 * `TreeFacts` of a tree: the scene's draw order and clip facts (each
 * derived on first use), the largest scroller, the fingerprint and the
 * progress check. Derived ONCE per `judgeRead` — once per call of
 * scroll-rounds.ts#round that read — BEFORE the judgement, and handed to it
 * and along (`ReadJudgement.facts`, which the round keeps for the steps
 * after the judgement) — each fact from one derivation. A call that
 * re-enters after an `ask witness` (the ask most re-entries are for, which needs only the judgement), an `ask unlocated`
 * (a `fully: true` or bound stop, once a scroll) or an `ask witness`
 * before a probe derives them again: no cache, so the module holds no
 * state between calls (a cache by tree object was dropped for that) —
 * the fingerprint, the progress check and the largest scroller are walked on a round that then asks for the witness
 * too, a pure walk of an in-memory tree beside a device read.
 */
function factsOf(tree: UiNode): TreeFacts {
  return {
    scene: sceneOf(tree),
    mainScroller: largestScroller(tree),
    fingerprint: treeFingerprint(tree),
    loading: showsProgress(tree),
  };
}

/**
 * A shown soft keyboard as the round may apply it — a reading's cover (`coverOf`), or idb's band (`bandCoverOf`): its frame,
 * the part of the screen it leaves — everything above its TOP edge, full
 * width — and what the adapter can do about it. Above the top edge, not
 * around the band: a docked keyboard (Android IME [0,1398][1080,2220], WDA
 * band from y 539/589 of 874) runs to the bottom, so the two are the same;
 * a band that does not costs content below it, which can only make the
 * scroll swipe more or fail naming the keyboard — never report as visible
 * what is under it. `above` undefined: the band starts at or above y 0 and
 * leaves nothing (a full-screen extract-mode IME, unmeasured).
 *
 * `topCover` is the HIGHEST covered rect (`KeyboardCover.top`), not always
 * the inset band: with a floating Gboard (measured on API 33) it is the panel,
 * [359,1269][1040,1912], 681 px wide and mid-screen. The
 * invariant: only its `.y` is meaningful as a cut — the rect need not be
 * full width nor reach the bottom; the rest of it is quoted in messages.
 * The cost of the full-width cut, accepted (it never certifies a covered
 * target): content beside the panel (x < 359 there) and in the gap between
 * the panel and the strip below it is never judged visible, so a target
 * there that cannot be scrolled above the panel fails `scroll_until` with
 * the keyboard named, though the tap guard — which tests the panel's rect
 * itself — would tap it; and a panel dragged near the top leaves a short
 * stroke box (a residual).
 */
export interface Cover {
  topCover: Rect;
  above: DeviceScreen | undefined;
  remedy: KeyboardRemedy;
  /** Its top edge as a keyboard line (`line.y` is `topCover.y`): `window` or `wda` for a reading's cover, which the witness stood by; `idb-band` for idb's band (`bandCoverOf`), which no reading stands by — a centre under it stops nothing. */
  line: KeyboardLine;
}

/**
 * One match as judged: the keyboard cover it was judged under (none for a
 * whole-screen judgement or a keyboard-side node) and where it stands for
 * the stop (ui-tree/standing.ts#Scene.standing) — the kind `stops` and
 * `shortOf` read, and the facts the rest of the round and the sentences
 * read: how much of it is in the frame, the frame's edges it extends past,
 * what of the app is drawn over it inside that frame (the covers, the one
 * over its centre, how much of it shows) and its cut to a sliver.
 */
export interface Judged {
  node: UiNode;
  under?: Cover;
  standing: Standing;
}

/** The screen a read is judged in: the round's frame, the usable screen's judging part (ui-tree/usable-screen.ts#UsableScreen). */
type Frame = StandingScreen;

/** The stop's purpose (ui-tree/standing.ts#TouchPurpose): the plain stop, or `fully` — `RoundRules.fully`, mapped once a read. */
type StopOf = Exclude<TouchPurpose['of'], 'tap'>;

/**
 * One read's judgement (`judgeRead`) — every fact of the read the round's
 * cross-read steps read.
 */
export interface ReadJudgement {
  /** The tree's facts, derived once (`factsOf`). */
  readonly facts: TreeFacts;
  /** The match judged best (`judge`), under the applied cover when one applies; undefined when the read found none. */
  readonly best: Judged | undefined;
  /** The cover the read applied — the reading's once the witness stood by it, or idb's band — or none (moot, denied, or no keyboard). */
  readonly cover: Cover | undefined;
  /** The reading's cover, applied or not — for the probe's late witness (scroll-rounds.ts#round). Never idb's band. */
  readonly offered: Cover | undefined;
  /**
   * The frames the far edge is judged in (ui-tree/standing.ts#farEdgeFrames):
   * the screen above an applied cover, else every box that counts — each
   * below the status band, and above the navigation band for a `fully` stop
   * the band's region refused.
   */
  readonly frames: readonly Rect[];
  /** `frames` uncut at the navigation band — the frames short of the far edge is judged in. */
  readonly uncutFrames: readonly Rect[];
  /** The line this read's strokes stay above (`strokeLine` of the applied cover and idb's band). */
  readonly strokeLine: KeyboardLine | undefined;
}

/**
 * What `read` means for the scroll, judged in `screen` (the round's frame)
 * for a stop of `fully`: the read's judgement, or `{ ask: 'witness' }` when
 * a reading's cover changes the judgement and `corroborated` (the witness's
 * answer, on the round's re-entry) is not given yet. The module doc has
 * the rule.
 */
export function judgeRead(read: RoundRead, screen: Frame, fully: boolean, corroborated?: boolean): { ask: 'witness' } | ReadJudgement {
  const viewport = screen.box;
  const { found } = read;
  // The stop's purpose, mapped from the tool's flag once (ui-tree/standing.ts#TouchPurpose).
  const stop: StopOf = fully ? 'fully' : 'stop';
  // The round judged twice when a keyboard is up: over the whole screen,
  // and over the screen ABOVE the cover (`coverOf`) — the covered judgement
  // stands only when the band changes the round and the witness stood by it.
  const offered = coverOf(read.cover, viewport);
  // The tree's facts, once a read (`factsOf`): what is drawn over what
  // (ui-tree/draw-order.ts) — the judgement's covers, and the stroke's —
  // each match's clipping ancestors, for the plain stop's sliver rule
  // (`stops`), and the rest the round's steps after the judgement read.
  const facts = factsOf(read.tree);
  const whole = judgeOver(found, screen, facts, stop);
  // idb's band (`bandCoverOf`), when no reading offers a cover — never both today: idb's reading is always `unknown`.
  const band = offered !== undefined ? undefined : bandCoverOf(keyboardEdge(undefined, facts.scene.order), viewport, read.remedy);
  const applied = offered ?? band;
  let cover: Cover | undefined;
  let best = whole;
  if (applied !== undefined) {
    // The keyboard's own UI is judged against the whole screen: the reading's (WDA's marks), and idb's band's own nodes.
    const covered = judge(found, screen, facts, stop, { cover: applied, keyboardSide: keyboardSide(read.ofKeyboard, facts.scene.order) });
    // Moot: the read stops the round cleanly either way, on the same
    // judgement — the band changes nothing, and is neither asked about nor
    // reported. Otherwise the witness is asked THIS read (the module doc).
    const moot = endsClean(whole) && sameJudgement(whole, covered);
    if (!moot) {
      // idb's band asks no witness: no reading stands by it, nor could deny it (`bandCoverOf`).
      if (offered === undefined) {
        cover = applied;
        best = covered;
      } else {
        if (corroborated === undefined) return { ask: 'witness' };
        if (corroborated) {
          cover = offered;
          best = covered;
        }
      }
    }
  }
  // The frames this read was judged in — the screen above an applied
  // keyboard, else every box that counts — for where the target stands
  // against the far edge (scroll-rounds.ts#observe, #beyondFarEdge), cut by
  // standing's own band cut (ui-tree/standing.ts#farEdgeFrames), which reads
  // the best standing's band for the navigation cut.
  const { frames, uncutFrames } = farEdgeFrames(screen, best?.standing, cover?.above);
  // The line this read's strokes stay above — its cover's and idb's band,
  // whether or not the read applied the band (`strokeLine`).
  return { facts, best, cover, offered, frames, uncutFrames, strokeLine: strokeLine(cover, facts) };
}

/** The cover a reading offers, its line the cover's (ui-tree/keyboard-cover.ts#coverLine), or none: not shown, or a band whose top lies at or below the screen's bottom (it covers nothing on it). */
function coverOf(shown: KeyboardCover | undefined, viewport: DeviceScreen): Cover | undefined {
  if (shown === undefined) return undefined;
  // The highest covered rect, not always the inset band: a floating
  // Gboard's panel mid-screen above its 132-px strip — so a target
  // behind it is judged under the cover and the stroke starts above it. Full
  // width above its top, as for any band that does not reach the sides.
  // docs/bugs/2026-10-05-android-floating-gboard-keyboard.md
  const topCover = shown.top;
  if (topCover.y >= viewport.height) return undefined;
  return { topCover, above: topCover.y <= 0 ? undefined : { width: viewport.width, height: topCover.y }, remedy: shown.remedy, line: coverLine(shown) };
}

/**
 * idb's band as a cover the round applies: its line
 * (ui-tree/keyboard-cover.ts#keyboardEdge, no reading) as the band's rect —
 * the viewport's width from the line to its bottom, the shape idb's band
 * has (soft-keyboard.ts#flatListKeyboardBand) — with the reading's
 * `remedy`. Applied with no witness: it is read off the very tree being
 * judged, as WDA's band is. None when there is no band, or it lies at or
 * below the viewport's bottom.
 * docs/adr/0006-idb-keyboard-band-is-a-keyboard-line.md
 */
function bandCoverOf(line: KeyboardLine | undefined, viewport: DeviceScreen & { x: number; y: number }, remedy: KeyboardRemedy): Cover | undefined {
  if (line === undefined || line.y >= viewport.y + viewport.height) return undefined;
  const topCover = bandRect(line, viewport);
  return { topCover, above: line.y <= 0 ? undefined : { width: viewport.width, height: line.y }, remedy, line };
}

/**
 * The top edge a stroke is kept above (swipe.ts#strokeRoom's `coverTop`):
 * the keyboard edge (ui-tree/keyboard-cover.ts#keyboardEdge) of the applied
 * cover's line and idb's band (`TreeFacts.scene`'s draw order) — the band
 * whether or not the round applied it (a moot band changes no judgement,
 * but a stroke on it touches a key: the Contacts form and the SWIFT form's
 * number pad were stroked from y 699).
 * docs/bugs/2026-10-09-ios-idb-scroll-stroke-starts-on-the-soft-keyboard.md
 * No guard on where the band lies in the gesture box: a top at or below
 * the box's bottom changes no stroke (swipe.ts#strokeRoom and swipeVectorAbove keep the whole box — pinned in
 * tests/interact/scroll.test.ts), and one at or above its top cannot occur:
 * the band starts below the top bar's line, a fifth of the screen down.
 */
export function strokeLine(cover: Cover | undefined, facts: Pick<TreeFacts, 'scene'>): KeyboardLine | undefined {
  return keyboardEdge(cover?.line, facts.scene.order);
}

/**
 * The MOST revealed match, not the first: an id can sit on a container and
 * its child, and reporting the clipped one of the two would invent a defect
 * (the driver hands in only the match the next tap acts on when the
 * preference picks one — resolve.ts#matchesToJudge — so this chooses only
 * among matches the tap could not tell apart either).
 * Most revealed by what SHOWS — in the frame and under nothing of the app —
 * which is what is in the frame when nothing is drawn over it; a match
 * that stops the round first (`better`). Each match's standing for the stop
 * is the scene's (ui-tree/standing.ts#Scene.standing), in the frame's box
 * with its system bands. Under a cover, a keyboard-side node (the round's
 * reading's `ofKeyboard`, one walk per round) is judged against the whole
 * screen; every other node against the part above the cover's top edge,
 * and what is drawn over a node is counted only there: a bar under the
 * keyboard covers nothing the round can see.
 */
function judge(
  found: readonly UiNode[],
  frame: Frame,
  facts: Pick<TreeFacts, 'scene'>,
  stop: StopOf,
  cover?: { cover: Cover; keyboardSide: (node: UiNode) => boolean },
): Judged | undefined {
  const scored = found.map((node): Judged => {
    const under = cover === undefined || cover.keyboardSide(node) ? undefined : cover.cover;
    const standing = facts.scene.standing(node, frame, { of: stop, ...(under !== undefined && { keyboardTop: under.line }) });
    return { node, ...(under !== undefined && { under }), standing };
  });
  return scored.sort((a, b) => better(a, b))[0];
}

/** The whole-screen judgement over every box that counts (`UsableScreen.boxes`): the best-revealed match in any — "either way up" when there are two. */
function judgeOver(found: readonly UiNode[], frame: Frame, facts: Pick<TreeFacts, 'scene'>, stop: StopOf): Judged | undefined {
  return frame.boxes
    .map((box) => judge(found, { ...frame, box }, facts, stop))
    .reduce<Judged | undefined>((best, j) => (j !== undefined && (best === undefined || better(j, best) < 0) ? j : best), undefined);
}

/**
 * The order of two judgements, best first (a comparator): a match that
 * STOPS the round (`stops`) before one that does not — a match showing
 * more but with its centre covered must not hide one the next tap would hit
 * — then the one more of which shows (`shows` ranks only; ui-tree/standing.ts
 * #bandShows says what it counts under the status band).
 * docs/adr/0008-scroll-until-exposure-box-below-status-band.md
 */
function better(a: Judged, b: Judged): number {
  return Number(stops(b)) - Number(stops(a)) || b.standing.facts.shows - a.standing.facts.shows;
}

/** THE stop condition: the judged match stands `reachable` for the stop (ui-tree/standing.ts#Scene.standing owns the rule). */
export function stops(j: Judged): boolean {
  return j.standing.kind === 'reachable';
}

/** What a match in the frame is short of a stop (`shortOf`): cut (`clipped`), or something of the app drawn over it (`covered`). */
export type InFrameShort =
  | { of: 'clipped'; judged: Judged }
  | { of: 'covered'; judged: Judged; cover: UiNode }
  /** `band`: the band's rect when the region, not the centre, lies in it (a `fully` stop, ui-tree/standing.ts#Standing). */
  | { of: 'systemBar'; judged: Judged; bar: SystemBar; band?: Rect }
  | { of: 'sliver'; judged: Judged; cut: Cut; minPiece: number };

/**
 * What a judged match in the frame is short of a stop (`stops`) — the one
 * rule the stuck and the bound sentences read, the standing's kind as
 * their sentences group it: a cut edge (`fully: true`), a centre off the
 * screen or one under idb's band (`underKeyboard` with something in the
 * frame: clipped at the keyboard's edge, the frame's bottom) is `clipped`;
 * a centre in a system band (the status bar's, the navigation bar's), or for `fully` any of it there past the slack, `systemBar`, never a clip or a layout defect; a sliver its scroll container cuts it to
 * `sliver`; anything of the app drawn over it `covered`, naming the cover
 * the standing names. Asked only of a match with something in the frame
 * that does not stop the round: a match that stops it is reported before
 * any stuck or bound test — a broken invariant, and throws.
 */
export function shortOf(j: Judged): InFrameShort {
  const s = j.standing;
  switch (s.kind) {
    case 'clipped':
    case 'offScreen':
    case 'underKeyboard':
      return { of: 'clipped', judged: j };
    case 'systemBar':
      return { of: 'systemBar', judged: j, bar: s.bar, ...(s.band !== undefined && { band: s.band }) };
    case 'cut':
      return { of: 'sliver', judged: j, cut: s.cut, minPiece: s.minPiece };
    case 'covered':
      return { of: 'covered', judged: j, cover: s.cover };
    case 'reachable':
      throw new Error('scroll round: no shortfall for a match standing reachable (a stop is reported first)');
  }
}

/** Would this judgement end the round cleanly — a stop, no stroke, no failure? */
const endsClean = (j: Judged | undefined): boolean => j !== undefined && stops(j);

/**
 * The two judgements say the same thing about the same node. `clipped` is
 * not compared: the box above a band lies inside the viewport, so the same
 * node scoring the same fraction against both has no area between the
 * band's top and the screen's bottom, and its edges agree (comparing them
 * would be dead code).
 */
const sameJudgement = (a: Judged | undefined, b: Judged | undefined): boolean =>
  a === undefined || b === undefined ? a === b : a.node === b.node && a.standing.facts.visible === b.standing.facts.visible;

