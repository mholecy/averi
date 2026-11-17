import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseWdaSourceValue } from '../../src/adapters/wda-source.js';
import { clipsOf, toldFrame, largestScroller } from '../../src/ui-tree/scroll-clips.js';
import { everyNode, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { COMPOSE, parseDump } from '../helpers/android-dumps.js';
import { node as fakeNode } from '../helpers/fake.js';

/**
 * scroll-clips.ts#clipsOf asked of whole trees, hand-built and parsed: each node's clipping ancestors
 * (`Clips.scrollersOf`), the cuts its content evidences (`Clips.cutSliver`), the screen's largest scroller, and the
 * frame a node is drawn in (`Clips.inScroller`, `Clips.drawnIn`). The corners asked directly are scroll-clips.test.ts's.
 */

/** A nested tree's listing: its nesting is its ancestry (dialect.ts#TreeDialect.ancestry). */
const NESTED = { ancestry: true } as const;

const node = (rect: UiNode['rect'], identifier: string | null = null, children: UiNode[] = []): UiNode => ({
  role: 'other',
  label: null,
  identifier,
  value: null,
  rect,
  children,
});

describe('clipsOf(tree).scrollersOf — each node\'s clipping ancestors, nearest first (2026-10-09)', () => {
  const rect = (y: number, height: number) => ({ x: 0, y, width: 1080, height });
  const leaf = (y: number) => ({ role: 'text', label: 'r', identifier: null, value: null, rect: rect(y, 100), children: [] });
  it('the marked ancestors\' rects, the nearest first — an inner list before the page around it; none for the outermost scroller or a node outside', () => {
    const inInner = leaf(600);
    const inOuter = leaf(300);
    const inner = { role: 'scrollable', label: null, identifier: 'inner', value: null, rect: rect(500, 400), children: [inInner], clipsDescendants: true as const };
    const outer = { role: 'container', label: null, identifier: 'page', value: null, rect: rect(242, 1736), children: [inOuter, inner], clipsDescendants: true as const };
    const bare = leaf(2000);
    const root = { role: 'container', label: null, identifier: null, value: null, rect: rect(0, 2220), children: [outer, bare] };
    const of = clipsOf(root, NESTED).scrollersOf;
    expect(of(inInner)).toEqual([rect(500, 400), rect(242, 1736)]);
    expect(of(inOuter)).toEqual([rect(242, 1736)]);
    expect(of(inner)).toEqual([rect(242, 1736)]);
    expect(of(outer)).toEqual([]);
    expect(of(bare)).toEqual([]);
    expect(of(leaf(600))).toEqual([]); // a node of another read
  });
});

/** Any depth: `Clips.cutSliver` under this minimum is the cut its evidence finds, however deep (scroll-clips.ts#evidentCut, unexported, through the clip facts). */
const ANY_DEPTH = Number.MAX_SAFE_INTEGER;

/**
 * The cut the clip facts find of `n` nested in clipping containers of `chain`'s rects (nearest first) — the evidence of
 * n's OWN content, at any depth: never one inherited from what it lies in (`Cut.within`), which would let the
 * inheritance path answer for a node whose own evidence broke.
 */
const cutOf = (n: UiNode, chain: readonly UiNode['rect'][]) => {
  let inner: UiNode = n;
  for (const rect of chain) inner = { ...node(rect, null, [inner]), clipsDescendants: true };
  const cut = clipsOf(node({ x: -5000, y: -5000, width: 20000, height: 20000 }, null, [inner]), NESTED).cutSliver(n, ANY_DEPTH);
  expect(cut?.within).toBeUndefined();
  return cut;
};

/**
 * SYNTHETIC shapes, hand-built rects around the measured ones: the edge cases of the evidence a pixel either side
 * of each threshold, which uiautomator's parser would reshape (Compose's widening of a node cut short of its
 * children, the clamping of inverted bounds). The parsed set follows.
 */
describe('Clips.cutSliver at any depth, synthetic shapes — a node cut at a clipping ancestor\'s edge, by what its own content says (scroll-clips.ts#evidentCut)', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  const at = (rect: UiNode['rect'], ...children: UiNode[]) => node(rect, null, children);
  /** The measured toggle 66,1924 948x55 on the form's bottom (1978), a child from `top` to `bottom`. */
  const toggleWith = (top: number, bottom: number) => at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: top, width: 948, height: bottom - top }));
  it('the measured toggle: flush with the form\'s bottom, its button running into the cut from 12 px inside — cut there, 55 deep', () => {
    expect(cutOf(toggleWith(1936, 1978), [form])).toEqual({ edge: 'bottom', container: form, depth: 55 });
  });
  it('Compose\'s shape: a descendant past the edge is evidence whatever its other side', () => {
    const row = at({ x: 132, y: 242, width: 948, height: 33 }, at({ x: 132, y: 115, width: 816, height: 160 }));
    expect(cutOf(row, [form])).toEqual({ edge: 'top', container: form, depth: 33 });
  });
  it('within a pixel is ON a side: a child starting 1 px inside the node does not run in, 2 px does; one ending 1 px short of the edge reaches it, 2 px short does not', () => {
    expect(cutOf(toggleWith(1925, 1978), [form])).toBeUndefined();
    expect(cutOf(toggleWith(1926, 1978), [form])?.edge).toBe('bottom');
    expect(cutOf(toggleWith(1936, 1977), [form])?.edge).toBe('bottom');
    expect(cutOf(toggleWith(1936, 1976), [form])).toBeUndefined();
  });
  it('inside evidence needs MIN_INSIDE_EVIDENCE (8) along y: a 7-px divider or focus line at the cut is none, 8 px is; past the edge, any thickness counts', () => {
    expect(cutOf(toggleWith(1971, 1978), [form])).toBeUndefined();
    expect(cutOf(toggleWith(1970, 1978), [form])?.edge).toBe('bottom');
    expect(cutOf(at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: 1977, width: 948, height: 3 })), [form])?.edge).toBe('bottom'); // 2 px past
  });
  it('past the edge by more than a pixel: 1 px past is on it (a fill), 2 px past is evidence', () => {
    expect(cutOf(toggleWith(1924, 1979), [form])).toBeUndefined();
    expect(cutOf(toggleWith(1924, 1980), [form])?.edge).toBe('bottom');
  });
  it('nothing cut: a label inside, a background filling the node, a leaf, a node not flush, a zero-area descendant, no clipping ancestor', () => {
    const whole = { x: 66, y: 1930, width: 948, height: 48 };
    expect(cutOf(at(whole, at({ x: 480, y: 1942, width: 120, height: 24 })), [form])).toBeUndefined();
    expect(cutOf(at(whole, at(whole)), [form])).toBeUndefined();
    expect(cutOf(at(whole), [form])).toBeUndefined();
    expect(cutOf(at({ x: 66, y: 1900, width: 948, height: 48 }, at({ x: 66, y: 1920, width: 948, height: 28 })), [form])).toBeUndefined();
    expect(cutOf(at(whole, at({ x: 66, y: 1978, width: 948, height: 0 })), [form])).toBeUndefined();
    expect(cutOf(toggleWith(1936, 1978), [])).toBeUndefined();
  });
  it('at a SIDE only content past the edge counts: a whole 60-px tile flush left with its icon flush left reads whole; a full-bleed row\'s flush content too', () => {
    const list = { x: 0, y: 200, width: 1080, height: 1800 };
    expect(cutOf(at({ x: 0, y: 500, width: 60, height: 60 }, at({ x: 0, y: 510, width: 40, height: 40 })), [list])).toBeUndefined();
    expect(cutOf(at({ x: 132, y: 600, width: 948, height: 175 }, at({ x: 948, y: 625, width: 132, height: 132 })), [list])).toBeUndefined();
    expect(cutOf(at({ x: 1030, y: 900, width: 50, height: 60 }, at({ x: 1030, y: 900, width: 82, height: 60 })), [list])).toEqual({ edge: 'right', container: list, depth: 50 });
  });
  it('the SHALLOWEST evidenced edge over the whole chain: a card cut to 50 px at a carousel\'s right with an image at its top is judged at the right', () => {
    const carousel = { x: 0, y: 600, width: 1080, height: 300 };
    const card = at({ x: 1030, y: 600, width: 50, height: 300 }, at({ x: 1046, y: 600, width: 34, height: 200 }), at({ x: 1040, y: 650, width: 200, height: 40 }));
    expect(cutOf(card, [carousel])).toEqual({ edge: 'right', container: carousel, depth: 50 });
    // …and a side cut on an OUTER ancestor is found past the nearest one's evidenced top.
    const page = { x: 0, y: 0, width: 1080, height: 2220 };
    const outerCard = at({ x: 1030, y: 600, width: 50, height: 300 }, at({ x: 1046, y: 600, width: 34, height: 200 }), at({ x: 1040, y: 650, width: 200, height: 40 }));
    expect(cutOf(outerCard, [{ x: 0, y: 600, width: 2000, height: 300 }, page])).toEqual({ edge: 'right', container: page, depth: 50 });
  });
  it('a descendant dumped CLIPPED OUT past the flush edge is evidence there: Settings\' row cut to 33 px at the list\'s top, its texts clamped to zero area at 297 — cut, 33 deep', () => {
    const list = { x: 0, y: 297, width: 1080, height: 1857 };
    const out = (rect: UiNode['rect'], side: NonNullable<UiNode['clippedOut']>): UiNode => ({ ...node(rect), clippedOut: side });
    const row = (...texts: UiNode[]) => at({ x: 0, y: 297, width: 1080, height: 33 }, at({ x: 66, y: 297, width: 66, height: 33 }), ...texts);
    expect(cutOf(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'top'), out({ x: 198, y: 297, width: 621, height: 0 }, 'top')), [list])).toEqual({ edge: 'top', container: list, depth: 33 });
    expect(cutOf(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'top')), [list])).toEqual({ edge: 'top', container: list, depth: 33 });
    // Without them the icon, cut with the row to its own height, says nothing.
    expect(cutOf(row(), [list])).toBeUndefined();
    // Clipped out the OTHER way, or clamped at an edge that is not this one (an inner clip 13 px down): no evidence of a cut at the top.
    expect(cutOf(row(out({ x: 198, y: 297, width: 126, height: 0 }, 'bottom')), [list])).toBeUndefined();
    expect(cutOf(row(out({ x: 198, y: 310, width: 126, height: 0 }, 'top')), [list])).toBeUndefined();
    // A plain zero-area descendant (no mark) stays none.
    expect(cutOf(row(at({ x: 198, y: 297, width: 126, height: 0 })), [list])).toBeUndefined();
  });
  it('equal depths: the NEAREST ancestor\'s edge wins (the chain is walked nearest first; a later edge must be shallower)', () => {
    const inner = { x: 0, y: 1900, width: 1080, height: 79 };
    const row = at({ x: 66, y: 1924, width: 948, height: 55 }, at({ x: 66, y: 1936, width: 948, height: 42 }));
    expect(cutOf(row, [inner, form])).toEqual({ edge: 'bottom', container: inner, depth: 55 });
  });
});

/**
 * The clippedOut evidence at every edge, through the parser as uiautomator dumps it —
 * the verification's probe shapes — and the two stated residuals it leaves (scroll-clips.ts#evidentCut, "Unknowable").
 */
describe('Clips.cutSliver at any depth — clippedOut evidence at each edge, parsed (scroll-clips.ts#evidentCut)', () => {
  const dump = (inner: string, list = '[0,297][1080,2154]') =>
    `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="androidx.recyclerview.widget.RecyclerView" scrollable="true" resource-id="a:id/list" bounds="${list}">${inner}</node></node></hierarchy>`;
  const cutOf = (xml: string, id: string) => {
    const tree = parseDump(xml);
    const find = (n: UiNode): UiNode | undefined => (n.identifier === id ? n : n.children.map(find).find(Boolean));
    const n = find(tree)!;
    const cut = clipsOf(tree, NESTED).cutSliver(n, ANY_DEPTH);
    expect(cut?.within).toBeUndefined(); // its own evidence, never an inherited cut
    return cut;
  };
  const text = (bounds: string) => `<node class="android.widget.TextView" resource-id="a:id/title" text="Apps" bounds="${bounds}"/>`;
  const row = (id: string, bounds: string, ...kids: string[]) => `<node class="android.widget.LinearLayout" clickable="true" resource-id="a:id/${id}" bounds="${bounds}">${kids.join('')}</node>`;
  const carousel = '[0,400][1080,700]';

  it('bottom: a row cut to 34 px at the list\'s bottom, its text dumped wholly below — cut there, 34 deep', () => {
    expect(cutOf(dump(row('row', '[0,2120][1080,2154]', text('[198,2200][324,2154]'))), 'row')).toEqual({ edge: 'bottom', container: { x: 0, y: 297, width: 1080, height: 1857 }, depth: 34 });
  });
  it('left and right: a card cut to 40 px at a carousel\'s side, its text dumped wholly past it — cut there, 40 deep', () => {
    expect(cutOf(dump(row('card', '[0,400][40,700]', text('[0,420][-100,460]')), carousel), 'card')).toEqual({ edge: 'left', container: { x: 0, y: 400, width: 1080, height: 300 }, depth: 40 });
    expect(cutOf(dump(row('card', '[1040,400][1080,700]', text('[1200,420][1080,460]')), carousel), 'card')).toEqual({ edge: 'right', container: { x: 0, y: 400, width: 1080, height: 300 }, depth: 40 });
  });
  it('stated residual: a text dumped inverted on BOTH axes is clippedOut \'top\' (the parser\'s `vertical ?? sideways`), so the card\'s left cut is missed', () => {
    const xml = dump(row('card', '[0,400][40,700]', text('[0,450][-100,440]')), carousel);
    expect([...everyNode(parseDump(xml))].find((n) => n.label === 'Apps')?.clippedOut).toBe('top');
    expect(cutOf(xml, 'card')).toBeUndefined();
  });
  it('stated residual: a WHOLE 50-px row at rest at the list\'s top with a child laid out wholly above it (a hidden swipe-action view) reads cut, 50 deep', () => {
    const xml = dump(row('row', '[0,297][1080,347]', text('[40,305][400,340]'), '<node class="android.widget.TextView" resource-id="a:id/hidden" text="x" bounds="[40,297][400,250]"/>'));
    expect(cutOf(xml, 'row')).toEqual({ edge: 'top', container: { x: 0, y: 297, width: 1080, height: 1857 }, depth: 50 });
  });
});

describe('clipsOf(tree).cutSliver — evidentCut under the minimum piece', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  const toggle = (height: number) => node({ x: 66, y: 1979 - height, width: 948, height }, null, [node({ x: 66, y: 1979 - height + 12, width: 948, height: height - 13 })]);
  const sliverOf = (n: UiNode, minPiece: number) => clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [n]), clipsDescendants: true }]), NESTED).cutSliver(n, minPiece);
  it('64 deep under a 65 minimum is a sliver; 65 is not; no evidence, none; a node of another read, none', () => {
    expect(sliverOf(toggle(64), 65)).toEqual({ edge: 'bottom', container: form, depth: 64 });
    expect(sliverOf(toggle(65), 65)).toBeUndefined();
    expect(sliverOf(node({ x: 66, y: 1924, width: 948, height: 55 }), 65)).toBeUndefined();
    expect(clipsOf(node(form), NESTED).cutSliver(toggle(64), 65)).toBeUndefined();
  });
  it('kept per node and minimum: the same answer for each minimum asked, in any order', () => {
    const t = toggle(64);
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [t]), clipsDescendants: true }]), NESTED);
    expect([clips.cutSliver(t, 65)?.depth, clips.cutSliver(t, 64), clips.cutSliver(t, 65)?.depth]).toEqual([64, undefined, 64]);
  });
});

describe('clipsOf — the chain through plain containers to the outermost clip', () => {
  const rect = (y: number, height: number) => ({ x: 0, y, width: 1080, height });
  it('a node under plain containers inside the clip has the clip\'s chain; nodes above it and outside have none', () => {
    const label = node(rect(1936, 42), 'label');
    const toggle = node(rect(1924, 55), 'toggle', [label]);
    const form = { ...node(rect(242, 1736), 'form', [toggle]), clipsDescendants: true as const };
    const page = node(rect(0, 2220), 'page', [form]);
    const root = node(rect(0, 2220), null, [page, node(rect(0, 100), 'bar')]);
    const of = clipsOf(root, NESTED).scrollersOf;
    expect([of(label), of(toggle)]).toEqual([[form.rect], [form.rect]]);
    expect(of(label)).toBe(of(toggle)); // shared along the branch
    expect([of(form), of(page), of(root.children[1]), of(node(rect(1936, 42)))]).toEqual([[], [], [], []]);
  });
});

describe('cutSliver — inherited from an ancestor cut to a sliver at the edge the node lies flush with', () => {
  const form = { x: 0, y: 242, width: 1080, height: 1736 };
  /** The node `n` inside `parent` inside the form, as the tree has them; the tree's cutSliver asked of `n`. */
  const sliverOf = (n: UiNode, parent: UiNode, minPiece = 65) => {
    const formNode = { ...node(form, 'form', [parent]), clipsDescendants: true as const };
    return clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [formNode]), NESTED).cutSliver(n, minPiece);
  };
  // As dumped at 35d5997: details_toggle 66,1924 948x55; children other 'Payment details' 66,1936 948x42, other 926,1955 88x23, button 66,1936 948x42.
  const label = () => node({ x: 66, y: 1936, width: 948, height: 42 }, 'label');
  const chevron = () => node({ x: 926, y: 1955, width: 88, height: 23 }, 'chevron');
  const toggleOf = (...children: UiNode[]) => node({ x: 66, y: 1924, width: 948, height: 55 }, 'toggle', children);

  it('the measured leaf label 66,1936 948x42 and the chevron 926,1955 88x23, flush with the form\'s bottom in the cut toggle: slivers too, within the toggle', () => {
    const l = label();
    const c = chevron();
    const toggle = toggleOf(l, c, node({ x: 66, y: 1936, width: 948, height: 42 }));
    expect(sliverOf(l, toggle)).toEqual({ edge: 'bottom', container: form, depth: 42, within: { x: 66, y: 1924, width: 948, height: 55 } });
    expect(sliverOf(c, toggle)).toEqual({ edge: 'bottom', container: form, depth: 23, within: { x: 66, y: 1924, width: 948, height: 55 } });
    expect(sliverOf(l, toggle, 56)?.depth).toBe(42); // the toggle a sliver by a pixel
    expect(sliverOf(l, toggle, 55)).toBeUndefined(); // the toggle as deep as the minimum: no sliver to inherit
  });

  it('a child of the cut toggle that lies clear of the edge (more than a pixel short of it) shows whole inside the strip: not inherited', () => {
    const clear = node({ x: 100, y: 1936, width: 300, height: 40 }, 'clear'); // bottom 1976, 2 px short of 1978
    expect(sliverOf(clear, toggleOf(clear, node({ x: 66, y: 1936, width: 948, height: 42 })))).toBeUndefined();
    const flush = node({ x: 100, y: 1936, width: 300, height: 41 }, 'flush'); // bottom 1977, within a pixel
    expect(sliverOf(flush, toggleOf(flush, node({ x: 66, y: 1936, width: 948, height: 42 })))?.edge).toBe('bottom');
  });

  it('a child flush with the cut but as deep as the minimum across it (laid out past the toggle\'s top, Compose-style): not a sliver, whatever its toggle', () => {
    const deep = node({ x: 66, y: 1913, width: 948, height: 65 }, 'deep'); // 1913–1978: 65 deep
    expect(sliverOf(deep, toggleOf(deep, node({ x: 66, y: 1936, width: 948, height: 42 })))).toBeUndefined();
    const shallower = node({ x: 66, y: 1914, width: 948, height: 64 }, 'shallower');
    expect(sliverOf(shallower, toggleOf(shallower, node({ x: 66, y: 1936, width: 948, height: 42 })))?.depth).toBe(64);
  });

  it('a child flush with ANOTHER edge of the form (its left) inside the toggle cut at the bottom: not inherited — the edge must be the cut\'s', () => {
    const left = node({ x: 0, y: 1930, width: 200, height: 30 }, 'left'); // flush with the form's left, 18 px short of its bottom
    const toggle = node({ x: 0, y: 1924, width: 1080, height: 55 }, 'toggle', [left, node({ x: 0, y: 1936, width: 1080, height: 42 })]);
    expect(sliverOf(toggle, node({ x: 0, y: 1924, width: 1080, height: 55 }, 'wrap', [toggle]))?.edge).toBe('bottom');
    expect(sliverOf(left, toggle)).toBeUndefined();
  });

  it('a parent at the edge that is not EVIDENTLY cut (a whole button, its background filling it): its flush child is not refused', () => {
    const background = node({ x: 66, y: 1923, width: 400, height: 55 }, 'bg');
    expect(sliverOf(background, node({ x: 66, y: 1923, width: 400, height: 55 }, 'filled', [background]))).toBeUndefined();
  });

  it('A2.4\'s shape — Create contact\'s field cut by the IME-resized form DEEPER than the minimum (132,1307 816x91), its label "Company" 176,1373 190x25 flush with the cut: not inherited', () => {
    const imeForm = { x: 0, y: 242, width: 1080, height: 1156 }; // bottom 1398
    const company = node({ x: 176, y: 1373, width: 190, height: 25 }, 'company');
    const field = node({ x: 132, y: 1307, width: 816, height: 91 }, 'field', [node({ x: 132, y: 1329, width: 816, height: 69 }), company, node({ x: 176, y: 1340, width: 728, height: 58 })]);
    const row = node({ x: 132, y: 1307, width: 948, height: 91 }, 'row', [field]);
    const list = { ...node(imeForm, 'form', [row]), clipsDescendants: true as const };
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [list]), NESTED);
    expect(clips.cutSliver(field, ANY_DEPTH)?.depth).toBe(91); // cut, but deep enough
    expect(clips.cutSliver(company, 65)).toBeUndefined();
  });

  it('the NEAREST sliver ancestor is named — a button in the toggle before the toggle', () => {
    const leaf = node({ x: 80, y: 1960, width: 100, height: 18 }, 'leaf');
    const button = node({ x: 66, y: 1950, width: 948, height: 28 }, 'button', [leaf]); // itself a sliver inside the toggle
    const toggle = toggleOf(node({ x: 66, y: 1936, width: 948, height: 42 }), button);
    expect(sliverOf(leaf, toggle)).toEqual({ edge: 'bottom', container: form, depth: 18, within: { x: 66, y: 1950, width: 948, height: 28 } });
  });
  it('the search goes on past a NEARER sliver cut at another edge: a leaf flush with the bottom in a 50-px block cut at the form\'s left inherits the toggle\'s bottom cut', () => {
    const leaf = node({ x: 10, y: 1960, width: 30, height: 18 }, 'leaf'); // flush with the bottom, not the left
    const block = node({ x: 0, y: 1924, width: 50, height: 55 }, 'block', [leaf, node({ x: -40, y: 1930, width: 100, height: 20 })]); // cut at the left, 50 deep
    const toggle = node({ x: 0, y: 1924, width: 1080, height: 55 }, 'toggle', [block, node({ x: 0, y: 1936, width: 1080, height: 42 })]);
    expect(sliverOf(block, toggle)).toEqual({ edge: 'left', container: form, depth: 50 });
    expect(sliverOf(leaf, toggle)).toEqual({ edge: 'bottom', container: form, depth: 18, within: { x: 0, y: 1924, width: 1080, height: 55 } });
  });

  it('the cut is the edge of ONE container: a leaf flush with the form\'s bottom inside a sliver cut at an inner clip\'s bottom (a synthetic inner clip running past the form) inherits nothing', () => {
    const leaf = node({ x: 0, y: 1960, width: 100, height: 18 }, 'leaf'); // bottom 1978: the form's, not the inner clip's (2000)
    const strip = node({ x: 0, y: 1950, width: 1080, height: 50 }, 'strip', [leaf, node({ x: 200, y: 1960, width: 100, height: 50 })]); // cut at 2000, 50 deep
    const inner = { ...node({ x: 0, y: 1900, width: 1080, height: 100 }, 'inner', [strip]), clipsDescendants: true as const };
    const clips = clipsOf(node({ x: 0, y: 0, width: 1080, height: 2220 }, null, [{ ...node(form, 'form', [inner]), clipsDescendants: true }]), NESTED);
    expect(clips.cutSliver(strip, 65)).toEqual({ edge: 'bottom', container: inner.rect, depth: 50 });
    expect(clips.cutSliver(leaf, 65)).toBeUndefined();
  });

  it('a wrapper with no evidence of its own, flush in the cut toggle, is a sliver by inheritance — and hands it on: its filling leaf names it', () => {
    const leaf = node({ x: 66, y: 1950, width: 948, height: 28 }, 'leaf');
    const wrapper = node({ x: 66, y: 1950, width: 948, height: 28 }, 'wrapper', [leaf]);
    const toggle = toggleOf(node({ x: 66, y: 1936, width: 948, height: 42 }), wrapper);
    expect(sliverOf(wrapper, toggle)?.within).toEqual({ x: 66, y: 1924, width: 948, height: 55 });
    expect(sliverOf(leaf, toggle)?.within).toEqual({ x: 66, y: 1950, width: 948, height: 28 });
  });
});

describe('largestScroller — the screen\'s own scroll view (2026-10-09)', () => {
  const box = (y: number, height: number, clips: boolean, children: UiNode[] = []): UiNode => ({
    role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y, width: 1080, height }, children, ...(clips && { clipsDescendants: true as const }),
  });
  it('the largest clipping node by area — a carousel above the list is the smaller; none without one', () => {
    const carousel = box(300, 300, true);
    const list = box(737, 1417, true);
    expect(largestScroller(box(0, 2220, false, [carousel, list]))).toEqual(list.rect);
    expect(largestScroller(box(0, 2220, false, [list, carousel]))).toEqual(list.rect);
    expect(largestScroller(box(0, 2220, false, [box(300, 300, false)]))).toBeUndefined();
  });
});

describe('clipsOf(tree).inScroller — some ancestor scrolls (scroll-containers.ts#scrolls); unknown without ancestry', () => {
  const find = (tree: UiNode, keep: (n: UiNode) => boolean): UiNode => [...everyNode(tree)].find(keep)!;
  const insideScroller = (tree: UiNode, n: UiNode, ancestry = true) => clipsOf(tree, { ancestry }).inScroller(n);

  it('nested WDA: a field in the login ScrollView is inside; the screen wrapper around it is not, nor the ScrollView itself', async () => {
    const tree = parseWdaSourceValue(JSON.parse(await readFile(new URL('../fixtures/wda-source-myport-login-no-keyboard.json', import.meta.url), 'utf8')));
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'login_username'))).toBe(true);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'login_screen'))).toBe(false);
    expect(insideScroller(tree, find(tree, (n) => n.role === 'scrollable'))).toBe(false);
  });

  it('Android Compose: a row of the flagged list is inside (a Compose scroller has no scrollable role); the tab bar after it is not', () => {
    const tree = parseDump(COMPOSE.accountDetail);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'transactions.list.row_2'))).toBe(true);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'nav.tab_home'))).toBe(false);
  });

  it('a classic Android list whose content fits (scrollable="false") still counts: it is a scroll view', () => {
    const tree = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
      <node class="android.widget.ListView" scrollable="false" bounds="[0,200][1080,900]">
        <node class="android.widget.TextView" resource-id="row" text="Only row" bounds="[0,200][1080,350]" />
      </node></node></hierarchy>`);
    expect(insideScroller(tree, find(tree, (n) => n.identifier === 'row'))).toBe(true);
  });

  it("a link in a web view is inside; the navigation bar's Back beside the web view is not", () => {
    const back = fakeNode({ role: 'button', label: 'Back', rect: { x: 8, y: 70, width: 80, height: 40 } });
    const link = fakeNode({ role: 'link', label: 'Read more', rect: { x: 16, y: 72, width: 200, height: 30 } });
    const tree = fakeNode({
      role: 'container',
      rect: { x: 0, y: 0, width: 402, height: 874 },
      children: [fakeNode({ role: 'other', rect: { x: 0, y: 62, width: 402, height: 54 }, children: [back] }), fakeNode({ role: 'webview', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [link] })],
    });
    expect(insideScroller(tree, link)).toBe(true);
    expect(insideScroller(tree, back)).toBe(false);
  });

  it("undefined where the tree cannot say: a listing without ancestry (idb's flat list), and a node of another tree", async () => {
    const flat = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    const last = flat.children[flat.children.length - 1];
    expect(insideScroller(flat, last, false)).toBeUndefined();
    // Not vacuous: read as nested, the same node lies under nothing that scrolls.
    expect(insideScroller(flat, last, true)).toBe(false);
    expect(insideScroller(parseDump(COMPOSE.accountDetail), fakeNode({}))).toBeUndefined();
  });
});

describe('clipsOf(tree).drawnIn — the frame a node is drawn in, cut by every ancestor that scrolls, on every tree that lists ancestry', () => {
  /** A nested tree whose source reports its frames unclipped (WDA's, dialect.ts#TreeDialect.framesUnclipped). */
  const UNCLIPPED = { ancestry: true, unclipped: true } as const;
  const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
  const SCREEN_RECT = r(0, 0, 402, 874);
  /** The at-rest SWIFT form's shape: a ScrollView ending at 780 above the pinned CONTINUE, a payee row listed below it. */
  const form = () => {
    const field = fakeNode({ role: 'textfield', identifier: 'payee_name_input', rect: r(24, 801, 354, 52) });
    const row = fakeNode({ role: 'other', rect: r(24, 801, 354, 52), children: [field] });
    const scroll = fakeNode({ role: 'scrollable', rect: r(0, 0, 402, 780), children: [fakeNode({ role: 'button', label: 'Top', rect: r(24, 120, 354, 52) }), row] });
    const tree = fakeNode({ role: 'container', rect: SCREEN_RECT, children: [scroll, fakeNode({ role: 'button', label: 'Continue to summary', rect: r(24, 780, 354, 44) })] });
    return { tree, scroll, row, field };
  };

  it("a row listed below its scroll view: drawn only in the scroll view's frame, the scroll view named", () => {
    const { tree, scroll, row, field } = form();
    const clips = clipsOf(tree, UNCLIPPED);
    expect(clips.drawnIn(row)).toEqual({ told: true, frame: r(0, 0, 402, 780), scrollers: [scroll], listedWhereItLies: true });
    expect(clips.drawnIn(field)).toEqual({ told: true, frame: r(0, 0, 402, 780), scrollers: [scroll], listedWhereItLies: true });
  });

  it('nested scrollers: the frames intersected, the nearest named first; scrollers that share nothing leave no frame', () => {
    const card = fakeNode({ role: 'button', rect: r(378, 138, 354, 120) });
    const carousel = fakeNode({ role: 'scrollable', rect: r(0, 100, 402, 200), children: [card] });
    const page = fakeNode({ role: 'scrollable', rect: r(0, 116, 402, 664), children: [carousel] });
    const clips = clipsOf(fakeNode({ role: 'container', rect: SCREEN_RECT, children: [page] }), UNCLIPPED);
    expect(clips.drawnIn(card)).toEqual({ told: true, frame: r(0, 116, 402, 184), scrollers: [carousel, page], listedWhereItLies: true });
    const below = fakeNode({ role: 'button', rect: r(0, 900, 402, 50) });
    const lower = fakeNode({ role: 'scrollable', rect: r(0, 880, 402, 200), children: [below] });
    const list = fakeNode({ role: 'scrollable', rect: r(0, 0, 402, 780), children: [lower] });
    expect(clipsOf(fakeNode({ role: 'container', rect: SCREEN_RECT, children: [list] }), UNCLIPPED).drawnIn(below)).toEqual({ told: true, frame: undefined, scrollers: [lower, list], listedWhereItLies: true });
  });

  it('undefined for a node under nothing that scrolls, the scroller itself, a node of another tree', () => {
    const { tree, scroll } = form();
    const clips = clipsOf(tree, UNCLIPPED);
    expect(clips.drawnIn(tree.children[1])).toBeUndefined();
    expect(clips.drawnIn(scroll)).toBeUndefined();
    expect(clips.drawnIn(fakeNode({}))).toBeUndefined();
  });

  it('on every tree that lists ancestry, whatever its source says of its frames: a nested tree not marked unclipped (Android\'s — uiautomator does not always cut a rect to its scroll view) is cut the same; UNTOLD on a flat list (idb\'s), which lists no scroll view — every node, not "nothing cuts it"', () => {
    const { tree, scroll, row } = form();
    expect(clipsOf(tree, NESTED).drawnIn(row)).toEqual({ told: true, frame: r(0, 0, 402, 780), scrollers: [scroll], listedWhereItLies: false });
    expect(clipsOf(tree, { ancestry: false, unclipped: true }).drawnIn(row)).toEqual({ told: false });
    expect(clipsOf(tree, { ancestry: false }).drawnIn(tree.children[1])).toEqual({ told: false });
  });

  it("the lab's scroll-bounded (iOS 27): idb lists O flat at its laid-out frame below `lower` and no scroll view — untold; WDA's twin lists `lower` above it — drawn in `lower`'s frame, which O lies wholly past", async () => {
    const lab = async (name: string): Promise<string> => readFile(new URL(`../fixtures/truth/ios-iphone17-ios27/${name}`, import.meta.url), 'utf8');
    const byId = (tree: UiNode, id: string): UiNode => [...everyNode(tree)].find((n) => n.identifier === id)!;
    const idb = parseIdbDescribeAll(await lab('scroll-bounded.idb.json'));
    const wda = parseWdaSourceValue(JSON.parse(await lab('scroll-bounded.wda.json')));
    expect(clipsOf(idb, { ancestry: false }).drawnIn(byId(idb, 'lab.scroll-bounded.O'))).toEqual({ told: false });
    const o = byId(wda, 'lab.scroll-bounded.O');
    expect(o.rect).toEqual(r(51, 620, 300, 64));
    expect(clipsOf(wda, UNCLIPPED).drawnIn(o)).toMatchObject({ told: true, frame: r(0, 380, 402, 180), listedWhereItLies: true });
  });

  it('a rect past its scroll view\'s edge by a pixel at most is flush with it, not cut: mp-native\'s SWIFT toggle `66,1924 948x55` ends at 1979 under its form `[0,242][1080,1978]` — its frame reaches 1979; 2 px past is cut', () => {
    const toggle = fakeNode({ role: 'button', rect: r(66, 1924, 948, 55) });
    const deeper = fakeNode({ role: 'button', rect: r(66, 1925, 948, 55) });
    const leftward = fakeNode({ role: 'button', rect: r(-1, 300, 100, 50) });
    const rightward = fakeNode({ role: 'button', rect: r(981, 241, 100, 50) });
    const form = fakeNode({ role: 'scrollable', rect: r(0, 242, 1080, 1736), children: [toggle, deeper, leftward, rightward] });
    const clips = clipsOf(fakeNode({ role: 'container', rect: r(0, 0, 1080, 2220), children: [form] }), NESTED);
    expect(toldFrame(clips.drawnIn(toggle))?.frame).toEqual(r(0, 242, 1080, 1737));
    expect(toldFrame(clips.drawnIn(deeper))?.frame).toEqual(r(0, 242, 1080, 1736));
    expect(toldFrame(clips.drawnIn(leftward))?.frame).toEqual(r(-1, 242, 1081, 1736));
    expect(toldFrame(clips.drawnIn(rightward))?.frame).toEqual(r(0, 241, 1081, 1737));
  });

  describe("`unknownPast` — a side the source cut at the screen's edge (`cutAtScreen`: uiautomator's, UiNode.boundsCutAtScreen)", () => {
    const CUT = { ancestry: true, cutAtScreen: true } as const;
    /** The lab's `carousel-in-list` on API 33: the carousel `[66,380][1014,614]` in a full-screen page; C laid 948 wide, dumped cut at 1080. */
    const lab = (card: ReturnType<typeof r>) => {
      const c = fakeNode({ role: 'button', identifier: 'lab.carousel-in-list.C', rect: card });
      const carousel = fakeNode({ role: 'scrollable', rect: r(66, 380, 948, 234), children: [c] });
      const row = fakeNode({ role: 'button', rect: r(0, 700, 1080, 176) });
      const page = fakeNode({ role: 'scrollable', rect: r(0, 0, 1080, 2220), children: [carousel, row] });
      const tree = fakeNode({ role: 'container', rect: r(0, 0, 1080, 2220), children: [page] });
      return { tree, c, carousel, page, row };
    };

    it("C dumped `[586,380][1080,614]` with its carousel ending at 1014: its right side lies on the screen's edge, its carousel's inside the screen — how far it runs past is unknown", () => {
      const { tree, c, carousel, page } = lab(r(586, 380, 494, 234));
      expect(clipsOf(tree, CUT).drawnIn(c)).toEqual({ told: true, frame: r(66, 380, 948, 234), scrollers: [carousel, page], listedWhereItLies: false, unknownPast: ['right'] });
    });

    it('cut at both sides of the screen: both unknown; a side a pixel off the edge counts as on it', () => {
      const { tree, c } = lab(r(0, 380, 1080, 234));
      expect(toldFrame(clipsOf(tree, CUT).drawnIn(c))?.unknownPast).toEqual(['left', 'right']);
      const { tree: t2, c: c2 } = lab(r(1, 380, 1078, 234));
      expect(toldFrame(clipsOf(t2, CUT).drawnIn(c2))?.unknownPast).toEqual(['left', 'right']);
    });

    it("none where the side lies off the screen's edge (C at rest `[1014,380][1080,614]`: its left side is known), nor for a full-width row of a full-width list — its scroll view ends at the screen's edge too", () => {
      const { tree, c, row } = lab(r(382, 380, 600, 234));
      const clips = clipsOf(tree, CUT);
      expect(toldFrame(clips.drawnIn(c))?.unknownPast).toBeUndefined();
      expect(toldFrame(clips.drawnIn(row))?.unknownPast).toBeUndefined();
      const { tree: rest, c: atRest } = lab(r(1014, 380, 66, 234));
      expect(toldFrame(clipsOf(rest, CUT).drawnIn(atRest))?.unknownPast).toEqual(['right']);
    });

    it('none on a tree whose source does not cut at the screen (WDA\'s unclipped frames, a nested tree not marked)', () => {
      const { tree, c } = lab(r(586, 380, 494, 234));
      expect(toldFrame(clipsOf(tree, UNCLIPPED).drawnIn(c))?.unknownPast).toBeUndefined();
      expect(toldFrame(clipsOf(tree, NESTED).drawnIn(c))?.unknownPast).toBeUndefined();
    });
  });

  it('an ancestor of no area cuts nothing — it fails open, as a root of no area does: a ScrollView WDA reports 0,0 0x0', () => {
    const { tree, scroll, row } = form();
    const zero = fakeNode({ role: 'scrollable', rect: r(0, 0, 0, 0), children: [row] });
    scroll.children = [zero];
    expect(clipsOf(tree, UNCLIPPED).drawnIn(row)).toEqual({ told: true, frame: r(0, 0, 402, 780), scrollers: [scroll], listedWhereItLies: true });
    const alone = fakeNode({ role: 'container', rect: SCREEN_RECT, children: [fakeNode({ role: 'scrollable', rect: r(0, 0, 0, 0), children: [row] })] });
    expect(clipsOf(alone, UNCLIPPED).drawnIn(row)).toBeUndefined();
  });
});
