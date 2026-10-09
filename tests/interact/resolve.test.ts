import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
afterEach(() => {
  vi.useRealTimers();
});
import { readFile } from 'node:fs/promises';
import type { UiNode } from '../../src/adapters/types.js';
import { parseIdbDescribeAll } from '../../src/adapters/ios-tree-source.js';
import { parseWdaSource } from '../../src/adapters/wda-source.js';
import { tapText } from '../../src/mcp/tool-text.js';
import {
  absenceError,
  AmbiguityRefusal,
  CoveredRefusal,
  DEFAULT_SETTLE_TIMEOUT_MS,
  ElementNotFoundError,
  OffScreenRefusal,
  resolveNow,
  resolvePresent,
  resolveSettled,
} from '../../src/interact/resolve.js';
import { fillField } from '../../src/interact/fill.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { IOS_MIN_STATUS_BAND, iosStatusBand } from '../../src/adapters/ios-status-band.js';
import { screenBox } from '../../src/interact/swipe.js';
import { tapElement } from '../../src/interact/tap.js';
import { parseUiautomatorXml } from '../../src/adapters/android.js';
import { COMPOSE } from '../helpers/android-dumps.js';
import { CLASSIC_VIEWS } from '../helpers/synthetic-android-trees.js';
import { bandNode, dropBand, el, FakeAdapter, iosLoginFake, node, recorded, resetLayout, screen } from '../helpers/fake.js';

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

/**
 * A tap on a resolved node whose centre lies under a node drawn over it — the app's own pinned chrome — goes to an
 * uncovered piece of it when one is large enough, and is refused otherwise (2026-10-09,
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md). Measured on mp-native's SWIFT form under idb
 * (402×874 pt): `priority_select` at `24,771 354x52`, its centre (201,797) on the CONTINUE bar `24,780 354x44`, listed
 * LAST in idb's flat list; "Tapped" went to the disabled CONTINUE and nothing opened.
 */
describe('a tap target under the app\'s chrome (2026-10-09)', () => {
  const CONTINUE = 'button "Continue to summary" (24,780 354x44)';
  /** The SWIFT form as idb lists it: flat under a 0×0 root, the Application first, the CONTINUE bar last; `priority_select` at `y`. */
  const swiftForm = (y = 771) => {
    const fake = new FakeAdapter(
      {
        form: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 0, height: 0 },
          children: [
            node({ role: 'other', label: 'mp-native', rect: { x: 0, y: 0, width: 402, height: 874 } }),
            node({ role: 'button', label: 'BackButton', identifier: 'back', rect: { x: 30, y: 70, width: 28, height: 28 } }),
            node({ role: 'textfield', identifier: 'swift_payment.form.amount_input', rect: { x: 24, y: 300, width: 354, height: 44 } }),
            node({ role: 'button', label: 'Priority*', identifier: 'swift_payment.form.priority_select', rect: { x: 24, y, width: 354, height: 52 } }),
            node({ role: 'button', label: 'Continue to summary', identifier: 'swift_payment.form.continue_button', rect: { x: 24, y: 780, width: 354, height: 44 } }),
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
  const PRIORITY = 'id:swift_payment.form.priority_select';
  const OPTS = { ...REFUSE, timeoutMs: 60, pollMs: 2 };

  it('the measured rest position (y 771): only the top 9 pt show — refused, naming the bar, nothing tapped', async () => {
    const fake = swiftForm();
    const error = await tapElement(fake, PRIORITY, OPTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoveredRefusal);
    expect((error as Error).message).toBe(
      `${PRIORITY} is under ${CONTINUE} at its centre (201,797), drawn over it; only a 354x9 part of it shows, ` +
        'under the 24x24 a tap may be moved to — scroll_until it first; nothing was tapped',
    );
    expect(fake.tapPoints).toEqual([]);
  });

  it('at y 754 the centre (201,780) is on the bar but a 26-pt strip shows above it: tapped there, and the result says so', async () => {
    const fake = swiftForm(754);
    const result = await tapElement(fake, PRIORITY, OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 767 }]);
    expect(result.moved).toBe(`at (201,767) — its centre (201,780) is under ${CONTINUE}, drawn over it; tapped the uncovered part 354x26`);
    expect(tapText(PRIORITY, result.note, result.moved)).toBe(
      `Tapped ${PRIORITY} at (201,767) — its centre (201,780) is under ${CONTINUE}, drawn over it; tapped the uncovered part 354x26`,
    );
  });

  it('clear of the bar (the manual swipe put it at y 452), and the bar itself: tapped at the centre as always, nothing said', async () => {
    const fake = swiftForm(452);
    const result = await tapElement(fake, PRIORITY, OPTS);
    const bar = await tapElement(fake, 'id:swift_payment.form.continue_button', OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 478 }, { x: 201, y: 802 }]);
    expect([result.moved, bar.moved, result.note]).toEqual([undefined, undefined, undefined]);
  });

  it('a pinned footer\'s text inside a row, after it in idb\'s flat list (code review P4, repro E): a cover — the tap moves off it, never onto the footer', async () => {
    const fake = new FakeAdapter(
      {
        s: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 0, height: 0 },
          flatList: true,
          children: [
            node({ role: 'other', label: 'app', rect: { x: 0, y: 0, width: 402, height: 874 } }),
            node({ role: 'button', identifier: 'row', label: 'Row', rect: { x: 0, y: 760, width: 402, height: 60 } }),
            node({ role: 'text', label: 'Total 100 EUR', rect: { x: 16, y: 785, width: 200, height: 30 } }),
          ],
        }),
      },
      's',
    );
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    const result = await tapElement(fake, 'id:row', OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 773 }]);
    expect(result.moved).toBe('at (201,773) — its centre (201,790) is under text "Total 100 EUR" (16,785 200x30), drawn over it; tapped the uncovered part 402x25');
  });

  it('the fill\'s focus tap goes through the same check: refused before anything is tapped or typed; moved, the note says where it focused', async () => {
    const refused = swiftForm();
    refused.live().children[3].role = 'textfield';
    await expect(fillField(refused, PRIORITY, 'x', OPTS)).rejects.toBeInstanceOf(CoveredRefusal);
    expect([refused.tapPoints, refused.typed]).toEqual([[], []]);
    const moved = swiftForm(754);
    moved.live().children[3].role = 'textfield';
    const result = await fillField(moved, PRIORITY, 'x', OPTS);
    expect(moved.tapPoints).toEqual([{ x: 201, y: 767 }]);
    expect(result.note).toBe(`focus tap at (201,767) — its centre (201,780) is under ${CONTINUE}, drawn over it; tapped the uncovered part 354x26`);
  });

  it('the shape through the idb parser (tests/fixtures/idb-swift-form-continue.json): refused the same', async () => {
    const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    await expect(tapElement(fake, PRIORITY, OPTS)).rejects.toThrow(`${PRIORITY} is under ${CONTINUE} at its centre (201,797)`);
  });

  it('idb, a modal listed before the content it is drawn over (docs/bugs/2026-10-09-ios-idb-modal-listed-before-content-…, a round-6 regression): the chooser\'s rows and the value-date picker are tapped at their centres; scroll_until stops on the picker uncovered', async () => {
    const screens = JSON.parse(await readFile(new URL('../fixtures/idb-modal-listed-before-content.json', import.meta.url), 'utf8')).screens;
    const fake = new FakeAdapter({ chooser: parseIdbDescribeAll(JSON.stringify(screens.chooser)), picker: parseIdbDescribeAll(JSON.stringify(screens.valueDatePicker)) }, 'chooser');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    for (const id of ['row_own', 'row_swift']) {
      expect(await tapElement(fake, `id:accounts.detail.payment_type_sheet.${id}`, OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    }
    fake.current = 'picker';
    expect(await scrollUntilVisible(fake, 'id:swift_payment.form.value_date_picker', { maxSwipes: 0, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    await tapElement(fake, 'id:swift_payment.form.value_date_picker', OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 423 }, { x: 201, y: 479 }, { x: 205, y: 479 }]);
    // …and on the same screen the pinned CONTINUE, listed last, still covers what lies under it.
    await expect(tapElement(fake, 'text:"Payee\u2019s name"', OPTS)).rejects.toThrow(`text:"Payee\u2019s name" is under ${CONTINUE} at its centre (94,827)`);
  });

  it('idb, the number pad up with CONTINUE lifted onto it (run2-ios #250, review of fix/r6b-idb HIGH 1): a row under the keys is never tapped on key "2" — refused, nothing tapped', async () => {
    const tree = parseIdbDescribeAll(JSON.stringify(JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-number-pad.json', import.meta.url), 'utf8')).elements));
    tree.children.splice(tree.children.findIndex((n) => n.identifier === 'swift_payment.form.continue_button'), 0, node({ role: 'button', identifier: 'fees', label: 'Fees', rect: { x: 24, y: 570, width: 354, height: 60 } }));
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    await expect(tapElement(fake, 'id:fees', OPTS)).rejects.toBeInstanceOf(CoveredRefusal);
    await expect(tapElement(fake, 'id:swift_payment.form.value_date_select', OPTS)).rejects.toThrow(`is under button "Continue to summary" (24,512 354x44) at its centre (201,571)`);
    expect(fake.tapPoints).toEqual([]);
  });

  it('idb, a label 3 pt below the pinned CONTINUE (round-6 device check H-1, which pressed CONTINUE): refused, nothing tapped — the bar reaches the screen\'s bottom', async () => {
    const elements = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-scrolled-under-top-bar.json', import.meta.url), 'utf8')).positions.pos1;
    const tree = parseIdbDescribeAll(JSON.stringify(elements));
    tree.children.find((n) => n.label === 'Payee\u2019s bank street & no.*')!.rect = { x: 42, y: 817, width: 186, height: 20 };
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    await expect(tapElement(fake, 'text:"Payee\u2019s bank street & no.*"', OPTS)).rejects.toThrow(
      `text:"Payee\u2019s bank street & no.*" is under ${CONTINUE} at its centre (135,827), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped`,
    );
    expect(fake.tapPoints).toEqual([]);
  });

  it('idb, a row scrolled up under the top bar (code review P1, repro C — since device check C3-3 the chrome-before-content rule): BackButton and the title are tapped at their centres, and scroll_until stops on them', async () => {
    const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    const debit = tree.children.find((n) => n.identifier === 'swift_payment.form.debit_select')!;
    debit.rect = { x: 24, y: 40, width: 354, height: 72 };
    tree.children.find((n) => n.role === 'textfield')!.rect.y = 27;
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    const scrolled = await scrollUntilVisible(fake, 'text:"SWIFT PAYMENT"', { maxSwipes: 0, settleMs: 0 });
    expect(scrolled).toEqual({ swipes: 0, visible: 1, clipped: [] });
    for (const selector of ['text:"BackButton"', 'text:"SWIFT PAYMENT"']) expect(await tapElement(fake, selector, OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    expect(fake.tapPoints).toEqual([{ x: 44, y: 84 }, { x: 201, y: 84 }]);
    // …and the pinned CONTINUE bar over priority_select is still refused, as measured.
    await expect(tapElement(fake, PRIORITY, OPTS)).rejects.toBeInstanceOf(CoveredRefusal);
  });

  it('WDA, a React Native view whose texts it lists as the view\'s siblings (tests/fixtures/wda-source-rn-myport.json — verification of P4): scroll_until stops on placeholder_screen and the tap lands on its centre — as at 13d68a2', async () => {
    const tree = parseWdaSource(await readFile(new URL('../fixtures/wda-source-rn-myport.json', import.meta.url), 'utf8'));
    const fake = new FakeAdapter({ rn: tree }, 'rn');
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    const banner = { role: 'container', label: '!, Open debugger to view warnings.', identifier: null, rect: { x: 10, y: 787, width: 382, height: 49 } };
    expect(await scrollUntilVisible(fake, 'id:placeholder_screen', { maxSwipes: 0, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [], covered: { by: banner, shows: expect.closeTo(0.915, 3) } });
    // `fully` is kept off by the dev build's warning banner at the bottom — a real cover — never by the screen's own text.
    await expect(scrollUntilVisible(fake, 'id:placeholder_screen', { maxSwipes: 0, settleMs: 0, fully: true })).rejects.toThrow(
      'element reached the viewport but stayed under container "!, Open debugger to view warnings." (10,787 382x49), drawn over it — 91% of it shows',
    );
    expect(await tapElement(fake, 'id:placeholder_screen', OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    expect(fake.tapPoints).toEqual([{ x: 201, y: 495 }]);
  });

  it('after the keyboard guard tapped a dismissal: the refusal says what was sent first', async () => {
    const fake = iosLoginFake({
      onTap: (id, self) => {
        if (id !== 'login_title') return;
        dropBand(self.live());
        self.live().children.push(node({ role: 'button', label: 'Pay', identifier: 'pay_bar', rect: { x: 0, y: 540, width: 402, height: 80 } }));
      },
    });
    fake.viewportSize = { width: 402, height: 874 };
    const error = await tapElement(fake, 'id:login_submit', { ...OPTS, dismissals: [{ kind: 'tap', target: { id: 'login_title' } }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoveredRefusal);
    expect((error as Error).message).toBe(
      'id:login_submit was not tapped: after id:"login_title" was tapped at (201,303) to hide the soft keyboard, it is under button "Pay" (0,540 402x80) ' +
        'at its centre (107,571), drawn over it; nothing of it shows — scroll_until it first',
    );
    expect(fake.taps).toEqual(['login_title']);
  });

  /** Android (1080x2220, the oracle): a 300-px row whose top 200 px lie under a bar laid after its list — its centre (540,1250) on the bar, a 100-px strip below. */
  const androidSheet = (band?: number) => {
    const fake = new FakeAdapter(
      {
        s: node({
          role: 'container',
          rect: { x: 0, y: 0, width: 1080, height: 2220 },
          children: [
            node({ role: 'container', rect: { x: 0, y: 0, width: 1080, height: 2220 }, clipsDescendants: true, children: [node({ role: 'button', identifier: 'row', rect: { x: 0, y: 1100, width: 1080, height: 300 } })] }),
            node({ role: 'button', label: 'Next', identifier: 'next', rect: { x: 0, y: 1100, width: 1080, height: 200 } }),
          ],
        }),
      },
      's',
    );
    fake.attachKeyboard(band === undefined ? { state: 'hidden' } : { state: 'shown', frame: { x: 0, y: band, width: 1080, height: 2220 - band } }, 'shown');
    return fake;
  };

  it('the keyboard is no cover node, but a piece under its band is not tapped: the band is read again only when the centre is covered, and cut away', async () => {
    const hidden = androidSheet();
    const events = recorded(hidden);
    const result = await tapElement(hidden, 'id:row', OPTS);
    expect(hidden.tapPoints).toEqual([{ x: 540, y: 1350 }]); // the strip's centre
    expect(events).toEqual(['read', 'read', 'keyboard?', 'tap:540,1350']); // the opening reading, asked again: nothing more on a hidden keyboard
    expect(result.moved).toBe('at (540,1350) — its centre (540,1250) is under button "Next" (0,1100 1080x200), drawn over it; tapped the uncovered part 1080x100');
    // The keyboard up from y 1350 — clear of the centre, so the guard lets it be — leaves 50 px of the strip: under the
    // 65-px minimum, refused; the band and the input method's word read once each.
    const up = androidSheet(1350);
    const upEvents = recorded(up);
    await expect(tapElement(up, 'id:row', OPTS)).rejects.toThrow(
      'id:row is under button "Next" (0,1100 1080x200) at its centre (540,1250), drawn over it; only a 1080x50 part of it shows above the soft keyboard, under the 65x65 a tap may be moved to',
    );
    expect(upEvents).toEqual(['read', 'read', 'keyboard?', 'touchable?', 'witness?']);
    // A witness that denies the band: not cut — the strip is tapped whole, as with no keyboard.
    const stale = androidSheet(1350);
    stale.attachedKeyboard.witnessAnswers.current = 'hidden';
    await tapElement(stale, 'id:row', OPTS);
    expect(stale.tapPoints).toEqual([{ x: 540, y: 1350 }]);
  });
});

/**
 * A Compose `Button`'s label under its own unlabelled clickable `button`, and a list row's label node under its avatar's
 * text (docs/bugs/2026-10-09-android-compose-button-text-refused-as-under-its-own-button.md, a regression of round 5's
 * C3): at 86eb42d these calls returned `Tapped text:"LOGIN"` and stopped `fully: true` on the row; at dd50327 the tap was
 * refused, `scroll_until` called the screen a layout defect, and `fully` never stopped.
 */
describe('a Compose label under its own control (2026-10-09)', () => {
  const OPTS = { ...REFUSE, timeoutMs: 60, pollMs: 2 };
  const compose = (xml: string) => {
    const fake = new FakeAdapter({ s: parseUiautomatorXml(xml) }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    return fake;
  };

  it.each([
    ['LOGIN', COMPOSE.login, { x: 540, y: 1463 }],
    ['SIGN IN', COMPOSE.signIn, { x: 541, y: 1869 }],
    ['DISCARD', COMPOSE.discard, { x: 776, y: 1253 }],
    ['No thanks', COMPOSE.noThanks, { x: 541, y: 2023 }],
  ])('tap text:"%s" presses the button at the text\'s centre, nothing said — as at 86eb42d', async (label, xml, centre) => {
    const fake = compose(xml);
    expect(await tapElement(fake, `text:"${label}"`, OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    expect(fake.tapPoints).toEqual([centre]);
  });

  it('scroll_until text:"SIGN IN" on a screen that does not scroll: visible after 0 swipes — no layout defect, no stroke', async () => {
    const fake = compose(COMPOSE.signIn);
    expect(await scrollUntilVisible(fake, 'text:"SIGN IN"', { maxSwipes: 2, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.swipes).toEqual([]);
  });

  it('Account Detail: `fully: true` stops on a row\'s label node with its avatar on it, no stroke spent; a row under the tab bar\'s host is still not tapped there', async () => {
    const fake = compose(COMPOSE.accountDetail);
    const label = 'label:"Loan repayment, 17.12.2025, +493.00 EUR"';
    expect(await scrollUntilVisible(fake, label, { maxSwipes: 2, settleMs: 0, fully: true })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(fake.swipes).toEqual([]);
    const under = await tapElement(fake, 'label:"Card payment, 15.12.2025, -12.00 EUR"', OPTS).catch((e: unknown) => e);
    expect(under).toBeInstanceOf(CoveredRefusal);
    expect(fake.tapPoints).toEqual([]);
  });

  /** A fake on one screen of the round-5 ui_snapshots (tests/fixtures/android-ui-snapshot-compose.json); its taps recorded by point (the snapshot's Compose nodes carry no ids for the fake to hit). */
  const snapshot = async (screen: string) => {
    const { screens } = JSON.parse(await readFile(new URL('../fixtures/android-ui-snapshot-compose.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> };
    // The root marked as the parser marks every uiautomator root since the snapshots were taken (types.ts#UiNode.paddedTouchTargets).
    const fake = new FakeAdapter({ s: { ...screens[screen], paddedTouchTargets: true } }, 's');
    fake.viewportSize = { width: 1080, height: 2220 };
    fake.tap = async (x, y) => {
      fake.tapPoints.push({ x, y });
    };
    return fake;
  };

  it.each([
    ['loggedOut', 'LOGIN', { x: 540, y: 1463 }],
    ['accountDetailTop', 'PAY', { x: 541, y: 716 }],
    ['accountDetailTop', 'PAY ME', { x: 224, y: 716 }],
    ['accountDetailTop', 'SCAN QR', { x: 857, y: 716 }],
    ['accountDetail', 'PAY', { x: 541, y: 292 }],
    ['contactsSyncPromo', 'No thanks', { x: 541, y: 2023 }],
    ['contactsSyncPromo', 'Sync device and SIM contacts', { x: 540, y: 1891 }],
    ['contactsCreateStaged', 'Save', { x: 828, y: 155 }],
    ['contactsCreateStaged', 'Add phone', { x: 236, y: 968 }],
    ['contactsCreateStaged', 'Add fields', { x: 288, y: 2130 }],
    ['contactsCreate', 'Add phone', { x: 236, y: 2114 }],
    // The ICON buttons: the label node under a control padded on all four sides (refused at 2f98900).
    ['contactsCreateStaged', 'Cancel', { x: 77, y: 154 }],
    ['contactsCreateStaged', 'More options', { x: 1003, y: 154 }],
    ['contactsCreateStaged', 'Delete', { x: 1014, y: 830 }],
    ['contactsCreate', 'Cancel', { x: 77, y: 154 }],
    ['contactsCreate', 'Delete', { x: 1014, y: 1976 }],
  ])('the real %s snapshot: tap text:"%s" lands on the text\'s centre, and scroll_until stops on it after 0 swipes', async (screen, label, centre) => {
    const fake = await snapshot(screen);
    expect(await scrollUntilVisible(fake, `text:"${label}"`, { maxSwipes: 2, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(await tapElement(fake, `text:"${label}"`, OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    expect([fake.tapPoints, fake.swipes]).toEqual([[centre], []]);
  });

  it('the real Account Detail snapshot: a row\'s label node clear of the tab bar is fully visible after 0 swipes; the row cut at the tab bar\'s top is tapped at its title\'s centre', async () => {
    const fake = await snapshot('accountDetail');
    expect(await scrollUntilVisible(fake, 'label:"Loan repayment, 04.01.2026, +91.00 EUR"', { maxSwipes: 2, settleMs: 0, fully: true })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    expect(await tapElement(fake, 'text:"+493"', OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
    expect([fake.tapPoints, fake.swipes]).toEqual([[{ x: 782, y: 1836 }], []]);
  });

  it('a classic View\'s pinned CTA over a text in the same layout (review of fix/r6) stays a cover: tap text:"Forgot password?" is refused, never pressing LOG IN; scroll_until to the terms under CONTINUE keeps the layout-defect diagnosis', async () => {
    const login = compose(CLASSIC_VIEWS.loginImeUp);
    await expect(tapElement(login, 'text:"Forgot password?"', OPTS)).rejects.toBeInstanceOf(CoveredRefusal);
    expect(login.tapPoints).toEqual([]);
    const terms = compose(CLASSIC_VIEWS.terms);
    await expect(scrollUntilVisible(terms, 'text:"By continuing you accept the terms"', { maxSwipes: 2, settleMs: 0 })).rejects.toThrow(
      /under button "CONTINUE" \(40,1960 1000x130\) at its centre \(540,2015\), drawn over it — 0% of it shows — and the content is exhausted.* a layout defect/,
    );
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

  it('Android nodes dumped clipped out of their scroll container (UiNode.clippedOut, 2026-10-09): the hint names the side and the way back; sides that disagree name both and no direction; one plain 0×0 match among them keeps the 0×0 hint', async () => {
    const zero = (clippedOut?: 'top' | 'bottom') => node({ role: 'text', label: 'Apps', rect: { x: 198, y: clippedOut === 'bottom' ? 2220 : 297, width: 126, height: 0 }, ...(clippedOut && { clippedOut }) });
    const hint = async (...matches: UiNode[]) => {
      resetLayout();
      const error = await resolveSettled(new FakeAdapter({ s: screen(...matches) }, 's'), 'text:"Apps"', { ...REFUSE, timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
      return (error as Error).message.split('\n')[1];
    };
    expect(await hint(zero('bottom'))).toBe('  (it matched only nodes clipped out below its scroll container (scrolled past it) — scroll_until it with direction: "down" first)');
    expect(await hint(zero('top'), zero('bottom'))).toBe('  (it matched only nodes clipped out above or below its scroll container — scroll_until it first)');
    expect(await hint(zero('top'), zero())).toBe(HINT.slice(1));
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

  it('review round 1 (2026-10-08): the turn after a fling is judged in EVERY box that counts — a target beyond the far edge one way up but clipped at both edges the other is not turned for', async () => {
    const rows = [0, 400, 800, 1200, 1600, 2000, 2400, 2950].map((y) => node({ role: 'text', rect: { x: 0, y, width: 852, height: 50 } }));
    const fake = ios(idbRoot(...rows, node({ role: 'button', identifier: 'go', rect: { x: 300, y: 900, width: 450, height: 40 } })), { width: 393, height: 852 });
    expect((await screenBox(fake, { tree: await fake.uiTree() })).boxes).toHaveLength(2);
    const swipe = fake.swipe.bind(fake);
    fake.swipe = async (from, to) => {
      await swipe(from, to);
      fake.live().children[8].rect = { x: -30, y: 100, width: 450, height: 40 }; // left edge cut: beyond it on 852x393, across both edges on 393x852
    };
    await scrollUntilVisible(fake, 'id:go', { direction: 'right', fully: true, maxSwipes: 2, settleMs: 0 }).catch(() => undefined);
    expect(fake.swipes).toHaveLength(2);
    for (const s of fake.swipes) expect(s.to.x).toBeLessThan(s.from.x); // content to the right both times: finger left, never turned
  });
});

/**
 * iOS's status band counts as OFF the screen for a tap (2026-10-09, the owner's decision on device check C3-1.3 of
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md): a plain `scroll_until` stopped with
 * `priority_select` at `24,-20` and the tap went to (201,6) — the status bar, which scrolled the form to its top.
 * The band is the top safe-area inset (interact/swipe.ts#iosStatusBand): 62 pt on the measured 402x874.
 */
describe('iOS\'s status band (2026-10-09)', () => {
  const OPTS = { ...REFUSE, timeoutMs: 60, pollMs: 2 };
  /** The SWIFT form as idb lists it (tests/fixtures/idb-swift-form-continue.json), `priority_select` at `y`, on `platform`. */
  const swiftForm = async (y: number, platform: 'ios' | 'android' = 'ios') => {
    const tree = parseIdbDescribeAll(await readFile(new URL('../fixtures/idb-swift-form-continue.json', import.meta.url), 'utf8'));
    tree.children.find((n) => n.identifier === 'swift_payment.form.priority_select')!.rect.y = y;
    const fake = new FakeAdapter({ form: tree }, 'form');
    fake.platform = platform;
    fake.keyboard = undefined;
    // What each adapter's viewport reports: the iOS adapter adds the band (adapters/ios-status-band.ts), Android none.
    fake.viewportSize = platform === 'ios' ? { width: 402, height: 874, statusBand: 62 } : { width: 402, height: 874 };
    return fake;
  };
  const PRIORITY = 'id:swift_payment.form.priority_select';

  it('the measured stop (24,-20, centre (201,6)): refused as under the status bar, nothing tapped', async () => {
    const fake = await swiftForm(-20);
    const error = await tapElement(fake, PRIORITY, OPTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OffScreenRefusal);
    expect((error as Error).message).toBe(
      `${PRIORITY} is under iOS's status bar at (201,6), in the top 62 pt of the screen, where a tap goes to the status bar ` +
        '(rect 24,-20 354x52) — if it lies in a scroll view, scroll_until it first, to move it out from under the bar; ' +
        'if not, no scroll moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap something else; nothing was tapped',
    );
    expect(fake.tapPoints).toEqual([]);
  });

  /**
   * The remedy as far as the tree knows it (code review of round 6, P1: a button pinned at the top was told to
   * `scroll_until it first`, which no scroll does). A WDA-shaped tree has ancestry: a button in no scroll view is
   * pinned there; one in a `scrollable` is scrolled out. idb's flat list has none, so it says both (above).
   */
  describe('the remedy says what can move it', () => {
    const pinnedAt = (inScrollView: boolean | 'webview') => {
      resetLayout();
      const close = node({ role: 'button', label: 'Close', identifier: 'close', rect: { x: 340, y: 14, width: 44, height: 40 } });
      const content = inScrollView ? node({ role: inScrollView === 'webview' ? 'webview' : 'scrollable', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [close] }) : close;
      const fake = new FakeAdapter({ s: node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [content] }) }, 's');
      fake.platform = 'ios';
      fake.keyboard = undefined;
      fake.viewportSize = { width: 402, height: 874, statusBand: 62 };
      return fake;
    };

    it('in no scroll view (a layout that ignores the safe area): pinned, no scroll_until offered — still refused, nothing tapped', async () => {
      const fake = pinnedAt(false);
      const error = await tapElement(fake, 'id:close', OPTS).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OffScreenRefusal);
      expect((error as Error).message).toBe(
        "id:close is under iOS's status bar at (362,34), in the top 62 pt of the screen, where a tap goes to the status bar (rect 340,14 44x40) — " +
          'it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar (a layout that ignores the safe area?) — fix the layout, or tap something else; nothing was tapped',
      );
      expect((error as Error).message).not.toContain('scroll_until');
      expect(fake.tapPoints).toEqual([]);
    });

    it('in a scroll view: scroll_until it out', async () => {
      const error = await tapElement(pinnedAt(true), 'id:close', OPTS).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OffScreenRefusal);
      expect((error as Error).message).toContain('(rect 340,14 44x40) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothing was tapped');
    });

    it('in a web view (a WKWebView\'s page scrolls): scroll_until it out, never "pinned"', async () => {
      const error = await tapElement(pinnedAt('webview'), 'id:close', OPTS).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(OffScreenRefusal);
      expect((error as Error).message).toContain('— it lies in a scroll view — scroll_until it first');
      expect((error as Error).message).not.toContain('pinned');
    });
  });

  it('the band\'s edge: a centre at y 61 is refused, at y 62 tapped', async () => {
    await expect(tapElement(await swiftForm(35), PRIORITY, OPTS)).rejects.toBeInstanceOf(OffScreenRefusal);
    const clear = await swiftForm(36);
    await tapElement(clear, PRIORITY, OPTS);
    expect(clear.tapPoints).toEqual([{ x: 201, y: 62 }]);
  });

  it('a moved tap never lands in the band: a row whose only uncovered piece lies in it is refused, not tapped there', async () => {
    // The row 30–100 (centre 65, below the band) under a bar laid after it at 62–100: the uncovered piece is 30–62, all band.
    const fake = await swiftForm(30);
    fake.live().children.push(node({ role: 'button', label: 'Banner', identifier: 'banner', rect: { x: 0, y: 62, width: 402, height: 40 } }));
    fake.live().children.find((n) => n.identifier === 'swift_payment.form.priority_select')!.rect.height = 70;
    const error = await tapElement(fake, PRIORITY, OPTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoveredRefusal);
    expect((error as Error).message).toContain('nothing of it shows');
    expect(fake.tapPoints).toEqual([]);
  });

  it('…and a piece below the band is aimed at instead of a larger one reaching into it: the band is cut before the largest piece is chosen', async () => {
    // The row 30–160 (centre 95) under a bar at 90–120: uncovered 30–90 (60 tall, its centre (201,60) in the band) and
    // 120–160 (40 tall). Less the band, 62–90 is 28 tall: the piece below the bar is the larger, and the tap goes there.
    const fake = await swiftForm(30);
    fake.live().children.find((n) => n.identifier === 'swift_payment.form.priority_select')!.rect.height = 130;
    fake.live().children.push(node({ role: 'button', label: 'Banner', identifier: 'banner', rect: { x: 0, y: 90, width: 402, height: 30 } }));
    const result = await tapElement(fake, PRIORITY, OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 140 }]);
    expect(result.moved).toContain('tapped the uncovered part 354x40');
  });

  it('Android is unaffected: its status bar lies outside the app\'s window — the same tree on an Android adapter is tapped at (201,6)', async () => {
    const fake = await swiftForm(-20, 'android');
    await tapElement(fake, PRIORITY, OPTS);
    expect(fake.tapPoints).toEqual([{ x: 201, y: 6 }]);
  });

  it('the band by the screen\'s size, held upright: measured 62 on 402x874, published insets elsewhere, 20 on a size not in the table (the iPhone Air, an iPad)', () => {
    expect([iosStatusBand({ width: 402, height: 874 }), iosStatusBand({ width: 874, height: 402 }), iosStatusBand({ width: 393, height: 852 }), iosStatusBand({ width: 375, height: 667 })]).toEqual([62, 62, 59, 20]);
    expect([iosStatusBand({ width: 420, height: 912 }), iosStatusBand({ width: 1024, height: 1366 })]).toEqual([IOS_MIN_STATUS_BAND, IOS_MIN_STATUS_BAND]);
  });

  it('screenBox carries the device\'s band, and only the device\'s: none when the size could not be read and the tree\'s window stands in', async () => {
    const fake = await swiftForm(771);
    expect((await screenBox(fake, { tree: undefined })).statusBand).toBe(62);
    const unread = await swiftForm(771);
    unread.viewport = async () => {
      throw new Error('idb describe returned no screen_dimensions');
    };
    const window = node({ role: 'container', rect: { x: 0, y: 0, width: 402, height: 874 }, children: [node({ role: 'other', rect: { x: 0, y: 0, width: 402, height: 874 } })] });
    const judged = await screenBox(unread, { tree: window });
    expect(judged.box).toEqual({ x: 0, y: 0, width: 402, height: 874 });
    expect(judged.statusBand).toBeUndefined();
  });

  it('a landscape box is not cut: on a screen held sideways a centre at y 30 is tapped (an iPhone hides its status bar there)', async () => {
    resetLayout();
    const row = node({ role: 'button', identifier: 'row', rect: { x: 300, y: 10, width: 200, height: 40 } });
    const fake = new FakeAdapter({ s: node({ role: 'other', rect: { x: 0, y: 0, width: 874, height: 402 }, children: [row] }) }, 's');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874, statusBand: 62 };
    expect((await screenBox(fake, { tree: await fake.uiTree() })).boxes).toEqual([{ x: 0, y: 0, width: 874, height: 402 }]);
    await tapElement(fake, 'id:row', OPTS);
    expect(fake.tapPoints).toEqual([{ x: 400, y: 30 }]);
  });
});

/**
 * idb's flat list, chrome before content (2026-10-09, device check C3-3 of
 * docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md): at six scroll positions of the SWIFT form the
 * interim rule refused `tap id:BackButton` at positions 2, 4 and 6 and the title at 4 — a row scrolled under the opaque
 * bar, listed after it, read as drawn over it. The dumps: tests/fixtures/idb-swift-form-scrolled-under-top-bar.json.
 */
describe('idb, rows scrolled under the top bar — the six measured positions (2026-10-09)', async () => {
  const fixture = JSON.parse(await readFile(new URL('../fixtures/idb-swift-form-scrolled-under-top-bar.json', import.meta.url), 'utf8')) as {
    positions: Record<string, unknown[]>;
  };
  const OPTS = { ...REFUSE, timeoutMs: 60, pollMs: 2 };

  it.each(Object.keys(fixture.positions))('%s: tap Back and the title — both tapped at their centres, nothing said; scroll_until stops on them at once', async (pos) => {
    const fake = new FakeAdapter({ form: parseIdbDescribeAll(JSON.stringify(fixture.positions[pos])) }, 'form');
    fake.platform = 'ios';
    fake.keyboard = undefined;
    fake.viewportSize = { width: 402, height: 874 };
    for (const selector of ['id:BackButton', 'id:swift_payment.form.title']) {
      expect(await tapElement(fake, selector, OPTS)).toEqual({ note: undefined, keyboardHidden: undefined, moved: undefined });
      expect(await scrollUntilVisible(fake, selector, { maxSwipes: 0, settleMs: 0 })).toEqual({ swipes: 0, visible: 1, clipped: [] });
    }
    expect(fake.tapPoints).toEqual([{ x: 44, y: 84 }, { x: 201, y: 84 }]);
  });
});
