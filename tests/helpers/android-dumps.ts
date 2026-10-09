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
 * `android.widget.Button` of about the wrapper's rect. The label, button and
 * (for DISCARD) wrapper rects are the note's; the wrappers' other rects, the
 * screens around them and the `resource-id`s the note does not name are
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
  /** Google Contacts' sync promo: "No thanks" under `button 44,1967 992x110`, its centre (541,2023). */
  noThanks: screenXml(`
    <node class="android.view.View" resource-id="promo.no_thanks" bounds="[44,1962][1036,2082]">
      <node class="android.widget.TextView" text="No thanks" bounds="[448,1998][634,2047]" />
      <node class="android.widget.Button" bounds="[44,1967][1036,2077]" />
    </node>`),
  /**
   * mp-native Account Detail: the list `0,825 1080x1395` (Compose's
   * scroller, `scrollable="true"`), a row `container row_2` → `other 'Loan
   * repayment, 17.12.2025, +493.00 EUR' 66,951 948x143`, the avatar
   * `container 116,980 88x88` → `text 'LR' 136,999 48x49`, the amount
   * texts, the row's `button` of the `other`'s rect; row_7 beneath the
   * floating tab bar's host `66,1840 948x248` laid after the list.
   */
  accountDetail: screenXml(`
    <node class="android.view.View" scrollable="true" bounds="[0,825][1080,2220]">
      ${row(2, 951, 'Loan repayment, 17.12.2025', '+493.00 EUR')}
      ${row(7, 1830, 'Card payment, 15.12.2025', '-12.00 EUR')}
    </node>
    <node class="android.view.View" bounds="[66,1840][1014,2088]">
      <node class="android.view.View" resource-id="nav.tab_home" bounds="[66,1876][303,2052]">
        <node class="android.widget.TextView" text="Home" bounds="[100,1990][260,2030]" />
      </node>
    </node>`),
} as const;

/**
 * Classic Android Views whose bottom-pinned CTA is laid AFTER a text in the
 * SAME layout and over it — real covers, built by the review of fix/r6
 * (scratchpad probes, not device dumps): the CTA fills a sliver of its
 * layout and carries its own label, so it is no wrapper's own control
 * (ui-tree/draw-order.ts#ownControl).
 */
export const CLASSIC_VIEWS = {
  /** A login fragment's ConstraintLayout `0,210 1080x1090` with the keyboard up (adjustResize): the bottom-pinned `Button "LOG IN" 40,1150 1000x130` rides up over `TextView "Forgot password?" 380,1180 320x60`. */
  loginImeUp: `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
   <node class="android.widget.LinearLayout" bounds="[0,63][1080,1300]">
    <node class="android.view.ViewGroup" resource-id="app:id/toolbar" bounds="[0,63][1080,210]"><node class="android.widget.TextView" text="Sign in" bounds="[40,100][400,170]"/></node>
    <node class="androidx.constraintlayout.widget.ConstraintLayout" resource-id="app:id/login_root" bounds="[0,210][1080,1300]">
      <node class="android.widget.EditText" text="user" bounds="[40,260][1040,400]"/>
      <node class="android.widget.EditText" text="pass" bounds="[40,420][1040,560]"/>
      <node class="android.widget.TextView" text="Forgot password?" resource-id="app:id/forgot" bounds="[380,1180][700,1240]"/>
      <node class="android.widget.Button" text="LOG IN" resource-id="app:id/login" bounds="[40,1150][1040,1280]"/>
    </node></node></node></hierarchy>`,
  /** Keyboard down: the root ConstraintLayout `0,210 1080x1950` under the toolbar, a bottom-pinned `Button "CONTINUE"` over the terms text. */
  terms: `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="androidx.constraintlayout.widget.ConstraintLayout" bounds="[0,210][1080,2160]">
      <node class="android.widget.TextView" text="By continuing you accept the terms" bounds="[100,1990][980,2040]"/>
      <node class="android.widget.Button" text="CONTINUE" bounds="[40,1960][1040,2090]"/>
    </node></node></hierarchy>`,
  /**
   * A BottomSheetDialog over a 1080x2220 screen: the dialog's window `0,1100 1080x1120` and the sheet `0,1100
   * 1080x1054` (47 % of the screen, so no screen-sized host), a sticky `Button "PAY" 40,1980 1000x130` (0.11 of the
   * sheet) over the fee text.
   */
  sheet: `<hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.FrameLayout" bounds="[0,1100][1080,2220]">
      <node class="android.widget.LinearLayout" resource-id="app:id/sheet" bounds="[0,1100][1080,2154]">
      <node class="android.widget.TextView" text="Fee: 2.00 EUR" bounds="[60,2000][500,2050]"/>
      <node class="android.widget.Button" text="PAY" bounds="[40,1980][1040,2110]"/>
    </node></node></node></hierarchy>`,
} as const;

/** One Account Detail row whose top is `y` (143 px tall), as `COMPOSE.accountDetail` lists it; its label node reads `what, amount`. */
function row(n: number, y: number, what: string, amount: string): string {
  const b = (l: number, t: number, r: number, h: number) => `[${l},${y + t}][${r},${y + t + h}]`;
  return `<node class="android.view.View" resource-id="transactions.list.row_${n}" bounds="${b(66, 0, 1014, 143)}">
        <node class="android.view.View" content-desc="${what}, ${amount}" bounds="${b(66, 0, 1014, 143)}" />
        <node class="android.view.View" bounds="${b(116, 29, 204, 88)}">
          <node class="android.widget.TextView" text="LR" bounds="${b(136, 48, 184, 49)}" />
        </node>
        <node class="android.widget.TextView" text="${what.split(',')[0]}" bounds="${b(236, 24, 600, 49)}" />
        <node class="android.widget.TextView" text="${amount}" bounds="${b(760, 39, 980, 49)}" />
        <node class="android.widget.Button" bounds="${b(66, 0, 1014, 143)}" />
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
