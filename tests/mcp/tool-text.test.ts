import { describe, expect, it } from 'vitest';
import { launchText, snapshotNote, swipeText, tapText, typedText } from '../../src/mcp/tool-text.js';
import { el, node, screen } from '../helpers/fake.js';

describe('tap and type_text response lines', () => {
  it('tapText names the selector, and the resolution note when there was one', () => {
    expect(tapText('id:go', undefined)).toBe('Tapped id:go');
    expect(tapText('id:go', '2 matches; picked the only interactive one (button)')).toBe(
      'Tapped id:go (2 matches; picked the only interactive one (button))',
    );
  });

  // The type_text reply WITH a selector is interact/fill-text.ts's since
  // 2026-10-09, pinned beside the flow line in tests/interact/fill-text.test.ts.
  it('typedText (no selector: nothing read back) counts characters, singular for one', () => {
    expect(typedText(1)).toBe('Typed 1 character');
    expect(typedText(22)).toBe('Typed 22 characters');
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
  // The app's own wording (the activity's last segment) is the launch's —
  // tests/flow/launch.test.ts; what is pinned here is the reply's layout.
  it('names the app and the platform; nothing else without a note or a wipe', () => {
    expect(launchText('ios', { app: 'md.bank.app' })).toBe('Launched md.bank.app on ios');
    expect(launchText('android', { app: 'md.bank.app/.MainActivity' })).toBe('Launched md.bank.app/.MainActivity on android');
  });

  // 2026-10-09: the launch's caveat (LaunchOutcome.note — iOS's foreground
  // wait giving up) on its own ⚠ line, as swipeText lays out its note; the
  // wipe's sentence under it, labelled as the flow's trace line is.
  it("says (state cleared) after the platform, and puts the note, then the wipe, each on a ⚠ line of its own — the flow's order", () => {
    expect(
      launchText('ios', { app: 'com.apple.MobileAddressBook', note: 'the tree was still another app', wiped: 'app state wiped (1 this session)' }),
    ).toBe(
      'Launched com.apple.MobileAddressBook on ios (state cleared)\n⚠ the tree was still another app\n⚠ clearState: app state wiped (1 this session)',
    );
    expect(launchText('android', { app: 'md.bank.app/.MainActivity', wiped: 'app state wiped (2 this session)' })).toBe(
      'Launched md.bank.app/.MainActivity on android (state cleared)\n⚠ clearState: app state wiped (2 this session)',
    );
    expect(launchText('ios', { app: 'md.bank.app', note: undefined, wiped: undefined })).toBe('Launched md.bank.app on ios');
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
