# BUG: on iOS, for ~1 s after `launch_app` brings a backgrounded app to the front, idb returns the PREVIOUS app's full tree — not bare, so an `absent:` assert passes and no ⚠ is printed

**Measured 2026-10-09 05:26–05:45 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`), averi =
mobile-verify `fix/keyboard-aware-scroll` @ `610660f` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default
`treeSource: idb`. Apps: mp-native's bank app (`com.finshape.dbosbanking`, running, display name "Skeleton Internal") and the
stock Contacts app (`com.apple.MobileAddressBook`, running, "New Contact" sheet open). Neither was terminated: each
`launch_app` foregrounds a running app.

## Observed (measured)

`launch_app` returns `Launched <bundle> on ios` in 0.8 s. The idb reads right after it, one line per read (the Application node):

```
launch_app com.apple.MobileAddressBook                (from the bank app)
05:44:02  other 'Skeleton Internal' 0 0 402 874        ← the bank app's tree, complete (tab bar, search field, error text …)
05:44:02  other 'Skeleton Internal' 0 0 402 874
05:44:03  other 'Contacts'          0 0 402 874        ← Contacts from the 3rd read
launch_app com.apple.MobileAddressBook                (again, 05:44:07)
05:44:07  'Skeleton Internal', 'Skeleton Internal', then 'Contacts'
launch_app com.finshape.dbosbanking                   (from Contacts) — 'Skeleton Internal' from the first read, both times
```

At 05:26 the first `ui_snapshot` 2 s after `launch_app` Contacts (no other call between) still returned the bank app's 13-node
tree; Contacts' showed 2 s later. None of these reads carried a ⚠ — the tree is a real, rendered app's tree, so the P0 bare
rules (status bar + launch icon) do not apply.

An assert in that window judges the wrong app (scratch config naming Contacts, `treeSource: idb`), 3 of 3:

```
05:44:44 launch_app com.apple.MobileAddressBook  →  assert [{ element: { id: "New Contact" }, absent: true, timeout: 500 }]
→ All 1 asserts passed / PASS  element id:"New Contact" is absent / appAlive: true                           (0.6–0.8 s)
ui_snapshot { filter: 'id:"New Contact"' } a second later → other id "New Contact" 0 78 402 54
```

(and `assert [{ element: { id: "accounts.detail.search_field" } }]` — the bank app's field — PASSED right after `launch_app`
Contacts, 2 of 2.)

## Why it matters

The P0 fix taught averi to distrust SpringBoard's launch tree; this is the other half of the same window: after an app
switch, the previous app's tree is fully rendered and labelled, so nothing in it looks wrong. An `absent:` assert passes, an
`ensure_state` detect probe can call the target state active or not from another app's screen, and a flow `launch:` + `wait:`
can match an element of the app that was just left. It bites whenever a run switches apps — a deep link opened from another
app, a share sheet, the agent checking something in Settings, or Maestro leaving another app in front.

## Possible fix directions (owner's choice)

- After `launch_app` (and a flow `launch:`) on iOS, wait until the tree's `Application` node is the launched app — its label
  equals the bundle's display name (`CFBundleDisplayName`/`CFBundleName`, readable with `simctl appinfo`/`listapps`), or idb's
  frontmost app — before returning; bounded, with a ⚠ naming the app actually read when it never switches.
- Or mark a read whose Application label is not the configured app's as `unknown` for detect/absent verdicts (the bare-tree
  machinery's path), at least for the first read after a launch.
- The P0 note's follow-up idea ("tell SpringBoard's Application from the app's") covers both cases with one check.

## Repro

1. Two apps running on an iOS simulator, B in front (e.g. Contacts with a sheet open, then the app under test A).
2. `launch_app { appId: B }` then immediately `assert [{ element: { <an element only B shows> }, absent: true, timeout: 500 }]`
   → PASS; `ui_snapshot` a second later shows the element.
