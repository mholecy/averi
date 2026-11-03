import { readdir, readFile } from 'node:fs/promises';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import type { UiNode } from '../../src/adapters/types.js';

/**
 * Every iOS tree the committed fixtures hold (tests/fixtures, the native and React Native truth captures), as its parser
 * reads it — the idb lists (one array, an `elements` one, or a `screens` or `positions` map of them) and the WDA
 * sources; an idb fixture of no known shape throws, never skipped. For a test that sweeps a rule over the whole corpus.
 */
export async function iosTrees(): Promise<[string, UiNode][]> {
  const trees: [string, UiNode][] = [];
  const skipped: string[] = [];
  const dirs = [new URL('../fixtures/', import.meta.url), new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url), new URL('../fixtures/truth/ios-rn-iphone17-ios27/', import.meta.url)];
  for (const dir of dirs) {
    // `*-ui-snapshot-*`: averi's own snapshot (UiNode), no source's tree — nothing of it to parse
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('-ui-snapshot-'))) {
      const text = await readFile(new URL(file, dir), 'utf8');
      if (file.startsWith('idb-') || file.endsWith('.idb.json')) {
        const json = JSON.parse(text) as unknown;
        const shaped = json as { screens?: Record<string, unknown[]>; positions?: Record<string, unknown[]>; elements?: unknown[] };
        const lists = Array.isArray(json) ? [json] : [...Object.values(shaped.screens ?? shaped.positions ?? {}), ...(shaped.elements ? [shaped.elements] : [])];
        if (lists.length === 0) throw new Error(`${file}: an idb fixture of no known shape`);
        lists.forEach((list, i) => trees.push([`${file}#${i}`, parseIdbDescribeAll(JSON.stringify(list))]));
      } else if (file.startsWith('wda-') || file.endsWith('.wda.json')) {
        // By shape, as wda-source-visibility.test.ts's sweep: a payload whose root (itself, or its `value`) is no element
        // is one of WDA's other answers, never a tree.
        const raw = JSON.parse(text) as { type?: unknown; value?: { type?: unknown } | null };
        if (typeof (typeof raw.type === 'string' ? raw : raw.value)?.type !== 'string') skipped.push(file);
        else trees.push([file, parseWdaSource(text)]);
      }
    }
  }
  // The guard: exactly these are skipped — a tree that stopped parsing as one, or a new answer, fails every sweep.
  if (JSON.stringify(skipped.sort()) !== JSON.stringify([...NOT_TREES].sort())) {
    throw new Error(`the WDA fixtures that hold no tree are ${JSON.stringify(skipped)}, not ${JSON.stringify(NOT_TREES)}`);
  }
  return trees;
}

/**
 * The WDA fixtures that are no `/source` tree (T4): the `/wda/activeAppInfo` envelopes, the `/wda/keys` 404 body and
 * the D43 gate's corpus.
 */
const NOT_TREES: readonly string[] = [
  'wda-activeappinfo-lab-b4.json',
  'wda-activeappinfo-mobilesafari-b4.json',
  'wda-activeappinfo-springboard-b5.json',
  'wda-keys-404-invalid-session-b10.json',
  'wda-keys-gate-b10-g2.json',
];
