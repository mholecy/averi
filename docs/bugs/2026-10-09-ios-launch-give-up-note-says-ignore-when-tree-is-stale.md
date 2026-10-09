# BUG: the iOS launch give-up note says "if the screenshot shows <bundle> … this can be ignored" — measured with the screenshot showing the launched app while idb still served the PREVIOUS app's tree

**Measured 2026-10-09 11:25:29 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-3` @ `347e70d` (`dist/`, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default `treeSource: idb`. Bank
app `com.finshape.dbosbanking` ("Skeleton Internal") in front on Account Detail for minutes; Contacts running in the background.
Found during the round-3 device check of
[2026-10-09-ios-launch-app-reads-previous-apps-tree.md](2026-10-09-ios-launch-app-reads-previous-apps-tree.md) (item a4).

## Observed (measured)

```
11:25:29 launch_app { platform: ios, appId: com.apple.MobileAddressBook }                                   (4.2 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal"
  — … Compare with screenshot. If the screenshot shows com.apple.MobileAddressBook, its on-screen name differs from its
  Info.plist name (a localized display name) and this can be ignored; otherwise read again before trusting what the tree says
~11:25:34 idb ui describe-all → Application 'Skeleton Internal', 39 nodes: nav.tab_home…, accounts.detail.search_field, rows
          screenshot (img-4-0.png) → the Contacts list
11:25:45 idb ui describe-all → Application 'Contacts', 18 nodes (also 11:25:47, 11:25:50)
```

The stale window outlasted the 3 s bound (≥ 4.5 s). A reader following the note compares with the screenshot, sees Contacts,
and is told the note "can be ignored" — while the tree every following read gets is still the bank app's for another second
or more. Ignoring it is exactly the wrong-app read the wait exists to prevent (an `absent:` check passes on it). The other four
switches of the run matched within 1–2 s; this one, the first switch after the bank app had been in front a long time, did not.

## Why (read from the source at 347e70d)

`src/adapters/ios-foreground.ts#notInFront` (l. 188–198): for any label that is not SpringBoard's `" "`, the note ends with
the localized-name escape hatch. The module comment states the ambiguity ("either the previous app … or THIS app under a name
its Info.plist does not carry … the check cannot tell which. The note says both and names the one check that can
(screenshot)"). But the screenshot cannot tell them apart either: in BOTH cases it shows the launched app (the pixels switch
before idb's tree does). The one thing that does tell them apart is the label itself: here it was `"Skeleton Internal"`, the
display name of an installed app (the one just left), not a translation of "Contacts".

## Why it matters

The note fires in exactly two situations; in one of them (a localized name) ignoring is right, in the other (a stale tree past
3 s, measured now) ignoring is the bug the wait was written for. An agent cannot use the screenshot to choose, so the advice
turns a correct warning into a licence to trust the wrong app's tree, on the switches that are slowest — likely the first
switch after a long stay in one app, as here.

## Possible fix directions (owner's choice)

- Drop the screenshot test from the escape hatch; say instead: read again — if the label is unchanged a second later and the
  screenshot shows the launched app, it is a localized display name and can be ignored.
- Tell the cases apart in code: if the stale label is another installed app's name (the previously launched bundle's appinfo
  names are already cached by IosAdapter), the note says "still <that app>'s tree", without the localized-name branch.
- Or re-read once more after the bound before writing the note, and only offer the localized reading when the label stayed
  the same across reads AND equals no known app's name.

## Repro

1. iOS 27 simulator, two apps running; keep app A (the bank app) in front for a few minutes.
2. `launch_app { appId: <B, e.g. com.apple.MobileAddressBook> }` → the 3 s note naming A's label; screenshot shows B;
   `idb ui describe-all` right after still lists A's tree. Not every switch reproduces it (the next four in the run settled in
   1–2 s).
