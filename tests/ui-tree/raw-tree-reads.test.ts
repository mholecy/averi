import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// A1: whether a failed tree read is a miss, and whether any wait cures it, is decided in ONE place — the read seam
// (ui-tree/read-tree.ts#readTreeOrMiss, #readTreeOr), which throws a failure no wait cures (PersistentReadError). A
// raw `adapter.uiTree()` decides it again wherever it stands, and inside a catch-all it would swallow that failure as
// a miss. So the raw calls outside the adapters and the seam are pinned here: a new one fails this test, and is either
// routed through the seam or added below with the reason it may read raw.
// A textual tripwire (it counts `.uiTree(` in the source text), not a proof: an aliased or destructured read slips by.
const ALLOWED_RAW_READS: Record<string, { calls: number; why: string }> = {
  'src/flow/engine.ts': { calls: 1, why: 'a hold-observing wrapper handed to pollTree: it rethrows every failure' },
  'src/interact/fill.ts': { calls: 1, why: "notInput's hint read: swallows any failure on purpose (a hint, not a verdict)" },
  'src/interact/keyboard-in-tree.ts': { calls: 1, why: "dismiss's first look: nothing moved yet, any failure throws as it came" },
  'src/mcp/tools.ts': { calls: 1, why: 'the one-shot ui_tree tool: any failure is the answer' },
  'src/verify/pixel-poll.ts': { calls: 1, why: 'a read-timing wrapper handed to pollTree: it rethrows every failure' },
};

const SRC = join(import.meta.dirname, '../../src');
const SEAM = 'src/ui-tree/read-tree.ts';

function rawReadsBySourceFile(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const file = relative(join(SRC, '..'), join(entry.parentPath, entry.name));
    if (file.startsWith('src/adapters/') || file === SEAM) continue;
    const calls = readFileSync(join(entry.parentPath, entry.name), 'utf8').match(/\.uiTree\(/g)?.length ?? 0;
    if (calls > 0) found[file] = calls;
  }
  return found;
}

describe('raw tree reads outside the read seam', () => {
  it('are only the allowlisted ones', () => {
    const allowed = Object.fromEntries(Object.entries(ALLOWED_RAW_READS).map(([file, { calls }]) => [file, calls]));
    expect(rawReadsBySourceFile()).toEqual(allowed);
  });
});
