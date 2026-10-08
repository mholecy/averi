import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
afterEach(() => {
  vi.useRealTimers();
});
import type { UiNode } from '../../src/adapters/types.js';
import {
  absenceError,
  AmbiguityRefusal,
  DEFAULT_SETTLE_TIMEOUT_MS,
  ElementNotFoundError,
  resolveNow,
  resolvePresent,
  resolveSettled,
} from '../../src/interact/resolve.js';
import { tapElement } from '../../src/interact/tap.js';
import { el, FakeAdapter, node, resetLayout, screen } from '../helpers/fake.js';

const FAST = { ambiguous: 'first' as const, timeoutMs: 60, pollMs: 2 };
const FIRST = { ambiguous: 'first' as const };
const REFUSE = { ambiguous: 'refuse' as const };

describe('resolveSettled — the deadline rule (2026-10-05)', () => {
  // The optional-tap shape: timeout 1500 (optionalTimeoutMs), poll 500, a
  // 600 ms uiautomator dump, a STATIC element. Two reads prove it still
  // (0→600, pause →1100, 1100→1700) and the second starts inside the
  // deadline, so it is taken. A cut of this that projected the previous
  // round's cost threw after ONE read at 615 ms — every tap and fill in a
  // flow would have lost its second look.
  it('a static element under a slow dump resolves in two reads, the second starting inside the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    resetLayout();
    const fake = new FakeAdapter({ s: screen(el({ role: 'button', identifier: 'target' })) }, 's');
    const origTree = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async () => {
      reads += 1;
      vi.setSystemTime(Date.now() + 600);
      return origTree();
    };
    const resolved = await resolveSettled(fake, { id: 'target' }, { ambiguous: 'first', timeoutMs: 1500, pollMs: 500 });
    expect(resolved.node.identifier).toBe('target');
    expect(reads).toBe(2);
  });
});

describe('resolveNow — the one resolution policy, applied to one tree', () => {
  it('a zero-area node is never a target: the real node wins even when the ghost comes first', () => {
    resetLayout();
    const ghost = node({ role: 'other', identifier: 'tab', rect: { x: 5, y: 5, width: 0, height: 0 } });
    const real = el({ role: 'button', identifier: 'tab' });
    const tree = screen(ghost, real);
    expect(resolveNow(tree, { id: 'tab' }, FIRST)).toEqual({ node: real });
    expect(resolveNow(tree, 'id:tab', REFUSE)).toEqual({ node: real }); // the selector-string vocabulary, same policy, either mode
  });

  it('nothing actionable is undefined, not an error — a poller treats it as a miss', () => {
    resetLayout();
    const ghost = node({ identifier: 'tab', rect: { x: 5, y: 5, width: 0, height: 0 } });
    expect(resolveNow(screen(ghost), { id: 'tab' }, FIRST)).toBeUndefined();
    expect(resolveNow(screen(), 'id:tab', REFUSE)).toBeUndefined();
  });

  it('among several matches the only interactive one wins, with the note preferInteractive produces', () => {
    // The iOS field convention: title and error labels share the field's identifier.
    resetLayout();
    const field = el({ role: 'textfield', identifier: 'amount' });
    const tree = screen(el({ role: 'text', identifier: 'amount', label: 'Amount' }), field, el({ role: 'text', identifier: 'amount', label: 'Too small' }));
    const resolved = resolveNow(tree, { id: 'amount' }, REFUSE); // not ambiguous once the tie-breaker applies, so even refuse mode answers
    expect(resolved?.node).toBe(field);
    expect(resolved?.note).toBe('3 matches; picked the only interactive one (textfield)');
  });

  describe('still ambiguous after the tie-breakers: the caller\'s mode decides', () => {
    const twoButtons = () => {
      resetLayout();
      const a = el({ role: 'button', identifier: 'dup', label: 'A' });
      const b = el({ role: 'button', identifier: 'dup', label: 'B' });
      return { a, tree: screen(a, b) };
    };

    it("'first' (the flow engine) picks the first and says so in the note", () => {
      const { a, tree } = twoButtons();
      const resolved = resolveNow(tree, 'id:dup', FIRST);
      expect(resolved?.node).toBe(a);
      expect(resolved?.note).toBe('2 matches, none uniquely interactive; picked the first (button id=dup label="A"; button id=dup label="B")');
    });

    it("'refuse' (the MCP tools) throws with the candidates listed, in the pre-interact resolveOne wording", () => {
      const { tree } = twoButtons();
      expect(() => resolveNow(tree, 'id:dup', REFUSE)).toThrow(
        'Selector matches 2 elements: id:dup\n  button id=dup label="A"\n  button id=dup label="B"\nNarrow it (add role:, id: or an exact text:) so exactly one element matches',
      );
      // An ElementSpec target is described in its own vocabulary.
      expect(() => resolveNow(tree, { id: 'dup' }, REFUSE)).toThrow(/Selector matches 2 elements: id:"dup"/);
    });

    it('a refusal is not a miss: resolveSettled propagates it at once instead of waiting out the budget', async () => {
      const { tree } = twoButtons();
      const fake = new FakeAdapter({ s: tree }, 's');
      let reads = 0;
      const real = fake.uiTree.bind(fake);
      fake.uiTree = async () => (reads++, real());
      const started = Date.now();
      const error = await resolveSettled(fake, 'id:dup', { ...REFUSE, timeoutMs: 2_000, pollMs: 2 }).catch((e: unknown) => e);
      expect((error as Error).message).toMatch(/Selector matches 2 elements/);
      // A refusal is a selector problem, never absence: an optional step
      // that hits one must quote it, not read "(not present)".
      expect(error).toBeInstanceOf(AmbiguityRefusal);
      expect(error).not.toBeInstanceOf(ElementNotFoundError);
      expect(reads).toBe(1);
      expect(Date.now() - started).toBeLessThan(500);
    });
  });

  it('a single match carries no note', () => {
    resetLayout();
    const only = el({ role: 'text', identifier: 'x' });
    expect(resolveNow(screen(only), { id: 'x' }, FIRST)).toEqual({ node: only });
  });
});

describe('resolveSettled — appear AND hold still', () => {
  /** A target whose y follows `positions` read by read, then stays at the last one. */
  function animated(positions: number[]) {
    resetLayout();
    const target = el({ role: 'button', identifier: 'tab' });
    const dash = screen(target);
    let reads = 0;
    class AnimatedFake extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        target.rect = { ...target.rect, y: positions[Math.min(reads++, positions.length - 1)] };
        return structuredClone(dash);
      }
    }
    return { fake: new AnimatedFake({ dash }, 'dash'), reads: () => reads };
  }

  it('returns the node only once its rect is identical in two consecutive reads', async () => {
    const { fake, reads } = animated([100, 160, 220, 220, 220]);
    const { node: settled } = await resolveSettled(fake, { id: 'tab' }, FAST);
    expect(settled.rect.y).toBe(220);
    expect(reads()).toBe(4); // 100, 160, 220, 220 — the fourth read is the confirming one
  });

  it('a node that vanishes between reads must prove it holds still again', async () => {
    resetLayout();
    const target = el({ role: 'button', identifier: 'tab' });
    const withTarget = screen(target);
    const without = screen();
    const sequence = [withTarget, without, withTarget, withTarget];
    let reads = 0;
    class BlinkingFake extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        return structuredClone(sequence[Math.min(reads++, sequence.length - 1)]);
      }
    }
    await resolveSettled(new BlinkingFake({ withTarget }, 'withTarget'), { id: 'tab' }, FAST);
    // Reads 1 and 3 show the same rect, but read 2 reset the comparison, so
    // the settle is confirmed by read 4, not read 3.
    expect(reads).toBe(4);
  });

  // 2026-10-08: the two ways a settle wait ends are two sentences, and only
  // the first is ElementNotFoundError. Until then both read "(visible and
  // settled)", and the flow's `optional:` had to guess which one it got.
  it('a target that NEVER resolves times out as ElementNotFoundError, worded "to appear" — nothing about settling', async () => {
    resetLayout();
    const fake = new FakeAdapter({ s: screen() }, 's');
    const error = await resolveSettled(fake, { id: 'nope' }, { ...FIRST, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe('Timed out after 20ms waiting for element id:"nope" to appear');
  });

  it('a target that was FOUND but never held still is a plain Error worded "to hold still", never ElementNotFoundError', async () => {
    // Every read moves it: found on every round, settled on none.
    const { fake } = animated(Array.from({ length: 1_000 }, (_, i) => 100 + i));
    const error = await resolveSettled(fake, { id: 'tab' }, { ...FIRST, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe(
      'Timed out after 20ms waiting for element id:"tab" to hold still (found, but never at the same position in two consecutive reads)',
    );
  });

  it('a target found ONCE and then gone is "found", not ElementNotFoundError: one sighting is a fact about the screen', async () => {
    resetLayout();
    const target = el({ role: 'button', identifier: 'tab' });
    const withTarget = screen(target);
    const without = screen();
    let reads = 0;
    class GoneFake extends FakeAdapter {
      override async uiTree(): Promise<UiNode> {
        return structuredClone(reads++ === 0 ? withTarget : without);
      }
    }
    const error = await resolveSettled(new GoneFake({ withTarget }, 'withTarget'), { id: 'tab' }, { ...FIRST, timeoutMs: 20, pollMs: 2 }).catch(
      (e: unknown) => e,
    );
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toMatch(/to hold still \(found, /);
  });

  it('a wait that read good trees and then LOST the device is not ElementNotFoundError: the last read is the fresher fact', async () => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    const real = fake.uiTree.bind(fake);
    let reads = 0;
    fake.uiTree = async () => {
      if (reads++ === 0) return real();
      throw new Error('device offline');
    };
    const error = await resolveSettled(fake, 'id:nope', { ...FIRST, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect(reads).toBeGreaterThan(1);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message.split('\n')).toEqual([
      'Timed out after 20ms waiting for element id:nope to appear',
      '  (last UI tree read failed: device offline)',
    ]);
  });

  it('a wait that read NO tree is not ElementNotFoundError: nobody saw the screen, so absence is not a finding', async () => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    fake.uiTree = async () => {
      throw new Error('device offline');
    };
    const error = await resolveSettled(fake, 'id:nope', { ...FIRST, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message.split('\n')).toEqual([
      'Timed out after 20ms waiting for element id:nope to appear',
      '  (last UI tree read failed: device offline)',
    ]);
  });

  it('quotes the last tree-read error beneath a timeout, so a dead device never reads as a slow screen', async () => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    fake.uiTree = async () => {
      throw new Error('uiautomator dump returned no XML');
    };
    await expect(resolveSettled(fake, 'id:nope', { ...REFUSE, timeoutMs: 20, pollMs: 2 })).rejects.toThrow(
      /Timed out after 20ms[\s\S]*last UI tree read failed: uiautomator dump returned no XML/,
    );
  });

  it('the default budget is the 5 s the tap: step documents, named once', () => {
    expect(DEFAULT_SETTLE_TIMEOUT_MS).toBe(5_000);
  });
});

describe('absenceError — the one rule for when a wait that gave up is absence (2026-10-08)', () => {
  const offline = new Error('device offline');
  it.each([
    ['never sighted, trees read, last read good', { sighted: false, treesRead: 3 }, true],
    ['sighted', { sighted: true, treesRead: 3 }, false],
    ['no tree read', { sighted: false, treesRead: 0, readError: offline }, false],
    ['trees read, then the last read failed', { sighted: false, treesRead: 3, readError: offline }, false],
  ])('%s', (_, seen, absent) => {
    const error = absenceError('the message', seen);
    expect(error.message).toBe('the message');
    expect(error instanceof ElementNotFoundError).toBe(absent);
  });
});

describe('resolvePresent — appear only, the optional tap\'s presence check (2026-10-08)', () => {
  it('one sighting is enough: no second read to prove the rect still', async () => {
    resetLayout();
    const fake = new FakeAdapter({ s: screen(el({ role: 'button', identifier: 'promo' })) }, 's');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    const { node: found } = await resolvePresent(fake, { id: 'promo' }, { ...FIRST, timeoutMs: 0, pollMs: 2 });
    expect(found.identifier).toBe('promo');
    expect(reads).toBe(1);
  });

  it('a zero-area ghost is not a sighting: the same policy as the tap that would follow', async () => {
    resetLayout();
    const ghost = node({ identifier: 'promo', rect: { x: 0, y: 0, width: 0, height: 0 } });
    const fake = new FakeAdapter({ s: screen(ghost) }, 's');
    await expect(resolvePresent(fake, { id: 'promo' }, { ...FIRST, timeoutMs: 0, pollMs: 2 })).rejects.toBeInstanceOf(ElementNotFoundError);
  });

  it('an absent target is ElementNotFoundError in the never-found wording, after one read even on a zero budget', async () => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++, real());
    const error = await resolvePresent(fake, { id: 'promo' }, { ...FIRST, timeoutMs: 0, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe('Timed out after 0ms waiting for element id:"promo" to appear');
    expect(reads).toBe(1);
  });
});

describe('tapElement', () => {
  it('taps the center of the settled node and reports how it was chosen', async () => {
    resetLayout();
    const ghost = node({ identifier: 'go', rect: { x: 0, y: 0, width: 0, height: 0 } });
    const label = el({ role: 'text', identifier: 'go', label: 'Go' });
    const button = el({ role: 'button', identifier: 'go' });
    const fake = new FakeAdapter({ s: screen(ghost, label, button) }, 's');
    const { note } = await tapElement(fake, 'id:go', FAST);
    expect(fake.taps).toEqual(['go']);
    expect(note).toBe('2 matches; picked the only interactive one (button)');
  });

  it('polls instead of asking the adapter for its one-shot settle retry', async () => {
    resetLayout();
    const fake = new FakeAdapter({ s: screen(el({ role: 'button', identifier: 'go' })) }, 's');
    const opts: unknown[] = [];
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async (o?: { settle?: boolean }) => (opts.push(o), real());
    await tapElement(fake, { id: 'go' }, FAST);
    expect(opts.length).toBeGreaterThanOrEqual(2); // the rect-stable wait reads at least twice
    expect(opts.every((o) => o === undefined || (o as { settle?: boolean }).settle !== true)).toBe(true);
  });

  it('a target that never appears fails with the settle wording — the same error a flow tap: throws', async () => {
    const fake = new FakeAdapter({ s: screen() }, 's');
    await expect(tapElement(fake, 'id:nope', { ...REFUSE, timeoutMs: 10, pollMs: 2 })).rejects.toThrow(
      /Timed out after 10ms waiting for element id:nope to appear/,
    );
    expect(fake.taps).toEqual([]);
  });

  it("in 'refuse' mode an ambiguous selector taps NOTHING — the login-screen case", async () => {
    resetLayout();
    const fake = new FakeAdapter(
      { s: screen(el({ role: 'textfield', identifier: 'username' }), el({ role: 'textfield', identifier: 'password' })) },
      's',
    );
    await expect(tapElement(fake, 'role:textfield', { ...REFUSE, timeoutMs: 50, pollMs: 2 })).rejects.toThrow(
      /Selector matches 2 elements: role:textfield/,
    );
    expect(fake.taps).toEqual([]);
  });
});
