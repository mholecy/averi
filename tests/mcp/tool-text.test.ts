import { describe, expect, it } from 'vitest';
import { deepLinkText, launchText, snapshotNote, swipeText, tapText, typedText } from '../../src/mcp/tool-text.js';
import { el, node, screen } from '../helpers/fake.js';

describe('tap and type_text response lines', () => {
  it('tapText names the selector, and the resolution note when there was one', () => {
    expect(tapText('id:go', undefined)).toBe('Tapped id:go');
    expect(tapText('id:go', '2 matches; picked the only interactive one (button)')).toBe(
      'Tapped id:go (2 matches; picked the only interactive one (button))',
    );
  });

  it('tapText says where the tap went when it was moved off a covered centre (2026-10-09), before the note', () => {
    const moved = 'at (201,767) — its centre (201,780) is under button "Continue to summary" (24,780 354x44), drawn over it; tapped the uncovered part 354x26';
    expect(tapText('id:p', undefined, moved)).toBe(`Tapped id:p ${moved}`);
    expect(tapText('id:p', 'a note', moved)).toBe(`Tapped id:p ${moved} (a note)`);
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

// D49a: open_deep_link's reply — iOS's note for a link to the project's own scheme on its own ⚠ line.
describe('deepLinkText', () => {
  it('without a note: the one line', () => {
    expect(deepLinkText('ios', 'averilab://d49', {})).toBe('Opened averilab://d49 on ios');
    expect(deepLinkText('android', 'bank://home', {})).toBe('Opened bank://home on android');
  });

  it('with a note: the note on a ⚠ line under it, verbatim', () => {
    expect(deepLinkText('ios', 'averilab://d49', { note: 'averi did not see dev.averi.lab come forward' })).toBe(
      'Opened averilab://d49 on ios\n⚠ averi did not see dev.averi.lab come forward',
    );
  });
  // D54: iOS's alert named — the headline says the link is not open yet, quotes the title and every button with its
  // centre, and advises a tap at those coordinates (the only answer measured on a device); averi taps nothing.
  const alert = {
    title: 'Open in “AveriLab”?',
    buttons: [
      { label: 'Cancel', centre: { x: 127, y: 474 } },
      { label: 'Open', centre: { x: 275, y: 474 } },
    ],
  };

  it('an alert that names the app: "iOS has not opened <url> yet: it asks …", every button with its centre, the tap advice', () => {
    expect(deepLinkText('ios', 'averilab://d54', { alert: { ...alert, asksForApp: true } })).toBe(
      'iOS has not opened averilab://d54 yet: it asks "Open in “AveriLab”?" — buttons "Cancel" at (127, 474), "Open" at ' +
        '(275, 474). Answer it with a tap at the chosen button\'s x and y (averi taps nothing itself); every launch stays ' +
        'behind the alert until it is answered',
    );
  });

  it('an alert whose title does not name the app: "a system alert", never "Open in" in averi\'s own words', () => {
    const text = deepLinkText('ios', 'averilab://d54', { alert: { title: 'Allow “Lab” to use your location?', buttons: [{ label: 'Allow Once', centre: { x: 201, y: 500 } }], asksForApp: false } });
    expect(text).toBe(
      'iOS has not opened averilab://d54 yet: a system alert is up, "Allow “Lab” to use your location?" — button ' +
        '"Allow Once" at (201, 500). Answer it with a tap at the chosen button\'s x and y (averi taps nothing itself); ' +
        'every launch stays behind the alert until it is answered',
    );
    expect(text.replace('"Allow “Lab” to use your location?"', '')).not.toMatch(/Open in|asks/);
  });

  it('no "Opened" headline and no ⚠ line with an alert; a note alone keeps both', () => {
    expect(deepLinkText('ios', 'averilab://d54', { alert: { ...alert, asksForApp: true } })).not.toMatch(/Opened|⚠|\n/);
    expect(deepLinkText('ios', 'averilab://d54', { note: 'x' })).toBe('Opened averilab://d54 on ios\n⚠ x');
  });
});
