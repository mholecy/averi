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
  const dirs = [new URL('../fixtures/', import.meta.url), new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url), new URL('../fixtures/truth/ios-rn-iphone17-ios27/', import.meta.url)];
  for (const dir of dirs) {
    // `*-ui-snapshot-*`: averi's own snapshot (UiNode), no source's tree — nothing of it to parse; `wda-activeappinfo-*`
    // and `wda-keys-*`: WDA's other answers (an activeAppInfo envelope, a `/wda/keys` body, the D43 gate's corpus)
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.includes('-ui-snapshot-') && !/^wda-(?:activeappinfo|keys)-/.test(f))) {
      const text = await readFile(new URL(file, dir), 'utf8');
      if (file.startsWith('idb-') || file.endsWith('.idb.json')) {
        const json = JSON.parse(text) as unknown;
        const shaped = json as { screens?: Record<string, unknown[]>; positions?: Record<string, unknown[]>; elements?: unknown[] };
        const lists = Array.isArray(json) ? [json] : [...Object.values(shaped.screens ?? shaped.positions ?? {}), ...(shaped.elements ? [shaped.elements] : [])];
        if (lists.length === 0) throw new Error(`${file}: an idb fixture of no known shape`);
        lists.forEach((list, i) => trees.push([`${file}#${i}`, parseIdbDescribeAll(JSON.stringify(list))]));
      } else if (file.startsWith('wda-') || file.endsWith('.wda.json')) {
        trees.push([file, parseWdaSource(text)]);
      }
    }
  }
  return trees;
}
