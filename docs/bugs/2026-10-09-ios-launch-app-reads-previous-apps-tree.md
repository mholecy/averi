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

## Device check (2026-10-09 iOS, re-run at 347e70d)

Measured 11:25–11:42 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `347e70d` (`dist/` built 11:21 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default `treeSource: idb`;
scratch configs naming Contacts / the bank app (`launch_contacts`: `- launch: {}` + the absent assert); an `idb` PATH shim.
Bank app logged in on Account Detail, Contacts running with "New Contact" open; neither terminated for a1–a4.
Run folder: `scratchpad/averi-repo/run5-ios` (`session.log`, `img-N-0.png`, `appinfo-*.txt`).

**a1 appinfo format — Holds.** Old-style plist `{ … }`, both keys top-level, bank display name quoted, the rest bare; nested
dictionaries (`GroupContainers`) and arrays (`SBAppTags`) present but below the top level. Raw output (11:25:14):

```
$ xcrun simctl appinfo 37956039-94EA-4F51-93E5-94F7723A4578 com.finshape.dbosbanking
{
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
    GroupContainers =     {
    };
    IsAppClip = 0;
    IsDeveloperApp = 1;
    IsFirstParty = 0;
    IsHidden = 0;
    IsRemovable = 1;
    Path = "/Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Bundle/Application/95E78B94-6D6B-4B15-8D47-45D88DDC2ABD/Internal.app";
    SBAppTags =     (
    );
}

$ xcrun simctl appinfo 37956039-94EA-4F51-93E5-94F7723A4578 com.apple.MobileAddressBook
{
    ApplicationType = System;
    Bundle = "file:///Library/Developer/CoreSimulator/Volumes/iOS_24A434/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS%2027.0.simruntime/Contents/Resources/RuntimeRoot/Applications/Contacts.app/";
    CFBundleDisplayName = Contacts;
    CFBundleExecutable = Contacts;
    CFBundleIdentifier = "com.apple.MobileAddressBook";
    CFBundleName = Contacts;
    CFBundleShortVersionString = "1.0";
    CFBundleVersion = "1.0";
    DataContainer = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Data/Application/158305D4-0D94-4528-9D76-ACD4A3B5BD42/";
    GroupContainers =     {
        "group.com.apple.SuggestedImage.SharedSecureContainer" = "file:///Users/mholecy/Library/Developer/CoreSimulator/Devices/37956039-94EA-4F51-93E5-94F7723A4578/data/Containers/Shared/AppGroup/7EE9DD9D-5589-417F-986C-EA748111CBCE/";
    };
    IsAppClip = 0;
    IsDeveloperApp = 0;
    IsFirstParty = 1;
    IsHidden = 0;
    IsRemovable = 0;
    Path = "/Library/Developer/CoreSimulator/Volumes/iOS_24A434/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/Applications/Contacts.app";
    SBAppTags =     (
        "stand-alone-contacts"
    );
}
```

The parser's names: bank `"Skeleton Internal" or "Internal"`, Contacts `"Contacts"` (the a4 replies below quote exactly
`("Contacts")`). Under German (a5) appinfo still lists `CFBundleDisplayName = Contacts; CFBundleName = Contacts;` — it reads
Info.plist, not the localized InfoPlist.strings.

**a2 label = display name — Holds.** `idb ui describe-all` first element: `Application 'Skeleton Internal' 0 0 402 874` (bank,
11:25:24) and `Application 'Contacts'` (11:25:45). Both equal a name appinfo lists (bank: the display name; its
`CFBundleName = Internal` is never the label).

**a3 previous app's tree never read — Holds, 3/3 + 2/2.** Each launch from the other app in front, no `⚠` line:

```
11:27:00 launch_app com.apple.MobileAddressBook  → Launched com.apple.MobileAddressBook on ios   (1.9 s)
         assert [{ element: { id: "New Contact" }, absent: true, timeout: 500 }]
         → 1/1 asserts FAILED / FAIL  element id:"New Contact" is absent — still visible after 0.5 s / appAlive: true   (1.1 s)
11:27:07 same → (1.9 s), assert FAILED the same way (1.2 s)
11:27:14 same → (1.9 s), assert FAILED the same way (1.1 s)
11:27:31 launch_app com.finshape.dbosbanking (from Contacts) → Launched com.finshape.dbosbanking on ios   (1.1 s)
         assert [{ element: { id: "accounts.detail.search_field" }, absent: true, timeout: 500 }]
         → 1/1 asserts FAILED / FAIL  element id:"accounts.detail.search_field" is absent — still visible after 0.5 s   (1.2 s)
11:27:39 same → (1.1 s), assert FAILED the same way (1.2 s)
```

Contacts launches take 1.9–2.0 s and bank launches 1.0–1.2 s (vs 0.8 s at 610660f). Three more Contacts launches at
11:26:35–11:26:48 (asserts sent with a misspelt argument, rejected by validation) were each followed by a `ui_snapshot
{ filter: 'id:"New Contact"' }` that found the node — the first read after the launch was Contacts' tree.

**a4 give-up wording — Holds (the text), reached naturally; but see the new note on its advice.** The very first switch of the
session (11:25:29, bank in front for minutes before, Contacts backgrounded) ran the whole window:

```
11:25:29 launch_app com.apple.MobileAddressBook                                                             (4.2 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal"
  — iOS can hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app
  (an absent check passes on it). Compare with screenshot. If the screenshot shows com.apple.MobileAddressBook, its on-screen
  name differs from its Info.plist name (a localized display name) and this can be ignored; otherwise read again before
  trusting what the tree says
```

A raw `idb ui describe-all` right after the reply (~11:25:34) still listed the bank app's full 39-node tree (`Application
'Skeleton Internal'`, tab bar, search field, rows); the screenshot taken then (`img-4-0.png`) shows the **Contacts list**.
Reads at 11:25:45/47/50 gave `Application 'Contacts'`. So the stale window lasted ≥ 4.5 s here, past the 3 s bound — and in
this case the note's "if the screenshot shows com.apple.MobileAddressBook … this can be ignored" is wrong advice: the screenshot
did show Contacts while the tree was still the bank's. Filed as
[2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md](2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md).
The SpringBoard, empty-tree and "could not check" endings were not reached (every cold launch matched within the window: bank
cold launch 11:36:52, 3.5 s; Contacts cold launch 11:28:50, 3.4 s; Contacts 11:29:33, 3.2 s; 11:32:28, 3.5 s — no ⚠).

**a5 localized display name — Holds.** Original values recorded first (`defaults read -g`): `AppleLanguages ("en-US", "sk-US")`,
`AppleLocale en_US@rg=skzzzz`, `AppleKeyboards ("en_US@sw=QWERTY;hw=US")`; the whole global domain exported. Set
`AppleLanguages (de-DE, en-US, sk-US)`, terminated Contacts only (no reboot; the bank app kept running, logged in):

```
11:28:12 launch_app com.apple.MobileAddressBook   (from the bank app)                                       (4.1 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Kontakte" — iOS can
  hand idb the previous app's tree … If the screenshot shows com.apple.MobileAddressBook, its on-screen name differs from its
  Info.plist name (a localized display name) and this can be ignored; otherwise read again before trusting what the tree says
```

`idb` after: `Application 'Kontakte'` (18 nodes); screenshot `img-35-0.png` shows Contacts titled "Kontakte", search "Suchen".
So stock Contacts DOES show a localized label while appinfo lists "Contacts": every Contacts launch in German pays the full
3 s plus the note (as the module comment predicts). Restored `AppleLanguages (en-US, sk-US)`; the exported global domain
compared **identical** to the one before; Contacts terminated and relaunched → `Application 'Contacts'` (11:28:50, 3.4 s, no ⚠).
The bank app still showed Account Detail (logged in) afterwards.

**Flow `launch:` ⚠ trace (handoff j) — Holds.** Language still German, bank app in front:

```
11:28:37 run_flow { flow: launch_contacts, configPath: <scratch naming Contacts> }                          (4.3 s)
flow launch_contacts: start
launch: com.apple.MobileAddressBook
⚠ launch: 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Kontakte" — …
assert PASS: element id:"New Contact" is absent
flow launch_contacts: done
appAlive: true
```

(The PASS is right here: the terminate had closed the "New Contact" sheet; Contacts showed its list.)
