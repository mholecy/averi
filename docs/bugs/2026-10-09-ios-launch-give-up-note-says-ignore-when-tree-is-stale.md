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

## Device check (2026-10-09 iOS, re-run at 86eb42d)

Measured 12:53–13:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default `treeSource: idb`,
`idb` PATH shim; raw `idb ui describe-all` reads (first element's pid / `AXLabel` / node count) beside averi's. Run folder:
`scratchpad/averi-repo/run6-ios`.

**3.1 app not launched by averi — Holds (the note fired, third branch, exact text).** Server restarted at 12:53:13 (a fresh
process; this was its first call). By hand: `xcrun simctl launch … com.apple.MobileAddressBook` (12:53:16, pid 8998),
then `xcrun simctl launch … com.finshape.dbosbanking` (12:53:21) — bank in front, Account Detail, logged in, for 3 min:

```
12:56:27 launch_app { platform: ios, appId: com.apple.MobileAddressBook }                                     (3.9 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal" —
  iOS can hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app (an
  absent check passes on it). Treat the tree as the previous app's until a read is labelled "Contacts": after an app switch idb
  was measured serving the previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is still
  labelled "Skeleton Internal" while the screenshot shows com.apple.MobileAddressBook is that label its on-screen name (a
  localized display name its Info.plist does not carry), and this note can be ignored. The screenshot alone cannot tell them
  apart: it shows the launched app before idb's tree does
```

No "this can be ignored" on the screenshot. Screenshot (`run6-ios/img-2-0.png`, 12:56:37): the Contacts list. **But the tree
after the note was not the bank's:** every raw read from 12:56:31.7 to 12:57:17 (14 reads) was a lone 0×0 `Application`, pid 8998
(Contacts), `AXLabel` null, 1 node; `ui_snapshot` at 12:56:5x → `[isError] idb returned an empty accessibility tree (only a
0×0 Application)` with the terminate+launch cure. Contacts' process had been started by hand before this server's first launch
(the one that re-enables `com.apple.Accessibility AutomationEnabled`; the round-3 WDA sessions preceded it — likely the trigger) — the stuck
empty-tree process of the known trap. `terminate_app` + `launch_app` cured it (12:57:31, 3.4 s, no `⚠`, `Application
'Contacts'` 18 nodes). So in this case the note's "Treat the tree as the previous app's until a read is labelled Contacts" never
resolves: no read would ever be labelled "Contacts". Filed as [2026-10-09-ios-launch-note-blames-previous-app-when-launched-process-tree-is-empty.md](2026-10-09-ios-launch-note-blames-previous-app-when-launched-process-tree-is-empty.md).

**3.2 app launched by averi — Not reached naturally (4 tries); the branch text Holds when forced.** Same server. Each time
`launch_app com.finshape.dbosbanking` through averi, bank in front, then `launch_app com.apple.MobileAddressBook`:

| bank launched (averi) | stay | Contacts launch | reply | first raw read after |
|---|---|---|---|---|
| 12:57:35 | 3 min 05 s | 13:00:40, 2.1 s | `Launched com.apple.MobileAddressBook on ios`, no `⚠` | 13:00:42.4 `'Contacts'` 18 |
| 13:01:35 | 4 min 03 s | 13:05:38, 2.1 s | no `⚠` | 13:05:40.8 `'Contacts'` 18 |
| 13:06:00 (Contacts hand-relaunched first, healthy tree) | 3 min 23 s | 13:09:24, 1.9 s | no `⚠` | 13:09:26.0 `'Contacts'` 18 |
| 13:15:26 | 4 min 02 s | 13:19:28, 2.1 s | no `⚠` | 13:19:30.6 `'Contacts'` 18 |

Forced (13:19:40–13:20:02), reproducing 3.1's mechanism: `terminate_app` Contacts; `defaults write com.apple.Accessibility
AutomationEnabled/ApplicationAccessibilityEnabled -bool NO`; `xcrun simctl launch` Contacts by hand (pid 79796; raw read 13:19:44:
empty, label null, 1 node); `launch_app com.finshape.dbosbanking` (13:19:5x, 1.1 s; averi set both prefs back to true; raw
`'Skeleton Internal'` 39 nodes); 5 s later:

```
13:19:58 launch_app { platform: ios, appId: com.apple.MobileAddressBook }                                     (3.7 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal" —
  iOS can hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app (an
  absent check passes on it). "Skeleton Internal" is the name of com.finshape.dbosbanking, which averi launched earlier, not of
  com.apple.MobileAddressBook: the tree is still that app's, even if the screenshot already shows com.apple.MobileAddressBook (it
  switches before idb's tree does) — read again before trusting what the tree says
```

The handoff's expected text, verbatim. Screenshot `run6-ios/img-91-0.png`: the Contacts list. As in 3.1, the raw reads after it
(13:20:02.1/.5/.9) were the empty 1-node tree of pid 79796, and `ui_snapshot` gave the empty-tree error; `terminate_app` +
`launch_app` cured it (13:20:27, 3.6 s, `'Contacts'` 18 nodes); both Accessibility prefs read 1 afterwards (as before).
The owner branch's "the tree is still that app's … read again" is wrong for this cause in the same way as 3.1 — see the new note.
The natural stale window of round 3 (a healthy Contacts process, ≥ 4.5 s of the bank's tree) did not recur in 6 natural switches
after a long stay (3.1's is explained by the stuck process, not by it).

**3.3 regression a3 — Holds**, recorded in
[2026-10-09-ios-launch-app-reads-previous-apps-tree.md](2026-10-09-ios-launch-app-reads-previous-apps-tree.md) (86eb42d section):
3/3 Contacts + 2/2 bank switches, no `⚠`, every absent assert FAILED as it must.

**3.4 `xcrun simctl listapps` — measured.** `time xcrun simctl listapps 37956039-94EA-4F51-93E5-94F7723A4578` three times
(12:53:3x, bank in front): `real 0.13 / 0.13 / 0.13` s (user 0.05–0.06, sys 0.05). Output: one old-style plist dictionary keyed by
bundle id, 909 lines, 42 apps (system apps, `com.apple.springboard`, `com.facebook.WebDriverAgentRunner.xctrunner`,
`com.finshape.dbosbanking`, `sk.finportal.myport`); every entry has `CFBundleDisplayName` and `CFBundleName` (42/42), none
empty. `plutil -convert json -o - <file>` parses it as is. The entry for the bank app, verbatim:

```
    "com.finshape.dbosbanking" =     {
        ApplicationType = User;
        Bundle = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app/";
        BundleContainer = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/";
        CFBundleDisplayName = "Skeleton Internal";
        CFBundleExecutable = Internal;
        CFBundleIdentifier = "com.finshape.dbosbanking";
        CFBundleName = Internal;
        CFBundleShortVersionString = "0.5.2";
        CFBundleVersion = 0;
        DataContainer = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Data/Application/27AF5801-71E8-4354-A3A8-7C83C4B7FD24/";
        GroupContainers =         {
        };
        IsAppClip = 0;
        IsDeveloperApp = 1;
        IsFirstParty = 0;
        IsHidden = 0;
        IsRemovable = 1;
        Path = "/Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app";
        SBAppTags =         (
        );
    };
```

Same keys and quoting as `simctl appinfo` (347e70d a1), one level deeper. Contacts' entry: `CFBundleDisplayName = Contacts;
CFBundleName = Contacts;` — it reads Info.plist like appinfo, which under German still listed "Contacts" (347e70d a5; listapps not run
under German), so a5 would presumably not be caught by it. For case 1 it would have named "Skeleton Internal" as com.finshape.dbosbanking's in one 0.13 s call. Full output
`run6-ios/listapps-1.txt`.
