# BUG: on iOS `scroll_until` never sees the end of a list that bounces — every stroke into the end changes the tree, so "content exhausted" (and round 8's `if it lies above, try direction: "up"`) never fires and every stroke of the budget is spent

**Measured 2026-10-12 10:12–10:17 UTC**, iPhone 17 simulator iOS 27.0 (`37956039-94EA-4F51-93E5-94F7723A4578`, 402×874 pt), averi =
mobile-verify `fix/round-8` @ `0ff6df3` (idb, port 47873). Settings › General (a UIKit list one screen and a half long). Found by the
round-8 device check (R-6.6, the B1 wording on iOS).

## Observed (measured)

1. Settings › General, already scrolled to its end (`About` at y 247, `Language & Region` at 629). `scroll_until { selector:
   'text:"No Such Row"' }` →
   ```
   scroll_until text:"No Such Row" failed after 6 swipes (maxSwipes) — element never appeared in the tree
   ```
   Six identical strokes (`idb ui swipe 201 699 201 175 --duration 0.3`, 10:13:37–10:13:43). With `maxSwipes: 15, timeoutMs: 60000` →
   15 strokes in 18.9 s, `failed after 15 swipes (maxSwipes)`. The list never moved past its end.
2. The same list read by hand around one stroke (`idb ui describe-all` every 0.25 s): before `About` y 247; 0.25 s after the stroke 74,
   0.5 s 235, from 0.75 s on 247 again. Each stroke into the end drags the content and rubber-bands it back over ~0.75 s.
3. Contrast, mp-native Account Detail (a SwiftUI list that does not move at all): `failed after 2 swipes (the last 2, swiping down, did
   not change the screen: content exhausted, still loading, or the swipes were not taken)` — the exhaustion rule fires when nothing moves.

## Why (read from the source)

`observe` (`src/interact/scroll-rounds.ts:1286–1303`) counts a stroke as unmoved only when the whole tree's `treeFingerprint`
(`src/ui-tree/read-tree.ts:303`, every node's rect included) equals the previous read's; `UNMOVED_STROKES_EXHAUST = 2` (l. 555) such
strokes end the scroll as `exhausted`. On iOS the read after a stroke into the end lands inside the bounce, at a different offset each
time, so two equal fingerprints never come and the scroll runs to `maxSwipes` or the deadline. Round 8's `unsearched` hint
(`shortfall`, l. 1862) needs `by.of === 'exhausted'`, so on iOS it is never given.

## Why it matters

- A target that is not there (or lies the other way) costs the whole budget on iOS — 6 strokes by default, every stroke of a raised
  `maxSwipes` — where Android fails after 2 with "content exhausted".
- B1's "if it lies above, try direction: "up"" and the "content exhausted" wording are Android-only in practice; on iOS the reply is a
  bare `maxSwipes`, which reads as "the budget was too small".

## Suggested fix (owner's choice)

Compare the read after a stroke with the one before the stroke only once the content has settled (a second read while the tree still
changes, as the stop path already confirms), or call a stroke unmoved when every node's rect is back where it was before it (the bounce
returns to the same offset).

## Repro

Settings › General, scroll to its end; `scroll_until text:"No Such Row"` (optionally `maxSwipes: 15`): every stroke is spent. Any short
iOS list that bounces (Contacts' list, a sheet) is the same shape.
