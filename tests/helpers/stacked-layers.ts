import { readFile } from 'node:fs/promises';
import type { UiNode } from '../../src/adapters/types.js';
import { markWdaDialect } from '../../src/adapters/wda-source.js';

/**
 * The real WDA ui_snapshots of tests/fixtures/wda-ui-snapshot-stacked-layers.json, by screen — a fresh copy per call,
 * each given the WDA source's marks (adapters/wda-source.ts#markWdaDialect), which those captures lack, as
 * the differential harness gives a normalized WDA tree (scripts/differential/recorded-source.ts). The file stays as
 * captured.
 */
export async function stackedLayers(): Promise<Record<string, UiNode>> {
  const { screens } = JSON.parse(await readFile(new URL('../fixtures/wda-ui-snapshot-stacked-layers.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> };
  return Object.fromEntries(Object.entries(screens).map(([name, tree]) => [name, markWdaDialect(tree)]));
}
