import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { tapElement } from '../../src/interact/tap.js';
import { AndroidAdapter, parseImeInsets, parseInputShown, parseNavigationBand, parseStatusBand, parseTouchableRegion, parseUiautomatorXml } from '../../src/adapters/android.js';
import { ExecError, type ExecFn, type ExecResult } from '../../src/adapters/exec.js';
import { execErrorLikeExec } from '../helpers/exec-error.js';
import { GBOARD, GBOARD_PANEL, GBOARD_STRIP, INPUT_SHOWN_LINE, parseDump, drawnOverStrip } from '../helpers/android-dumps.js';
import { everyNode, type Rect, type UiNode } from '../../src/adapters/types.js';
import { drawOrder } from '../../src/ui-tree/draw-order.js';
import { scrollUntilVisible } from '../../src/interact/scroll.js';
import { resolveSettled } from '../../src/interact/resolve.js';
import { FakeAdapter } from '../helpers/fake.js';

/** Fake exec that records calls and replays canned responses by command prefix. */
function fakeExec(responses: Record<string, string | Buffer>) {
  const calls: string[] = [];
  const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
    const full = [cmd, ...args].join(' ');
    calls.push(full);
    for (const [prefix, out] of Object.entries(responses)) {
      if (full.startsWith(prefix)) {
        return { stdout: Buffer.isBuffer(out) ? out : Buffer.from(out), stderr: '' };
      }
    }
    return { stdout: Buffer.alloc(0), stderr: '' };
  };
  return { fn, calls };
}

// Trimmed real-world shape: hierarchy root, nested nodes, PIN field, button.
const UIAUTOMATOR_XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="md.bank.app" content-desc="" bounds="[0,0][1080,2400]">
    <node index="0" text="" resource-id="md.bank.app:id/pin_keyboard" class="android.view.ViewGroup" package="md.bank.app" content-desc="PIN keyboard" bounds="[0,1200][1080,2400]">
      <node index="0" text="1" resource-id="md.bank.app:id/pin_key_1" class="android.widget.Button" package="md.bank.app" content-desc="" bounds="[0,1200][360,1500]"/>
      <node index="1" text="2" resource-id="md.bank.app:id/pin_key_2" class="android.widget.Button" package="md.bank.app" content-desc="" bounds="[360,1200][720,1500]"/>
    </node>
    <node index="1" text="user@bank.md" resource-id="md.bank.app:id/username_field" class="android.widget.EditText" package="md.bank.app" content-desc="" bounds="[100,400][980,520]"/>
    <node index="2" text="Log in" resource-id="" class="android.widget.TextView" package="md.bank.app" content-desc="" bounds="[100,600][980,700]"/>
  </node>
</hierarchy>
UI hierchary dumped to: /dev/tty`;

describe('parseUiautomatorXml', () => {
  const tree = parseDump(UIAUTOMATOR_XML.slice(0, UIAUTOMATOR_XML.lastIndexOf('>') + 1));

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
    expect(seen.covers.map((c) => c.identifier)).toContain('transactions.list.date_header_0');
    expect(seen.shows).toBeCloseTo(66 / 143, 9);
  });

  it('…and `scroll_until id:row_0 fully` turns at once (the label selector\'s measured stroke, content down) instead of "fully visible after 0 swipes"', async () => {
    const fake = new FakeAdapter({ list: tree }, 'list');
    const outcome = await scrollUntilVisible(fake, 'id:transactions.list.row_0', { fully: true, maxSwipes: 1, timeoutMs: 2_000, settleMs: 1 }).catch((e: unknown) => e);
    expect(outcome).toBeInstanceOf(Error);
    expect(fake.swipes).toHaveLength(1);
    expect(fake.swipes[0].to.y).toBeGreaterThan(fake.swipes[0].from.y);
  });

  it('a tap on the widened row aims at the part clear of the header (66 px), and is refused when what shows is under the minimum tap piece (a 30-px strip) — before, it tapped the strip that showed', async () => {
    const fake = new FakeAdapter({ list: tree }, 'list');
    await tapElement(fake, 'id:transactions.list.row_0', { ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 });
    expect(fake.taps).toHaveLength(1);
    const thin = parseDump(ACCOUNT_DETAIL.replace('bounds="[66,480][1014,546]"', 'bounds="[66,516][1014,546]"').replace('[0,401][1080,480]', '[0,401][1080,516]'));
    expect(byIdIn(thin, 'transactions.list.row_0').rect).toEqual({ x: 66, y: 403, width: 948, height: 143 });
    const refused = new FakeAdapter({ list: thin }, 'list');
    const error = await tapElement(refused, 'id:transactions.list.row_0', { ambiguous: 'refuse', timeoutMs: 200, pollMs: 2 }).catch((e: unknown) => e);
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

  it('…nor a bare structural overlay (childless, nothing said, only an id) — and the same overlay saying something, or a host whose tab lies on the strip, still widens it', () => {
    expect(rowOf(rowWith('', '<node class="android.view.View" resource-id="overlay" bounds="[0,1540][1080,2000]" />'))).not.toHaveProperty('cutBounds');
    expect(rowOf(rowWith('', '<node class="android.view.View" resource-id="overlay" content-desc="Banner" bounds="[0,1540][1080,2000]" />'))).toHaveProperty('cutBounds');
    const tabHost = '<node class="android.view.View" bounds="[0,0][1080,2220]"><node class="android.view.View" resource-id="tabs" bounds="[66,1550][1014,1800]"><node class="android.view.View" content-desc="Home" bounds="[100,1560][300,1700]" /></node></node>';
    expect(rowOf(rowWith('', tabHost))).toMatchObject({ rect: { x: 66, y: 1500, width: 948, height: 100 }, cutBounds: { x: 66, y: 1500, width: 948, height: 50 } });
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
    expect(drawOrder(t).exposure(a, PIXEL).covers.map((c) => c.identifier)).not.toContain('row_b');
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

describe('AndroidAdapter interactions', () => {
  it('drags at 0.45 screens a second (types.ts#dragSpeed, 2026-10-09): the duration a caller passes reaches `input swipe`; none passed is still 300 ms', async () => {
    const { fn, calls } = fakeExec({});
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    expect(adapter.dragSpeed).toBe(0.45);
    await adapter.swipe({ x: 540, y: 1871 }, { x: 540, y: 1021 }, 851);
    await adapter.swipe({ x: 540, y: 1776 }, { x: 540, y: 444 });
    expect(calls.filter((c) => c.includes('input swipe'))).toEqual([
      'adb -s emulator-5554 shell input swipe 540 1871 540 1021 851',
      'adb -s emulator-5554 shell input swipe 540 1776 540 444 300',
    ]);
  });

  it('uiTree strips the trailing uiautomator status line', async () => {
    const { fn } = fakeExec({ 'adb -s emulator-5554 exec-out uiautomator': UIAUTOMATOR_XML });
    const tree = await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree();
    expect(tree.children).toHaveLength(3);
  });

  // Measured 2026-09-17 (mp-native run 5): an emulator dying underneath answered
  // `Killed`, then `` (empty), while adb exited 0 — the message named uiautomator
  // and three calls went at the tool before `adb` said `device offline`.
  describe('uiTree with no XML names the DEVICE state, not the automation tool', () => {
    /** Scripted exec: uiautomator answers in order; get-state is a value or a thrown ExecError. */
    function scripted(dumps: string[], getState: string | ExecError) {
      const calls: string[] = [];
      let i = 0;
      const fn: ExecFn = async (cmd, args): Promise<ExecResult> => {
        const full = [cmd, ...args].join(' ');
        calls.push(full);
        if (full.includes('uiautomator dump')) {
          return { stdout: Buffer.from(dumps[Math.min(i++, dumps.length - 1)]), stderr: '' };
        }
        if (full.endsWith('get-state')) {
          if (getState instanceof ExecError) throw getState;
          return { stdout: Buffer.from(`${getState}\n`), stderr: '' };
        }
        return { stdout: Buffer.alloc(0), stderr: '' };
      };
      return { fn, calls };
    }
    const offline = new ExecError('adb -s emulator-5554 get-state', 1, 'error: device offline\n');

    it('offline device: leads with adb get-state, keeps the dump text as evidence', async () => {
      const { fn, calls } = scripted(['Killed'], offline);
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /device emulator-5554 is not reachable: adb get-state says "device offline".*uiautomator dump returned no XML: Killed/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(1); // no retry on Killed
      expect(calls.at(-1)).toBe('adb -s emulator-5554 get-state');
    });

    it('empty dump on an offline device is the same diagnosis', async () => {
      const { fn } = scripted([''], offline);
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /is not reachable: adb get-state says "device offline"/,
      );
    });

    it('null root node with settle: retries once, then succeeds silently', async () => {
      const { fn, calls } = scripted(
        ['ERROR: null root node returned by UiTestAutomationBridge.', UIAUTOMATOR_XML],
        'device',
      );
      const tree = await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree({ settle: true });
      expect(tree.children).toHaveLength(3);
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(2);
      expect(calls.some((c) => c.endsWith('get-state'))).toBe(false);
    }, 10_000);

    it('null root node twice on a reachable device with settle: classified as settling', async () => {
      const { fn, calls } = scripted(['ERROR: null root node returned by UiTestAutomationBridge.'], 'device');
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree({ settle: true })).rejects.toThrow(
        /device emulator-5554 is still settling.*retried once after 1 s\)/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(2);
    }, 10_000);

    it('null root node WITHOUT settle (a poller): one dump, no hidden retry, still classified', async () => {
      const { fn, calls } = scripted(['ERROR: null root node returned by UiTestAutomationBridge.'], 'device');
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /is still settling.*read once/s,
      );
      expect(calls.filter((c) => c.includes('uiautomator dump'))).toHaveLength(1);
    });

    it('a dump TIMEOUT on a reachable device is "reachable but SLOW", not a bare "Command timed out"', async () => {
      const calls: string[] = [];
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        calls.push(full);
        if (full.includes('uiautomator dump')) throw new ExecError(full, null, '', true);
        return { stdout: Buffer.from('device\n'), stderr: '' };
      };
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /device emulator-5554 is reachable but SLOW: uiautomator dump timed out after 15 s/,
      );
      expect(calls.at(-1)).toBe('adb -s emulator-5554 get-state');
    });

    // C5 (2026-10-09): a get-state that TIMES OUT carries no stderr of its own
    // — exec.ts substitutes node's "Command failed: <cmd>" — and the reply
    // quoted that as what adb "says". A get-state that never answered is a
    // hung adb server or transport, not a device state.
    it('get-state TIMING OUT is worded as a timeout, not as something adb said', async () => {
      const calls: string[] = [];
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        calls.push(full);
        throw execErrorLikeExec(full, null, '', { timedOut: true });
      };
      const err = await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree().then(() => undefined, (e: Error) => e);
      expect(err?.message).toBe(
        'device emulator-5554 is not answering: adb get-state timed out after 5 s — the adb server or this ' +
          "device's transport is hung, not the app. Run `adb devices`: if it hangs too, `adb kill-server && " +
          'adb start-server`; if only this device is stuck, restart the emulator (or reconnect the USB cable). ' +
          'Not an averi or uiautomator fault. (uiautomator dump timed out after 15 s)',
      );
      expect(err?.message).not.toContain('says');
      expect(calls.at(-1)).toBe('adb -s emulator-5554 get-state');
    });

    it('get-state timing out after a dump that answered without XML keeps the dump as evidence', async () => {
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        if (full.includes('uiautomator dump')) return { stdout: Buffer.from('Killed'), stderr: '' };
        throw execErrorLikeExec(full, null, '', { timedOut: true });
      };
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /^device emulator-5554 is not answering: adb get-state timed out after 5 s — .*\(uiautomator dump returned no XML: Killed\)$/s,
      );
    });

    // Pins only that the answered branch is UNCHANGED (node's message, from an
    // empty stderr) — not an endorsement of the wording; real adb writes `error: …`.
    it('get-state that ANSWERED with a failure (exit 1) is still quoted as what adb says', async () => {
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        if (full.includes('uiautomator dump')) return { stdout: Buffer.from('Killed'), stderr: '' };
        throw execErrorLikeExec(full, 1, '');
      };
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /^device emulator-5554 is not reachable: adb get-state says "Command failed: adb -s emulator-5554 get-state"/,
      );
    });

    it('adb itself failing on the dump (device not found, exit 255) is diagnosed as unreachable, with the cause kept', async () => {
      const fn: ExecFn = async (cmd, args) => {
        const full = [cmd, ...args].join(' ');
        throw new ExecError(full, full.includes('get-state') ? 1 : 255, "error: device 'emulator-5554' not found");
      };
      const err = await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree().then(() => undefined, (e: Error) => e);
      expect(err?.message).toMatch(/device emulator-5554 is not reachable: adb get-state says "device 'emulator-5554' not found"/);
      expect(err?.message).toContain('adb could not run uiautomator dump');
      expect(err?.cause).toBeInstanceOf(ExecError);
    });

    it('Killed on a reachable device: the dump died on the guest, device still named', async () => {
      const { fn } = scripted(['Killed'], 'device');
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).uiTree()).rejects.toThrow(
        /returned no XML: Killed — adb get-state says "device", so the dump itself died on the guest/,
      );
    });
  });

  describe('isAppRunning distinguishes "no process" from "could not ask"', () => {
    // Fixtures are built the way exec.ts builds them (tests/helpers/exec-error.ts):
    // a real ExecError never has a blank stderr.
    const realShape = execErrorLikeExec;
    const throwing = (err: ExecError): ExecFn => async () => { throw err; };

    it('asks with `pidof <pkg> || true` and reads NOT running from an empty stdout, exit 0', async () => {
      const { fn, calls } = fakeExec({});
      expect(await new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('md.bank.app')).toBe(false);
      expect(calls).toEqual(['adb -s e shell pidof md.bank.app || true']);
    });
    it('a pid on stdout is running', async () => {
      const { fn } = fakeExec({ 'adb -s e shell pidof': '22698\n' });
      expect(await new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('md.bank.app')).toBe(true);
    });
    it('a non-zero exit shaped like exec.ts emits it propagates — it is the transport, not the app', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', 1, ''));
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/Command failed/);
    });
    it('a timeout propagates (device under load is not a dead app)', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', null, '', { timedOut: true }));
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/timed out/);
    });
    it('an adb-level error propagates (offline device is not a dead app)', async () => {
      const fn = throwing(realShape('adb -s e shell pidof x || true', 1, 'error: device offline'));
      await expect(new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('x')).rejects.toThrow(/device offline/);
    });
    // Quoted, no longer refused — see adb-shell.ts; pinned through a real sh in adb-shell.test.ts.
    it('quotes a package name that could escape the shell, rather than refusing it', async () => {
      const { fn, calls } = fakeExec({});
      expect(await new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }).isAppRunning('x; rm -rf /')).toBe(false);
      expect(calls).toEqual(["adb -s e shell pidof 'x; rm -rf /' || true"]);
    });
  });

  it('tapElement resolves a selector and taps the rect center', async () => {
    const { fn, calls } = fakeExec({ 'adb -s emulator-5554 exec-out uiautomator': UIAUTOMATOR_XML });
    await tapElement(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }), 'id:pin_key_2', { ambiguous: 'refuse' });
    expect(calls.at(-1)).toBe('adb -s emulator-5554 shell input tap 540 1350');
  });

  it('typeText sends one input-text call per character (bulk injection drops chars on Compose fields)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('a $b');
    expect(calls).toEqual([
      'adb -s emulator-5554 shell input text a',
      'adb -s emulator-5554 shell input text %s',
      // quoted for the device's sh (adb-shell.ts), no longer backslash-escaped here
      "adb -s emulator-5554 shell input text '$'",
      'adb -s emulator-5554 shell input text b',
      // DPAD_LEFT + DPAD_RIGHT: the cursor nudge that commits GBoard's trailing
      // composition span, so the last character survives a following BACK or tap.
      'adb -s emulator-5554 shell input keyevent 21',
      'adb -s emulator-5554 shell input keyevent 22',
    ]);
  });

  // The iOS side of this (2026-10-07, docs/bugs/2026-10-07-ios-fill-empty-
  // value-fails-in-idb.md) returns before idb; Android's loop already ran zero
  // times for "" and passed, but the commit nudge (DPAD_LEFT, DPAD_RIGHT, a
  // sleep) still went out — pinned as a decision when the iOS fix landed, and
  // corrected later that day: the contract says "" types nothing on both.
  it('typeText with an empty string sends nothing: neither a character nor the commit nudge', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('');
    expect(calls).toEqual([]);
  });

  it('launch with clearState clears app data first', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { clearState: true });
    expect(calls[0]).toBe('adb -s emulator-5554 shell pm clear md.bank.app');
    expect(calls[1]).toContain('monkey -p md.bank.app');
  });

  it('launch with an activity uses am start -n, not monkey (monkey may pick LeakCanary)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { activity: '.MainActivity' });
    expect(calls).toEqual([
      'adb -s emulator-5554 shell am start -n md.bank.app/.MainActivity',
    ]);
  });

  it('launch passes a full pkg/Activity component through unchanged', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn })
      .launch('md.bank.app', { activity: 'md.bank.app/md.bank.ShareActivity' });
    expect(calls[0]).toBe('adb -s emulator-5554 shell am start -n md.bank.app/md.bank.ShareActivity');
  });

  it('launch with an intent builds am start action/data/type/categories/extras', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).launch('md.bank.app', {
      activity: '.ShareActivity',
      intent: {
        action: 'android.intent.action.SEND',
        mimeType: 'image/png',
        categories: ['android.intent.category.DEFAULT'],
        extras: { qr: 'payload' },
      },
    });
    expect(calls[0]).toBe(
      'adb -s emulator-5554 shell am start -n md.bank.app/.ShareActivity ' +
        '-a android.intent.action.SEND -t image/png -c android.intent.category.DEFAULT --es qr payload',
    );
  });

  // 2026-10-03: an intent without an activity is scoped to the package, and
  // an `am start` that says it started nothing is an error. argv, not the
  // joined string: `-p` and its value are two arguments to adb.
  describe('launch — an intent without an activity, and am start failures', () => {
    const SEND = { action: 'android.intent.action.SEND', mimeType: 'text/plain' };
    type Answer = { stdout?: string; stderr?: string } | Error;
    /** Records argv; `am start` (and, if given, `pm clear`) answers with the given streams, or throws the given error. */
    const amAnswers = (answer: Answer = {}, pmClear: Answer = {}) => {
      const argvs: string[][] = [];
      const fn: ExecFn = async (_cmd, args) => {
        argvs.push(args);
        const reply = args.includes('am') ? answer : args.includes('pm') ? pmClear : {};
        if (reply instanceof Error) throw reply;
        return { stdout: Buffer.from(reply.stdout ?? ''), stderr: reply.stderr ?? '' };
      };
      return { adapter: new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn }), argvs };
    };
    const UNRESOLVED =
      'Error: Activity not started, unable to resolve Intent { act=android.intent.action.SEND typ=text/plain flg=0x10000000 pkg=md.bank.app }';

    it('an intent and no activity → am start -p <package>: the intent stays inside the app', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { intent: { ...SEND, data: 'bank://pay', categories: ['c.D'], extras: { k: 'v' } } });
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-p', 'md.bank.app', '-a', 'android.intent.action.SEND',
          '-d', 'bank://pay', '-t', 'text/plain', '-c', 'c.D', '--es', 'k', 'v'],
      ]);
    });

    it('an intent WITH an activity → -n names the component, and there is no -p beside it', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { activity: '.ShareActivity', intent: SEND });
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-n', 'md.bank.app/.ShareActivity', '-a', 'android.intent.action.SEND', '-t', 'text/plain'],
      ]);
    });

    it('an activity alone → -n only; neither → the monkey launcher pick, no am start', async () => {
      const { adapter, argvs } = amAnswers();
      await adapter.launch('md.bank.app', { activity: '.MainActivity' });
      await adapter.launch('md.bank.app');
      expect(argvs).toEqual([
        ['-s', 'e', 'shell', 'am', 'start', '-n', 'md.bank.app/.MainActivity'],
        ['-s', 'e', 'shell', 'monkey', '-p', 'md.bank.app', '-c', 'android.intent.category.LAUNCHER', '1'],
      ]);
    });

    const noActivityStarted = (said: string) =>
      'Android started no activity in md.bank.app for this intent (action android.intent.action.SEND, mime type text/plain) — ' +
      "an intent without an activity is delivered within the app's package. Either no exported activity there " +
      'declares a matching <intent-filter> (with category DEFAULT), or the one that does refused the launch ' +
      "(not exported / permission — am's message below says which). Fix the action/mime type or the manifest, " +
      `or name the activity explicitly: \`activity:\` on the launch step / launch_app. am start said: ${said}`;
    const messageOf = (launching: Promise<unknown>) => launching.then(() => 'resolved', (e: Error) => e.message);

    it.each([
      ['on stderr', { stdout: 'Starting: Intent { act=android.intent.action.SEND }\n', stderr: `${UNRESOLVED}\n` }],
      ['folded into stdout', { stdout: `Starting: Intent { act=android.intent.action.SEND }\n${UNRESOLVED}\n` }],
      ['with a non-zero exit', execErrorLikeExec('adb -s e shell am start', 1, `${UNRESOLVED}\n`)],
    ])('"unable to resolve Intent" %s → throws: nothing started in the package, and how to recover', async (_where, answer) => {
      const { adapter } = amAnswers(answer);
      expect(await messageOf(adapter.launch('md.bank.app', { intent: SEND }))).toBe(noActivityStarted(UNRESOLVED));
    });

    // The activity EXISTS here and refused: the message must not say none
    // handles the intent. am prints no `Error` line for it, only the exception.
    it('a refused launch (SecurityException, exit 255) → throws the same message, quoting the exception line', async () => {
      const DENIAL =
        'java.lang.SecurityException: Permission Denial: starting Intent { act=android.intent.action.SEND typ=text/plain pkg=md.bank.app ' +
        'cmp=md.bank.app/.ShareActivity } from null (pid=4242, uid=2000) not exported from uid 10190';
      const { adapter } = amAnswers(
        execErrorLikeExec(
          'adb -s e shell am start',
          255,
          `\nException occurred while executing 'start':\n${DENIAL}\n\tat com.android.server.wm.ActivityStarter.execute(ActivityStarter.java:1)\n`,
        ),
      );
      expect(await messageOf(adapter.launch('md.bank.app', { intent: SEND }))).toBe(noActivityStarted(DENIAL));
    });

    it('an explicit activity that does not exist → throws, naming the component and both of am\'s lines', async () => {
      const { adapter } = amAnswers({
        stdout: 'Starting: Intent { cmp=md.bank.app/.Missing }\n',
        stderr: 'Error type 3\nError: Activity class {md.bank.app/md.bank.app.Missing} does not exist.\n',
      });
      expect(await messageOf(adapter.launch('md.bank.app', { activity: '.Missing' }))).toBe(
        "Could not start md.bank.app/.Missing — check the activity name (the launch's `activity`, or " +
          'app.android.activity in averi.yaml), that the activity is exported, and that md.bank.app is installed. ' +
          'am start said: Error type 3 / Error: Activity class {md.bank.app/md.bank.app.Missing} does not exist.',
      );
    });

    it("a full other.pkg/Activity component → the message names THAT package as the one to install", async () => {
      const { adapter } = amAnswers({ stderr: 'Error type 3\n' });
      expect(await messageOf(adapter.launch('md.bank.app', { activity: 'com.other/.Entry' }))).toBe(
        "Could not start com.other/.Entry — check the activity name (the launch's `activity`, or " +
          'app.android.activity in averi.yaml), that the activity is exported, and that com.other is installed. ' +
          'am start said: Error type 3',
      );
    });

    // What a SUCCESSFUL am start may print — the row-per-case table is
    // runStart's (tests/adapters/android-start.test.ts); this row only pins
    // that the launch reads its am start through it.
    it('a launch whose echoed intent has "Error" mid-line resolves', async () => {
      const printed = 'Starting: Intent { act=android.intent.action.VIEW dat=app://x/Error/y pkg=md.bank.app }\n';
      await expect(amAnswers({ stdout: printed }).adapter.launch('md.bank.app', { intent: SEND })).resolves.toEqual({});
    });

    it('a timed-out am start passes through as the timeout, whatever it had printed', async () => {
      const timedOut = execErrorLikeExec('adb -s e shell am start', null, `${UNRESOLVED}\n`, { timedOut: true });
      await expect(amAnswers(timedOut).adapter.launch('md.bank.app', { intent: SEND })).rejects.toBe(timedOut);
    });

    it.each([
      ['a non-zero exit', execErrorLikeExec('adb -s e shell pm clear md.bank.app', 1, 'Error: java.lang.SecurityException: PID 4242 does not have permission\n')],
    ])('pm clear is not am start: %s with an Error line is passed through, and nothing is launched', async (_how, failure) => {
      const { adapter, argvs } = amAnswers({}, failure);
      await expect(adapter.launch('md.bank.app', { clearState: true, intent: SEND })).rejects.toBe(failure);
      expect(argvs).toEqual([['-s', 'e', 'shell', 'pm', 'clear', 'md.bank.app']]);
    });

    it('pm clear printing an Error line with exit 0 does not fail the launch here (its output is not am\'s)', async () => {
      const { adapter, argvs } = amAnswers({}, { stdout: 'Error: something pm said\n' });
      await expect(adapter.launch('md.bank.app', { clearState: true, intent: SEND })).resolves.toEqual({});
      expect(argvs).toHaveLength(2);
    });

    it('a Warning is not a failure: a warm launch that only fronts the task resolves', async () => {
      const { adapter } = amAnswers({
        stdout: 'Starting: Intent { cmp=md.bank.app/.MainActivity }\n',
        stderr: 'Warning: Activity not started, its current task has been brought to the front\n',
      });
      await expect(adapter.launch('md.bank.app', { activity: '.MainActivity' })).resolves.toEqual({});
    });

    it('an adb failure that is not am\'s diagnosis passes through as it is', async () => {
      const offline = execErrorLikeExec('adb -s e shell am start', 255, "adb: device 'e' not found\n");
      const { adapter } = amAnswers(offline);
      await expect(adapter.launch('md.bank.app', { intent: SEND })).rejects.toBe(offline);
    });
  });

  // 2026-10-07: openDeepLink and the monkey launch read their start through
  // runStart too (android-start.ts) — the classification is pinned there;
  // these pin that each caller uses it and what its refusal says.
  describe('openDeepLink and the monkey launch — a start that started nothing throws', () => {
    /** Every adb call answers with the given streams, or throws the given error. */
    const answering = (answer: { stdout?: string; stderr?: string } | Error) => {
      const fn: ExecFn = async () => {
        if (answer instanceof Error) throw answer;
        return { stdout: Buffer.from(answer.stdout ?? ''), stderr: answer.stderr ?? '' };
      };
      return new AndroidAdapter({ drawnOverStrip, serial: 'e', exec: fn });
    };
    const messageOf = (starting: Promise<unknown>) => starting.then(() => 'resolved', (e: Error) => e.message);
    const UNRESOLVED_VIEW =
      'Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW dat=nosuch://x flg=0x10000000 }';

    it('a deep link nothing handles (am exits 0 with an Error line) → throws, naming the url and quoting am', async () => {
      const adapter = answering({ stdout: 'Starting: Intent { act=android.intent.action.VIEW dat=nosuch://x }\n', stderr: `${UNRESOLVED_VIEW}\n` });
      expect(await messageOf(adapter.openDeepLink('nosuch://x'))).toBe(
        "Android opened nothing for nosuch://x — either no installed app has an activity whose intent filter " +
          "matches it (action VIEW and the url's scheme / host / path), or the one that does refused it " +
          "(not exported / permission — am's message below says which). Check the url, and that the app " +
          `meant to handle it is installed. am start said: ${UNRESOLVED_VIEW}`,
      );
    });

    it('a refusal at exit 0 has no cause, and no own `cause: undefined` either', async () => {
      const error = await answering({ stderr: `${UNRESOLVED_VIEW}\n` }).openDeepLink('nosuch://x').catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect(Object.hasOwn(error as Error, 'cause')).toBe(false);
    });

    it('a deep link that started an activity resolves; an adb failure passes through as it is', async () => {
      await expect(answering({ stdout: 'Starting: Intent { act=android.intent.action.VIEW dat=bank://home }\n' }).openDeepLink('bank://home'))
        .resolves.toBeUndefined();
      const offline = execErrorLikeExec('adb -s e shell am start', 255, "adb: device 'e' not found\n");
      await expect(answering(offline).openDeepLink('bank://home')).rejects.toBe(offline);
    });

    it("the monkey launch refused (exit 252, reason on stdout) → throws with monkey's reason and the way out", async () => {
      const failure = execErrorLikeExec('adb -s e shell monkey', 252, '', { stdout: '** No activities found to run, monkey aborted.\n' });
      const launching = answering(failure).launch('md.bank.app');
      await expect(launching).rejects.toMatchObject({ cause: failure });
      expect(await messageOf(launching)).toBe(
        'monkey started nothing in md.bank.app — check that md.bank.app is installed and has a launcher ' +
          'activity, or name the activity to start: `activity:` on the launch step / launch_app, or ' +
          'app.android.activity in averi.yaml — or monkey itself could not run; its line says which. ' +
          'monkey said: ** No activities found to run, monkey aborted.',
      );
    });

    it('the monkey launch: exit 0 resolves; an adb failure passes through as it is', async () => {
      await expect(answering({}).launch('md.bank.app')).resolves.toEqual({});
      const offline = execErrorLikeExec('adb -s e shell monkey', 255, "adb: device 'e' not found\n");
      await expect(answering(offline).launch('md.bank.app')).rejects.toBe(offline);
    });
  });

  it('viewport parses wm size (Override beats Physical), says Android windows may sit beside system bars, and caches', async () => {
    const { fn, calls } = fakeExec({
      'adb -s emulator-5554 shell wm size': 'Physical size: 1080x2280\nOverride size: 1000x2000\n',
    });
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    const screen = { width: 1000, height: 2000, windowsBesideSystemBars: true };
    expect(await adapter.viewport()).toEqual(screen);
    expect(await adapter.viewport()).toEqual(screen);
    expect(calls.filter((c) => c.includes('wm size'))).toHaveLength(1);
  });

  // adapters/types.ts#viewport since the parity code review (A3, 2026-10-07):
  // a FAILED read is not kept — one transient `wm size` failure used to strip
  // the device-screen witness for the life of the server.
  it('viewport does not memoize a FAILED read: the next call asks wm size again, and its success is kept', async () => {
    const responses: Record<string, string> = { 'adb -s emulator-5554 shell wm size': 'error: device offline\n' };
    const { fn, calls } = fakeExec(responses);
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    await expect(adapter.viewport()).rejects.toThrow(/Cannot parse wm size output/);
    responses['adb -s emulator-5554 shell wm size'] = 'Physical size: 1080x2400\n';
    expect(await adapter.viewport()).toMatchObject({ width: 1080, height: 2400 });
    expect(await adapter.viewport()).toMatchObject({ width: 1080, height: 2400 });
    expect(calls.filter((c) => c.includes('wm size'))).toHaveLength(2);
  });

  it('viewport({ fresh: true }) reads wm size again and replaces the memo — a `wm size` override since the first read', async () => {
    const responses: Record<string, string> = { 'adb -s emulator-5554 shell wm size': 'Physical size: 1080x2220\nOverride size: 720x1600\n' };
    const { fn, calls } = fakeExec(responses);
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    expect(await adapter.viewport()).toMatchObject({ width: 720, height: 1600 });
    responses['adb -s emulator-5554 shell wm size'] = 'Physical size: 1080x2220\n';
    expect(await adapter.viewport()).toMatchObject({ width: 720, height: 1600 }); // memoized
    expect(await adapter.viewport({ fresh: true })).toMatchObject({ width: 1080, height: 2220 });
    expect(await adapter.viewport()).toMatchObject({ width: 1080, height: 2220 }); // the fresh read is the memo now
    expect(calls.filter((c) => c.includes('wm size'))).toHaveLength(2);
  });

  it('clearText moves to end, then one keyevent per call (batches drop events in the IME queue)', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).clearText(2);
    expect(calls).toEqual([
      'adb -s emulator-5554 shell input keyevent 123', // MOVE_END
      'adb -s emulator-5554 shell input keyevent 67',
      'adb -s emulator-5554 shell input keyevent 67',
      'adb -s emulator-5554 shell input keyevent 112',
      'adb -s emulator-5554 shell input keyevent 112',
    ]);
  });

  it('clearText(0) is a no-op', async () => {
    const { fn, calls } = fakeExec({});
    await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).clearText(0);
    expect(calls).toHaveLength(0);
  });
});

describe('typeText pacing (measured anti-flake behaviour)', () => {
  /**
   * The 250ms per character and the 150ms settle after the cursor nudge are
   * not arbitrary: bulk injection and unpaced per-char injection were both
   * measured dropping characters on Compose fields (2026-08-05, 3-of-11 and
   * 5-of-8 respectively). Setting either to 0 must fail, or the next person
   * "simplifying" the delays gets a green suite and a flaky login.
   */
  it('waits 250ms after each character and 150ms after the commit nudge', async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = fakeExec({});
      const waits: number[] = [];
      const spy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
        waits.push(ms ?? 0);
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('abc');
      spy.mockRestore();

      // Three characters paced at 250ms, then the DPAD nudge settle at 150ms.
      expect(waits).toEqual([250, 250, 250, 150]);
      // The nudge itself must still bracket that final wait.
      expect(calls.slice(-2)).toEqual([
        'adb -s emulator-5554 shell input keyevent 21',
        'adb -s emulator-5554 shell input keyevent 22',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  // The "" pin above sees adb calls only; this one sees the 150ms settle, so
  // an early return that drops the key events but keeps the sleep still fails.
  it('waits for nothing on an empty string: no pacing, no settle after a nudge that is not sent', async () => {
    vi.useFakeTimers();
    try {
      const { fn, calls } = fakeExec({});
      const waits: number[] = [];
      const spy = vi.spyOn(global, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
        waits.push(ms ?? 0);
        cb();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);

      await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).typeText('');
      spy.mockRestore();

      expect(waits).toEqual([]);
      expect(calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * `adb shell dumpsys window displays`, captured whole on 2026-10-03 (the app
 * package renamed to com.example.app, nothing else touched):
 * - api33-keyboard-shown: emulator-5554 (Pixel_3a, API 33, 1080x2220), the
 *   Settings search field focused, GBoard up;
 * - api33-keyboard-hidden: the same device with no keyboard up;
 * - api36-no-ime-source: a freshly booted Pixel_4 AVD (API 36, 1080x2280) on
 *   its lock screen — it has not shown a keyboard since boot, and its insets
 *   list has NO ime entry.
 * A keyboard SHOWN on API 34+ was not captured (that AVD is PIN-locked): the
 * `type=ime` line below is built from AOSP's InsetsSource.dump on the layout
 * the API 36 fixture verifies for the other types — from documentation,
 * unverified on a device.
 */
const dumpsys = (name: string) => readFile(new URL(`../fixtures/dumpsys-window-displays-${name}.txt`, import.meta.url), 'utf8');

describe('AndroidAdapter.keyboard.state — is a soft keyboard shown, and which rect does it cover', () => {
  const STATUS_BAR_33 = '        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false';
  const STATUS_BAR_36 = '        InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true flags= sideHint=TOP boundingRects=null';
  const IME_SHOWN_33 = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true insetsRoundedCornerFrame=false';
  const IME_HIDDEN_33 = '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false insetsRoundedCornerFrame=false';
  /** DisplayPolicy's lines, as the real dumps print them. */
  const SHOWING = '    mIsImeShowing=true\n    mImeHeight=756\n';
  const HIDING = '    mIsImeShowing=false\n    mImeHeight=0\n';
  const lines = (...l: string[]) => `    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;

  it('API 33, keyboard shown (real dump): the IME frame, as a rect in screen pixels', async () => {
    expect(parseImeInsets(await dumpsys('api33-keyboard-shown'))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1398, width: 1080, height: 822 }, // frame=[0,1398][1080,2220]
    });
  });

  it('API 33, keyboard hidden (real dump): hidden — visible=false decides, though visibleFrame still holds the nav-bar strip', async () => {
    const dump = await dumpsys('api33-keyboard-hidden');
    expect(dump).toContain('InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false');
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 33, ~0.4 s after back (real line): visible=false with the full frame still set is HIDDEN, not shown', () => {
    const animatingOut = '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=false insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, animatingOut))).toEqual({ state: 'hidden' });
  });

  it('the measured finportal login line (API 33): frame [0,1285][1080,2220]', () => {
    const line = '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true insetsRoundedCornerFrame=false';
    expect(parseImeInsets(lines(STATUS_BAR_33, line))).toEqual({ state: 'shown', frame: { x: 0, y: 1285, width: 1080, height: 935 } });
  });

  it('API 36, no keyboard since boot (real dump): the list reads and has no ime entry — hidden', async () => {
    const dump = await dumpsys('api36-no-ime-source');
    expect(dump).toContain('InsetsSource id=ab460000 type=statusBars frame=[0,0][1080,66] visible=true');
    expect(dump).not.toMatch(/type=ime\b/);
    expect(parseImeInsets(dump)).toEqual({ state: 'hidden' });
  });

  it('API 34+ format, shown and hidden (FROM DOCUMENTATION, unverified on a device): `id=… type=ime`, no visibleFrame', () => {
    const ime = (frame: string, visible: boolean) =>
      `        InsetsSource id=3 type=ime frame=${frame} visible=${visible} flags= sideHint=BOTTOM boundingRects=null`;
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,1344][1080,2280]', true)))).toEqual({
      state: 'shown',
      frame: { x: 0, y: 1344, width: 1080, height: 936 },
    });
    expect(parseImeInsets(lines(STATUS_BAR_36, ime('[0,0][0,0]', false)))).toEqual({ state: 'hidden' });
  });

  // FAIL OPEN: everything below is `unknown` — the callers then behave as
  // they did before the question existed. None of it may read as shown (a
  // guessed frame) or as hidden (dismissKeyboard would stop pressing back).
  it.each([
    ['an empty dump', ''],
    ['a dump with no InsetsSource list at all', 'WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\n  Display: mDisplayId=0\n'],
    ['only the provider/control lines, not the state list', '        mSource=InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visibleFrame=[0,1285][1080,2220] visible=true\n        mControl=InsetsSourceControl type=ITYPE_IME mLeash=x\n'],
    ['a list in a format that does not read (no frame=, no visible=)', '        InsetsSource type=ITYPE_STATUS_BAR bounds=Rect(0, 0 - 1080, 66) shown\n        InsetsSource type=ITYPE_IME bounds=Rect(0, 1285 - 1080, 2220) shown\n'],
    ['an IME entry whose frame does not read', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['an IME entry with no visible=', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220]')],
    ['an IME entry whose visible is neither true nor false', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=maybe')],
    ['an IME entry with only visibleFrame= (it is not the frame)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME visibleFrame=[0,1285][1080,2220] visible=true')],
    ['a visible IME with an EMPTY frame (it says shown but not where)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visible=true')],
    ['two visible IME entries with different frames (two displays)', lines(
      '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=true',
      '        InsetsSource type=ITYPE_IME frame=[0,600][1920,1080] visible=true',
    )],
  ])('unrecognised → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a type that merely CONTAINS "ime" is not the IME: with mIsImeShowing=false the list simply has no ime entry (hidden)', () => {
    const lookalike = '        InsetsSource id=7 type=imeCaptionBar frame=[0,1285][1080,2220] visible=true flags=';
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_36, lookalike))).toEqual({ state: 'hidden' });
  });

  // The second witness (review 2026-10-03): DisplayPolicy's mIsImeShowing
  // line, present in all three real dumps. A false `shown` presses back on a
  // screen with no keyboard; a silent `hidden` switches the guard off. Both
  // become `unknown` wherever the two witnesses disagree or one is missing
  // where it is needed.
  it('the real dumps carry the witness that agrees with them: true beside shown, false beside hidden and beside no-entry', async () => {
    expect(await dumpsys('api33-keyboard-shown')).toMatch(/^ {4}mIsImeShowing=true$/m);
    expect(await dumpsys('api33-keyboard-hidden')).toMatch(/^ {4}mIsImeShowing=false$/m);
    expect(await dumpsys('api36-no-ime-source')).toMatch(/^ {4}mIsImeShowing=false$/m);
  });

  it.each([
    ['two displays, d0 hidden and d1 shown (never display 1\'s frame)', lines(STATUS_BAR_33, IME_HIDDEN_33) + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['two displays whose witnesses disagree', HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['no IME entry and no mIsImeShowing line (a renamed type, an older dump)', lines(STATUS_BAR_36)],
    ['no IME entry with mIsImeShowing=true (a renamed type while a keyboard is up)', SHOWING + lines(STATUS_BAR_36)],
    ['visible=true contradicted by mIsImeShowing=false', HIDING + lines(STATUS_BAR_33, IME_SHOWN_33)],
    ['visible=false contradicted by mIsImeShowing=true', SHOWING + lines(STATUS_BAR_33, IME_HIDDEN_33)],
    ['mIsImeShowing=false but NO InsetsSource list reads (the witness alone is not a recognised format)', HIDING + '  Display: mDisplayId=0\n'],
    ['mIsImeShowing=false beside an IME entry that does not read (it is not "no entry")', HIDING + lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=Rect(0, 1285 - 1080, 2220) visible=true')],
    ['a `visible=` that belongs to a later, longer token (requestedvisible=true)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] requestedvisible=true')],
    ['a `visible=` value that only starts with true (visible=trueish)', lines(STATUS_BAR_33, '        InsetsSource type=ITYPE_IME frame=[0,1285][1080,2220] visible=trueish')],
    ['a `type=` that belongs to a longer token (subtype=ITYPE_IME on another source is not an IME entry; no witness)', lines('        InsetsSource subtype=ITYPE_IME type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true')],
  ])('the witnesses disagree or are missing → unknown: %s', (_name, dump) => {
    expect(parseImeInsets(dump)).toEqual({ state: 'unknown' });
  });

  it('a REAL dump truncated before the IME line (the witness is cut off with it, or says true) is unknown, never hidden', async () => {
    const shown = await dumpsys('api33-keyboard-shown');
    const cut = shown.slice(0, shown.indexOf('        InsetsSource type=ITYPE_IME'));
    expect(cut).toContain('InsetsSource type=ITYPE_STATUS_BAR'); // the list was being printed
    expect(parseImeInsets(cut)).toEqual({ state: 'unknown' }); // mIsImeShowing=true, no entry
    expect(parseImeInsets(cut.replace(/^ *mIsImeShowing=.*\n/m, ''))).toEqual({ state: 'unknown' }); // no witness at all
  });

  it('when both witnesses are there and agree, or the entry speaks alone (mIsImeShowing absent — API 30–32, unverified), the entry decides', () => {
    const frame = { x: 0, y: 1398, width: 1080, height: 822 };
    expect(parseImeInsets(SHOWING + lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_SHOWN_33))).toEqual({ state: 'shown', frame });
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets(lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // `mIsImeShowing=true` MID-LINE, after other text, is not the DisplayPolicy field: it must be ignored,
    // so it neither contradicts a hidden entry nor disagrees with the real witness line.
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mLastState={foo=1 mIsImeShowing=true}\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Each anchor on its own: text BEFORE the token (nothing after), and text AFTER the value (nothing before).
    expect(parseImeInsets('    mLastState: foo=1 mIsImeShowing=true\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    expect(parseImeInsets('    mIsImeShowing=true mImeHeight=756\n' + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
    // Two displays that agree are not a contradiction.
    expect(parseImeInsets(HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33) + HIDING + lines(STATUS_BAR_33, IME_HIDDEN_33))).toEqual({ state: 'hidden' });
  });

  it('is exactly one adb call — `shell dumpsys window displays`, with a 2 s budget — and is asked afresh every time', async () => {
    const calls: { full: string; timeoutMs?: number }[] = [];
    const dump = await dumpsys('api33-keyboard-shown');
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ full: [cmd, ...args].join(' '), timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(dump), stderr: '' };
    };
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    expect((await adapter.keyboard.state()).state).toBe('shown');
    expect(calls).toEqual([{ full: 'adb -s emulator-5554 shell dumpsys window displays', timeoutMs: 2_000 }]);
    await adapter.keyboard.state();
    expect(calls).toHaveLength(2); // not memoized: the answer changes with every focus
  });

  it.each([
    ['adb exits non-zero', execErrorLikeExec('adb shell dumpsys window displays', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell dumpsys window displays', null, '', { timedOut: true })],
    ['adb cannot be spawned', new Error('spawn adb ENOENT')],
  ])('a failing call does not throw into the tap — %s → unknown', async (_name, failure) => {
    const fn: ExecFn = async () => {
      throw failure;
    };
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).keyboard.state()).resolves.toEqual({ state: 'unknown' });
  });

  // The guard driven end to end through this adapter — the adb call order of
  // a dismissal and of the stale-window wait — is tests/integration/android-keyboard.test.ts
  // (moved 2026-10-04: it pinned interact/'s cadence from the adapter's test file).
});

/**
 * The system status bar's band (2026-10-12, docs/bugs/2026-10-10-android-tap-
 * and-scroll-until-treat-the-system-status-bar-as-app-screen.md): Google
 * Contacts draws edge-to-edge, and with its app bar collapsed uiautomator
 * dumps `text 'All contacts' 149,0 213x6` under the status bar — a tap at
 * (256,3) went to the status bar. The adapter reports the VISIBLE status
 * bar's height as `DeviceScreen.statusBand`, read out of the same
 * `dumpsys window displays` the keyboard state reads, with the screen size.
 */
describe('AndroidAdapter.viewport — the status band, out of `dumpsys window displays`', () => {
  const STATUS_33 = (frame: string, visible = 'true') => `        InsetsSource type=ITYPE_STATUS_BAR frame=${frame} visible=${visible} insetsRoundedCornerFrame=false`;
  const STATUS_36 = (frame: string, visible = 'true') =>
    `        InsetsSource id=ab460000 type=statusBars frame=${frame} visible=${visible} flags= sideHint=TOP boundingRects=null`;
  const NAV_33 = '        InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true insetsRoundedCornerFrame=false';
  const lines = (...l: string[]) => `    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;

  it('the real dumps: API 33 `type=ITYPE_STATUS_BAR frame=[0,0][1080,66]` and API 36 `type=statusBars frame=[0,0][1080,66]` both read 66', async () => {
    expect(parseStatusBand(await dumpsys('api33-keyboard-hidden'))).toBe(66);
    expect(parseStatusBand(await dumpsys('api33-keyboard-shown'))).toBe(66);
    expect(parseStatusBand(await dumpsys('api36-no-ime-source'))).toBe(66);
  });

  it('the band is the frame\'s bottom — a taller bar (a display cutout) is read as it is; the provider\'s `mSource=InsetsSource …` copy is not a second entry', () => {
    expect(parseStatusBand(lines(STATUS_36('[0,0][1080,145]'), NAV_33))).toBe(145);
    expect(parseStatusBand(`${lines(STATUS_33('[0,0][1080,66]'))}        mSource=InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,99] visible=true\n`)).toBe(66);
  });

  it.each([
    ['the bar hidden (an immersive or full-screen app): visible=false', lines(STATUS_33('[0,0][1080,66]', 'false'), NAV_33)],
    ['no status-bar entry at all', lines(NAV_33)],
    ['an empty dump', ''],
    ['an entry that does not read fully (no visible=)', '        InsetsSource type=statusBars frame=[0,0][1080,66] flags=\n'],
    ['an empty frame', lines(STATUS_36('[0,0][0,0]'))],
    ['a frame that does not start at the screen\'s top', lines(STATUS_36('[0,2154][1080,2220]'))],
    ['two displays whose bars disagree (66 and hidden)', lines(STATUS_33('[0,0][1080,66]')) + lines(STATUS_33('[0,0][1080,66]', 'false'))],
    ['two displays whose bars disagree (66 and 80)', lines(STATUS_36('[0,0][1080,66]')) + lines(STATUS_36('[0,0][1920,80]'))],
  ])('no band — fail open, as before the band existed — on %s', (_name, dump) => {
    expect(parseStatusBand(dump)).toBeUndefined();
  });

  it('two displays whose bars agree read as the one band', () => {
    expect(parseStatusBand(lines(STATUS_33('[0,0][1080,66]')) + lines(STATUS_33('[0,0][1080,66]')))).toBe(66);
  });

  it('viewport reads wm size, then `dumpsys window displays` with a 2 s budget, and reports the band with the screen — both memoized', async () => {
    const dump = await dumpsys('api33-keyboard-hidden');
    const calls: { full: string; timeoutMs?: number }[] = [];
    const fn: ExecFn = async (cmd, args, opts) => {
      const full = [cmd, ...args].join(' ');
      calls.push({ full, timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(full.endsWith('wm size') ? 'Physical size: 1080x2220\n' : dump), stderr: '' };
    };
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    const screen = { width: 1080, height: 2220, windowsBesideSystemBars: true, statusBand: 66, navigationBand: 2154 };
    expect(await adapter.viewport()).toEqual(screen);
    expect(await adapter.viewport()).toEqual(screen);
    expect(calls.map((c) => c.full)).toEqual(['adb -s emulator-5554 shell wm size', 'adb -s emulator-5554 shell dumpsys window displays']);
    expect(calls[1].timeoutMs).toBe(2_000);
  });

  it('viewport({ fresh: true }) reads the band again: a status bar an app has hidden since the first read is gone from the memo', async () => {
    let hidden = false;
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      const out = full.endsWith('wm size') ? 'Physical size: 1080x2220\n' : lines(STATUS_33('[0,0][1080,66]', String(!hidden)));
      return { stdout: Buffer.from(out), stderr: '' };
    };
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    expect((await adapter.viewport()).statusBand).toBe(66);
    hidden = true;
    expect((await adapter.viewport()).statusBand).toBe(66); // memoized
    expect(await adapter.viewport({ fresh: true })).toEqual({ width: 1080, height: 2220, windowsBesideSystemBars: true });
  });

  /** An adb whose status-bar answer is `bar()` — a dump line, or an error to throw — counting the band reads. */
  const scripted = (bar: () => string | Error) => {
    const reads: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.endsWith('wm size')) return { stdout: Buffer.from('Physical size: 1080x2220\n'), stderr: '' };
      if (full.endsWith('dumpsys window displays')) {
        reads.push(full);
        const answer = bar();
        if (answer instanceof Error) throw answer;
        return { stdout: Buffer.from(answer), stderr: '' };
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    return { adapter: new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }), reads };
  };

  // Code review of fix/r8-band, round 1, MAJOR-1: the registry keeps one adapter per device for the server's life,
  // and a failed first read was kept as "no band" — a cold device's 2 s timeout switched N1's fix off for good.
  it('a band read that FAILED FAST (adb exits non-zero) is not kept: the next viewport() asks again, and the first answer is kept', async () => {
    let answer: string | Error = execErrorLikeExec('adb shell dumpsys window displays', 1, 'error: closed');
    const { adapter, reads } = scripted(() => answer);
    expect((await adapter.viewport()).statusBand).toBeUndefined(); // fail open
    answer = lines(STATUS_33('[0,0][1080,66]'));
    expect((await adapter.viewport()).statusBand).toBe(66);
    expect((await adapter.viewport()).statusBand).toBe(66);
    expect(reads).toHaveLength(2); // the failure, the answer — then kept
  });

  // Code review of fix/r8-band, round 2: retried every call, a hung dumpsys cost up to 2 s on each viewport().
  it('a band read that TIMED OUT is kept as no band: the next viewport() makes no dumpsys call — until launch, or a fresh read', async () => {
    let answer: string | Error = execErrorLikeExec('adb shell dumpsys window displays', null, '', { timedOut: true });
    const { adapter, reads } = scripted(() => answer);
    expect((await adapter.viewport()).statusBand).toBeUndefined(); // fail open
    answer = lines(STATUS_33('[0,0][1080,66]'));
    expect((await adapter.viewport()).statusBand).toBeUndefined();
    expect(reads).toHaveLength(1); // not asked again
    await adapter.launch('com.google.android.contacts');
    expect((await adapter.viewport()).statusBand).toBe(66);
    expect(reads).toHaveLength(2);
    answer = execErrorLikeExec('adb shell dumpsys window displays', null, '', { timedOut: true });
    await adapter.viewport({ fresh: true });
    answer = lines(STATUS_33('[0,0][1080,66]'));
    expect((await adapter.viewport()).statusBand).toBeUndefined(); // the fresh read timed out: kept as none
    expect((await adapter.viewport({ fresh: true })).statusBand).toBe(66);
    expect(reads).toHaveLength(4);
  });

  it('an ANSWER of no band (the bar hidden) is kept, like a band — and launch drops either, so the next viewport() reads it again', async () => {
    let hidden = true;
    const { adapter, reads } = scripted(() => lines(STATUS_33('[0,0][1080,66]', String(!hidden))));
    expect((await adapter.viewport()).statusBand).toBeUndefined();
    hidden = false;
    expect((await adapter.viewport()).statusBand).toBeUndefined(); // kept: no launch, no fresh read
    expect(reads).toHaveLength(1);
    await adapter.launch('com.google.android.contacts');
    expect((await adapter.viewport()).statusBand).toBe(66);
    hidden = true;
    await adapter.launch('com.example.player');
    expect((await adapter.viewport()).statusBand).toBeUndefined();
    expect(reads).toHaveLength(3);
  });

  it('a band read in flight when launch runs keeps no answer: the next viewport() reads the new app\'s bar', async () => {
    let release: (out: string) => void = () => {};
    let reads = 0;
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      if (full.endsWith('wm size')) return { stdout: Buffer.from('Physical size: 1080x2220\n'), stderr: '' };
      if (full.endsWith('dumpsys window displays')) {
        reads++;
        if (reads === 1) return { stdout: Buffer.from(await new Promise<string>((r) => (release = r))), stderr: '' };
        return { stdout: Buffer.from(lines(STATUS_33('[0,0][1080,66]', 'false'))), stderr: '' };
      }
      return { stdout: Buffer.alloc(0), stderr: '' };
    };
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    const before = adapter.viewport();
    await vi.waitFor(() => expect(reads).toBe(1));
    await adapter.launch('com.example.player');
    release(lines(STATUS_33('[0,0][1080,66]'))); // the previous app's bar, answered after the launch
    expect((await before).statusBand).toBe(66);
    expect((await adapter.viewport()).statusBand).toBeUndefined(); // read again: the player hides it
    expect(reads).toBe(2);
  });

  it('concurrent viewport() calls share one band read', async () => {
    const { adapter, reads } = scripted(() => lines(STATUS_36('[0,0][1080,66]')));
    const screens = await Promise.all([adapter.viewport(), adapter.viewport(), adapter.viewport()]);
    expect(screens.map((sc) => sc.statusBand)).toEqual([66, 66, 66]);
    expect(reads).toHaveLength(1);
  });

  it.each([
    ['adb exits non-zero', execErrorLikeExec('adb shell dumpsys window displays', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell dumpsys window displays', null, '', { timedOut: true })],
  ])('a failing band read does not fail the screen — %s → the size, no band', async (_name, failure) => {
    const fn: ExecFn = async (cmd, args) => {
      if ([cmd, ...args].join(' ').endsWith('wm size')) return { stdout: Buffer.from('Physical size: 1080x2220\n'), stderr: '' };
      throw failure;
    };
    expect(await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).viewport()).toEqual({ width: 1080, height: 2220, windowsBesideSystemBars: true });
  });
});

/**
 * The navigation bar's band (data only: nothing judges it yet; mp-native draws edge-to-edge, and its rows lie in
 * 2154–2220 under the bar on the measured 1080x2220 emulator): read out of the same `dumpsys window displays` call
 * as the status band — its TOP, of a visible full-width frame that ends at the bottom of the display the dump
 * describes (`DisplayFrames w=… h=… r=0`).
 */
describe('parseNavigationBand — the visible navigation bar\'s top, out of `dumpsys window displays`', () => {
  const NAV_33 = (frame: string, visible = 'true') => `        InsetsSource type=ITYPE_NAVIGATION_BAR frame=${frame} visible=${visible} insetsRoundedCornerFrame=false`;
  const NAV_36 = (frame: string, visible = 'true') =>
    `        InsetsSource id=ab460001 type=navigationBars frame=${frame} visible=${visible} flags= sideHint=BOTTOM boundingRects=null`;
  const STATUS_33 = '        InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,66] visible=true insetsRoundedCornerFrame=false';
  const FRAMES = (w = 1080, h = 2220, r = 0) => `  DisplayFrames w=${w} h=${h} r=${r}`;
  /** One display: its DisplayFrames line (default the measured 1080x2220, unrotated), then its InsetsState entries. */
  const display = (frames: string, ...l: string[]) => `${frames}\n    mInsetsState:\n${l.join('\n')}\n    InsetsSourceProviders:\n`;
  const lines = (...l: string[]) => display(FRAMES(), ...l);

  it('the real API 33 dumps, keyboard hidden and shown: `DisplayFrames w=1080 h=2220 r=0` and `type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080,2220] visible=true` read 2154', async () => {
    expect(parseNavigationBand(await dumpsys('api33-keyboard-hidden'))).toBe(2154);
    expect(parseNavigationBand(await dumpsys('api33-keyboard-shown'))).toBe(2154);
  });

  it('API 14+\'s `type=navigationBars` reads alike; a taller 3-button bar reads its own top; the provider\'s `mSource=` copy is no second entry', () => {
    expect(parseNavigationBand(lines(STATUS_33, NAV_36('[0,2154][1080,2220]')))).toBe(2154);
    expect(parseNavigationBand(lines(NAV_36('[0,2094][1080,2220]')))).toBe(2094);
    expect(parseNavigationBand(`${lines(NAV_33('[0,2154][1080,2220]'))}        mSource=InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2000][1080,2220] visible=true\n`)).toBe(2154);
    expect(parseNavigationBand(display(FRAMES(1080, 2280), NAV_36('[0,2214][1080,2280]')))).toBe(2214); // the display's own height, whatever it is
  });

  it.each([
    ['the bar hidden (an immersive app): visible=false', lines(STATUS_33, NAV_33('[0,2154][1080,2220]', 'false'))],
    ['no navigation-bar entry at all', lines(STATUS_33)],
    ['an empty dump', ''],
    ['a frame that does not end at the display\'s bottom', lines(NAV_33('[0,2088][1080,2154]'))],
    ['a frame that ends at 2220 on a display 2280 tall', display(FRAMES(1080, 2280), NAV_33('[0,2154][1080,2220]'))],
    ['a bar at the LEFT side, running to the bottom', lines(NAV_33('[0,0][126,2220]'))],
    ['a bar at the RIGHT side, running to the bottom', lines(NAV_33('[954,0][1080,2220]'))],
    ['a frame from above the screen\'s top', lines(NAV_33('[0,-10][1080,2220]'))],
    ['a frame half the display wide', lines(NAV_33('[0,2154][540,2220]'))],
    ['a frame the display\'s width shifted off its left edge', lines(NAV_33('[10,2154][1090,2220]'))],
    ['a frame taller than it is wide (all but the top 10 px)', lines(NAV_33('[0,10][1080,2220]'))],
    ['a frame the whole display (a natural-landscape tablet, r=0)', display(FRAMES(2220, 1080), NAV_33('[0,0][2220,1080]'))],
    ['a turned display (r=1), its bar at the bottom of the turned frame — portrait only', display(FRAMES(2220, 1080, 1), NAV_33('[0,1014][2220,1080]'))],
    ['no DisplayFrames line (the display\'s size unsaid)', `    mInsetsState:\n${NAV_33('[0,2154][1080,2220]')}\n`],
    ['two displays of different sizes, their bars alike', lines(NAV_33('[0,2154][1080,2220]')) + display(FRAMES(1080, 2280), NAV_33('[0,2154][1080,2220]'))],
    ['an entry that does not read fully (no visible=)', display(FRAMES(), '        InsetsSource type=navigationBars frame=[0,2154][1080,2220] flags=')],
    ['a malformed frame', lines('        InsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2154][1080] visible=true')],
    ['an empty frame', lines(NAV_36('[0,2220][1080,2220]'))],
    ['two displays whose bars disagree (2154 and hidden)', lines(NAV_33('[0,2154][1080,2220]')) + lines(NAV_33('[0,2154][1080,2220]', 'false'))],
  ])('no band on %s', (_name, dump) => {
    expect(parseNavigationBand(dump)).toBeUndefined();
  });

  it('the API 36 fixture (a Pixel_4 AVD, 1080x2280) lists no navigation bar: no band', async () => {
    expect(parseNavigationBand(await dumpsys('api36-no-ime-source'))).toBeUndefined();
  });

  it('viewport reports it beside the status band, out of the one `dumpsys window displays` call, memoized with it', async () => {
    const calls: string[] = [];
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      calls.push(full);
      return { stdout: Buffer.from(full.endsWith('wm size') ? 'Physical size: 1080x2220\n' : lines(STATUS_33, NAV_33('[0,2154][1080,2220]'))), stderr: '' };
    };
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    const screen = { width: 1080, height: 2220, windowsBesideSystemBars: true, statusBand: 66, navigationBand: 2154 };
    expect(await adapter.viewport()).toEqual(screen);
    expect(await adapter.viewport()).toEqual(screen);
    expect(calls).toEqual(['adb -s emulator-5554 shell wm size', 'adb -s emulator-5554 shell dumpsys window displays']);
  });

  it('viewport on a 1080x2280 display whose dump puts the bar\'s bottom at 2220: no band — the display\'s own height decides', async () => {
    const fn: ExecFn = async (cmd, args) => {
      const full = [cmd, ...args].join(' ');
      return { stdout: Buffer.from(full.endsWith('wm size') ? 'Physical size: 1080x2280\n' : display(FRAMES(1080, 2280), STATUS_33, NAV_33('[0,2154][1080,2220]'))), stderr: '' };
    };
    expect(await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).viewport()).toEqual({ width: 1080, height: 2280, windowsBesideSystemBars: true, statusBand: 66 });
  });
});

describe('AndroidAdapter.keyboard.witness — the input method\'s own word, asked before a keyboard back', () => {
  it('reads mInputShown=true as shown and mInputShown=false as hidden (the real line)', () => {
    expect(parseInputShown(INPUT_SHOWN_LINE(true))).toBe('shown');
    expect(parseInputShown(INPUT_SHOWN_LINE(false))).toBe('hidden');
    expect(parseInputShown('mInputShown=true')).toBe('shown'); // the word alone, no newline
    expect(parseInputShown('  mInputShown=false mOther=1\n')).toBe('hidden'); // not necessarily last on the line
  });

  it.each([
    ['empty output', ''],
    ['no such word', '  mShowRequested=false mShowForced=false\n'],
    ['a value that only STARTS with true (mInputShown=trueish; "truthy" too)', '  mShowForced=false mInputShown=trueish\n  mInputShown=truthy\n'],
    ['a value that only starts with false (mInputShown=falsey)', '  mShowForced=false mInputShown=falsey\n'],
    ['a value that is neither (mInputShown=1)', '  mInputShown=1\n'],
    ['a value in another case (mInputShown=TRUE)', '  mInputShown=TRUE\n'],
    ['a value in another case (mInputShown=False)', '  mInputShown=False\n'],
    ['the name in another case (minputshown=true)', '  minputshown=true\n'],
    ['the name as the TAIL of a longer one (mPrevmInputShown=true)', '  mShowForced=false mPrevmInputShown=true\n'],
    ['the name glued to other text mid-word (xmInputShown=false)', '  foo=xmInputShown=false\n'],
    ['two words that disagree', '  mInputShown=true\n  mInputShown=false\n'],
  ])('cannot tell → unknown: %s', (_name, out) => {
    expect(parseInputShown(out)).toBe('unknown');
  });

  it('two words that agree are one answer', () => {
    expect(parseInputShown('  mInputShown=false\n  mInputShown=false\n')).toBe('hidden');
  });

  it('is exactly one adb call, filtered on the device, with its own 2 s budget', async () => {
    const calls: { cmd: string; args: string[]; timeoutMs?: number }[] = [];
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(INPUT_SHOWN_LINE(true)), stderr: '' };
    };
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).keyboard.witness()).resolves.toBe('shown');
    expect(calls).toEqual([
      // ONE argument after `shell`: the device's sh runs the pipe; -w matches the name as a whole word.
      { cmd: 'adb', args: ['-s', 'emulator-5554', 'shell', 'dumpsys input_method | grep -m1 -w mInputShown'], timeoutMs: 2_000 },
    ]);
  });

  it('is NOT memoized: two calls are two queries, and the second answer is the device\'s new one', async () => {
    const outputs = [INPUT_SHOWN_LINE(false), INPUT_SHOWN_LINE(true)];
    let n = 0;
    const fn: ExecFn = async () => ({ stdout: Buffer.from(outputs[n++]), stderr: '' });
    const adapter = new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn });
    expect([await adapter.keyboard.witness(), await adapter.keyboard.witness()]).toEqual(['hidden', 'shown']);
    expect(n).toBe(2);
  });

  it.each([
    ['grep finds no line (exit 1 — an Android that does not print mInputShown)', execErrorLikeExec('adb shell dumpsys input_method | grep -m1 mInputShown', 1, '')],
    ['adb exits non-zero', execErrorLikeExec('adb shell …', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell …', null, '', { timedOut: true })],
    ['adb cannot be spawned', new Error('spawn adb ENOENT')],
  ])('a failing call does not throw — %s → unknown', async (_name, failure) => {
    const fn: ExecFn = async () => {
      throw failure;
    };
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).keyboard.witness()).resolves.toBe('unknown');
  });
});

/**
 * The keyboard window's touchable region with the input method's word, one
 * adb call (2026-10-08, the floating-Gboard device check —
 * docs/bugs/2026-10-05-android-floating-gboard-keyboard.md). The adapter
 * reads; what counts is ui-tree/keyboard-cover.ts#panelsBeyond's (its tests:
 * tests/ui-tree/keyboard-cover.test.ts).
 */
describe('AndroidAdapter.keyboard.touchable — the IME window\'s touchable region, read beside mInputShown', () => {
  it('reads the four measured regions as rects: floating (panel + strip), docked (the band), hidden (the strip), stale landscape', () => {
    expect(parseTouchableRegion(GBOARD.floating.touchable)).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
    expect(parseTouchableRegion(GBOARD.docked.touchable)).toEqual([{ x: 0, y: 1398, width: 1080, height: 822 }]);
    expect(parseTouchableRegion(GBOARD.hidden.touchable)).toEqual([GBOARD_STRIP]);
    expect(parseTouchableRegion(GBOARD.staleLandscape.touchable)).toEqual([{ x: 0, y: 948, width: 2220, height: 132 }]);
  });

  it('any count, any whitespace between the numbers and the groups; an empty region is no rect', () => {
    expect(parseTouchableRegion('    touchable region=SkRegion( ( 359, 1269 ,1040,1912 )  (0,2088,1080,2220) )\n')).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
    expect(parseTouchableRegion('touchable region=SkRegion((0,0,10,10)(0,10,20,20)(5,20,6,30))')).toEqual([
      { x: 0, y: 0, width: 10, height: 10 },
      { x: 0, y: 10, width: 20, height: 10 },
      { x: 5, y: 20, width: 1, height: 10 },
    ]);
    expect(parseTouchableRegion('  touchable region=SkRegion()\n')).toEqual([]);
    // Two lines that say the same thing are one region.
    expect(parseTouchableRegion(GBOARD.floating.touchable + GBOARD.floating.touchable)).toEqual([GBOARD_PANEL, GBOARD_STRIP]);
  });

  it.each([
    ['no such line (grep matched nothing)', '  mInputShown=true\n'],
    ['empty output', ''],
    ['a region that is not wholly (l,t,r,b) groups', '  touchable region=SkRegion((359,1269,1040,1912)junk(0,2088,1080,2220))\n'],
    ['a truncated region', '  touchable region=SkRegion((359,1269,1040\n'],
    ['three numbers to a group', '  touchable region=SkRegion((359,1269,1040))\n'],
    ['another notation', '  touchable region=Region[0,2088][1080,2220]\n'],
    ['a rect with right < left', '  touchable region=SkRegion((1040,1269,359,1912))\n'],
    ['two lines that disagree', GBOARD.floating.touchable + '  touchable region=SkRegion((0,1398,1080,2220))\n'],
    ['a readable line beside one that is not (no line is dropped to make the rest agree)', GBOARD.floating.touchable + '  touchable region=SkRegion((359,1269\n'],
  ])('cannot read → undefined (no panel, the band alone): %s', (_name, out) => {
    expect(parseTouchableRegion(out)).toBeUndefined();
  });

  it('is exactly one adb call — the witness\'s filtered read, then the region\'s, on the device — with a 2 s budget, both answers from it', async () => {
    const calls: { cmd: string; args: string[]; timeoutMs?: number }[] = [];
    const fn: ExecFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, timeoutMs: opts?.timeoutMs });
      return { stdout: Buffer.from(GBOARD.floating.touchable), stderr: '' };
    };
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).keyboard.touchable()).resolves.toEqual({
      witness: 'shown',
      region: [GBOARD_PANEL, GBOARD_STRIP],
    });
    expect(calls).toEqual([
      {
        cmd: 'adb',
        args: ['-s', 'emulator-5554', 'shell', "dumpsys input_method | grep -m1 -w mInputShown; dumpsys window InputMethod | grep -F 'touchable region='; true"],
        timeoutMs: 2_000,
      },
    ]);
  });

  it('either half alone is read: the witness without a region, the region without a witness', async () => {
    const answer = async (out: string) =>
      new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: async () => ({ stdout: Buffer.from(out), stderr: '' }) }).keyboard.touchable();
    await expect(answer(INPUT_SHOWN_LINE(false))).resolves.toEqual({ witness: 'hidden', region: undefined });
    await expect(answer('  touchable region=SkRegion((0,2088,1080,2220))\n')).resolves.toEqual({ witness: 'unknown', region: [GBOARD_STRIP] });
  });

  it.each([
    ['adb exits non-zero', execErrorLikeExec('adb shell …', 1, "error: device 'emulator-5554' not found")],
    ['the call times out', execErrorLikeExec('adb shell …', null, '', { timedOut: true })],
    ['adb cannot be spawned', new Error('spawn adb ENOENT')],
  ])('a failing call does not throw — %s → witness unknown, no region', async (_name, failure) => {
    const fn: ExecFn = async () => {
      throw failure;
    };
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).keyboard.touchable()).resolves.toEqual({ witness: 'unknown', region: undefined });
  });
});

/**
 * `adb exec-out` exits 0 with whatever the guest wrote (2026-10-08,
 * adapters/screenshot-bytes.ts): an empty or non-PNG capture is a transport
 * error naming the device and the command, never bytes handed upward — the
 * stability wait would have read two empty captures as a settled frame.
 */
describe('AndroidAdapter.screenshot — the bytes are a PNG or the call fails', () => {
  const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

  it('passes a capture that starts with the PNG signature through unchanged', async () => {
    const { fn, calls } = fakeExec({ 'adb -s emulator-5554 exec-out screencap -p': PNG_HEAD });
    const shot = await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).screenshot();
    expect(shot.equals(PNG_HEAD)).toBe(true);
    expect(calls).toEqual(['adb -s emulator-5554 exec-out screencap -p']);
  });

  it('the signature alone — exactly 8 bytes — is enough; 7 of them is not', async () => {
    const signature = PNG_HEAD.subarray(0, 8);
    const { fn } = fakeExec({ 'adb -s emulator-5554 exec-out screencap -p': signature });
    expect((await new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).screenshot()).equals(signature)).toBe(true);
    const short = fakeExec({ 'adb -s emulator-5554 exec-out screencap -p': signature.subarray(0, 7) });
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: short.fn }).screenshot()).rejects.toThrow(/returned 7 bytes starting ".PNG/);
  });

  it('an empty capture (exit 0, no bytes) is a transport error naming the device and the command', async () => {
    const { fn } = fakeExec({ 'adb -s emulator-5554 exec-out screencap -p': Buffer.alloc(0) });
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).screenshot()).rejects.toThrow(
      '`adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 0 bytes — not a PNG, though the ' +
        'command reported success: the device transport failed (a dying or hung emulator / simulator), not the app\'s ' +
        'screen. Re-check `adb devices` and retry; if it repeats, the emulator, not the app, needs attention.',
    );
  });

  it('text on stdout (`Killed`, the measured dying-guest shape) is refused too, quoting what came back', async () => {
    const { fn } = fakeExec({ 'adb -s emulator-5554 exec-out screencap -p': 'Killed\n' });
    await expect(new AndroidAdapter({ drawnOverStrip, serial: 'emulator-5554', exec: fn }).screenshot()).rejects.toThrow(
      /^`adb -s emulator-5554 exec-out screencap -p` on device emulator-5554 returned 7 bytes starting "Killed" — not a PNG/,
    );
  });
});
