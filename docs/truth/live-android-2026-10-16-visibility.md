<!-- The live golden on Android, phase 5 (the visibility group), as scripts/truth/live.ts printed it — judged again from the run's record (docs/truth/live-records, `--rejudge`) after review round 2 gave each rule its class — 2026-10-16
(review round 1's rerun): averi_lab AVD (emulator-5554, Android 13 / API 33, 1080x2220, gesture navigation), the
Android lab app at truth/r4-live (scroll offsets and strokes reported, round 4); src = arch/round-20's (debc9b2).
Reproduce (adb outside the sandbox):
  node --import tsx scripts/truth/live.ts --serial emulator-5554 --groups visibility [--shots <dir>] [--record <file>]
The cases come from the static truth (tests/fixtures/truth/android-averi_lab-api33, live-visibility.ts#visibilityCases);
the oracle is the app's tap log, its scroll offsets and strokes, its frames and its touch log. Every case not ok is KNOWN
(scripts/truth/live-known.ts) — the marks below. -->

# Triage of what is not ok

| cases | what the app shows | note |
|---|---|---|
| scroll-bounded P.fully, S, S.fully; tap S | the stop on a row read whole past `upper`/`lower` (P cut, S a 22-px sliver); S Tapped with nothing fired | LE1 — measured live |
| scroll-sticky-cut R.fully | "fully visible" with the merged sticky header over R | VA1 — measured live |
| scroll-bounded O, F | O and F are not in the dump; every stroke touches down at (540,788) in `upper` and scrolls it to its end, never `lower`; the reply says the last two strokes "did not change the screen" — the third moved `upper` 435 px | **LV1** — the false claim (the strokes themselves unjudged: the target is unlisted, as R-stroke exempts) |
| tabbar-floating F | four strokes move the list 0→3437 px (~860 each), F 393 px below the screen, when averi says the last two "did not change the screen" | **LV1** |
| turn F (LOUD) | strokes up at (540,424) in `upper` at its top: nothing moves, and averi says so | unlisted, honest |
| fab L, K (LOUD) | refused as under the FAB's transparent host | #24, averi's accepted reading (round 13) |

LV2 (the flush probe leaving a deep cut) does not show in this run: S.fully was revealed whole (three probes). It did in
an earlier run of the same build (appendix) and at 9c7885e (docs/truth/live-calibration-2026-10-16.md).

# Live golden: 73 cases, 62 ok, 3 loud, 8 mismatches (0 not known), 0 skipped

## uiautomator
- ok tap:open.A open: tap A (open): fires it alone — Tapped id:"lab.open.A"
- ok tap:open.B open: tap B (open): fires it alone — Tapped id:"lab.open.B"
- ok tap:open.C open: tap C (open): fires it alone — Tapped id:"lab.open.C"
- ok tap:open.D open: tap D (open): fires it alone — Tapped id:"lab.open.D"
- ok tap:sheet-medium.A sheet-medium: tap A (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.sheet-medium.A" to appear
- ok tap:sheet-medium.B sheet-medium: tap B (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.sheet-medium.B" to appear
- ok tap:sheet-medium.C sheet-medium: tap C (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.sheet-medium.C" to appear
- ok tap:sheet-medium.D sheet-medium: tap D (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.sheet-medium.D" to appear
- ok tap:sheet-medium.S sheet-medium: tap S (open): fires it alone — Tapped id:"lab.sheet-medium.S"
- ok tap:alert-dim.A alert-dim: tap A (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.alert-dim.A" to appear
- ok tap:alert-dim.B alert-dim: tap B (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.alert-dim.B" to appear
- ok tap:alert-dim.C alert-dim: tap C (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.alert-dim.C" to appear
- ok tap:alert-dim.D alert-dim: tap D (presented-over): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.alert-dim.D" to appear
- ok tap:scroll-bounded.W scroll-bounded: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded.W"
- ok tap:scroll-bounded.P scroll-bounded: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded.P"
- ok scroll:scroll-bounded.P scroll-bounded: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,886)
- MISMATCH (stop-claim) scroll:scroll-bounded.P.fully scroll-bounded: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.P" fully visible after 0 swipes — the app lays it out partly-centre-in, not fully visible [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.P" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,886)
- MISMATCH (tap-claim) tap:scroll-bounded.S scroll-bounded: tap S (sliver): refused, nothing fires — or fires it alone — averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    tap → Tapped id:"lab.scroll-bounded.S"
- MISMATCH (stop-claim) scroll:scroll-bounded.S scroll-bounded: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- MISMATCH (stop-claim) scroll:scroll-bounded.S.fully scroll-bounded: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded.S" fully visible after 0 swipes — the app lays it out sliver, not fully visible; then the tap: averi says Tapped id:"lab.scroll-bounded.S" — the app logged nothing [known: bug:2026-10-16-lab-android-uiautomator-bounds-past-the-scroll-container-read-as-drawn.md]
    scroll_until → Element id:"lab.scroll-bounded.S" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-bounded.S"
    app: S 128,1519 825x176 (sliver); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes none; fired nothing; touches (541,1563)
- ok tap:scroll-bounded.O scroll-bounded: tap O (outside-scroll-view): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.O" to appear
- MISMATCH (unchanged-claim) scroll:scroll-bounded.O scroll-bounded: scroll_until O (outside-scroll-view) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 868→1303, upper 1303→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.O" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.O" to appear
    app: O 128,1706 825x176 (outside-scroll-view); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→427, upper 427→868, upper 868→1303, upper 1303→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- ok tap:scroll-bounded.F scroll-bounded: tap F (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
- MISMATCH (unchanged-claim) scroll:scroll-bounded.F scroll-bounded: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged upper 872→1305, upper 1305→1320 in them: ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→437, upper 437→872, upper 872→1305, upper 1305→1320; fired nothing; touches (540,788) (540,788) (540,788) (540,788)
- LOUD (not-reached) turn:scroll-bounded.F scroll-bounded: the wrong direction: lower at its top, F below: a stroke up moves nothing — turn back down — under uiautomator F is not in the tree, so no turn is asked there, only an honest reply — not reached (off-screen), and averi said so (not in the tree: its strokes unjudged — 2 swipes, none of them brought it closer (0 stroke(s) logged)): ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    scroll_until → ERROR scroll_until id:"lab.scroll-bounded.F" failed after 2 swipes (the last 2, swiping up, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.scroll-bounded.F" to appear
    app: F 128,3796 825x176 (off-screen); lower clip 0,1046 1080x495 offset 0 (launched 0); strokes upper 0→0, upper 0→0; fired nothing; touches (540,424) (540,424)
- ok tap:scroll-sticky.R scroll-sticky: tap R (chrome-overlap:stickyHeader): fires it alone — Tapped id:"lab.scroll-sticky.R"
- ok scroll:scroll-sticky.R scroll-sticky: scroll_until R (chrome-overlap:stickyHeader) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky.R" visible after 0 swipes — PARTLY UNDER text "Sticky header" (400,347 281x66), drawn over it — 63% of it shows, its centre clear. A rect assert or screenshot on this element will measure what is drawn over it too; then Tapped id:"lab.scroll-sticky.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,479)
- ok scroll:scroll-sticky.R.fully scroll-sticky: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky.R" fully visible after 1 swipe; then Tapped id:"lab.scroll-sticky.R"
    app: R 128,457 825x176 (whole); list clip 0,303 1080x1238 offset 0 (launched 66); strokes list 66→0; fired tap R; touches (540,551) (541,545)
- ok tap:scroll-bounded-flush.W scroll-bounded-flush: tap W (whole): fires it alone — Tapped id:"lab.scroll-bounded-flush.W"
- ok tap:scroll-bounded-flush.P scroll-bounded-flush: tap P (partly-centre-in): fires it alone — Tapped id:"lab.scroll-bounded-flush.P"
- ok scroll:scroll-bounded-flush.P scroll-bounded-flush: scroll_until P (partly-centre-in) down: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 0 swipes; then Tapped id:"lab.scroll-bounded-flush.P"
    app: P 128,798 825x176 (partly-centre-in); upper clip 0,303 1080x605 offset 0 (launched 0); strokes none; fired tap P; touches (541,853)
- ok scroll:scroll-bounded-flush.P.fully scroll-bounded-flush: scroll_until P (partly-centre-in) down, fully: stops on it as the app lays it out, every stroke on upper bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.P" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.P" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: P 128,716 825x176 (whole); upper clip 0,303 1080x605 offset 82 (launched 0); strokes upper 0→82; fired tap P; touches (540,788) (541,804)
- ok tap:scroll-bounded-flush.S scroll-bounded-flush: tap S (sliver): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-bounded-flush.S" is cut at its scroll container's bottom edge (container 0,1046 1080x495); only a 825x22 part of it shows, 22 deep across that edge, under the 65 a tap needs — scroll_until it first (if it is whole and only its own content 
- ok scroll:scroll-bounded-flush.S scroll-bounded-flush: scroll_until S (sliver) down: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 1 swipe; then Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1150 825x176 (whole); lower clip 0,1046 1080x495 offset 369 (launched 0); strokes lower 0→369; fired tap S; touches (540,1443) (541,1238)
- ok scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — Element id:"lab.scroll-bounded-flush.S" fully visible after 3 swipes; then Tapped id:"lab.scroll-bounded-flush.S" [known, ok this run: bug:2026-10-16-lab-android-fully-flush-probe-moves-a-deeply-cut-row-a-fraction-of-its-cut-and-stops.md (intermittent)]
    app: S 128,1338 825x176 (whole); lower clip 0,1046 1080x495 offset 181 (launched 0); strokes lower 0→59, lower 59→120, lower 120→181; fired tap S; touches (540,1443) (540,1443) (540,1443) (541,1426)
- ok tap:scroll-sticky-cut.R scroll-sticky-cut: tap R (chrome-overlap:stickyHeader): fires it alone — Tapped id:"lab.scroll-sticky-cut.R"
- ok scroll:scroll-sticky-cut.R scroll-sticky-cut: scroll_until R (chrome-overlap:stickyHeader) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes; then Tapped id:"lab.scroll-sticky-cut.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,512)
- MISMATCH (stop-claim) scroll:scroll-sticky-cut.R.fully scroll-sticky-cut: scroll_until R (chrome-overlap:stickyHeader) down, fully: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes — the app lays it out chrome-overlap:stickyHeader, not fully visible [known: bug:2026-10-16-lab-android-row-cut-at-a-merged-sticky-header-reads-whole.md]
    scroll_until → Element id:"lab.scroll-sticky-cut.R" fully visible after 0 swipes
    tap → Tapped id:"lab.scroll-sticky-cut.R"
    app: R 128,391 825x176 (chrome-overlap:stickyHeader); list clip 0,303 1080x1238 offset 66 (launched 66); strokes none; fired tap R; touches (541,512)
- ok tap:scroll-top-edge.A scroll-top-edge: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge.A" to appear
- ok scroll:scroll-top-edge.A scroll-top-edge: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.A"
    app: A 128,275 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap A; touches (540,444) (541,363)
- ok tap:scroll-top-edge.T scroll-top-edge: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge.T" is under the status bar at (541,61), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 128,0 825x121) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; nothi
- ok scroll:scroll-top-edge.T scroll-top-edge: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok scroll:scroll-top-edge.T.fully scroll-top-edge: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok turn:scroll-top-edge.T scroll-top-edge: turn back: T in the status band, more content below: a stroke down carries it off the top — turn back — Element id:"lab.scroll-top-edge.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge.T"
    app: T 128,676 825x176 (whole); page clip 0,0 1080x2220 offset 369 (launched 1100); strokes page 1100→369; fired tap T; touches (540,444) (541,764)
- ok tap:scroll-top-edge-end.A scroll-top-edge-end: tap A (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.scroll-top-edge-end.A" to appear
- ok scroll:scroll-top-edge-end.A scroll-top-edge-end: scroll_until A (off-screen) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.A" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.A"
    app: A 128,275 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap A; touches (540,444) (541,363)
- ok tap:scroll-top-edge-end.T scroll-top-edge-end: tap T (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.scroll-top-edge-end.T" is under the status bar at (541,61), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 128,0 825x121) — it lies in a scroll view — scroll_until it first, to move it out from under the bar; n
- ok scroll:scroll-top-edge-end.T scroll-top-edge-end: scroll_until T (status-band) up: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok scroll:scroll-top-edge-end.T.fully scroll-top-edge-end: scroll_until T (status-band) up, fully: stops on it as the app lays it out, every stroke on page bringing it closer, then the tap fires it — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,1045 825x176 (whole); page clip 0,0 1080x2220 offset 0 (launched 1100); strokes page 1100→0; fired tap T; touches (540,444) (541,1133)
- ok turn:scroll-top-edge-end.T scroll-top-edge-end: turn back: the content at its end downward, T in the status band: the strokes down move nothing — turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,685 825x176 (whole); page clip 0,0 1080x2220 offset 360 (launched 1100); strokes page 1100→360; fired tap T; touches (540,444) (541,773)
- ok turn:scroll-top-edge-end.T.fully scroll-top-edge-end: turn back: as the plain one, fully: turn back up (#17) — Element id:"lab.scroll-top-edge-end.T" fully visible after 1 swipe; then Tapped id:"lab.scroll-top-edge-end.T"
    app: T 128,679 825x176 (whole); page clip 0,0 1080x2220 offset 366 (launched 1100); strokes page 1100→366; fired tap T; touches (540,444) (541,767)
- ok tap:bands.S bands: tap S (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands.S" is under the status bar at (540,28), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 127,0 825x55) — it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar (a layout tha
- ok tap:bands.O bands: tap O (band-overlap:status): fires it alone — Tapped id:"lab.bands.O"
- ok tap:bands.W bands: tap W (whole): fires it alone — Tapped id:"lab.bands.W"
- ok tap:bands.Q bands: tap Q (band-overlap:nav): fires it alone — Tapped id:"lab.bands.Q"
- ok tap:bands.N bands: tap N (nav-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands.N" is under the navigation bar at (540,2171), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 127,2121 825x99) — it lies in no scroll view, so no scroll moves it out: it is pinned under the
- ok tap:bands-three-button.S bands-three-button: tap S (status-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands-three-button.S" is under the status bar at (540,28), in the top 66 of the screen (tree units), where a tap goes to the status bar (rect 127,0 825x55) — it lies in no scroll view, so no scroll moves it out: it is pinned under the status bar 
- ok tap:bands-three-button.O bands-three-button: tap O (band-overlap:status): fires it alone — Tapped id:"lab.bands-three-button.O"
- ok tap:bands-three-button.W bands-three-button: tap W (whole): fires it alone — Tapped id:"lab.bands-three-button.W"
- ok tap:bands-three-button.Q bands-three-button: tap Q (band-overlap:nav): fires it alone — Tapped id:"lab.bands-three-button.Q"
- ok tap:bands-three-button.N bands-three-button: tap N (nav-band): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.bands-three-button.N" is under the navigation bar at (540,2171), from y 2154 to the bottom of the screen (tree units), where a tap goes to the navigation bar (rect 127,2121 825x99) — it lies in no scroll view, so no scroll moves it out: it is pin
- ok tap:pinned-bar.W pinned-bar: tap W (whole): fires it alone — Tapped id:"lab.pinned-bar.W"
- ok tap:pinned-bar.P pinned-bar: tap P (chrome-overlap:pinned): fires it alone — Tapped id:"lab.pinned-bar.P"
- ok tap:tabbar-floating.T tabbar-floating: tap T (whole): fires it alone — Tapped id:"lab.tabbar-floating.T"
- ok tap:tabbar-floating.R tabbar-floating: tap R (under-chrome:tabBar): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR id:"lab.tabbar-floating.R" is under container id:lab.tabbar-floating.tabBar (66,1860 948x239) at its centre (540,1871), drawn over it; only a 948x61 part of it shows, under the 65x65 a tap may be moved to — scroll_until it first; nothing was tapped
- ok scroll:tabbar-floating.R tabbar-floating: scroll_until R (under-chrome:tabBar) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — Element id:"lab.tabbar-floating.R" fully visible after 1 swipe; then Tapped id:"lab.tabbar-floating.R"
    app: R 66,947 948x143 (whole); list clip 0,550 1080x1670 offset 852 (launched 0); strokes list 0→852; fired tap R; touches (540,1598) (540,1019)
- ok tap:tabbar-floating.F tabbar-floating: tap F (off-screen): refused, nothing fires — or fires it alone — refused, nothing fired: ERROR Timed out after 5000ms waiting for element id:"lab.tabbar-floating.F" to appear
- MISMATCH (unchanged-claim) scroll:tabbar-floating.F tabbar-floating: scroll_until F (off-screen) down: stops on it as the app lays it out, every stroke on list bringing it closer, then the tap fires it — averi says the last 2 swipes did not change the screen — the app logged list 1714→2578, list 2578→3437 in them: ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "u [known: bug:2026-10-16-lab-android-scroll-until-reads-a-list-moving-through-blank-content-as-exhausted.md]
    scroll_until → ERROR scroll_until id:"lab.tabbar-floating.F" failed after 4 swipes (the last 2, swiping down, did not change the screen: content exhausted, still loading, or the swipes were not taken) — element never appeared in the tree — if it lies above, try direction: "up"
    tap → ERROR Timed out after 5000ms waiting for element id:"lab.tabbar-floating.F" to appear
    app: F 66,2613 948x143 (off-screen); list clip 0,550 1080x1670 offset 3437 (launched 0); strokes list 0→858, list 858→1714, list 1714→2578, list 2578→3437; fired nothing; touches (540,1598) (540,1598) (540,1598) (540,1598)
- ok tap:fab.W fab: tap W (whole): fires it alone — Tapped id:"lab.fab.W"
- LOUD (tap-refused) tap:fab.L fab: tap L (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: calibration.json #24: averi reads the FAB's transparent host as a cover (the accepted reading, round 13)]
    tap → ERROR id:"lab.fab.L" is under container id:lab.fab.host (0,1758 1080x352) at its centre (204,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
- LOUD (tap-refused) tap:fab.K fab: tap K (whole): fires it alone — refused a target a tap reaches, nothing fired: ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped [known: calibration.json #24: averi reads the FAB's transparent host as a cover (the accepted reading, round 13)]
    tap → ERROR id:"lab.fab.K" is under container id:lab.fab.host (0,1758 1080x352) at its centre (876,1934), drawn over it; nothing of it shows — scroll_until it first; nothing was tapped
- ok tap:own-parts.L own-parts: tap L (open): fires it alone — Tapped text:"LOGIN"
- ok tap:own-parts.N own-parts: tap N (open): fires it alone — Tapped text:"Payee’s name"

Known but ok this run: uiautomator scroll:scroll-bounded-flush.P.fully, uiautomator scroll:scroll-bounded-flush.S.fully


## Appendix: an earlier run of the same build (before review round 1) where S.fully ended cut (LV2)

- MISMATCH scroll:scroll-bounded-flush.S.fully scroll-bounded-flush: scroll_until S (sliver) down, fully: stops on it as the app lays it out, every stroke on lower bringing it closer, then the tap fires it — averi says Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes; but its bottom edge lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there, a  — the app lays it out partly-centre-in, not fully visible
    scroll_until → Element id:"lab.scroll-bounded-flush.S" fully visible after 2 swipes; but its bottom edge lies on its scroll container's (0,1046 1080x495), where Android cuts a node's bounds to the container, and no swipe or time was left to check it — it may be cut there, a rect assert or screenshot may measure part of it
    tap → Tapped id:"lab.scroll-bounded-flush.S"
    app: S 128,1440 825x176 (partly-centre-in); lower clip 0,1046 1080x495 offset 79 (launched 0); strokes lower 0→21, lower 21→79; fired tap S
