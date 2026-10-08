import { describe, expect, it } from 'vitest';
import { fillText, launchText, snapshotNote, swipeText, tapText, typedText } from '../../src/mcp/tool-text.js';
import { el, node, screen } from '../helpers/fake.js';

describe('tap and type_text response lines', () => {
  it('tapText names the selector, and the resolution note when there was one', () => {
    expect(tapText('id:go', undefined)).toBe('Tapped id:go');
    expect(tapText('id:go', '2 matches; picked the only interactive one (button)')).toBe(
      'Tapped id:go (2 matches; picked the only interactive one (button))',
    );
  });

  const landed = { role: 'textfield', readBack: { kind: 'landed' } } as const;

  it('fillText names the selector, the length, the characters it cleared, the note, and the ⚠ warning on its own line', () => {
    expect(fillText('id:amount', { length: 4, ...landed })).toBe('Filled id:amount (4 characters)');
    expect(fillText('id:amount', { length: 4, ...landed, cleared: 7 })).toBe('Filled id:amount (4 characters, cleared 7 characters first)');
    expect(fillText('id:amount', { length: 4, ...landed, cleared: 1 })).toBe('Filled id:amount (4 characters, cleared 1 character first)');
    expect(fillText('id:pw', { length: 16, ...landed, note: '2 matches; picked the only interactive one (textfield)' })).toBe(
      'Filled id:pw (16 characters) (2 matches; picked the only interactive one (textfield))',
    );
    expect(
      fillText('id:pw', {
        length: 16,
        ...landed,
        warning: 'masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
      }),
    ).toBe(
      'Filled id:pw (16 characters)\n⚠ masked field already held 20 characters and clear is not set — typing APPENDS; pass clear: true to replace',
    );
  });

  // docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md:
  // the reply printed the REQUESTED clear and passed an unreadable read-back.
  it('a clear that sent no delete is not "cleared": an empty field says nothing, a node with no value or no length of its own says so', () => {
    expect(fillText('id:amount', { length: 4, ...landed, cleared: 0 })).toBe('Filled id:amount (4 characters)');
    expect(fillText('id:pw', { length: 6, role: 'textfield', readBack: { kind: 'no-value' }, cleared: 0 })).toBe(
      'Typed 6 characters into id:pw — NOT verified: the matched node exposes no value (role textfield); ' +
        'clear sent no delete — the node gave no length to delete',
    );
    expect(fillText('text:"IBAN*"', { length: 22, role: 'text', readBack: { kind: 'no-value' }, cleared: 'unmeasured' })).toBe(
      'Typed 22 characters into text:"IBAN*" — NOT verified: the matched node exposes no value (role text); ' +
        "clear sent no delete — a role text node's length is not the field's",
    );
    // M-1 (review 2026-10-08): a clear ALONE on a label was "Filled … (0 characters)".
    expect(fillText('text:"IBAN*"', { length: 0, role: 'text', readBack: { kind: 'nothing-typed' }, cleared: 'unmeasured' })).toBe(
      'Focused text:"IBAN*" — NOT verified: clear sent no delete — a role text node\'s length is not the field\'s',
    );
    // A clear whose read-back LANDED needs no caveat: the field shows exactly the value.
    expect(fillText('id:search', { length: 4, role: 'other', readBack: { kind: 'landed' }, cleared: 'unmeasured' })).toBe('Filled id:search (4 characters)');
    expect(fillText('id:title', { length: 1, role: 'text', readBack: { kind: 'not-taken' } })).toBe(
      "Typed 1 character into id:title — NOT verified: the matched node's value does not show the typed text (role text) — it is not the field",
    );
  });

  // Device checks of docs/bugs/2026-10-08-ios-fill-unverified-reports-filled-and-cleared.md (re-run at e9e6509).
  it('one character is `1 character`, typed or cleared, verified or not', () => {
    expect(fillText('role:textfield value:"1.5"', { length: 1, ...landed, cleared: 3 })).toBe('Filled role:textfield value:"1.5" (1 character, cleared 3 characters first)');
    expect(fillText('id:bic', { length: 1, role: 'scrollable', readBack: { kind: 'no-value' } })).toBe(
      'Typed 1 character into id:bic — NOT verified: the matched node exposes no value (role scrollable)',
    );
    expect(typedText(1)).toBe('Typed 1 character');
    expect(typedText(22)).toBe('Typed 22 characters');
  });

  it('a field the read-back could not find again is said as not found, not as a node with no value — and a textfield gets no ⚠', () => {
    expect(fillText('role:textfield value:"XX12345"', { length: 22, role: 'textfield', readBack: { kind: 'lost', why: 'screen-changed' }, cleared: 7 })).toBe(
      'Typed 22 characters into role:textfield value:"XX12345" (cleared 7 characters first) — ' +
        'NOT verified: the field could not be found again (the screen changed while typing)',
    );
    expect(fillText('role:textfield value:"XX"', { length: 3, role: 'textfield', readBack: { kind: 'lost', why: 'unmatched' } })).toBe(
      'Typed 3 characters into role:textfield value:"XX" — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
    // m-1 (review 2026-10-08, bundle C round 1): a clear alone whose read after the delete lost the field.
    expect(fillText('role:textfield value:"XX12345"', { length: 0, role: 'textfield', readBack: { kind: 'lost', why: 'unmatched' }, cleared: 7 })).toBe(
      'Cleared role:textfield value:"XX12345" (7 characters sent as deletes) — ' +
        'NOT verified: the field could not be found again (the selector no longer matches it)',
    );
  });

  it('an unverified fill is "Typed … into", never "Filled", and the not-an-input finding gets its own ⚠ line naming the input', () => {
    expect(
      fillText('text:"IBAN*"', {
        length: 22,
        role: 'text',
        readBack: { kind: 'no-value' },
        notInput: { input: { identifier: 'TextFieldWithComponentStyle', rect: { x: 26, y: 343, width: 350, height: 56 }, overlaps: true } },
      }),
    ).toBe(
      'Typed 22 characters into text:"IBAN*" — NOT verified: the matched node exposes no value (role text)\n' +
        '⚠ the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; ' +
        'the input overlapping it is textfield id:"TextFieldWithComponentStyle" at 26,343 350x56 — ' +
        'select the input itself (role:textfield with its id:, or its current value: when inputs share an id)',
    );
    expect(fillText('text:"Hi"', { length: 2, role: 'text', readBack: { kind: 'no-value' }, notInput: { input: 'none' } })).toBe(
      'Typed 2 characters into text:"Hi" — NOT verified: the matched node exposes no value (role text)\n' +
        '⚠ the matched node is role text, not a textfield — typing goes wherever the focus tap left the focus; no textfield is on the screen',
    );
    // A VERIFIED clear alone keeps its head: what was deleted, seen gone.
    expect(fillText('id:amount', { length: 0, ...landed, readBack: { kind: 'nothing-typed' }, cleared: 4 })).toBe('Filled id:amount (0 characters, cleared 4 characters first)');
    expect(fillText('role:textfield value:"X"', { length: 0, role: 'textfield', readBack: { kind: 'lost', why: 'unmatched' }, cleared: 1 })).toBe(
      'Cleared role:textfield value:"X" (1 character sent as deletes) — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
    // No delete sent is never "Cleared", whatever else is unverified (not produced by fillField today: a lost clear has deleted).
    expect(fillText('id:x', { length: 0, role: 'textfield', readBack: { kind: 'lost', why: 'unmatched' }, cleared: 0 })).toBe(
      'Focused id:x — NOT verified: the field could not be found again (the selector no longer matches it)',
    );
    expect(fillText('text:"Hi"', { length: 0, role: 'text', readBack: { kind: 'nothing-typed' }, notInput: { input: 'unread' } })).toBe(
      'Filled text:"Hi" (0 characters)\n' +
        '⚠ the matched node is role text, not a textfield — nothing was deleted, and the focus is wherever the tap left it; the screen could not be read again to name the input',
    );
  });
});

describe('swipe response line', () => {
  const stroke = { from: { x: 540, y: 1920 }, to: { x: 540, y: 480 } };

  it('swipeText names the stroke sent, the direction when one was given, and the box note on its own ⚠ line', () => {
    expect(swipeText(stroke)).toBe('Swiped (540,1920) → (540,480)');
    expect(swipeText({ ...stroke, direction: 'up' })).toBe('Swiped up (540,1920) → (540,480)');
    expect(swipeText({ ...stroke, direction: 'left', note: 'the UI tree could not be read; swiped over the device screen as built, 1080x2400' })).toBe(
      'Swiped left (540,1920) → (540,480)\n⚠ the UI tree could not be read; swiped over the device screen as built, 1080x2400',
    );
  });
});

describe('launch_app response line', () => {
  it('names the app and the platform; nothing else when there is no activity and no wipe', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'ios' })).toBe('Launched md.bank.app on ios');
    expect(launchText({ appId: 'md.bank.app', platform: 'android', clearState: false })).toBe('Launched md.bank.app on android');
  });

  it('shows the activity that was used, by its last path segment', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: '.MainActivity' })).toBe(
      'Launched md.bank.app/.MainActivity on android',
    );
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: 'md.bank.app/md.bank.ui.MainActivity' })).toBe(
      'Launched md.bank.app/md.bank.ui.MainActivity on android',
    );
  });

  it('says when the state was cleared', () => {
    expect(launchText({ appId: 'md.bank.app', platform: 'android', activity: '.MainActivity', clearState: true })).toBe(
      'Launched md.bank.app/.MainActivity on android (state cleared)',
    );
  });
});

describe('ui_snapshot note (2026-10-06: `[]` right after launch_app was indistinguishable from "no such element")', () => {
  // The rule (what is bare) is ui-tree/bare-tree.ts, pinned against the real
  // parsers in tests/ui-tree/bare-tree.test.ts; this file pins the words.
  const BARE_TAIL =
    'The accessibility tree is empty or unrendered: the screen may still be loading, or — measured on iOS idb 2026-10-06 — ' +
    'the tree stays empty for minutes on a rendered screen. Compare with screenshot: if the screen is rendered, the tree source is stuck, ' +
    'not the app — do not read the element as absent. assert polls (3 s by default; set "timeout" in the spec).';
  const ZERO = { x: 0, y: 0, width: 0, height: 0 };
  /** The measured idb empty tree, normalized: a 0×0 root with one empty other child. */
  const emptyTree = () => node({ role: 'container', rect: ZERO, children: [node({ role: 'other', rect: ZERO })] });
  const pinScreen = () => screen(el({ role: 'button', label: 'Forgot PIN?' }), el({ role: 'text', label: 'Enter your PIN' }));
  const match = (selector: string, ...matched: unknown[]) => ({ selector, matched });

  it('says nothing when the selector matched, whatever the tree', () => {
    expect(snapshotNote(pinScreen(), match('role:button', {}))).toBeUndefined();
    expect(snapshotNote(emptyTree(), match('role:container', {}))).toBeUndefined();
  });

  it('says nothing for an unfiltered tree that carries content', () => {
    expect(snapshotNote(pinScreen())).toBeUndefined();
  });

  it('no match in a tree with content: the count and the roles present by count then name, no warning sign — "absent" is a legitimate answer', () => {
    expect(snapshotNote(pinScreen(), match('label~"Welcome"'))).toBe(
      '0 matches for label~"Welcome" in a tree of 3 nodes (roles: button ×1, container ×1, text ×1)',
    );
  });

  it('no match in a bare tree: ⚠, both readings, the screenshot check, "do not read as absent", assert — no promise that a retry helps', () => {
    expect(snapshotNote(emptyTree(), match('role:button'))).toBe(
      `⚠ 0 matches for role:button, and the tree is bare: 2 nodes, nothing of the app's (only wrappers, unlabeled decoration, or iOS's status bar and launch icon). ${BARE_TAIL}`,
    );
  });

  it('an unfiltered bare tree gets the same note without the match clause — the whole tree reads as "nothing on screen" just the same', () => {
    expect(snapshotNote(emptyTree())).toBe(
      `⚠ The tree is bare: 2 nodes, nothing of the app's (only wrappers, unlabeled decoration, or iOS's status bar and launch icon). ${BARE_TAIL}`,
    );
    expect(snapshotNote(node({ role: 'container', rect: ZERO }))).toMatch(/^⚠ The tree is bare: 1 node, nothing of the app's/);
  });
});
