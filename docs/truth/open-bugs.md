# Open bugs: the backlog, and how to fix and verify one

This is the one place an agent or a person starts from to fix an averi bug the truth lab has found. It lists what is still open and in what order to take it. It also says how a fix is made and proven.

The bugs are already written down. You do not have to rediscover them by testing. The harness shows that a bug exists, and then that it is fixed.

Snapshot: `fix/round-9` at 570d0de9 (2026-10-20, round 9: L4's W half and B4-L1 fixed, VA1 attempted and left open):
- golden: 1410 checks, 213 mismatches (all known), 0 broken, 92 skipped (no OCR in the sandbox; 239 with OCR);
- calibrate: exit 0.

When a bug is fixed, update its row here: strike it or remove it, and give the commit.

## Where the bugs are recorded

Each bug is recorded in four places, and they point at each other:

1. **`docs/bugs/<date>-<slug>.md`, the bug note.**
   - It holds the screen, the truth (the lab app's own model), the reply averi gives, the measurements, and a `Status` line.
   - A note is never deleted. A fix updates its Status: "fixed at <commit>, how measured".
2. **`tests/differential/golden/*.known.ts`, the static KNOWN list.**
   - It holds every golden row that is red at HEAD, with the note or ADR residual that explains it, its verdict class and its reply kind.
   - The rule is a ratchet. A known row that turns green must be struck off: `tests/differential/golden.test.ts` fails with "no known mismatch is fixed without being struck off KNOWN" until it is. A red row not listed is a regression.
3. **`scripts/truth/live-known.ts`, the live KNOWN list.**
   - It is the same idea for live cases on the lab devices, keyed `<platform> <source> <case id>`.
   - `intermittent` entries may come out ok; the others must be struck once they are ok.
4. **`scripts/truth/calibration.json` and `docs/truth/calibration.md`.**
   - Each lab note maps to the golden or live rows that show it. calibrate replays the commit before the fix and the fix itself, and the verdict is one of:
     - `CALIBRATED`: red before, green after;
     - `OPEN-RED`: still red;
     - `DOES-NOT-FAIL`, and similar.
   - `tests/truth/lab-notes.test.ts` ties the notes, the KNOWN lists and calibration.json together.

Decisions and accepted limits live in `docs/adr/` as numbered **residuals**, mainly:
- `docs/adr/0013-refuse-a-tap-on-a-sliver-cut-by-its-scroll-container.md`;
- `docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md`;
- `docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md`.

`docs/adr/0020-the-truth-outranks-a-hand-written-expectation.md` is the contract of the harness itself.

## The backlog, in priority order

The order is by harm to the agent that uses averi as its eyes and hands in a banking app:
1. a false "done" that also triggers an action;
2. a false "visible" or "passes";
3. a false refusal or failure;
4. diagnostics.

### Priority 1: averi claims success that is not true, or triggers an unintended action

| # | Id | Platform | What goes wrong | Note |
|---|---|---|---|---|
| ~~1~~ | ~~L2~~ | ~~iOS idb~~ | ~~A submit pinned above the keyboard (SwiftUI safe-area inset) is not treated as a cover of the field under it. `tap` on the field says `Tapped` and **submits the form**. `scroll_until` says "fully visible after 0 swipes".~~ **Fixed** at `837ec3ef` (fix/r8-l2): the keyboard's run judged by each node's on-screen part; CALIBRATED, live k6/k7 ok. | `docs/bugs/2026-10-15-lab-ios-idb-pinned-safe-area-bar-is-no-cover-tap-submits-the-form.md` |
| ~~2~~ | ~~L4 (MENU)~~ | ~~iOS idb + WDA~~ | A SwiftUI in-screen menu row is listed in reading order. It reads as covered by the row beneath, so it is refused. ~~The row beneath reads as drawn over it, so `Tapped` **fires the menu row**.~~ **The unsafe half fixed** at `37bf5a15` + `f5a28b38` + `bea9769c` (fix/r8-l4): two controls overlapping in a reading-order listing cover each other, the order not told (ADR 0015 amended); the row beneath is refused, nothing fires, no swipe sent (CALIBRATED-ON-DEFECT, live ok at 37bf5a15 and at the final 94fc318b: C's scroll_until stops before any swipe). **The menu row's false refusal fixed** at `1ef11b9c` (fix/r9-l4w, ADR 0024): the eyes tell from one screenshot which of the two is drawn on top — W `Tapped`, its colour PASS, reached with no swipe; C refused as under W, seen so (still #31's residual); CALIBRATED (second pair), live ok under idb and WDA (ios-vis-r9-l4w-1/-2.json). | `docs/bugs/2026-10-16-lab-ios-swiftui-menu-row-listed-in-reading-order-reads-covered-by-the-row-beneath.md` |
| ~~3~~ | ~~B4-L1~~ | ~~Android~~ | ~~`fully: true` says "fully visible" for a row whose bottom third lies under a pinned button. Compose's bounds leave out what a later clickable sibling covers.~~ **Fixed** at `7755978c` + `e6ed7d43` + `151b2ca5` (fix/r9-b4l1, ADR 0013 refined 2026-10-20): for a row in no scroll view, a node flush across its top or bottom edge reaching past it at both ends is an overlay (`OverlaidEdge`) — `fully` and the colour/ocr assert name it as the cover, a role-less strip cut by it is a sliver; golden 4 rows green, CALIBRATED, live taps unchanged. | `docs/bugs/2026-10-16-lab-android-fully-calls-a-row-under-a-pinned-button-fully-visible.md` |
| ~~4~~ | ~~LE1~~ | ~~Android~~ | ~~A row whose bounds run past its scroll container's edge is judged on the screen alone. A cut row is "fully visible", and a 22-px sliver is `Tapped` where nothing of it is drawn.~~ **Fixed** at `16ff607f` (bugs/r14-le1, ADR 0010 amended 2026-10-20): the drawn frame (`Clips.drawnIn`) judges every tree that lists ancestry, a no-op where uiautomator cut; golden 7 rows green, CALIBRATED, live 6 of 6 ok (C stroked sideways inside its carousel). | `docs/bugs/2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md` |
| ~~5~~ | ~~LE2~~ | ~~iOS idb~~ | ~~The same shape under idb, which lists no scroll view. A row outside it is `Tapped` on the background, and its **colour assert passes on the background**.~~ **Partly fixed** at `11daf08` (bugs/r14-le2, ADR 0010's residual 5 refined 2026-10-20): idb's drawn frame is untold (`DrawnUntold`); a colour assert whose region reads as the screen beside it fails closed (O, C), and a `fully: true` claim sees the clip line on one screenshot (P, S); golden 4 rows green, CALIBRATED, live P.fully/S.fully no longer a stop claimed. **The rest an accepted residual** (Priority 3 below): the tap, the plain stop and the strokes. | `docs/bugs/2026-10-16-lab-ios-idb-lists-no-scroll-view-rows-past-its-clip-read-as-drawn.md` |
| ~~6~~ | ~~LE3~~ | ~~iOS~~ | ~~A SwiftUI pinned section header is not treated as a cover of the row beneath, because it is listed before the rows. The colour assert passes on a covered sample, and `fully` says "fully visible".~~ **Fixed** at `40b4856` (bugs/r14-le3, ADR 0015 amended 2026-10-20, "a heading listed before"; prep `003edf31` moved the reading-order peers into `ui-tree/reading-order.ts`): the parsers keep the Header trait (`UiNode.heading`), and a heading listed before a target it overlaps in a reading-order listing is drawn over it; golden 4 rows green, CALIBRATED, live 6 of 6 ok under idb and WDA (R's `fully` strokes out from under the header). | `docs/bugs/2026-10-16-lab-ios-pinned-section-header-is-no-cover-of-the-row-beneath.md` |
| ~~7~~ | ~~VA1~~ | ~~Android~~ | ~~A row that Compose cuts at a sticky header, with its content cut too, reads as whole. `fully` says "fully visible", and the colour assert passes on the cut rect.~~ **Fixed** (its `fully` half) at `7957a62` (bugs/r14-va1, ADR 0013 refined 2026-10-20, round 14): an edge flush under a node pinned at its scroll view's top or left inside it (`PinnedEdge`, a merged sticky header) is the flush probe's — `fully` probes toward the header; golden R fully green, CALIBRATED, live ok twice (2 swipes, list 66→0, 0→0, Tapped) and on the new at-rest cell `scroll-sticky-rest` (1 swipe, nothing moved). **The colour half an accepted residual** (ADR 0013 residual 3: the pixel assert has no probe; remedy `scroll_until … fully: true` first). | `docs/bugs/2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md` |
| 8 | ADR 0018 residual 9 (BLUR) | iOS | An in-window overlay with no node is not seen (calibration.json #31). | ADR 0018 |
| 9 | ADR 0018 residual 6 | iOS idb | A target not yet in the tree is stroked for. On sheet-background, alert-dim and dim-cover the stroke still dismisses the sheet. Since round 7 the reply is loud and honest ("the swipe CHANGED THE SCREEN"), but the side effect stays. | ADR 0018, "idb's presented layer" amendment |

### Priority 2: averi falsely fails or refuses, and the agent gets stuck

| # | Id | Platform | What goes wrong | Note |
|---|---|---|---|---|
| ~~10~~ | ~~OC1~~ | ~~iOS + Android~~ | ~~The `ocr` assert fails on correctly drawn Slovak `Ľ`, `ľ` and `ĺ`: the recognizer reads `L'` and `í`, and the OCR fold does not forgive them.~~ **Fixed** at `9837ef6` (bugs/r14-oc, prep `3d668f1`, new ADR 0025): what the recognizer may read the app's copy as (`ocr-fold.ts#readingDifference`) — beside the symmetric fold, one way, a letter's measured misreading (`Ľ ľ ď ť` with an apostrophe, `Ĺ ĺ` as `Í í`); golden 6 rows green, CALIBRATED. Residuals: `match` patterns and the parity table's UNREAD guard (ADR 0025 R1, R2). | `docs/bugs/2026-10-16-lab-ocr-assert-fails-on-slovak-l-caron-and-l-acute-the-recognizer-reads-as-other-letters.md` |
| ~~11~~ | ~~OC2~~ | ~~iOS~~ | ~~The `ocr` assert fails on an amount with an NBSP or narrow-NBSP thousands separator (`1 234,56 €` is read as `1234,56 €`). These amounts are on every banking screen.~~ **Fixed** at `cb0b7ac` (bugs/r14-oc, ADR 0025): one way, a space between the groups of a grouped number (`\d{1,3}( \d{3})+`, wholly) may be read as nothing, named as the number (`12 345 vs 12345`); `12 34`, an IBAN's groups and words stay strict; golden 4 rows green, CALIBRATED. | `docs/bugs/2026-10-16-lab-ios-ocr-assert-fails-on-an-amount-whose-nbsp-thousands-separator-the-recognizer-reads-as-nothing.md` |
| ~~12~~ | ~~LV1~~ | ~~Android~~ | ~~`scroll_until` reads a list that is moving through blank content as exhausted, so the target is never reached.~~ **Fixed** at `00ed9ec8` (bugs/r14-lv1, prep `04bc882a`, ADR 0021 refined 2026-10-21): a read that lists none of the stroked scroll view's content where its motion would show (`Clips.contentToward`'s `blank`) is no evidence the stroke moved nothing — the streak starts again, and a bound so reached says the last swipes went over blank content (raise maxSwipes or timeoutMs); golden 0 changed, live only (still `excluded`), live ok three times: tabbar-floating F visible after 5 swipes and Tapped (also at timeoutMs 30000), scroll-bounded O/F an honest LOUD with the clause (android-vis-r14-lv1*.json). | `docs/bugs/2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md` |
| ~~13~~ | ~~LV3~~ | ~~iOS~~ | ~~The turn-back stroke of `scroll_until` touches down above the list and moves nothing.~~ **Fixed** under idb at `02aabfa6` (bugs/r14-lv3, prep `807cb30c`, lab cell `d805c5e4`, ADR 0010 residual 6 refined 2026-10-21): a stroke carrying content back goes over the region the rows carried with the target showed (`motion-shown.ts#MotionShown`, `goesOver`), and a stop short of the line such a stroke touches down on, on the side the content was first seen moving toward and the side the last stroke pushed it, or past the region toward a still node facing the rows, is held (`carriedUnder`); no new state, no read added. Per call against `e267ebfc` on a 46 660-call physics replay (41 grids): 1 new false stop (a 500-pt app scroll coinciding with the first stroke, a residual), 7 ok → fail (honest LOUDs), +1 stroke on ~1 % of calls; on the review's 102 372 calls more (a fling, short lists, deeper drifts) 5 (residuals (a) and (f)) and 85 ok → fail, all honest LOUDs; under a caught fling (51 860 calls) 6 (one residual (a) at a 300-pt app scroll, five a replay start past the list's end) and 51 ok → fail. Live cost: an `up` call to the page's top alternates its strokes until the target is past the band's line (`scroll-top-edge` T 1 → 4–6 swipes, carousel-in-list B 2 → 4 against round 7; all Tapped). Live (idb, at `02aabfa6`): tabbar-dense R 5/5 ((201,699), (201,239) ×2, Tapped; once a 4th stroke), L 3/3, tabbar-floating R 3/3, the idb group with nothing not known; golden 0 changed; still `excluded` (live only), its live KNOWN struck. Motion-proof vouching (`2c9956f9`) rejected. | `docs/bugs/2026-10-16-lab-ios-scroll-until-turn-back-stroke-touches-down-above-the-list-and-moves-nothing.md` |
| 14 | NI1 | iOS idb | idb lists a UIKit table row's label without its accessibility identifier. `tap` and `scroll_until` by that id time out, and the reply never says why. | `docs/bugs/2026-10-16-lab-ios-idb-lists-uikit-table-rows-without-their-identifier.md` |
| 15 | FU1 | Android | `scroll_until` refuses a pinned submit that lies between a floating Gboard panel and its strip, although it is drawn and tappable. It is a residual of the floating-keyboard fix (`docs/bugs/2026-10-05-android-floating-gboard-keyboard.md`). Floating keyboards are a rare configuration. | `docs/bugs/2026-10-16-lab-android-scroll-until-refuses-the-submit-between-a-floating-keyboard-and-its-strip.md` |
| 16 | (phone after back) | Android | `scroll_until fully: true` on the phone field after `back` fails, because its 132-px touch target overlaps the next field's title. | `docs/bugs/2026-10-19-lab-android-fully-true-on-phone-after-back-refused-under-the-next-fields-title-its-touch-target-overlaps.md` |
| 17 | ADR 0018 residual 19 (UNMARKED_WINDOW) | Android | The full-screen dialog's presented window is not marked; its shapes were measured on one AVD with Material 3 only. Every reply carries the active-window hint. | ADR 0018 |
| 18 | LV2 (intermittent) | Android | The `fully` flush probe moves a deeply cut row a fraction of its cut and stops. It happens in most runs, not all. | `docs/bugs/2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md` |

### Priority 3: accepted limits (fix only with a reason)

- ADR 0013, the eyes residuals:
  - one unsettled screenshot;
  - a target as wide as the screen is always `unjudged`;
  - a screen-spanning neighbour is not asked.
- ADR 0021, residual 1: the carry margin on a long WDA list. It was re-measured in round 7 and is green 4 of 4.
- The live forms cases b1d and b7 stay LOUD, because neither `adb input text` nor idb can type `Š` or `’`. p5 stays LOUD as well.
- The FAB host layer is a cover (accepted in round 13).
- ADR 0010, residual 5 (LE2's rest, accepted in round 14): under idb, which lists no scroll view, the tap, the plain stop and the strokes judge a row past its scroll view's clip on the screen alone — `scroll-bounded`'s S and O `Tapped` on the background and reached with no swipe, F's and `carousel-in-list`'s C's strokes over the screen's middle. Why: nothing in idb's tree tells the clip, and a screenshot per tap or plain stop would double the cost of the commonest verbs under the default tree source; the colour assert and `fully: true` already look (LE2's fix). Remedy: `treeSource: wda`.
- ADR 0013, residual 3 (VA1's colour half, accepted in round 14): the colour assert on a row Compose cut at a merged sticky header pinned in its list samples what the tree lists of it and passes, whatever lies under the opaque header (`scroll-sticky-cut.xml R colour`). Why: the pixel assert has no motion to tell it from a first row at rest whole under the header (the same tree), and failing closed would fail every such first row for good. Remedy: `scroll_until … fully: true` first.

### Suggested rounds (bugs that share a cause)

1. **Covers the tree does not show:** ~~L2~~ (fixed), ~~B4-L1~~ (fixed, round 9), ~~LE3~~ (fixed, round 14), ~~VA1~~ (`fully` fixed, round 14; the colour half ADR 0013's residual 3), BLUR. These are pinned bars, sticky headers, and nodes the source cuts. They have the highest impact.
2. **Clipped by the scroll container:** ~~LE1~~ (fixed, round 14), ~~LE2~~ (partly fixed, round 14; the rest ADR 0010's residual 5). The element is judged by the screen, not by its scroll view.
3. **Quick win:** ~~OC1, OC2~~ (both fixed, round 14: ADR 0025, what the recognizer may read the app's copy as).
4. **SwiftUI reading order:** ~~L4~~ (both halves fixed: the unsafe one in round 8, the menu row's false refusal in round 9 by the eyes, ADR 0024).
5. **Scrolling and diagnostics:** ~~LV1~~ (fixed, round 14), ~~LV3~~ (fixed, round 14), LV2, NI1.
6. **The rest:** FU1, residuals 6 and 19, the phone-after-back case.

## How to fix one bug

These steps follow the implementation round the truth lab has used since round 1: one agent per bug or group, its own branch and worktree, a review loop, then a merge.

1. **Read first.**
   - The bug note: its measurements are the spec.
   - The ADR it cites, and `ARCHITECTURE.md` (layering rules; "the one owner of X" statements).
   - The module docs of the code you touch.
2. **Reproduce it red.**
   - Find the note's rows: `git grep <note-file-name> -- tests/differential/golden scripts/truth`.
   - Run golden. The row must be a known MISMATCH, with the reply the note quotes.
   - Run it again with `--json` (each check's reply is in it) and keep that output outside the repo: it is the base for step 6. Replay at least what step 6 will: a capture the base did not replay is named, not compared.
3. **Test first, at the seam.** Write a vitest over the real captured tree (`tests/fixtures/truth/...` or `tests/fixtures/...`). It must fail before the fix.
4. **Fix the src.**
   - Prefer one deep module with a small interface.
   - A new concept gets a name and a type, not a flag or a positional boolean. No speculative generality.
   - Module docs say what the module decides and why, and cite notes by path, not task or review history.
5. **Mutation-check every new test.** Break the fix, see the test fail, then restore it.
6. **Golden again, against the base.**
   - Run golden with `--against <base.json>`. It prints every check whose verdict, reply, device calls or faults changed (of the captures both runs replayed), the KNOWN rows to strike — green now, or no longer asked — per family file, and the captures whose check count differs from COUNTS.
   - The note's rows must turn green, and there must be no new mismatch.
   - Every changed reply must be explained.
   - Strike the listed rows from `tests/differential/golden/*.known.ts` by hand, and write the listed COUNTS. The rows are built with `keys(...)` over tag lists, so the report does not rewrite the files.
7. **Live, if the bug is from a device.**
   - Run the note's live cases on the lab device and commit the record under `docs/truth/live-records/`.
   - Pin it in `tests/truth/live-rejudge.test.ts`, and strike the entry from `scripts/truth/live-known.ts`.
   - Add a dated section to the platform's live summary (`docs/truth/live-<platform>-<date>-*.md`).
8. **Update the records.**
   - The note's Status: "fixed at <commit>, measured by …".
   - If the fix refines a recorded decision, update its ADR in the same change.
   - Set the note's calibration.json entry to `calibrate`, with `fix: [<commits>]` (short SHAs, the note's own fix first: its first parent is the red side; usually the oldest). Its `checks` are the note's rows among the keys step 6 listed to strike. Then run calibrate in full (not `--note`, which writes `.partial`): it must say `CALIBRATED`. Only the sides whose cache key changed run again: the fix's new sides; the table is not in the key, but a fix in the src the harness itself loads changes every side's key, so every side replays. Commit the report it writes with the table: the tests check the table's sides against it.
     - Don't write `before` or `after`. calibrate derives them: `before` is the first fix's first parent, `after` is the last fix. A further pair's `before` is its `after`'s first parent.
     - Write `after` only to judge another commit: an earlier fix, or, with `afterNotFix`, a commit that is no fix. A pair with `afterNotFix` also gives its `before`.
9. **Review.** Run a review loop with an independent, read-only reviewer, against the note as the spec. Fix what it finds and repeat until it approves. Then merge, and update this file.

### Done means

- `npm run lint` is clean.
- vitest is green. The one known failure in the sandbox is `tests/adapters/wda.test.ts`'s real-lsof test (EPERM); it passes outside the sandbox.
- `node --import tsx scripts/truth/catalog.ts --check` is clean.
- Golden is reported, with no new mismatch.
- calibrate exits 0.
- Any device used is shut down.

## Commands

Run all commands from the repo root (or a worktree) with `node --import tsx`. Inside the sandbox, `npx tsx` fails, and `npx eslint` is blocked, so use `npm run lint`.

```sh
# golden: replays the committed captures, no device (a few minutes)
node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth [--json] [--side <other checkout>] [--only <cell>]
# golden against an earlier --json run: changed checks, KNOWN rows to strike, COUNTS to write
node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth --against <base.json> [--only <cell>]
# OCR rows need the host's Vision recognizer: run outside the sandbox, or they are skipped

# unit tests and types
node --import tsx node_modules/vitest/vitest.mjs run [tests/...]
npm run lint

# the catalog of lab cells vs captures
node --import tsx scripts/truth/catalog.ts --check

# calibrate: replays each note's before/after commits (outside the sandbox; checks out temporary worktrees),
# half the cores at once; a side whose src and harness are unchanged comes from the cache (<scratch dir>/side-cache,
# or --cache <dir>; the key covers the harness, the side's src, node and the host's recognizer); --no-cache replays
# every side and refreshes the cache
node --import tsx scripts/truth/calibrate.ts --worktrees <scratch dir> --out docs/truth/calibration.md --remove [--cache <dir>] [--no-cache]

# live, iOS lab simulator (WDA on port 8120 only)
node --import tsx scripts/truth/live.ts --udid 3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348 --wda-port 8120 \
  [--sources idb,wda] --groups forms,visibility,dismissal [--cells <cell>] [--cases <id,…>] [--app react-native] --record <file>
# live, Android lab emulator
node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups forms,visibility [--cells …] [--cases …] --record <file>
# judge a committed record again, no device
node --import tsx scripts/truth/live.ts --rejudge docs/truth/live-records/<file>.json --groups <groups>
```

Lab app builds, device runs, OCR, calibrate and network installs all need the sandbox off.
- Android: in `fixtures/apps/android`, run `JAVA_HOME=~/Library/Java/JavaVirtualMachines/azul-17.0.19/Contents/Home ./gradlew assembleDebug`.
- iOS: in `fixtures/apps/ios`, run `xcodegen generate`, then `xcodebuild`.
- The React Native app (`fixtures/apps/rn`) needs a real `npm ci` in its folder. A symlinked `node_modules` breaks Metro.

## Device safety (hard rules)

- **iOS:** use ONLY the lab simulator `3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348` ("averi-lab iPhone 17").
  - Never touch any other simulator: one holds a logged-in banking app.
  - Run WDA for the lab only on port 8120.
  - For idb, start your own companion on TCP, and kill only the PID you started.
- **Android:** use ONLY the AVD `averi_lab` (`emulator-5554`), always with `adb -s emulator-5554`.
  - Never boot another AVD.
  - Run no adb server commands.
- **One lab device at a time,** and shut it down after use (`xcrun simctl shutdown …`, `adb -s emulator-5554 emu kill`). Agents working in parallel share a lock directory (`mkdir <scratch>/device.lock`) and wait for it; never busy-wait.
- **Apps and data:**
  - Never `clearState: true` on a non-lab app.
  - Never type credentials, and never commit bank data.
- **Git:**
  - Work in your own worktree on your own branch.
  - Never `git worktree prune`.
  - Push only when the owner says so.
