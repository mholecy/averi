import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import type { Outcome } from '../differential.js';
import { pointText, probePoint, touchesAt } from '../../truth/truth.js';
import { BUDGET_MS, classed, first, MOVED_TAP, ownWords, passes, pointsText, reachedWithNoSwipe, tapPoints, type Expectation, type Point } from './judges.js';

/**
 * The base family's rows (fixtures/apps/cells/base.json): a coloured target open — reached by its probe and drawn as
 * itself — wherever it lies (the `open` cell's four, a presented cell's target inside its layer).
 *
 * | truth | tap | colour assert | scroll_until down |
 * |---|---|---|---|
 * | open: reached, drawn as itself | `Tapped` at its probe point (atProbe) | passes on its own colour | visible after 0 swipes |
 *
 * `selector`: what the tap and scroll_until ask by — the target's identifier, or a text target's text
 * (golden-spec/false-covers.ts#ownPartsRows).
 */
export function openRows(platform: Platform, t: TargetTruth, selector = `id:"${t.id}"`): Expectation[] {
  const element = { id: t.id };
  const probe = probeDelivered(t);
  return ([
    {
      verb: 'tap',
      says: `Tapped at its probe point ${pointText(probe)}`,
      call: { tool: 'tap', args: { platform, selector } },
      judge: (o) => (o.reply.startsWith('Tapped') ? atProbe(o, t) : `not tapped: ${first(o)}`),
    },
    {
      verb: 'colour',
      says: `passes on its own colour ${t.color}`,
      call: { tool: 'assert', args: { platform, asserts: [{ element, color: { expected: t.color }, timeout: BUDGET_MS }] } },
      judge: passes,
    },
    {
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
 * How far from the probe point an open target's tap may land, as a fraction of the target's extent per axis: the
 * middle third of it around the probe point (at least one unit, the tools' rounding). averi's tap on an open target is
 * centre-based (ADR 0009 N-a), the centre of the target's node in the tree it reads. A CHOSEN value between the two
 * measured: own-parts' N (iOS, both trees, a whole target its tree does not clip), whose text node starts 18 pt right
 * of the app's frame, is tapped 9 pt off its probe — 0.081 of its width, a right tap; #26's C, the tap moved 20 pt down
 * to "the uncovered part" beneath a phantom tab bar button — 0.313 of its height, a wrong one. Its blind spot: a cover
 * averi imagines over less than a third of the target moves the tap less than a sixth of it, and passes here — the
 * moved-tap reply (MOVED_TAP) catches that one whenever averi says it moved. A follow-up (the plan's phase 3 round 3)
 * would hold every tap to the centre of the target's node in the recorded tree instead.
 */
export const OPEN_TAP_REACH = 1 / 6;

/**
 * The open tap's judge on a `Tapped` reply: it does not say it moved the tap off a cover (judges.ts#MOVED_TAP — on a
 * target the truth measured uncovered, open, whole, reached and drawn as itself, nothing lies over its centre: the
 * cover is averi's own), at least one tap is sent, and every tap sent lies at the target's probe point
 * (probeDelivered), within OPEN_TAP_REACH of its extent on each axis.
 */
export function atProbe(o: Outcome, t: Pick<TargetTruth, 'frame' | 'probe'>): string | undefined {
  if (MOVED_TAP.test(ownWords(o))) return `Tapped moved off a cover over its centre, on a target measured uncovered: ${first(o)}`;
  const probe = probeDelivered(t);
  const points = tapPoints(o);
  if (points.length === 0) return `Tapped, but no tap sent: ${first(o)}`;
  const dx = Math.max(1, t.frame.width * OPEN_TAP_REACH);
  const dy = Math.max(1, t.frame.height * OPEN_TAP_REACH);
  const off = points.filter((p) => Math.abs(p.x - probe.x) > dx || Math.abs(p.y - probe.y) > dy);
  return off.length === 0 ? undefined : `Tapped off its probe point ${pointText(probe)} at ${pointsText(off)}: ${first(o)}`;
}
