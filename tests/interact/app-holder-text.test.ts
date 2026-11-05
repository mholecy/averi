import { describe, expect, it } from 'vitest';
import type { AppHolder, ChooserSheet, LinkAlert } from '../../src/adapters/types.js';
import { appHolderText } from '../../src/interact/app-holder-text.js';

// A10 (ADR 0041's and ADR 0032's A10 amendments): every word about what holds the app, pinned through the module's one
// interface: the subject (a link or an app) and the closed answer. The kind of holder decides the wording; no platform
// is passed. The expected strings are the replies' bytes, as ADR 0032's D54/D56/D57 and ADR 0041's D55/D55b/D55c state
// them; moved here from the adapters' tests and tool-text.test.ts with the words.

const LINK = { link: 'averilab://d54' };
const APP = { app: 'dev.averi.lab' };

const alertOf = (alert: LinkAlert): AppHolder => ({ holder: 'alert', alert });
const OPEN_IN: LinkAlert = {
  title: 'Open in “AveriLab”?',
  buttons: [
    { label: 'Cancel', centre: { x: 127, y: 474 } },
    { label: 'Open', centre: { x: 275, y: 474 } },
  ],
  asksForApp: true,
};
const ANOTHER: LinkAlert = { title: 'Allow “Lab” to use your location?', buttons: [{ label: 'Allow Once', centre: { x: 201, y: 500 } }], asksForApp: false };

/** D57's advice: a tap by the button's label first, its x and y the fallback, none by averi, and what the alert holds back. */
const ALERT_ADVICE =
  'Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y (averi taps nothing itself); ' +
  'every launch stays behind the alert until it is answered';

describe('nothing to say: no holder named, or the caveat verbatim', () => {
  it('no holder: no text, for a link and for a launch', () => {
    expect(appHolderText(LINK, { holder: 'none' })).toBeUndefined();
    expect(appHolderText(APP, { holder: 'none' })).toBeUndefined();
  });

  it("a caveat (the foreground wait's, its words the adapter's): verbatim, for a link and for a launch", () => {
    expect(appHolderText(LINK, { holder: 'unknown', caveat: 'averi did not see dev.averi.lab come forward' })).toBe('averi did not see dev.averi.lab come forward');
    expect(appHolderText(APP, { holder: 'unknown', caveat: 'the tree was still another app' })).toBe('the tree was still another app');
  });
});

describe('a system alert holds it (D54, D56, D57)', () => {
  it('a link, the title naming its app: "iOS has not opened <url> yet: it asks …", every button with its centre, the tap advice', () => {
    expect(appHolderText(LINK, alertOf(OPEN_IN))).toBe(
      'iOS has not opened averilab://d54 yet: it asks "Open in “AveriLab”?" — buttons "Cancel" at (127, 474), "Open" at ' +
        '(275, 474). Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y (averi taps ' +
        'nothing itself); every launch stays behind the alert until it is answered',
    );
  });

  it('a link, the title not naming its app: "a system alert", one button, never "Open in" in averi\'s own words', () => {
    const text = appHolderText(LINK, alertOf(ANOTHER));
    expect(text).toBe(
      'iOS has not opened averilab://d54 yet: a system alert is up, "Allow “Lab” to use your location?" — button ' +
        '"Allow Once" at (201, 500). Answer it with tap text:"<label>" for the button you mean, or a tap at its x and y ' +
        '(averi taps nothing itself); every launch stays behind the alert until it is answered',
    );
    expect(text?.replace('"Allow “Lab” to use your location?"', '')).not.toMatch(/Open in|asks/);
  });

  it('a launch: "has not brought <app> forward", D48\'s read again after the advice', () => {
    const note =
      'iOS has not brought dev.averi.lab forward yet: a system alert is up, "Open in “AveriLab”?" — buttons "Cancel" at ' +
      `(127, 474), "Open" at (275, 474). ${ALERT_ADVICE} — then read again before trusting a read`;
    expect(appHolderText(APP, alertOf({ ...OPEN_IN, asksForApp: false }))).toBe(note);
    // Never "it asks" for a launch: the alert belongs to something earlier, and may name another app (D56).
    expect(appHolderText(APP, alertOf(OPEN_IN))).toBe(note);
  });

  it('a launch under a one-button alert: "button", singular', () => {
    expect(appHolderText(APP, alertOf(ANOTHER))).toBe(
      'iOS has not brought dev.averi.lab forward yet: a system alert is up, "Allow “Lab” to use your location?" — button ' +
        `"Allow Once" at (201, 500). ${ALERT_ADVICE} — then read again before trusting a read`,
    );
  });
});

const RESOLVER = 'android/com.android.internal.app.ResolverActivity';
const SHARED = { link: 'averilab://shared/open' };
const chooserOf = (sheet?: ChooserSheet): AppHolder => ({ holder: 'chooser', chooser: { component: RESOLVER, ...(sheet !== undefined && { sheet }) } });

describe('a chooser holds it, read by its component alone (D55, D55b)', () => {
  it('a link: "Android has not opened <url> yet: its chooser (<component>) is in front …", pick the app, "Just once", never "Always", BACK drops the link', () => {
    expect(appHolderText(SHARED, chooserOf())).toBe(
      'Android has not opened averilab://shared/open yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        'is in front, asking which app opens it. Take a ui_snapshot, tap the app you mean, then its "Just once" button ' +
        'if it shows one (never "Always": it changes the device\'s default for such links); press_key back drops the ' +
        'link. averi taps nothing itself.',
    );
  });

  it("a launch: the chooser in front and the package not, no claim whose intent it answers, the advice, naming the activity", () => {
    expect(appHolderText(APP, chooserOf())).toBe(
      'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        'is in front, and dev.averi.lab is not. Take a ui_snapshot, tap the app you mean, then its "Just once" button if ' +
        'it shows one (never "Always": it changes the device\'s default for the intent it answers); press_key back drops ' +
        'the chooser. averi taps nothing itself. Naming the activity (`activity:` on the launch step / launch_app) starts ' +
        'it without the chooser.',
    );
  });
});

describe('a chooser holds it, its sheet read (D55c)', () => {
  const SHEET: ChooserSheet = {
    title: 'Open with',
    apps: [
      { label: 'AveriLab', centre: { x: 540, y: 1727 } },
      { label: 'AveriLab', detail: 'AveriLab twin', centre: { x: 540, y: 1881 } },
    ],
    once: { label: 'Just once', centre: { x: 723, y: 2058 }, disabled: true },
    always: { label: 'Always', centre: { x: 936, y: 2058 }, disabled: true },
  };
  /** The same chooser with a row selected (batch-11's selected tree): neither button marked. */
  const SELECTED: ChooserSheet = { ...SHEET, once: { ...SHEET.once, disabled: false }, always: { ...SHEET.always, disabled: false } };
  const LINK_HEAD =
    'Android has not opened averilab://shared/open yet: its chooser (android/com.android.internal.app.ResolverActivity) is in front, asking which app opens it. ';
  const SAYS =
    'Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and ' +
    'the buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058) (disabled)';
  const LINK_ADVICE =
    "Tap the app's row at its x and y (one tap only selects it and enables the buttons), then tap id:button_once " +
    "(never id:button_always: it changes the device's default for such links); press_key back drops the link. averi " +
    'taps nothing itself.';

  it("a link: the title, the apps with their rows' centres, the buttons with theirs, \"(disabled)\" where marked, then its advice", () => {
    expect(appHolderText(SHARED, chooserOf(SHEET))).toBe(`${LINK_HEAD}${SAYS}. ${LINK_ADVICE}`);
  });

  it('no title: no quoted name; one app: "app"; enabled buttons: no "(disabled)", and the tap enables nothing', () => {
    const sheet: ChooserSheet = { apps: [SHEET.apps[1]], once: SELECTED.once, always: SELECTED.always };
    expect(appHolderText(SHARED, chooserOf(sheet))).toBe(
      `${LINK_HEAD}Its sheet lists the app "AveriLab" ("AveriLab twin") at (540, 1881) and the buttons "Just once" at (723, 2058), "Always" at (936, 2058). ` +
        LINK_ADVICE.replace(' and enables the buttons', ''),
    );
  });

  it('one button disabled, the other not: the mark on that one alone, and the tap still enables the buttons', () => {
    expect(appHolderText(SHARED, chooserOf({ ...SHEET, always: SELECTED.always }))).toBe(
      `${LINK_HEAD}Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and the buttons "Just once" at (723, 2058) (disabled), "Always" at (936, 2058). ${LINK_ADVICE}`,
    );
    expect(appHolderText(SHARED, chooserOf({ ...SHEET, once: SELECTED.once }))).toBe(
      `${LINK_HEAD}Its sheet "Open with" lists the apps "AveriLab" at (540, 1727), "AveriLab" ("AveriLab twin") at (540, 1881) and the buttons "Just once" at (723, 2058), "Always" at (936, 2058) (disabled). ${LINK_ADVICE}`,
    );
  });

  it("a launch: D55b's first sentence, the sheet, the launch's sheet advice, naming the activity", () => {
    expect(appHolderText(APP, chooserOf(SHEET))).toBe(
      'Android has not brought dev.averi.lab forward yet: its chooser (android/com.android.internal.app.ResolverActivity) ' +
        `is in front, and dev.averi.lab is not. ${SAYS}. Tap the app's row at its x and y (one tap only selects it and ` +
        "enables the buttons), then tap id:button_once (never id:button_always: it changes the device's default for the " +
        'intent it answers); press_key back drops the chooser. averi taps nothing itself. Naming the activity ' +
        '(`activity:` on the launch step / launch_app) starts it without the chooser.',
    );
  });
});
