import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillField } from '../../src/interact/fill.js';
import { fillReply } from '../../src/interact/fill-text.js';
import { tapElement } from '../../src/interact/tap.js';
import { parseUiautomatorXml } from '../../src/adapters/android-tree-dialect.js';
import { parseDump, UIAUTOMATOR_XML } from '../helpers/android-dumps.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { findAll } from '../../src/ui-tree/selectors.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { resolveSettled } from '../../src/interact/resolve.js';
import { FakeAdapter } from '../helpers/fake.js';
import { resetSleeps } from '../helpers/sleep-recorder.js';
import { NO_EYES } from '../helpers/eyes.js';

// The one sleep owner (util/sleep.ts) is recorded, not waited on (tests/helpers/sleep-recorder.ts): the scroll and fill
// plays below cost no wall clock (T1).
vi.mock('../../src/util/sleep.js', () => import('../helpers/sleep-recorder.js'));
beforeEach(() => {
  resetSleeps();
});

/** A fill's options in these tests: the settle's and the value poll's cadence short, the fill's own rules as they are. */
const FILL = { ambiguous: 'first' as const, timeoutMs: 200, pollMs: 2 };

/**
 * One Android field (`id:f`) behind fillField, every tree read a fresh parse of its dump (the parser is the seam: base
 * trimmed `Jan ` to `Jan`): it holds `start`, shows `hint` named as its hint, keeps `keep(typed, nth)` of each typing
 * and loses one character a delete; a focus tap makes it hold `onFocus` when given. Its typing may arrive late, as
 * AndroidAdapter's does — no dropped tail is typed again, and a sole `id` skips the post-focus re-read (ADR 0028).
 */
function androidField(start: string, opts: { hint?: string; keep?: (typed: string, nth: number) => string; onFocus?: string } = {}) {
  let held = start;
  const hint = opts.hint === undefined ? '' : ` hint="${opts.hint}"`;
  const dump = () =>
    parseDump(`<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"><node class="android.widget.EditText" resource-id="app:id/f" text="${held}"${hint} password="false" bounds="[0,100][1080,220]" /></node></hierarchy>`);
  const fake = new FakeAdapter({ form: dump() }, 'form', () => {
    if (opts.onFocus !== undefined) held = opts.onFocus;
  });
  fake.typingDelivery = 'may-arrive-late';
  fake.uiTree = async () => dump();
  let nth = 0;
  fake.typeText = async (text) => {
    fake.typed.push(text);
    held += (opts.keep ?? ((t) => t))(text, nth++);
  };
  fake.clearText = async (count) => {
    fake.deletes.push(count);
    held = held.slice(0, Math.max(0, held.length - count));
  };
  return { fake, held: () => held };
}

describe('parseUiautomatorXml', () => {
  const tree = parseDump(UIAUTOMATOR_XML.slice(0, UIAUTOMATOR_XML.lastIndexOf('>') + 1));

  // D72: a text input's value keeps its outer spaces, as the app holds them (iOS's too, ios-node.ts), and so does a
  // hint; what names a node — its label, content-desc, resource-id — is trimmed as before, so matching through the
  // label is unchanged, while the `value` path (`value:`, and `text:`, which asks the value too) sees the real text.
  describe("a value's outer spaces (D72)", () => {
    it('an EditText holding `Jan ` reads value `Jan `, labelled `Jan`', () => {
      const field = parseDump('<hierarchy><node class="android.widget.EditText" text="Jan " bounds="[0,0][100,100]" /></hierarchy>');
      expect(field).toMatchObject({ role: 'textfield', value: 'Jan ', label: 'Jan' });
    });

    it('a Compose input (a focusable, long-clickable scroll view) holding `Jan ` reads value `Jan `, labelled `Jan`', () => {
      const field = parseDump('<hierarchy><node class="android.widget.HorizontalScrollView" focusable="true" long-clickable="true" text="Jan " bounds="[0,0][100,100]" /></hierarchy>');
      expect(field).toMatchObject({ role: 'textfield', value: 'Jan ', label: 'Jan' });
    });

    it('a label drawn from text, a content-desc and a resource-id are trimmed as before', () => {
      const tree = parseDump(`<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
        <node class="android.widget.TextView" text=" Close " bounds="[0,0][100,100]" />
        <node class="android.widget.Button" content-desc=" Send " resource-id=" app:id/send " bounds="[0,100][100,200]" />
      </node></hierarchy>`);
      expect(tree.children[0]).toMatchObject({ label: 'Close', value: null });
      expect(tree.children[1]).toMatchObject({ label: 'Send', identifier: 'send' });
    });

    it('an input holding only spaces keeps them as its value, and has no label', () => {
      const field = parseDump('<hierarchy><node class="android.widget.EditText" text="  " bounds="[0,0][100,100]" /></hierarchy>');
      expect(field).toMatchObject({ value: '  ', label: null });
    });

    it('a newline at the edge, written `&#10;`, still decodes and stays, in a value and in a label', () => {
      const tree = parseDump(`<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
        <node class="android.widget.EditText" text="Jan&#10; " bounds="[0,0][100,100]" />
        <node class="android.widget.Button" content-desc=" &#10;Send " bounds="[0,100][100,200]" />
      </node></hierarchy>`);
      expect(tree.children[0]).toMatchObject({ value: 'Jan\n ', label: 'Jan\n' });
      expect(tree.children[1]).toMatchObject({ label: '\nSend' });
    });

    it('fillField with clear, `Jan ` of `Jan Novak` landed: the wipe deletes 4, not 3, and the retype lands', async () => {
      const { fake, held } = androidField('', { keep: (text, nth) => (nth === 0 ? text.slice(0, 4) : text) });
      const result = await fillField(fake, 'id:f', 'Jan Novak', { ...FILL, clear: true });
      expect(fake.deletes).toEqual([4]);
      expect(fake.typed).toEqual(['Jan Novak', 'Jan Novak']);
      expect(result.readBack).toEqual({ kind: 'landed' });
      expect(fillReply(result, 'id:f')).toBe('Filled id:f (9 characters)');
      expect(held()).toBe('Jan Novak'); // base: `JJan Novak`
    });

    // Review round 1, MAJOR-1: matching through the LABEL is unchanged; the `value` path sees the field's real text, as
    // on iOS — a flow that matched a trimmed Android value quotes the space or uses `~`.
    it('an input named by its content-desc: `text:"Jan"` no longer matches its value, `text:"Jan "` and `value:"Jan "` do', () => {
      const tree = parseDump('<hierarchy><node class="android.widget.EditText" content-desc="First name" text="Jan " bounds="[0,0][100,100]" /></hierarchy>');
      expect(findAll(tree, 'text:"Jan"')).toHaveLength(0);
      expect(findAll(tree, 'text:"Jan "')).toHaveLength(1);
      expect(findAll(tree, 'value:"Jan "')).toHaveLength(1);
      expect(findAll(tree, 'value:Jan')).toHaveLength(0);
      expect(findAll(tree, 'value~^Jan$')).toHaveLength(0);
    });

    it('an input with no content-desc still matches `text:Jan` through its label', () => {
      const tree = parseDump('<hierarchy><node class="android.widget.EditText" text="Jan " bounds="[0,0][100,100]" /></hierarchy>');
      expect(findAll(tree, 'text:Jan')).toHaveLength(1);
    });

    // Review round 1, MINOR-1: a hint is the same kind of string as text, compared with a reading exactly — kept untrimmed,
    // so an empty field showing `Name ` reads empty, not as 5 characters to clear.
    it('an empty input whose dump names `hint="Name "` and shows it as `text="Name "` reads empty: a clear deletes nothing', async () => {
      const { fake } = androidField('Name ', { hint: 'Name ' });
      expect((await fake.uiTree()).children[0].placeholder).toBe('Name ');
      const result = await fillField(fake, 'id:f', '', { ...FILL, clear: true });
      expect(fake.deletes).toEqual([]);
      expect(result).toMatchObject({ cleared: 0, clearPlaceholder: 'shown', readBack: { kind: 'nothing-typed' } });
    });

    // After D71 (ADR 0034's D71 amendment), with D72's readings: no clear, the field already holding `held`, `value` typed,
    // the field keeping `keep` of it (its first keys dropped) — every reading through the dump's parser, the fill as
    // fillField drives it on Android (a sole `id`, a typing that may arrive late: the post-focus re-read skipped).
    const typedOver = async (start: string, value: string, keep: (typed: string) => string) => {
      const { fake, held } = androidField(start, { keep });
      return { result: await fillField(fake, 'id:f', value, FILL), held };
    };

    it('D71: `1 ` typed after `1` without clear, the `1` dropped, reads `1 ` — refused with the select-all hedge, never Filled', async () => {
      await expect(typedOver('1', '1 ', (t) => t.slice(1)).then(({ result }) => result)).rejects.toThrow(
        'fill: typed 2 characters but the field shows only the typed text, where an append would show 3 — the field may have replaced its text (select-all): fill with `clear: true` (content withheld from this error)',
      );
    });

    it('`Jan ` appended to `Jan` without clear lands (`JanJan `)', async () => {
      const { result, held } = await typedOver('Jan', 'Jan ', (t) => t);
      expect(fillReply(result, 'id:f')).toBe('Filled id:f (4 characters)');
      expect(held()).toBe('JanJan ');
    });

    it('`Jan ` typed after `Jan ` without clear, no key landing, still lands — ADR 0034 residual 7, the value already shown', async () => {
      const { result, held } = await typedOver('Jan ', 'Jan ', () => '');
      expect(fillReply(result, 'id:f')).toBe('Filled id:f (4 characters)');
      expect(held()).toBe('Jan ');
    });

    it('the clear of a field holding `Jan ` deletes 4', async () => {
      const { fake, held } = androidField('Jan ');
      await fillField(fake, 'id:f', '', { ...FILL, clear: true });
      expect(fake.deletes).toEqual([4]);
      expect(held()).toBe('');
    });
  });

  // D64b-3 (ADR 0028's amendment), re-pinned by D72: the parser no longer trims a value's outer spaces, so the ⚠ line
  // counts what the app holds (5, where it counted 4), and a typed `+421` over an inserted `+421 ` is no longer silent.
  // The field is empty before the tap, the focus inserts `+421 `, the typing takes none of the keys; the post-focus
  // re-read is skipped (a sole `id`, Android's late typing), so the reading is `+421 `.
  describe('a field holding `+421 `, the re-read skipped: the reading is `+421 `', () => {
    const fillDial = async (value: string) => {
      const { fake } = androidField('', { onFocus: '+421 ', keep: () => '' });
      return fillField(fake, 'id:f', value, FILL);
    };

    it('`421` typed: the line says 5 characters, as the app holds', async () => {
      const result = await fillDial('421');
      expect(result.focusUnread).toEqual({ shows: 5 });
      expect(fillReply(result, 'id:dial')).toContain('\n⚠ the field shows 5 characters for the 3 typed,');
    });

    it('`+421` typed: the reading is not the value typed, so the ⚠ line, where it was silent (ADR 0028 residual 3, D72)', async () => {
      const result = await fillDial('+421');
      expect(result.focusUnread).toEqual({ shows: 5 });
      expect(fillReply(result, 'id:dial')).toContain('\n⚠ the field shows 5 characters for the 4 typed,');
    });
  });

  it('normalizes roles, identifiers, labels and bounds', () => {
    expect(tree.role).toBe('container');
    const keyboard = tree.children[0];
    expect(keyboard.identifier).toBe('pin_keyboard');
    expect(keyboard.label).toBe('PIN keyboard');
    expect(keyboard.children[0]).toMatchObject({
      role: 'button', identifier: 'pin_key_1', label: '1',
      rect: { x: 0, y: 1200, width: 360, height: 300 },
    });
  });

  it("marks the root with the source's dialect: it cuts a node's bounds at the screen's edge (`boundsCutAtScreen`, D17) — one window or several", () => {
    expect(tree.boundsCutAtScreen).toBe(true);
    const two = parseDump('<hierarchy><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]" /><node class="android.widget.FrameLayout" bounds="[0,1500][1080,2220]" /></hierarchy>');
    expect(two.boundsCutAtScreen).toBe(true);
  });

  it('exposes EditText text as value', () => {
    const username = tree.children[1];
    expect(username).toMatchObject({
      role: 'textfield', identifier: 'username_field', value: 'user@bank.md',
    });
  });

  it('maps TextView to text with a null identifier for empty resource-id', () => {
    expect(tree.children[2]).toMatchObject({ role: 'text', label: 'Log in', identifier: null });
  });

  it('recognizes Compose text inputs dumped as focusable+long-clickable scroll views', () => {
    // Measured 2026-08-05: the login username field dumps as
    // HorizontalScrollView with the content in `text` — no EditText anywhere.
    const composeXml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="app" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="Martha.Key" resource-id="app:id/login.username.input" class="android.widget.HorizontalScrollView" package="app" content-desc="" focusable="true" long-clickable="true" bounds="[44,511][1036,654]"/>
    <node index="1" text="" resource-id="app:id/real_scroller" class="android.widget.HorizontalScrollView" package="app" content-desc="" focusable="false" long-clickable="false" scrollable="true" bounds="[0,700][1080,900]"/>
  </node>
</hierarchy>`;
    const t = parseDump(composeXml);
    expect(t.children[0]).toMatchObject({
      role: 'textfield',
      identifier: 'login.username.input',
      value: 'Martha.Key',
    });
    expect(t.children[1]).toMatchObject({ role: 'scrollable', value: null });
  });

  it('marks a node uiautomator dumps scrollable="true" as clipping its descendants — a Compose scroller keeps its role (container), only the flag says it scrolls; scrollable="false" and absent are not marked', () => {
    // 2026-10-09, docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md: the SWIFT form's scroller.
    const t = parseDump(`<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" scrollable="true" bounds="[0,242][1080,1978]">
    <node class="android.view.View" resource-id="app:id/fees_select" bounds="[66,242][1014,334]" />
  </node>
  <node class="androidx.recyclerview.widget.RecyclerView" scrollable="false" bounds="[0,1979][1080,2111]"><node class="android.widget.TextView" text="x" bounds="[0,1979][100,2000]" /></node>
</node>
</hierarchy>`);
    expect(t.children[0]).toMatchObject({ role: 'container', clipsDescendants: true });
    expect(t.children[0].children[0].clipsDescendants).toBeUndefined();
    expect(t.children[1].clipsDescendants).toBeUndefined();
    expect('clipsDescendants' in t).toBe(false); // absent, not false: ui_snapshot prints the tree as JSON
  });
});

describe('parseUiautomatorXml — a node cut short of its own descendants is widened to them (docs/bugs/2026-10-09-android-fully-trusts-row-bounds-cut-at-a-sticky-header.md)', () => {
  // The measured Account Detail shape (run9-android, 5e5a3d1, after the second drag): row_0's testTag node cut at its sticky
  // date header's bottom (480) to 66,480 948x66, its own label and button the true rect 66,403 948x143, the header listed after
  // the rows inside the scrolling list.
  const ACCOUNT_DETAIL = `<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" resource-id="transactions.list.container" scrollable="true" bounds="[0,401][1080,2154]">
    <node class="android.view.View" resource-id="transactions.list.row_0" bounds="[66,480][1014,546]">
      <node class="android.view.View" content-desc="Loan repayment, 17.07.2026, +602.00 EUR" bounds="[66,403][1014,546]" />
      <node class="android.view.View" bounds="[116,480][204,552]"><node class="android.widget.TextView" text="LR" bounds="[136,484][184,533]" /></node>
      <node class="android.widget.Button" bounds="[66,403][1014,546]" />
    </node>
    <node class="android.view.View" resource-id="transactions.list.row_1" bounds="[66,592][1014,735]">
      <node class="android.view.View" content-desc="Loan repayment, 16.07.2026, +250.00 EUR" bounds="[66,592][1014,735]" />
      <node class="android.widget.Button" bounds="[66,592][1014,735]" />
    </node>
    <node class="android.view.View" resource-id="transactions.list.date_header_0" bounds="[0,401][1080,480]">
      <node class="android.widget.TextView" text="17.07.2026" bounds="[66,415][286,465]" />
    </node>
  </node>
</node>
</hierarchy>`;
  const tree = parseDump(ACCOUNT_DETAIL);
  const byIdIn = (t: UiNode, id: string) => [...everyNode(t)].find((n) => n.identifier === id)!;
  const byId = (id: string) => byIdIn(tree, id);
  const PIXEL = { x: 0, y: 0, width: 1080, height: 2220 };

  it('row_0 reads its descendants\' union, the dumped bounds kept as cutBounds; a whole row and the header are left as dumped', () => {
    expect(byId('transactions.list.row_0')).toMatchObject({ rect: { x: 66, y: 403, width: 948, height: 143 }, cutBounds: { x: 66, y: 480, width: 948, height: 66 } });
    expect(byId('transactions.list.row_1').rect).toEqual({ x: 66, y: 592, width: 948, height: 143 });
    expect(byId('transactions.list.row_1')).not.toHaveProperty('cutBounds');
    expect(byId('transactions.list.date_header_0')).not.toHaveProperty('cutBounds');
    expect([...everyNode(tree)].filter((n) => 'cutBounds' in n)).toHaveLength(1); // absent, not undefined: ui_snapshot prints the tree as JSON
  });

  it('…so the row reads under the header drawn after it: 66 of its 143 px show', () => {
    const seen = drawOrder(tree).exposure(byId('transactions.list.row_0'), PIXEL);
    expect(seen.covers.map(({ node: c }) => c.identifier)).toContain('transactions.list.date_header_0');
    expect(seen.shows).toBeCloseTo(66 / 143, 9);
  });

  it('…and `scroll_until id:row_0 fully` turns at once (the label selector\'s measured stroke, content down) instead of "fully visible after 0 swipes"', async () => {
    const fake = new FakeAdapter({ list: tree }, 'list');
    const outcome = await scrollUntilVisible(fake, 'id:transactions.list.row_0', { eyes: NO_EYES, fully: true, maxSwipes: 1, timeoutMs: 2_000, settleMs: 1 }).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(Error);
    expect(fake.swipes).toHaveLength(1);
    expect(fake.swipes[0].to.y).toBeGreaterThan(fake.swipes[0].from.y);
  });

  it('a tap on the widened row aims at the part clear of the header (66 px), and is refused when what shows is under the minimum tap piece (a 30-px strip) — before, it tapped the strip that showed', async () => {
    const fake = new FakeAdapter({ list: tree }, 'list');
    await tapElement(fake, 'id:transactions.list.row_0', { eyes: NO_EYES, ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 });
    expect(fake.taps).toHaveLength(1);
    const thin = parseDump(ACCOUNT_DETAIL.replace('bounds="[66,480][1014,546]"', 'bounds="[66,516][1014,546]"').replace('[0,401][1080,480]', '[0,401][1080,516]'));
    expect(byIdIn(thin, 'transactions.list.row_0').rect).toEqual({ x: 66, y: 403, width: 948, height: 143 });
    const refused = new FakeAdapter({ list: thin }, 'list');
    const error = await tapElement(refused, 'id:transactions.list.row_0', { eyes: NO_EYES, ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('date_header_0');
    expect(refused.taps).toEqual([]);
  });

  /** A list holding `rows`, and — when `overlay` — a bar listed after it over the whole list, drawing (it says something), as a sticky header or a tab bar is drawn over the rows it cuts. */
  const listOf = (rows: string, overlay: boolean) =>
    parseDump(`<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">${rows}</node>
  <node class="android.view.View" resource-id="unscrolled" bounds="[66,2100][1014,2150]"><node class="android.widget.Button" bounds="[66,2050][1014,2150]" /></node>
  ${overlay ? '<node class="android.view.View" resource-id="overlay" content-desc="Header" bounds="[0,400][1080,2000]" />' : ''}
</node>
</hierarchy>`);
  const ROWS = `
    <node class="android.view.View" resource-id="cut_row" bounds="[66,1500][1014,1550]"><node class="android.widget.Button" bounds="[66,1450][1014,1550]" /></node>
    <node class="android.view.View" resource-id="badge_row" bounds="[66,500][1014,600]"><node class="android.widget.TextView" text="badge" bounds="[900,470][1000,530]" /></node>
    <node class="android.view.View" resource-id="wider_row" bounds="[66,700][1014,760]"><node class="android.widget.Button" bounds="[0,680][1080,760]" /></node>
    <node class="android.view.View" resource-id="both_sides" bounds="[66,1200][1014,1300]"><node class="android.widget.Button" bounds="[66,1190][1014,1310]" /></node>
    <node class="android.view.View" resource-id="edge_row" bounds="[66,1950][1014,2000]"><node class="android.widget.Button" bounds="[66,1950][1014,2093]" /></node>
    <node class="android.view.View" resource-id="overhang" bounds="[0,1900][1080,2060]"><node class="android.widget.Button" bounds="[0,1850][1080,2060]" /></node>
    <node class="android.view.View" resource-id="top_edge_row" bounds="[0,400][1080,450]"><node class="android.widget.Button" bounds="[0,400][1080,450]" /></node>
    <node class="android.view.View" resource-id="top_cut_row" bounds="[66,430][1014,470]"><node class="android.widget.Button" bounds="[66,380][1014,470]" /></node>
    <node class="android.view.View" resource-id="collapsed" bounds="[66,1000][66,1000]"><node class="android.widget.Button" bounds="[66,1000][1014,1100]" /></node>`;

  it('under a node drawn after it: a row whose own button has its exact x and width and reaches past ONE edge is widened along y — no other shape is', () => {
    const t = listOf(ROWS, true);
    const of = (id: string) => [...everyNode(t)].find((n) => n.identifier === id)!;
    expect(of('cut_row')).toMatchObject({ rect: { x: 66, y: 1450, width: 948, height: 100 }, cutBounds: { x: 66, y: 1500, width: 948, height: 50 } });
    expect(of('badge_row')).not.toHaveProperty('cutBounds'); // a badge hanging off it
    expect(of('wider_row')).not.toHaveProperty('cutBounds'); // a full-bleed child: not its exact x and width (code review P1)
    expect(of('wider_row').rect).toEqual({ x: 66, y: 700, width: 948, height: 60 });
    expect(of('both_sides')).not.toHaveProperty('cutBounds'); // past both edges: overflow, not a cut (code review P3)
    expect(of('edge_row')).not.toHaveProperty('cutBounds'); // past the list's edge only: the flush probe's case
    expect(of('collapsed')).not.toHaveProperty('cutBounds');
    expect(of('unscrolled')).not.toHaveProperty('cutBounds'); // in no scroll container
    expect(of('top_edge_row')).not.toHaveProperty('cutBounds');
    // The gained TOP strip is cut at the list's top edge (400): its button dumped from 380 reaches no higher.
    expect(of('top_cut_row')).toMatchObject({ rect: { x: 66, y: 400, width: 948, height: 70 }, cutBounds: { x: 66, y: 430, width: 948, height: 40 } });
    // What is gained is cut to the list; what was dumped past it stays: grown up to 1850, its bottom kept at 2060.
    expect(of('overhang')).toMatchObject({ rect: { x: 0, y: 1850, width: 1080, height: 210 }, cutBounds: { x: 0, y: 1900, width: 1080, height: 160 } });
  });

  it('…and with nothing listed after it on the strip gained, not even that row: its own overflow, not an overlay\'s cut (code review P3)', () => {
    expect([...everyNode(listOf(ROWS, false))].filter((n) => 'cutBounds' in n)).toEqual([]);
  });

  /** One row of a list cut 50 px short of its own button's bottom (1550 of 1600), and `after` listed after the list. */
  const rowWith = (inList: string, after: string) =>
    parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">
 <node class="android.view.View" resource-id="row" bounds="[66,1500][1014,1550]"><node class="android.widget.Button" bounds="[66,1500][1014,1600]" /></node>${inList}
</node>${after}
</node></hierarchy>`);
  const rowOf = (t: UiNode) => [...everyNode(t)].find((n) => n.identifier === 'row')!;

  it('the parser widens only where the draw order says something is drawn over the strip: a screen-sized snackbar host listed after the list, its snackbar elsewhere, draws nothing there — the row stays as dumped and ui_snapshot shows no cutBounds', () => {
    const t = rowWith('', `<node class="android.view.View" resource-id="host" bounds="[0,0][1080,2220]"><node class="android.view.View" resource-id="snack" content-desc="Saved" bounds="[30,2050][1050,2180]" /></node>`);
    expect(rowOf(t).rect).toEqual({ x: 66, y: 1500, width: 948, height: 50 });
    expect(rowOf(t)).not.toHaveProperty('cutBounds');
  });

  it('…nor a bare structural overlay (childless, nothing said, no id) — and the same overlay saying something, or a host whose tab lies on the strip, still widens it', () => {
    expect(rowOf(rowWith('', '<node class="android.view.View" bounds="[0,1540][1080,2000]" />'))).not.toHaveProperty('cutBounds');
    expect(rowOf(rowWith('', '<node class="android.view.View" resource-id="overlay" content-desc="Banner" bounds="[0,1540][1080,2000]" />'))).toHaveProperty('cutBounds');
    const tabHost = '<node class="android.view.View" bounds="[0,0][1080,2220]"><node class="android.view.View" resource-id="tabs" bounds="[66,1550][1014,1800]"><node class="android.view.View" content-desc="Home" bounds="[100,1560][300,1700]" /></node></node>';
    expect(rowOf(rowWith('', tabHost))).toMatchObject({ rect: { x: 66, y: 1500, width: 948, height: 100 }, cutBounds: { x: 66, y: 1500, width: 948, height: 50 } });
  });

  it('a bare overlay the app NAMED (only an id), in a classic run listed in location order (the root: the list, then the overlay, one left edge, the higher top first — marked readingOrder, D75): drawn, as LR3 has it under WDA, so the row widens', () => {
    const t = rowWith('', '<node class="android.view.View" resource-id="overlay" bounds="[0,1540][1080,2000]" />');
    expect(t.readingOrder).toBe(true);
    expect(rowOf(t)).toHaveProperty('cutBounds');
  });

  it('every target-column excuse applies, those measured on iOS too: a childless full-screen scrim listed after the list widens nothing, nor a classic list sheet (a RecyclerView) whose rows lie on the strip — its rows are another scroller\'s content, its frame no surface', () => {
    expect(rowOf(rowWith('', '<node class="android.view.View" resource-id="scrim" bounds="[0,0][1080,2220]" />'))).not.toHaveProperty('cutBounds');
    const sheet = `<node class="androidx.recyclerview.widget.RecyclerView" resource-id="sheet" scrollable="false" bounds="[0,1520][1080,2220]">
  <node class="android.widget.TextView" resource-id="sheet_row" text="Share" bounds="[0,1540][1080,1700]" />
</node>`;
    expect(rowOf(rowWith('', sheet))).not.toHaveProperty('cutBounds');
  });

  it('…unless the sheet lies in a LATER stacked screen: the same RecyclerView sheet wrapped in a full-screen layer, over a list in the screen\'s own full-screen layer, widens the row (draw-order.ts\'s scrolledContent row)', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" bounds="[0,0][1080,2220]">
 <node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">
  <node class="android.view.View" resource-id="row" bounds="[66,1500][1014,1550]"><node class="android.widget.Button" bounds="[66,1500][1014,1600]" /></node>
 </node>
</node>
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
 <node class="androidx.recyclerview.widget.RecyclerView" resource-id="sheet" scrollable="false" bounds="[0,1520][1080,2220]">
  <node class="android.widget.TextView" resource-id="sheet_row" text="Share" bounds="[0,1540][1080,1700]" />
 </node>
</node>
</node></hierarchy>`);
    expect(rowOf(t)).toMatchObject({ rect: { x: 66, y: 1500, width: 948, height: 100 }, cutBounds: { x: 66, y: 1500, width: 948, height: 50 } });
  });

  it('the strip is judged with the dump\'s mark in place (paddedTouchTargets): a label cut short of its text whose own icon button, padded evenly in their wrapper and centred on it, lies on the strip is not widened under its own control', () => {
    const t = rowWith(`
 <node class="android.view.View" resource-id="wrapper" bounds="[100,1000][400,1300]">
  <node class="android.view.View" resource-id="label" bounds="[150,1100][350,1200]"><node class="android.widget.TextView" text="Edit" bounds="[150,1050][350,1200]" /></node>
  <node class="android.widget.Button" bounds="[150,1050][350,1250]" />
 </node>`, '');
    expect([...everyNode(t)].find((n) => n.identifier === 'label')).not.toHaveProperty('cutBounds');
  });

  it('the residual, pinned (permanent): the NEXT row of the same list, listed after the row and lying on the strip its touch target overflows into, is drawn there exactly as a sticky header is — the row is widened as if cut', () => {
    const t = rowWith('<node class="android.view.View" resource-id="next" content-desc="Next" bounds="[66,1550][1014,1700]" />', '');
    expect(rowOf(t)).toMatchObject({ rect: { x: 66, y: 1500, width: 948, height: 100 }, cutBounds: { x: 66, y: 1500, width: 948, height: 50 } });
  });

  it('the parser asks the port it is handed, once per dump, with the tree as read and each candidate\'s gained strip — and widens exactly where it answers yes', () => {
    const xml = `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">
 <node class="android.view.View" resource-id="row" bounds="[66,1500][1014,1550]"><node class="android.widget.Button" bounds="[66,1500][1014,1600]" /></node>
</node></node></hierarchy>`;
    const asked: { root: UiNode; node: string | null; strip: Rect }[] = [];
    const marked: (true | undefined)[] = [];
    const judge = (answer: boolean) => (root: UiNode) => {
      marked.push(root.paddedTouchTargets);
      return (node: UiNode, strip: Rect) => {
        asked.push({ root, node: node.identifier, strip });
        return answer;
      };
    };
    const no = parseUiautomatorXml(xml, judge(false));
    expect(rowOf(no)).not.toHaveProperty('cutBounds');
    expect(asked).toEqual([{ root: no, node: 'row', strip: { x: 66, y: 1550, width: 948, height: 50 } }]);
    expect(rowOf(parseUiautomatorXml(xml, judge(true)))).toHaveProperty('cutBounds');
    expect(marked).toEqual([true, true]); // one tree per dump, the root's mark set before the judge reads it
  });

  it('the residual, pinned (review round 2): a card cut at BOTH ends — between the sticky header and the floating tab bar, dumped 66,480 948x1360 over its own 66,420 948x1480 — is not widened and reads whole', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" scrollable="true" bounds="[0,401][1080,2154]">
 <node class="android.view.View" resource-id="card" bounds="[66,480][1014,1840]"><node class="android.widget.Button" bounds="[66,420][1014,1900]" /></node>
 <node class="android.view.View" resource-id="date_header_0" bounds="[0,401][1080,480]" />
</node>
<node class="android.view.View" resource-id="tab_bar_host" bounds="[66,1840][1014,2088]" />
</node></hierarchy>`);
    const card = [...everyNode(t)].find((n) => n.identifier === 'card')!;
    expect(card.rect).toEqual({ x: 66, y: 480, width: 948, height: 1360 });
    expect(card).not.toHaveProperty('cutBounds');
    expect(drawOrder(t).exposure(card, PIXEL).shows).toBe(1);
  });

  it('code review P1: a card whose carousel breaks out of its padding is not widened sideways — its own button still spans it, and the button\'s label shows whole (the round-6 own-button refusal stays fixed)', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">
 <node class="android.view.View" resource-id="card" bounds="[66,500][1014,900]">
  <node class="android.widget.TextView" text="Pay now" bounds="[100,520][980,600]" />
  <node class="android.widget.Button" bounds="[66,500][1014,620]" />
  <node class="android.view.View" scrollable="true" resource-id="carousel" bounds="[0,640][1080,880]" />
 </node>
</node></node></hierarchy>`);
    const card = [...everyNode(t)].find((n) => n.identifier === 'card')!;
    expect(card.rect).toEqual({ x: 66, y: 500, width: 948, height: 400 });
    expect(card).not.toHaveProperty('cutBounds');
    const label = [...everyNode(t)].find((n) => n.label === 'Pay now')!;
    expect(drawOrder(t).exposure(label, PIXEL)).toMatchObject({ covers: [], shows: 1 });
  });

  it('code review P3: a full-width child overflowing its row by 10 px each side does not widen the row over the next one — row_a is not covered by row_b', () => {
    const t = parseDump(`<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
<node class="android.view.View" scrollable="true" bounds="[0,400][1080,2000]">
 <node class="android.view.View" resource-id="row_a" bounds="[0,600][1080,705]">
  <node class="android.view.View" content-desc="A" clickable="true" bounds="[0,590][1080,716]" />
 </node>
 <node class="android.view.View" resource-id="row_b" bounds="[0,705][1080,810]">
  <node class="android.view.View" content-desc="B" clickable="true" bounds="[0,695][1080,821]" />
 </node>
</node></node></hierarchy>`);
    const a = [...everyNode(t)].find((n) => n.identifier === 'row_a')!;
    expect(a.rect).toEqual({ x: 0, y: 600, width: 1080, height: 105 });
    expect(drawOrder(t).exposure(a, PIXEL).covers.map(({ node: c }) => c.identifier)).not.toContain('row_b');
  });

  it('the round-5 ui_snapshots, re-dumped through the parser: only the two rows cut at the floating tab bar widen — every other rect, Contacts\' padded icons (wrapper 132, control 110, label 66) and the IME-cut "Add fields"/"Add phone" among them, stays as dumped', async () => {
    const fixture = JSON.parse(await readFile(new URL('../fixtures/android-ui-snapshot-compose.json', import.meta.url), 'utf8')) as { screens: Record<string, UiNode> };
    const CLASS: Record<string, string> = { button: 'android.widget.Button', text: 'android.widget.TextView', textfield: 'android.widget.EditText', image: 'android.widget.ImageView' };
    const attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const toXml = (n: UiNode): string => {
      const { x, y, width, height } = n.rect;
      const attrs = [
        `class="${CLASS[n.role] ?? 'android.view.View'}"`,
        `bounds="[${x},${y}][${x + width},${y + height}]"`,
        n.identifier !== null ? `resource-id="${attr(n.identifier)}"` : '',
        n.label !== null ? `content-desc="${attr(n.label)}"` : '',
        n.clipsDescendants === true ? 'scrollable="true"' : '',
      ].join(' ');
      return `<node ${attrs}>${n.children.map(toXml).join('')}</node>`;
    };
    const widened: string[] = [];
    for (const [screen, dumped] of Object.entries(fixture.screens)) {
      const parsed = parseDump(`<hierarchy rotation="0">${toXml(dumped)}</hierarchy>`);
      const before = [...everyNode(dumped)];
      const after = [...everyNode(parsed)];
      expect(after).toHaveLength(before.length);
      after.forEach((n, i) => {
        if (n.cutBounds === undefined) expect(n.rect).toEqual(before[i].rect);
        else {
          expect(n.cutBounds).toEqual(before[i].rect);
          widened.push(`${screen} ${n.identifier} ${n.rect.y} ${n.rect.height}`);
        }
      });
    }
    expect(widened).toEqual(['accountDetail transactions.list.row_29 1784 143', 'accountDetail transactions.list.row_30 2044 143']);
  });
});

describe('parseUiautomatorXml — bounds dumped inverted are a node clipped out of its container (docs/bugs/2026-10-09-android-inverted-uiautomator-bounds-pass-through-as-negative-heights.md)', () => {
  // Settings' homepage, its first rows scrolled under the collapsing app bar (run9-android, 5e5a3d1): uiautomator's raw bounds.
  const SETTINGS = `<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" resource-id="com.android.settings:id/collapsing_toolbar" bounds="[0,66][1080,297]">
    <node class="android.widget.TextView" resource-id="com.android.settings:id/homepage_title" text="Settings" bounds="[66,66][428,44]" />
  </node>
  <node class="androidx.recyclerview.widget.RecyclerView" resource-id="com.android.settings:id/recycler_view" scrollable="true" bounds="[0,297][1080,2220]">
    <node class="android.widget.LinearLayout" bounds="[0,297][1080,58]">
      <node class="android.widget.TextView" resource-id="android:id/title" text="Apps" bounds="[198,297][324,58]" />
      <node class="android.widget.TextView" resource-id="android:id/summary" text="Assistant, recent apps, default apps" bounds="[198,297][819,111]" />
    </node>
    <node class="android.widget.LinearLayout" bounds="[0,400][1080,600]"><node class="android.widget.TextView" text="Display" bounds="[198,450][400,520]" /></node>
    <node class="android.widget.LinearLayout" bounds="[0,2400][1080,2220]"><node class="android.widget.TextView" text="System" bounds="[198,2450][400,2220]" /></node>
    <node class="android.widget.HorizontalScrollView" bounds="[1200,500][1080,600]" />
  </node>
</node>
</hierarchy>`;
  const tree = parseDump(SETTINGS);
  const byLabel = (label: string) => [...everyNode(tree)].find((n) => n.label === label)!;

  it('clamped to zero size at the container\'s edge, the side it lies past kept: above (Apps, its summary, the title under the app bar), below (System), right of', () => {
    expect(byLabel('Apps')).toMatchObject({ rect: { x: 198, y: 297, width: 126, height: 0 }, clippedOut: 'top' });
    expect(byLabel('Assistant, recent apps, default apps')).toMatchObject({ rect: { x: 198, y: 297, width: 621, height: 0 }, clippedOut: 'top' });
    expect(byLabel('Settings')).toMatchObject({ rect: { x: 66, y: 66, width: 362, height: 0 }, clippedOut: 'top' });
    expect(byLabel('System')).toMatchObject({ rect: { x: 198, y: 2220, width: 202, height: 0 }, clippedOut: 'bottom' });
    const sideways = tree.children[1].children[3];
    expect(sideways).toMatchObject({ rect: { x: 1080, y: 500, width: 0, height: 100 }, clippedOut: 'right' });
  });

  it('no negative side anywhere; a node dumped the right way round carries no mark', () => {
    for (const n of everyNode(tree)) expect([n.rect.width, n.rect.height].every((side) => side >= 0)).toBe(true);
    expect(byLabel('Display')).not.toHaveProperty('clippedOut');
    expect(byLabel('Display').rect).toEqual({ x: 198, y: 450, width: 202, height: 70 });
  });

  it('tap text:"Apps" says where it went and the way back — not "0×0"', async () => {
    const error = await resolveSettled(new FakeAdapter({ s: tree }, 's'), 'text:"Apps"', { ambiguous: 'refuse', timeoutMs: 20, pollMs: 2 }).catch((e: unknown) => e);
    expect((error as Error).message).toBe(
      'Timed out after 20ms waiting for element text:"Apps" to appear\n  (it matched only nodes clipped out above its scroll container (scrolled past it) — scroll_until it with direction: "up" first)',
    );
  });
});

describe('parseUiautomatorXml — character references in attribute values', () => {
  // uiautomator writes a newline, a tab and any code point outside the BMP (an emoji) as a numeric
  // character reference; the tree holds the character, as the same string reads on iOS.
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="app" content-desc="" bounds="[0,0][1080,2220]">
    <node index="0" text="Welcome.&#10;&#10;Sign in to continue." resource-id="" class="android.widget.TextView" package="app" content-desc="" bounds="[0,100][1080,300]"/>
    <node index="1" text="" resource-id="app:id/account" class="android.widget.FrameLayout" package="app" content-desc="Signed in as Jane Doe&#10;Account and settings." clickable="true" bounds="[900,100][1040,200]"/>
    <node index="2" text="Name&#9;Value" resource-id="" class="android.widget.TextView" package="app" content-desc="" bounds="[0,300][1080,350]"/>
    <node index="3" text="&#x1F1FA;&#x1F1F8; +1" resource-id="" class="android.widget.TextView" package="app" content-desc="" bounds="[0,350][1080,375]"/>
    <node index="4" text="" resource-id="" class="android.widget.ImageView" package="app" content-desc="&#127482;&#127480;" bounds="[0,375][1080,400]"/>
    <node index="5" text="&amp;#10; is how XML spells a newline" resource-id="" class="android.widget.TextView" package="app" content-desc="" bounds="[0,400][1080,450]"/>
    <node index="6" text="Wallpaper &amp; style &lt;new&gt;" resource-id="" class="android.widget.TextView" package="app" content-desc="" bounds="[0,450][1080,500]"/>
    <node index="7" text="" hint="Line one&#10;line two" resource-id="app:id/notes&#46;input" class="android.widget.EditText" package="app" content-desc="" bounds="[0,500][1080,600]"/>
  </node>
</hierarchy>`;
  const [welcome, account, tabbed, hexFlag, decimalFlag, literal, named, notes] = parseDump(xml).children;

  it('a newline in text and in content-desc is the newline itself', () => {
    expect(welcome.label).toBe('Welcome.\n\nSign in to continue.');
    expect(account.label).toBe('Signed in as Jane Doe\nAccount and settings.');
  });

  it('a tab', () => {
    expect(tabbed.label).toBe('Name\tValue');
  });

  it('an emoji spelled as hex references, in text', () => {
    expect(hexFlag.label).toBe('\u{1F1FA}\u{1F1F8} +1');
  });

  it('the same emoji spelled as decimal references, in content-desc', () => {
    expect(decimalFlag.label).toBe('\u{1F1FA}\u{1F1F8}');
  });

  it('every attribute: resource-id and hint too', () => {
    expect(notes).toMatchObject({ identifier: 'notes.input', placeholder: 'Line one\nline two' });
  });

  it('text that really reads `&#10;` (dumped as `&amp;#10;`) stays those five characters — decoded once, not twice', () => {
    expect(literal.label).toBe('&#10; is how XML spells a newline');
  });

  it('the XML named entities decode as before', () => {
    expect(named.label).toBe('Wallpaper & style <new>');
  });
});

describe('parseUiautomatorXml — a text input\'s hint (2026-10-09)', () => {
  // docs/bugs/2026-10-09-android-clear-reads-edittext-hint-as-content.md: the
  // API 33 dump of an EMPTY EditText carries its hint as `text` and no `hint`
  // attribute (the first node below is that measured shape). A dump that
  // names the hint gets it as the node's placeholder — on text inputs only.
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="app" content-desc="" bounds="[0,0][1080,2220]">
    <node index="0" text="Last name" resource-id="" class="android.widget.EditText" package="com.google.android.contacts" content-desc="" focused="true" bounds="[132,1223][948,1383]"/>
    <node index="1" text="Search settings" hint="Search settings" resource-id="com.android.settings:id/open_search_view_edit_text" class="android.widget.EditText" package="com.android.settings" content-desc="" bounds="[0,0][1080,150]"/>
    <node index="2" text="wifi" hint="Search settings" resource-id="app:id/filled" class="android.widget.EditText" package="app" content-desc="" bounds="[0,200][1080,350]"/>
    <node index="3" text="Hello" hint="ignored" resource-id="app:id/label" class="android.widget.TextView" package="app" content-desc="" bounds="[0,400][1080,450]"/>
    <node index="4" text="x" hint="" resource-id="app:id/blank_hint" class="android.widget.EditText" package="app" content-desc="" bounds="[0,500][1080,550]"/>
  </node>
</hierarchy>`;
  const [measured, hinted, filled, textView, blankHint] = parseDump(xml).children;

  it('the measured API 33 shape: the hint is the value, and nothing says so', () => {
    expect(measured).toMatchObject({ role: 'textfield', value: 'Last name' });
    expect(measured).not.toHaveProperty('placeholder');
  });

  it('a dump\'s `hint` attribute rides beside the value on a text input, the value as dumped', () => {
    expect(hinted).toMatchObject({ role: 'textfield', identifier: 'open_search_view_edit_text', value: 'Search settings', placeholder: 'Search settings' });
    expect(filled).toMatchObject({ value: 'wifi', placeholder: 'Search settings' });
  });

  it('not on a non-input, and not when the attribute is empty', () => {
    expect(textView).toMatchObject({ role: 'text', label: 'Hello' });
    expect(textView).not.toHaveProperty('placeholder');
    expect(blankHint).not.toHaveProperty('placeholder');
  });
});

// A27's mutation run (ADR 0038's A27 amendment): the dialect's rules its other tests left unpinned, through
// parseUiautomatorXml.
describe('parseUiautomatorXml — the dialect\'s rules, one by one', () => {
  const XML = (body: string): string => `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${body}</hierarchy>`;
  const node = (attrs: string, children = ''): string => `<node index="0" text="" resource-id="" package="p" content-desc="" ${attrs}${children === '' ? ' />' : `>${children}</node>`}`;
  /** One window [0,0][1080,2220] holding `child`, parsed; its one child back. */
  const only = (child: string): UiNode => parseDump(XML(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"', child))).children[0];

  it('the role map: ImageButton a button, EditText and AutoCompleteTextView text fields', () => {
    expect(only(node('class="android.widget.ImageButton" bounds="[0,0][10,10]"')).role).toBe('button');
    expect(only(node('class="android.widget.EditText" bounds="[0,0][10,10]"')).role).toBe('textfield');
    expect(only(node('class="android.widget.AutoCompleteTextView" bounds="[0,0][10,10]"')).role).toBe('textfield');
  });

  it('a class ENDING in EditText is a text input (AppCompatEditText), with no role of its own in the map', () => {
    expect(only(node('class="androidx.appcompat.widget.AppCompatEditText" bounds="[0,0][10,10]"')).role).toBe('textfield');
    expect(only(node('class="android.widget.EditTextLike" bounds="[0,0][10,10]"')).role).toBe('other');
  });

  it('a node with no class: a container with children, else other — never thrown on', () => {
    expect(only(node('bounds="[0,0][10,10]"')).role).toBe('other');
    expect(only(node('bounds="[0,0][10,10]"', node('class="android.widget.TextView" text="x" bounds="[0,0][10,10]"'))).role).toBe('container');
  });

  it('a scroll view\'s axis by its class: HorizontalScrollView horizontal, ScrollView vertical — a text input none', () => {
    expect(only(node('class="android.widget.HorizontalScrollView" bounds="[0,0][10,10]"')).scrollAxis).toBe('horizontal');
    expect(only(node('class="android.widget.ScrollView" bounds="[0,0][10,10]"')).scrollAxis).toBe('vertical');
    expect(only(node('class="android.widget.EditText" bounds="[0,0][10,10]"'))).not.toHaveProperty('scrollAxis');
    expect(only(node('class="android.widget.TextView" bounds="[0,0][10,10]"'))).not.toHaveProperty('scrollAxis');
  });

  it('a Compose text input is a (Horizontal)ScrollView both focusable AND long-clickable; either alone is a scroll view', () => {
    for (const cls of ['ScrollView', 'HorizontalScrollView']) {
      const field = only(node(`class="android.widget.${cls}" focusable="true" long-clickable="true" text="Jan" bounds="[0,0][10,10]"`));
      expect(field, cls).toMatchObject({ role: 'textfield', value: 'Jan' });
      expect(field).not.toHaveProperty('scrollAxis');
      expect(only(node(`class="android.widget.${cls}" focusable="true" long-clickable="false" bounds="[0,0][10,10]"`)).role, cls).toBe('scrollable');
      expect(only(node(`class="android.widget.${cls}" focusable="false" long-clickable="true" bounds="[0,0][10,10]"`)).role, cls).toBe('scrollable');
    }
    expect(only(node('class="android.view.View" focusable="true" long-clickable="true" bounds="[0,0][10,10]"')).role).toBe('other');
  });

  it('masked or not, on a text input only: password "true" secure, "false" not, absent or other unknown', () => {
    expect(only(node('class="android.widget.EditText" password="true" bounds="[0,0][10,10]"')).secure).toBe(true);
    expect(only(node('class="android.widget.EditText" password="false" bounds="[0,0][10,10]"')).secure).toBe(false);
    expect(only(node('class="android.widget.EditText" bounds="[0,0][10,10]"'))).not.toHaveProperty('secure');
    expect(only(node('class="android.widget.EditText" password="yes" bounds="[0,0][10,10]"'))).not.toHaveProperty('secure');
    expect(only(node('class="android.widget.TextView" password="true" bounds="[0,0][10,10]"'))).not.toHaveProperty('secure');
  });

  it('every attribute but text and hint loses ALL its outer spaces', () => {
    expect(only(node('class="android.widget.Button" content-desc="  Pay  " bounds="[0,0][10,10]"')).label).toBe('Pay');
  });

  it('no nodes, or no hierarchy at all: the dump is refused', () => {
    expect(() => parseDump(XML(''))).toThrow('uiautomator dump contained no nodes');
    expect(() => parseDump('<?xml version="1.0"?><other />')).toThrow('uiautomator dump contained no nodes');
  });

  it('several windows: one synthetic container over them, of no area, marked as its source — no presentation of any', () => {
    const floating = (b: string): string => node(`class="android.widget.FrameLayout" bounds="${b}"`, node(`class="android.widget.TextView" text="t" bounds="${b}"`));
    const tree = parseDump(XML(floating('[100,100][500,500]') + floating('[100,600][500,900]')));
    expect({ ...tree, children: tree.children.length }).toStrictEqual({
      role: 'container', label: null, identifier: null, value: null, rect: { x: 0, y: 0, width: 0, height: 0 }, children: 2,
      paddedTouchTargets: true, activeWindowOnly: true, boundsCutAtScreen: true,
    });
    expect(parseDump(XML(floating('[100,100][500,500]'))).presentation).toBe('dialog');
  });

  it('bounds of no height or no width are no inversion: no clippedOut, and no key for it', () => {
    expect(only(node('class="android.widget.TextView" text="a" bounds="[0,10][100,10]"'))).not.toHaveProperty('clippedOut');
    expect(only(node('class="android.widget.TextView" text="a" bounds="[10,0][10,100]"'))).not.toHaveProperty('clippedOut');
    expect(only(node('class="android.widget.TextView" text="a" bounds="[0,0][100,100]"'))).not.toHaveProperty('clippedOut');
  });

  it('no bounds attribute: a node of no area at 0,0, never thrown on', () => {
    expect(only(node('class="android.widget.TextView" text="a"')).rect).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('an inverted node equally far from both of its parent\'s edges reads `top` (a tie reads top or left)', () => {
    const parent = (child: string): string => node('class="android.widget.FrameLayout" bounds="[0,100][1080,300]"', child);
    // t 250 is 150 below the parent's top 100, b 150 is 150 above its bottom 300
    const tie = parseDump(XML(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"', parent(node('class="android.widget.TextView" text="a" bounds="[0,250][100,150]"')))));
    expect(tie.children[0].children[0].clippedOut).toBe('top');
    const sideTie = parseDump(XML(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"', node('class="android.widget.FrameLayout" bounds="[100,0][300,500]"', node('class="android.widget.TextView" text="a" bounds="[250,0][150,100]"')))));
    expect(sideTie.children[0].children[0].clippedOut).toBe('left');
  });

  it('a sheet scrim whose sibling has no bounds is no sheet, and no read of it throws', () => {
    const window = node('class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"',
      node('class="android.view.View" bounds="[0,0][1080,2220]"',
        node('class="android.view.View" clickable="true" content-desc="Close sheet" bounds="[0,0][1080,1110]"') + node('class="android.view.View" clickable="false"')));
    expect(parseDump(XML(window))).not.toHaveProperty('presentation');
  });

  it('a Compose sheet\'s scrim spans the window\'s width, and the sheet starts below the scrim\'s top', () => {
    const sheet = (scrim: string, below: string): UiNode =>
      parseDump(XML(node('class="android.widget.FrameLayout" bounds="[0,0][1080,2220]"',
        node('class="android.view.View" bounds="[0,0][1080,2220]"',
          node(`class="android.view.View" clickable="true" content-desc="Close sheet" bounds="${scrim}"`) + node(`class="android.view.View" bounds="${below}"`, node('class="android.widget.TextView" text="x" bounds="[0,1500][100,1600]"'))))));
    expect(sheet('[0,0][1080,1110]', '[0,1110][1080,2220]').presentation).toBe('screen');
    expect(sheet('[0,0][1000,1110]', '[0,1110][1000,2220]')).not.toHaveProperty('presentation');
    expect(sheet('[0,0][1080,1110]', '[0,0][1080,2220]')).not.toHaveProperty('presentation');
  });

  it('every class of the role map, and every class of the axis map, as the dump names them', () => {
    const roles: Record<string, string> = {
      Button: 'button', ImageButton: 'button', TextView: 'text', EditText: 'textfield', AutoCompleteTextView: 'textfield', ImageView: 'image',
      CheckBox: 'checkbox', Switch: 'switch', ToggleButton: 'switch', RadioButton: 'radiobutton', SeekBar: 'slider', ProgressBar: 'progress',
      WebView: 'webview', RecyclerView: 'scrollable', ListView: 'scrollable', ScrollView: 'scrollable', HorizontalScrollView: 'scrollable', ViewPager: 'scrollable',
    };
    for (const [cls, role] of Object.entries(roles)) expect(only(node(`class="android.widget.${cls}" bounds="[0,0][10,10]"`)).role, cls).toBe(role);
    const axes: Record<string, string> = { ScrollView: 'vertical', NestedScrollView: 'vertical', ListView: 'vertical', GridView: 'vertical', HorizontalScrollView: 'horizontal', ViewPager: 'horizontal' };
    for (const [cls, axis] of Object.entries(axes)) expect(only(node(`class="androidx.core.widget.${cls}" bounds="[0,0][10,10]"`)).scrollAxis, cls).toBe(axis);
  });
});

// The parser's marks on its root, moved from tests/adapters/android-presented-window.test.ts (A27), which keeps the
// verbs' cases over them: what the dump shows of the one window it lists (ADR 0018, "Android's presented window").

type Cell = 'alert-dim' | 'sheet-medium' | 'bottom-sheet-dialog' | 'dialog-fullscreen' | 'form-picker' | 'open';

/** A lab capture as the adapter parses it (the status line uiautomator appends cut, as AndroidAdapter.uiTree does). */
const capture = (cell: Cell): UiNode => {
  const xml = readFileSync(new URL(`../fixtures/uiautomator-lab-${cell}.xml`, import.meta.url), 'utf8');
  return parseDump(xml.slice(0, xml.lastIndexOf('>') + 1));
};

/** A uiautomator dump of one window holding `body`, the window at `bounds` (raw, as uiautomator writes them). */
const dump = (bounds: string, body: string): UiNode =>
  parseDump(
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
      `<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" clickable="false" scrollable="false" bounds="${bounds}">${body}</node></hierarchy>`,
  );
/** A raw uiautomator node. */
const raw = (bounds: string, attrs: { desc?: string; clickable?: boolean; scrollable?: boolean } = {}, children = ''): string =>
  `<node index="0" text="" resource-id="" class="android.view.View" package="p" content-desc="${attrs.desc ?? ''}" clickable="${attrs.clickable === true}" scrollable="${attrs.scrollable === true}" bounds="${bounds}"${children === '' ? ' />' : `>${children}</node>`}`;


describe('the uiautomator parser marks its root: the dump lists the active window only', () => {
  it('every dump\'s root carries `activeWindowOnly`, a plain screen\'s as a presented window\'s', () => {
    for (const cell of ['open', 'alert-dim', 'sheet-medium', 'bottom-sheet-dialog', 'dialog-fullscreen', 'form-picker'] as const) {
      expect(capture(cell).activeWindowOnly).toBe(true);
    }
  });
});

describe('the uiautomator parser marks the one window presented when the dump shows it is', () => {
  it('measured, the AlertDialog (alert-dim): a window off the screen\'s top and left edges floats over what it was opened from — `dialog`', () => {
    const tree = capture('alert-dim');
    expect(tree.rect).toEqual({ x: 155, y: 851, width: 770, height: 517 });
    expect(tree.presentation).toBe('dialog');
  });

  it('measured, the half-expanded ModalBottomSheet (sheet-medium): a screen-wide clickable labelled scrim from the window\'s top, the sheet beneath it to the bottom — `screen`', () => {
    expect(capture('sheet-medium').presentation).toBe('screen');
  });

  it('measured, the Views BottomSheetDialog (bottom-sheet-dialog): Material\'s unlabelled `touch_outside` scrim and its `design_bottom_sheet`, laid between the bars — `screen`', () => {
    const tree = capture('bottom-sheet-dialog');
    expect(tree.rect).toEqual({ x: 0, y: 0, width: 1080, height: 2220 });
    expect(tree.presentation).toBe('screen');
  });

  it('a plain screen (open) is no presented window; nor is the expanded picker sheet (form-picker), whose dump carries no scrim, nor the full-screen Compose dialog (dialog-fullscreen), laid between the bars against the left edge — residuals', () => {
    expect(capture('open').presentation).toBeUndefined();
    expect(capture('form-picker').presentation).toBeUndefined();
    expect(capture('dialog-fullscreen').presentation).toBeUndefined();
  });

  it('Material\'s sheet dialog is read by its view ids\' entries, its geometry against the scrim\'s, not the window\'s', () => {
    /** A raw node with a resource-id (`raw` writes none). */
    const idNode = (id: string, bounds: string, attrs: { clickable?: boolean } = {}, children = ''): string =>
      raw(bounds, attrs, children).replace('resource-id=""', `resource-id="${id}"`);
    const S = raw('[128,1406][953,1582]', { desc: 'Target S', clickable: true });
    const scrim = (attrs: { id?: string; bounds?: string; clickable?: boolean; child?: string } = {}) =>
      idNode(attrs.id ?? 'dev.averi.lab:id/touch_outside', attrs.bounds ?? '[0,66][1080,2154]', { clickable: attrs.clickable ?? true }, attrs.child ?? '');
    const sheet = (bounds = '[0,1164][1080,2154]', id = 'dev.averi.lab:id/design_bottom_sheet') => idNode(id, bounds, {}, S);
    const window = (kids: string, coordinator = 'dev.averi.lab:id/coordinator') =>
      dump('[0,0][1080,2220]', raw('[0,0][1080,2154]', {}, idNode(coordinator, '[0,66][1080,2154]', {}, kids)) + raw('[0,2154][1080,2220]'));
    expect(window(scrim() + sheet()).presentation).toBe('screen');
    // The entry is Material's; the package is the app's.
    expect(window(scrim({ id: 'com.bank.app:id/touch_outside' }) + sheet('[0,1164][1080,2154]', 'com.bank.app:id/design_bottom_sheet'), 'com.bank.app:id/coordinator').presentation).toBe('screen');
    // A fully expanded sheet starts where the scrim does (unmeasured; `>=`).
    expect(window(scrim() + sheet('[0,66][1080,2154]')).presentation).toBe('screen');
    // Another entry, or an id only ending in Material's: no mark.
    expect(window(scrim({ id: 'dev.averi.lab:id/my_touch_outside' }) + sheet()).presentation).toBeUndefined();
    expect(window(scrim() + sheet('[0,1164][1080,2154]', 'dev.averi.lab:id/bottom_sheet')).presentation).toBeUndefined();
    expect(window(scrim() + sheet(), 'dev.averi.lab:id/container').presentation).toBeUndefined();
    // The scrim must take the touch and hold nothing.
    expect(window(scrim({ clickable: false }) + sheet()).presentation).toBeUndefined();
    expect(window(scrim({ child: raw('[40,100][400,160]', { desc: 'x' }) }) + sheet()).presentation).toBeUndefined();
    // The sheet right after the scrim, not before it nor apart from it.
    expect(window(sheet() + scrim()).presentation).toBeUndefined();
    expect(window(scrim() + raw('[0,66][1080,200]') + sheet()).presentation).toBeUndefined();
    // The sheet shares the scrim's left, width and bottom, its top inside the scrim.
    expect(window(scrim() + sheet('[40,1164][1120,2154]')).presentation).toBeUndefined();
    expect(window(scrim() + sheet('[0,1164][1000,2154]')).presentation).toBeUndefined();
    expect(window(scrim() + sheet('[0,1164][1080,2220]')).presentation).toBeUndefined();
    expect(window(scrim() + sheet('[0,40][1080,2154]')).presentation).toBeUndefined();
    expect(window(scrim() + sheet('[0,2154][1080,2154]')).presentation).toBeUndefined();
  });

  it('…not a relaxed scrim shape: the same nodes with no Material ids — an unlabelled full-width touch layer over a full-width sibling — are app content', () => {
    const plain = dump(
      '[0,0][1080,2220]',
      raw('[0,0][1080,2220]', {}, raw('[0,0][1080,1110]', { clickable: true }) + raw('[0,1110][1080,2220]', {}, raw('[128,1406][953,1582]', { desc: 'x' }))),
    );
    expect(plain.presentation).toBeUndefined();
  });

  it('the scrim must be clickable, labelled, childless and screen-wide from the window\'s top, its sibling reaching the bottom from no lower than the scrim\'s', () => {
    const sheet = raw('[0,1110][1080,2220]', {}, raw('[128,1353][953,1529]', { desc: 'Target S', clickable: true }));
    const scrim = (attrs: Parameters<typeof raw>[1], bounds = '[0,0][1080,1110]') => raw(bounds, attrs);
    const host = (first: string, second = sheet) => dump('[0,0][1080,2220]', raw('[0,0][1080,2220]', {}, first + second));
    expect(host(scrim({ desc: 'Close sheet', clickable: true })).presentation).toBe('screen');
    // A full-screen scrim behind the sheet (the Views BottomSheetDialog's `touch_outside` shape) holds too.
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[0,0][1080,2220]')).presentation).toBe('screen');
    expect(host(scrim({ clickable: true })).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Banner' })).presentation).toBeUndefined();
    // A would-be scrim with a child of its own is content (a banner holding its text), no scrim.
    expect(host(raw('[0,0][1080,1110]', { desc: 'Close sheet', clickable: true }, raw('[40,40][400,100]', { desc: 'x' }))).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[0,66][1080,1110]')).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }, '[40,0][1040,1110]')).presentation).toBeUndefined();
    // The next sibling stops short of the window's bottom, or begins below the scrim: no sheet.
    expect(host(scrim({ desc: 'Close sheet', clickable: true }), raw('[0,1110][1080,2000]')).presentation).toBeUndefined();
    expect(host(scrim({ desc: 'Close sheet', clickable: true }), raw('[0,1200][1080,2220]')).presentation).toBeUndefined();
    // The scrim last, with nothing after it: no sheet either.
    expect(dump('[0,0][1080,2220]', raw('[0,0][1080,2220]', {}, sheet + scrim({ desc: 'Close sheet', clickable: true }))).presentation).toBeUndefined();
  });

  it('a window against the screen\'s top or left edge is no dialog, however small or offset on the other axis; one of no area is none', () => {
    expect(dump('[0,0][600,900]', raw('[0,0][600,900]', { desc: 'x' })).presentation).toBeUndefined();
    // A full-height window offset sideways: landscape beside a cutout, a pillarboxed compat-mode app.
    expect(dump('[120,0][1200,2220]', raw('[120,0][1200,2220]', { desc: 'x' })).presentation).toBeUndefined();
    // A full-width window offset down: a split screen's lower window.
    expect(dump('[0,1110][1080,2220]', raw('[0,1110][1080,2220]', { desc: 'x' })).presentation).toBeUndefined();
    // The plain screen shifted 120 px right reads as no dialog either.
    const shifted = readFileSync(new URL('../fixtures/uiautomator-lab-open.xml', import.meta.url), 'utf8').replace(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g, (_m, l, t, r, b) => `bounds="[${+l + 120},${t}][${+r + 120},${b}]"`);
    expect(parseDump(shifted.slice(0, shifted.lastIndexOf('>') + 1)).presentation).toBeUndefined();
    expect(dump('[200,300][200,300]', '').presentation).toBeUndefined();
  });
});


// A27's code review: the dialect's rules its other cases left to draw order's tests, through parseUiautomatorXml with a
// port that records what it is asked (the candidates `uncut` found, each with its gained strip), and the sheet
// recognizers on synthetic variants of the lab's captures.
describe('parseUiautomatorXml — a node cut short of its own descendants, as the port is asked of it', () => {
  type Asked = { id: string | null; strip: Rect };
  /** The tree parsed with a port that records every strip it is asked of, and answers `drawn`. */
  const parsedAsking = (xml: string, drawn = true): { tree: UiNode; asked: Asked[]; ported: number } => {
    const asked: Asked[] = [];
    let ported = 0;
    const tree = parseUiautomatorXml(xml, () => {
      ported++;
      return (node, strip) => {
        asked.push({ id: node.identifier, strip });
        return drawn;
      };
    });
    return { tree, asked, ported };
  };
  /** A window with a scroll view (the clip) holding `row_0`, dumped `[0,100][1080,200]`, and `inner` in the row. */
  const rowWith = (inner: string, row = '[0,100][1080,200]'): string =>
    `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
    `<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" bounds="[0,0][1080,2220]">` +
    `<node index="0" text="" resource-id="" class="android.widget.ScrollView" package="p" content-desc="" scrollable="true" bounds="[0,0][1080,2220]">` +
    `<node index="0" text="" resource-id="p:id/row_0" class="android.widget.LinearLayout" package="p" content-desc="" bounds="${row}">${inner}</node>` +
    `</node></node></hierarchy>`;
  const label = (bounds: string): string => `<node index="0" text="Row" resource-id="p:id/label" class="android.widget.TextView" package="p" content-desc="" bounds="${bounds}" />`;

  it('a descendant of the row\'s exact x and width above it: the row is a candidate, its strip the part above, widened when drawn over', () => {
    const { tree, asked } = parsedAsking(rowWith(label('[0,50][1080,200]')));
    expect(asked).toEqual([{ id: 'row_0', strip: { x: 0, y: 50, width: 1080, height: 50 } }]);
    const row = [...everyNode(tree)].find((n) => n.identifier === 'row_0');
    expect(row).toMatchObject({ rect: { x: 0, y: 50, width: 1080, height: 150 }, cutBounds: { x: 0, y: 100, width: 1080, height: 100 } });
  });

  it('nothing cut: the port is never even asked for its judge', () => {
    expect(parsedAsking(rowWith(label('[0,100][1080,200]'))).ported).toBe(0);
  });

  it('a descendant of another x, another width or no area grows nothing', () => {
    expect(parsedAsking(rowWith(label('[10,50][1090,200]'))).asked).toEqual([]);
    expect(parsedAsking(rowWith(label('[0,50][540,200]'))).asked).toEqual([]);
    expect(parsedAsking(rowWith(label('[0,50][1080,50]'))).asked).toEqual([]);
  });

  it('a row of no area is no candidate, whatever its descendants', () => {
    expect(parsedAsking(rowWith(label('[0,50][1080,100]'), '[0,100][1080,100]')).asked).toEqual([]);
  });

  it('the root dumped inverted (it has no parent to read the clip off) reads top, never thrown on', () => {
    const tree = parseDump(XML_INVERTED_ROOT);
    expect(tree).toMatchObject({ clippedOut: 'top', rect: { x: 0, y: 100, width: 1080, height: 0 } });
    expect(parseDump(XML_INVERTED_ROOT.replace('[0,100][1080,50]', '[100,0][50,2220]'))).toMatchObject({ clippedOut: 'left' });
  });
});

const XML_INVERTED_ROOT =
  `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">` +
  `<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="p" content-desc="" bounds="[0,100][1080,50]" /></hierarchy>`;

describe('the sheet recognizers on synthetic variants of the lab\'s captures', () => {
  const lab = (cell: string): string => {
    const xml = readFileSync(new URL(`../fixtures/uiautomator-lab-${cell}.xml`, import.meta.url), 'utf8');
    return xml.slice(0, xml.lastIndexOf('>') + 1);
  };

  it('sheet-medium: the scrim and its sheet moved off the window\'s left edge, at the window\'s width, are no sheet', () => {
    const xml = lab('sheet-medium');
    expect(parseDump(xml).presentation).toBe('screen');
    const shifted = xml.replace('bounds="[0,0][1080,1110]"', 'bounds="[10,0][1090,1110]"').replace('bounds="[0,1110][1080,2220]"', 'bounds="[10,1110][1090,2220]"');
    expect(shifted).not.toBe(xml);
    expect(parseDump(shifted)).not.toHaveProperty('presentation');
  });

  it('bottom-sheet-dialog: Material\'s ids are read by the entry after `:id/` — an id with no `:id/` names none, one that starts with it names its entry', () => {
    const xml = lab('bottom-sheet-dialog');
    expect(parseDump(xml).presentation).toBe('screen');
    expect(parseDump(xml.replaceAll('dev.averi.lab:id/', 'abc'))).not.toHaveProperty('presentation');
    expect(parseDump(xml.replaceAll('dev.averi.lab:id/', ':id/')).presentation).toBe('screen');
  });
});
