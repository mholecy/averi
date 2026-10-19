# Proposal: find device-check bugs in batches, not one family member per round

From the device-check side, after rounds 5–18 (2026-10-05 … 2026-10-15), for the averi developer. A proposal, not a
handoff: no STATUS gate, nothing here is to be device-checked. Read at `dda435b`. Code citations are `file:line` at
that hash.

## 1. What the rounds show

Every round closes most of the bugs it was given and opens a few new ones. The new ones are not random:

| family (by note title) | notes | new since 2026-10-10 |
|---|---|---|
| **visibility** — is what the verb taps / measures at that point what the user sees (covers, sheets, dims, blur, keyboard, bars, scroll-view and screen edges) | **36 / 72** | **15 / 20** |
| tree source / lifecycle (idb, WDA, launch, empty tree) | 13 | 0 (none after 2026-10-09) |
| text / fill (fill, clear, ocr, field errors, encoding) | 12 | 4 |
| scroll mechanics | 3 | 1 |
| other | 8 | 0 |

The tree-lifecycle family converged. The visibility family did not: each round's new note is the **neighbour of the
previous fix** —

- sheet background is no cover → RN transparent-modal dim → SwiftUI blur (no node) → round 18: **SwiftUI alert dim**
  (`2026-10-15-ios-wda-swiftui-alert-dim-is-no-cover-tap-beneath-reported-done.md`);
- beneath a presented screen: scroll_until below the fold (r14) → tap/pixel advice under the status bar (r16) → colour
  on a sliver beneath the sheet (r16) → **a row outside its scroll view** (r17) → partly drawn at the scroll view's
  edge (r18 wording, A.5, not reproducible on device).

The text family behaves the same way at a smaller scale: each new character class is a new note (round 18: a
typographic apostrophe in ocr; `&#10;` left literal by the uiautomator parser).

## 2. Why the bugs arrive one at a time

### 2.1 What is drawn is an excuse list that grows by one row per bug

`standing.ts` already gives the verbs one answer (`sceneOf`, `src/ui-tree/standing.ts:556`; tap
`tap-judgement.ts:195`, scroll stop `scroll-read.ts:366`, pixel `pixel-poll.ts:393,513`). Behind it, *what does not
draw* is `NOT_DRAWN` (`src/ui-tree/draw-order.ts:641`): 14 rows (noArea, structural, screenSizedHost, contentFramed,
scrolledContent, flatListChrome, flatListReadingOrder, onTarget, ownControl, scrollIndicator, sameFrame,
itemlessToolbar, keyboard, hidden), each written per question, and its own comment says unifying them "is a behaviour
change, to be judged per row" (`:636-640`).

Two properties make every new kind of layer a new bug:

1. **Unknown layers partly pass through.** A non-interactive screen-sized host with children is excused unless it is
   a scroll view on a presented layer (`draw-order.ts:751-797`, `603-607`); a structural screen-filling leaf is
   excused unless it is on a presented layer and not a bare frame (`596-600`, `478-481`). ADR 0018 accepts this as
   residuals 1–3 and 5. A layer kind nobody has listed yet (round 18: an alert's dim) lands in an existing excuse and
   the verb answers `Tapped` — silently wrong, found only on a device.
2. **Several paths still judge outside standing**: the stroke box `drawnOver` (`scroll-rounds.ts:672`), touch-down on a
   presented screen `presentedAt` (`:1410`), the exhausted-stroke check `drawnOverAt` (`:1485`), the keyboard read
   separately by four callers (`pixel-poll.ts:397`, `keyboard.ts:138`, `scroll.ts:294`, `keyboard-in-tree.ts:540`), and
   `assert … absent` with a plain viewport test (`verdict.ts:72`). A fix lands in one path; the verbs drift
   (ADR 0018 residual 11 is exactly that: the tap says close it first while `scroll_until` strokes).

### 2.2 No automated check knows the truth

- The vitest fixtures (`tests/fixtures`, 20 trees) carry hand-written expectations: they test what the author
  thought the screen was.
- The differential (`scripts/differential/`) compares OLD with NEW only. It proves a change moved behaviour only
  where intended; it cannot see an answer both sides get wrong. Its one oracle is that a colour target painted its own
  colour passes (README:75); the fake screenshot is grey with the target painted (README:25), so whether the target
  is *really* drawn is never tested against pixels, and OCR reads nothing (README:175).
- Its corpus is out of git (bank data) and grows only from what device checks happen to visit.

So the truth about what is drawn is learnt on a device, one neighbour per round.

### 2.3 The device check confirms; it does not search

The handoff checklist tests the fix and a smoke; new bugs come from side exploration in apps not built for it — one
bank account with little data, sessions that log out (Android again on 2026-10-15), registrations that must not be
spent, Finportal's SMS limit — at 20–30 min per platform. A layer kind the bank app does not show is never met.

### 2.4 Text compares exactly over an un-inventoried input space

`evaluateOcrAssert` compares `seen === want` after `normalizeText`, which folds only whitespace
(`src/verify/text-parity.ts:1059-1071`, `:159`); `parseUiautomatorXml` uses fast-xml-parser defaults, which decode the
five XML entities but no numeric references (`src/adapters/android.ts:1232-1237`). Each new character class is a new
note.

## 3. Proposal

Ordered by how many future notes each removes. P1+P2 are the core: they turn "what is drawn" from something a device
round discovers into something a test knows.

### P1. A ground-truth fixture app (in this repo, no login, no bank data)

A small SwiftUI app and a Compose app (plus one React Native screen for the RN modal cases). One screen per cell of
the matrix below. Every target has a unique solid colour and a unique text tag, and the app writes its own **truth
file** per screen: for each target, the fraction drawn, the point a tap at its centre reaches (the app's own hit test:
`UIView.hitTest` / Compose pointer input that records which node received it), and the covering layer, if any.

| axis | values |
|---|---|
| layer over / around the target | none; sheet (half, full, under 90%); alert; confirmation dialog; popover; fullScreenCover; RN modal (dim leaf, dim wrapper with children); blur; toast/snackbar; keyboard docked/floating + QuickType; tab bar (floating, hidden host); nav bar; status band; sticky header; FAB host; app-drawn strip with no node |
| geometry | fully drawn; partly drawn with centre in / out; outside its scroll view; cut at the screen edge; ≤ 2 pt sliver; zero area |
| verb | tap; scroll_until down / up / fully; assert element / absent / colour / ocr; type_text |
| tree source | idb; WDA; uiautomator |

A capture script runs each screen once on a simulator and an emulator and records the raw tree, the screenshot and
the truth file into `tests/fixtures/truth/<platform>/<cell>/`. Synthetic content, so it **can be committed and run
without a device** — unlike today's corpus.

Most of the matrix can be generated: one screen template parameterised by layer × geometry, not hand-built screens.

### P2. A golden mode for the differential (and vitest)

Run every truth-corpus tree through NEW and compare each verb's answer with the answer the truth implies, via one
small spec table (drawn and uncovered → `Tapped`; covered by a presented screen → `close it first`; outside its
scroll view → scroll advice; partly drawn with centre out → `fully: true first`; …). Serve the **captured screenshot**,
not a grey frame, so colour and ocr are judged against real pixels. A mismatch is a bug found without a device round.
The existing OLD-vs-NEW mode stays for refactors.

### P3. Fail closed on an unrecognised layer

Invert the default in `NOT_DRAWN`: a node above the target counts as a cover unless a row **positively identifies**
it as not drawing (a known class, a bare frame of the target's own scroller, …). Reply wording: `… an unrecognised
layer (<type> <rect>) lies over it — …; nothing was tapped`. A false refusal is visible and costs one agent turn; a
false `Tapped` is silent and costs a device round. Before switching, measure the cost with the differential over the
580 trees: the count of `Tapped → refused` changes, each classified (today's guard is the opposite direction: "no
refused → Tapped").

### P4. One path for every verb

Move the stroke box, the presented touch-down, the exhausted-stroke check, the keyboard read and `assert … absent`
onto the same scene, or, where that is too large, extend `tests/interact/remedy-agreement.test.ts` from presented
screens to **every `NOT_DRAWN` row**: for each row, tap / scroll_until / colour / ocr / fully must agree on drawn,
covered and remedy.

### P5. Text: inventory the input space once

- Decode numeric character references in the uiautomator parser (`htmlEntities: true` or a numeric-only decoder).
- Fold typographic quotes, apostrophes, dashes, ellipsis and the NBSP family in the ocr comparison (documented, and
  the reply names the fold when it matched only after folding).
- One table-driven test over a fixed sample (`’ ‘ “ ” – — …     &#10; &#39; &amp;`, combining diacritics,
  RTL mark) for parser, selectors, tree text assert and ocr.

### P6. Device checks: search, not only confirm

- **Neighbour cases in every handoff.** For each fix, name the adjacent cases (another layer kind, the other side or
  edge, the other verbs, the other tree source) and put them on the checklist — round 18's A.5 was this, and it is the
  shape that would have found r14 → r16 → r17 in one round.
- **One exploratory round per milestone**, with no fix list: parallel agents per surface (Settings, Contacts, Safari,
  Clock, the bank app, Finportal) with a charter of layer kinds to provoke; collect a batch; fix it in one round.
- Every device capture goes into the corpus with a truth note where the screenshot settles it.

## 4. Expected effect

| step | cost | removes |
|---|---|---|
| P3 + P4 | small–medium, code only | the "X is no cover → Tapped" notes (the largest recurring kind) |
| P1 + P2 | medium–large, once | most visibility rounds: device rounds become confirmation of a corpus already green |
| P5 | small | the text/encoding notes |
| P6 | none (process) | the next neighbour found in the same round as the fix |

## 5. Limits

- A fixture app is not the real apps: the bank app's SwiftUI structure and RN's layout still need device rounds, but
  fewer and shorter.
- The app's own hit test can disagree with what XCUITest or uiautomator lists — that disagreement is the signal the
  truth file exists to catch.
- iOS strokes over the screen's middle (ADR 0010) and ocr on cut glyphs stay out of scope here.

## 6. Questions for the developer

1. Is P3's inversion acceptable in principle, given that it reverses the "no refused → Tapped" guard?
2. Where should the fixture apps live: in this repo (`fixtures/apps/`) or beside it?
3. P2's spec table states expected replies per truth: does it belong in the tests or in an ADR?
