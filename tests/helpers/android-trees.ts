import { readdir, readFile } from 'node:fs/promises';
import type { UiNode } from '../../src/adapters/types.js';
import { parseDump } from './android-dumps.js';

/**
 * Every Android tree the committed truth captures hold (tests/fixtures/truth/android*, the native and React Native
 * ones), as the uiautomator parser reads it with the port production wires (`parseDump`), each named by its capture
 * directory and file. For a test that sweeps a rule over the whole corpus; the iOS twin is ios-trees.ts#iosTrees.
 */
export async function androidTrees(): Promise<[string, UiNode][]> {
  const trees: [string, UiNode][] = [];
  const truth = new URL('../fixtures/truth/', import.meta.url);
  for (const dir of (await readdir(truth)).filter((d) => d.startsWith('android')).sort()) {
    for (const file of (await readdir(new URL(`${dir}/`, truth))).filter((f) => f.endsWith('.xml')).sort()) {
      trees.push([`${dir}/${file}`, parseDump(await readFile(new URL(`${dir}/${file}`, truth), 'utf8'))]);
    }
  }
  return trees;
}
