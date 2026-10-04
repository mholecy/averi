import { describe, expect, it } from 'vitest';
import { swipeScreen } from '../../src/interact/swipe.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

describe('swipeScreen — one table, two meanings', () => {
  const fresh = () => {
    resetLayout();
    return new FakeAdapter({ s: screen(el({ identifier: 'anything' })) }, 's'); // 1000x2000 root
  };

  it("'finger' names the finger's movement: up travels from below centre to above it, 30% either side", async () => {
    const fake = fresh();
    await swipeScreen(fake, 'up', 'finger');
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
  });

  it("'content' names where the content lies: content below is reached by the finger travelling up", async () => {
    const fake = fresh();
    await swipeScreen(fake, 'down', 'content');
    expect(fake.swipes).toEqual([{ from: { x: 500, y: 1600 }, to: { x: 500, y: 400 } }]);
  });

  it('the horizontal pair is the same table rotated', async () => {
    const fake = fresh();
    await swipeScreen(fake, 'left', 'finger');
    await swipeScreen(fake, 'left', 'content');
    expect(fake.swipes).toEqual([
      { from: { x: 800, y: 1000 }, to: { x: 200, y: 1000 } },
      { from: { x: 200, y: 1000 }, to: { x: 800, y: 1000 } },
    ]);
  });

  it('repeats the same gesture `times` times from one tree read', async () => {
    const fake = fresh();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    await swipeScreen(fake, 'down', 'finger', 3);
    expect(fake.swipes).toHaveLength(3);
    expect(new Set(fake.swipes.map((s) => JSON.stringify(s))).size).toBe(1);
    expect(reads).toBe(1);
  });

  it('an iOS synthetic 0×0 root swipes over the union of its children', async () => {
    const root = node({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      children: [
        node({ rect: { x: 0, y: 0, width: 400, height: 100 } }),
        node({ rect: { x: 0, y: 700, width: 300, height: 100 } }),
      ],
    });
    const fake = new FakeAdapter({ s: root }, 's');
    await swipeScreen(fake, 'up', 'finger'); // box 400x800 → centre (200,400), dy 240
    expect(fake.swipes).toEqual([{ from: { x: 200, y: 640 }, to: { x: 200, y: 160 } }]);
  });
});
