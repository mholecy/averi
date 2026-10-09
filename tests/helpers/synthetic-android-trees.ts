/**
 * SYNTHETIC uiautomator dumps — built by the review of fix/r6, not captured
 * on a device: classic Android Views whose bottom-pinned CTA is laid AFTER a
 * text in the SAME layout and over it, real covers. The CTA is inset from
 * its layout's sides and carries its own label, so it is no wrapper's own
 * control (ui-tree/draw-order.ts#ownControl). Each a `<hierarchy>` for
 * `parseUiautomatorXml`.
 */
export const CLASSIC_VIEWS = {
  /** A login fragment's ConstraintLayout `0,210 1080x1090` with the keyboard up (adjustResize): the bottom-pinned `Button "LOG IN" 40,1150 1000x130` rides up over `TextView "Forgot password?" 380,1180 320x60`. */
  loginImeUp: `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.LinearLayout" bounds="[0,63][1080,1300]">
      <node class="android.view.ViewGroup" resource-id="app:id/toolbar" bounds="[0,63][1080,210]">
        <node class="android.widget.TextView" text="Sign in" bounds="[40,100][400,170]"/>
      </node>
      <node class="androidx.constraintlayout.widget.ConstraintLayout" resource-id="app:id/login_root" bounds="[0,210][1080,1300]">
        <node class="android.widget.EditText" text="user" bounds="[40,260][1040,400]"/>
        <node class="android.widget.EditText" text="pass" bounds="[40,420][1040,560]"/>
        <node class="android.widget.TextView" text="Forgot password?" resource-id="app:id/forgot" bounds="[380,1180][700,1240]"/>
        <node class="android.widget.Button" text="LOG IN" resource-id="app:id/login" bounds="[40,1150][1040,1280]"/>
      </node>
    </node>
  </node>
</hierarchy>`,
  /** Keyboard down: the root ConstraintLayout `0,210 1080x1950` under the toolbar, a bottom-pinned `Button "CONTINUE"` over the terms text. */
  terms: `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="androidx.constraintlayout.widget.ConstraintLayout" bounds="[0,210][1080,2160]">
      <node class="android.widget.TextView" text="By continuing you accept the terms" bounds="[100,1990][980,2040]"/>
      <node class="android.widget.Button" text="CONTINUE" bounds="[40,1960][1040,2090]"/>
    </node>
  </node>
</hierarchy>`,
  /**
   * A BottomSheetDialog over a 1080x2220 screen: the dialog's window `0,1100
   * 1080x1120` and the sheet `0,1100 1080x1054` (47 % of the screen, so no
   * screen-sized host), a sticky `Button "PAY" 40,1980 1000x130`, inset from
   * the sheet's sides, over the fee text.
   */
  sheet: `<hierarchy rotation="0">
  <node class="android.widget.FrameLayout" bounds="[0,0][1080,2220]">
    <node class="android.widget.FrameLayout" bounds="[0,1100][1080,2220]">
      <node class="android.widget.LinearLayout" resource-id="app:id/sheet" bounds="[0,1100][1080,2154]">
        <node class="android.widget.TextView" text="Fee: 2.00 EUR" bounds="[60,2000][500,2050]"/>
        <node class="android.widget.Button" text="PAY" bounds="[40,1980][1040,2110]"/>
      </node>
    </node>
  </node>
</hierarchy>`,
} as const;
