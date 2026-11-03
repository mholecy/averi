import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import type { RoundRules } from '../../src/interact/scroll-rounds.js';
import { describeScrollResult } from '../../src/interact/scroll-text.js';
import { parseDump } from '../helpers/android-dumps.js';
import { decided, failureOf, play, resultOf, type Row } from '../helpers/rounds.js';

/**
 * THE REVEAL over the lab's real capture (scroll-bounded-flush, uiautomator, emulator-5554): S, 176 px tall, lies at
 * rest with 22 px of it showing at the bottom of the lower list (`[0,1046][1080,1541]`), dumped `[128,1519][953,1541]` —
 * cut to the list's edge, 154 px of it below. Each read below is that dump with S (and its child) moved up by the
 * list's offset as the app logged it, S's bounds cut at 1541 as uiautomator cuts them.
 * docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md
 */
const XML = readFileSync(new URL('../fixtures/truth/android-averi_lab-api33/scroll-bounded-flush.xml', import.meta.url), 'utf8');
const LOWER: Rect = { x: 0, y: 1046, width: 1080, height: 495 };
const S_TOP = 1519;
const S_HEIGHT = 176;
const S_ID = 'lab.scroll-bounded-flush.S';

/**
 * The read with the lower list scrolled `offset` px: S's top at 1519 − offset, its bounds cut at the list's bottom.
 * `across`: the lower list dumped as a HorizontalScrollView — a tree changed since the probe, no list around S
 * scrolling along its bottom edge's axis.
 */
function sAt(offset: number, extra: Row = {}, across = false): Row {
  const top = S_TOP - offset;
  const bottom = Math.min(LOWER.y + LOWER.height, top + S_HEIGHT);
  const lower = across ? XML.replace('class="android.widget.ScrollView" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,1046][1080,1541]"', 'class="android.widget.HorizontalScrollView" package="dev.averi.lab" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="true" long-clickable="false" password="false" selected="false" bounds="[0,1046][1080,1541]"') : XML;
  if (across && lower === XML) throw new Error('no lower list in the capture');
  const xml = lower.replace('bounds="[128,1519][953,1541]"', `bounds="[128,${top}][953,${bottom}]"`).replace('bounds="[128,1519][953,1607]"', `bounds="[128,${top}][953,${top + 88}]"`);
  const tree = parseDump(xml);
  const s = [...everyNode(tree)].find((n: UiNode) => n.identifier === S_ID);
  if (s === undefined) throw new Error('no S in the capture');
  return { tree, found: [s], ...extra };
}

const RULES: RoundRules & { screen: { width: number; height: number } } = { direction: 'down', fully: true, maxSwipes: 6, timeoutMs: 15_000, screen: { width: 1080, height: 2220 } };
const strokes = (played: ReturnType<typeof play>) => played.steps.filter((s) => s.do === 'stroke').map(decided);

describe('a probe that revealed more of a match still flush on the same edge proved the cut: the next stroke reveals the rest', () => {
  it.each([
    // [what, the probe's move, the reveal's travel: half of 1519 − move − 1046]
    ['the nominal run (the probe moved S 60 px)', 60, 206],
    ['a lossy first probe (21 px for the same stroke)', 21, 226],
    ['calibration #12\'s run (38 px)', 38, 217],
  ])('%s: no confirm between the probe and the reveal, S whole after 2 swipes', (_, moved, travel) => {
    const played = play(RULES, [sAt(0), sAt(moved), sAt(moved + 220), sAt(moved + 220)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'confirm', 'stop']);
    expect(strokes(played)).toEqual([
      { do: 'stroke', kind: 'full', toward: 'down', reach: 0.25, box: LOWER, probe: true, maxTravel: 177 },
      // The whole stroke over the list, its travel half the room above S — past the probe's cap: a bottom edge.
      { do: 'stroke', kind: 'full', toward: 'down', reach: 1, box: LOWER, probe: true, maxTravel: travel },
    ]);
    const result = resultOf(played);
    expect(result).toEqual({ swipes: 2, visible: 1, clipped: [] });
    expect(describeScrollResult(result)).toBe('fully visible after 2 swipes');
  });

  it('a reveal that leaves it flush with more showing again reveals again, the room taken anew', () => {
    const played = play(RULES, [sAt(0), sAt(60), sAt(120), sAt(300), sAt(300)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'confirm', 'stop']);
    expect(strokes(played).map((s) => s.do === 'stroke' && s.maxTravel)).toEqual([177, 206, 176]);
  });

  // Rewritten on purpose (D62): this was "a reveal after which it holds is checked" — but the 74-px probe carried S
  // 60 px, its whole length less twice the slop, so the content did not end under it, and a reveal that then moved
  // nothing may not have been taken by the app (batch-9). Doubted once: sent again, and checked only if that one holds.
  it('D62: a reveal that held right after a probe that carried S its whole stroke is sent again — checked when that one holds too, the cut when no swipe is left', () => {
    const played = play(RULES, [sAt(0), sAt(60), sAt(60), sAt(60)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'stop']);
    expect(strokes(played).map((s) => s.do === 'stroke' && s.maxTravel)).toEqual([177, 206, 206]);
    expect(resultOf(played)).toMatchObject({ swipes: 3, flush: { edge: 'bottom', container: LOWER, checked: true } });
    const moved = play(RULES, [sAt(0), sAt(60), sAt(60), sAt(280), sAt(280)]);
    expect(moved.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'confirm', 'stop']);
    expect(describeScrollResult(resultOf(moved))).toBe('fully visible after 3 swipes');
    const spent = play({ ...RULES, maxSwipes: 2 }, [sAt(0), sAt(60), sAt(60)]);
    expect(spent.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' }, short: { of: 'flushCut', revealed: 60, why: 'budget' } });
    expect(failureOf(spent, `id:"${S_ID}"`).message).toBe(
      `scroll_until id:"${S_ID}" failed after 2 swipes (maxSwipes) — ` +
        "element reached the viewport but its bottom edge still lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, " +
        'and a probe swipe toward it showed 60 px more of it — part of it lay past that edge, so it may still be cut there (last rect {"x":128,"y":1459,"width":825,"height":82}); raise maxSwipes or timeoutMs',
    );
  });

  it('no swipe or time left for the reveal: the bound fails naming the cut the probe proved — never "fully visible"', () => {
    const late = play(RULES, [sAt(0), { ...sAt(60), elapsedMs: 15_000 }]);
    expect(late.steps.map((s) => s.do)).toEqual(['stroke', 'stop']);
    expect(late.outcome).toMatchObject({ kind: 'bound', by: { of: 'timeout' }, short: { of: 'flushCut', edge: 'bottom', container: LOWER, revealed: 60 } });
    expect(failureOf(late, `id:"${S_ID}"`).message).toBe(
      `scroll_until id:"${S_ID}" failed after 15000ms (timeout 15000ms; 1 swipe sent; 2 tree reads took 0ms, the last 0ms) — ` +
        "element reached the viewport but its bottom edge still lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, " +
        'and a probe swipe toward it showed 60 px more of it — part of it lay past that edge, so it may still be cut there (last rect {"x":128,"y":1459,"width":825,"height":82}); raise maxSwipes or timeoutMs',
    );
    const spent = play({ ...RULES, maxSwipes: 1 }, [sAt(0), sAt(60)]);
    expect(spent.outcome).toMatchObject({ kind: 'bound', by: { of: 'maxSwipes' }, short: { of: 'flushCut', revealed: 60 } });
    expect(failureOf(spent, `id:"${S_ID}"`).message).toContain('failed after 1 swipe (maxSwipes) — element reached the viewport but its bottom edge still lies on');
  });

  it('no reveal can be drawn on the read that proved the cut (a tree changed: only a list across the axis): no "fully visible" — the read is short of the cut', () => {
    const played = play(RULES, [sAt(0), sAt(60, {}, true), { ...sAt(60, {}, true), elapsedMs: 15_000 }]);
    expect(played.steps.map((s) => s.do)).not.toContain('confirm');
    expect(played.outcome).toMatchObject({ kind: 'bound', short: { of: 'flushCut', edge: 'bottom', container: LOWER, revealed: 60, why: 'axis' } });
    expect(failureOf(played, `id:"${S_ID}"`).message).toContain(
      'and a probe swipe toward it showed 60 px more of it — part of it lay past that edge, so it may still be cut there, and every scroll container around it from that one outward scrolls only sideways, so no swipe can reveal the rest (last rect {"x":128,"y":1459,"width":825,"height":82}); check with a screenshot',
    );
  });

  it('a reveal drawn too short to tell from a tap that moved nothing: no "fully visible" — the read is short of the cut', () => {
    const tap = { from: { x: 540, y: 1443 }, to: { x: 540, y: 1425 } }; // 18 px, under twice the slop
    const played = play(RULES, [sAt(0), sAt(60), { ...sAt(60), drawn: tap, elapsedMs: 15_000 }]);
    expect(played.outcome).toMatchObject({ kind: 'bound', short: { of: 'flushCut', revealed: 60, why: 'tap' } });
    expect(failureOf(played, `id:"${S_ID}"`).message).toContain(
      'so it may still be cut there, and the swipe that followed to reveal the rest moved nothing but was too short to tell from a tap (last rect {"x":128,"y":1459,"width":825,"height":82}); check with a screenshot',
    );
  });

  it('the proof is kept while it lies flush on that edge: a later read, after a stroke that was no reveal, reveals at once — no confirm, no quarter probe', () => {
    const played = play(RULES, [sAt(0), sAt(60, {}, true), sAt(60), sAt(280), sAt(280)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'stroke', 'confirm', 'stop']);
    const [probe, course, reveal] = strokes(played);
    expect(probe).toMatchObject({ probe: true, reach: 0.25 });
    expect(course).not.toHaveProperty('probe');
    expect(reveal).toMatchObject({ probe: true, reach: 1, maxTravel: 206 });
    expect(resultOf(played)).toEqual({ swipes: 3, visible: 1, clipped: [] });
  });

  it('strokes that no longer move a match on a proven cut it cannot reveal: the stuck stop names the cut, never "fully visible"', () => {
    const across = sAt(60, {}, true);
    const played = play(RULES, [sAt(0), across, across, across, across]);
    expect(played.outcome).toMatchObject({ kind: 'stuck', short: { of: 'flushCut', why: 'axis', revealed: 60 } });
    expect(failureOf(played, `id:"${S_ID}"`).message).toContain(
      'so no swipe can reveal the rest — and swiping down no longer moves it, nor does swiping up; check with a screenshot. Last rect {"x":128,"y":1459,"width":825,"height":82}',
    );
  });

  it('a probe after which it lies flush on the same edge with LESS of it showing proved nothing: confirmed and probed again, no reveal', () => {
    const played = play(RULES, [sAt(60), sAt(30), sAt(30), sAt(30)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stroke', 'stop']);
    expect(strokes(played).map((s) => s.do === 'stroke' && s.reach)).toEqual([0.25, 0.25]);
  });

  it('a match that grew flush on the same edge with its uncut edge where it was (its container grew, the content did not carry it) proved no cut: confirmed, no reveal', () => {
    // The list grows 40 px at its bottom and S's cut bounds with it; S's top stays at 1519 — nothing scrolled.
    const grown = (): Row => {
      const xml = XML.replace('bounds="[0,1046][1080,1541]"', 'bounds="[0,1046][1080,1581]"').replace('bounds="[128,1519][953,1541]"', 'bounds="[128,1519][953,1581]"');
      const tree = parseDump(xml);
      const s = [...everyNode(tree)].find((n: UiNode) => n.identifier === S_ID);
      if (s === undefined) throw new Error('no S in the capture');
      return { tree, found: [s] };
    };
    const played = play(RULES, [sAt(0), grown(), grown(), grown()]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stroke', 'stop']);
    expect(strokes(played).map((s) => s.do === 'stroke' && s.reach)).toEqual([0.25, 0.25]);
  });

  it('a read that judges no stop answers the probe in flight: the match back where the probe was sent from on a later read is a new candidate, probed again — not held', () => {
    // S flush at the bottom (142 of it showing), probed; the probe's read lost it; it comes back where it was, after a
    // stroke and a confirming read: no stop held through a probe — a probe of its own.
    const played = play(RULES, [sAt(120), { found: [] }, sAt(120), sAt(120)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'stroke', 'confirm', 'stroke']);
    const [probe, course, again] = strokes(played);
    expect(probe).toMatchObject({ probe: true, reach: 0.25 });
    expect(course).not.toHaveProperty('probe');
    expect(again).toMatchObject({ probe: true, reach: 0.25, toward: 'down' });
  });

  it('a probe that moved it out of the flush: the ordinary stop — confirmed, no reveal', () => {
    const played = play(RULES, [sAt(0), sAt(200), sAt(200)]);
    expect(played.steps.map((s) => s.do)).toEqual(['stroke', 'confirm', 'stop']);
    expect(resultOf(played)).toEqual({ swipes: 1, visible: 1, clipped: [] });
  });
});
