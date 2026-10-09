import type { Point, Rect, UiNode } from '../../src/adapters/types.js';
import { FakeAdapter, node } from './fake.js';

/**
 * An Android scroll container as uiautomator reports it (2026-10-09, the
 * two bugs of that day: docs/bugs/2026-10-09-android-scroll-until-fully-
 * trusts-bounds-clipped-to-scroll-container.md and …-scroll-until-fling-
 * skips-target-in-lazy-list.md): a list node marked `clipsDescendants`
 * (what the parser makes of `scrollable="true"`) holding rows of equal
 * height, each in the tree only while it intersects the container (a
 * RecyclerView / LazyColumn recycles the rest) and each with its bounds
 * CUT to the container — a row half behind the header reads shorter, with
 * its edge on the container's. Chrome around it: a header above, and
 * whatever lies below the container, as plain nodes.
 *
 * A stroke moves the content only when it touches down inside the
 * container (one on the header scrolls nothing — the measured reason the
 * flush probe is drawn over the container), by the finger's travel along
 * y times `carry(travel, durationMs)`: 1 by default (a drag), more for a
 * fast stroke when a test models the fling (`flingCarry`). The content
 * stops at either end.
 */
export class LazyList extends FakeAdapter {
  /** How far the content is scrolled: row i's top is at container.y + i × rowHeight − offset. */
  offset: number;

  constructor(
    readonly labels: readonly string[],
    readonly rowHeight: number,
    readonly container: Rect,
    opts: { offset?: number; screen?: { width: number; height: number }; carry?: (travel: number, durationMs: number | undefined) => number } = {},
  ) {
    super({ s: node({ role: 'container' }) }, 's');
    this.offset = opts.offset ?? 0;
    this.screenSize = opts.screen ?? { width: 1080, height: 2220 };
    this.carry = opts.carry ?? (() => 1);
  }

  private readonly screenSize: { width: number; height: number };
  private readonly carry: (travel: number, durationMs: number | undefined) => number;

  /** The furthest the content scrolls. */
  get maxOffset(): number {
    return Math.max(0, this.labels.length * this.rowHeight - this.container.height);
  }

  /** Row `label`'s whole (uncut) rect at the current offset. */
  rowRect(label: string): Rect {
    const i = this.labels.indexOf(label);
    return { x: 0, y: this.container.y + i * this.rowHeight - this.offset, width: this.container.width, height: this.rowHeight };
  }

  override async viewport() {
    return this.screenSize;
  }

  override async uiTree(): Promise<UiNode> {
    const top = this.container.y;
    const bottom = top + this.container.height;
    const rows: UiNode[] = [];
    for (const label of this.labels) {
      const r = this.rowRect(label);
      if (r.y + r.height <= top || r.y >= bottom) continue; // recycled
      const y = Math.max(r.y, top);
      const height = Math.min(r.y + r.height, bottom) - y; // uiautomator's cut
      rows.push(node({ role: 'text', label, rect: { x: r.x, y, width: r.width, height } }));
    }
    const { width, height } = this.screenSize;
    return node({
      role: 'container',
      rect: { x: 0, y: 0, width, height },
      children: [
        node({ role: 'text', label: 'Header', rect: { x: 0, y: 0, width, height: top } }),
        node({ role: 'container', identifier: 'list', rect: { ...this.container }, clipsDescendants: true, children: rows }),
      ],
    });
  }

  override async swipe(from: Point, to: Point, durationMs?: number): Promise<void> {
    await super.swipe(from, to, durationMs);
    const c = this.container;
    const inside = from.x >= c.x && from.x < c.x + c.width && from.y >= c.y && from.y < c.y + c.height;
    if (!inside) return;
    const travel = from.y - to.y; // finger up → content scrolls toward its end
    const moved = travel * this.carry(Math.abs(travel), durationMs);
    this.offset = Math.min(this.maxOffset, Math.max(0, Math.round(this.offset + moved)));
  }
}
