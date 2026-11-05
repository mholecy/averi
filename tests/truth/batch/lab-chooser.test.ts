import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UiNode } from '../../../src/adapters/types.js';
import { TIMED_OUT, type CallResult } from '../../../scripts/truth/batch/bounded.js';
import {
  acceptedOf,
  CHECK_EXIT,
  checkExit,
  cellsHand,
  CHECK_OUTCOME,
  checkHand,
  checkLine,
  checkWhy,
  chooserOf,
  compareReads,
  comparedLine,
  defaultHand,
  focusOf,
  handlersOf,
  installedOf,
  isAlways,
  lastChosenOf,
  leaksOf,
  missingHand,
  NOT_JUDGED,
  preferredOf,
  sanitizeFixture,
  safeTap,
  shellReadOf,
  stateFileHand,
  stateHand,
  treeOf,
  unflaggedOf,
  unknownInstallHand,
  unreachableOf,
  type AcceptedEntry,
  type Dump,
  type HandBase,
  type RawAttrs,
  type FocusRead,
  type PreferredRead,
} from '../../../scripts/truth/batch/lab-chooser.js';

// scripts/truth/batch/lab-chooser.ts, the pure module: the preferred-activities read over API 33's real dumps (batch-9's
// whole `dumpsys package`, batch-10's `preferred` block), --check's exit, safeTap over T4's committed resolver trees
// (tests/fixtures/uiautomator-lab-resolver*.xml, batch-10's and batch-11's captures) parsed by src's own parser, the
// tri-state reads (batch-9's role holder and clipboard), the handler count and the install read. The calls around them,
// through a recording fake emulator, are tests/truth/batch/lab-emu.test.ts.

const BATCH = join(import.meta.dirname, '..', '..', 'fixtures', 'batch');
const T4 = join(import.meta.dirname, '..', '..', 'fixtures');
const fixture = (name: string): string => readFileSync(join(BATCH, name), 'utf8');
const resolverXml = (selected = false): string => readFileSync(join(T4, `uiautomator-lab-resolver${selected ? '-selected' : ''}.xml`), 'utf8');

const ok = (out = '', err = ''): CallResult => ({ code: 0, timedOut: false, signal: null, out, err });
const exit = (code: number, out = '', err = ''): CallResult => ({ code, timedOut: false, signal: null, out, err });
const timedOut: CallResult = { code: TIMED_OUT, timedOut: true, signal: 'SIGKILL', out: '', err: '' };

/** batch-9's whole `dumpsys package` (printed for `preferred-activities` on API 33), trimmed. */
const WHOLE = fixture('dumpsys-package-api33-b9-whole-trimmed.txt');
/** batch-10's `dumpsys package preferred`: the block alone, Gmail's mailto defaults in it, no lab entry. */
const BLOCK = fixture('dumpsys-package-preferred-api33-b10.txt');

/**
 * A lab entry in the block, in the dump's own shape (Gmail's entries above it): no dump with one was kept in the
 * sources (batch-11's and batch-12's records are not among them), so its words are batch-12's analysis's,
 * `dev.averi.lab/.Twin mMatch=0x300000 mAlways=false` for `shared`, laid out as the block lays out every entry.
 * `flag`: the mMatch line's mAlways, or none at all.
 */
const labEntry = (flag: 'true' | 'false' | 'none', component = 'dev.averi.lab/.Twin', authority = 'shared', scheme = 'averilab'): string =>
  [
    `      ${scheme}:`,
    `        9d3a2b9 ${component}`,
    `         mMatch=0x300000${flag === 'none' ? '' : ` mAlways=${flag}`}`,
    '          Selected from:',
    '            dev.averi.lab/.MainActivity',
    '            dev.averi.lab/.Twin',
    '          Action: "android.intent.action.VIEW"',
    '          Category: "android.intent.category.BROWSABLE"',
    '          Category: "android.intent.category.DEFAULT"',
    `          Scheme: "${scheme}"`,
    `          Authority: "${authority}": -1`,
  ].join('\n');
/** The block with `entries` first under its `Schemes:`. */
const withEntries = (...entries: string[]): string => BLOCK.replace('  Schemes:\n', `  Schemes:\n${entries.join('\n')}\n`);
const readOf = (dump: string): PreferredRead => preferredOf(ok(dump));

const launcher: FocusRead = focusOf(ok(fixture('dumpsys-window-focus-api33-b10-launcher-no-header.txt')));
const chooserUp: FocusRead = focusOf(ok(readFileSync(join(T4, 'dumpsys-window-focus-api33-b10-chooser.txt'), 'utf8')));
const SHARED_TWIN: AcceptedEntry = { authority: 'shared', component: /^dev\.averi\.lab\/\.Twin$/, why: "batch-11 E2's \"Just once\"" };

describe("preferredOf — only the `Preferred Activities User N:` block (d55-b11.ts:117–148; batch-9's whole-dump read)", () => {
  it("API 33's whole dump: the block read, the Activity Resolver Table's averilab handlers never a lab entry (batch-9's INCONCLUSIVE and cleanup ERROR)", () => {
    expect(WHOLE).toContain('Database versions:');
    expect(WHOLE).toContain('9d3a2b9 dev.averi.lab/.Twin');
    expect(readOf(WHOLE)).toEqual({ state: 'read', users: 1, lab: [] });
  });

  it("a dump with no such block is unread, never \"no lab entry\" (batch-9's harness artefact)", () => {
    const head = WHOLE.slice(0, WHOLE.indexOf('Preferred Activities User 0:'));
    expect(readOf(head)).toEqual({ state: 'unread', why: 'no `Preferred Activities User N:` block in the dump' });
    expect(readOf('')).toEqual({ state: 'unread', why: 'no `Preferred Activities User N:` block in the dump' });
    // The header indented, or with words after it, is no block header.
    expect(readOf(BLOCK.replace('Preferred Activities User 0:', ' Preferred Activities User 0:')).state).toBe('unread');
    expect(readOf(BLOCK.replace('Preferred Activities User 0:', 'Preferred Activities User 0: x')).state).toBe('unread');
  });

  it('a read that failed or passed its bound is unread, with its exit', () => {
    expect(preferredOf(exit(1, '', 'error: device offline'))).toEqual({ state: 'unread', why: 'dumpsys package preferred: exit 1 error: device offline' });
    expect(preferredOf({ ...timedOut, out: BLOCK })).toEqual({ state: 'unread', why: `dumpsys package preferred: past its bound (exit ${TIMED_OUT}) Preferred Activities User 0:` });
  });

  it("batch-10's block: Gmail's mailto default (mAlways=true) is no lab leak; CRLF line ends read the same", () => {
    expect(BLOCK).toContain('com.google.android.gm/.ComposeActivityGmailExternal');
    expect(readOf(BLOCK)).toEqual({ state: 'read', users: 1, lab: [] });
    expect(readOf(BLOCK.replace(/\n/g, '\r\n'))).toEqual({ state: 'read', users: 1, lab: [] });
  });

  it('a lab entry: its text, component, mAlways and Authority; true a default, false the last-chosen entry "Just once" writes', () => {
    const p = readOf(withEntries(labEntry('false'), labEntry('true', 'dev.averi.lab/.MainActivity', 'pair')));
    expect(p).toEqual({
      state: 'read',
      users: 1,
      lab: [
        {
          text: '9d3a2b9 dev.averi.lab/.Twin | mMatch=0x300000 mAlways=false | Selected from: | dev.averi.lab/.MainActivity | dev.averi.lab/.Twin | Action: "android.intent.action.VIEW" | Category: "android.intent.category.BROWSABLE" | Category: "android.intent.category.DEFAULT" | Scheme: "averilab" | Authority: "shared": -1',
          component: 'dev.averi.lab/.Twin',
          always: false,
          authority: 'shared',
        },
        expect.objectContaining({ component: 'dev.averi.lab/.MainActivity', always: true, authority: 'pair' }),
      ],
    });
    if (p.state !== 'read') throw new Error('unread');
    expect(leaksOf(p).map((e) => e.component)).toEqual(['dev.averi.lab/.MainActivity']);
    expect(lastChosenOf(p).map((e) => e.component)).toEqual(['dev.averi.lab/.Twin']);
  });

  it('an entry with no mAlways line is neither a default nor last-chosen: it cannot be compared, so --check says unproven (T2 S5 code review); one with no Authority has no authority key', () => {
    const p = readOf(withEntries(labEntry('none').replace('          Authority: "shared": -1', '')));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab).toEqual([expect.objectContaining({ always: undefined })]);
    expect(Object.keys(p.lab[0])).toEqual(['text', 'component', 'always']);
    expect(leaksOf(p)).toEqual([]);
    expect(lastChosenOf(p)).toEqual([]);
    expect(unflaggedOf(p)).toHaveLength(1);
    expect(checkExit(launcher, p, [])).toBe(3);
    expect(checkLine(launcher, p, [])).toMatch(/^D55 check: ERROR — chooser no; preferred read \(1 user\); lab entries 1 \(defaults 0, last-chosen 0, no mAlways 1\); first: /);
    // A default beside it is still a default.
    expect(checkExit(launcher, readOf(withEntries(labEntry('none'), labEntry('true'))), [])).toBe(1);
  });

  it("a lab entry by its component (another scheme) or by its scheme (another app's activity); mAlways read from the entry's first line after it only", () => {
    const https = labEntry('true', 'dev.averi.lab/.MainActivity', 'example.com', 'https');
    const other = labEntry('false', 'com.other.app/.Open');
    // The flag on a later line (a Selected-from component's text) is no mAlways of this entry.
    const late = labEntry('none').replace('            dev.averi.lab/.Twin', '            mAlways=false');
    const p = readOf(withEntries(https, other, late));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab.map((e) => [e.component, e.always])).toEqual([
      ['dev.averi.lab/.MainActivity', true],
      ['com.other.app/.Open', false],
      ['dev.averi.lab/.Twin', undefined],
    ]);
  });

  it("a package only named like the lab's is no lab entry: dev.averi.lab.rn's handler is the RN app's", () => {
    const p = readOf(withEntries(labEntry('true', 'dev.averi.lab.rn/.MainActivity', 'shared', 'averilabrn')));
    expect(p).toEqual({ state: 'read', users: 1, lab: [] });
  });

  it("two users' blocks are both read; the block ends at the next top-level header", () => {
    const two = `${withEntries(labEntry('false'))}\nPreferred Activities User 10:\n  Schemes:\n${labEntry('true')}\n\nDomain verification status:\n${labEntry('true')}\n`;
    const p = readOf(two);
    if (p.state !== 'read') throw new Error('unread');
    expect(p.users).toBe(2);
    expect(p.lab.map((e) => e.always)).toEqual([false, true]);
  });
});

describe('acceptedOf — the last-chosen entries a batch accepts as the lab\'s known state (batch-12 README; pure-b12.ts)', () => {
  it('by Authority and component, both; none without an Authority', () => {
    const p = readOf(withEntries(labEntry('false'), labEntry('false', 'dev.averi.lab/.Twin', 'pair'), labEntry('false').replace('          Authority: "shared": -1', '')));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab.map((e) => acceptedOf(e, [SHARED_TWIN])?.why)).toEqual([SHARED_TWIN.why, undefined, undefined]);
    expect(acceptedOf(p.lab[0], [{ ...SHARED_TWIN, component: /^dev\.averi\.lab\/\.MainActivity$/ }])).toBeUndefined();
  });
});

describe('focusOf — the chooser in front by src\'s chooserInFocus over CHOOSER_FOCUS_COMMAND\'s read', () => {
  it("batch-10's chooser read names it; its launcher read none", () => {
    expect(chooserUp).toEqual({ state: 'read', chooser: 'android/com.android.internal.app.ResolverActivity' });
    expect(launcher).toEqual({ state: 'read', chooser: undefined });
  });

  it('a read that failed (grep found nothing: exit 1), passed its bound, or holds no focus line is unread', () => {
    expect(focusOf(exit(1))).toEqual({ state: 'unread', why: 'the focus read: exit 1' });
    expect(focusOf(timedOut).state).toBe('unread');
    expect(focusOf(ok('  Display: mDisplayId=0 (organized)\n'))).toEqual({ state: 'unread', why: 'the focus read holds no mCurrentFocus= or mFocusedApp= line' });
    expect(focusOf(ok('  mFocusedApp=null\n'))).toEqual({ state: 'read', chooser: undefined });
    expect(focusOf(ok('  mCurrentFocus=null\n'))).toEqual({ state: 'read', chooser: undefined });
  });
});

describe('checkExit — --check\'s exits (d55-b11.ts --check; batch-12\'s final checkExit, in pure-b12.ts)', () => {
  const clean = readOf(BLOCK);
  const lastChosen = readOf(withEntries(labEntry('false')));
  const aDefault = readOf(withEntries(labEntry('true')));
  const unread = preferredOf(exit(1));
  const focusUnread = focusOf(exit(1));

  it('0 clean, 1 a lab default, 3 unproven, 4 a chooser up, 5 accepted last-chosen only, 6 another last-chosen entry', () => {
    expect(CHECK_EXIT).toEqual({ clean: 0, leak: 1, unproven: 3, chooser: 4, accepted: 5, lastChosen: 6 });
    expect(checkExit(launcher, clean, [])).toBe(0);
    expect(checkExit(launcher, aDefault, [])).toBe(1);
    expect(checkExit(launcher, unread, [])).toBe(3);
    expect(checkExit(focusUnread, clean, [])).toBe(3);
    expect(checkExit(chooserUp, clean, [])).toBe(4);
    expect(checkExit(launcher, lastChosen, [SHARED_TWIN])).toBe(5);
    expect(checkExit(launcher, lastChosen, [])).toBe(6);
  });

  it("a default outranks everything, the chooser outranks unproven and last-chosen (batch-12's order; d55-b11.ts put 5 before 4)", () => {
    expect(checkExit(chooserUp, aDefault, [])).toBe(1);
    expect(checkExit(focusUnread, aDefault, [])).toBe(1);
    expect(checkExit(chooserUp, unread, [])).toBe(4);
    expect(checkExit(chooserUp, lastChosen, [SHARED_TWIN])).toBe(4);
    expect(checkExit(focusUnread, lastChosen, [SHARED_TWIN])).toBe(3);
  });

  it('5 needs every last-chosen entry accepted: one not on the list makes it 6', () => {
    const two = readOf(withEntries(labEntry('false'), labEntry('false', 'dev.averi.lab/.MainActivity', 'pair')));
    expect(checkExit(launcher, two, [SHARED_TWIN])).toBe(6);
  });

  it("checkLine: OK for 0 and 5, WARN for 6, FAIL for a default, ERROR for 3 and 4; the reads and the first lab entry said", () => {
    expect(checkLine(launcher, clean, [])).toBe('D55 check: OK — chooser no; preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)');
    // The first entry's text, cut at 200 characters with `…`.
    const text = lastChosen.state === 'read' ? lastChosen.lab[0].text : '';
    expect(text.length).toBeGreaterThan(200);
    expect(checkLine(launcher, lastChosen, [SHARED_TWIN])).toBe(
      `D55 check: OK — chooser no; preferred read (1 user); lab entries 1 (defaults 0, last-chosen 1, accepted 1); first: ${text.slice(0, 200)}…`,
    );
    const short = readOf(withEntries('      averilab:\n        9d3a2b9 dev.averi.lab/.Twin\n         mMatch=0x300000 mAlways=false'));
    expect(checkLine(launcher, short, [SHARED_TWIN])).toBe('D55 check: WARN — chooser no; preferred read (1 user); lab entries 1 (defaults 0, last-chosen 1, accepted 0); first: 9d3a2b9 dev.averi.lab/.Twin | mMatch=0x300000 mAlways=false');
    expect(checkLine(launcher, lastChosen, [])).toMatch(/^D55 check: WARN — chooser no; preferred read \(1 user\); lab entries 1 \(defaults 0, last-chosen 1, accepted 0\); first: /);
    expect(checkLine(chooserUp, aDefault, [])).toMatch(/^D55 check: FAIL — chooser yes \(android\/com\.android\.internal\.app\.ResolverActivity\); preferred read \(1 user\); lab entries 1 \(defaults 1, last-chosen 0\); first: /);
    expect(checkLine(focusUnread, unread, [])).toBe('D55 check: ERROR — chooser unread (the focus read: exit 1); preferred unread (dumpsys package preferred: exit 1)');
    expect(checkLine(chooserUp, clean, [])).toBe('D55 check: ERROR — chooser yes (android/com.android.internal.app.ResolverActivity); preferred read (1 user); lab entries 0 (defaults 0, last-chosen 0)');
    expect(checkLine(launcher, readOf(`${BLOCK}\nPreferred Activities User 10:\n`), [])).toContain('preferred read (2 users)');
  });
});

describe('safeTap — the one point to tap, never "Always" (d55-b11.ts:301–345; batch-12\'s guardRow1/guardOnce), over T4\'s resolver trees', () => {
  const tree = (xml = resolverXml()): Dump => {
    const t = treeOf(xml);
    if ('why' in t) throw new Error(t.why);
    return t;
  };

  it("batch-11's E2: the twin row by its label, at its centre (540, 1881); row 1 by number at (540, 1727)", () => {
    expect(safeTap(tree(), { row: 'AveriLab twin' })).toEqual({ ok: true, point: { x: 540, y: 1881 }, why: 'row 2 ("AveriLab", "AveriLab twin") at (540, 1881)' });
    expect(safeTap(tree(), { row: 1 })).toEqual({ ok: true, point: { x: 540, y: 1727 }, why: 'row 1 ("AveriLab") at (540, 1727)' });
    expect(safeTap(tree(resolverXml(true)), { row: 2 })).toMatchObject({ ok: true, point: { x: 540, y: 1881 } });
  });

  it('a target that is not unique is refused: both rows say "AveriLab" (why the replies tap by coordinates)', () => {
    expect(safeTap(tree(), { row: 'AveriLab' })).toEqual({ ok: false, refusal: 'not-unique', why: '2 rows say "AveriLab" (need exactly 1)' });
    const twoOnce = resolverXml(true).replace('resource-id="android:id/resolver_button_bar_divider"', 'resource-id="android:id/button_once"');
    expect(safeTap(tree(twoOnce), 'once')).toEqual({ ok: false, refusal: 'not-unique', why: '2 nodes with id button_once (need exactly 1)' });
  });

  it('no such target: a row number past the list, row 0, a label no row has, no button_once', () => {
    expect(safeTap(tree(), { row: 3 })).toEqual({ ok: false, refusal: 'no-target', why: 'no row 3 in resolver_list (2 rows)' });
    expect(safeTap(tree(), { row: 0 })).toEqual({ ok: false, refusal: 'no-target', why: 'no row 0 in resolver_list (2 rows)' });
    expect(safeTap(tree(), { row: 'AveriLab twin 2' })).toEqual({ ok: false, refusal: 'no-target', why: 'no row says "AveriLab twin 2"' });
    const noOnce = resolverXml(true).replace('resource-id="android:id/button_once"', 'resource-id="android:id/button_x"');
    expect(safeTap(tree(noOnce), 'once')).toEqual({ ok: false, refusal: 'no-target', why: '0 nodes with id button_once (need exactly 1)' });
    const noList = resolverXml().replace('resource-id="android:id/resolver_list"', 'resource-id="android:id/other_list"');
    expect(safeTap(tree(noList), { row: 1 })).toEqual({ ok: false, refusal: 'no-target', why: 'no row 1 in resolver_list (0 rows)' });
  });

  it("\"Just once\" disabled until a row is selected (batch-10's E2 looked in the wrong node: the buttons enabled=false): refused; enabled after the row tap", () => {
    expect(safeTap(tree(), 'once')).toEqual({ ok: false, refusal: 'disabled', why: 'button_once ("Just once") is disabled' });
    expect(safeTap(tree(resolverXml(true)), 'once')).toEqual({ ok: true, point: { x: 723, y: 2058 }, why: 'button_once ("Just once") at (723, 2058)' });
    const rowOff = resolverXml().replace('enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1804][1080,1958]"', 'enabled="false" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1804][1080,1958]"');
    expect(safeTap(tree(rowOff), { row: 2 })).toEqual({ ok: false, refusal: 'disabled', why: 'row 2 ("AveriLab", "AveriLab twin") is disabled' });
  });

  it('the target that reads as "Always" — by id or by text, any case — is refused itself', () => {
    const onceSaysAlways = resolverXml(true).replace('text="Just once"', 'text="ALWAYS"');
    expect(safeTap(tree(onceSaysAlways), 'once')).toEqual({ ok: false, refusal: 'always', why: 'button_once ("ALWAYS") reads as "Always"' });
    const rowSaysAlways = resolverXml().replace('text="AveriLab twin"', 'text="always"');
    expect(safeTap(tree(rowSaysAlways), { row: 'always' })).toEqual({ ok: false, refusal: 'always', why: 'row 2 ("AveriLab", "always") reads as "Always"' });
  });

  it('a point inside an "Always" node, or a target overlapping one, is refused — by its id (a localized label) or its text alone', () => {
    // button_always grown over "Just once"'s centre, its label localized: refused by the id.
    const grown = resolverXml(true).replace('text="Always"', 'text="Immer"').replace('bounds="[842,1983][1030,2132]"', 'bounds="[700,1983][1030,2132]"');
    expect(safeTap(tree(grown), 'once')).toEqual({ ok: false, refusal: 'always', why: 'the point (723, 2058) is inside "Always" (button_always "Immer")' });
    // grown only to overlap "Just once"'s right part, not its centre.
    const overlap = resolverXml(true).replace('bounds="[842,1983][1030,2132]"', 'bounds="[800,1983][1030,2132]"');
    expect(safeTap(tree(overlap), 'once')).toEqual({ ok: false, refusal: 'always', why: 'button_once ("Just once") overlaps "Always" (button_always "Always")' });
    // a node with no such id whose text says "always" (any case), laid over row 2.
    const byText = resolverXml().replace(
      '<node index="3" text="" resource-id="android:id/button_bar_container"',
      '<node index="9" text="Always open" resource-id="android:id/other" class="android.widget.Button" package="android" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1850][1080,1900]" /><node index="3" text="" resource-id="android:id/button_bar_container"',
    );
    expect(safeTap(tree(byText), { row: 2 })).toEqual({ ok: false, refusal: 'always', why: 'the point (540, 1881) is inside "Always" (other "Always open")' });
  });

  it('isAlways: the id button_always (its last segment), or "always" as a word in the text or the content-desc, each read on its own, any case (T2 S5 review round 1); never "Just once" or "Alwaysy"', () => {
    const a = (resourceId: string | undefined, text: string | undefined = '', contentDesc: string | undefined = ''): RawAttrs => ({ resourceId, text, contentDesc, enabled: 'true' });
    expect(isAlways(a('android:id/button_always', 'Immer'))).toBe(true);
    expect(isAlways(a('button_always'))).toBe(true);
    expect(isAlways(a('', ' ALWAYS '))).toBe(true);
    expect(isAlways(a('', 'Open always'))).toBe(true);
    // src's label is content-desc before text: a text "Always" behind a content-desc is still "Always".
    expect(isAlways(a('', 'Always', 'Open'))).toBe(true);
    expect(isAlways(a('', 'Open', 'always'))).toBe(true);
    expect(isAlways(a('android:id/button_once', 'Just once'))).toBe(false);
    expect(isAlways(a('', 'Alwaysy'))).toBe(false);
    expect(isAlways(a('android:id/button_always_x'))).toBe(false);
    expect(isAlways(a('x:id/my_button_always'))).toBe(false);
    expect(isAlways(a(''))).toBe(false);
    expect(isAlways(a(undefined, undefined, undefined))).toBe(false);
  });

  it("a point given outside the target, or more than 2 px off its centre (batch-12's row-1 rule), is refused", () => {
    expect(safeTap(tree(), { row: 2 }, { x: 540, y: 1700 })).toEqual({ ok: false, refusal: 'outside', why: 'the point (540, 1700) is outside row 2 ("AveriLab", "AveriLab twin") [0,1804 1080x154]' });
    // The rect's far edge is the next node's: outside (half-open).
    expect(safeTap(tree(), { row: 2 }, { x: 540, y: 1958 })).toMatchObject({ ok: false, refusal: 'outside' });
    expect(safeTap(tree(), { row: 2 }, { x: 1080, y: 1881 })).toMatchObject({ ok: false, refusal: 'outside' });
    expect(safeTap(tree(), { row: 2 }, { x: -1, y: 1881 })).toMatchObject({ ok: false, refusal: 'outside' });
    expect(safeTap(tree(), { row: 2 }, { x: 540, y: 1803 })).toMatchObject({ ok: false, refusal: 'outside' });
    expect(safeTap(tree(), { row: 2 }, { x: 543, y: 1881 })).toEqual({ ok: false, refusal: 'off-centre', why: 'the point (543, 1881) is not row 2 ("AveriLab", "AveriLab twin")\'s centre (540, 1881) within 2 px' });
    expect(safeTap(tree(), { row: 2 }, { x: 540, y: 1878 })).toMatchObject({ ok: false, refusal: 'off-centre' });
    expect(safeTap(tree(), { row: 2 }, { x: 542, y: 1879 })).toEqual({ ok: true, point: { x: 542, y: 1879 }, why: 'row 2 ("AveriLab", "AveriLab twin") at (542, 1879)' });
    expect(safeTap(tree(), { row: 2 }, { x: 538, y: 1883 })).toMatchObject({ ok: true });
  });

  it('a point that lands on another node — not the target, inside it, nor above it — is refused (a scrim, a sibling drawn there)', () => {
    const scrim = resolverXml().replace(
      '<node index="3" text="" resource-id="android:id/button_bar_container"',
      '<node index="9" text="" resource-id="android:id/scrim" class="android.view.View" package="android" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1700][1080,1900]" /><node index="3" text="" resource-id="android:id/button_bar_container"',
    );
    expect(safeTap(tree(scrim), { row: 2 })).toEqual({ ok: false, refusal: 'other-node', why: 'the point (540, 1881) lands on scrim, not row 2 ("AveriLab", "AveriLab twin")' });
    // A node inside the target there is the target's (its labels' box widened under the point: hand mutant), and the
    // list above it takes the click: both fine.
    const inside = resolverXml().replace('bounds="[132,1825][431,1937]"', 'bounds="[132,1825][1000,1937]"');
    expect(safeTap(tree(inside), { row: 2 }, { x: 540, y: 1881 })).toMatchObject({ ok: true });
    expect(safeTap(tree(), { row: 'AveriLab twin' }, { x: 541, y: 1882 })).toMatchObject({ ok: true });
  });

  it("no tap off the chooser's fresh sheet as src reads it (chooserSheet): AOSP's with_default header, or no chooser at all", () => {
    // resolver_list_with_default's header: the last-chosen app's icon above the list (android-chooser.ts#chooserSheet).
    const withDefault = resolverXml(true).replace(
      '<node index="0" text="Open with" resource-id="android:id/title"',
      '<node index="9" text="" resource-id="android:id/icon" class="android.widget.ImageView" package="android" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[22,1480][110,1568]" /><node index="0" text="Open with" resource-id="android:id/title"',
    );
    const notFresh = { ok: false, refusal: 'no-sheet', why: "the tree is not the chooser's fresh sheet (android-chooser.ts#chooserSheet reads none)" };
    expect(safeTap(tree(withDefault), 'once')).toEqual(notFresh);
    expect(safeTap(tree(withDefault), { row: 2 })).toEqual(notFresh);
  });
});

describe('treeOf — a `uiautomator dump /dev/tty` output parsed by src\'s parser, the bounds as dumped', () => {
  it("the status line after the XML is dropped (android.ts#dumpedTree's reading); the T4 fixture's 27 nodes", () => {
    const t = treeOf(`${resolverXml()}UI hierchary dumped to: /dev/tty\n`);
    if ('why' in t) throw new Error(t.why);
    const count = (n: UiNode): number => 1 + n.children.reduce((s, c) => s + count(c), 0);
    expect(count(t.root)).toBe(27);
  });

  it('no XML, or one the parser refuses, is no tree, with why', () => {
    expect(treeOf('null root node returned by UiTestAutomationBridge.\n')).toEqual({ why: 'no XML in the dump: null root node returned by UiTestAutomationBridge.' });
    expect(treeOf('')).toEqual({ why: 'no XML in the dump: ' });
    expect(treeOf('<hierarchy rotation="0"></hierarchy>')).toEqual({ why: 'the dump did not parse: uiautomator dump contained no nodes' });
  });
});

describe('shellReadOf / compareReads — a read that "succeeds" but cannot be compared is unread, never unchanged (batch-9)', () => {
  it("batch-9's role holder read: `Unknown command: get-role-holders`, exit 255 — unread; the same words with exit 0, unread too", () => {
    const role = fixture('role-holders-api33-b9-unknown-command.txt');
    expect(shellReadOf(exit(255, role))).toEqual({ state: 'unread', why: 'exit 255 Unknown command: get-role-holders' });
    expect(shellReadOf(ok(role))).toEqual({ state: 'unread', why: 'the device has no such command: Unknown command: get-role-holders' });
    expect(shellReadOf(ok('', role))).toEqual({ state: 'unread', why: 'the device has no such command: Unknown command: get-role-holders' });
  });

  it("batch-9's `cmd clipboard help`: `No shell command implementation.`, exit 0 — unread", () => {
    expect(shellReadOf(ok(fixture('clipboard-help-api33-b9.txt')))).toEqual({ state: 'unread', why: 'the device has no such command: No shell command implementation.' });
  });

  it('a read past its bound is unread; any other exit-0 output is read, trimmed of its line ends', () => {
    expect(shellReadOf(timedOut)).toEqual({ state: 'unread', why: `past its bound (exit ${TIMED_OUT})` });
    expect(shellReadOf(ok('com.android.chrome\r\n'))).toEqual({ state: 'read', text: 'com.android.chrome' });
    expect(shellReadOf(ok(''))).toEqual({ state: 'read', text: '' });
    // The words inside a line, not at its start, are an answer like any other.
    expect(shellReadOf(ok('x Unknown command: y'))).toEqual({ state: 'read', text: 'x Unknown command: y' });
  });

  it('unchanged only when both reads were read and equal; else changed, or unread naming which read', () => {
    const r = (text: string) => shellReadOf(ok(text));
    const u = shellReadOf(exit(255, 'Unknown command: get-role-holders\n'));
    expect(compareReads(r('a'), r('a'))).toEqual({ outcome: 'unchanged', text: 'a' });
    expect(compareReads(r('a'), r('b'))).toEqual({ outcome: 'changed', before: 'a', after: 'b' });
    expect(compareReads(u, r('a'))).toEqual({ outcome: 'unread', why: 'before: exit 255 Unknown command: get-role-holders' });
    expect(compareReads(r('a'), u)).toEqual({ outcome: 'unread', why: 'after: exit 255 Unknown command: get-role-holders' });
    expect(compareReads(u, u)).toEqual({ outcome: 'unread', why: 'before: exit 255 Unknown command: get-role-holders; after: exit 255 Unknown command: get-role-holders' });
  });

  it('comparedLine: OK unchanged, ERROR CHANGED, WARN not compared — never OK unread', () => {
    expect(comparedLine('D55 browser role holder', { outcome: 'unchanged', text: 'com.android.chrome' })).toBe('D55 browser role holder: OK — unchanged ("com.android.chrome")');
    expect(comparedLine('D55 browser role holder', { outcome: 'unchanged', text: '' })).toBe('D55 browser role holder: OK — unchanged ("")');
    expect(comparedLine('D55 browser role holder', { outcome: 'changed', before: 'a', after: 'b\nc' })).toBe('D55 browser role holder: ERROR — CHANGED: "a" → "b\\nc"');
    expect(comparedLine('D55 browser role holder', { outcome: 'unread', why: 'before: exit 255 x' })).toBe('D55 browser role holder: WARN — not compared: before: exit 255 x');
  });
});

describe('handlersOf — `cmd package query-activities --brief` counted (batch-11.sh:383, the lab check\'s 2 and 1)', () => {
  it("batch-10's reads: averilab://shared/open 2 (MainActivity and Twin), averilab://cell/open 1", () => {
    expect(handlersOf(ok(fixture('query-activities-api33-b10-shared.txt')))).toBe(2);
    expect(handlersOf(ok(fixture('query-activities-api33-b10-cell.txt')))).toBe(1);
  });

  it("none: `No activities found` is 0; a header whose count is not the lines', a failed read, or no header, is why not", () => {
    expect(handlersOf(ok('No activities found\n'))).toBe(0);
    expect(handlersOf(ok(fixture('query-activities-api33-b10-shared.txt').replace('2 activities found:', '3 activities found:')))).toEqual({ why: 'query-activities said 3 activities but listed 2' });
    expect(handlersOf(exit(255, '', 'Unknown command'))).toEqual({ why: 'query-activities: exit 255 Unknown command' });
    expect(handlersOf(ok('dev.averi.lab/.MainActivity\n'))).toEqual({ why: 'query-activities printed no `N activities found:` line: dev.averi.lab/.MainActivity' });
    expect(handlersOf(ok('1 activity found:\n  Activity #0:\n    dev.averi.lab/.MainActivity\n'))).toBe(1);
  });
});

describe('unreachableOf and installedOf — `adb get-state` first, then `pm path` (batch-12.sh, e5_installed; batch-11 int-reinstall-noadb)', () => {
  const path = ok('package:/data/app/~~HASH==/dev.averi.lab-HASH==/base.apk\n');

  it('unreachable is unknown, never "missing" and never "put back": get-state failing, past its bound, or not `device`', () => {
    expect(unreachableOf(ok('device\n'))).toBeUndefined();
    expect(unreachableOf(ok('device\r\n'))).toBeUndefined();
    expect(unreachableOf(exit(1, '', 'error: no devices/emulators found'))).toBe('adb get-state: exit 1 error: no devices/emulators found');
    expect(unreachableOf(timedOut)).toBe(`adb get-state: past its bound (exit ${TIMED_OUT})`);
    expect(unreachableOf(ok('offline\n'))).toBe('adb get-state: offline, not device');
    expect(unreachableOf(ok('\n'))).toBe('adb get-state: "", not device');
    expect(unreachableOf({ ...timedOut, code: 0, out: 'device\n' })).toBe('adb get-state: past its bound (exit 0) device');
  });

  it('installed: `pm path` exit 0 naming the package — with its path', () => {
    expect(installedOf(path)).toEqual({ state: 'installed', path: '/data/app/~~HASH==/dev.averi.lab-HASH==/base.apk' });
    expect(installedOf(ok('package:/x/base.apk\r\n'))).toEqual({ state: 'installed', path: '/x/base.apk' });
  });

  it('missing only on `pm path` exit 1 with nothing said', () => {
    expect(installedOf(exit(1))).toEqual({ state: 'missing' });
    expect(installedOf(exit(1, '\n'))).toEqual({ state: 'missing' });
  });

  it('any other `pm path` answer is unknown: exit 1 with words, another exit, past its bound, exit 0 naming no package', () => {
    expect(installedOf(exit(1, '', 'cmd: Failure calling service package'))).toEqual({ state: 'unknown', why: 'pm path: exit 1 cmd: Failure calling service package' });
    expect(installedOf(exit(255))).toEqual({ state: 'unknown', why: 'pm path: exit 255' });
    expect(installedOf({ ...timedOut, code: 1 })).toEqual({ state: 'unknown', why: 'pm path: past its bound (exit 1)' });
    expect(installedOf(ok('\n'))).toEqual({ state: 'unknown', why: 'pm path: exit 0 but no package: line' });
    expect(installedOf(ok('x package:/a/base.apk\n'))).toEqual({ state: 'unknown', why: 'pm path: exit 0 but no package: line' });
  });
});

describe('sanitizeFixture — no device path or serial in a fixture (d55-b11.ts:347)', () => {
  it("every committed chooser fixture is clean: T4's resolver trees and S5's reads", () => {
    const names = readdirSync(BATCH).filter((n) => n.includes('api33'));
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const text of [...names.map(fixture), resolverXml(), resolverXml(true)]) expect(sanitizeFixture(text, 'emulator-5554')).toEqual({ ok: true, hits: [] });
  });

  it('a device path or the serial is a hit, each once; an empty serial is never one', () => {
    expect(sanitizeFixture('x /sdcard/a /sdcard/b emulator-5556 /data/app', 'emulator-5556')).toEqual({ ok: false, hits: ['/data/', '/sdcard', 'emulator-', 'emulator-5556'] });
    expect(sanitizeFixture('LAB-1 here', 'LAB-1')).toEqual({ ok: false, hits: ['LAB-1'] });
    expect(sanitizeFixture('plain', '')).toEqual({ ok: true, hits: [] });
    // Built from parts, as the hygiene test builds its own: no committed file here may hold a host path whole.
    const slash = '/';
    for (const p of ['/storage/', `${slash}Users${slash}`, '/private/', `${slash}tmp${slash}`]) expect(sanitizeFixture(`a ${p}b`, 'SERIAL-X').hits).toEqual([p]);
  });
});

describe('the hand lines — each names the exact step and its commands, every word quoted as a shell reads it back (adb-shell.ts#shellQuote)', () => {
  const B: HandBase = { serial: 'LAB-1', apk: 'lab dir/installed.apk', then: 'node probe.ts --restore' };

  it('a lab default: uninstall && install of the pulled APK, then the command given (batch-12 e5_check exit 1)', () => {
    expect(defaultHand(B)).toBe(
      'D55 (Android): a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: adb -s LAB-1 uninstall dev.averi.lab && adb -s LAB-1 install \'lab dir/installed.apk\' (clears it; wipes the lab\'s data); then: node probe.ts --restore',
    );
  });

  it("unknown inside a reinstall: get-state, then `pm path` once adb answers, the install only if it prints nothing (batch-11.sh's abort; T2 S5 review round 1: its commands named)", () => {
    expect(unknownInstallHand(B)).toBe(
      "D55 (Android): whether the lab is installed is unknown (interrupted during its reinstall, adb unreachable): once adb answers, adb -s LAB-1 get-state (device), then adb -s LAB-1 shell pm path dev.averi.lab; if it prints nothing, adb -s LAB-1 install 'lab dir/installed.apk'; then: node probe.ts --restore",
    );
  });

  it('missing; not proven the pulled APK; no state to mark dirty; not proven clean; the state not put back', () => {
    expect(missingHand(B)).toBe("D55 (Android): the lab APK is NOT installed: adb -s LAB-1 install 'lab dir/installed.apk'; then: node probe.ts --restore");
    expect(cellsHand(B, 'cells.json', 'its cells.json differs')).toBe(
      "D55 (Android): the installed lab not proven the pulled APK (its cells.json differs): adb -s LAB-1 shell pm path dev.averi.lab, adb -s LAB-1 pull <that path> <a file>, unzip -p <that file> assets/cells.json must equal cells.json; if not, adb -s LAB-1 uninstall dev.averi.lab && adb -s LAB-1 install 'lab dir/installed.apk'; then: node probe.ts --restore",
    );
    expect(stateFileHand(B, 'state dir/state.json', 'missing')).toBe(
      "D55 (Android): no reinstall was done: the probe's state file 'state dir/state.json' was not marked dirty (missing); run the probe's --state first, then clear the default by hand: adb -s LAB-1 uninstall dev.averi.lab && adb -s LAB-1 install 'lab dir/installed.apk'",
    );
    expect(stateFileHand(B, 's.json', 'unreadable', 'node probe.ts --state s.json')).toBe(
      "D55 (Android): no reinstall was done: the probe's state file s.json was not marked dirty (unreadable); run node probe.ts --state s.json first, then clear the default by hand: adb -s LAB-1 uninstall dev.averi.lab && adb -s LAB-1 install 'lab dir/installed.apk'",
    );
    expect(checkHand("it's")).toBe(
      "D55 (Android): the chooser and the preferred activities not proven put back: adb -s 'it'\\''s' shell dumpsys package preferred (no lab entry with mAlways=true may be left); a chooser in front: adb -s 'it'\\''s' shell input keyevent KEYCODE_BACK",
    );
    expect(stateHand('node probe.ts --restore')).toBe("D55 (Android): the lab's state not put back: node probe.ts --restore");
  });

  it('CHECK_OUTCOME: one table of each exit\'s word, proof, words and hand lines (T2 S5 code review)', () => {
    expect(Object.fromEntries(Object.entries(CHECK_OUTCOME).map(([k, v]) => [k, [v.word, v.proven, v.hand(B).length]]))).toEqual({ 0: ['OK', true, 0], 1: ['FAIL', false, 1], 3: ['ERROR', false, 1], 4: ['ERROR', false, 1], 5: ['OK', true, 0], 6: ['WARN', true, 0] });
    expect(CHECK_OUTCOME[0].words('x')).toBe('x');
    expect(CHECK_OUTCOME[5].words('x')).toBe('x');
    expect(CHECK_OUTCOME[6].words('chooser no')).toBe('a last-chosen entry not accepted (mAlways=false: no default; no reinstall clears it, so none is tried — no RESTORE): chooser no');
    expect(CHECK_OUTCOME[1].words('x')).toBe('a lab default (mAlways=true) is set — "Always" is never tapped, so it predates the batch or is a defect: x');
    expect(CHECK_OUTCOME[3].words('x')).toBe('the preferred activities or the focus not proven clean: x');
    expect(CHECK_OUTCOME[4].words('x')).toBe('the chooser is still in front after BACK and HOME: x');
    expect(CHECK_OUTCOME[1].hand(B)).toEqual([defaultHand(B)]);
    expect(CHECK_OUTCOME[3].hand(B)).toEqual([checkHand('LAB-1')]);
    expect(CHECK_OUTCOME[4].hand(B)).toEqual([checkHand('LAB-1')]);
  });

  it('checkWhy is the check line after its word', () => {
    const p = readOf(BLOCK);
    expect(checkLine(launcher, p, [])).toBe(`D55 check: OK — ${checkWhy(launcher, p, [])}`);
  });
});

describe('the readers at their edges (T2 S5 mutation round: each test kills a survivor of the first cold run)', () => {
  const tree = (xml: string): Dump => {
    const t = treeOf(xml);
    if ('why' in t) throw new Error(t.why);
    return t;
  };
  const node = (identifier: string | null, label: string | null): string =>
    `<node index="9" text="${label ?? ''}" resource-id="${identifier ?? ''}" class="android.view.View" package="android" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1850][1080,1900]" />`;
  const before = (xml: string, inserted: string): string => xml.replace('<node index="3" text="" resource-id="android:id/button_bar_container"', `${inserted}<node index="3" text="" resource-id="android:id/button_bar_container"`);

  it("an entry's blank and space-only lines are its own: mAlways read past them, the text without them", () => {
    const entry = labEntry('false').replace('         mMatch=', '\n   \n         mMatch=');
    const p = readOf(withEntries(entry));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab).toHaveLength(1);
    expect(p.lab[0].always).toBe(false);
    expect(p.lab[0].text).toMatch(/^9d3a2b9 dev\.averi\.lab\/\.Twin \| mMatch=0x300000 mAlways=false \| Selected from:/);
  });

  it("an entry of one line (the block's last) has no mAlways: unproven; trailing spaces on an entry or a header line are no other line", () => {
    const p = readOf('Preferred Activities User 0:  \n  Schemes:\n      averilab:\n        9d3a2b9 dev.averi.lab/.Twin  \n');
    expect(p).toEqual({ state: 'read', users: 1, lab: [{ text: '9d3a2b9 dev.averi.lab/.Twin', component: 'dev.averi.lab/.Twin', always: undefined }] });
  });

  it('indented entry lines before any block header are no block\'s (an output cut at its top)', () => {
    expect(readOf(`  Schemes:\n${labEntry('true')}\n${BLOCK}`)).toEqual({ state: 'read', users: 1, lab: [] });
  });

  it("a row's text2 with no text is no label of its name", () => {
    const xml = resolverXml().replace('text="AveriLab twin"', 'text=""');
    expect(safeTap(tree(xml), { row: 2 })).toMatchObject({ ok: true, why: 'row 2 ("AveriLab") at (540, 1881)' });
  });

  it("two entries at one indent are two: the first's text stops at the second's line", () => {
    const two = labEntry('false').replace('      averilab:\n', '') + '\n' + labEntry('true', 'dev.averi.lab/.Twin', 'pair').replace('      averilab:\n', '');
    const p = readOf(withEntries(`      averilab:\n${two}`));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab.map((e) => [e.always, e.authority])).toEqual([[false, 'shared'], [true, 'pair']]);
    expect(p.lab[0].text).not.toContain('mAlways=true');
  });

  it('a line that only holds a hash and a component after other words, or words after one, is no entry', () => {
    const decoys = '      averilab:\n          note: ab dev.averi.lab/.Twin\n        9d3a2b9 dev.averi.lab/.Twin extra\n';
    expect(readOf(BLOCK.replace('  Schemes:\n', `  Schemes:\n${decoys}`))).toEqual({ state: 'read', users: 1, lab: [] });
  });

  it('an entry text of exactly 200 characters is quoted whole; one more is cut', () => {
    const base = labEntry('false').split('\n').slice(1, 3);
    const text = (filler: string) => [...base, `          ${filler}`].map((l) => l.trim()).join(' | ');
    const fill = 'x'.repeat(200 - text('').length);
    const p = readOf(withEntries(['      averilab:', ...base, `          ${fill}`].join('\n')));
    if (p.state !== 'read') throw new Error('unread');
    expect(p.lab[0].text).toHaveLength(200);
    expect(checkLine(launcher, p, []).endsWith(`| ${fill}`)).toBe(true);
    const q = readOf(withEntries(['      averilab:', ...base, `          ${fill}y`].join('\n')));
    expect(checkLine(launcher, q, [])).toMatch(/x…$/);
  });

  it('chooserOf: the read one\'s chooser; an unread read shows none', () => {
    expect(chooserOf(chooserUp)).toBe('android/com.android.internal.app.ResolverActivity');
    expect(chooserOf(launcher)).toBeUndefined();
    expect(chooserOf({ state: 'unread', why: 'x' })).toBeUndefined();
  });

  it('NOT_JUDGED: no node is drawn over, so src\'s parser widens none (the bounds as dumped)', () => {
    const t = tree(resolverXml());
    expect(NOT_JUDGED(t.root)(t.root, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it("shellReadOf: a CRLF answer's words without the CR; the words with more after them, or a trailing line break inside, read", () => {
    expect(shellReadOf(exit(0, 'Unknown command: get-role-holders\r\n'))).toEqual({ state: 'unread', why: 'the device has no such command: Unknown command: get-role-holders' });
    expect(shellReadOf(ok('No shell command implementation.\r\n'))).toMatchObject({ state: 'unread' });
    expect(shellReadOf(ok('No shell command implementation. Use x\n'))).toEqual({ state: 'read', text: 'No shell command implementation. Use x' });
    expect(shellReadOf(ok('a\nb\n'))).toEqual({ state: 'read', text: 'a\nb' });
  });

  it('handlersOf: CRLF; the lines whole — none indented or with words after, a header with words before or after, a count of two digits', () => {
    expect(handlersOf(ok(fixture('query-activities-api33-b10-shared.txt').replace(/\n/g, '\r\n')))).toBe(2);
    expect(handlersOf(ok('No activities found'))).toBe(0);
    expect(handlersOf(ok('No activities found  \n'))).toBe(0);
    expect(handlersOf(ok('x No activities found\n'))).toMatchObject({ why: expect.stringMatching(/no `N activities found:` line/) });
    expect(handlersOf(ok('No activities found yet\n'))).toMatchObject({ why: expect.stringMatching(/no `N activities found:` line/) });
    expect(handlersOf(ok('x 1 activity found:\n    dev.averi.lab/.MainActivity\n'))).toMatchObject({ why: expect.stringMatching(/no `N activities found:` line/) });
    expect(handlersOf(ok('1 activity found: x\n    dev.averi.lab/.MainActivity\n'))).toMatchObject({ why: expect.stringMatching(/no `N activities found:` line/) });
    expect(handlersOf(ok('1 activity found:  \n    dev.averi.lab/.MainActivity  \n'))).toBe(1);
    expect(handlersOf(ok(`12 activities found:\n${'    dev.averi.lab/.MainActivity\n'.repeat(12)}`))).toBe(12);
    expect(handlersOf(ok('1 activity found:\n  x dev.averi.lab/.MainActivity\n    dev.averi.lab/.Twin\n'))).toBe(1);
    expect(handlersOf(ok('1 activity found:\n    dev.averi.lab/.MainActivity extra\n    dev.averi.lab/.Twin\n'))).toBe(1);
  });


  it("treeOf: everything after the XML's last `>` is dropped, a stray `<` in it too (which the parser would refuse)", () => {
    expect('why' in treeOf(`${resolverXml()}<x`)).toBe(false);
  });

  it('"Always" just touching the target — left, above, below — is no overlap; its rect\'s first column and row hold the point', () => {
    const at = (bounds: string) => tree(resolverXml(true).replace('bounds="[842,1983][1030,2132]"', `bounds="${bounds}"`));
    for (const b of ['[400,1983][604,2132]', '[604,1900][842,1983]', '[604,2132][842,2200]']) expect(safeTap(at(b), 'once')).toMatchObject({ ok: true });
    expect(safeTap(at('[723,1983][1030,2132]'), 'once')).toEqual({ ok: false, refusal: 'always', why: 'the point (723, 2058) is inside "Always" (button_always "Always")' });
    expect(safeTap(at('[604,2058][842,2132]'), 'once')).toEqual({ ok: false, refusal: 'always', why: 'the point (723, 2058) is inside "Always" (button_always "Always")' });
  });

  it("a row's name is its text1 and text2 only, never another label in it (an icon's content-desc)", () => {
    const xml = resolverXml().replace(/(resource-id="android:id\/icon"[^>]*?)content-desc=""([^>]*bounds="\[22,1837\]\[110,1925\]")/, '$1content-desc="Twin icon"$2');
    expect(xml).toContain('content-desc="Twin icon"');
    expect(safeTap(tree(xml), { row: 2 })).toEqual({ ok: true, point: { x: 540, y: 1881 }, why: 'row 2 ("AveriLab", "AveriLab twin") at (540, 1881)' });
    expect(safeTap(tree(xml), { row: 'Twin icon' })).toMatchObject({ ok: false, refusal: 'no-target' });
  });

  it('a node a why names: its label alone with no id, its role with neither', () => {
    expect(safeTap(tree(before(resolverXml(), node(null, 'always'))), { row: 2 })).toEqual({ ok: false, refusal: 'always', why: 'the point (540, 1881) is inside "Always" ("always")' });
    expect(safeTap(tree(before(resolverXml(), node(null, null))), { row: 2 })).toEqual({ ok: false, refusal: 'other-node', why: 'the point (540, 1881) lands on other, not row 2 ("AveriLab", "AveriLab twin")' });
  });
});

describe('safeTap fails closed (T2 S5 review round 1)', () => {
  const tree = (xml: string): Dump => {
    const t = treeOf(xml);
    if ('why' in t) throw new Error(t.why);
    return t;
  };
  const ROW2 = 'bounds="[0,1804][1080,1958]"';

  it('a target counts as enabled only when the dump says enabled="true": an absent attribute is refused, its enabled state not shown (d55-b11.ts, pure-b12.ts)', () => {
    const noEnabled = resolverXml(true).replace('enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[604,1983][842,2132]"', 'focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[604,1983][842,2132]"');
    expect(noEnabled).not.toBe(resolverXml(true));
    expect(safeTap(tree(noEnabled), 'once')).toEqual({ ok: false, refusal: 'enabled-unshown', why: 'button_once ("Just once"): the dump does not say it is enabled' });
    const rowNoEnabled = resolverXml().replace(`enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" ${ROW2}`, `focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" ${ROW2}`);
    expect(rowNoEnabled).not.toBe(resolverXml());
    expect(safeTap(tree(rowNoEnabled), { row: 2 })).toMatchObject({ ok: false, refusal: 'enabled-unshown' });
  });

  it('"Always" by text behind a content-desc (src\'s label shows the desc only), or by content-desc alone, is refused', () => {
    const textBehindDesc = resolverXml(true).replace('text="Just once" resource-id="android:id/button_once" class="android.widget.Button" package="android" content-desc=""', 'text="Always" resource-id="android:id/button_once" class="android.widget.Button" package="android" content-desc="Just once"');
    expect(textBehindDesc).not.toBe(resolverXml(true));
    expect(safeTap(tree(textBehindDesc), 'once')).toMatchObject({ ok: false, refusal: 'always', why: 'button_once ("Just once") reads as "Always"' });
    const descAlways = resolverXml().replace('text="AveriLab twin" resource-id="android:id/text2" class="android.widget.TextView" package="android" content-desc=""', 'text="AveriLab twin" resource-id="android:id/text2" class="android.widget.TextView" package="android" content-desc="Always"');
    expect(descAlways).not.toBe(resolverXml());
    expect(safeTap(tree(descAlways), { row: 2 })).toMatchObject({ ok: false, refusal: 'always' });
  });

  it('an "Always" ancestor of the target is refused (its button bar described "Always")', () => {
    const bar = resolverXml(true).replace('resource-id="android:id/button_bar" class="android.widget.LinearLayout" package="android" content-desc=""', 'resource-id="android:id/button_bar" class="android.widget.LinearLayout" package="android" content-desc="Always"');
    expect(bar).not.toBe(resolverXml(true));
    expect(safeTap(tree(bar), 'once')).toEqual({ ok: false, refusal: 'always', why: 'the point (723, 2058) is inside "Always" (button_bar "Always")' });
  });

  it('a tag with no text, resource-id or content-desc is no "Always"; "Always" in quotes is (the tags read as written)', () => {
    const over = (attrs: string) =>
      resolverXml().replace(
        '<node index="3" text="" resource-id="android:id/button_bar_container"',
        `<node index="9" ${attrs} class="android.view.View" package="android" checkable="false" checked="false" clickable="true" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1850][1080,1900]" /><node index="3" text="" resource-id="android:id/button_bar_container"`,
      );
    expect(safeTap(tree(over('')), { row: 2 })).toMatchObject({ ok: false, refusal: 'other-node' });
    expect(safeTap(tree(over('text="&quot;always&quot;"')), { row: 2 })).toMatchObject({ ok: false, refusal: 'always' });
  });

  it("a `>` inside a quoted value does not end a tag: button_always written with text=\"A>\" keeps its id (T2 S5 review round 2, its repro)", () => {
    const xml = resolverXml(true).replace('text="Always" resource-id="android:id/button_always"', 'text="A&gt;" resource-id="android:id/button_always"').replace('bounds="[842,1983][1030,2132]"', 'bounds="[700,1983][1030,2132]"');
    const raw = xml.replace('text="A&gt;"', 'text="A>"');
    expect(raw).toContain('text="A>" resource-id="android:id/button_always"');
    expect(safeTap(tree(raw), 'once')).toEqual({ ok: false, refusal: 'always', why: 'the point (723, 2058) is inside "Always" (button_always "A>")' });
  });

  it("\"Always\" by src's identifier too, and a dump whose tag ids disagree with src's tree is no tree (T2 S5 review round 2)", () => {
    const t = tree(resolverXml(true));
    // A tag read wrong (its id lost) is still "Always" by src's own identifier.
    const lost: Dump = { root: t.root, attrs: (n) => ({ ...t.attrs(n), resourceId: n.identifier === 'button_always' ? undefined : t.attrs(n).resourceId }) };
    const grown = tree(resolverXml(true).replace('text="Always"', 'text="Immer"').replace('bounds="[842,1983][1030,2132]"', 'bounds="[700,1983][1030,2132]"'));
    const lostGrown: Dump = { root: grown.root, attrs: (n) => ({ ...grown.attrs(n), resourceId: n.identifier === 'button_always' ? '' : grown.attrs(n).resourceId }) };
    expect(safeTap(lostGrown, 'once')).toMatchObject({ ok: false, refusal: 'always' });
    expect(safeTap(lost, 'once')).toMatchObject({ ok: true });
    // A tag read wrong (a single-quoted value holding the words `resource-id="…"`): its id is not src's, refused.
    const shifted = resolverXml().replace('<node index="0" text="" resource-id="" class="android.widget.FrameLayout"', '<node index="0" hint=\' resource-id="x:id/ghost"\' text="" resource-id="" class="android.widget.FrameLayout"');
    expect(treeOf(shifted)).toMatchObject({ why: expect.stringMatching(/^the dump's tags and src's tree disagree at node \d+: tag resource-id "x:id\/ghost", tree identifier null$/) });
  });

  it('a row by number or label with more than one resolver_list is not unique (T2 S5 code review)', () => {
    const two = resolverXml().replace('resource-id="android:id/profile_pager"', 'resource-id="android:id/resolver_list"');
    expect(safeTap(tree(two), { row: 1 })).toEqual({ ok: false, refusal: 'not-unique', why: '2 resolver_list nodes (need exactly 1)' });
    expect(safeTap(tree(two), { row: 'AveriLab twin' })).toEqual({ ok: false, refusal: 'not-unique', why: '2 resolver_list nodes (need exactly 1)' });
  });

  it("a dump whose nodes and src's parsed tree differ (a node in a comment) is no tree: nothing could be judged node by node", () => {
    expect(treeOf(resolverXml().replace('<hierarchy rotation="0">', '<hierarchy rotation="0"><!-- <node text="x"> -->'))).toEqual({ why: "the dump's 28 node tags are not the parsed tree's 27 nodes" });
  });

  it('an entry-shaped lab line under a later top-level section is no entry of the block', () => {
    expect(readOf(`${BLOCK}Domain verification status:\n  dev.averi.lab:\n        9d3a2b9 dev.averi.lab/.Twin\n         mMatch=0x300000 mAlways=true\n`)).toEqual({ state: 'read', users: 1, lab: [] });
  });
});
