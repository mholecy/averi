import type { Platform } from '../corpus.js';
import type { Rect, TargetTruth } from '../../truth/schema.js';
import type { Outcome } from '../differential.js';
import { claimsTap, movedTap } from '../../truth/replies.js';
import { pointText, probePoint, selectorOf, touchesAt } from '../../truth/truth.js';
import { stopAsk, tapAsk } from '../../truth/target-contract.js';
import { BUDGET_MS, classed, first, passes, pointsText, reachedWithNoSwipe, tapPoints, type Expectation, type Point } from './judges.js';

/**
 * The base family's rows (fixtures/apps/cells/base.json): a coloured target open — reached by its probe and drawn as
 * itself — wherever it lies (the `open` cell's four, a presented cell's target inside its layer).
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | open: reached, drawn as itself | `Tapped` at the centre of its node in the recorded tree, or where the tree lists none, at its probe point (atProbe) | passes on its own colour | visible after 0 swipes |
 *
 * The tap and scroll_until ask by truth.ts#selectorOf — the target's identifier, or a text target's text
 * (golden-spec/false-covers.ts#ownPartsRows). `nodes`: the frames of the nodes the replayed tree lists as the target,
 * by that same element (truth.ts#elementOf, #nodeFramesIn; golden-spec.ts#expectations reads them) — none given, none
 * known.
 */
export function openRows(platform: Platform, t: TargetTruth, nodes: readonly Rect[] = []): Expectation[] {
  const selector = selectorOf(t);
  const element = { id: t.id };
  const centres = nodeCentres(nodes, t);
  return ([
    {
      asks: tapAsk(platform, t),
      verb: 'tap',
      says: centres.length === 0 ? `Tapped at its probe point ${pointText(probeDelivered(t))}` : `Tapped at its node's centre ${centres.map(pointText).join(' or ')} in the tree`,
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => (claimsTap(o.reply) ? atProbe(o, t, nodes) : `not tapped: ${first(o)}`),
    },
    {
      verb: 'colour',
      says: `passes on its own colour ${t.color}`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.color }, timeout: BUDGET_MS }] } },
      judge: passes,
    },
    {
      asks: stopAsk(platform, t, false),
      verb: 'scroll_until',
      says: 'reached with no swipe',
      call: { tool: 'scroll_until', args: { platform, selector, direction: 'down' } },
      judge: reachedWithNoSwipe,
    },
  ] satisfies Expectation[]).map(classed);
}

/**
 * Where the capture's probe tap on the target was delivered: the touch the app logged for it (TargetTruth.probe, the
 * app's own record of where the touch began) within TOUCH_SLACK of the point it was sent at (truth.ts#probePoint, the
 * frame's centre), as consistency reads it (truth.ts#touchesAt). An open target is `reached`: a raw tap THERE fired its
 * action — the one point of it the truth measured. consistency breaks an open target with no such touch, so the frame's
 * centre is only this function's total answer, never a row's.
 */
export function probeDelivered(t: Pick<TargetTruth, 'frame' | 'probe'>): Point {
  const sent = probePoint(t.frame);
  const touch = touchesAt(t.probe, sent)[0];
  if (touch === undefined) return sent;
  const [x, y] = touch.tag.split(',').map(Number);
  return { x, y };
}

/**
 * How far from the centre of the target's node in the recorded tree an open target's tap may land, per axis: the
 * tools' rounding (a uiautomator centre falls on a half pixel, idb's frames carry thirds of a point). averi's tap on an
 * open target is centre-based (ADR 0009 N-a), the centre of the target's node in the tree it reads — the tree the
 * harness replays, so the point is known exactly: a tap moved off it by a cover averi imagines, however small, is
 * caught whether or not the reply says it moved (the plan's phase 3 follow-up, round 4).
 */
export const NODE_CENTRE_SLACK = 1;

/**
 * The centres of the target's nodes in the recorded tree (truth.ts#nodeFramesIn: each frame once) that the device
 * agrees with: each within OPEN_TAP_REACH of the probe's delivered touch (probeDelivered) — the tree is what averi
 * reads, the probe what the device measured, so a node the tree places elsewhere is not held as the truth. Several
 * frames: the tap is held to one of their centres (which one averi resolves is its own choice). None listed (idb lists
 * no row of a long sheet's table past its first screen), or none the probe agrees with: none — the open tap falls back
 * to the reach around the probe point (OPEN_TAP_REACH).
 */
export function nodeCentres(nodes: readonly Rect[], t: Pick<TargetTruth, 'frame' | 'probe'>): Point[] {
  const probe = probeDelivered(t);
  return nodes.map((n) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 })).filter((c) => withinReach(c, probe, t.frame));
}

/** Whether `p` lies within OPEN_TAP_REACH of `probe` on each axis, of `frame`'s extent (at least one unit). */
const withinReach = (p: Point, probe: Point, frame: Rect) =>
  Math.abs(p.x - probe.x) <= Math.max(1, frame.width * OPEN_TAP_REACH) && Math.abs(p.y - probe.y) <= Math.max(1, frame.height * OPEN_TAP_REACH);

/**
 * The fallback where the tree names no node for the target the probe agrees with (nodeCentres): how far from the probe point an open
 * target's tap may land, as a fraction of the target's extent per axis: the
 * middle third of it around the probe point (at least one unit, the tools' rounding). A CHOSEN value between the two
 * measured: own-parts' N (iOS, both trees, a whole target its tree does not clip), whose text node starts 18 pt right
 * of the app's frame, is tapped 9 pt off its probe — 0.081 of its width, a right tap (at its node's centre); #26's C,
 * the tap moved 20 pt down to "the uncovered part" beneath a phantom tab bar button — 0.313 of its height, a wrong one.
 * Its blind spot: a cover averi imagines over less than a third of the target moves the tap less than a sixth of it,
 * and passes here — the moved-tap reply (replies.ts#movedTap) catches that one whenever averi says it moved. Where the tree lists
 * the target's node, the node-centre rule (NODE_CENTRE_SLACK) has no such spot.
 */
export const OPEN_TAP_REACH = 1 / 6;

/**
 * The open tap's judge on a `Tapped` reply: it does not say it moved the tap off a cover (replies.ts#movedTap — on a
 * target the truth measured uncovered, open, whole, reached and drawn as itself, nothing lies over its centre: the
 * cover is averi's own), at least one tap is sent, and every tap sent lies at the centre of one of the target's nodes
 * in the recorded tree (nodeCentres, within NODE_CENTRE_SLACK) — or, where the tree names none the probe agrees with,
 * at its probe point (probeDelivered), within OPEN_TAP_REACH of its extent on each axis.
 */
export function atProbe(o: Outcome, t: Pick<TargetTruth, 'frame' | 'probe'>, nodes: readonly Rect[] = []): string | undefined {
  if (movedTap(o.reply)) return `Tapped moved off a cover over its centre, on a target measured uncovered: ${first(o)}`;
  const points = tapPoints(o);
  if (points.length === 0) return `Tapped, but no tap sent: ${first(o)}`;
  const centres = nodeCentres(nodes, t);
  if (centres.length > 0) {
    const off = points.filter((p) => !centres.some((c) => Math.abs(p.x - c.x) <= NODE_CENTRE_SLACK && Math.abs(p.y - c.y) <= NODE_CENTRE_SLACK));
    return off.length === 0 ? undefined : `Tapped off its node's centre ${centres.map(pointText).join(' or ')} at ${pointsText(off)}: ${first(o)}`;
  }
  const probe = probeDelivered(t);
  const off = points.filter((p) => !withinReach(p, probe, t.frame));
  return off.length === 0 ? undefined : `Tapped off its probe point ${pointText(probe)} at ${pointsText(off)}: ${first(o)}`;
}
