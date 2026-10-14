import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { installVirtualClock } from '../../scripts/differential/clock.js';
import type { Recording } from '../../scripts/differential/corpus.js';
import { compareRecording, groupDiffs } from '../../scripts/differential/differential.js';
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

describe('compareRecording', () => {
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
});
