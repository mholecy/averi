import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../src/adapters/types.js';
import { readTreeOrError } from '../../src/ui-tree/read-tree.js';

const tree: UiNode = {
  role: 'container',
  label: null,
  identifier: null,
  value: null,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  children: [],
};

describe('readTreeOrError', () => {
  it('returns the tree and no error on a successful read', async () => {
    const read = await readTreeOrError({ uiTree: async () => tree });
    expect(read.tree).toBe(tree);
    expect(read.error).toBeUndefined();
  });

  // The rule the pollers depend on: a read that throws must come back as a
  // VALUE (so the loop treats it as a miss and keeps waiting) while still
  // carrying the reason (so a genuinely dead device stays diagnosable).
  it('reports a failed read as a value, preserving the message', async () => {
    const read = await readTreeOrError({
      uiTree: async () => {
        throw new Error('null root node returned by UiTestAutomationBridge');
      },
    });
    expect(read.tree).toBeUndefined();
    expect(read.error?.message).toMatch(/null root node/);
  });

  // Adapters shell out, and a rejected child process can surface as a string.
  it('wraps a non-Error rejection so callers can always read .message', async () => {
    const read = await readTreeOrError({
      uiTree: async () => {
        throw 'adb: device offline';
      },
    });
    expect(read.error).toBeInstanceOf(Error);
    expect(read.error?.message).toBe('adb: device offline');
  });

  // Callers assign both fields each round, so `error` must be absent on
  // success — that is what clears a previous round's error for free.
  it('leaves error unset on success so callers self-clear', async () => {
    let fail = true;
    const adapter = {
      uiTree: async () => {
        if (fail) throw new Error('transient');
        return tree;
      },
    };
    const first = await readTreeOrError(adapter);
    fail = false;
    const second = await readTreeOrError(adapter);
    expect(first.error).toBeDefined();
    expect('error' in second && second.error !== undefined).toBe(false);
  });
});
