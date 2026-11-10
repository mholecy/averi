import { describe, expect, it } from 'vitest';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { seenOrderOf } from '../../src/ui-tree/seen-order.js';
import { tagged } from '../helpers/covers.js';
import { parseDump } from '../helpers/android-dumps.js';

/**
 * The PREDICTIONS for backlog D77's lab cells, pinned before their capture (the owner's): what averi reads of the
 * native Android Views twin of rn-banner (fixtures/apps/android, Views.kt: `views-banner`, `views-drawn-over`) and of
 * rn-banner's role sub-case (fixtures/apps/rn, `rn-banner-role`). The dumps are SYNTHETIC, at the geometry the lab code
 * lays out on averi_lab (1080x2220, density 2.75: a slot 300x64 dp = 825x176 px, left (1080 - 825) / 2 = 127, its top
 * (142 + 180·slot - 32) dp rounded; a cover 340x52 dp = 935x143 px, 20 dp = 55 px LEFT of its target, 10 dp = 28 px
 * above it — below it for C), each run in AOSP's location order (ViewGroup.ChildListForAccessibility's stripe sort:
 * every cover, its left edge 55 px further left, before its target). A capture that disagrees is a finding, not a
 * reason to edit these pins. ADR 0015's amendment "Android Views list children by location" and its D75 residuals.
 */
const PHONE = { x: 0, y: 0, width: 1080, height: 2220 };

/** A cell's run of [cover, target] pairs in location order, under a parent of `cls` identified lab.<cell>.run. */
const bannerRun = (cell: string, cls = 'android.widget.FrameLayout') => `<node class="${cls}" resource-id="lab.${cell}.run" bounds="[0,0][1080,2220]">
      <node class="android.widget.TextView" text="Saved" resource-id="lab.${cell}.T.cover" bounds="[72,275][1007,418]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.T" clickable="true" bounds="[127,303][952,479]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.U.cover" bounds="[72,770][1007,913]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.U" clickable="true" bounds="[127,798][952,974]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.C.cover" bounds="[72,1321][1007,1464]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.C" clickable="true" bounds="[127,1293][952,1469]"/>
    </node>`;

/** The decor and the activity's content view (setContentView), holding `inner`. */
const decor = (inner: string) => `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.FrameLayout" resource-id="android:id/content" bounds="[0,0][1080,2220]">
      ${inner}
    </node>
  </node>
</hierarchy>`;

/** The same, the Views hosted in Compose (AndroidView): ComposeView > AndroidComposeView (`android.view.View`) > ViewFactoryHolder. */
const interop = (inner: string) =>
  decor(`<node class="androidx.compose.ui.platform.ComposeView" bounds="[0,0][1080,2220]">
        <node class="android.view.View" bounds="[0,0][1080,2220]">
          <node class="androidx.compose.ui.viewinterop.ViewFactoryHolder" bounds="[0,0][1080,2220]">${inner}</node>
        </node>
      </node>`);

const byId = (t: UiNode, id: string): UiNode => [...everyNode(t)].find((n) => n.identifier === id)!;
/** The eyes' answer for `tag` against `peer`, from the target's side. */
const eyes = (target: UiNode, peer: UiNode, seen: 'over' | 'under') => seenOrderOf(target, [{ peer, seen, overlap: '#263238', own: '#43A047', other: '#263238' }]);
/** Each target's centre, as averi taps it when nothing covers it. */
const CENTRE = { T: { x: 540, y: 391 }, U: { x: 540, y: 886 }, C: { x: 540, y: 1381 } } as const;

describe('P1 views-banner hosted by setContentView: the run is marked, each cover an untold peer — refused with and without the eyes', () => {
  const cell = 'views-banner';
  const t = parseDump(decor(bannerRun(cell)));

  it('the classic FrameLayout run is marked readingOrder', () => {
    expect(byId(t, `lab.${cell}.run`).readingOrder).toBe(true);
  });

  it.each(['T', 'U', 'C'])('%s carries its cover, untold; no screenshot: no tap point — refused', (tag) => {
    const e = drawOrder(t).exposure(byId(t, `lab.${cell}.${tag}`), PHONE);
    expect(tagged(e.covers)).toEqual([{ node: byId(t, `lab.${cell}.${tag}.cover`), order: 'untold', presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });

  it.each(['T', 'U', 'C'])('%s: the eyes seeing the cover drawn over it — still refused, no tap point', (tag) => {
    const target = byId(t, `lab.${cell}.${tag}`);
    const cover = byId(t, `lab.${cell}.${tag}.cover`);
    const e = drawOrder(t, eyes(target, cover, 'under')).exposure(target, PHONE);
    expect(tagged(e.covers)).toEqual([{ node: cover, order: 'seenOver', presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });
});

/**
 * Why views-banner must NOT be hosted in Compose: AndroidView interop sits under the node provider's host (a plain
 * `android.view.View`, android.ts#providesNodes), so its run is never marked though AOSP sorts it by location — every
 * cover, listed first, reads as drawn under its target and the tap lands on the cover (LR4's lie). ADR 0015's residual
 * "Compose, and anything not location-sorted, stay on draw order".
 */
describe('P2 the same run in Compose AndroidView interop: unmarked, tapped at the centre — LR4\'s lie survives (ADR 0015 residual)', () => {
  const cell = 'views-banner';
  const t = parseDump(interop(bannerRun(cell)));

  it('the run under the provider\'s host is not marked', () => {
    expect(byId(t, `lab.${cell}.run`).readingOrder).toBeUndefined();
  });

  it.each(['T', 'U', 'C'] as const)('%s: no cover, tapped at its centre', (tag) => {
    const e = drawOrder(t).exposure(byId(t, `lab.${cell}.${tag}`), PHONE);
    expect(e.covers).toEqual([]);
    expect(e.tapAt).toEqual({ point: CENTRE[tag], moved: false });
  });
});

/**
 * rn-banner-role (sub-case b): each slot is a View carrying `accessibilityRole="toolbar"`, which React Native dumps as
 * `android.view.View` (ReactAccessibilityDelegate.kt, AccessibilityRole.getValue), un-flattened (`collapsable={false}`):
 * a container of [cover, target] — location order, the cover's left 20 dp further left. The container ENCLOSES its
 * cover (the slot widened 20 dp left and right, 10 dp up and down), so no bound is clipped: a slot as small as its
 * target would clip the cover's dumped bounds to it (View#getBoundsOnScreen clips to each parent) and fail the location
 * check on its own — the cell would not tell the role rule from the clip. Here only the provider rule
 * (android.ts#providesNodes) leaves the run unmarked: LR4's lie is the EXPECTED prediction (ADR 0015's role residual,
 * not narrowed), to be filed in react-native.known.ts once captured.
 */
describe('P3 rn-banner-role: the slot container dumps as android.view.View — unmarked, tapped at the centre (LR4 survives)', () => {
  const cell = 'rn-banner-role';
  const slot = (tag: string, top: number, coverTop: number) => `<node class="android.view.View" resource-id="lab.${cell}.${tag}.slot" bounds="[72,${top - 28}][1007,${top - 28 + 231}]">
        <node class="android.view.ViewGroup" resource-id="lab.${cell}.${tag}.cover" bounds="[72,${coverTop}][1007,${coverTop + 143}]"/>
        <node class="android.view.ViewGroup" resource-id="lab.${cell}.${tag}" clickable="true" bounds="[127,${top}][952,${top + 176}]"/>
      </node>`;
  const t = parseDump(
    decor(`<node class="android.view.ViewGroup" bounds="[0,0][1080,2220]">
      ${slot('T', 303, 275)}
      ${slot('U', 798, 770)}
      ${slot('C', 1293, 1321)}
    </node>`),
  );

  it.each(['T', 'U', 'C'])('%s\'s slot container is not marked', (tag) => {
    expect(byId(t, `lab.${cell}.${tag}.slot`).readingOrder).toBeUndefined();
  });

  it.each(['T', 'U', 'C'] as const)('%s: no cover, tapped at its centre — on the cover', (tag) => {
    const e = drawOrder(t).exposure(byId(t, `lab.${cell}.${tag}`), PHONE);
    expect(e.covers).toEqual([]);
    expect(e.tapAt).toEqual({ point: CENTRE[tag], moved: false });
  });
});

/**
 * views-drawn-over (sub-case a), B's side: A listed BEFORE B by location (left 127 before 182, one stripe) but drawn
 * over it — by child order (A the later child) or by translationZ (A2) — each holding the other's centre. B's peer A,
 * listed before it, is untold: with no screenshot B is refused, and the eyes seeing B under A keep it refused. A's side
 * (B an untold peer, lifted when the eyes see A on top: A `Tapped`) is pinned in
 * draw-order-android-reading-order.test.ts ("a later-listed control over the target's centre in a classic run").
 */
describe('P4 views-drawn-over, B\'s side: A listed before and drawn over it — B refused, with and without the eyes', () => {
  const cell = 'views-drawn-over';
  const t = parseDump(
    decor(`<node class="android.widget.FrameLayout" resource-id="lab.${cell}.run" bounds="[0,0][1080,2220]">
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.A" clickable="true" bounds="[127,303][952,479]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.B" clickable="true" bounds="[182,331][1007,452]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.A2" clickable="true" bounds="[127,798][952,974]"/>
      <node class="android.widget.FrameLayout" resource-id="lab.${cell}.B2" clickable="true" bounds="[182,826][1007,947]"/>
    </node>`),
  );

  it('the run is marked', () => {
    expect(byId(t, `lab.${cell}.run`).readingOrder).toBe(true);
  });

  it.each([['B', 'A'], ['B2', 'A2']])('%s, no screenshot: %s an untold cover — refused', (b, a) => {
    const e = drawOrder(t).exposure(byId(t, `lab.${cell}.${b}`), PHONE);
    expect(tagged(e.covers)).toEqual([{ node: byId(t, `lab.${cell}.${a}`), order: 'untold', presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });

  it.each([['B', 'A'], ['B2', 'A2']])('%s, the eyes seeing it under %s: refused', (b, a) => {
    const target = byId(t, `lab.${cell}.${b}`);
    const over = byId(t, `lab.${cell}.${a}`);
    const e = drawOrder(t, eyes(target, over, 'under')).exposure(target, PHONE);
    expect(tagged(e.covers)).toEqual([{ node: over, order: 'seenOver', presented: false }]);
    expect(e.tapAt).toBeUndefined();
  });
});
