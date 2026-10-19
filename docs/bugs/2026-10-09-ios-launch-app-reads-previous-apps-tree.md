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

## Device check (2026-10-09 iOS, re-run at 86eb42d)

Measured 12:53–13:21 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi = mobile-verify
`fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, stdio, server restarted 12:53:13, cwd `/Users/mholecy/Finshape/mp-native`),
default `treeSource: idb`, scratch configs `run6-ios/cfg-contacts-idb` (`launch_contacts`: `- launch: {}` + absent `id:"New Contact"`),
`idb` PATH shim; raw `idb ui describe-all` reads beside averi's. Run folder: `scratchpad/averi-repo/run6-ios`. The give-up note's
own items (3.1, 3.2, 3.4) are in
[2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md](2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md).

**a3 previous app's tree never read — Holds, 3/3 + 2/2.** Each launch with the other app in front, no `⚠` line:

```
13:00:57 launch_app com.apple.MobileAddressBook → Launched com.apple.MobileAddressBook on ios                 (2.0 s)
         assert [{ element: { text: "John Appleseed" }, absent: true, timeout: 500 }]
         → 1/1 asserts FAILED / FAIL  element text:"John Appleseed" is absent — still visible after 0.5 s / appAlive: true (1.3 s)
13:01:04 same → (2.0 s), assert FAILED the same way (1.2 s)
13:01:12 same → (2.0 s), assert FAILED the same way (1.2 s)
13:01:22 launch_app com.finshape.dbosbanking → Launched com.finshape.dbosbanking on ios                       (1.1 s)
         assert [{ element: { id: "accounts.detail.search_field" }, absent: true, timeout: 500 }]
         → 1/1 asserts FAILED / FAIL  element id:"accounts.detail.search_field" is absent — still visible after 0.5 s   (1.3 s)
13:01:29 same → (1.1 s), assert FAILED the same way (1.2 s)
```

(Contacts showed its list, so the Contacts-side absent check used the `John Appleseed` row instead of round 3's open sheet.)
Launch times match 347e70d (Contacts 1.9–2.1 s, bank 1.0–1.2 s). Cold Contacts launches: 12:57:31 3.4 s, 13:10:27 3.4 s, 13:10:46 3.6 s,
13:20:27 3.6 s, no `⚠`.

**a5 localized display name — Holds (no failure); the third branch fires.** Originals recorded first (`run6-ios/lang-before.txt`):
`AppleLanguages ("en-US", "sk-US")`, `AppleLocale en_US@rg=skzzzz`; the global domain exported (`run6-ios/global-before.plist`).
Set `AppleLanguages (de-DE, en-US, sk-US)`, bank app brought to front through averi, Contacts terminated:

```
13:09:46 launch_app com.apple.MobileAddressBook                                                             (4.2 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Kontakte" — iOS can
  hand idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app (an absent
  check passes on it). Treat the tree as the previous app's until a read is labelled "Contacts": after an app switch idb was
  measured serving the previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is still labelled
  "Kontakte" while the screenshot shows com.apple.MobileAddressBook is that label its on-screen name (a localized display name
  its Info.plist does not carry), and this note can be ignored. The screenshot alone cannot tell them apart: it shows the
  launched app before idb's tree does
```

The "can be ignored" licence on the screenshot alone is gone; the owner branch did not fire ("Kontakte" is no name averi holds).
Raw reads: `Application 'Kontakte'` (pid 55033, 18 nodes) at 13:09:50 and again at 13:10:08 (22 s after the launch) — so the
note's own 20 s test, applied, resolves it as the localized name. Screenshot `run6-ios/img-31-0.png`: Contacts titled
"Kontakte", search "Suchen". The launch did not fail. Restored `AppleLanguages (en-US, sk-US)`; the exported global domain
compared **identical** (`cmp`) to the one before; Contacts terminate + launch (13:10:27, 3.4 s, no `⚠`) → `Application 'Contacts'` at 13:10:31. The bank app showed Account Detail, logged in (`run6-ios/img-37-0.png`).

**Flow `launch:` ⚠ trace — Holds.** Language still German, bank in front (13:10:12):

```
run_flow { flow: launch_contacts, configPath: <scratch naming Contacts> }                                    (4.3 s)
flow launch_contacts: start
launch: com.apple.MobileAddressBook
⚠ launch: 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Kontakte" — …
  Treat the tree as the previous app's until a read is labelled "Contacts": … Only if a read 20 s or more after the launch is
  still labelled "Kontakte" … this note can be ignored. The screenshot alone cannot tell them apart: it shows the launched app
  before idb's tree does
assert PASS: element id:"New Contact" is absent
flow launch_contacts: done
appAlive: true
```

The new text reaches the flow trace verbatim (the line elided above is identical to the `launch_app` reply). The PASS is right:
Contacts showed its list.

## Device check (2026-10-09 iOS, re-run at dd50327)

Measured 2026-10-09 15:35–16:02 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47833, cwd mp-native, server restarted 15:52:36
for the launch-note items), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim.

**a3 previous app's tree never read — Holds, 3/3 + 2/2.** 15:59:19–15:59:38, each launch with the other app in front, one-line
replies, no `⚠`:
- `launch_app com.apple.MobileAddressBook` (2.0 s) + `assert [{ element: { text: "John Appleseed" }, absent: true, timeout: 500 }]`
  → `1/1 asserts FAILED / FAIL  element text:"John Appleseed" is absent — still visible after 0.5 s` ×3 (1.2–1.3 s);
- `launch_app com.finshape.dbosbanking` (1.0 s) + absent `id:"accounts.detail.search_field"` → `FAIL … still visible after 0.5 s` ×2.

**Flow `launch:` (C1, one launch shared) — Holds.** English, no stale window: `run_flow launch_contacts` (`cfg-contacts-idb`,
15:59:45) → `flow launch_contacts: start / launch: com.apple.MobileAddressBook / assert PASS: element id:"New Contact" is absent /
… done`; `run_flow launch_bank` → `launch: com.finshape.dbosbanking / assert FAIL … still visible after 0.5 s` (the bank was on Account
Detail, as it must).

**a5 localized display name — Holds, identical to 86eb42d.** Originals saved (`run7-ios/lang-before.txt`: `AppleLanguages ("en-US",
"sk-US")`, `AppleLocale en_US@rg=skzzzz`; `global-before.plist`). `AppleLanguages (de-DE, en-US, sk-US)`, bank in front through
averi, Contacts terminated:

```
16:00:04 launch_app { platform: ios, appId: com.apple.MobileAddressBook }                                           (3.8 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Kontakte" — iOS can hand
  idb the previous app's tree for a second or more after an app switch, so a read now may judge the wrong app (an absent check
  passes on it). Treat the tree as the previous app's until a read is labelled "Contacts": after an app switch idb was measured
  serving the previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is still labelled "Kontakte"
  while the screenshot shows com.apple.MobileAddressBook is that label its on-screen name (a localized display name its Info.plist
  does not carry), and this note can be ignored. The screenshot alone cannot tell them apart: it shows the launched app before
  idb's tree does
```

And through a flow (bank in front, Contacts terminated, `run_flow launch_contacts`, 16:00:15, 4.1 s): `launch: com.apple.MobileAddressBook`
then `⚠ launch: 3 s after launching …` — the same text verbatim, then `assert PASS …`, `done`. So `launch_app` and the flow `launch:`
give the one note (C1). The launch did not fail. Restored `AppleLanguages (en-US, sk-US)`; the exported global domain compared
**identical** (`cmp`) to the one before; Contacts terminate + launch (16:00:26, 3.1 s, no `⚠`) → `other 'Contacts'`.

## Device check (2026-10-09 iOS, re-run at 2f98900)

Measured 2026-10-09 18:09–18:45 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native), mp-native's `averi.yaml`
untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim. Comparisons with `dd50327` ran on a scratch worktree
build of that hash on the same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags.

**a3 — Holds, 3/3 + 2/2.** 18:37:xx, each launch with the other app in front, one-line replies, no `⚠`:
`launch_app com.apple.MobileAddressBook` (1.9–2.3 s) + `assert [{ element: { text: "John Appleseed" }, absent: true, timeout: 500 }]` →
`1/1 asserts FAILED / FAIL element text:"John Appleseed" is absent — still visible after 0.5 s` ×3; `launch_app com.finshape.dbosbanking`
(1.0–1.1 s) + absent `id:"accounts.detail.search_field"` → `FAIL … still visible after 0.5 s` ×2.

**Flow `launch:` (C1) — Holds.** `run_flow launch_bank` (`cfg-bank-idb`) → `launch: com.finshape.dbosbanking / assert FAIL: element
id:"accounts.detail.search_field" is absent — still visible after 0.5 s` (the bank on Account Detail, as it must); `run_flow
launch_contacts` (`cfg-contacts-idb`) → `launch: com.apple.MobileAddressBook / assert PASS: element id:"New Contact" is absent / done`.

**a5 localized display name — Holds, identical to 86eb42d/dd50327.** Originals saved (`AppleLanguages ("en-US","sk-US")`, `AppleLocale
en_US@rg=skzzzz`, `global-before.plist`). `AppleLanguages (de-DE, en-US, sk-US)`, the bank in front through averi, Contacts terminated:
`launch_app com.apple.MobileAddressBook` (4.1 s) → `Launched …` + `⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI
tree was still the app labelled "Kontakte" — … Treat the tree as the previous app's until a read is labelled "Contacts": … Only if a read
20 s or more after the launch is still labelled "Kontakte" while the screenshot shows com.apple.MobileAddressBook is that label its
on-screen name …` (the third branch, verbatim). Through a flow (`run_flow launch_contacts`, 4.3 s): `launch: com.apple.MobileAddressBook`,
`⚠ launch: 3 s after launching …` (the same text), `assert PASS`, `done`. Restored `AppleLanguages (en-US, sk-US)`; the exported global
domain compared **identical** (`cmp`) to the one before; Contacts terminate + launch → `other 'Contacts'`.

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**a3 — Holds, 3/3 + 3/3.** Each launch with the other app in front, one-line replies: `launch_app com.finshape.dbosbanking` + absent
`id:"swift_payment.form.title"` → `FAIL … still visible after 0.5 s` ×3; `launch_app com.apple.MobileAddressBook` + absent `text:"John
Appleseed"` → `FAIL … still visible after 0.5 s` ×3. Flow `launch:` — `launch_bank` → `assert PASS: … search_field is absent` (the bank was on
the SWIFT form, correctly), `launch_contacts` → `assert PASS … "New Contact" is absent` / `done`. Every launch (bank ×9, Contacts ×6,
Settings ×1) returned one line and a populated tree; no `⚠`, no empty `Application`. 3.2 did not fire this time (cold Contacts after the
bank, 21:06:14: 3.5 s, tree already Contacts'). a5 (German display name) not re-run: no launch code changed between 2f98900 and 5e5a3d1
(`git diff --stat 2f98900 5e5a3d1 -- src`).
