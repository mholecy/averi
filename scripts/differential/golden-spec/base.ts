import type { Platform } from '../corpus.js';
import type { TargetTruth } from '../../truth/schema.js';
import { pointText, probePoint } from '../../truth/truth.js';
import { BUDGET_MS, classed, first, passes, pointsText, reachedWithNoSwipe, tapPoints, type Expectation, type Point } from './judges.js';

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
      judge: (o) => (o.reply.startsWith('Tapped') ? atProbe(tapPoints(o), t, first(o)) : `not tapped: ${first(o)}`),
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
 * Where the capture's probe tap on the target was delivered: the touch the app logged for it (TargetTruth.probe, its
 * `touch` event, the app's own record of where the touch began) — else the point it was sent at (truth.ts#probePoint,
 * the frame's centre). An open target is `reached`: a raw tap THERE fired its action — the one point of it the truth
 * measured.
 */
export function probeDelivered(t: Pick<TargetTruth, 'frame' | 'probe'>): Point {
  const touch = t.probe.find((e) => e.kind === 'touch');
  if (touch !== undefined) {
    const [x, y] = touch.tag.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  }
  return probePoint(t.frame);
}

/**
 * How far from the probe point an open target's tap may land, as a fraction of the target's extent per axis: the
 * middle third of it around the probe point (at least one unit, the tools' rounding). averi's tap on an open target is
 * centre-based (ADR 0009 N-a), the centre of the target's node in the tree it reads; where that tree draws the node
 * another extent than the app's frame, the centre moves by half the difference — measured on own-parts' N (iOS, both
 * trees): its text node starts 18 pt right of the app's frame, the tap 9 pt off the probe, 8 % of its width. A tap moved
 * further is averi steering around something it believes lies over the target, and on an open, uncovered target nothing
 * does: calibration.json #26, a phantom tab bar's button read over C, the tap moved 20 pt down (31 % of its height) to
 * "the uncovered part", where no probe fired.
 */
export const PROBE_REACH = 1 / 6;

/**
 * The open tap's judge on a `Tapped` reply: at least one tap sent, and every tap sent at the target's probe point
 * (probeDelivered), within PROBE_REACH of its extent on each axis; `said` is the reply's first line.
 */
export function atProbe(points: readonly Point[], t: Pick<TargetTruth, 'frame' | 'probe'>, said: string): string | undefined {
  const probe = probeDelivered(t);
  if (points.length === 0) return `Tapped, but no tap sent: ${said}`;
  const dx = Math.max(1, t.frame.width * PROBE_REACH);
  const dy = Math.max(1, t.frame.height * PROBE_REACH);
  const off = points.filter((p) => Math.abs(p.x - probe.x) > dx || Math.abs(p.y - probe.y) > dy);
  return off.length === 0 ? undefined : `Tapped off its probe point ${pointText(probe)} at ${pointsText(off)}: ${said}`;
}
