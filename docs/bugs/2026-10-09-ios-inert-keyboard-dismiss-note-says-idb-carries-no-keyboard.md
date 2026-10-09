# BUG (diagnostics): the load-time note says "the idb tree carries no keyboard" — on iOS 27 the idb tree lists the keys and the keyboard band

**Measured 2026-10-08 (iOS re-run at `e9e6509`) and 2026-10-09 05:26–05:40 UTC**, iPhone 17 simulator iOS 27.0
(`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify `fix/keyboard-aware-scroll` @ `610660f`
(`dist/`, stdio), a scratch config with `app.ios.keyboardDismiss` set and the default `treeSource: idb`. Noted earlier inside
the device-check sections of [2026-10-08-scroll-until-ignores-android-soft-keyboard.md](2026-10-08-scroll-until-ignores-android-soft-keyboard.md);
filed on its own here.

## Observed (measured)

The server prints, once per config (05:28 and 05:35 UTC):

```
app.ios.keyboardDismiss is set but app.ios.treeSource is idb: the idb tree carries no keyboard, so no tap is ever refused or
hidden and the list is inert — set treeSource: wda for it to apply
```

The same idb tree, with the software keyboard up, lists the keys and the keyboard's band:

```
button 'Q' 5 597 39 54 … button 'return' …          (Contacts "New Contact", 05:26 UTC)
other 0 590 402 284                                 (the band; the bank app's keys likewise at 05:40 UTC)
```

At `e9e6509` on the SWIFT form: idb listed the keys and the band `other 0 589 402 285` with the decimal pad up.

The conclusion of the sentence is still right (under idb nothing is refused or hidden, and `keyboardDismiss` is inert); the
reason it gives is not.

## Why (read from the source)

`src/flow/config.ts#inertKeyboardDismissNote` (l. 56–72) composes the sentence from a fixed premise, `the ${kind} tree
carries no keyboard`. The same premise is repeated in `src/adapters/ios.ts:313` (comment) and in the `tap` tool description,
`src/mcp/tools.ts:361` ("With treeSource: idb the tree carries no keyboard and the tap is sent as before"). The premise held
for the idb/iOS versions the guard was written against; on iOS 27 idb exposes the keyboard's keys as `button`s and the band
as an untyped `other`, which averi does not classify as `role:keyboard`.

## Why it matters

- A reader who checks `ui_snapshot` sees the keys and concludes the note (and averi's keyboard handling) is wrong or stale,
  and may stop trusting the rest of the keyboard diagnostics.
- Under idb on iOS 27, a `tap` can be sent into the keys while the tree visibly holds them, and the tool description says
  nothing could have been known. That is the case the WDA keyboard guard exists for.
- The information is there to do better: the band and keys could mark the keyboard under idb too (the Status of the
  scroll/keyboard note already lists "marking the keyboard idb carries on iOS 27" as a separate step).

## Possible fix directions (owner's choice)

- Reword now: "idb does not mark the keyboard (on iOS 27 its keys appear as plain buttons), so averi cannot tell it apart and
  no tap is refused or hidden …", in the note, the comment and the `tap` description.
- Later: recognise the iOS 27 idb keyboard (a full-width `other` band at the bottom whose children are single-letter /
  `return` / `space` buttons) and let the guard and `keyboardDismiss` act under idb.

## Repro

1. iOS 27 simulator, a config with `app.ios.keyboardDismiss: [tap: { … }]` and no `treeSource` (idb).
2. Start the server: the note above is printed.
3. Focus any text field with the software keyboard up; `ui_snapshot` lists `button 'Q' …` and the band `other 0 ~590 402 ~285`.
