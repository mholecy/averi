# 41. An Android link names the chooser in front, from one focus read after the start

Status: accepted 2026-11-03 (performance backlog row D55, docs/plans/2026-10-30-performance-backlog.md). One reply
changes on purpose: `open_deep_link` on Android, when the platform's chooser is in front after the start. Every other
reply is byte-identical, D54's iOS alert text included. The `DeviceAdapter` contract gains one optional field,
`DeepLinkOutcome.chooser`.

## Context

- `AndroidAdapter.openDeepLink` sends `am start -a android.intent.action.VIEW -d <url>`: an implicit intent, with no
  package and no component. `runStart` (`adapters/android-start.ts`) reads `am start` only for a refusal, so anything
  else is `started`. That answer was right for its question: when two activities handle the url and neither is the
  preferred one, Android starts its resolver, which is an activity too. Nobody asked WHICH activity started.
- Batch-9 (2026-11-03, averi_lab emulator, API 33, main e734fedf) measured it. The lab's `averilab://shared/open` has
  two handlers, `dev.averi.lab/.MainActivity` and its alias `.Twin`. A raw `am start` and averi's `open_deep_link`
  each left the chooser in front: `mCurrentFocus=Window{56b9ca0 u0 android/com.android.internal.app.ResolverActivity}`
  and `mFocusedApp=ActivityRecord{6909a9c u0 android/com.android.internal.app.ResolverActivity} t2590}`. The dump
  showed package `android` only ("Open with", "AveriLab", "AveriLab twin", "Just once", "Always"). averi still replied
  `Opened averilab://shared/open on android` (54 ms). One BACK dismissed the chooser.
- That reply was a dishonest success. Every later selector for the app misses, and an `absent:` assert passes
  falsely, which is the same hazard as D54's iOS alert (ADR 0032's D54 amendment).
- No ADR owned Android's deep link until now. ADR 0032's amendments are iOS's: the idb helper and the D49a, D54 and
  D58 work on `simctl openurl`.

## Decision

**After a `started` outcome, `openDeepLink` reads the window manager's focus once. When the focused component is
the platform's chooser, the outcome is `{ chooser: { component } }` and the reply says the link is not opened yet.**

- The read is `CHOOSER_FOCUS_COMMAND`, `dumpsys window displays | grep -E 'mCurrentFocus=|mFocusedApp='`, with a 2 s
  bound, like the adapter's other focus reads. It is a new constant beside `FOCUSED_WINDOW_COMMAND`, whose contract
  (a window TYPE for a miss) its callers keep unchanged.
- The judgement is pure: `adapters/android-chooser.ts#chooserInFocus`. It takes the component of either line, the
  focused window's first, and names it a chooser when the package is exactly `android` or
  `com.android.intentresolver` and the class is `ResolverActivity` or `ChooserActivity`, fully named or short. No app
  can own those packages, so a match is the platform's chooser, never an app's activity of the same name. Either line
  counts because `am start` returns without waiting for the chooser's window: the focused activity may already be
  the chooser while the focused window is still the launcher or `null` (AOSP's reasoning, not measured).
- The list's provenance is in the module: `android/com.android.internal.app.ResolverActivity` was measured (batch-9,
  API 33). `ChooserActivity` and the `com.android.intentresolver` package (the IntentResolver module of later
  releases) are AOSP's, not measured.
- It fails open. A failed call (grep finds neither line, adb is gone, a timeout), an unreadable answer, or a focus
  that is not yet the chooser all give `{}`, which is today's reply byte for byte. averi never warns without a
  positive match.
- The reply (`mcp/tool-text.ts#deepLinkText`, checked before `alert`) replaces the headline, as D54's does:

  > Android has not opened <url> yet: its chooser (<component>) is in front, asking which app opens it. Take a
  > ui_snapshot, tap the app you mean, then its "Just once" button (never "Always": it changes the device's default
  > for such links); press_key back drops the link. averi taps nothing itself.

  The advice is one constant, `CHOOSER_ADVICE`, in the new module. averi taps nothing: "Always" writes a preferred
  activity, a device change every later run would inherit, and which handler is meant is the test's business. The
  reply does not say what `launch_app` does with the chooser up, because that is unmeasured.
- Not done here: no `am start -W` (it would make every happy-path reply wait for the app's first frame), no
  `cmd package resolve-activity` (it predicts the chooser and does not see it), and no tree read on the happy path (at
  least 1 s per link). No tap.

## Consequences

- Cost: the happy path goes from one adb call to two. It is estimated at about +20–26 ms (54 ms to about 80 ms), from
  the measured cost of `dumpsys window windows` (21–23 ms) and `FOCUSED_WINDOW_COMMAND` (25–26 ms; android.ts). The
  repo's perf scripts have no deep-link seam and no device was used, so the filtered command itself is not measured.
  The next batch's E1 control measures it.
- The `-p` start of `launch_app` (an intent with no activity) is unchanged and unchecked, and so is the `-n` start.
  The monkey start is unchanged too, and neither `-n` nor monkey can raise the chooser.

Residuals, stated:
- Measured on API 33 only, one emulator. The focus lines are expected in `dumpsys window displays` on API 29 and
  later. On API 28 and earlier they may not print there, and the read then fails open. The repo has no such device.
- The race: if neither focus line names the chooser yet at the one read, the reply is `Opened` as before. Batch-9's
  read found both lines naming it. The next batch's E1 runs it 20 times, with a one-handler control.
- The reply names the chooser by its component only. Its title, its apps' labels and their centres come from the ui
  tree in a later change (backlog D55c), once the next batch's E2 has captured the chooser's real tree.
- `launch_app` with `intent:` and no `activity` (`am start -p`) can raise the same chooser when the app itself
  declares two handlers, as the lab does (inference, unmeasured). It still answers `Launched` (backlog D55b).
- An OEM's own chooser component, outside the list, is not named. The reply is then `Opened`, as before.
- `adapters/android-chooser.ts` joins the mutation run (ADR 0038) with its direct tests.
