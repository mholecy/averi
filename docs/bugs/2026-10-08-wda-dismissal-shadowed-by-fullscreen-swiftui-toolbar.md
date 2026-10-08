# BUG: through WebDriverAgent a full-screen SwiftUI `Toolbar` "shadows" every point, so a configured `keyboardDismiss` tap on the screen title is refused as "covered"

> **Status (2026-10-08, after the device check):** the first fix (branch `fix/p3-wda-toolbar-shadow`, merged into `fix/keyboard-aware-scroll`) **did not hold on the device** at `e9e6509` ("Device check" below): the screen-sized `toolbar 'Toolbar'` host was excused, but the form's `scrollable 0 0 402 512` after the title (58 % of the screen, its frame under the translucent top bar, no content at the point) then covered the title and the dismissal was refused `covered by scrollable`. Fixed again on branch `fix/r2-b-shadowing`, unmeasured on a device: `shadowing` (`src/ui-tree/geometry.ts`) excuses (1) a later screen-sized HOST — a non-interactive node with children whose area reaches `SCREEN_SIZED_FRACTION` of the root's rect (the largest rect when the root has none) — and now (2) a non-interactive `scrollable` with children of ANY size (`CONTENT_FRAMED_ROLES`): both cover only through their content at the point; a childless or interactive node, a `webview` under the screen size and a smaller card still cover as themselves. Pinned by tests built from the device-check tree (title, container, the form's scrollable with rows from y 150, the 402×874 toolbar, the pad's band `0 572 402 302`), with and without the toolbar, through `shadowing`, the tap guard and the post-fill dismissal. Re-run the repro with `treeSource: wda` to confirm the title is tapped and the keyboard hides. (`SCREEN_SIZED_FRACTION` lives in `adapters/types.ts` beside `STRUCTURAL_ROLES` since the merge into `fix/keyboard-aware-scroll`.)

**Measured 2026-10-08 16:42–16:43 UTC** in `/Users/mholecy/Finshape/mp-native` (SWIFT payment form, branch
`feature/swift-payment`) with a scratch config — mp-native's `averi.yaml` uses idb and was not edited — iPhone 17
simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`), averi = mobile-verify @ `c35388a` built from source (WDA
from `averi-wda`'s `WebDriverAgentRunner_iphonesimulator26.5-arm64.xctestrun`).

Scratch config:

```yaml
app:
  ios:
    bundleId: com.finshape.dbosbanking
    app: /Users/mholecy/Finshape/mp-native/ios/build/Build/Products/Debug-iphonesimulator/Internal.app
    treeSource: wda
    keyboardDismiss:
      - tap: { id: swift_payment.form.title }
```

## Observed (measured)

With the decimal pad up after `tap { selector: "id:swift_payment.form.amount_input" }` (`role:keyboard` band
`{x:0, y:572, w:402, h:302}`):

```
16:43:01  tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch> }
→ The soft keyboard covers id:swift_payment.form.priority_select: the band it draws over [0,572][402,874] contains the
  tap point (201,707) on two looks 300ms apart; this adapter cannot hide it on its own (…), and none of the configured
  dismissals is usable on this screen (tap id:"swift_payment.form.title": covered by toolbar "Toolbar"). Nothing was
  tapped: …                                                                               (6.6 s)
```

Reproduced at the next call with the same sentence. The title is NOT covered: it is drawn in the top bar at
`{x:135, y:73, w:131, h:22}`, and a plain tap on it (`tap id:swift_payment.form.title`, idb) hid the keyboard at 16:40
on the same screen.

The WDA tree (`ui_snapshot` unfiltered, abridged, pre-order):

```
          text 'SWIFT PAYMENT' swift_payment.form.title 135 73 131 22
       container … 0 0 402 874
         … the form, scrollable 0 0 402 512, the inputs …
           button 'Continue to summary' swift_payment.form.continue_button 24 512 354 44
       toolbar 'Toolbar' id=Toolbar 0 0 402 874          ← after the title, full screen
        container None None None 0 0 402 874
      button 'Home' nav.tab_home 69 711 67 52            ← the (hidden) tab bar of the host
      …
```

A `Toolbar` element labelled "Toolbar" with a full-screen frame follows the title in pre-order (SwiftUI's toolbar host
of the pushed screen; it draws nothing over the title).

## Why (read from the source)

- `src/ui-tree/geometry.ts:560–572` `shadowing`: the last node after the target in pre-order that is not in
  `STRUCTURAL_ROLES`, has area and contains the point. `STRUCTURAL_ROLES` is `['container', 'other']`
  (`src/adapters/types.ts:161`).
- `src/adapters/wda-source.ts:49–62` maps `Toolbar` → `toolbar` ("as `toolbar` it always does [count] — a toolbar on
  screen is rendered UI, labelled or not"). That reasoning was measured on the 48-pt input-accessory toolbar
  (2026-10-07); a screen-sized `Toolbar` is a wrapper, and the size rule that keeps full-screen `other`s out of
  `isBareTree` (`ui-tree/bare-tree.ts#wrapperBySize`) is not applied in `shadowing`.
- So on any SwiftUI screen with a `.toolbar` / navigation toolbar host, every `tap:` dismissal is "covered" and the
  guard refuses the covered target.

## Why it matters

`keyboardDismiss: [tap: { id: <title> }]` is the dismissal the tool description and troubleshooting.md recommend for
iOS; on this (SwiftUI) app it can never be used, so every tap on a field or select under the keyboard is refused with
advice to configure the very dismissal that is configured. (mp-native is on idb today; this blocks the documented
path to `treeSource: wda`, which mp-native's own `averi.yaml` header considers for its container ids.)

## Possible fix directions (owner's choice)

- Apply the wrapper-by-size rule in `shadowing`: a non-structural node whose area reaches `SCREEN_SIZED_FRACTION` of
  the root (taken: only a non-interactive one with children, see Status) does not shadow (a real modal sheet/alert is smaller than the screen, or carries content children that do).
- Or judge cover by the shadowing node's content children (leaf with label/text) rather than the container itself.
- A test with this tree (title, then a 402×874 `Toolbar`) pinning the title as usable.

## Repro

1. A SwiftUI pushed screen with a navigation toolbar, `treeSource: wda`, `keyboardDismiss: [tap: { id: <title id> }]`.
2. Focus a text field (soft keyboard up), `tap` an element under the keyboard → refused, `covered by toolbar "Toolbar"`.
3. `ui_snapshot` → a `toolbar` node with the screen's full frame after the title in pre-order.


## Device check (2026-10-08 iOS, re-run at e9e6509)

Measured 20:06–20:20 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), mp-native
(`feature/swift-payment`), averi = mobile-verify `fix/keyboard-aware-scroll` @ `e9e6509` (`dist/`, stdio). **Does not hold**: the toolbar is excused now, but the next node in pre-order, the form's `scrollable`, covers the title.

Scratch config as in the note (`treeSource: wda`, `keyboardDismiss: [tap: { id: swift_payment.form.title }]`), decimal pad up
after `tap id:swift_payment.form.amount_input` (`role:keyboard` `0 572 402 302`), `priority_select` at y 681 (under the pad):

```
20:16  tap { selector: "id:swift_payment.form.priority_select", configPath: <scratch> }       (6.5 s)
→ The soft keyboard covers id:swift_payment.form.priority_select: the band it draws over [0,572][402,874] contains the
  tap point (201,707) on two looks 300ms apart; this adapter cannot hide it on its own (…), and none of the configured
  dismissals is usable on this screen (tap id:"swift_payment.form.title": covered by scrollable). Nothing was tapped: …
```

WDA tree (unfiltered, pre-order, abridged):

```
16:          text 'SWIFT PAYMENT' swift_payment.form.title 135 73 131 22
17:       container None None None 0 0 402 874
 …
22:           scrollable None None None 0 0 402 512          ← after the title; its frame runs under the top bar
 …
138:       toolbar 'Toolbar' Toolbar None 0 0 402 874         ← now excused as a screen-sized host
155:   keyboard None None None 0 572 402 302
```

The form's scroll view (`0 0 402 512`, 58 % of the screen, so not a `SCREEN_SIZED_FRACTION` host) extends behind the
translucent top bar; nothing of its CONTENT is at (201,84) (its first row, `debit_select`, starts at y 150). `shadowing`
(`src/ui-tree/geometry.ts:608–618`) counts the scrollable's own rect as cover. The same scrollable was in the original
tree above ("the form, scrollable 0 0 402 512"); it was shadowed by the later toolbar then, so the test built from the
abridged tree did not pin it.

Contrast: the flow `fill: { id: swift_payment.form.amount_input, value: "3.10", clear: true, dismissKeyboard: true }` on the
same screen hid the pad (`role:keyboard` → 0 matches after) with no ⚠ (the flow trace does not say what hid it) — so
the post-fill dismiss path apparently does not hit this refusal; only the tap guard's pick does.

Fix direction: treat a `scrollable` (and other containers with children) like a host — cover only through its content at
the point, not its own frame — at least when it is not interactive by itself; or judge cover only by leaf/content nodes.
