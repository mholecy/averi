import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { markIdbDialect, parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { isBareTree } from '../../src/ui-tree/bare-tree.js';
import { parseDump } from '../helpers/android-dumps.js';

// The held cells' bare phase (Held.swift, Held.kt: a white screen-sized root with nothing in it) must read BARE through
// every tree source — else the entry probe reads content, no second look is earned, and the ensure group's h1–h3 are
// MISMATCH entry-not-bare on every run. No capture of a held cell exists (they carry no truth), so each source's dump
// is a committed capture of a lab cell built on the same root, its cell's own content (every `lab.<cell>.*` node and
// what it holds) taken out: what the same app draws with nothing on its screen, through the real parsers.

const TRUTH = new URL('../fixtures/truth/', import.meta.url);
const read = (file: string) => readFileSync(new URL(file, TRUTH), 'utf8');

/** A uiautomator dump without every `<node>` whose resource-id is `lab.…`, and without what it holds. */
function withoutLabNodes(xml: string): string {
  let out = '';
  let skipping = 0;
  let at = 0;
  for (const m of xml.matchAll(/<node\b[^>]*?(\/?)>|<\/node>/g)) {
    if (skipping === 0) out += xml.slice(at, m.index);
    at = m.index + m[0].length;
    const open = m[0].startsWith('<node');
    const selfClosing = open && m[1] === '/';
    if (skipping > 0) {
      if (open && !selfClosing) skipping++;
      else if (!open) skipping--;
      continue;
    }
    if (open && /resource-id="lab\./.test(m[0])) {
      if (!selfClosing) skipping = 1;
      continue;
    }
    out += m[0];
  }
  return out + xml.slice(at);
}

/** A WDA `/source` body without every element identified `lab.…`, and without what it holds. */
function wdaWithoutLab(node: { rawIdentifier?: string | null; children?: unknown[] }): unknown {
  return { ...node, children: (node.children ?? []).filter((c) => !String((c as { rawIdentifier?: string }).rawIdentifier ?? '').startsWith('lab.')).map((c) => wdaWithoutLab(c as typeof node)) };
}

describe("the held cells' bare phase reads bare through every tree source", () => {
  it('uiautomator: Compose\'s screen-sized root Box (background, testTagsAsResourceId) with nothing in it — text-sample\'s dump, its targets out', () => {
    const xml = read('android-averi_lab-api33/text-sample.xml');
    const bare = withoutLabNodes(xml);
    expect(bare).not.toContain('lab.text-sample');
    expect(bare).toContain('androidx.compose.ui.platform.ComposeView');
    expect(isBareTree(parseDump(xml))).toBe(false);
    expect(isBareTree(parseDump(bare))).toBe(true);
  });

  it('idb: the Application alone — open\'s describe-all, its targets out', () => {
    const all = JSON.parse(read('ios-iphone17-ios27/open.idb.json')) as { AXUniqueId?: string | null }[];
    const bare = all.filter((e) => !(e.AXUniqueId ?? '').startsWith('lab.'));
    expect(bare.map((e) => (e as { type: string }).type)).toEqual(['Application']);
    expect(isBareTree(markIdbDialect(parseIdbDescribeAll(JSON.stringify(all))))).toBe(false);
    expect(isBareTree(markIdbDialect(parseIdbDescribeAll(JSON.stringify(bare))))).toBe(true);
  });

  it('wda: the Application, Window and SwiftUI hosting chain — open\'s /source, its targets out', () => {
    const source = JSON.parse(read('ios-iphone17-ios27/open.wda.json')) as { value: Parameters<typeof wdaWithoutLab>[0] };
    const bare = JSON.stringify({ ...source, value: wdaWithoutLab(source.value) });
    expect(bare).not.toContain('lab.open');
    expect(isBareTree(parseWdaSource(JSON.stringify(source)))).toBe(false);
    expect(isBareTree(parseWdaSource(bare))).toBe(true);
  });
});
