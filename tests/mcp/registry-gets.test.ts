import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// D41: which adapter a tool call gets — the one for its device and the project's configured iOS tree source — is
// decided in ONE place, mcp/tools.ts#deviceFor. A second `registry.get(` decides it again, and the eight that did
// (each without a kind) were served by a second, idb-kind adapter in a `treeSource: wda` project. The registry's
// `opts` are required, so a kind-less get no longer typechecks; this pins the other half: no handler spells the
// get itself. Nothing else in src/ holds the registry (run/ and flow/ are handed a resolver by the handler).
// A textual tripwire (it counts `registry.get(` in the source text), not a proof: an aliased registry slips by.
const ALLOWED_GETS: Record<string, { calls: number; why: string }> = {
  'src/mcp/tools.ts': { calls: 1, why: 'deviceFor, the one resolver every handler goes through' },
};

const SRC = join(import.meta.dirname, '../../src');

function getsBySourceFile(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    const file = relative(join(SRC, '..'), join(entry.parentPath, entry.name));
    const calls = readFileSync(join(entry.parentPath, entry.name), 'utf8').match(/registry\.get\(/g)?.length ?? 0;
    if (calls > 0) found[file] = calls;
  }
  return found;
}

describe('registry.get calls in src/', () => {
  it('are only the one resolver in mcp/tools.ts', () => {
    const allowed = Object.fromEntries(Object.entries(ALLOWED_GETS).map(([file, { calls }]) => [file, calls]));
    expect(getsBySourceFile()).toEqual(allowed);
  });
});
