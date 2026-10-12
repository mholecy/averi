import { parseUiautomatorXml } from '../../src/adapters/android.js';
import type { UiNode } from '../../src/adapters/types.js';
import { drawnOverStrip } from '../../src/ui-tree/draw-order.js';

/**
 * The uiautomator parser's port as production wires it (mcp/registry.ts):
 * the UI-tree layer's draw order judges what is drawn over a node's gained
 * strip (adapters/types.ts#DrawnOverStrip). For every test that builds an
 * AndroidAdapter or parses a dump.
 */
export { drawnOverStrip };

/** `parseUiautomatorXml` with the port production wires — what a test parses a dump with. */
export const parseDump = (xml: string): UiNode => parseUiautomatorXml(xml, drawnOverStrip);

/**
 * The line `adb shell "dumpsys input_method | grep -m1 mInputShown"` prints —
 * real, emulator-5554 (API 33), 2026-10-04 (false); true was observed on the
 * login screen the same day. Shared by the adapter's witness tests and the
 * end-to-end keyboard test.
 */
export const INPUT_SHOWN_LINE = (shown: boolean) =>
  `  mShowRequested=${shown} mShowExplicitlyRequested=false mShowForced=false mInputShown=${shown}\n`;

/**
 * The floating-Gboard device check (2026-10-08, emulator-5554, Pixel_3a AVD,
 * API 33, 1080x2220 portrait — docs/bugs/2026-10-05-android-floating-gboard-
 * keyboard.md, the three "Device check" sections), as the commands printed
 * it. `displays`: the lines of `dumpsys window displays` the oracle's state()
 * reads; `touchable`: what AndroidAdapter's keyboardTouchable command prints
 * — the `mInputShown` line of `dumpsys input_method`, then the `touchable
 * region=` line of `dumpsys window InputMethod`. Shared by the adapter's
 * parser tests, the reader's rules (tests/ui-tree/keyboard-cover.test.ts) and
 * the end-to-end keyboard test.
 */
export const GBOARD = {
  /** Floating, IBAN field focused, the panel drawn at about x 359–1040, y 1269–1912: the IME inset is only the 132-px collapse strip. */
  floating: {
    displays:
      '    mIsImeShowing=true\n' +
      '        InsetsSource type=ITYPE_IME frame=[0,2088][1080,2220] visibleFrame=[0,2088][1080,2220] visible=true\n',
    touchable:
      '  mShowRequested=true mShowExplicitlyRequested=true mShowForced=false mInputShown=true\n' +
      '  touchable region=SkRegion((359,1269,1040,1912)(0,2088,1080,2220))\n',
  },
  /** Docked, Settings search field focused: the region is one rect, equal to the band. */
  docked: {
    displays:
      '        InsetsSource type=ITYPE_IME frame=[0,1398][1080,2220] visibleFrame=[0,1398][1080,2220] visible=true\n',
    touchable:
      '  mShowRequested=true mShowExplicitlyRequested=false mShowForced=false mInputShown=true\n' +
      '  touchable region=SkRegion((0,1398,1080,2220))\n',
  },
  /** Hidden by `back`: the region is NOT empty — the collapsed strip stays. */
  hidden: {
    displays:
      '        InsetsSource type=ITYPE_IME frame=[0,0][0,0] visibleFrame=[0,2088][1080,2220] visible=false\n',
    touchable:
      '  mShowRequested=false mShowExplicitlyRequested=false mShowForced=false mInputShown=false\n' +
      '  touchable region=SkRegion((0,2088,1080,2220))\n',
  },
  /** Hidden, the first read after a LANDSCAPE keyboard, back in portrait: the region is stale, in landscape coordinates. */
  staleLandscape: {
    touchable:
      '  mShowRequested=false mShowExplicitlyRequested=false mShowForced=false mInputShown=false\n' +
      '  touchable region=SkRegion((0,948,2220,1080))\n',
  },
} as const;

/** The floating panel and its band, as rects (the fixtures' `(l,t,r,b)` read). */
export const GBOARD_PANEL = { x: 359, y: 1269, width: 681, height: 643 } as const;
export const GBOARD_STRIP = { x: 0, y: 2088, width: 1080, height: 132 } as const;

/**
 * Compose screens as uiautomator dumps them (2026-10-09 15:35–16:01 UTC,
 * emulator-5554, Pixel_3a AVD, API 33, 1080x2220 — docs/bugs/2026-10-09-
 * android-compose-button-text-refused-as-under-its-own-button.md), each a
 * `<hierarchy>` for `parseUiautomatorXml`. A Compose `Button` is a wrapper
 * holding its label text and, AFTER it, an unlabelled clickable
 * `android.widget.Button` of the wrapper's x and width. The rects are the
 * round-5 ui_snapshots' (tests/fixtures/android-ui-snapshot-compose.json)
 * where those have the screen — LOGIN, "No thanks", the Account Detail row
 * and tab bar — and the note's otherwise (SIGN IN's and DISCARD's label and
 * button; SIGN IN's wrapper is filled in). The screens around them, the
 * second Account Detail row and the `resource-id`s the snapshots lack are
 * filled in (a FakeAdapter tap needs an identified node at the point).
 */
export const COMPOSE = {
  /** mp-native's inactivity "Logged out" screen: `text 'LOGIN' 481,1438 118x49` + `button 44,1402 992x121` in `container 44,1397 992x132`. */
  login: screenXml(`
    <node class="android.widget.TextView" text="Logged out" bounds="[66,700][1014,780]" />
    <node class="android.view.View" resource-id="auth.logged_out.login" bounds="[44,1397][1036,1529]">
      <node class="android.widget.TextView" text="LOGIN" bounds="[481,1438][599,1487]" />
      <node class="android.widget.Button" bounds="[44,1402][1036,1523]" />
    </node>`),
  /** mp-native Welcome: `text 'SIGN IN' 469,1844 143x49` + `button 44,1808 992x121`. */
  signIn: screenXml(`
    <node class="android.view.View" resource-id="welcome.sign_in" bounds="[44,1803][1036,1935]">
      <node class="android.widget.TextView" text="SIGN IN" bounds="[469,1844][612,1893]" />
      <node class="android.widget.Button" bounds="[44,1808][1036,1929]" />
    </node>`),
  /** The SWIFT form's exit dialog: `swift_payment.form.discard_button 638,1187 276x132` holding `text 688,1228 176x49` + `button 638,1192 276x121`. */
  discard: screenXml(`
    <node class="android.view.View" bounds="[110,880][970,1360]">
      <node class="android.widget.TextView" text="Discard the payment?" bounds="[166,940][914,1000]" />
      <node class="android.view.View" resource-id="swift_payment.form.keep_editing_button" bounds="[262,1187][638,1319]">
        <node class="android.widget.TextView" text="KEEP EDITING" bounds="[300,1228][600,1277]" />
        <node class="android.widget.Button" bounds="[262,1192][638,1313]" />
      </node>
      <node class="android.view.View" resource-id="swift_payment.form.discard_button" bounds="[638,1187][914,1319]">
        <node class="android.widget.TextView" text="DISCARD" bounds="[688,1228][864,1277]" />
        <node class="android.widget.Button" bounds="[638,1192][914,1313]" />
      </node>
    </node>`),
  /** Google Contacts' sync promo (ui_snapshot): `container 44,1956 992x132` → `text 'No thanks' 450,1995 181x55`, `button 44,1967 992x110`. */
  noThanks: screenXml(`
    <node class="android.view.View" resource-id="promo.no_thanks" bounds="[44,1956][1036,2088]">
      <node class="android.widget.TextView" text="No thanks" bounds="[450,1995][631,2050]" />
      <node class="android.widget.Button" bounds="[44,1967][1036,2077]" />
    </node>`),
  /**
   * mp-native Account Detail: the list `0,825 1080x1395` (Compose's
   * scroller, `scrollable="true"`), a row `container row_2` → `other 'Loan
   * repayment, 17.12.2025, +493.00 EUR' 66,951 948x143`, the avatar
   * `container 116,979 88x88` → `text 'LR' 136,999 48x49`, the title and
   * amount texts, the row's `button` of the `other`'s rect; row_7 (filled
   * in) beneath the floating tab bar's host `66,1840 948x248` laid after
   * the list, its first tab `nav.tab_home 102,1876 219x176`.
   */
  accountDetail: screenXml(`
    <node class="android.view.View" scrollable="true" bounds="[0,825][1080,2220]">
      ${row(2, 951, 'Loan repayment, 17.12.2025', '+493.00 EUR', 'LR')}
      ${row(7, 1830, 'Card payment, 15.12.2025', '-12.00 EUR', 'CP')}
    </node>
    <node class="android.view.View" bounds="[66,1840][1014,2088]">
      <node class="android.view.View" resource-id="nav.tab_home" bounds="[102,1876][321,2052]">
        <node class="android.view.View" content-desc="Home" bounds="[173,1926][250,2003]" />
      </node>
    </node>`),
} as const;

/**
 * One Account Detail row whose top is `y`, as `COMPOSE.accountDetail` lists
 * it, at the ui_snapshot's offsets: its label node reads `what, amount`, its
 * avatar shows `initials`.
 */
function row(n: number, y: number, what: string, amount: string, initials: string): string {
  const bounds = (left: number, top: number, width: number, height: number) => `[${left},${y + top}][${left + width},${y + top + height}]`;
  return `<node class="android.view.View" resource-id="transactions.list.row_${n}" bounds="${bounds(66, 0, 948, 143)}">
        <node class="android.view.View" content-desc="${what}, ${amount}" bounds="${bounds(66, 0, 948, 143)}" />
        <node class="android.view.View" bounds="${bounds(116, 28, 88, 88)}">
          <node class="android.widget.TextView" text="${initials}" bounds="${bounds(136, 48, 48, 49)}" />
        </node>
        <node class="android.widget.TextView" text="${what.split(',')[0]}" bounds="${bounds(254, 47, 298, 49)}" />
        <node class="android.widget.TextView" text="${amount}" bounds="${bounds(736, 47, 228, 49)}" />
        <node class="android.widget.Button" bounds="${bounds(66, 0, 948, 143)}" />
      </node>`;
}

/** A 1080x2220 screen: the window's FrameLayout and a full-screen Compose host holding `body`. */
function screenXml(body: string): string {
  return `<hierarchy rotation="0">
<node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
  <node class="android.view.View" bounds="[0,0][1080,2220]">${body}
  </node>
</node>
</hierarchy>`;
}
