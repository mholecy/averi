import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { everyNode, type DeviceScreen, type UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { judgeRead } from '../../src/interact/scroll-read.js';
import { readKeyboard } from '../../src/ui-tree/keyboard-cover.js';
import type { KeyboardLine } from '../../src/ui-tree/keyboard-position.js';
import { lookOn } from '../../src/ui-tree/look.js';
import { overElement } from '../../src/verify/pixel-poll.js';
import { NO_BACK } from '../helpers/rounds.js';

// ONE KEYBOARD LINE per node for the pixel assert (verify/pixel-poll.ts#overElement) and scroll_until's read
// (interact/scroll-read.ts#judgeRead), asked through the verbs themselves on idb's parsed number pad: a key of the band
// is under no line in either, and a row the band reaches over is under the band's line in both. The position-level
// equivalence (and why no tree can split it) is pinned in tests/ui-tree/keyboard-position.test.ts; this pins that each
// verb still takes its exemption where that model says — the pixel poll through `line`'s subject, the scroll read
// through `owns`. The pixel poll's line is observed as `line` returns it to the poll (a pass-through wrapper records
// it); the scroll read's is the line its judgement put the match under (`Judged.under.line`).
const { lines } = vi.hoisted(() => ({ lines: [] as (KeyboardLine | undefined)[] }));
vi.mock('../../src/ui-tree/keyboard-position.js', async (orig) => {
  const real = await orig<typeof import('../../src/ui-tree/keyboard-position.js')>();
  return {
    ...real,
    keyboardPosition: (...args: Parameters<typeof real.keyboardPosition>) => {
      const position = real.keyboardPosition(...args);
      return { ...position, line: (subject?: UiNode, line?: KeyboardLine) => (lines.push(position.line(subject, line)), lines[lines.length - 1]) };
    },
  };
});

const IPHONE: DeviceScreen = { width: 402, height: 874, statusBand: 62 };
const BOX = { x: 0, y: 0, width: 402, height: 874 };

/** idb's number pad as recorded (band at 589), its key `5`, and its `Value date` row 24,545 354x52 straddling the band's top (centre 571, above it — idb keeps it, ADR 0007): a row the band reaches over. */
async function pad(): Promise<{ tree: UiNode; key: UiNode; row: UiNode }> {
  const tree = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
  const nodes = [...everyNode(tree)];
  const row = nodes.find((n) => n.identifier === 'swift_payment.form.value_date_select')!;
  expect(row.rect).toEqual({ x: 24, y: 545, width: 354, height: 52 });
  return { tree, key: nodes.find((n) => n.role === 'button' && n.label === '5')!, row };
}

/** The line the pixel poll judged `element` under: what `line` returned to overElement, over the round's look (ui-tree/look.ts#lookOn). */
async function pixelLine(tree: UiNode, element: UiNode): Promise<KeyboardLine | undefined> {
  lines.length = 0;
  await overElement({ viewport: async () => IPHONE }, lookOn({}, tree), element);
  expect(lines).toHaveLength(1);
  return lines[0];
}

/** The line scroll_until's read judged `element` under: the applied cover's, unless the read exempted it. */
function scrollLine(tree: UiNode, element: UiNode): KeyboardLine | undefined {
  const j = judgeRead({ tree, found: [element], ofKeyboard: readKeyboard({}, tree).ofKeyboard, remedy: NO_BACK }, { box: BOX, boxes: [BOX], oriented: BOX, from: 'device', statusBand: 62 }, false);
  if ('ask' in j) throw new Error(`asked ${j.ask}`);
  return j.best?.under?.line;
}

describe('the pixel assert and scroll_until judge a node under one keyboard line — through the verbs, on idb\'s number pad', () => {
  it('a key of the band (`5`): under no line in either', async () => {
    const { tree, key } = await pad();
    const [pixel, scroll] = [await pixelLine(tree, key), scrollLine(tree, key)];
    expect(pixel).toBeUndefined();
    expect(scroll).toEqual(pixel);
  });
  it('a row the band reaches over: under the band\'s line, unwitnessed, in both', async () => {
    const { tree, row } = await pad();
    const [pixel, scroll] = [await pixelLine(tree, row), scrollLine(tree, row)];
    expect(pixel).toEqual({ y: 589, witnessed: false });
    expect(scroll).toEqual(pixel);
  });
});
