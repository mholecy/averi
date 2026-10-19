# BUG: when the launched app's running process has a stuck EMPTY idb tree, the launch give-up note says the tree "is still" the previous app's — no read ever will be labelled with the launched app's name, and the cure (terminate + launch) is not named

**Measured 2026-10-09 12:56:27 and 13:19:58 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt),
averi = mobile-verify `fix/round-3` @ `86eb42d` (`dist/` built 12:50 UTC, stdio, cwd `/Users/mholecy/Finshape/mp-native`), default
`treeSource: idb`, `idb` PATH shim, raw `idb ui describe-all` reads beside averi's. Found during the round-4 device check of
[2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md](2026-10-09-ios-launch-give-up-note-says-ignore-when-tree-is-stale.md)
(items 3.1 and 3.2, 86eb42d section). Run folder: `scratchpad/averi-repo/run6-ios`.

## Observed (measured)

Contacts was already RUNNING with a stuck accessibility tree: started by hand (`xcrun simctl launch`) while
`com.apple.Accessibility AutomationEnabled` was off — at 12:53:16 after the round-3 WDA sessions (natural), and at 13:19:40 after
setting both Accessibility prefs to NO by hand (forced). Bank app in front. Then:

```
12:56:27 launch_app { platform: ios, appId: com.apple.MobileAddressBook }   (fresh server; bank not launched by averi)   (3.9 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching com.apple.MobileAddressBook ("Contacts"), the UI tree was still the app labelled "Skeleton Internal" — …
  Treat the tree as the previous app's until a read is labelled "Contacts": after an app switch idb was measured serving the
  previous app's tree for 4.5 s and more. Only if a read 20 s or more after the launch is still labelled "Skeleton Internal" …

13:19:58 launch_app { platform: ios, appId: com.apple.MobileAddressBook }   (bank launched by averi in this server)       (3.7 s)
→ Launched com.apple.MobileAddressBook on ios
  ⚠ 3 s after launching … still the app labelled "Skeleton Internal" — … "Skeleton Internal" is the name of
  com.finshape.dbosbanking, which averi launched earlier, not of com.apple.MobileAddressBook: the tree is still that app's, even
  if the screenshot already shows com.apple.MobileAddressBook (it switches before idb's tree does) — read again before trusting
  what the tree says
```

Every raw read after either reply (12:56:31.7 → 12:57:17, 14 reads; 13:20:02.1/.5/.9) was the SAME shape — not the bank's tree:

```
[{"type":"Application","AXLabel":null,"pid":8998 /* 79796 */,"frame":{"x":0,"y":0,"width":0,"height":0}, …}]   (1 node)
```

The pid is Contacts'. `ui_snapshot` right after → `[isError] idb returned an empty accessibility tree (only a 0×0 Application)`
with the right cure (terminate_app, then launch_app). Screenshots (`run6-ios/img-2-0.png`, `img-91-0.png`): the Contacts list,
rendered. `terminate_app` + `launch_app` cured it both times (`Application 'Contacts'`, 18 nodes). In 6 natural switches between a
healthy Contacts process and the bank app (3–4 min stays) the note never fired.

## Why (read from the source at 86eb42d)

`src/adapters/ios-foreground.ts#awaitForeground`: a labelled read that does not match sets `stale = read.label` (l. 222); a later
read that throws `IdbEmptyTreeError` is swallowed as "the launch's own transient" (l. 196) and leaves `stale` as it was. At the
deadline "the most telling thing read wins: a real label, then an unlabelled tree, then nothing at all" (l. 227–228), so ONE early
read of the previous app's tree outranks every later empty read of the launched process, and the note is `notInFront` — the
owner branch or the "treat the tree as the previous app's until a read is labelled …" branch. `emptyThroughout` (l. 275) is chosen
only when no labelled read came at all. Which reads within the 3 s gave which label is not logged; the raw reads 0.4–1 s after the
reply were already the empty tree.

## Why it matters

- Both branches tell the reader the tree is (or may be) the previous app's and to read again. For a stuck process that never
  resolves: no read will be labelled "Contacts" until the app is terminated and relaunched, and a `launch_app` on the running app
  keeps the stuck process (the empty-tree error says so; this note does not).
- The harm is bounded: the next tree read raises the empty-tree error with the cure, and nothing passes silently (an empty tree
  is an error, not an empty screen). The cost is a misattributed warning and a wasted re-read cycle.
- It also shadows the evidence for the stale-tree measurement itself: 3.1's note looked like the round-3 stale window, but the
  window here was a stuck process, not idb serving the bank's tree.

## Possible fix directions (owner's choice)

- Let a LATER empty-tree read outrank an earlier stale label: remember the order, and when the last reads were empty, end with an
  empty-tree note (or `emptyThroughout`) that names the terminate + launch cure.
- Or, at the deadline with `stale` set, read once more: if that read is the empty tree, say so instead of `notInFront`.
- At minimum add to `notInFront`: "if the following reads are an empty tree, the launched app's process is stuck — terminate_app,
  then launch_app".

## Repro

1. iOS 27 simulator, bank app in front (any app), Contacts NOT running.
2. `xcrun simctl spawn <udid> defaults write com.apple.Accessibility AutomationEnabled -bool NO` (and
   `ApplicationAccessibilityEnabled`), then `xcrun simctl launch <udid> com.apple.MobileAddressBook` → raw `idb ui describe-all` is a
   lone 0×0 `Application` with Contacts' pid. (Naturally: any app process started after a WDA session and before averi's next launch.)
3. Bring the bank app to front (through averi for the owner branch), then `launch_app { appId: com.apple.MobileAddressBook }` →
   the `still the app labelled "Skeleton Internal"` note; the following reads are the empty tree, never "Contacts".

## Device check (2026-10-09 iOS, re-run at dd50327)

Measured 2026-10-09 15:35–16:02 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `arch/round-5` @ `dd50327` (`dist/`, stdio via the HTTP daemon on port 47833, cwd mp-native, server restarted 15:52:36
for the launch-note items), mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim.

**Did not recur** (not fixed in round 5; recorded per R-1). Every `launch_app`/flow `launch:` of this run (Contacts: 11 `launch_app` +
2 flow `launch:`; the bank: 11 + 1; Settings: 1) read a populated tree of the launched app; no empty `Application` read, no empty-tree error. The only
`⚠` notes fired were the German "Kontakte" ones (the third branch, correctly).

## Device check (2026-10-09 iOS, re-run at 2f98900)

Measured 2026-10-09 18:09–18:45 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6` @ `2f98900` (`dist/`, stdio via the HTTP daemon on port 47843, cwd mp-native), mp-native's `averi.yaml`
untouched (default `treeSource: idb`), scratch configs only, `idb` PATH shim. Comparisons with `dd50327` ran on a scratch worktree
build of that hash on the same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags.

**Did not recur.** Every `launch_app` / flow `launch:` of this run (Contacts ×11, the bank ×9, Settings ×1) read a populated tree; no empty
`Application` read. The `⚠` notes that fired were the 3.2 branch (twice, after a `terminate_app`) and the German "Kontakte" (twice).

## Device check (2026-10-09 iOS, re-run at 5e5a3d1)

Measured 2026-10-09 20:42–21:15 UTC, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-6b` @ `5e5a3d1` (`dist/` built 22:41 local, stdio via the HTTP daemon on port 47853, cwd mp-native),
mp-native's `averi.yaml` untouched (default `treeSource: idb`), scratch configs only (`cfg-swift-wda`, `cfg-swift-idb`, `cfg-c-wda`,
`cfg-contacts-idb`, `cfg-bank-idb`, `cfg-set-wda`, `cfg-optfill-ios`, `cfg-optfill-bank`), `idb` PATH shim logging every
`idb ui tap|swipe|text`. Comparisons with `2f98900` ran on a scratch worktree build of that hash (port 47855, removed afterwards) on the
same device and screen. Positions set by hand with slow `idb ui swipe … --duration 2.5` drags (`run9-ios/manual.log`). Run folder:
`scratchpad/averi-repo/run9-ios`.

**Holds.** See the 5e5a3d1 section of `2026-10-09-ios-launch-app-reads-previous-apps-tree.md`: every launch (bank ×9, Contacts ×6,
Settings ×1) returned one line and a populated tree; no `⚠`, no empty `Application`. No launch code changed between `2f98900` and `5e5a3d1`.
