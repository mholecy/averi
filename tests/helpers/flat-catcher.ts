import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The lab cell tap-catcher-beneath-flat's predicted listings (ADR 0018, the A43 amendment): WDA's is the ungrouped
// blur-menu's less the card's rows K and W, idb's tap-catcher-beneath's — each with its ids the flat cell's.

export const FLAT = 'tap-catcher-beneath-flat';
export const IOS_TRUTH = fileURLToPath(new URL('../fixtures/truth/ios-iphone17-ios27/', import.meta.url));

/** A raw WDA `/source?format=json` element, as much of it as a listing reads. */
export interface RawWda {
  type: string;
  frame?: string;
  isVisible?: string;
  rawIdentifier?: string | null;
  children?: RawWda[];
}
/** A raw idb `ui describe-all --json` entry, as much of it as a listing reads. */
export interface RawIdb {
  type: string;
  frame: { x: number; y: number; width: number; height: number };
  AXUniqueId?: string | null;
}

const asFlat = (cell: string, text: string): string => text.replaceAll(`lab.${cell}.`, `lab.${FLAT}.`);
const CARD = new Set([`lab.${FLAT}.K`, `lab.${FLAT}.W`]);

/** `n` with every element of the card (K, W) left out, at any depth. */
const withoutCard = (n: RawWda): RawWda =>
  n.children === undefined ? n : { ...n, children: n.children.filter((c) => !CARD.has(c.rawIdentifier ?? '')).map(withoutCard) };

/** WDA's predicted payload: blur-menu.wda.json less K and W, its ids the flat cell's. */
export async function predictedWda(): Promise<{ value: RawWda }> {
  const raw = JSON.parse(asFlat('blur-menu', await readFile(join(IOS_TRUTH, 'blur-menu.wda.json'), 'utf8'))) as { value: RawWda };
  return { value: withoutCard(raw.value) };
}

/** idb's predicted list: tap-catcher-beneath.idb.json, its ids the flat cell's. */
export async function predictedIdb(): Promise<RawIdb[]> {
  return JSON.parse(asFlat('tap-catcher-beneath', await readFile(join(IOS_TRUTH, 'tap-catcher-beneath.idb.json'), 'utf8'))) as RawIdb[];
}

/** A WDA tree as lines in its order: depth, type, frame, `isVisible`, id. */
export const wdaListing = (n: RawWda, depth = 0): string[] => [
  `${depth} ${n.type} ${n.frame} vis=${n.isVisible} id=${n.rawIdentifier}`,
  ...(n.children ?? []).flatMap((c) => wdaListing(c, depth + 1)),
];

/** An idb list as lines in its order: type, frame, id. */
export const idbListing = (list: readonly RawIdb[]): string[] =>
  list.map(({ type, frame: f, AXUniqueId }) => `${type} ${f.x},${f.y} ${f.width}x${f.height} id=${AXUniqueId}`);
