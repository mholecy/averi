import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { askedOf, eyesQuestion, reachesPoint, sameQuestion, type EyesQuestion, type SurfaceFinding } from '../../src/ui-tree/eyes.js';
import type { Edge } from '../../src/ui-tree/geometry.js';
import { sceneOf } from '../../src/ui-tree/standing.js';
import { parseDump } from '../helpers/android-dumps.js';
import { node } from '../helpers/fake.js';

// WHAT A REFUSAL KEEPS, and what a finding reaches (ui-tree/eyes.ts#EyesAsked, #sameQuestion, #reachesPoint), over the
// lab's real k7 stop (`form-keyboard` after one stroke: `phone` `55,1113 970x125` flush with the submit bar
// `55,1238 970x132`, tests/fixtures/android-lab-form-keyboard-k7-stop.xml) and built shapes for the other edges.
const k7 = (): EyesQuestion => {
  const tree = parseDump(readFileSync(new URL('../fixtures/android-lab-form-keyboard-k7-stop.xml', import.meta.url), 'utf8'));
  const phone = [...everyNode(tree)].find((n) => n.identifier === 'lab.form-keyboard.phone')!;
  return eyesQuestion(sceneOf(tree), tree, phone, undefined, 'stop')!;
};
const moved = (r: Rect, dy: number): Rect => ({ ...r, y: r.y + dy });
const withFlush = (q: EyesQuestion, rects: readonly Rect[]): EyesQuestion => ({ ...q, edges: rects.map((rect, i) => ({ edge: 'bottom', by: node({ identifier: `n${i}`, rect }) })) });

describe('sameQuestion — the region and every neighbour where the refusal left them, as many', () => {
  it('k7 asked again unmoved: the same question; a pixel off still the same; two pixels off another', () => {
    const q = k7();
    const asked = askedOf(q);
    expect(sameQuestion(asked, q)).toBe(true);
    expect(sameQuestion(asked, { ...q, region: moved(q.region, 1) })).toBe(true);
    expect(sameQuestion(asked, { ...q, region: moved(q.region, 2) })).toBe(false);
    expect(sameQuestion(asked, withFlush(q, [moved((q.edges[0]!.by as UiNode).rect, 2)]))).toBe(false);
  });

  it('k7 asked with two neighbours, then with only the first of them: another question', () => {
    const q = k7();
    const bar = (q.edges[0]!.by as UiNode).rect;
    const asked = askedOf(withFlush(q, [bar, { x: 0, y: 1370, width: 1080, height: 40 }]));
    expect(sameQuestion(asked, withFlush(q, [bar]))).toBe(false);
  });
});

describe('reachesPoint — the band from the region\'s edge inward by its depth, against the point on that axis', () => {
  const finding = (edge: Edge, depth: number): SurfaceFinding => ({ sees: 'surface', edge, depth, by: node({}), surface: '#F2F2F7', own: '#FFFFFF' });

  it("k7: the bar's padding 28 px deep from phone's bottom (1210–1237) does not reach its centre at 1175; 63 deep reaches it", () => {
    const { region } = k7();
    const centre = { x: 540, y: 1175 };
    expect(reachesPoint(finding('bottom', 28), region, centre)).toBe(false);
    expect(reachesPoint(finding('bottom', 63), region, centre)).toBe(true);
    expect(reachesPoint(finding('bottom', 62), region, centre)).toBe(false);
  });

  // The band covers [edge, edge ± depth): its first line past that is clear. Region 100,200 400x100; depth 30.
  const region = { x: 100, y: 200, width: 400, height: 100 };
  const cases: [Edge, { x: number; y: number }, { x: number; y: number }][] = [
    ['top', { x: 300, y: 229 }, { x: 300, y: 230 }],
    ['bottom', { x: 300, y: 270 }, { x: 300, y: 269 }],
    ['left', { x: 129, y: 250 }, { x: 130, y: 250 }],
    ['right', { x: 470, y: 250 }, { x: 469, y: 250 }],
  ];
  for (const [edge, inside, past] of cases) {
    it(`${edge}: the band's last line reaches the point, the line past it does not`, () => {
      expect(reachesPoint(finding(edge, 30), region, inside)).toBe(true);
      expect(reachesPoint(finding(edge, 30), region, past)).toBe(false);
    });
  }
});
