import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import type { Recording } from '../../scripts/differential/corpus.js';
import { compareRecording, groupDiffs, spread } from '../../scripts/differential/differential.js';
import { installFakeDevice } from '../../scripts/differential/fake-device.js';
import { loadSide, type Side } from '../../scripts/differential/side.js';
import { COMPOSE } from '../helpers/android-dumps.js';

// The differential over the committed sample — one tree per raw source kind: two tests/fixtures payloads and one
// Compose dump from tests/helpers/android-dumps.ts — through the tool interface: the same code on both sides differs nowhere, and a side whose parser reads one node differently differs
// exactly where a tool reads that node. Capped to a few targets a tree: this is the harness's own test, not a run.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const fixture = (name: string) => readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
const IPHONE = { width: 402, height: 874 };

let side: Side;
let sample: Recording[];
beforeAll(async () => {
  installFakeDevice();
  installVirtualClock();
  side = await loadSide(ROOT);
  sample = [
    { id: 'sample/wda-source-skeleton-login.json', run: 'sample', file: 'wda-source-skeleton-login.json', platform: 'ios', source: 'wda', form: 'raw', screen: IPHONE, payload: await fixture('wda-source-skeleton-login.json') },
    { id: 'sample/idb-swift-form-continue.json', run: 'sample', file: 'idb-swift-form-continue.json', platform: 'ios', source: 'idb', form: 'raw', screen: IPHONE, payload: await fixture('idb-swift-form-continue.json') },
    { id: 'sample/compose-sign-in.xml', run: 'sample', file: 'compose-sign-in.xml', platform: 'android', source: 'uiautomator', form: 'raw', payload: COMPOSE.signIn },
  ];
});

// Each test replays the sample through both sides — about a second alone, past the default 5 s on a loaded machine (a
// harness run beside it), and a test cut off at 5 s keeps running into the next one's fake device. 30 s is the budget.
describe('compareRecording', { timeout: 30_000 }, () => {
  it('the same code on both sides: every call of every variant answers alike on the sample', async () => {
    for (const r of sample) {
      const result = await compareRecording(r, side, side, { cap: 3 });
      expect([r.id, result.parser, result.diffs.map((d) => `${d.variant} ${d.call.tool}`)]).toEqual([r.id, 'exercised', []]);
      expect(result.calls).toBeGreaterThan(10);
      expect(Object.keys(result.perTool).sort()).toEqual(['assert', ...(r.platform === 'ios' ? ['launch_app'] : []), 'scroll_until', 'swipe', 'tap', 'ui_snapshot']);
      // Every command the tools sent on the sample is one the fake device models.
      expect(result.unmodelled).toEqual({});
    }
  });

  it('a colour assert samples its target painted its own colour: the visible targets pass, each on its own colour', async () => {
    const result = await compareRecording(sample[0], side, side, { cap: 14, tools: new Set(['ui_snapshot', 'assert']), keepAll: true });
    const colour = result.all!.filter((r) => r.variant === 'screen' && JSON.stringify(r.call.args).includes('"color"'));
    const verdicts = colour.map((r) => {
      const expected = (r.call.args.asserts as { color: { expected: string } }[])[0].color.expected;
      const sampled = /sampled (#[0-9A-F]{6})/.exec(r.new.reply)?.[1];
      return [r.new.reply.startsWith('All 1 asserts passed'), sampled === undefined ? 'no sample' : sampled === expected ? 'own colour' : 'another'];
    });
    expect(verdicts.filter(([pass]) => pass).length).toBeGreaterThan(0);
    // The PIN pad's "1", a 64x65 button in the open: its own colour, where it is.
    const one = colour.find((r) => (r.call.args.asserts as { element: { text?: string } }[])[0].element.text === '1')!;
    expect(one.new.reply.split('\n')[0]).toBe('All 1 asserts passed');
    expect(verdicts.filter(([pass]) => pass).every(([, what]) => what === 'own colour')).toBe(true);
    expect(new Set(colour.map((r) => (r.call.args.asserts as { color: { expected: string } }[])[0].color.expected)).size).toBe(colour.length);
    // The costly variants' targets are spread (`spread`): none of them paints 90 % of its frame.
    const costly = result.all!.filter((r) => r.variant === 'real scale' && r.call.paint !== undefined);
    expect(costly.length).toBe(3);
    for (const r of costly) expect(r.call.paint!.rect.width * r.call.paint!.rect.height).toBeLessThan(0.9 * 1206 * 2622);
  });

  it('a NEW whose WDA parser moves one node off the screen: the snapshot differs, and every call that targets that node, and nothing else', async () => {
    const login = sample[0];
    const moved: Side = {
      ...side,
      parseWdaSourceValue: (value) => {
        const tree = side.parseWdaSourceValue(value);
        const walk = (n: UiNode): UiNode | undefined => (n.label === 'Log in' ? n : n.children.map(walk).find(Boolean));
        const node = walk(tree)!;
        node.rect = { ...node.rect, y: node.rect.y + 2000 };
        return tree;
      },
    };
    const result = await compareRecording(login, side, moved, { cap: 5, tools: new Set(['ui_snapshot', 'tap']) });
    const differing = [...new Set(result.diffs.map((d) => `${d.call.tool} ${String(d.call.args.selector ?? '')}`))];
    expect(differing).toEqual(['ui_snapshot ', 'tap text:"Log in"']);
    const tap = result.diffs.find((d) => d.call.tool === 'tap' && d.variant === 'screen')!;
    expect(tap.old.device.filter((c) => c.startsWith('idb ui tap'))).toHaveLength(1);
    expect(tap.new.device.filter((c) => c.startsWith('idb ui tap'))).toEqual([]);
  });

  it('a NEW that sends its taps one point to the right: the replies agree, the device calls do not, and the group says so', async () => {
    const login = sample[0];
    const Base = side.IosAdapter as unknown as new (opts: unknown) => { tap(x: number, y: number): Promise<void> };
    class Shifted extends Base {
      override tap(x: number, y: number) {
        return super.tap(x + 1, y);
      }
    }
    const shifted: Side = { ...side, IosAdapter: Shifted as unknown as Side['IosAdapter'] };
    const result = await compareRecording(login, side, shifted, { cap: 5, tools: new Set(['ui_snapshot', 'tap']) });
    expect(result.diffs.length).toBeGreaterThan(0);
    expect(result.diffs.every((d) => d.call.tool === 'tap' && d.old.reply === d.new.reply)).toBe(true);
    const [[key]] = groupDiffs(result.diffs);
    expect(key).toBe('tap — device calls only');
    const sent = (d: (typeof result.diffs)[number], side: 'old' | 'new') => d.old && d[side].device.find((c) => c.startsWith('idb ui tap'));
    const d = result.diffs[0];
    const [, x0] = /idb ui tap (\d+) /.exec(sent(d, 'old')!)!;
    const [, x1] = /idb ui tap (\d+) /.exec(sent(d, 'new')!)!;
    expect(Number(x1) - Number(x0)).toBe(1);
  });

  it('a side whose code lacks one of the four exports is refused by name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'averi-side-'));
    try {
      for (const [path, body] of [
        ['src/mcp/tools.ts', 'export const somethingElse = 1;'],
        ['src/mcp/registry.ts', 'export class AdapterRegistry {}\nexport const defaultFactory = () => undefined;'],
        ['src/adapters/ios.ts', 'export class IosAdapter {}'],
        ['src/adapters/wda-source.ts', 'export const parseWdaSourceValue = () => undefined;'],
      ]) {
        await mkdir(join(root, dirname(path)), { recursive: true });
        await writeFile(join(root, path), body);
      }
      await expect(loadSide(root)).rejects.toThrow(`side ${root}: src/mcp/tools.ts has no export createAveriServer`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('the costly variants\' targets: never a node covering 90 % of the screen, then one per vertical third, top to bottom', () => {
    const at = (name: string, y: number, height = 40, width = 300) => ({ name, rect: { x: 0, y, width, height } });
    const screen = { width: 402, height: 874 };
    const targets = [
      at('root', 0, 874, 402),
      at('wrapper', 0, 800, 402),
      at('almost the screen', 20, 800, 402),
      at('header', 60),
      at('title', 100),
      at('row', 400),
      at('row 2', 450),
      at('footer', 780),
    ];
    expect(spread(targets, screen, 3).map((t) => t.name)).toEqual(['header', 'row', 'footer']);
    // A third with nothing in it: the first, middle and last of the rest fill in.
    expect(spread([at('a', 10), at('b', 20), at('c', 30), at('d', 40)], screen, 3).map((t) => t.name)).toEqual(['a', 'b', 'd']);
  });
});
