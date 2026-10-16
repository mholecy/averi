# BUG: on Android `scroll_until` for a row the tree does not list yet says "the last 2 swipes did not change the screen: content exhausted" while the list is still moving — through content that dumps no node

Lab note LV1. **Measured 2026-10-16** on the dedicated `averi_lab` AVD (`emulator-5554`, Android 13 / API 33,
1080x2220, gesture navigation), averi = `arch/round-20`'s `src/` (`debc9b2`), through the live golden
(`scripts/truth/live.ts --serial emulator-5554 --groups visibility`, the registry's own AndroidAdapter), the lab app's
`tabbar-floating` cell (fixtures/apps/android/…/Bars.kt). Found by phase 5's live golden; the app's own scroll offset
and stroke log (LabState.offsets, LabState.strokes — round 4) are the oracle. The summary is committed:
docs/truth/live-android-2026-10-16-visibility.md (case `scroll:tabbar-floating.F`).

## Observed (measured)

`tabbar-floating`: a `verticalScroll` list (`list`, clip 0,550 1080x1670) of 2400 dp (6600 px); T at 100 dp, R at the
floating tab bar, F at 2000 dp (content y 5500 px) — nothing else in it: the stretch between R and F is blank (no node).

```
scroll_until { selector: 'id:"lab.tabbar-floating.F"', direction: 'down' }
→ ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the
  screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it
  lies above, try direction: "up"
app: list offset 3424 (launched 0); strokes list 0→852, 852→1711, 1711→2562, 2562→3424; F 66,2626 948x143 (off-screen)
touches (540,1598) ×4 — inside the list, clear of the tab bar
```

Every one of the four strokes moved the list ~850 px — the last two included — and 1506 px of scroll were left (the list ends at offset 4930). F's
top lay 406 px below the screen's bottom: one more stroke brings it in. (Two earlier runs: the same, offsets 3393.) The reply says the last two strokes did not change
the screen, and offers the wrong remedy (`try direction: "up"`).

## Cause (src/interact/scroll-rounds.ts, the target-not-in-the-tree rule; not changed here)

For a target not in the tree, a round counts as unmoved when the WHOLE tree's fingerprint (`TreeFacts.fingerprint`,
ui-tree/read-tree.ts) is unchanged, and two such strokes in a row end the call "exhausted" (`UNMOVED_STROKES_EXHAUST`).
uiautomator dumps no scroll offset, and a stretch of content that holds no node — blank space, a decorative image with
no content description, a row the dump leaves out — dumps the same tree at every offset: two strokes through it read
as the content's end. The rule's own residual names a silent fetch; this is the same blindness without any loading.

## Why it matters

A target past a long undescribed stretch (a hero image, a chart drawn on a canvas, a spacer) is never reached; the
caller is told the content ended and to try the other way. Under a default `maxSwipes` the bound was not the limit.

## Expected

The round's to choose: a whole-tree fingerprint that includes something that moves with the content (the scroll
container's child bounds — the blank content's own container moves even when nothing is in it), or a third stroke
before calling a screen with a scrollable node unchanged, or wording that does not claim the screen did not change
when only the tree did not.

## Notes

- Live only: a replayed tree never moves, so the static golden (R-stroke, R-off on F) cannot see it. Listed in
  scripts/truth/calibration.json `excluded`, as F2A2 is.
- F is not in the capture's tree (uiautomator dumps no node off the screen: TargetTruth.listed), so the live judge does
  not hold its strokes to R-direction; the reply's claim is what is wrong, and the live case is LOUD only because
  averi failed — the app shows it was not at the content's end.
