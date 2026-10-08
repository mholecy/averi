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
  OffScreenRefusal,
  resolveNow,
  resolvePresent,
  resolveSettled,
} from '../../src/interact/resolve.js';
import { fillField } from '../../src/interact/fill.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { screenBox } from '../../src/interact/swipe.js';
import { tapElement } from '../../src/interact/tap.js';
import { bandNode, dropBand, el, FakeAdapter, iosLoginFake, node, resetLayout, screen } from '../helpers/fake.js';

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

/**
 * A tap on a resolved node whose centre lies off the screen is refused,
 * nothing sent (2026-10-08, docs/bugs/2026-10-08-ios-tap-off-screen-reported-done.md):
 * idb lists a scroll view's content below the fold with its real rects, and
 * the tap went to a point below the 874-pt screen and reported "Tapped".
 */
describe('a tap target off the screen (2026-10-08)', () => {
  /** The measured SWIFT form, in points: 402×874, the amount field on screen, two fields below the fold. */
  const swiftForm = () => {
    const fake = new FakeAdapter(
      {
        form: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 402, height: 874 },
          children: [
            node({ role: 'textfield', identifier: 'amount', rect: { x: 24, y: 300, width: 354, height: 44 } }),
            node({ role: 'text', label: 'Payee’s street', identifier: 'TextFieldWithComponentStyle', rect: { x: 42, y: 885, width: 103, height: 20 } }),
            node({ role: 'text', label: 'Payee’s bank city*', rect: { x: 42, y: 1157, width: 136, height: 20 } }),
          ],
        }),
      },
      'form',
    );
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    return fake;
  };

  it('the measured rects (y 885, y 1157 on a 402x874 screen): refused, nothing tapped', async () => {
    const fake = swiftForm();
    const street = await tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 }).catch((e: unknown) => e);
    expect(street).toBeInstanceOf(OffScreenRefusal);
    expect((street as Error).message).toBe(
      'text:"Payee’s street" is off screen at (94,895) on a 402x874 screen (rect 42,885 103x20) — scroll_until it first; nothing was tapped',
    );
    await expect(tapElement(fake, 'text:"Payee’s bank city*"', { ...REFUSE, timeoutMs: 60, pollMs: 2 })).rejects.toThrow(
      'text:"Payee’s bank city*" is off screen at (110,1167) on a 402x874 screen (rect 42,1157 136x20)',
    );
    expect(fake.tapPoints).toEqual([]);
    // The on-screen field beside them taps as before.
    await tapElement(fake, 'id:amount', { ...REFUSE, timeoutMs: 60, pollMs: 2 });
    expect(fake.taps).toEqual(['amount']);
  });

  it('partly on screen: the centre decides — on screen, tapped at the centre as before; off, refused with how much shows', async () => {
    const fake = swiftForm();
    const street = () => fake.live().children[1];
    street().rect = { x: 42, y: 860, width: 103, height: 20 }; // centre (94,870): on screen, 14 of 20 pt visible
    await tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 });
    expect(fake.tapPoints).toEqual([{ x: 94, y: 870 }]);
    street().rect = { x: 42, y: 866, width: 103, height: 20 }; // centre (94,876): off, 8 of 20 pt visible
    await expect(tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 })).rejects.toThrow(
      'text:"Payee’s street" is off screen at (94,876) on a 402x874 screen — only 40% of it (rect 42,866 103x20) is on screen, and a tap goes to its centre — scroll_until it with fully: true first; nothing was tapped',
    );
    expect(fake.tapPoints).toEqual([{ x: 94, y: 870 }]);
  });

  it('above the top and past either side edge: off screen too', async () => {
    const fake = swiftForm();
    const street = () => fake.live().children[1];
    for (const [rect, at] of [
      [{ x: 42, y: -40, width: 103, height: 20 }, '(94,-30)'],
      [{ x: 450, y: 400, width: 100, height: 20 }, '(500,410)'], // a carousel page to the right
      [{ x: -200, y: 400, width: 100, height: 20 }, '(-150,410)'],
    ] as const) {
      street().rect = { ...rect };
      await expect(tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 })).rejects.toThrow(`is off screen at ${at} on a 402x874 screen`);
    }
    expect(fake.tapPoints).toEqual([]);
  });

  it('landscape: the screen is the device box TURNED when the tree\'s window is (swipe.ts#screenBox) — x 600 of 874 is on screen', async () => {
    const fake = swiftForm();
    fake.live().rect = { x: 0, y: 0, width: 874, height: 402 }; // the window held sideways; the device reports the panel as built
    fake.live().children[1].rect = { x: 550, y: 100, width: 100, height: 20 };
    await tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 });
    expect(fake.tapPoints).toEqual([{ x: 600, y: 110 }]);
    fake.live().children[1].rect = { x: 42, y: 500, width: 103, height: 20 }; // below the turned screen's 402
    await expect(tapElement(fake, 'text:"Payee’s street"', { ...REFUSE, timeoutMs: 60, pollMs: 2 })).rejects.toThrow('is off screen at (94,510) on a 874x402 screen');
  });

  it('no screen to judge by — the device size unreadable and no window in the tree: the tap goes ahead as before (fail open)', async () => {
    resetLayout();
    const fake = new FakeAdapter({ s: node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ role: 'button', identifier: 'go', rect: { x: 40, y: 3000, width: 100, height: 20 } })] }) }, 's');
    fake.viewport = async () => {
      throw new Error('idb describe: no screen_dimensions');
    };
    await tapElement(fake, 'id:go', { ...REFUSE, timeoutMs: 60, pollMs: 2 });
    expect(fake.taps).toEqual(['go']);
  });

  it('the fill\'s focus tap goes through the same check: refused before anything is tapped or typed', async () => {
    const fake = swiftForm();
    fake.live().children[1].role = 'textfield';
    await expect(fillField(fake, 'text:"Payee’s street"', 'Main St 1', { ...REFUSE, timeoutMs: 60, pollMs: 2 })).rejects.toBeInstanceOf(OffScreenRefusal);
    expect(fake.tapPoints).toEqual([]);
    expect(fake.typed).toEqual([]);
  });

  it('a node the keyboard guard\'s dismissal moved off screen (the keyboard-avoiding layout scrolling back): refused, quoting what was sent first', async () => {
    const fake = iosLoginFake({
      onTap: (id, self) => {
        if (id !== 'login_title') return;
        dropBand(self.live());
        self.live().children[2].rect = { x: 36, y: 900, width: 141, height: 48 }; // login_submit, below the fold once the keyboard is gone
      },
    });
    fake.viewportSize = { width: 402, height: 874 };
    const error = await tapElement(fake, 'id:login_submit', { ...REFUSE, timeoutMs: 60, pollMs: 2, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OffScreenRefusal);
    expect((error as Error).message).toBe(
      'id:login_submit was not tapped: after id:"login_title" was tapped at (201,303) to hide the soft keyboard, it is off screen at (107,924) on a 402x874 screen (rect 36,900 141x48) — scroll_until it first',
    );
    expect(fake.taps).toEqual(['login_title']);
  });
});

describe('a selector that matched only 0×0 nodes: the never-found timeout says so (2026-10-08)', () => {
  // idb reports a node scrolled ABOVE the top of a scroll view as 0×0; the
  // zero-area rule skips it, and the wait read "to appear" for a node the
  // snapshot showed.
  const scrolledAbove = () => {
    resetLayout();
    return new FakeAdapter({ s: screen(node({ role: 'textfield', identifier: 'iban', rect: { x: 0, y: 0, width: 0, height: 0 } })) }, 's');
  };
  const HINT = '\n  (it matched only 0×0 nodes (scrolled off screen, or collapsed) — if it is in a scroll view, scroll_until it first)';

  it('resolveSettled (tap, type_text, a flow tap:/fill:): still ElementNotFoundError, the hint beneath the headline', async () => {
    const error = await resolveSettled(scrolledAbove(), 'id:iban', { ...REFUSE, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe(`Timed out after 20ms waiting for element id:iban to appear${HINT}`);
  });

  it('resolvePresent (the optional tap\'s presence check): the same', async () => {
    const error = await resolvePresent(scrolledAbove(), { id: 'iban' }, { ...FIRST, timeoutMs: 0, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ElementNotFoundError);
    expect((error as Error).message).toBe(`Timed out after 0ms waiting for element id:"iban" to appear${HINT}`);
  });

  it('only the LAST read counts: a 0×0 node that left before the deadline is plain absence, no hint', async () => {
    const fake = scrolledAbove();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => (reads++ === 0 ? real() : screen());
    const error = await resolveSettled(fake, 'id:iban', { ...REFUSE, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Timed out after 20ms waiting for element id:iban to appear');
  });

  it('a last read that FAILED drops the hint: the read error is the story', async () => {
    const fake = scrolledAbove();
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (reads++ === 0) return real();
      throw new Error('device offline');
    };
    const error = await resolveSettled(fake, 'id:iban', { ...REFUSE, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe('Timed out after 20ms waiting for element id:iban to appear\n  (last UI tree read failed: device offline)');
  });
});

/** Review of the off-screen refusal (2026-10-08): the probes it measured the first cut against. */
describe('the off-screen rule — review round 1 (2026-10-08)', () => {
  const OPTS = { ...REFUSE, timeoutMs: 60, pollMs: 2 };
  /** An iOS fake whose device reports `device` and whose tree is `tree` (idb: a rectless root unless the test gives it a rect). */
  const ios = (tree: UiNode, device: { width: number; height: number }) => {
    const fake = new FakeAdapter({ s: tree }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = device;
    return fake;
  };
  const idbRoot = (...children: UiNode[]) => node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children });
  const PORTRAIT = { width: 402, height: 874 };

  describe('B1 — a turn suggested but witnessed by no window refuses only a point outside the screen BOTH ways up', () => {
    // Probe A: an idb landscape tree whose Application window a carousel card
    // straddling the right edge makes unreliable — the box is not turned.
    const landscapeWithCard = (...extra: UiNode[]) =>
      idbRoot(
        node({
          role: 'other',
          rect: { x: 0, y: 0, width: 874, height: 402 },
          children: [
            node({ role: 'button', identifier: 'right_btn', rect: { x: 700, y: 100, width: 100, height: 40 } }),
            node({ role: 'other', identifier: 'card', rect: { x: 820, y: 50, width: 300, height: 200 } }),
            ...extra,
          ],
        }),
      );

    it('probe A: idb landscape, a straddling card — right_btn at (750,120) is TAPPED', async () => {
      const fake = ios(landscapeWithCard(), PORTRAIT);
      await tapElement(fake, 'id:right_btn', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 750, y: 120 }]);
    });

    it('probe A2: iPad landscape (1180x820 window on an 820x1180 panel) with a 2400-wide strip — Save at (1100,50) is TAPPED', async () => {
      const tree = idbRoot(
        node({
          role: 'other',
          rect: { x: 0, y: 0, width: 1180, height: 820 },
          children: [
            node({ role: 'other', identifier: 'strip', rect: { x: 0, y: 600, width: 2400, height: 100 } }),
            node({ role: 'button', identifier: 'save', rect: { x: 1060, y: 30, width: 80, height: 40 } }),
          ],
        }),
      );
      const fake = ios(tree, { width: 820, height: 1180 });
      await tapElement(fake, 'id:save', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 1100, y: 50 }]);
    });

    it('probe E: a walked width turns the box (852x393 on a 393x852 panel), but witnesses nothing — (100,500) is TAPPED', async () => {
      const rows = [0, 400, 800, 1200, 1600, 2000, 2400, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width: 852, height: 50 } }));
      // 200x40: not screen-shaped, so it does not discredit the walked width (geometry.ts#walkExtent).
      const fake = ios(idbRoot(...rows, node({ role: 'button', identifier: 'go', rect: { x: 50, y: 480, width: 200, height: 40 } })), { width: 393, height: 852 });
      expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 852, height: 393 }); // the turn this probe is about
      await tapElement(fake, 'id:go', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 150, y: 500 }]);
    });

    it('the measured case on an unwitnessed screen: below the fold either way up — still refused, and says it judged both ways', async () => {
      const fake = ios(landscapeWithCard(node({ role: 'text', identifier: 'street', rect: { x: 42, y: 885, width: 103, height: 20 } })), PORTRAIT);
      await expect(tapElement(fake, 'id:street', OPTS)).rejects.toThrow(
        'id:street is off screen at (94,895) on a 402x874 screen either way up (rect 42,885 103x20) — scroll_until it first; nothing was tapped',
      );
      expect(fake.tapPoints).toEqual([]);
    });

    it('a WITNESSED portrait screen still refuses a carousel page off its right edge within its turned height', async () => {
      const fake = ios(
        node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', identifier: 'page2', rect: { x: 450, y: 280, width: 100, height: 40 } })] }),
        PORTRAIT,
      );
      await expect(tapElement(fake, 'id:page2', OPTS)).rejects.toThrow('id:page2 is off screen at (500,300) on a 402x874 screen (rect');
    });
  });

  it('m5 — the edge: the last column is on screen, the width is not (right and bottom exclusive)', async () => {
    const fake = ios(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'button', identifier: 'b', rect: { x: 400, y: 100, width: 2, height: 2 } })] }), PORTRAIT);
    await tapElement(fake, 'id:b', OPTS); // (401,101)
    expect(fake.tapPoints).toEqual([{ x: 401, y: 101 }]);
    fake.live().children[0].rect = { x: 401, y: 100, width: 2, height: 2 }; // (402,101)
    await expect(tapElement(fake, 'id:b', OPTS)).rejects.toThrow('is off screen at (402,101)');
    fake.live().children[0].rect = { x: 100, y: 872, width: 2, height: 4 }; // (101,874)
    await expect(tapElement(fake, 'id:b', OPTS)).rejects.toThrow('is off screen at (101,874)');
  });

  it('m5 — probe C: the device size unreadable, the tree\'s window stands in (not fail-open): y 885 on its 402x874 is refused', async () => {
    const fake = ios(node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'text', identifier: 'street', rect: { x: 42, y: 885, width: 103, height: 20 } })] }), PORTRAIT);
    fake.viewport = async () => {
      throw new Error('idb describe: no screen_dimensions');
    };
    await expect(tapElement(fake, 'id:street', OPTS)).rejects.toThrow('id:street is off screen at (94,895) on a 402x874 screen');
    expect(fake.tapPoints).toEqual([]);
  });

  describe('M3 — the memoized screen size is read again before a refusal', () => {
    /** A device whose memo holds `stale` until a fresh read, which answers `now`. */
    const folding = (tree: UiNode, stale: { width: number; height: number }, now: { width: number; height: number }) => {
      const fake = new FakeAdapter({ s: tree }, 's');
      let memo = stale;
      const fresh: boolean[] = [];
      fake.viewport = async (o?: { fresh?: boolean }) => {
        fresh.push(o?.fresh === true);
        if (o?.fresh === true) memo = now;
        return memo;
      };
      return { fake, fresh };
    };

    it('probe B: an unfold the memo missed (1080x2400 kept, the tree 2208x1840) — re-read, then id:ok at (1600,1650) is TAPPED', async () => {
      const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 2208, height: 1840 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 1550, y: 1630, width: 100, height: 40 } })] });
      const { fake, fresh } = folding(tree, { width: 1080, height: 2400 }, { width: 2208, height: 1840 });
      await tapElement(fake, 'id:ok', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 1600, y: 1650 }]);
      expect(fresh.filter(Boolean)).toHaveLength(1); // once, on the refusal path
    });

    it('the clear path never re-reads', async () => {
      const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2400 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 100, y: 100, width: 100, height: 40 } })] });
      const { fake, fresh } = folding(tree, { width: 1080, height: 2400 }, { width: 1, height: 1 });
      await tapElement(fake, 'id:ok', OPTS);
      expect(fresh.some(Boolean)).toBe(false);
    });

    it('still off after the re-read: refused, naming the size read again and the one it replaced', async () => {
      const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 0, height: 0 }, children: [node({ role: 'button', identifier: 'ok', rect: { x: 100, y: 2500, width: 100, height: 40 } })] });
      const { fake } = folding(tree, { width: 1080, height: 2200 }, { width: 1080, height: 2400 });
      await expect(tapElement(fake, 'id:ok', OPTS)).rejects.toThrow(
        'id:ok is off screen at (150,2520) on a 1080x2400 screen (read again before refusing; it was 1080x2200) (rect 100,2500 100x40)',
      );
      expect(fake.tapPoints).toEqual([]);
    });
  });

  it('m1 — the in-tree guard handed the node back clear (the keyboard gone on the second look), nothing sent: the plain refusal', async () => {
    const fake = iosLoginFake();
    fake.viewportSize = PORTRAIT;
    let reads = 0;
    const real = fake.uiTree.bind(fake);
    fake.uiTree = async () => {
      if (++reads === 3) {
        dropBand(fake.live());
        fake.live().children[2].rect = { x: 36, y: 900, width: 141, height: 48 };
      }
      return real();
    };
    await expect(tapElement(fake, 'id:login_submit', { ...OPTS, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }] })).rejects.toThrow(
      /^id:login_submit is off screen at \(107,924\) on a 402x874 screen \(rect 36,900 141x48\) — scroll_until it first; nothing was tapped$/,
    );
    expect(fake.taps).toEqual([]);
  });

  it('code review item 1: a PORTRAIT idb window a straddling card makes unreliable suggests no turn — a carousel item past the right edge is refused, and scroll_until swipes for it', async () => {
    const tree = idbRoot(
      node({
        role: 'other',
        rect: { x: 0, y: 0, width: 402, height: 874 },
        children: [
          node({ role: 'other', identifier: 'card', rect: { x: 300, y: 80, width: 300, height: 200 } }), // straddles x 402: the window is unreliable
          node({ role: 'button', identifier: 'next_item', rect: { x: 425, y: 80, width: 50, height: 40 } }), // centre (450,100)
        ],
      }),
    );
    const fake = ios(tree, PORTRAIT);
    expect((await screenBox(fake, { tree: await fake.uiTree() })).boxes).toEqual([{ x: 0, y: 0, width: 402, height: 874 }]);
    await expect(tapElement(fake, 'id:next_item', OPTS)).rejects.toThrow('id:next_item is off screen at (450,100) on a 402x874 screen (rect');
    await expect(scrollUntilVisible(fake, 'id:next_item', { maxSwipes: 1, settleMs: 0 })).rejects.toThrow('never intersected the 402x874 viewport (last rect');
    expect(fake.swipes).toHaveLength(1);
    expect(fake.tapPoints).toEqual([]);
  });

  describe('code review round 2: only a WINDOW\'s own sides suggest a turn (2026-10-08)', () => {
    it.each([
      ['874x380, unreliable (a straddling card)', { width: 874, height: 380 }, true],
      ['874x380, reliable', { width: 874, height: 380 }, false],
      ['874x390, unreliable', { width: 874, height: 390 }, true],
      ['852x402 (2.5 % short), unreliable', { width: 852, height: 402 }, true],
    ])('review round 3: a landscape idb window a few percent short of the panel still says turned — %s: (750,120) tapped, and scroll_until sees it', async (_n, win, card) => {
      const tree = idbRoot(
        node({
          role: 'other',
          rect: { x: 0, y: 0, ...win },
          children: [
            node({ role: 'button', identifier: 'right_btn', rect: { x: 700, y: 100, width: 100, height: 40 } }),
            ...(card ? [node({ role: 'other', rect: { x: 820, y: 50, width: 300, height: 200 } })] : []),
          ],
        }),
      );
      const fake = ios(tree, PORTRAIT);
      expect(await scrollUntilVisible(fake, 'id:right_btn', { maxSwipes: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
      await tapElement(fake, 'id:right_btn', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 750, y: 120 }]);
    });

    it('review round 3: a window as wide as the panel turned but TALLER than its short side (an 874x874 node crowned on a portrait idb tree) says nothing — (450,100) refused', async () => {
      const fake = ios(
        idbRoot(node({ role: 'other', rect: { x: 0, y: 0, width: 874, height: 874 } }), node({ role: 'button', identifier: 'item', rect: { x: 425, y: 80, width: 50, height: 40 } })),
        PORTRAIT,
      );
      await expect(tapElement(fake, 'id:item', OPTS)).rejects.toThrow('id:item is off screen at (450,100) on a 402x874 screen (rect');
    });

    it('review round 3: an iPad landscape window 20 pt short (1180x800 on 820x1180) with a 2400-wide strip — Save at (1100,50) tapped', async () => {
      const tree = idbRoot(
        node({
          role: 'other',
          rect: { x: 0, y: 0, width: 1180, height: 800 },
          children: [
            node({ role: 'other', rect: { x: 0, y: 600, width: 2400, height: 100 } }),
            node({ role: 'button', identifier: 'save', rect: { x: 1060, y: 30, width: 80, height: 40 } }),
          ],
        }),
      );
      const fake = ios(tree, { width: 820, height: 1180 });
      await tapElement(fake, 'id:save', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 1100, y: 50 }]);
    });

    it('P1: a portrait idb tree with no window, a carousel walked to x 1500 — the walk suggests nothing: (450,100) refused, scroll_until swipes', async () => {
      const cells = [0, 300, 600, 900, 1200].map((x) => node({ role: 'cell', rect: { x, y: 80, width: 300, height: 40 } }));
      const rows = [200, 400, 600, 800].map((y) => node({ role: 'text', rect: { x: 0, y, width: 402, height: 40 } }));
      const fake = ios(idbRoot(...cells, ...rows, node({ role: 'button', identifier: 'item', rect: { x: 425, y: 80, width: 50, height: 40 } })), PORTRAIT);
      expect((await screenBox(fake, { tree: await fake.uiTree() })).boxes).toEqual([{ x: 0, y: 0, width: 402, height: 874 }]);
      await expect(tapElement(fake, 'id:item', OPTS)).rejects.toThrow('id:item is off screen at (450,100) on a 402x874 screen (rect');
      await expect(scrollUntilVisible(fake, 'id:item', { maxSwipes: 1, settleMs: 0 })).rejects.toThrow('never intersected the 402x874 viewport (last rect');
      expect(fake.swipes).toHaveLength(1);
    });

    it('P1b: a walk that happens to measure the panel turned (874x402 of content on a portrait screen) is still no window — (450,100) refused', async () => {
      const fake = ios(
        idbRoot(
          node({ role: 'cell', rect: { x: 574, y: 80, width: 300, height: 40 } }),
          node({ role: 'text', rect: { x: 0, y: 362, width: 402, height: 40 } }),
          node({ role: 'button', identifier: 'item', rect: { x: 425, y: 80, width: 50, height: 40 } }),
        ),
        PORTRAIT,
      );
      await expect(tapElement(fake, 'id:item', OPTS)).rejects.toThrow('id:item is off screen at (450,100) on a 402x874 screen (rect');
    });

    it('P5, the stated LOSS: a landscape idb tree with no window and a straddling card — nothing says turned, so a right-side button at (650,120) is refused', async () => {
      const rows = [0, 400, 800, 1600, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width: 874, height: 50 } }));
      const fake = ios(
        idbRoot(...rows, node({ role: 'other', rect: { x: 820, y: 50, width: 300, height: 200 } }), node({ role: 'button', identifier: 'right', rect: { x: 600, y: 100, width: 100, height: 40 } })),
        PORTRAIT,
      );
      await expect(tapElement(fake, 'id:right', OPTS)).rejects.toThrow('id:right is off screen at (650,120) on a 402x874 screen');
    });

    it('P8: an Android top split-screen pane (1080x1000 on 1080x2400) fits the panel unturned — no turn suggested: (1500,500) refused, (500,500) tapped', async () => {
      const fake = new FakeAdapter(
        {
          s: node({
            role: 'container',
            rect: { x: 0, y: 0, width: 1080, height: 1000 },
            children: [
              node({ role: 'button', identifier: 'far', rect: { x: 1450, y: 480, width: 100, height: 40 } }),
              node({ role: 'button', identifier: 'near', rect: { x: 450, y: 480, width: 100, height: 40 } }),
            ],
          }),
        },
        's',
      );
      fake.viewportSize = { width: 1080, height: 2400 };
      await expect(tapElement(fake, 'id:far', OPTS)).rejects.toThrow('id:far is off screen at (1500,500) on a 1080x2400 screen (rect');
      await tapElement(fake, 'id:near', OPTS);
      expect(fake.tapPoints).toEqual([{ x: 500, y: 500 }]);
    });

    it('P2: a 500x300 banner at the origin crowned as an idb window turns the gesture box, but is no evidence for a judgement — (450,420) refused on the panel as built', async () => {
      const fake = ios(
        idbRoot(node({ role: 'image', rect: { x: 0, y: 0, width: 500, height: 300 } }), node({ role: 'button', identifier: 'next', rect: { x: 425, y: 400, width: 50, height: 40 } })),
        PORTRAIT,
      );
      const judged = await screenBox(fake, { tree: await fake.uiTree() });
      expect(judged.box).toEqual({ x: 0, y: 0, width: 874, height: 402 }); // the swipe's accepted cost (geometry.ts#windowTurnsScreen)
      expect(judged.boxes).toEqual([{ x: 0, y: 0, width: 402, height: 874 }]);
      await expect(tapElement(fake, 'id:next', OPTS)).rejects.toThrow('id:next is off screen at (450,420) on a 402x874 screen (rect');
    });

    it('a two-box failure under an applied keyboard cover names the screen above the keyboard, never "either way up"', async () => {
      const tree = idbRoot(
        node({
          role: 'other',
          rect: { x: 0, y: 0, width: 874, height: 402 },
          children: [node({ role: 'other', rect: { x: 820, y: 50, width: 300, height: 200 } }), node({ role: 'button', identifier: 'pay', rect: { x: 50, y: 1000, width: 100, height: 40 } })],
        }),
        bandNode({ x: 0, y: 250, width: 874, height: 152 }),
      );
      const fake = ios(tree, PORTRAIT);
      expect((await screenBox(fake, { tree: await fake.uiTree() })).boxes).toHaveLength(2);
      const error = await scrollUntilVisible(fake, 'id:pay', { maxSwipes: 0 }).catch((e: unknown) => e);
      expect((error as Error).message).toContain('never intersected the 402x250 screen above the soft keyboard over [0,250][874,402] (last rect');
    });
  });

  it('review round 2 — probe J: on a box no window witnessed (a walked width turns 393x852 to 852x393), scroll_until judges both ways up, as the tap does: y 600 is visible, and tapped', async () => {
    const rows = [0, 400, 800, 1200, 1600, 2000, 2400, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width: 852, height: 50 } }));
    const fake = ios(idbRoot(...rows, node({ role: 'button', identifier: 'go', rect: { x: 50, y: 580, width: 200, height: 40 } })), { width: 393, height: 852 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).box).toEqual({ x: 0, y: 0, width: 852, height: 393 });
    expect(await scrollUntilVisible(fake, 'id:go', { maxSwipes: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    await tapElement(fake, 'id:go', OPTS);
    expect(fake.tapPoints).toEqual([{ x: 150, y: 600 }]);
    // Outside both ways up: still never intersected, and said so.
    fake.live().children[8].rect = { x: 50, y: 900, width: 200, height: 40 };
    await expect(scrollUntilVisible(fake, 'id:go', { maxSwipes: 0 })).rejects.toThrow('element in tree but never intersected the 852x393 viewport either way up');
  });

  it('M2 — probe I: scroll_until judges on the tap\'s screen, turned in landscape (WDA root 874x402 on a 402x874 panel): y 500 is NOT visible', async () => {
    const tree = node({ role: 'container', rect: { x: 0, y: 0, width: 874, height: 402 }, children: [node({ role: 'button', identifier: 'pay', rect: { x: 50, y: 500, width: 100, height: 40 } })] });
    const fake = ios(tree, PORTRAIT);
    await expect(scrollUntilVisible(fake, 'id:pay', { maxSwipes: 0 })).rejects.toThrow('element in tree but never intersected the 874x402 viewport');
    await expect(tapElement(fake, 'id:pay', OPTS)).rejects.toThrow('id:pay is off screen at (100,520) on a 874x402 screen');
  });
});
