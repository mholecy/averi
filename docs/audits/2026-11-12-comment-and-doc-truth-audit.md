# Comment and documentation truth audit, 2026-11-11 / 2026-11-12

A read-only audit of whether the code comments and the documentation say what the code does. This file is the record
of what was reported and what was verified. Nothing was fixed: every entry below is still open unless its status says
otherwise.

## Method

1. **Audit (2026-11-11, at `48f92c5c`).** 50 Haiku agents, read-only. 39 read the comments of `src/`, `scripts/`,
   `tests/`, the fixture apps and the scripts under `docs/truth/`; 5 read the ADRs; 6 read README.md, SETUP.md,
   ARCHITECTURE.md, CLAUDE.md, AGENTS.md, docs/release.md, docs/verification.md, `skill/`, scripts/differential/README.md
   and docs/truth/calibration.md. They reported 270 claims as false, misleading, stale or contradicted.
2. **Verification (2026-11-12, at `b71b5dba`).** 15 Sonnet agents, read-only, each re-read 18 findings against the
   code and gave a verdict, a severity and a fix. 109 commits (251 files) lie between the two commits, among them the
   ARCHITECTURE.md rewrite (A32), so a finding can be obsolete because its text is gone.
3. **Orchestrator check.** 19 findings were also read against the code by the orchestrating session (marked
   `orchestrator-checked`); where it disagreed with the first audit the entry says so.

Historical records were left out on purpose: docs/bugs, docs/handoff, docs/plans, the dated live records under
docs/truth and the HTML architecture reviews.

## Status of each finding

| Status | Meaning | Count |
|---|---|---|
| confirmed | Sonnet saw the disproving code; the claim is wrong or misleading as reported | 132 |
| partly | a real inaccuracy, but narrower or different from what was reported (the reason says what) | 89 |
| refuted | the claim is true, or reads correctly in context; no change needed | 38 |
| obsolete | the quoted text is no longer in the file at `b71b5dba`; nothing to fix | 11 |
| **total** | | **270** |

Severity after verification (Sonnet's own): confirmed low: 104, confirmed medium: 28, partly low: 87, partly medium: 2. No finding was rated high after verification, and none was left uncertain.

## Not verified

- **The findings the audit did not make.** Verification checked only what Haiku reported. A false comment Haiku
  missed is not in this file.
- **Everything changed after `48f92c5c`** was not audited in this pass; the delta pass at the end of this file covers
  it, and the first audit's coverage gaps, as far as that section says.
- **Coverage gaps of the audit itself**, as the agents stated them: the first half of the old ARCHITECTURE.md was read
  with long lines cut at 400 characters; three of the eight test buckets checked references in every file but
  behavioural claims only in part of them; ADR 0010 was verified in part, and the full verification of ADRs 0038, 0041
  and 0044 is not stated.
- **The comment classification.** Haiku sorted about 8806 comment blocks: 5482 explain why, 3324 only restate the
  code. These are estimates, not counts. Its 490 deletion candidates (appendix) were not re-read by anyone.

## Confirmed (132)

### F026 · `docs/adr/0036-a-read-failure-no-wait-cures-is-thrown-by-the-read-seam.md:39` · confirmed · medium · orchestrator-checked

- Reported (doc-contradicts-doc, medium, line 39 at the audit): fill's not-input hint read (interact/fill.ts, `notInput`) still reads raw and swallows any failure, the terminal one included ... Whether it should stop on a terminal failure is left open.
- Audit evidence: src/interact/fill.ts:371 reads through `readTreeOrMiss(adapter)` with the comment 'Through the seam (D39, ADR 0036): a miss stays a hint, a read no wait cures stops the fill as it came.' The ADR's own amendment (lines 44-53, D39) says the same, and tests/ui-tree/raw-tree-reads.test.ts no longer allowlists fill.ts. Only the Consequences bullet is stale, so a reader of Consequences alone gets the wrong behaviour.
- Verification: The Consequences bullet says notInput reads raw and swallows terminal failure, but the same ADR's D39 amendment (line ~44) says it now reads through readTreeOrMiss and a terminal failure stops the fill; fill.ts:371 uses readTreeOrMiss. Bullet is not marked superseded.
- Fix: Rewrite per the amendment: notInput reads through readTreeOrMiss; a miss stays input:'unread', a PersistentReadError stops the fill; or mark the bullet superseded by the D39 amendment.

### F030 · `docs/adr/0040-the-settle-cadence-is-the-tree-sources.md:105` · confirmed · medium

- Reported (stale-reference, medium, line 105 at the audit): The product-path run (`d35-motion --settle`) is the check before merge.
- Audit evidence: No d35-motion script exists in the repo: find over the tree and grep over scripts/, src/, tests/ and docs/ find only the fixture tests/fixtures/d35-b11-settle.json and comments in src/adapters/types.ts:1335 and src/adapters/ios-tree-source.ts:451. The repo's only settle-cadence check is tests/interact/settle-trace.test.ts, which pins the shipped value. The Risks section (R3) presents the command as a merge gate a reader can run.
- Verification: No d35-motion script exists in src, scripts, tests or docs; only mentions in comments, the fixture tests/fixtures/d35-b11-settle.json and ADR 0040 itself. R3 presents the command as the merge check a reader can run.
- Fix: Say the check is a product-path re-measurement of the settle cadence (the d35-motion probe was not kept in the repo); the repo pins only the shipped value via tests/interact/settle-trace.test.ts.

### F039 · `fixtures/apps/android/src/main/java/dev/averi/lab/FalseCovers.kt:11` · confirmed · medium

- Reported (misleading, medium, line 11 at the audit): The toolbar cells are form cells: phase 2b on Android (the capture skips them).
- Audit evidence: MainActivity.kt:155 routes family "false-covers" to FalseCoversScreen, not FormScreen. FalseCovers.kt:60-68 draws only OwnPart per cell target and calls lab.settled() after 600 ms, with no form path. fixtures/apps/cells.json has toolbar-dismiss, toolbar-dismiss-bar and toolbar-dismiss-short (family false-covers, with a form) and no targets for them, so on Android these cells would render an empty screen marked ready, which MainActivity.kt:147-148 says must never happen for an unbuilt family.
- Verification: toolbar-dismiss and toolbar-dismiss-bar are family false-covers, so MainActivity routes them to FalseCoversScreen, which draws nothing for targets [] and settles at 600 ms. Only toolbar-dismiss-short has platforms:["ios"] in false-covers.json. catalog.ts#captureRefusal therefore does not skip the other two on Android, so 'the capture skips them' is wrong for them. The same wording is in false-covers.json's note.
- Fix: Say the toolbar cells are not built on Android: their family routes to FalseCoversScreen, which builds no form and settles an empty screen. Only toolbar-dismiss-short is marked ios-only; mark the other two `platforms: ["ios"]` or correct the claim. Fix the false-covers.json note the same way.

### F044 · `fixtures/apps/android/src/main/java/dev/averi/lab/Presented.kt:97` · confirmed · medium

- Reported (false, medium, line 97 at the audit): a cell with layer `none` (base's `open`) raises nothing and is ready after 300 ms
- Audit evidence: Presented.kt:142 delays 300 ms before the layer switch, then Presented.kt:150 `delay(if (cell.layer == "none") 300 else 1500)` before lab.settled(), so a `none` cell is ready after about 600 ms. Views.kt:122-123 itself says 600 ms for a cell of no layer.
- Verification: Presented.kt: delay(300), then the layer switch, then delay(if none 300 else 1500), then lab.settled(), so a `none` cell settles at about 600 ms. Views.kt:122 also says '600 ms for a cell of no layer'.
- Fix: 'is ready after 600 ms (two 300 ms waits)'.

### F047 · `fixtures/apps/ios/AveriLab/Forms.swift:10` · confirmed · medium

- Reported (misleading, high, line 10 at the audit): Nothing here transforms what is typed (no autocapitalisation, no autocorrection, no mask): a value that does not land as typed is averi's or idb's doing, not the app's
- Audit evidence: Forms.swift:160-171 routes every field with a `format`, `focusInsert` or `keys: refused` to FormattingTextField; Forms.swift:315-319 (Coordinator.textField) rewrites the field text with formatted(parent.format, edited) and writes that shown text to the model. The same file documents this at Forms.swift:258-264. The header's blanket 'nothing transforms' is false for those fields.
- Verification: Forms.swift:160 routes any field with a format, focusInsert or keysRefused to FormattingTextField, which rewrites the text as it is typed. The header says nothing transforms typing apart from the secure-field case, so a reader would blame averi or idb for a value that the app reformatted. Forms.kt's header does name the format exception; the Swift one does not.
- Fix: Add the exception as Forms.kt has it: 'except a field with a `format`, `focusInsert` or refused keys, which FormattingTextField reformats as typed (schema.ts#FieldFormat, `formatted`)'.

### F051 · `fixtures/apps/ios/AveriLab/Presented.swift:37` · confirmed · medium · orchestrator-checked

- Reported (false, medium, line 37 at the audit): a cell with layer `none` (base's `open`) raises nothing and is ready after 300 ms
- Audit evidence: Presented.swift:64 sleeps 300 ms before any layer; Presented.swift:75 sleeps a further 300 ms when cell.layer == "none" (1200 ms otherwise); Presented.swift:77 calls lab.settled() after both. Base.swift:62 applies PresentedLayer to every CellScreen, including `open` (fixtures/apps/cells/base.json:7 layer "none"), so `open` is ready after about 600 ms.
- Verification: Presented.swift:64 sleeps 300 ms, then 300 ms more for a `none` layer, then lab.settled(), so `open` is ready at about 600 ms.
- Fix: 'is ready after about 600 ms (two 300 ms waits)'.

### F056 · `scripts/differential/clock.ts:9` · confirmed · medium · orchestrator-checked

- Reported (false, medium, line 9 at the audit): it is the only `setTimeout` in src/ outside the process shutdown
- Audit evidence: src/adapters/idb-helper.ts:337 (`const readyTimer = setTimeout(...)`), idb-helper.ts:270 and idb-helper.ts:179 (`within`) are setTimeout calls outside shutdown; src/mcp/lifecycle.ts:68 is the only one of the set that is the shutdown budget.
- Verification: setTimeout also appears at src/mcp/lifecycle.ts:68 (shutdown budget) and src/adapters/idb-helper.ts:179, :270 and :337. sleep.ts is not the only non-shutdown timer in src/.
- Fix: Say that waits go through util/sleep.ts, and that other timers (the shutdown budget in mcp/lifecycle.ts, the idb helper's readiness and deadline timers in adapters/idb-helper.ts) stay real.

### F059 · `scripts/differential/fake-device.ts:16` · confirmed · medium

- Reported (false, medium, line 16 at the audit): Every command averi runs goes through `child_process.execFile` (adapters/exec.ts is the one caller)
- Audit evidence: src/adapters/wda.ts:3 imports `spawn as nodeSpawn` and wda.ts:133 `defaultSpawn` uses it; the SpawnFn comment at src/adapters/idb-helper.ts:34 says wda.ts has its own spawn for xcodebuild. src/adapters/idb-helper.ts:1 and :317 spawn python. The fake refuses spawn (fake-device.ts:490), so the stated guarantee holds only for execFile.
- Verification: src/adapters/wda.ts:3 and :133 use child_process spawn for xcodebuild, and src/adapters/idb-helper.ts:1 and :317 spawn python. So 'every command goes through execFile (exec.ts the one caller)' is false in src. The comment's own next paragraph says spawn is refused, so the guarantee is only that spawns throw.
- Fix: Say that device commands go through adapters/exec.ts's execFile, while WDA's xcodebuild and the idb helper use spawn, which the fake refuses.

### F068 · `scripts/differential/golden-spec/rows.ts:38` · confirmed · medium

- Reported (stale-reference, medium, line 38 at the audit): (scroll-rounds.ts#PROBE_REACH) in the R-fully row, repeated at rows.ts:335-336 as "scroll-rounds.ts #PROBE_REACH"
- Audit evidence: PROBE_REACH is `const PROBE_REACH = 0.25;` at src/interact/course.ts:104. src/interact/scroll-rounds.ts:216 itself cites "its reach course.ts#PROBE_REACH"; scroll-rounds.ts does not define it.
- Verification: PROBE_REACH is defined at src/interact/course.ts:104. scroll-rounds.ts:216 and flush-check.ts:33 themselves cite course.ts#PROBE_REACH. rows.ts:38 and :335-336 name scroll-rounds.ts, which does not define it.
- Fix: Change 'scroll-rounds.ts#PROBE_REACH' to 'interact/course.ts#PROBE_REACH' in both places (rows.ts:38 and :335).

### F080 · `scripts/truth/batch/ios-lab.ts:221` · confirmed · medium

- Reported (false, medium, line 221 at the audit): shutdown, boot and bootstatus (each bounded by boundFor's 300 s)
- Audit evidence: ios-lab.ts:230 calls lab.simctl(['shutdown', lab.udid]) with no call bound. bounded.ts:86-88 gives 300 only for simctl boot and bootstatus; every other xcrun simctl verb gets 120.
- Verification: ios-lab.ts:230 calls lab.simctl(['shutdown', udid]) with no call bound. boundFor (bounded.ts:86-88) gives 300 only to simctl boot and bootstatus; shutdown falls to the default 120. The comment gives shutdown the 300 s bound.
- Fix: Say: shutdown (120 s default), boot and bootstatus (boundFor's 300 s each).

### F088 · `scripts/truth/batch/runner.ts:67` · confirmed · medium

- Reported (misleading, medium, line 67 at the audit): its needs (each checked once, by the first block naming it; S6b supplies the checks ...)
- Audit evidence: runner.ts:518-535 (needOf): the first block gets the full check; before each later block that names the need, the need is rechecked with alive (or check when none is given) while it is met. The header's own text at runner.ts:108-110 and the NeedSpec doc at runner.ts:141-143 say so. 'each checked once' tells a reader that a need is never rechecked.
- Verification: runner.ts header item 6 says needs are 'each checked once, by the first block that names it'. needOf (runner.ts:547-564) rechecks with alive or check before each later block. The NeedSpec doc at ~141-143 says so itself.
- Fix: Say: each checked in full by the first block naming it, then rechecked (alive, or check if none) before each later block.

### F092 · `scripts/truth/catalog.ts:28` · confirmed · medium

- Reported (misleading, medium, line 28 at the audit): A target is a solid rectangle of its own colour with no visible text, identified as lab.<cell>.<tag>
- Audit evidence: catalog.ts:51-52 forbids a target naming both text and label, so text/label targets exist. fixtures/apps/cells/text.json, forms.json, false-covers.json and react-native.json contain "text" targets. capture-run.ts:212-214 measures a text or label target on its control's box, 'the text or the icon on it'. The NOTE is written into the generated fixtures/apps/cells.json, so it is also stale there.
- Verification: catalog.ts:51-52 permits text or label targets; text.json, forms.json, false-covers.json and react-native.json contain "text" targets, and capture-run.ts:212 measures them on their control's box. The NOTE therefore wrongly says every target has no visible text. The same sentence is in the generated fixtures/apps/cells.json.
- Fix: A colour target is a solid rectangle of its colour; a text or label target is that colour drawn as its text or icon on its control. Edit catalog.ts, then regenerate cells.json.

### F099 · `scripts/truth/live-cases.ts:172` · confirmed · medium

- Reported (misleading, medium, line 172 at the audit): skipFails: "A SKIP of the case proves nothing and fails the run (summarize): the ensure cases'."
- Audit evidence: skipFails is also set on the lv-d62 carousel legs (scripts/truth/live-carousel.ts:414, :425, :439, :452, :466) and on every chooser case through `base` (scripts/truth/live-chooser.ts:347). summarize counts all of them (live-cases.ts:833).
- Verification: skipFails is also set on the five lv-d62 carousel legs (live-carousel.ts:414-466) and on every chooser case through `base` (live-chooser.ts:336). Summarize fails the run on any of them.
- Fix: A SKIP of the case proves nothing and fails the run (summarize): the ensure cases', the lv-d62 carousel legs' and every chooser case's.

### F100 · `scripts/truth/live-cases.ts:843` · confirmed · medium

- Reported (misleading, medium, line 832 at the audit): "A case whose SKIP proves nothing (Case.skipFails: the ensure cases, live-ensure.ts): the run fails on it."
- Audit evidence: failingSkips filters on r.c.skipFails (live-cases.ts:833). Cases that set skipFails include the lv-d62 carousel legs (live-carousel.ts:414) and all chooser cases (live-chooser.ts:347), not only the ensure cases.
- Verification: failingSkips filters on c.skipFails === true (L844), and that flag is also set on the carousel legs and on all chooser cases. The comment names only the ensure cases.
- Fix: Case.skipFails: the ensure cases, the lv-d62 carousel legs and the chooser cases.

### F105 · `scripts/truth/live-forms.ts:317` · confirmed · medium

- Reported (doc-contradicts-code, medium, line 317 at the audit): judgeUnderSheet: "Anything else, or \"close it first\" said twice, is LOUD."
- Audit evidence: judgeUnderSheet returns MISMATCH, not LOUD, when averi claims a tap (live-forms.ts:324) and when the app logged an event or focus (live-forms.ts:325). LOUD is returned only for "close it first" twice (:327) or no remedy said (:328).
- Verification: judgeUnderSheet returns MISMATCH for a claimed tap and for any logged event or focus. LOUD is returned only for 'close it first' said more than once or for no remedy said. 'Anything else ... is LOUD' is wrong.
- Fix: A claimed tap, or anything logged, is a MISMATCH; 'close it first' said twice, or no remedy said, is LOUD.

### F107 · `scripts/truth/live-visibility.ts:246` · confirmed · medium

- Reported (misleading, medium, line 246 at the audit): against `region` — its scroll view's clip on the screen below the status band, less a full-width chrome at its top or bottom edge (a sticky header, a tab bar, a pinned bar).
- Audit evidence: scripts/truth/live-visibility.ts:262-267: chrome is subtracted when c.width >= r.width / 2 (line 263), i.e. half-width chrome counts, so 'full-width' overstates the rule.
- Verification: showRegion skips chrome only when c.width < r.width / 2, so chrome at least half the clip's width is subtracted. 'Full-width' overstates the rule.
- Fix: less any chrome at least half the clip's width at its top or bottom edge (live-visibility.ts#showRegion)

### F117 · `scripts/truth/replies.ts:317` · confirmed · medium

- Reported (stale-reference, medium, line 317 at the audit): read from the guard's own clause (src/interact/keyboard-in-tree.ts:361, `none of the configured dismissals is usable …`, each skipped dismissal's `covered by <role> …` from :335-345)
- Audit evidence: The phrase 'none of the configured dismissals is usable' is at src/interact/keyboard-in-tree.ts:202, not line 361 (line 361 is a comment). No 'covered by' clause is built in keyboard-in-tree.ts:335-345. The 'covered by ${coverName(...)}' strings are built in src/interact/keyboard-dismissal.ts:233, 235, 243.
- Verification: 'none of the configured dismissals is usable' is at keyboard-in-tree.ts:202 (361 is an unrelated comment); 335-345 holds no 'covered by' string; those are built in keyboard-dismissal.ts:234,236,244.
- Fix: Cite keyboard-in-tree.ts (the 'none of the configured dismissals is usable' clause) and keyboard-dismissal.ts (the 'covered by <role>' clause), no line numbers.

### F130 · `src/adapters/idb-helper.ts:279` · confirmed · medium · orchestrator-checked

- Reported (false, high, line 279 at the audit): A write that succeeded only says the line is in the pipe: a death after it is `died` (gone()), however far the helper got.
- Audit evidence: judge() (idb-helper.ts:424-434) returns `p.taken \|\| !ended ? 'died' : 'unsent'`. With no ack (`taken` false) and fd 3 closed within DRAIN_MS, the answer is `unsent`, not `died`. The judge doc (idb-helper.ts:418-423) and the callers (idb.ts:187-189, which only throws inputLost for `died`) confirm this, so an input whose helper dies before acknowledging is re-run on the CLI. The class doc at idb-helper.ts:212-213 ("A helper that dies under a request answers `died`") has the same imprecision.
- Verification: gone() hands the pending request to judge() (idb-helper.ts ~398-434). judge() resolves `died` only if the request was taken (ack read) or fd 3 stayed open past DRAIN_MS, and otherwise resolves `unsent`. So 'a death after [a successful write] is `died`, however far the helper got' is false: an unacked death is `unsent` and the CLI runs the request. The class doc at l.212-213 ('dies under a request answers `died`') is imprecise in the same way.
- Fix: Reword to: 'A write that succeeded only says the line is in the pipe; a death after it is judged by judge(): `died` once the {"got"} ack was read (or fd 3 stays open past DRAIN_MS), `unsent` if fd 3 ends without the ack.' Adjust l.212-213 to match.

### F132 · `src/adapters/ios-tree-source.ts:29` · confirmed · medium

- Reported (doc-contradicts-code, medium, line 29 at the audit): `applicationLabel()` answers the one question ... for IosAdapter.launch alone (2026-10-09; its doc below).
- Audit evidence: Since D49a the link wait also asks the label: src/adapters/ios.ts:551 `awaitForeground(this.foregroundCheck(handler, { link: url }))` in openDeepLink, and src/adapters/ios.ts:564 `label: () => this.treeSource.applicationLabel()` inside foregroundCheck, which both launch and openDeepLink use. ios-foreground.ts:221 also says link waits ask it. The same error repeats at ios-tree-source.ts:66-67 ("Asked by IosAdapter.launch only (ios-foreground.ts), never by a reader of the tree").
- Verification: ios.ts:551 openDeepLink calls awaitForeground(this.foregroundCheck(handler,{link:url})). foregroundCheck (ios.ts:564) sets label: () => this.treeSource.applicationLabel(), and its doc says 'launch's and a link's'. So applicationLabel is not asked by launch alone. The 'Asked by IosAdapter.launch only' sentence at l.66-67 is wrong in the same way.
- Fix: Say 'for the foreground wait (IosAdapter.launch and a link to the project's own scheme)' and 'Asked by the foreground wait only'.

### F148 · `src/adapters/wda.ts:281` · confirmed · medium

- Reported (doc-contradicts-code, medium, line 280 at the audit): Returns the raw WDA envelope `{ value: <root element>, sessionId }`; callers unwrap `.value` (parseWdaSource, Phase 2).
- Audit evidence: No caller unwraps `.value`. parseWdaSource (src/adapters/wda-source.ts:134-136) takes a JSON string, not the envelope. The only production caller, src/adapters/wda-tree-source.ts:73, passes the payload to parseWdaSourceValue, which unwraps the envelope itself (wda-source.ts:146-148, 178-184). The 'Phase 2' reference is a stale plan label (docs/plans/ios-wda-tree-source.md).
- Verification: source() returns the parsed payload; its only production caller wda-tree-source.ts:73/147 passes it straight to parseWdaSourceValue, which unwraps the envelope (wda-source.ts:146, unwrapEnvelope). parseWdaSource takes a JSON string. No caller unwraps `.value`; 'Phase 2' is a stale plan label.
- Fix: Returns the raw WDA envelope `{ value: <root element>, sessionId }`; parseWdaSourceValue (wda-source.ts) unwraps it, so callers pass it as-is.

### F151 · `src/flow/condition.ts:51` · confirmed · medium · orchestrator-checked

- Reported (false, medium, line 51 at the audit): With element: true inverts the check — element gone or off-viewport.
- Audit evidence: The field is `absent` (condition.ts:54, flow/config.ts:157). flow/config.ts:166-168 refuses `absent` unless `element` is set, and `element` takes an ElementSpec object, not a boolean (config.ts:155). A reader following the comment would write a config the schema rejects.
- Verification: The field is `absent` (condition.ts:54; config.ts zod schema `absent: z.boolean().optional()`), refused unless `element` is present (config.ts refine). `element` is an ElementSpec, so `element: true` is invalid config.
- Fix: With `absent: true` alongside `element`, the check inverts: element gone or off-viewport; on a BARE tree neither, but undecided.

### F171 · `src/interact/keyboard-model.ts:47` · confirmed · medium · orchestrator-checked

- Reported (false, medium, line 47 at the audit): `grep lookOn src/interact` finds only `seenLook` and the post-fill dismissal's tree reads (its first, and each confirming one).
- Audit evidence: lookOn is also called at src/interact/resolve.ts:430 (keyboardMissNote: `const look = lookOn(adapter, tree);`), which is neither seenLook nor the dismissal. The dismissal's reads are at keyboard-in-tree.ts:396 and :421, so the list is incomplete.
- Verification: lookOn is also called at src/interact/resolve.ts:430 (keyboardMissNote), at keyboard-model.ts:190 (seenLook, listed), keyboard-in-tree.ts:396,421 (dismissal), and src/verify/pixel-poll.ts:592, which is outside src/interact. The 'finds only' claim is false for src/interact because of resolve.ts:430.
- Fix: Drop the exhaustive grep claim, or add 'and keyboardMissNote's read in resolve.ts'.

### F178 · `src/interact/scroll.ts:105` · confirmed · medium

- Reported (misleading, medium, line 105 at the audit): The one stop that is absence … throws ElementNotFoundError … Every other stop … stays a plain Error
- Audit evidence: The 'covered' stop passes its evidence as absence (scroll-text.ts:745-758, absence: o.evidence at :757) and the 'bound' stop does too (scroll-text.ts:823, absence: o.evidence). scrollFailure routes both through absenceError (scroll-text.ts:579-584), and scroll-text.ts:575-577 documents covered and bound as absence-capable. So absence is not one stop.
- Verification: scrollFailure routes both `covered` and `bound` through absenceError (scroll-text.ts:572-585, absence set at :747 and :812), so absence is not 'one stop'. Also `within` is a WithinRefusedError, not a plain Error.
- Fix: 'The stops that can be absence (covered, bound: no read at any swipe held a match and the last read succeeded) throw ElementNotFoundError via absenceError; stuck, presented and the rest stay plain Errors and within is a WithinRefusedError.'

### F180 · `src/interact/scroll.ts:74` · confirmed · medium

- Reported (stale-reference, medium, line 288 at the audit): (ARCHITECTURE.md §4, C1)
- Audit evidence: ARCHITECTURE.md:182 '## 4. Flow descriptors (averi.yaml)'. No 'C1' label for scroll_until exists in ARCHITECTURE.md; the only C1 hit is ARCHITECTURE.md:73 ('review 2026-10-07 assert-capture-ocr C1'). scroll_until's design is spread over §2 (ARCHITECTURE.md:64-68) and §5 (MCP tool surface, ARCHITECTURE.md:284).
- Verification: ARCHITECTURE.md §4 is 'Flow descriptors (averi.yaml)'; it does not discuss scroll_until, and there is no 'C1' label anywhere in ARCHITECTURE.md (grep for \bC1\b is empty). scroll_until appears in §2 (:222) and §5 (:568).
- Fix: Point to '(ARCHITECTURE.md §2 scroll, §5 tool surface)' or drop '§4, C1'.

### F194 · `src/ui-tree/draw-order.ts:368` · confirmed · medium

- Reported (false, medium, line 368 at the audit): centreExcused: 'The nodes listed after it that hold its centre ... and that the target column EXCUSED' (same wording for seenClear at lines 385-387)
- Audit evidence: draw-order.ts:1892-1904 builds `met` from `[...before, ...laterFor(...)]`, where `before` holds floating tab bars listed before the target (tabsBefore, line 1888) and reading-order peers listed before it (peers.before). centreExcused (line 1921) and seenClear (line 1922) filter `met`, so excused nodes listed BEFORE the target can appear in both fields.
- Verification: draw-order.ts:1892-1904 builds `met` from [...before, ...laterFor(...)]. `before` holds tab bars and reading-order peers listed before the target. centreExcused and seenClear filter `met` on !c.draws, so excused nodes listed before the target can appear. The docs at 368 and 385 say 'listed after it'.
- Fix: Say 'listed before or after it (floating tab bars and reading-order peers listed before it, and the nodes after it)' in both docs.

### F203 · `src/ui-tree/geometry.ts:1468` · confirmed · medium · orchestrator-checked

- Reported (doc-contradicts-code, medium, line 1468 at the audit): flatListBarLine is 'the one spelling, for draw-order.ts and soft-keyboard.ts' (line 1469), and soft-keyboard.ts 'sizes idb's keyboard band against the same screen' (line 1472, 'Here, not in draw-order.ts')
- Audit evidence: flatListBarLine is called only at src/ui-tree/draw-order.ts:1695; soft-keyboard.ts never imports it (it takes barLine as a parameter, soft-keyboard.ts:105) and never calls screenOf. The same block at geometry.ts:1462-1466 says draw-order.ts is its one reader, so lines 1469 and 1472 contradict it. screenOf is used by usable-screen.ts, read-tree.ts, presentation.ts, keyboard-dismissal.ts and draw-order.ts, so the 'Here, not in draw-order.ts' reason is unsupported.
- Verification: flatListBarLine is called only in draw-order.ts:1695 (plus a test); soft-keyboard.ts contains no flatListBarLine or screenOf reference. The block at geometry.ts:1465 itself says draw-order.ts is its one reader, so 'for draw-order.ts and soft-keyboard.ts' and the 'Here, not in draw-order.ts: soft-keyboard.ts sizes ...' reasoning contradict it.
- Fix: Line 1468: 'the one spelling, for draw-order.ts (its only reader)'. screenOf doc: drop the 'Here, not in draw-order.ts: soft-keyboard.ts sizes...' sentence; screenOf has several callers.

### F207 · `src/ui-tree/keyboard-cover.ts:334` · confirmed · medium · orchestrator-checked

- Reported (false, medium, line 334 at the audit): the registry keeps one adapter, so one oracle, for a whole server session, so in production this is still "once per process"
- Audit evidence: src/mcp/registry.ts:116-127 says adapters are cached per (platform, deviceId, tree-source kind) in a keyed Map, so a session can hold several adapters, each with its own oracle. The notice set is a WeakMap keyed per oracle (keyboard-cover.ts:341), so notices are once per adapter, not once per process.
- Verification: registry.ts:~116-127 caches adapters per (platform, deviceId, tree-source kind) in a keyed Map, so a session can hold several adapters and oracles. 'One adapter ... for a whole server session' and 'once per process' in production are therefore wrong; the WeakMap dedupes per oracle only.
- Fix: 'Per oracle, not per process: the registry keeps one adapter per (platform, device, tree-source kind), so a session with several devices says each notice once per adapter.'

### F260 · `tests/interact/flush-check.test.ts:283` · confirmed · medium

- Reported (misleading, medium, line 283 at the audit): the legitimate case the doubt pays for: one retry, then the hedge (a new call's first probe holds: `checked`)
- Audit evidence: T12 (flush-check.test.ts:356-370, 'a first probe that held ... is doubted once ... and `checked` only when that one holds too') and src/interact/flush-check.ts:221-225 (CHECKED_AFTER_HOLDS = 2, 'must hold ... before the stop is `checked`'). A first hold in a new call is doubted (settles, waits, FIRST probe again), not checked. The parenthetical contradicts the code and the T12 test in the same file.
- Verification: T12 (flush-check.test.ts ~356-370) and CHECKED_AFTER_HOLDS = 2 in src/interact/flush-check.ts say a first probe that holds with no proof is doubted once, and `checked` needs two holds. The parenthetical 'a new call's first probe holds: `checked`' describes the pre-T12 behaviour and contradicts the code.
- Fix: Delete the parenthetical, or reword: 'one retry, then the hedge; a first probe that holds is doubted, and `checked` needs two holds (CHECKED_AFTER_HOLDS)'.

### F012 · `SETUP.md:8` · confirmed · low

- Reported (misleading, low, line 8 at the audit): Setup means creating three things in the app repo root: the MCP registration, an `averi.yaml` ..., and a gitignored `.env.averi`
- Audit evidence: SETUP.md:145-160 (Step 3) also copies the agent skill into `.claude/skills/averi/` in the app repo, and SETUP.md:307 lists it as a required setup item. The opening sentence omits it. Everything else checked in this section is accurate.
- Verification: SETUP.md:8-10 says setup means creating three things, but Step 3 (lines 152-160) installs the skill into .claude/skills/averi/ and the checklist at line 307 lists it as a setup item. The count of three omits it.
- Fix: Say four things: the MCP registration, the agent skill copy under .claude/skills/averi/, an averi.yaml, and a gitignored .env.averi.

### F013 · `docs/adr/0011-no-stuck-clause-at-the-bottom-edge.md:24` · confirmed · low

- Reported (misleading, medium, line 24 at the audit): The rule is at `verify/pixel-poll.ts#judgeOver`.
- Audit evidence: judgeOver in src/verify/pixel-poll.ts:555 only words the miss; its header (pixel-poll.ts:~515-520) says the remedy case and its precedence are decided in ui-tree/standing.ts. The bottom-edge exception itself is decided in src/ui-tree/standing.ts:940-943: the `systemBar` case calls scrollable(scene.clips.inScroller(node), pixel.bar.edge === 'top' && node.rect.y <= box.y), so the stuck-in-place shortcut is granted only at the top edge. A reader looking for the rule in judgeOver will not find it.
- Verification: ADR 0011 points to verify/pixel-poll.ts#judgeOver, which only judges and words the miss (pixel-poll.ts:473-488, calling scene.standing and pixelMissText). The top-edge-only stuck shortcut is decided in ui-tree/standing.ts:829-835 (systemBar case: scrollable(..., pixel.bar.edge === 'top' && node.rect.y <= box.y)), with pinnedSurface alongside. The pointer is wrong.
- Fix: The rule is at `ui-tree/standing.ts` (the `systemBar` case of the pixel remedy: stuck-in-place only where `pixel.bar.edge === 'top'`; `pinnedSurface` for the two child-advice cases). `verify/pixel-poll.ts#judgeOver` only words the miss.

### F015 · `docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md:29` · confirmed · low

- Reported (stale-reference, low, line 29 at the audit): (`tapStandings(scene, node, screen, position).full()`, `interact/tap-judgement.ts#tapStandings`, the expression the tap's `judgeTap` asks too)
- Audit evidence: src/interact/tap-judgement.ts:207 declares `tapStandings(look: Pick<Look, 'scene' \| 'keyboard'>, node: UiNode, screen: UsableScreen \| undefined)`: three arguments, with the keyboard position taken from the look. The doc at tap-judgement.ts:186-206 says it is judged "over `look`'s scene, its keyboard line the look's keyboard position's". There is no `position` parameter. The call in keyboard-dismissal.ts:~256 is `tapStandings(look, node, screen).full()`.
- Verification: tap-judgement.ts:208 declares tapStandings(look, node, screen) with three arguments; the keyboard position comes from look.keyboard. Callers (keyboard-dismissal.ts:210, 357) call tapStandings(look, node, screen).full(). The ADR's four-argument form (scene, node, screen, position) does not exist.
- Fix: Write `tapStandings(look, node, screen).full()`, the look supplying the scene and the keyboard position.

### F016 · `docs/adr/0016-the-dismissal-picker-asks-the-tap-standing.md:49` · confirmed · low

- Reported (misleading, low, line 49 at the audit): \| `offScreen`, `systemBar` \| `off screen at (x,y)`, as before \|
- Audit evidence: src/interact/keyboard-dismissal.ts:237-238 (`whyNotTapped`): for an `offScreen` standing where `outsideItsScrollView(standing)` holds, the skip line is `${outsideScrollViewText(standing.scroller)} at (x,y)`, i.e. `outside its scroll view <node> at (x,y)`. Only the other case yields `off screen at (x,y)`. The table omits this variant.
- Verification: keyboard-dismissal.ts whyNotTapped: for offScreen, if outsideItsScrollView(standing) the line is `${outsideScrollViewText(standing.scroller)} at (x,y)`; only otherwise `off screen at (x,y)`. systemBar gives `off screen at (x,y)`. The table row says `off screen at (x,y)` for all offScreen.
- Fix: Split the row: `offScreen` outside its scroll view gives `outside its scroll view <node> at (x,y)`; other `offScreen` and `systemBar` give `off screen at (x,y)`.

### F017 · `docs/adr/0017-the-keyboards-own-ui-stays-per-verb.md:26` · confirmed · low

- Reported (stale-reference, low, line 26 at the audit): The position module offers both: `line(subject, reading)` exempts only a node of idb's band from the band line
- Audit evidence: src/ui-tree/keyboard-position.ts:88 declares `line(subject?: UiNode, line?: KeyboardLine)` and the implementation at :144-148 takes a computed `KeyboardLine` (merged with `higher(line, band)`), not a reading. The reading's line is obtained separately through `readingLine()` (keyboard-position.ts:86-87) and merged by the caller.
- Verification: keyboard-position.ts declares line(subject?: UiNode, line?: KeyboardLine) and implements it as higher(line, band); the reading's line comes from the separate readingLine(). The ADR's `line(subject, reading)` misnames the second parameter.
- Fix: `line(subject, line)` exempts only a node of idb's band from the band line (the second argument is the line the caller got from `readingLine()`).

### F019 · `docs/adr/0020-the-truth-outranks-a-hand-written-expectation.md:37` · confirmed · low · orchestrator-checked

- Reported (doc-contradicts-code, medium, line 37 at the audit): How a target is addressed is one rule both share, `selectorOf` (scripts/truth/truth.ts): a text target by its string, as an agent would ask it, any other by its identifier
- Audit evidence: scripts/truth/truth.ts:65-82: `elementOf` maps a label target to `{ label }` (between the text and id cases), and `selectorOf` returns `label:"..."` for it. A label target (CatalogTarget.label) is therefore addressed by its accessibility label, not its identifier. scripts/differential/README.md:116 already states the three-way rule (text by string, label by label, any other by identifier).
- Verification: scripts/truth/truth.ts elementOf/selectorOf have a label case (`label:"…"`) between text and id; ADR says only text vs any other by identifier.
- Fix: a text target by its string, as an agent would ask it, a label target by its accessibility label, any other by its identifier

### F022 · `docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md:71` · confirmed · low

- Reported (stale-reference, medium, line 67 at the audit): `runIdb` offers it an allowlisted argv (`HELPER_ARGV`); the helper answers or declines.
- Audit evidence: No identifier HELPER_ARGV exists in src/. The allowlist is two constants in src/adapters/idb.ts: READ_ARGV (line 33) and HID_ARGV (line 37), tested by fits() at idb.ts:70-71, and idb.ts:138-139 names them as the argvs offered to the helper.
- Verification: HELPER_ARGV exists only in this ADR; src/adapters/idb.ts has READ_ARGV and HID_ARGV (and the ADR's line 117 already names those).
- Fix: runIdb offers it an allowlisted argv (READ_ARGV or HID_ARGV, adapters/idb.ts); the helper answers or declines.

### F023 · `docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md:766` · confirmed · low

- Reported (doc-contradicts-code, low, line 762 at the audit): `launch` and `openDeepLink` answer ... `unknown` with a `detail`; and (line 770) `unknown` carries `wait` ..., `app`, and a `detail` sentence
- Audit evidence: src/adapters/types.ts:1003-1005: only the `saw` and `unchecked` variants of `unknown` carry `detail`. The `not-asked` variant is `{ holder: 'unknown'; wait: 'not-asked'; app: string }` with no detail.
- Verification: types.ts AppHolder: only unknown/saw and unknown/unchecked carry detail; not-asked has {wait, app} only. ADR says unknown carries a detail (also at ~770).
- Fix: `unknown` with `wait` and `app`, plus a `detail` for `saw` and `unchecked` (not `not-asked`).

### F025 · `docs/adr/0034-a-fill-passes-a-field-that-reformats-as-it-is-typed.md:210` · confirmed · low

- Reported (doc-contradicts-code, low, line 210 at the audit): The rules live in a pure leaf ... the typing (`fill-type.ts`) and the judge (`fill-verdict.ts`) both import it, and neither imports the other.
- Audit evidence: src/interact/fill-type.ts imports only ./fill-facts.js and ./fill-landing.js (lines 69-70); its one mention of fill-reformat.ts is a comment (line 39). src/interact/fill-verdict.ts imports only ./fill-facts.js (line 72). The importers of fill-reformat.ts are fill-landing.ts (line 26), fill-text.ts and fill-facts.ts. The A2 amendment moved tailOf and the landing rule to fill-landing.ts, but this bullet was not updated.
- Verification: fill-type.ts imports fill-facts and fill-landing only; fill-verdict.ts imports fill-facts only; fill-reformat.ts is imported by fill-landing, fill-text and fill-facts. The A2 amendment (line 292) moved the landing rule, leaving this bullet stale.
- Fix: Say the leaf fill-reformat.ts is imported by fill-landing.ts (A2), fill-text.ts and fill-facts.ts; fill-type.ts and fill-verdict.ts do not import it directly.

### F027 · `docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md:15` · confirmed · low

- Reported (stale-reference, low, line 15 at the audit): (adapters/wda.ts: "taps/typing/install stay on idb/simctl")
- Audit evidence: The quoted string does not appear in src. src/adapters/wda.ts:27 reads 'taps, every other typing and install stay on idb/simctl (plan, decision 4)'. The D43 amendment (lines 126-173) changed the behaviour: WdaServer.keys (wda.ts:~345-400) now types non-ASCII text through /wda/keys.
- Verification: The quoted string is not in wda.ts; line 27 reads 'taps, every other typing and install stay on idb/simctl (plan, decision 4)', and keys() now types non-ASCII (D43).
- Fix: Drop the quotation marks (say wda.ts said, before D43, that taps and typing stay on idb/simctl) or quote the current wording.

### F029 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:50` · confirmed · low

- Reported (doc-contradicts-code, low, line 50 at the audit): `vitest.mutation.config.ts` (`include`, with `related: false` and a cache of its own)
- Audit evidence: vitest.mutation.config.ts:14-15 sets only cacheDir and test.include. `related: false` is set in stryker.config.mjs:71 (`vitest: { configFile: 'vitest.mutation.config.ts', related: false }`).
- Verification: vitest.mutation.config.ts sets only cacheDir and test.include; `related: false` is in stryker.config.mjs:75 vitest runner options.
- Fix: stryker.config.mjs sets `related: false` for the vitest runner; vitest.mutation.config.ts sets its own cacheDir and include.

### F032 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:620` · confirmed · low

- Reported (stale-reference, low, line 616 at the audit): **Tests.** `labMonkey` in `tests/mcp/android-chooser-replies.test.ts` answers as the AVD measured
- Audit evidence: No identifier `labMonkey` exists in src/, scripts/ or tests/. The helper in tests/mcp/android-chooser-replies.test.ts:66 is `adapterOverLabMonkey`, which builds the adapter over the measured monkey outputs.
- Verification: No `labMonkey` identifier anywhere; the helper in tests/mcp/android-chooser-replies.test.ts is adapterOverLabMonkey (line 67), documented as the lab AVD's monkey as D73 measured it.
- Fix: Replace `labMonkey` with `adapterOverLabMonkey`.

### F036 · `docs/truth/live-records/t11-carousel-visible/final-ab/custom.mts:1` · confirmed · low

- Reported (stale-reference, low, line 1 at the audit): node --import tsx custom.ts <record> <case id>
- Audit evidence: The file is custom.mts; final-ab.sh:29 invokes `node --import tsx $S/custom.mts`.
- Verification: The file is custom.mts and its header comment says 'custom.ts'.
- Fix: Change custom.ts to custom.mts.

### F037 · `docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs:1` · confirmed · low

- Reported (stale-reference, low, line 1 at the audit): raw stroke transfer, no averi: node raw.mjs <out.jsonl> <rounds> [label].
- Audit evidence: The file is raw-strokes.mjs. final-ab.sh:35 and t12-ab.sh:34 invoke raw-strokes.mjs; no raw.mjs exists in the repo.
- Verification: raw-strokes.mjs line 1 says `node raw.mjs`; the raw/ directory holds only raw-strokes.mjs, no raw.mjs.
- Fix: Change `raw.mjs` to `raw-strokes.mjs`.

### F038 · `docs/truth/live-records/t12-first-probe/t12-ab.sh:2` · confirmed · low

- Reported (stale-reference, low, line 2 at the audit): dry: every count at 1, records in t12-dry, marked and not counted.
- Audit evidence: t12-ab.sh:8 sets O=$S/t12-records/run${DRY:+-dry}, so the dry records are in t12-records/run-dry, not t12-dry.
- Verification: t12-ab.sh:8 sets O=$S/t12-records/run${DRY:+-dry}, so dry records go to t12-records/run-dry, not 't12-dry'.
- Fix: Replace 't12-dry' with 't12-records/run-dry'.

### F042 · `fixtures/apps/android/src/main/java/dev/averi/lab/Lab.kt:28` · confirmed · low

- Reported (stale-reference, low, line 28 at the audit): `dialog-fullscreen` and `bottom-sheet-dialog` are Android's own (round 7, Presented.kt): the windows ADR 0018's residual 19 names unmeasured
- Audit evidence: docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md:56 says "residual 19 closed for such windows", and its amendment "Android's window by the window manager's word (2026-10-24)" is at line 1209. The comment presents residual 19 as still open.
- Verification: ADR 0018 item 19 and its amendment (2026-10-24) say residual 19 was closed for Dialog and panel windows, which covers these layers. 'names unmeasured' is stale.
- Fix: Say 'the windows ADR 0018's residual 19 covered (closed 2026-10-24 by the window-manager amendment)'.

### F043 · `fixtures/apps/android/src/main/java/dev/averi/lab/MainActivity.kt:145` · confirmed · low

- Reported (misleading, low, line 145 at the audit): this `when` names every family of scripts/truth/schema.ts#FAMILIES once, so no batch of phase 3 edits it
- Audit evidence: scripts/truth/schema.ts:90 FAMILIES includes 'react-native', and MainActivity.kt:151-163 has no "react-native" branch. The same overclaim is at fixtures/apps/ios/AveriLab/AveriLabApp.swift:51-53, while the switch at AveriLabApp.swift:58-71 also lacks "react-native".
- Verification: schema.ts:90 FAMILIES includes 'react-native' and the `when` has no such branch. It also has a `views` branch that is not built here. React Native is a separate app, so 'every family of FAMILIES' is literally false. The same overclaim is in AveriLabApp.swift:51.
- Fix: Say 'names every family the native apps build (FAMILIES minus react-native)'. Apply the same fix in AveriLabApp.swift.

### F048 · `fixtures/apps/ios/AveriLab/Held.swift:12` · confirmed · low

- Reported (misleading, low, line 12 at the audit): Every phase change is logged (`phase`, `bare` / `spinner` / `welcome` / `home`) before it is drawn
- Audit evidence: The `unconfigured` phase is also logged: Held.swift:57 `guard let held = cell.held else { return show(.unconfigured) }`, and show() at Held.swift:68-70 writes lab.event("phase", next.rawValue) for every phase including unconfigured (enum at Held.swift:17-18). The same omission is in Lab.swift:134-135 (the event-kind doc lists bare, spinner, welcome, home).
- Verification: HeldPhase includes `unconfigured`, and show(.unconfigured) logs it through lab.event('phase', ...). Both the Held.swift header and the Lab.swift event doc list only bare, spinner, welcome and home. The enum comment does explain `unconfigured`.
- Fix: Add `unconfigured` (catalog gave no `held`) to both lists.

### F055 · `scripts/differential/clock.ts:8` · confirmed · low

- Reported (misleading, low, line 8 at the audit): (its doc: "one owner so waits, not sleeps stays a design rule")
- Audit evidence: src/util/sleep.ts:1 reads `One owner so "waits, not sleeps" stays a design rule, not a habit.` The quoted text is paraphrased and not verbatim.
- Verification: src/util/sleep.ts:1 reads 'One owner so "waits, not sleeps" stays a design rule, not a habit.' The clock.ts quote is lowercased, drops the inner quotes and the tail, yet sits in quotation marks. Harmless imprecision.
- Fix: Quote exactly: (its doc: "One owner so \"waits, not sleeps\" stays a design rule, not a habit") or drop the quotation marks.

### F057 · `scripts/differential/differential.ts:20` · confirmed · low

- Reported (stale-reference, low, line 20 at the audit): one iOS dismissal list in averi.yaml; VARIANTS below (line 20), and "Which tools to call (default: all of PLAN's)" (line 81)
- Audit evidence: No identifier VARIANTS or PLAN exists in differential.ts. The variants are built by `variantsOf` (differential.ts:127) and the calls by `plan()` (:307) and `treeCalls` (:331); EVERY is at :104.
- Verification: grep of differential.ts finds VARIANTS and PLAN only in comments (lines 20, 32, 82), never as identifiers. The reporter named the real ones (variantsOf, plan(), treeCalls), so these are dead pointers.
- Fix: Replace 'VARIANTS below' with 'variantsOf below', and 'PLAN' with 'plan()' (lines 32 and 82).

### F061 · `scripts/differential/golden-spec/base.ts:28` · confirmed · low

- Reported (doc-contradicts-doc, low, line 28 at the audit): The truth that the source does not list it outranks "open → Tapped" (ADR 0020) (also rows.ts:182 cites ADR 0020 as settled)
- Audit evidence: docs/adr/0020-the-truth-outranks-a-hand-written-expectation.md:3 reads "Status: proposed, 2026-10-15"; the comments cite it as a decided rule.
- Verification: docs/adr/0020 line 3 reads 'Status: proposed, 2026-10-15 ... for the owner to accept', while base.ts:28 and rows.ts:182 cite it as settled doctrine. I found no record of acceptance. Other ADRs are 'accepted'.
- Fix: Either set ADR 0020 to accepted (the owner's call), or say 'proposed ADR 0020' in these comments.

### F063 · `scripts/differential/golden-spec/forms.ts:62` · confirmed · low

- Reported (misleading, low, line 62 at the audit): The form cells' static rows — (large table JSDoc, lines 61-93)
- Audit evidence: That JSDoc is followed directly by a second JSDoc (lines 94-97) for tappedAfterBack, so the table documents tappedAfterBack. formRows (line 203) has a separate doc at lines 199-202 that does not refer to the table.
- Verification: The table JSDoc (forms.ts lines 61-93) is directly followed by a second JSDoc for tappedAfterBack. Only the last JSDoc attaches to that declaration, so the table is detached from formRows (doc at ~199-202), which it describes.
- Fix: Move the table JSDoc to sit directly above formRows, leaving tappedAfterBack with its own doc.

### F064 · `scripts/differential/golden-spec/forms.ts:82` · confirmed · low

- Reported (misleading, medium, line 82 at the audit): (tools.ts tap: "a target COVERED by the on-screen keyboard … REFUSED"); the same table quotes tools.ts at lines 83, 85, 87, 89 and 92 (e.g. "A color/ocr assert never samples what lies over its element", "the swipes touch down clear of it", "a row of the presented sheet itself is still swiped for on the sheet")
- Audit evidence: src/mcp/tools.ts:418 reads "A selector target under the soft keyboard: Android hides it (back) first; ... refuses a centre below the keyboard's top line likewise"; src/mcp/tools.ts:627 reads "A color/ocr assert never measures what covers its element". No file under src contains "COVERED by the on-screen keyboard", "touch down clear", "still swiped" or "never samples".
- Verification: grep of src for 'COVERED by the on-screen keyboard', 'touch down clear', 'still swiped' and 'never samples' finds nothing. tools.ts:655 says 'never measures what covers its element', and the tap text at :446 says 'tapped on an uncovered part when enough shows ..., else REFUSED naming the cover'. The quoted strings are paraphrases inside quotation marks, and a reader searching for them finds nothing.
- Fix: Quote the exact tools.ts wording or drop the quotation marks and say 'tools.ts tap/assert/scroll_until say ...'.

### F065 · `scripts/differential/golden-spec/forms.ts:89` · confirmed · low

- Reported (misleading, low, line 89 at the audit): (ADR 0005: a covered target's tap moved to its piece) — also rows.ts:35 "ADR 0005 (a covered target's tap moved to its piece, or refused)"
- Audit evidence: docs/adr/0005-cut-before-cover.md is about the order of judgement (off screen, bands, cut, covered, keyboard) and a cut sliver reported at a named edge. The file has no rule about a tap moving to a piece (grep for "piece" finds nothing).
- Verification: docs/adr/0005-cut-before-cover.md is about the order of judgement (off screen, bands, cut, covered), and has no word 'piece' (grep empty). No ADR states a rule of a covered target's tap moving to its piece. forms.ts:89 and rows.ts:35 both cite 'ADR 0005' for it.
- Fix: Drop the ADR 0005 citation for the piece rule, or cite the bug note (docs/bugs/2026-10-08-tap-and-scroll-until-ignore-pinned-app-chrome.md) or state the rule inline.

### F066 · `scripts/differential/golden-spec/forms.ts:346` · confirmed · low

- Reported (stale-reference, low, line 346 at the audit): is the live golden's (live.ts k5); also forms.ts:356 "live.ts k5 judges it on the model"
- Audit evidence: The case k5 is defined at scripts/truth/live-cases.ts:276 (`id: 'k5'`). scripts/truth/live.ts has no k5.
- Verification: The k5 case is defined at scripts/truth/live-cases.ts:277 (id: 'k5'). grep of scripts/truth/live.ts for k5 finds nothing. Both forms.ts:346 and :356 point to live.ts.
- Fix: Change 'live.ts k5' to 'live-cases.ts k5' in both places.

### F069 · `scripts/differential/golden-spec/rows.ts:337` · confirmed · low

- Reported (misleading, low, line 337 at the audit): what shows of the target ends on that side exactly at its own scroll view's edge
- Audit evidence: rows.ts:448 `withinPixel` is `Math.abs(a - b) <= 1`, so the edge need only be within a pixel. rows.ts:480 also accepts a piece ending at a pinned chrome's inner edge at a top or left edge (underPinnedChrome), which the doc omits at this spot.
- Verification: flushProbe (rows.ts ~475-483) uses withinPixel, which accepts a difference of 1 px or less, and also accepts a piece ending at a pinned chrome's inner edge at top or left (underPinnedChrome). The R-fully doc says 'exactly at its own scroll view's edge' and omits both. The later flushProbe JSDoc states it correctly.
- Fix: Say 'within a pixel of its scroll view's edge (at a top or left edge also where its piece ends at a pinned chrome's inner edge; see flushProbe)'.

### F070 · `scripts/differential/synthetic.ts:8` · confirmed · low

- Reported (false, low, line 8 at the audit): Keyed by file name; `run` is the corpus run they are written into.
- Audit evidence: Nothing in synthetic.ts takes or names a run. syntheticIdb (synthetic.ts:20) and syntheticUiautomator (synthetic.ts:39) return Record<filename, payload>. The writer is convert.ts:287-289, which calls add(ios, f, body, …) for each entry.
- Verification: synthetic.ts has no `run` parameter or name. syntheticIdb and syntheticUiautomator return Record<filename, payload>. The corpus run is created in convert.ts:284-285 and written by add() at :288-291.
- Fix: Replace with: 'Keyed by file name; convert.ts writes each one into the corpus run.'

### F072 · `scripts/truth/batch/abort.ts:44` · confirmed · low

- Reported (misleading, low, line 44 at the audit): How long it can take, at worst: ... one window at the defaults, about 7 minutes.
- Audit evidence: The enumerated steps omit the last steps. abortOnce runs `await this.lastSteps()` after `stopKept` (abort.ts:392-393), bounded by LASTLY_SECS = 60 (abort.ts:137, 527) plus a 2 s stop. The listed steps sum to 2+300+2+120+2+2 = 428 s; with the last steps it is about 490 s, roughly 8 minutes.
- Verification: abort.ts:393 runs `await this.lastSteps()` after stopKept. It is bounded by LASTLY_SECS = 60 (abort.ts:137) plus a stop for its scope, and it is skipped when no `lastly` is given. The enumerated steps sum to about 428 s, so the 'about 7 minutes' figure omits it. With lastly the worst case is about 8 minutes.
- Fix: Add 'then the run's last steps (`lastlySecs`, 60 s by default, when a `lastly` is given) and their stop' and say about 8 minutes.

### F073 · `scripts/truth/batch/android-lab.ts:16` · confirmed · low

- Reported (stale-reference, low, line 16 at the audit): (T2 S6b; batch-11.sh:413–450, batch-12.sh:377–400) — same pattern at android-lab.ts:28 (batch-11.sh:443), :62 (batch-11.sh:427–450), and lab-emu.ts:197 (batch-11.sh's handlers).
- Audit evidence: No batch-*.sh file exists in the checkout (rg --files finds none), so the cited line ranges cannot be checked. The same pointers occur in about ten other scripts/truth/batch and scripts/truth files (for example ios-lab.ts 6 hits, lab-build.ts 3, lab-emu.ts 3, runner-lines.ts 4). The rule each comment states is in the TypeScript and does not need the shell line.
- Verification: android-lab.ts:16 cites batch-11.sh:413-450 and batch-12.sh:377-400. A find over the repo (excluding node_modules) turns up no batch-1*.sh file, so the pointers are dead. The rule text is self-contained.
- Fix: Delete the batch-N.sh:line pointers and keep the rule text.

### F074 · `scripts/truth/batch/cases.ts:16` · confirmed · low

- Reported (stale-reference, medium, line 16 at the audit): A run counts only when complete (b11-analyze.ts:1–23)
- Audit evidence: scripts/truth/batch/b11-analyze.ts does not exist; git ls-files lists no b11-analyze.ts. The same dead pointer recurs at cases.ts:97 and cases.ts:176.
- Verification: cases.ts:16 cites b11-analyze.ts:1-23. No such file exists in the repo. The pointer is a dead provenance reference and the surrounding text states the rule itself.
- Fix: Delete the (b11-analyze.ts:1-23) pointer, here and at the other occurrences.

### F075 · `scripts/truth/batch/cases.ts:184` · confirmed · low

- Reported (misleading, low, line 184 at the audit): a name that is no plain path segment (letters, digits, _ and -)
- Audit evidence: PLAIN_SEGMENT at run-dir.ts:131 is ^[A-Za-z0-9][A-Za-z0-9_-]*$: the first character must be a letter or digit, and a leading _ or - is refused.
- Verification: PLAIN_SEGMENT in run-dir.ts:129 is /^[A-Za-z0-9][A-Za-z0-9_-]*$/. A leading _ or - is refused, but the wording (letters, digits, _ and -) does not say so. cases.ts:184 repeats it in the error text.
- Fix: Say: no plain path segment (starts with a letter or digit, then letters, digits, _ and -).

### F076 · `scripts/truth/batch/ios-defaults.ts:16` · confirmed · low

- Reported (stale-reference, medium, line 15 at the audit): The three domains the WDA window backs up and puts back (d43-gate.ts's DOMAINS, its order).
- Audit evidence: d43-gate.ts is not in the repo (git ls-files finds no d43-gate file). Related dead pointers: ios-defaults.ts:18 (d43-gate.ts's PORT, read by d43-gate.ts --restore), ios-domains.ts:64 (d43-gate.ts's 15 s), ios-lab.ts:35, :45 (d43-gate.ts's 1.5 s, 10 s).
- Verification: ios-defaults.ts:16 and :19 cite d43-gate.ts (DOMAINS, PORT). The file does not exist in the repo. The comment still reads fine without it, so this is a dead pointer only.
- Fix: Drop the d43-gate.ts references and keep the value and the reason for it.

### F081 · `scripts/truth/batch/lab-build.ts:63` · confirmed · low

- Reported (misleading, low, line 63 at the audit): when an Android build was started and its own stop never ran (an abort)
- Audit evidence: lab-build.ts:213 keeps `gradle` set when the --stop fails, and lastly at lab-build.ts:266-268 runs gradleStop again. So the last step also covers a stop that ran and failed, not only one that never ran.
- Verification: lab-build.ts:213 keeps gradle set when the --stop failed, and lastly (:266-268) runs gradleStop again. So it also covers a stop that ran and failed, not only one that never ran.
- Fix: Say: when an Android build was started and its own stop did not succeed (an abort, or a failed stop).

### F082 · `scripts/truth/batch/lab-chooser.ts:112` · confirmed · low

- Reported (stale-reference, medium, line 112 at the audit): --check's exits (d55-b11.ts --check, batch-12's final checkExit, in pure-b12.ts)
- Audit evidence: Neither d55-b11.ts nor pure-b12.ts exists in the repo (git ls-files finds neither). The same dead names appear at lab-chooser.ts:59 (d55-b11.ts's `D55 check:` line) and lab-chooser.ts:63 (d55-probe.ts).
- Verification: lab-chooser.ts cites d55-b11.ts, pure-b12.ts and d55-probe.ts. None of them exists in the repo. The exit meanings are carried by CHECK_EXIT and CHECK_OUTCOME, so the pointers are dead and the text still works without them.
- Fix: Remove the file pointers and describe the exits from CHECK_EXIT.

### F083 · `scripts/truth/batch/lab-chooser.ts:162` · confirmed · low

- Reported (doc-contradicts-code, low, line 162 at the audit): `lab entries <n> (defaults <d>, last-chosen <l>[, accepted <a>])[; first: <its text>]`
- Audit evidence: checkWhy at lab-chooser.ts:171 also appends `, no mAlways <n>` when any entry lacks mAlways; the doc omits it.
- Verification: checkWhy builds counts with an extra `, no mAlways <n>` when unflagged entries exist (lab-chooser.ts:171). The documented format line omits it.
- Fix: Add `[, no mAlways <n>]` to the format line.

### F086 · `scripts/truth/batch/lab-lines.ts:33` · confirmed · low

- Reported (stale-reference, medium, line 33 at the audit): The lab's WebDriverAgent by its exact patterns (batch-11.sh:321–325 kill_lab_wda)
- Audit evidence: batch-11.sh is not in the repo. The same missing script is cited at lab-lines.ts:39 (batch-11.sh:327, 660), lab-lines.ts:69 (d43-gate.ts's listeners) and preconditions.ts:28 (batch-11.sh:80), and cited again in ios-lab.ts:17, ios-lab.ts:37 and lab-build.ts:12 (batch-11.sh:295–320).
- Verification: lab-lines.ts:34, :40 and others cite batch-11.sh line numbers, and batch-11.sh is not in the repo. The patterns the comments describe are documented in the code.
- Fix: Drop the script line numbers and keep the pattern contract.

### F087 · `scripts/truth/batch/lab-lines.ts:169` · confirmed · low

- Reported (doc-contradicts-code, low, line 169 at the audit): Found only by a label: never a null entry.
- Audit evidence: lab-lines.ts:170 finds the alert when AXLabel OR AXValue begins with "Open in". The doc at lab-lines.ts:153-154 says "labelled, or valued".
- Verification: lab-lines.ts:170 finds the alert by AXLabel or AXValue matching OPEN_IN, and the docblock at :153 says 'labelled, or valued'. The inline comment 'Found only by a label' contradicts that.
- Fix: Found by a label or a value: never a null entry.

### F094 · `scripts/truth/chooser-readers.ts:77` · confirmed · low

- Reported (stale-reference, low, line 76 at the audit): "The preferred read's text (d55-b11.ts's preferredOf, a call that answered)"
- Audit evidence: No d55-b11.ts exists in the repo (find over the whole tree returns nothing). preferredOf is defined at scripts/truth/batch/lab-chooser.ts:78, and this file's own header at :11-13 already cites lab-chooser.ts#preferredOf.
- Verification: No d55-b11.ts exists anywhere in the repo. preferredOf is in scripts/truth/batch/lab-chooser.ts, and this file's header at :14 already cites lab-chooser.ts#preferredOf.
- Fix: lab-chooser.ts#preferredOf

### F095 · `scripts/truth/chooser-readers.ts:152` · confirmed · low

- Reported (stale-reference, low, line 152 at the audit): handlersIn comment: "words.ts#firstLineOf's line"
- Audit evidence: No scripts/truth/words.ts exists. firstLineOf is at scripts/truth/batch/words.ts:72.
- Verification: scripts/truth/words.ts does not exist; the file is scripts/truth/batch/words.ts.
- Fix: batch/words.ts#firstLineOf's line

### F096 · `scripts/truth/lab-device.ts:116` · confirmed · low

- Reported (false, low, line 116 at the audit): hideKeyboard doc quotes src/mcp/tools.ts tap: "the keyboard is hidden (back) and the element found again first"
- Audit evidence: That wording is not in src/mcp/tools.ts or anywhere under src/ (rg finds it only in this comment at lab-device.ts:117). The behaviour itself matches the code, one `input keyevent 4` at lab-device.ts:542.
- Verification: The quoted wording appears nowhere in src/mcp/tools.ts. The nearest text is in src/interact/tap.ts:50, 'the keyboard is hidden and the target resolved again first', and it has no '(back)'. The quote and the file are both wrong, though the behaviour (one keyevent 4) matches.
- Fix: Cite src/interact/tap.ts and keyboard.ts#resolveClearOfKeyboard, and drop the quotation marks or quote the real text.

### F097 · `scripts/truth/live-carousel.ts:20` · confirmed · low

- Reported (misleading, low, line 20 at the audit): "averi's every stroke logged into the record (RunRecord `swipes`)"
- Audit evidence: swipes is a CaseRecord field (scripts/truth/live-cases.ts:99). RunRecord (live-cases.ts:62-82) has no such field.
- Verification: swipes is a field of CaseRecord (live-cases.ts ~L99). RunRecord has only platform, app, side, results, deviceLabel and chooserPremise.
- Fix: (CaseRecord `swipes`)

### F098 · `scripts/truth/live-cases.ts:105` · confirmed · low

- Reported (misleading, low, line 105 at the audit): DeviceLog doc: "the strokes averi drew (RunRecord `swipes`...), the device's focus reads (RunRecord `focus`...)". The same "RunRecord" wording recurs at live-cases.ts:106, :129, :138-139 and :191.
- Audit evidence: RunRecord (live-cases.ts:62-82) has no swipes, focus or preDrag field. Those are CaseRecord fields (live-cases.ts:97-101), and the record's results array holds them.
- Verification: swipes, focus, preDrag and warmUpError are CaseRecord fields, but live-cases.ts cites RunRecord for them at ~L106, 107, 130, 140, 169 and 192. RunRecord only holds them through `results`.
- Fix: Replace RunRecord with CaseRecord for swipes, focus, preDrag and warmUpError at each of those lines.

### F101 · `scripts/truth/live-chooser.ts:18` · confirmed · low

- Reported (misleading, low, line 18 at the audit): FocusReads doc: "A case's focus reads (CaseReads.focus, RunRecord `focus`)"
- Audit evidence: focus is a CaseRecord field (scripts/truth/live-cases.ts:101). RunRecord (live-cases.ts:62-82) has no focus field.
- Verification: focus is a CaseRecord field (live-cases.ts ~L101), not a RunRecord field.
- Fix: (CaseReads.focus, CaseRecord `focus`)

### F102 · `scripts/truth/live-ensure.ts:25` · confirmed · low

- Reported (stale-reference, low, line 25 at the audit): Timing doc: "hold-tracker.ts: `heldMs` = the ending read's stamp − the first read's that saw the screen"
- Audit evidence: src/flow/hold-tracker.ts has no heldMs identifier. holdTracker returns the held duration as a number (src/flow/hold-tracker.ts:13-18, :34-47). The heldMs field lives on engine.ts's Detection type (src/flow/engine.ts:298).
- Verification: src/flow/hold-tracker.ts has no heldMs. The field is on engine.ts's Detection type (L300), set from hold.observe's return value at engine.ts:1151.
- Fix: engine.ts Detection.heldMs, from hold-tracker.ts's observe return: the ending read's stamp minus the first read's that saw the screen

### F103 · `scripts/truth/live-ensure.ts:34` · confirmed · low

- Reported (stale-reference, low, line 34 at the audit): POLL_S doc: "(src/flow/engine.ts:526, pollMs 500)"
- Audit evidence: src/flow/engine.ts:526 is inside a doc comment about the TAKERS hand-off (lines 524-528). The 500 default is `this.pollMs = opts.pollMs ?? 500` at src/flow/engine.ts:549.
- Verification: The cited engine.ts:526 is not the pollMs default. `this.pollMs = opts.pollMs ?? 500` is now at engine.ts:558, so the number has drifted.
- Fix: Drop the line number: (src/flow/engine.ts, pollMs default 500)

### F104 · `scripts/truth/live-ensure.ts:38` · confirmed · low

- Reported (doc-contradicts-doc, low, line 38 at the audit): READ_S comment: "To be confirmed by block G's device run." (also :43: block G's run "measures ... and tightens READ_S / TAP_S")
- Audit evidence: docs/plans/2026-10-30-performance-backlog.md, D30 row: block G calibration is done (batch-9, 2026-11-03). Its residuals sit under half of heldSlackS for each source, and the decision reads "KEEP: READ_S and TAP_S kept". The bounds are therefore measured, not pending. heldSlackS = POLL_S + 3*READ_S + TAP_S matches the plan's 2.5/2.5/10.5 s.
- Verification: The performance backlog D30 row records the calibration as closed in batch-9 with decision 'KEEP: READ_S and TAP_S kept'. The future-tense 'to be confirmed by block G's device run' and 'block G's run measures ... and tightens' are stale.
- Fix: Say that READ_S and TAP_S were calibrated by D30 (batch-9, three runs) and kept. Cite the plan row, with uiautomator's residual of about 5.12 s against half of heldSlackS (5.25 s).

### F106 · `scripts/truth/live-visibility.ts:145` · confirmed · low

- Reported (misleading, low, line 145 at the audit): What a tap or a stroke made the app log: every event but the touches and focus changes (tap, dismissed, button, tab, select, submit).
- Audit evidence: firedSince filters only touch and focus (live-visibility.ts:147), so 'phase' events pass through. schema.ts:401 includes 'phase' in EventKind, and schema.ts:396-399 says phase is logged by held cells. The parenthetical list omits phase.
- Verification: firedSince excludes only touch and focus. 'phase' is a valid EventKind (schema.ts:401), logged by held cells, so it passes through and the parenthetical list omits it.
- Fix: Add 'phase' to the parenthetical list, or say the filter keeps every kind other than touch and focus.

### F109 · `scripts/truth/replies.ts:141` · confirmed · low

- Reported (stale-reference, medium, line 142 at the audit): the resolver's timeout (src/interact/resolve.ts:358, "…waiting for element X to appear"), scroll_until's give-up (src/interact/scroll-text.ts:593, "element never appeared in the tree"), the assert poll's (src/verify/poll-verdict.ts:78, "not found within N s")
- Audit evidence: resolve.ts:358 is 'throw await notFound(adapter, target, timeoutMs, outcome);'. scroll-text.ts:593 is the doc comment of failureText; 'element never appeared in the tree' is at scroll-text.ts:751 and :1285. poll-verdict.ts:78 is a 'return verdict?.detail …' line; 'not found within' is at poll-verdict.ts:86. The 'waiting for element … to appear' wording is produced via pollTimeoutMessage in resolve.ts around :413.
- Verification: Cited lines no longer hit the quoted code: resolve.ts:358 is blank/unrelated, scroll-text.ts:593 is not the text (it is at 741 and 1274 now), poll-verdict.ts:78 is not it ('not found within' at :86). The wording itself is real.
- Fix: Cite by function/name (resolve.ts pollTimeoutMessage, scroll-text.ts withMissNote 'element never appeared in the tree', poll-verdict.ts headline) without line numbers.

### F110 · `scripts/truth/replies.ts:143` · confirmed · low

- Reported (stale-reference, medium, line 144 at the audit): (src/interact/resolve.ts#ZERO_AREA_HINT and the clipped-out hint: "it matched only 0×0 nodes …", "it matched only nodes clipped out above its scroll container …")
- Audit evidence: ZERO_AREA_HINT is defined in src/ui-tree/miss.ts:178, not in src/interact/resolve.ts (grep finds no definition there). The clipped-out wording is built in miss.ts:183-184.
- Verification: ZERO_AREA_HINT is defined in src/ui-tree/miss.ts:178; grep finds no definition in src/interact/resolve.ts. Clipped-out wording comes from ui-tree/sides.ts / miss.ts.
- Fix: Change to src/ui-tree/miss.ts#ZERO_AREA_HINT (and the clipped-out note built there from sides.ts).

### F111 · `scripts/truth/replies.ts:153` · confirmed · low

- Reported (stale-reference, low, line 153 at the audit): (src/ui-tree/read-tree.ts:192, "Timed out after Nms waiting for element X" — no "to appear", so not `notInTree`)
- Audit evidence: read-tree.ts:192 is the 'export interface HandedRead {' declaration line. The 'Timed out after ${timeoutMs}ms waiting for ${what}' template is at read-tree.ts:262.
- Verification: read-tree.ts:192 is 'export interface ReadSpan {'; the 'Timed out after ${timeoutMs}ms waiting for ${what}' template is at read-tree.ts:283.
- Fix: Cite src/ui-tree/read-tree.ts without a line number (the 'Timed out after' template).

### F112 · `scripts/truth/replies.ts:162` · confirmed · low

- Reported (stale-reference, low, line 162 at the audit): (src/flow/engine.ts:772, "second look: not detected, the screen held still <s> — running <rung> before the <window> window's end")
- Audit evidence: engine.ts:772 is a comment line inside the hold logic. The 'second look: not detected, the screen held still' template is at engine.ts:797.
- Verification: engine.ts:772 is an unrelated comment; the 'second look: not detected, the screen held still' template is at engine.ts:807.
- Fix: Cite src/flow/engine.ts without a line number.

### F113 · `scripts/truth/replies.ts:208` · confirmed · low

- Reported (stale-reference, low, line 208 at the audit): (src/mcp/tool-text.ts: a fill whose read-back did not confirm it says so)
- Audit evidence: 'NOT verified' is not in src/mcp/tool-text.ts (zero matches). It is produced in src/mcp/tools.ts and src/interact/fill-text.ts, and fill-verdict.ts.
- Verification: tool-text.ts has no 'NOT verified'; its header says the fill reply moved to interact/fill-text.ts#fillReply (2026-10-09). 'NOT verified' is built in fill-text.ts:191.
- Fix: Cite src/interact/fill-text.ts (fillReply) instead of src/mcp/tool-text.ts.

### F114 · `scripts/truth/replies.ts:246` · confirmed · low

- Reported (misleading, medium, line 246 at the audit): less a full-width chrome at its top or bottom edge (a sticky header, a tab bar, a pinned bar) (live-visibility.ts distanceAt doc; the same is said of showRegion)
- Audit evidence: scripts/truth/live-visibility.ts:263 'if (r === null \|\| c.width < r.width / 2) continue;' skips only chrome narrower than half the clip, so chrome of at least half the clip width is subtracted. The comment says full-width.
- Verification: showRegion skips chrome only when c.width < r.width/2, so chrome at least half the clip width is subtracted; the distanceAt doc says 'full-width'.
- Fix: Say 'chrome at least half the clip's width at its top or bottom edge' (live-visibility.ts distanceAt/showRegion).

### F115 · `scripts/truth/replies.ts:270` · confirmed · low

- Reported (stale-reference, low, line 270 at the audit): (src/interact/tap-judgement.ts:336, "scroll_until it first")
- Audit evidence: tap-judgement.ts:336 is the 'function tapOutcome(' signature. The 'scroll_until it first' remedy is produced at tap-judgement.ts:369, :419, :427, and :447-449.
- Verification: tap-judgement.ts:336 is a stray comment-end line; 'scroll_until it first' is produced at ~375, 396, 404, 424, 426.
- Fix: Cite src/interact/tap-judgement.ts without a line number.

### F116 · `scripts/truth/replies.ts:285` · confirmed · low

- Reported (stale-reference, low, line 285 at the audit): (src/interact/tap-judgement.ts:325, `Aim.moved`)
- Audit evidence: tap-judgement.ts:325 is the opening of a doc comment. The 'at (x,y) — its centre (x,y) is … ; tapped the uncovered part WxH' text (`moved:`) is at tap-judgement.ts:355.
- Verification: tap-judgement.ts:325 is not Aim.moved; Aim.moved is declared at :247 and its text built at :354.
- Fix: Cite tap-judgement.ts#Aim.moved without a line number.

### F121 · `scripts/truth/schema.ts:688` · confirmed · low

- Reported (misleading, low, line 688 at the audit): The principal title (CatalogForm.titleId), its frame and its probe: `reached` when a raw tap at its centre ended the editing (a `focus` event with no field)
- Audit evidence: truth.ts:279-282 readDismissalProbe sets reached only when the focus-with-no-field event AND a touch event are both present ('and delivered'). The schema doc omits the touch condition.
- Verification: schema doc says reached when a raw tap ended editing (focus event with no field), but readDismissalProbe (truth.ts:279-282) also requires a logged touch event, as its own doc says ('and delivered').
- Fix: Add 'and delivered (its touch logged)' to the reached definition.

### F123 · `skill/references/averi-yaml.md:64` · confirmed · low

- Reported (misleading, low, line 64 at the audit): Android: `activity`, `intent: { action, mimeType, extras }`
- Audit evidence: src/flow/config.ts:199-207 (`launchIntent`) accepts five keys: action, data, mimeType, categories and extras, and is `.strict()`. `data` (the URI, the usual way to pick a deep-link entry point) and `categories` are accepted by the schema but missing from the documented shape, so a reader would think a data URI cannot be expressed.
- Verification: config.ts launchIntent (strict) accepts action, data, mimeType, categories, extras; the doc lists only action, mimeType, extras, and averi-yaml.md has no other mention of data or categories.
- Fix: intent: { action, data, mimeType, categories, extras } (all optional; other keys refused).

### F124 · `skill/references/tools.md:40` · confirmed · low

- Reported (misleading, low, line 40 at the audit): Arguments (launch_app): `appId`, `activity`, `intent` (only three listed)
- Audit evidence: src/mcp/tools.ts:297-307 (launch_app) registers `clearState: z.boolean().optional()` as a fourth input, and the description at tools.md line 34 covers its behaviour, but the Arguments list at lines 38-42 omits it. The swipe Arguments list at tools.md line 117 names only `direction`, although src/mcp/tools.ts:452-458 also takes fromX, fromY, toX, toY and durationMs (the coordinate form, which tools.md line 112 describes). The tap Arguments list at tools.md line 106 names only `selector`, but src/mcp/tools.ts:423-426 also takes x and y (tap by coordinates, which tools.md line 79 mentions).
- Verification: tools.ts launch_app takes clearState (not in the Arguments list), tap takes x,y (listed only selector), swipe takes fromX/fromY/toX/toY/durationMs (listed only direction). The prose mentions them but the Arguments lists are incomplete; the file is not generated, no check found.
- Fix: Add clearState to launch_app; x,y to tap; fromX,fromY,toX,toY,durationMs to swipe Arguments.

### F128 · `src/adapters/discovery.ts:66` · confirmed · low

- Reported (misleading, low, line 66 at the audit): `versions: false` leaves every OS version `unknown` — on Android it skips the getprop per attached device
- Audit evidence: listAndroidDevices (discovery.ts:111) reads the getprop only when `versions && state === 'device'`. Offline and unauthorized devices never get a getprop, even with versions on, so the saving is per booted device, not per attached device. The same wording recurs at discovery.ts:73 and discovery.ts:291.
- Verification: discovery.ts:~108 runs the getprop only when `versions && state === 'device'`. Offline and unauthorized devices never get one, so the saving is per device in the `device` state. The wording 'per attached device' recurs at ~73 and ~291.
- Fix: Say 'per booted (state `device`) device' at all three places.

### F129 · `src/adapters/idb-helper.ts:219` · confirmed · low

- Reported (stale-reference, low, line 219 at the audit): the pattern of WdaServer (wda.ts, spawnChild)
- Audit evidence: No symbol `spawnChild` exists anywhere in src or tests (rg finds only this comment). WdaServer is at src/adapters/wda.ts:205, and its exit handling is at wda.ts:796 (child.once('exit')) and wda.ts:817 (process.once('exit', this.exitHook)).
- Verification: grep finds `spawnChild` only in this comment. wda.ts has the child.once('exit') listener (l.796) and a process.once('exit', this.exitHook) hook (l.815-817), which is the pattern meant.
- Fix: Replace '(wda.ts, spawnChild)' with '(wda.ts, WdaServer's child 'exit' listener and its process 'exit' hook)'.

### F134 · `src/adapters/ios.ts:363` · confirmed · low

- Reported (misleading, low, line 363 at the audit): It holds only what this adapter looked up (an idb-source launch — WDA answers a bundle id and is never matched by name; a liveness check; this process)
- Audit evidence: appInfo() is also reached from linkHandler -> urlSchemes -> appInfo (src/adapters/ios.ts:580-581, :611) for every own-scheme link on either tree source, and the foreground check's names() for a WDA link (alertAtBound, ios-foreground.ts:360) also caches. So WDA-source link waits populate the cache too; the "idb-source launch" parenthetical is narrower than what is cached. The statement that WDA answers are never matched by name is correct (ios-foreground.ts:300-304 takes the bundle branch with no names).
- Verification: appInfoCache is also filled by urlSchemes -> this.appInfo(bundleId) (ios.ts:600-611), reached from linkHandler for any own-scheme link on either source. It is also filled by appNames, which the foreground check calls for link waits. So 'an idb-source launch' is narrower than what is cached. The 'WDA is never matched by name' point is correct.
- Fix: Say: 'It holds only the bundles this adapter asked appinfo for: launches (idb source) and own-scheme links, liveness checks, in this process.'

### F135 · `src/adapters/ios.ts:825` · confirmed · low

- Reported (stale-reference, low, line 825 at the audit): ios-tree-source.ts's IOS_ROLE_MAP has no keyboard role
- Audit evidence: IOS_ROLE_MAP is defined in src/adapters/ios-node.ts:30 and only imported by ios-tree-source.ts (line 6) and wda-source.ts:41. ios-tree-source.ts does not define it.
- Verification: IOS_ROLE_MAP is defined and exported in src/adapters/ios-node.ts:30 and only imported by ios-tree-source.ts and wda-source.ts.
- Fix: Change to 'ios-node.ts's IOS_ROLE_MAP'.

### F136 · `src/adapters/simctl-appinfo.ts:26` · confirmed · low

- Reported (stale-reference, low, line 26 at the audit): An octal escape is NOT decoded ... the foreground wait's note (ios-foreground.ts) says so.
- Audit evidence: src/adapters/ios-foreground.ts contains no text mentioning octal or escape sequences (grep for 'octal' and 'escape' returns nothing), so the note the comment points to does not exist.
- Verification: ios-foreground.ts has no text about octal, escapes or decoding. Its only mention of simctl-appinfo (l.32) says the names come from appinfo, with nothing about undecoded escapes. The note the comment points to does not exist.
- Fix: Delete 'and the foreground wait's note (ios-foreground.ts) says so'.

### F138 · `src/adapters/types.ts:263` · confirmed · low

- Reported (stale-reference, low, line 263 at the audit): INPUT_ROLE is read by ... interaction (fill.ts acts on it, fill-text.ts names it in the not-an-input caveat)
- Audit evidence: There is no src/interaction/ directory; the layer is src/interact/ (directory listing of src: adapters, flow, interact, mcp, run, ui-tree, util, verify). The fill code is interact/fill.ts.
- Verification: There is no src/interaction/ directory. src has adapters, flow, interact, mcp, run, ui-tree, util and verify, and the fill code is in interact/. The comment names the layer 'interaction'.
- Fix: Replace 'interaction' with 'interact/'.

### F139 · `src/adapters/types.ts:389` · confirmed · low

- Reported (misleading, low, line 389 at the audit): ui-tree/draw-order.ts's CONTENT_FRAMED_ROLES would start excusing those frames
- Audit evidence: CONTENT_FRAMED_ROLES is defined in src/ui-tree/placed.ts:115 (export const CONTENT_FRAMED_ROLES = new Set(['scrollable'])) and imported from placed.js by ui-tree/presentation.ts:3. draw-order.ts does not define it. The same misattribution appears in ui-tree/scroll-containers.ts:45.
- Verification: CONTENT_FRAMED_ROLES is exported from src/ui-tree/placed.ts:115 and imported by presentation.ts. draw-order.ts only mentions it in a comment (l.751). The same misattribution is at scroll-containers.ts:45.
- Fix: Replace with 'ui-tree/placed.ts's CONTENT_FRAMED_ROLES'.

### F140 · `src/adapters/types.ts:574` · confirmed · low

- Reported (stale-reference, low, line 574 at the audit): docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md (its amendment "a side cut at the screen's edge")
- Audit evidence: The ADR's heading is "## Amendment: a side uiautomator cut at the screen's edge (2026-10-31, performance backlog D17)" (docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md:402). The quoted title is missing the word "uiautomator".
- Verification: ADR 0021:402 is headed 'Amendment: a side uiautomator cut at the screen's edge'. The quoted title in types.ts drops the word 'uiautomator'. The pointer still resolves, so the harm is small.
- Fix: Quote 'a side uiautomator cut at the screen's edge'.

### F144 · `src/adapters/wda-source.ts:685` · confirmed · low

- Reported (false, low, line 685 at the audit): the measured bands are 38–41 % of an 874-pt screen (335, 308, 356 pt)
- Audit evidence: 335/874 = 38.3 %, 308/874 = 35.2 %, 356/874 = 40.7 %. The 308-pt band in the same comment (wda-source.ts:717) is 35 %, so the range is 35–41 %.
- Verification: 335/874 = 38.3 %, 308/874 = 35.2 %, 356/874 = 40.7 %. The range '38-41 %' leaves out the 308 pt band that the same comment lists, so the range is 35-41 %.
- Fix: Say '35-41 % of an 874-pt screen (335, 308, 356 pt)'.

### F150 · `src/adapters/wda.ts:641` · confirmed · low

- Reported (false, low, line 641 at the audit): stderr is the sanctioned channel (server.ts logs there too).
- Audit evidence: src/mcp/server.ts (23 lines) contains no console or process.stderr call. Stderr logging lives in other modules (src/flow/load.ts, src/adapters/ios.ts, src/adapters/ios-tree-source.ts).
- Verification: src/mcp/server.ts has no console or stderr call (read in full; it only wires the registry, lifecycle and stdio transport). The parenthetical is false.
- Fix: delete the parenthetical '(server.ts logs there too)'.

### F154 · `src/flow/engine.ts:185` · confirmed · low

- Reported (false, low, line 183 at the audit): n states each with two rungs requiring the next costs 2^(n+1)−3 reads, 253 at n = 6
- Audit evidence: At n = 6, 2^(6+1) − 3 = 125, not 253. 253 equals 2^(6+2) − 3, so the formula and the number disagree with each other.
- Verification: 2^(6+1)-3 = 125, not 253; 253 = 2^8-3. The formula and number disagree. tests/flow/engine.test.ts only asserts reads < 20 for a 3-state loop, so I could not verify which of the two is the measured one.
- Fix: Reconcile: either 2^(n+2)-3 (253 at n=6) or 125 at n=6; re-derive from the measurement.

### F155 · `src/flow/engine.ts:346` · confirmed · low

- Reported (stale-reference, low, line 344 at the audit): the wait after the reach flows AND the second look before a destructive rung (see the refusal comment in ensureStateInner)
- Audit evidence: ensureStateInner (src/flow/engine.ts:617-620) is a three-line delegate with no refusal comment. The comment about the destructive-rung refusal and the second look sits in ensureStateLadder (src/flow/engine.ts:806-861).
- Verification: ensureStateInner (engine.ts:627) is a two-line delegate to ensureStateLadder (:691), which holds the destructive-rung refusal and second-look code (~806-830).
- Fix: see the refusal comment in ensureStateLadder

### F158 · `src/interact/course.ts:98` · confirmed · low

- Reported (false, low, line 98 at the audit): never more than PROBE_MAX_TRAVEL_FRACTION of the screen's long side: 178 px on the Pixel_3a
- Audit evidence: course.ts:144 sets PROBE_MAX_TRAVEL_FRACTION = 0.08 and course.ts:694 computes cap = Math.floor(0.08 * max(width,height)) = Math.floor(177.6) = 177 for the 2220-px Pixel_3a. tests/interact/scroll.test.ts:598 states the cap as 177 px and scroll.test.ts:851 expects a 177 px stroke, so the 178 figure in the comment is wrong. Outside the assigned bucket; found while checking the scroll test.
- Verification: course.ts:694 computes Math.floor(0.08 * max(w,h)) = floor(177.6) = 177 for a 2220-px side; scroll.test.ts:599 and :864 state 177.
- Fix: Change 178 px to 177 px.

### F159 · `src/interact/course.ts:418` · confirmed · low

- Reported (misleading, low, line 418 at the audit): lastPast: "The far edge of the caller's direction when the last read that found the target found it wholly beyond it"
- Audit evidence: src/interact/course.ts:545-546 computes `const { far } = FAR_EDGE[way]` with `way = courseOf(m)` (line 537), and courseOf returns the end turn's `to` once an end turn exists (line 469). After an end turn the stored far edge is the course's, not the caller's, direction.
- Verification: course.ts:541-546 uses way = courseOf(m), which is the end turn's `to` once one exists (:469); lastPast stores FAR_EDGE[way].far. After the end turn it is the opposite side to the caller's direction.
- Fix: The far edge of the course's direction (the caller's until the end turn, then its opposite) when the last read ...

### F160 · `src/interact/course.ts:517` · confirmed · low

- Reported (stale-reference, low, line 517 at the audit): Dropped (the lazy-list note, scroll-rounds.ts#UNMOVED_STROKES_EXHAUST's)
- Audit evidence: src/interact/scroll-rounds.ts:602 defines UNMOVED_STROKES_EXHAUST = 2, the count of the last strokes that changed nothing (its doc, lines 590-601, is about unmoved strokes and bouncing lists). It is not the lazy-list note; the lazy-list wording is in scroll-text.ts:1287-1295.
- Verification: UNMOVED_STROKES_EXHAUST (scroll-rounds.ts:587) is documented around unmoved strokes, blank viewports and rebound/bouncing lists, not the lazy-list drop. The lazy-list wording is in scroll-text.ts (~1287) and scroll-rounds.ts:1480.
- Fix: Drop the attribution, or point at interact/scroll-text.ts / the lazy-list note at scroll-rounds.ts:1480.

### F161 · `src/interact/course.ts:603` · confirmed · low

- Reported (misleading, low, line 603 at the audit): "...is the caller's direction to honour — until ... one any of which lies in the frame is not (`seeTarget`'s `atFarEdge`, below)."
- Audit evidence: src/interact/course.ts:603-605 is garbled: "one any of which lies in the frame" has no antecedent. The rule it intends (a target beyond the far edge in every frame it was judged in is not turned for, unless a frame shows it inside, which atFarEdge handles) can be read as the opposite. The code is at src/interact/course.ts:541 and :568.
- Verification: Read the paragraph: 'one any of which lies in the frame is not' has no antecedent (edit residue) and obscures that a target lying in a frame is not turned for, which matches code at course.ts:541 (beyondFarEdgeIn across every frame) and atFarEdge.
- Fix: A target read wholly beyond the far edge in every frame judged is the caller's direction to honour until the end turn; a target lying in any frame is not (seeTarget's atFarEdge, below).

### F163 · `src/interact/fill-reformat.ts:17` · confirmed · low

- Reported (false, low, line 17 at the audit): Exported for one test: fill-text.ts's `separated` sentence lists them, and the test pins that the two agree (D53).
- Audit evidence: SEPARATORS is imported by tests/interact/fill-text.test.ts:4 (the pin at :458-460) and by tests/interact/fill-landing.test.ts:4. That is two test files, not one.
- Verification: SEPARATORS is imported by both tests/interact/fill-text.test.ts:4 (pin at :458) and tests/interact/fill-landing.test.ts:4 (used at :939). 'One test' is wrong.
- Fix: Exported for the tests: fill-text.test.ts pins it against the `separated` sentence (D53); fill-landing.test.ts also uses it.

### F165 · `src/interact/fill-text.ts:288` · confirmed · low

- Reported (false, low, line 288 at the audit): The message of an error fillField throws — every one of them, worded here with the rest
- Audit evidence: src/interact/fill.ts:173-176 throws new FillValueFailure(errorMessage(e), 'refused') for a refused value, and the comment at fill.ts:173-175 says 'the message is type-text.ts's'. Those words are not in fill-text.ts. fill-text.ts's FAILURE_SENTENCE table covers only the three FillFailure codes that fill.ts:491 routes through fillFailureText.
- Verification: fillField also throws FillValueFailure(errorMessage(e),'refused') at fill.ts:154 whose message is type-text.ts's (comment at fill.ts:150). fillFailureText is only used at fill.ts:400 for the 'did-not-land' failures, so 'every one of them' is false.
- Fix: 'The message of each did-not-land FillFailure fillField throws (a refused value keeps type-text.ts's words).'

### F173 · `src/interact/scroll-read.ts:70` · confirmed · low

- Reported (false, low, line 70 at the audit): Five fields.
- Audit evidence: The RoundRead interface at scroll-read.ts:76-99 has six members: tree, found, cover?, ofKeyboard, remedy and seen?. The same paragraph also names 'the judged screen' as a RoundRead input, but that is not a RoundRead member; the screen is RoundSeen.screen (scroll-rounds.ts:170).
- Verification: RoundRead (scroll-read.ts:76-98) has six members: tree, found, cover?, ofKeyboard, remedy, seen?. The paragraph also lists 'the judged screen', which is not a member.
- Fix: Drop 'Five fields.' and 'the judged screen' from the list, or say six.

### F174 · `src/interact/scroll-read.ts:127` · confirmed · low

- Reported (misleading, low, line 127 at the audit): A cheap fingerprint of the WHOLE tree (ui-tree/read-tree.ts#treeFingerprint) — every node's role, text, id and rect
- Audit evidence: The treeFingerprint doc at src/ui-tree/read-tree.ts:474-478 says it hashes role, label, identifier, value and rect per node. The scroll-read.ts description omits value and says 'text' where the function uses label.
- Verification: treeFingerprint feeds saysOf(n) plus rect (read-tree.ts:511); saysOf is documented as role, label, identifier and value (read-tree.ts:516). The comment says 'text' and omits value.
- Fix: 'every node's role, label, identifier, value and rect'

### F183 · `src/interact/tap-judgement.ts:331` · confirmed · low

- Reported (doc-contradicts-code, medium, line 330 at the audit): `judgedScreen` is asked on the first row only — which `aim` never reaches at runtime — its standing passed the on-screen rule
- Audit evidence: offTheScreen (tap-judgement.ts:264) excludes standings with outsideItsScrollView, so those are judged by TapJudge.aim (lines 280-291) and reach tapOutcome's 'offScreen'/'systemBar' case (lines 339-341), which calls judgedScreen() eagerly. The module doc at lines 258-262 and 53-64 says the same outside-its-scroll-view standings are refused by aim. offScreenRefusal (lines 414-421) returns before reading `judged`, so on that path the screen is computed and not used. The comment also says judgeTap acts on the first row itself, but the same row reaches aim for outside-scroll-view standings.
- Verification: tap-judgement.ts:331-332 says 'aim never reaches' the first row. offTheScreen (line 265) excludes outsideItsScrollView standings, so aim does reach the offScreen/systemBar case for those (line 342). There offScreenRefusal returns before using `judged` (line 391). The comment is true only for off-the-screen standings that offTheScreen accepts.
- Fix: Reword: judgedScreen is asked on the offScreen/systemBar row. aim reaches it only for a standing outside its scroll view, where the screen is unused.

### F185 · `src/interact/tap.ts:76` · confirmed · low

- Reported (stale-reference, low, line 67 at the audit): which forced the platform layer to import the selector layer above it (ARCHITECTURE.md §3)
- Audit evidence: ARCHITECTURE.md §2 spans lines 23-84 and §3 starts at line 85. The statement about the platform layer importing the selector layer is at ARCHITECTURE.md:79, under §2.
- Verification: The tap.ts comment cites ARCHITECTURE.md §3. The platform-layer-imported-the-selector-layer text is at ARCHITECTURE.md:104, in §2 (lines 37-349). §3 starts at line 350 and is the Device Adapter layer.
- Fix: Change to (ARCHITECTURE.md §2).

### F187 · `src/interact/type-text.ts:40` · confirmed · low

- Reported (misleading, low, line 40 at the audit): is refused here too, by the same callers, before the same nothing.
- Audit evidence: The sentence is garbled: the refusal happens in assertTypeable, which runs in typeIntoFocused (type-text.ts:82-85) and in fillField before the field is resolved (fill.ts:168-176). Nothing is sent to the device in either case, so the intended claim is 'before any device call'.
- Verification: type-text.ts:38-40 reads 'refused here too, by the same callers, before the same nothing'. The phrase is garbled. The intended meaning is before any device call, as the ADR title says.
- Fix: Replace 'before the same nothing' with 'before any device call'.

### F188 · `src/mcp/tools.ts:527` · confirmed · low · orchestrator-checked

- Reported (doc-contradicts-code, medium, line 497 at the audit): Types printable ASCII, and under `ios.treeSource: wda` also Latin, Greek, Cyrillic and Han letters
- Audit evidence: The config key is app.ios.treeSource: tools.ts:196, tools.ts:378 and tools.ts:419 all say `app.ios.treeSource`, and flow/config.ts:87-88 reads treeSource off the app.ios block (`ios?.keyboardDismiss`, `ios.treeSource`). A top-level `ios.treeSource` key is not the setting, so an agent following this description writes the wrong averi.yaml key.
- Verification: The tools.ts:527 description says `ios.treeSource: wda`. The config key is app.ios.treeSource, as tools.ts:214 says and as flow/config.ts uses it (the ios block under app). Other config.ts messages use the bare 'treeSource: wda' as shorthand, but the tool description is read by agents.
- Fix: Use `app.ios.treeSource: wda`.

### F190 · `src/run/verify.ts:314` · confirmed · low

- Reported (misleading, low, line 437 at the audit): Doc block 'The contract file the request names, read and parsed' (cwd resolution, error wrapping, contract+contractPath refusal) documents the function that follows it
- Audit evidence: The block at 437-459 is directly followed by the readFailure doc (460-466), so it attaches to READ_FAILURES/readFailure. loadContract (line 478), the function it describes, has no doc at all.
- Verification: The 'contract file the request names' doc block (run/verify.ts:313-334, now shifted) is immediately followed by the READ_FAILURES/readFailure doc block, so it attaches to READ_FAILURES. loadContract at about line 358 has no doc of its own.
- Fix: Move the contract-file block directly above `async function loadContract`; keep the 'Why a file read failed' block above READ_FAILURES.

### F196 · `src/ui-tree/draw-order.ts:1622` · confirmed · low

- Reported (misleading, low, line 1622 at the audit): Doc block 'The draw order of `tree`: one pre-order walk when called; each answer a scan of it. The tree must not change while the answer is in use.'
- Audit evidence: The block sits directly above the OWN_BRANCH_SCREEN_FRACTION doc (1626-1634), so it attaches to nothing relevant. The real drawOrder declaration (line 1682) has its own doc at 1678-1681, which does not carry the walk or the mutation warning.
- Verification: The doc 'The draw order of `tree`: one pre-order walk ... must not change' (1622-1625) is stacked directly above the OWN_BRANCH_SCREEN_FRACTION doc, so it documents nothing. drawOrder at about 1682 has its own doc, which lacks the walk and mutation notes.
- Fix: Move the one-walk and must-not-change sentences into drawOrder's doc and delete the orphan block.

### F200 · `src/ui-tree/geometry.ts:12` · confirmed · low

- Reported (stale-reference, low, line 12 at the audit): 'The viewport predicates (intersectsViewport, absentFromViewport, visibleFractionInViewport, clippedEdges) are here too, at the end of the file' (lines 12-13)
- Audit evidence: Those predicates are at geometry.ts:449-663. The file continues to line 1477 with the rect identity block, clipsOf, evidentCut, cutAtScreenEdges and screenOf.
- Verification: geometry.ts:12-13 says the viewport predicates are 'at the end of the file', but they sit mid-file (about 449-663) and the file continues to ~1477 with clipsOf, screenOf, flatListBarLine etc.
- Fix: Drop 'at the end of the file' (or say 'after the screen-size section').

### F202 · `src/ui-tree/geometry.ts:681` · confirmed · low

- Reported (misleading, low, line 681 at the audit): Clips' description ('What a tree's CLIPPING says of its nodes (`clipsOf`), from one walk ...') sits directly above the ListedScrollView doc (line 687), so export interface Clips (line 693) has no attached JSDoc
- Audit evidence: geometry.ts:681-686 is a dangling JSDoc block immediately followed by another JSDoc block (687-688, ListedScrollView). Clips is declared at line 693 with no doc comment.
- Verification: geometry.ts:681-686 is a JSDoc block immediately followed by the ListedScrollView JSDoc (687); the Clips interface at ~693 has no doc attached, and the first block is dangling.
- Fix: Move the 'What a tree's CLIPPING says...' block to directly above `export interface Clips`.

### F204 · `src/ui-tree/keyboard-cover.ts:46` · confirmed · low

- Reported (false, low, line 46 at the audit): Its interface, eight exports: readKeyboard and the KeyboardReading it builds; ... and the verdicts its point questions answer (FrameVerdict, Uncovered, KeyboardVerdict, Covering)
- Audit evidence: The file exports ten names: FrameVerdict (105), Uncovered (114), KeyboardVerdict (128), Covering (131), KeyboardCover (134), UNLOCATED_KEYBOARD (158), KeyboardReading (163), RegionRefusal (248), panelsBeyond (316), readKeyboard (435). The doc's list omits RegionRefusal and panelsBeyond.
- Verification: keyboard-cover.ts exports ten names: FrameVerdict, Uncovered, KeyboardVerdict, Covering, KeyboardCover, UNLOCATED_KEYBOARD, KeyboardReading, RegionRefusal, panelsBeyond, readKeyboard. The doc lists only eight; RegionRefusal (248) and panelsBeyond (316) are omitted.
- Fix: 'ten exports' and add RegionRefusal and panelsBeyond (exported for scripts/truth/live-forms.ts).

### F205 · `src/ui-tree/keyboard-cover.ts:90` · confirmed · low

- Reported (stale-reference, low, line 90 at the audit): ...and as asks in scroll-rounds.test.ts.
- Audit evidence: The file is tests/interact/scroll-rounds.test.ts (sibling of tests/interact/scroll.test.ts, which the same sentence names with its directory). The bare name does not resolve from the repo root.
- Verification: The file is tests/interact/scroll-rounds.test.ts (exists); the comment writes the bare name while the sibling scroll.test.ts is given with its directory.
- Fix: Write tests/interact/scroll-rounds.test.ts.

### F208 · `src/ui-tree/masked-value.ts:19` · confirmed · low

- Reported (stale-reference, low, line 19 at the audit): Tree vocabulary, so it lives with the tree (ARCHITECTURE.md §3)
- Audit evidence: ARCHITECTURE.md:79 states the vocabulary rule ('flow/config.ts had become the de-facto home of vocabulary') inside §2 (High-level architecture, starts line 23). §3 is 'Device Adapter layer' (ARCHITECTURE.md:85).
- Verification: ARCHITECTURE.md §3 (line 350) is 'Device Adapter layer'. The ui-tree layer and the vocabulary rule live in §2 (the 'UI tree (ui-tree/)' subsection at line 134 and the rule near line 105).
- Fix: '(ARCHITECTURE.md §2, UI tree)'.

### F209 · `src/ui-tree/miss.ts:41` · confirmed · low

- Reported (stale-reference, low, line 41 at the audit): Not where the reader has already stroked that list (`scrolled`: `scroll_until`'s own stop, ADR 0018 decision 3)
- Audit evidence: In docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md the rule 'Not where the reader has stroked that list' is decision 4 of the 2026-10-24 amendment (line 1260 '4. A presented window that holds a scroll view of its own: the scroll first', line 1266 'Not where the reader has stroked that list'). Decision 3 there is 'Asked on a miss only' (line 1249).
- Verification: ADR 0018's 2026-10-24 amendment decision 4 (line ~1261) holds 'Not where the reader has stroked that list already'; decision 3 there is 'Asked on a miss only'. Residual 18 also cites 'that amendment's decision 4'.
- Fix: 'ADR 0018, 2026-10-24 amendment, decision 4'.

### F212 · `src/ui-tree/read-tree.ts:52` · confirmed · low

- Reported (misleading, low, line 52 at the audit): Opted into by the one-shot MCP tools only.
- Audit evidence: The only caller of uiTree({ settle: true }) in src is the ui_snapshot tool (src/mcp/tools.ts:393). 'tools' plural overstates it, though no other one-shot tool opts in.
- Verification: The only src caller of uiTree({ settle: true }) is the ui_snapshot handler (mcp/tools.ts:425); the plural 'one-shot MCP tools' overstates it.
- Fix: 'Opted into by the one-shot ui_snapshot tool only (mcp/tools.ts).'

### F213 · `src/ui-tree/read-tree.ts:108` · confirmed · low

- Reported (stale-reference, low, line 108 at the audit): the rule was written out three times (pollUntil, scrollUntilVisible, Verifier.tryReadTree)
- Audit evidence: `tryReadTree` occurs in no file other than this comment (grep over src/tests/scripts). Verifier now polls through its private `poll` (src/verify/assert.ts:566), and pollUntil is src/flow/engine.ts:1774.
- Verification: `tryReadTree` appears nowhere in src, tests, scripts or docs except this comment. pollUntil exists in flow/engine.ts, so the historical list is partly stale.
- Fix: Drop the historical list, or name current loops (FlowEngine.pollUntil, scrollUntilVisible, Verifier's poll).

### F215 · `src/ui-tree/scroll-containers.ts:45` · confirmed · low

- Reported (stale-reference, medium, line 45 at the audit): NOT a scroll predicate: draw-order.ts's CONTENT_FRAMED_ROLES.
- Audit evidence: CONTENT_FRAMED_ROLES is exported from src/ui-tree/placed.ts:115 (= new Set(['scrollable'])). draw-order.ts mentions it only in comments (e.g. draw-order.ts:751). placed.ts:10 also names it as a placed.ts predicate.
- Verification: CONTENT_FRAMED_ROLES is exported from ui-tree/placed.ts:115 and used in presentation.ts and placed.ts. draw-order.ts only mentions it in a comment (line ~751), so 'draw-order.ts's' and 'kept in draw order' are stale.
- Fix: 'placed.ts's CONTENT_FRAMED_ROLES' and 'kept with the placed frame predicates'.

### F221 · `src/ui-tree/soft-keyboard.ts:80` · confirmed · low

- Reported (false, low, line 80 at the audit): Measured on the 207 flat idb trees ... the 14 with a keyboard — run2 #250, run3 #45–#51, run7 #96, run8 #233, run9 #87, #95, #184, #246, #420
- Audit evidence: The enumerated list names 15 trees: #250 (1), #45–#51 (7), #96 (1), #233 (1), #87, #95, #184, #246, #420 (5). The stated count of 14 contradicts the list on the same lines (80-83).
- Verification: soft-keyboard.ts:80-83 says 'the 14 with a keyboard' but lists #250 (1), #45-#51 (7), #96, #233 (2), #87, #95, #184, #246, #420 (5), which is 15. The count and the list disagree (the '193 none' figure is also tied to 207-14).
- Fix: Verify against the run data, then make the count and the list agree (15 and 192, or drop one entry).

### F235 · `src/verify/ocr-fold.ts:97` · confirmed · low

- Reported (misleading, low, line 97 at the audit): `[^’]` is `(?:(?![\'])[^’])`
- Audit evidence: foldClass builds the added member with classMember (ocr-fold.ts:70), which escapes only ] \ ^ -. The apostrophe is emitted bare, so the output is `(?:(?!['])[^’])` (ocr-fold.ts:253-254). The semantics match; the quoted string does not.
- Verification: ocr-fold.ts:70 classMember escapes only ] \ ^ -, and :253-254 emits the extra class bare, so the output is `(?:(?!['])[^’])`. The sibling example in the same block (`(?:[’ -]\|['])`) shows the apostrophe bare. The `[\']` in the comment is not what is produced, though it is semantically equal.
- Fix: Write `[^’]` is `(?:(?!['])[^’])`.

### F236 · `src/verify/ocr.ts:90` · confirmed · low

- Reported (stale-reference, medium, line 90 at the audit): "Not a SetupError (flow/errors): the assert fails closed with it as a reason"
- Audit evidence: There is no src/flow/errors.ts. SetupError is declared at src/flow/config.ts:649 (export class SetupError extends Error). The claim that OcrUnavailableError is not a SetupError is still true; the path is wrong.
- Verification: src/flow has no errors.ts (condition, config, credentials, engine, hold-tracker, launch, load, tool-config, wipes-ahead). SetupError is declared at src/flow/config.ts:581, not 649 as the evidence says. The substance (OcrUnavailableError is not a SetupError) is right; only the path is a dead pointer.
- Fix: Change "(flow/errors)" to "(flow/config.ts)".

### F247 · `src/verify/text-parity.ts:1042` · confirmed · low

- Reported (misleading, low, line 1042 at the audit): Only the recognizer call is caught.
- Audit evidence: The try block at text-parity.ts:1056-1058 wraps `await shot.png()` as well as `engine.recognize(...)`, so a PNG-encoding failure is also caught and reported as 'OCR failed'.
- Verification: The try block at text-parity.ts:1056-1058 wraps `await shot.png()` as well as `engine.recognize(...)`, so an encoding failure is caught and reported as "OCR failed". The comment says only the recognizer call is caught.
- Fix: Say "Only the OCR work — encoding the frame and the recognizer call — is caught."

### F248 · `src/verify/text-parity.ts:1045` · confirmed · low · orchestrator-checked

- Reported (false, medium, line 1045 at the audit): The frame's scale note rides along on every verdict, before the fail-closed tail when there is one.
- Audit evidence: measureOcrAssert (text-parity.ts:1053-1054) returns failClosed(error) with no note when ocrRegionForRect gives no region; the recognizer-throw path (1057-1060) returns failClosed(`OCR failed: ...`) without notes. Only the read.error path (1064) and evaluateOcrAssert (1066) carry notes.
- Verification: measureOcrAssert returns failClosed(error, ...) without the scale note when no region exists (line ~1053-1054) and failClosed(`OCR failed: ...`) without notes on a recognizer throw. Only read.error and evaluateOcrAssert (the latter via notes) carry the note, so "on every verdict" is false.
- Fix: Say "The frame's scale note rides along on the verdicts built from a recognizer reading (an errored read, or an evaluated one), before the fail-closed tail when there is one; the no-region and recognizer-throw verdicts carry none."

### F252 · `tests/flow/config.test.ts:187` · confirmed · low

- Reported (misleading, low, line 187 at the audit): its machine-readable flows are the docs' yaml examples. Every one that holds whole flows ... parses
- Audit evidence: The test at config.test.ts:199 scans only README.md, SETUP.md, ARCHITECTURE.md and skill/SKILL.md. docs/verification.md:31-43 contains a whole-flows ```yaml block (`flows:` with a `steps:` list of mappings), which isWholeFlowsExample (config.test.ts:192-197) would accept, and no test reads it. The comment therefore overstates coverage of the docs' examples.
- Verification: The it.each at config.test.ts:218 covers only README.md, SETUP.md, ARCHITECTURE.md and skill/SKILL.md. docs/verification.md:31-43 has a whole-flows yaml block (flows with a steps list of mappings) that isWholeFlowsExample would accept and no test reads. skill/references/averi-yaml.md is described as fragments in the comment. "The docs' yaml examples" overstates coverage.
- Fix: Add docs/verification.md to the it.each list, or say "the yaml examples in README.md, SETUP.md, ARCHITECTURE.md and skill/SKILL.md".

### F253 · `tests/helpers/exec-error.ts:7` · confirmed · low

- Reported (stale-reference, low, line 7 at the audit): when the child wrote nothing to stderr, `exec.ts:60` substitutes node's `err.message`
- Audit evidence: The substitution is in src/adapters/exec.ts:123-126 (nodeLineShown; stderrText \|\| nodeLineShown). exec.ts:60 is failureMessage(), which does not substitute anything.
- Verification: The stderr substitution is in src/adapters/exec.ts:123-126 (nodeLineShown; `stderrText \|\| nodeLineShown`). exec.ts:60 is failureMessage(), which substitutes nothing.
- Fix: Cite `exec.ts` `exec()` (nodeLineShown fallback) with no line number.

### F254 · `tests/helpers/fake.ts:396` · confirmed · low

- Reported (false, low, line 396 at the audit): The guard's settle options ... the two keyboard-*.test.ts files share it (fill.test.ts keeps an identical one of its own)
- Audit evidence: FAST is imported from tests/helpers/fake.js by three files: tests/interact/keyboard-dismissal.test.ts:13, tests/interact/keyboard-in-tree.test.ts:9, tests/interact/keyboard-window.test.ts:9.
- Verification: FAST is imported from helpers/fake.js by three keyboard files (keyboard-dismissal.test.ts:13, keyboard-in-tree.test.ts:9, keyboard-window.test.ts:9), and also by ios.test.ts and look-scene.test.ts. The claim that fill.test.ts keeps its own identical copy is true (fill.test.ts:35).
- Fix: Say 'the keyboard-*.test.ts files in tests/interact (and others) share it'.

### F257 · `tests/helpers/rounds.ts:176` · confirmed · low

- Reported (misleading, low, line 176 at the audit): The stop, when a row ended the scroll (the last row must).
- Audit evidence: play() (rounds.ts:195-222) throws only when a row comes after a stop (line 196). It never checks that the last row produced a stop; it returns outcome undefined (line 223). resultOf/failureOf (lines 227-237) are the checks that fail when no stop exists.
- Verification: play() only throws when a row comes after a stop (`play: row i after the stop`). It never requires that the last row stops, and outcome stays undefined otherwise. Only resultOf/failureOf throw when there is no stop.
- Fix: The stop, when a row ended the scroll; undefined when none did (resultOf/failureOf throw then).

### F262 · `tests/truth/calibration.test.ts:232` · confirmed · low

- Reported (stale-reference, low, line 232 at the audit): the committed report (docs/truth/calibration.md, which step 8's calibrate run writes)
- Audit evidence: A grep of the whole repo for "step 8" finds no referent other than this comment. The report is written by scripts/truth/calibrate.ts (its --out default is docs/truth/calibration.md, calibrate.ts:44), and the file has no numbered steps.
- Verification: 'step 8' has no referent anywhere in the repo. The report is written by scripts/truth/calibrate.ts (--out default docs/truth/calibration.md), and docs/truth/calibration.md has no numbered steps.
- Fix: Replace 'step 8's calibrate run' with 'the calibrate run (scripts/truth/calibrate.ts)'.

### F270 · `tests/verify/scale.test.ts:142` · confirmed · low

- Reported (stale-reference, low, line 142 at the audit): production captures come from `adapter.screenshot()`, which is always the whole screen
- Audit evidence: src/verify/shot.ts:92-93 captureShot uses adapter.capture() whenever it is defined; src/adapters/android.ts:523 defines capture(), so Android production captures go through capture(), not screenshot(). The premise (whole screen) still holds, but the named method is wrong.
- Verification: src/verify/shot.ts captureShot uses adapter.capture() whenever it is defined, and android.ts:487 defines capture(), so Android production captures do not go through `screenshot()`. The whole-screen premise still holds. The comment dates from 2026-08-27 and the capture path came later.
- Fix: Say 'production captures come from captureShot (adapter.capture() or screenshot()), always the whole screen'.

## Partly confirmed (89)

### F052 · `fixtures/apps/rn/src/lab.ts:111` · partly · medium

- Reported (misleading, medium, line 111 at the audit): A view's frame on the screen, in layout units (measureInWindow: ...); and at line 142: The keyboard's end frame in layout units, screen coordinates
- Audit evidence: lab.ts:73-78 toState() converts layout points/dp to state units (pixels on Android, unchanged on iOS); frame() at lab.ts:112-116 stores toState(r), and keyboard() at lab.ts:144 stores toState(end). lab.ts:13-15 and lab.ts:69 say the state is in pixels on Android. So the stored values are state units, not layout units.
- Verification: frame() and keyboard() take rects in layout units but store toState(r), which is pixels on Android and unchanged on iOS. The doc's 'in layout units' is true of the argument, not of what lands in the state, and lab.ts:13 says state units are pixels on Android. Readers of the state would be misled.
- Fix: 'A view's frame (measureInWindow, layout units) stored in the state's units (points on iOS, screen pixels on Android).' Do the same for keyboard().

### F125 · `skill/references/troubleshooting.md:79` · partly · medium · orchestrator-checked

- Reported (misleading, medium, line 79 at the audit): `⚠ fill … typing APPENDS`: the field already held text and `clear` was off. The length check passed, but the content may be wrong.
- Audit evidence: The only code that emits an append caveat is the masked-field one. src/interact/fill.ts:282-287 sets `maskedAppend` only when `isMaskedValue(preText)` (a password field holding bullets). src/interact/fill-verdict.ts:197 turns it into a caveat, and src/interact/fill-text.ts:276 words it 'masked field already held N … and clear is not set — typing APPENDS'. A plain (non-masked) field that already held text and was filled without clear emits no such ⚠ line. Its fill is judged by the read-back (the value itself, or the value within what was typed), per skill/references/averi-yaml.md and docs/verification.md's fill section, so 'the length check passed' is not how it is decided.
- Verification: The 'typing APPENDS' caveat is emitted only for masked fields (fill.ts maskedAppend, fill-verdict.ts:197, fill-text.ts:276 'masked field already held ...'). The troubleshooting entry says 'the field already held text', hiding that it is masked-only; 'length check passed' is accurate for masked fields (compared by length).
- Fix: `⚠ fill … typing APPENDS` (masked/password fields only): the field already held N characters and `clear` was off; the read-back compares by length and cannot see content. Add `clear: true` unless a pre-filled value must survive.

### F005 · `ARCHITECTURE.md:357` · partly · low

- Reported (doc-contradicts-code, low, line 96 at the audit): interface DeviceAdapter { ... screenshot(): Png ... tap(x, y): void ... uiTree(opts?: {settle?}): UiNode ... logs(since): string[] ... openDeepLink(url): AppHolder
- Audit evidence: Every method is async in src/adapters/types.ts: `screenshot(): Promise<Buffer>` (line 48), `tap(x, y): Promise<void>` (line 104), `uiTree(opts?: { settle?: boolean }): Promise<UiNode>` (line 75), `logs(sinceMs: number): Promise<string[]>` (line 248), `openDeepLink(url, opts?)` (line 23) takes an options argument the doc omits. The doc's `Png` type is not the return type either. The same applies to the doc lines 90-112 members with plain `void` or `T` returns.
- Verification: The sketch exists (ARCHITECTURE.md:355-377) and does differ from src/adapters/types.ts: screenshot(): Promise<Buffer> (1178), openDeepLink(url, opts?: DeepLinkOptions): Promise<AppHolder> (1153), logs(sinceMs): Promise<string[]> (1378). But it is introduced as 'The interface, in short' (a sketch pointing to types.ts as the contract), so dropping Promise is harmless imprecision, not a contradiction. Line number was off (actual ~362).
- Fix: Optional one-line note under the sketch: 'sketch: every member is async (Promise), screenshot returns a Buffer; types.ts is the contract'. Otherwise leave.

### F014 · `docs/adr/0015-flat-list-reading-order-break.md:32` · partly · low

- Reported (misleading, low, line 32 at the audit): In a flat list (`UiNode.flatList`), the first node listed after a CONTENT target whose top lies ABOVE the target's top is where idb resumes listing another container (`readingBreak`).
- Audit evidence: src/ui-tree/draw-order.ts:1611-1620 (readingBreak) also requires the node to have area, to end BELOW the top bar's line (`node.rect.y + node.rect.height > barLine`), and not to hold the target whole (`!rectWithin(t, node.rect)`). The Decision text states only the top-above condition plus the bottom-chrome exception, so a node inside the top bar's band or one enclosing the target would be read as a break by a reader of the ADR.
- Verification: readingBreak (draw-order.ts:1611-1620) does also require node.rect.y+height > barLine and !rectWithin(t, node.rect), which the ADR Decision omits (its text mentions only top-above, bottom chrome and 'Nodes of no area never break', so the finding's 'no area' point is already there). The omission is real but the ADR is a decision record that cites flatListReadingOrder as the row; imprecision, not a wrong statement.
- Fix: Add to the Decision: '...and that is not one ending inside the top bar's band (`barLine`) nor one that holds the target whole.'

### F018 · `docs/adr/0020-the-truth-outranks-a-hand-written-expectation.md:3` · partly · low

- Reported (misleading, low, line 3 at the audit): Status: proposed, 2026-10-15 (phase 0 of docs/plans/2026-10-15-ground-truth-lab-app.md: "Q3 in code, principle in an ADR"; written on review round 1 of the lab branch, for the owner to accept).
- Audit evidence: The ADR is implemented and treated as the in-force rule: scripts/differential/ratchet.ts:8 ("golden's ratchet (docs/adr/0020)"), scripts/truth/live-known.ts:8 ("ADR 0020 §4"), scripts/differential/README.md:104 ("The golden mode judges ONE side against ground truth (ADR 0020)"). Its own amendment at lines 98-109, dated 2026-11-09, says "The decision is unchanged", so the "proposed ... for the owner to accept" status is stale.
- Verification: The ADR is clearly in force (cited by scripts/differential/ratchet.ts, live-known.ts, differential README; amended 2026-11-09 with 'the decision is unchanged'), yet its status still reads 'proposed ... for the owner to accept'. I found no record in docs of the owner's acceptance, so whether it was accepted is not settled by the repo; the status line is stale at least in tone.
- Fix: Owner to confirm; then set 'Status: accepted, <date> (owner)' and keep the 2026-11-09 amendment note. If not accepted, say it is in use while still proposed.

### F020 · `docs/adr/0026-a-text-in-a-controls-touch-margin-is-judged-by-the-eyes.md:58` · partly · low

- Reported (misleading, low, line 58 at the audit): (4) it lies within the target's columns, narrower than it, leaving at least 4 tree units (`MARGIN_BESIDE_MIN`...) of the target's own rows beside it
- Audit evidence: src/ui-tree/cover.ts:100 tests `Math.max(left, right) >= MARGIN_BESIDE_MIN`, so only ONE side needs 4 units. The judge then needs every beside strip to be at least FLANK_MIN_PX (4 png px) wide, else it answers untold (src/verify/eyes.ts:114-117, FLANK_MIN_PX = 4 at eyes.ts:165). A margin text that is 4 units from one edge and 0 from the other passes marginText and gets untold.
- Verification: src/ui-tree/cover.ts:99 uses Math.max(left,right) >= MARGIN_BESIDE_MIN, so one side suffices; the ADR wording 'beside it' is ambiguous. I did not verify the judge's both-sides/untold behaviour claim in eyes.ts.
- Fix: leaving at least 4 tree units (MARGIN_BESIDE_MIN) of the target's own rows on at least one side of it

### F021 · `docs/adr/0031-the-bound-simulator-is-proven-booted-from-its-own-record.md:34` · partly · low

- Reported (stale-reference, medium, line 35 at the audit): The default registry wires the real reader (`defaultIosBooted`; scripts/perf/baseline.ts passes it too, so D0 measures the server's path)
- Audit evidence: No `defaultIosBooted` exists in src/ or scripts/. The real reader is `iosBootedFromDevicePlist` (src/adapters/discovery.ts:235), wired by `defaultDiscoveryDeps` (discovery.ts:320) into `defaultDiscovery` (discovery.ts:322). The registry no longer wires it (src/mcp/registry.ts:96 takes `discovery: defaultDiscovery`). scripts/perf/baseline.ts:252 passes `defaultDiscovery`, not a proof. The same Decision bullet's 'registry's optional third seam (`iosBooted`, `IosBootedProof` ...)' is superseded by the A3 amendment in the same file, which the bullet does not flag.
- Verification: defaultIosBooted exists nowhere; the reader is iosBootedFromDevicePlist via defaultDiscoveryDeps, baseline.ts passes defaultDiscovery. But the bullet itself says 'until A3' and line 5 and the A3 amendment flag the move, so it is a flagged historical Decision, not an unflagged error.
- Fix: Add 'superseded by A3' to the bullet or reword: discovery wires the real reader (iosBootedFromDevicePlist); baseline.ts passes defaultDiscovery.

### F024 · `docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md:779` · partly · low

- Reported (stale-reference, medium, line 775 at the audit): What may hold the app moved up with the rest: `LINK_SAW`, `LINK_UNCHECKED`, `notAsked` and `ANSWER_IT`
- Audit evidence: LINK_SAW, LINK_UNCHECKED and notAsked do not exist anywhere in src/, tests/ or scripts/. The wait's end is now the string literal facts `wait: 'saw' \| 'unchecked' \| 'not-asked'` on AppHolder (src/adapters/types.ts:1003-1005) and `{ kind: 'saw' ... }` in src/adapters/ios-foreground.ts:252-269. Only ANSWER_IT still exists (src/interact/app-holder-text.ts:54). The amendment's residual sentence names only alertNote/alertText as gone, not these.
- Verification: LINK_SAW, LINK_UNCHECKED and notAsked appear only in this ADR; only ANSWER_IT exists (app-holder-text.ts:54). The sentence narrates what moved in an amendment, so it is a historical record, but the names are dead pointers now.
- Fix: Name the wait's saw/unchecked/not-asked facts (adapters/types.ts#AppHolder) and ANSWER_IT; note the old constant names no longer exist.

### F028 · `docs/adr/0037-a-value-the-adapter-cannot-type-is-refused-before-any-device-call.md:93` · partly · low

- Reported (doc-contradicts-code, low, line 93 at the audit): adapters/wda.ts keeps all input on idb ("WDA input would drag in session management")
- Audit evidence: The quoted sentence does not appear in src. src/adapters/wda.ts:388 sends POST /session/:id/wda/keys for non-ASCII text, routed by src/adapters/ios-typing.ts#typingPathOf, and src/adapters/ios.ts:763 sends such text to the source's typer. The 'Later' section is marked done by the D43 amendment (lines 214-215), but this sentence still reads as the current state.
- Verification: The quoted sentence is not in wda.ts and wda.ts now does type via /wda/keys. But the bullet is in the pre-implementation 'Later' text and ends with 'See the D43 amendment below', so it is flagged as historical.
- Fix: Put it in the past tense: 'adapters/wda.ts then kept all input on idb; since D43 it types non-ASCII through /wda/keys'.

### F031 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:216` · partly · low

- Reported (stale-reference, low, line 212 at the audit): the start happened, so a launch never fails for what holds it (`LaunchOutcome`)
- Audit evidence: No type named LaunchOutcome exists in src/. The start outcome type is `StartOutcome` (src/adapters/android-start.ts:113, `export type StartOutcome = { readonly kind: 'started' } \| StartRefused`). The same stale name also appears at line 249.
- Verification: LaunchOutcome no longer exists (ADR 0032 amendment says it is gone, replaced by AppHolder), so it is a stale name in lines ~216 and ~253. But the proposed replacement StartOutcome is wrong: it is android-start's start result, not the launch reply type.
- Fix: Replace `LaunchOutcome` with `AppHolder` (adapters/types.ts), or note it was the launch reply type before ADR 0032's amendment. Not StartOutcome.

### F033 · `docs/release.md:168` · partly · low

- Reported (misleading, low, line 150 at the audit): Gate C: "Its `lab` block guards the simulator (device-check's and any simulator not named `averi-lab …` are refused before any call)"
- Audit evidence: "device-check" is not defined in any of the three documents. The code uses it only in comments: scripts/truth/batch/ios-lab.ts:27 ("device-check's udid refused before any call") and :29 ("never device-check's WDA (8100, 8101) or its simulator"). A reader cannot tell what the refused simulator is.
- Verification: The line is real (docs/release.md:168; line numbers shifted) and 'device-check' appears in no doc, only in ios-lab.ts comments (and lab-device.ts guard). The term is undefined jargon for a reader, but the sentence is not false.
- Fix: 'guards the simulator: it refuses the udid of the separate device-check simulator and any simulator not named `averi-lab …`, before any call' (define device-check once).

### F034 · `docs/release.md:168` · partly · low

- Reported (misleading, low, line 157 at the audit): Gate C: the `lab` block "guards the simulator …, resets it, builds the lab app … and installs it"
- Audit evidence: scripts/truth/batch/ios-lab.ts:230-231 runs `simctl shutdown <udid>` and then `boot` / `bootstatus` on the lab simulator. The reset is a shutdown and restart of the simulator. CLAUDE.md:19-20 forbids the agent from restarting a simulator to get a gate through. The step is owner-only, so the rule is not broken, but the release doc does not say the reset restarts the simulator.
- Verification: ios-lab.ts:230-231 runs simctl shutdown then boot and bootstatus, so 'resets it' is a shutdown and restart. Gate C is owner-only, so no rule is broken; the doc is just vague.
- Fix: resets it (simctl shutdown, then boot and bootstatus; the owner runs this), builds the lab app …

### F041 · `fixtures/apps/android/src/main/java/dev/averi/lab/Forms.kt:165` · partly · low

- Reported (doc-contradicts-doc, low, line 165 at the audit): the formats (schema.ts#FieldFormat; the same rules as Forms.swift's and the React Native app's src/format.ts)
- Audit evidence: Forms.kt:188-191 implements `date`, and scripts/truth/schema.ts:190 lists 'date' in FieldFormat. fixtures/apps/rn/src/format.ts:9 declares FieldFormat = 'group4' \| 'thousands' \| 'group4eager' \| 'phone3' with no 'date'.
- Verification: Forms.kt implements `date`, and fixtures/apps/rn/src/format.ts has no `date`, so 'the same rules as ... src/format.ts' is imprecise for `date`. schema.ts:187-189 already says `date` is the native apps' only and no React Native cell asks for it. The Kotlin comment just omits that qualification.
- Fix: Add: 'except `date`, which only the native apps implement (schema.ts#FieldFormat)'.

### F045 · `fixtures/apps/android/src/main/java/dev/averi/lab/Presented.kt:100` · partly · low

- Reported (stale-reference, low, line 100 at the audit): Composed after the host's Box, as one composable before the split.
- Audit evidence: Presented.kt contains no 'split'. The caller is Base.kt:80, where PresentedLayer follows the target loop inside CellScreen. The phrase refers to a removed structure.
- Verification: 'Composed after the host's Box' is true: Base.kt:80 calls PresentedLayer after the target Box. 'as one composable before the split' is a history note about a removed structure that no longer helps the reader.
- Fix: Drop 'as one composable before the split'; keep 'Composed after the host's Box (Base.kt#CellScreen)'.

### F049 · `fixtures/apps/ios/AveriLab/Lab.swift:23` · partly · low

- Reported (misleading, low, line 23 at the audit): base, presented, forms, edges, bars, false-covers, text, held — CellRouter (AveriLabApp.swift) routes by it.
- Audit evidence: The iOS CellRouter also has a views case (AveriLabApp.swift:69-70, Android-only Classic Views, backlog D77), so the iOS family list is not the full set CellRouter switches on. The listed families do match the iOS switch otherwise (AveriLabApp.swift:58-68).
- Verification: The Cell.family doc lists the iOS-built families, and CellRouter also has a `views` case that is Unbuilt on iOS. The router case omits react-native too. Harmless imprecision.
- Fix: Say 'the families this app builds, plus `views`, which only Android builds'.

### F050 · `fixtures/apps/ios/AveriLab/Lab.swift:62` · partly · low

- Reported (misleading, low, line 62 at the audit): `fieldId`: The field's own identifier, else lab.<cell>.<tag> — a component id shared by every field and its title (FE2)
- Audit evidence: The input takes fieldID(f) (Forms.swift:101, 174), but the title's identifier is `f.titleId ?? "\(fieldID(f)).title"` (Forms.swift:132 and 138), a suffixed id, not the same id. So the title does not share the field's identifier unless titleId is set.
- Verification: The comment describes the FE2 design-system component case, where form-shared-id sets both fieldId and titleId to the same value. By default the title takes fieldID(f)+'.title' (Forms.swift:132), so the title shares the id only when titleId is set. It is imprecise but not wrong in context.
- Fix: 'The field's own identifier, else lab.<cell>.<tag>; the title takes <fieldId>.title unless titleId is set (form-shared-id sets both to one component id, FE2).'

### F053 · `scripts/differential/README.md:223` · partly · low

- Reported (misleading, low, line 223 at the audit): `tests/truth/lab-notes.test.ts` ties … the notes calibrated on the replay whose live KNOWN entries await a live record at their fix, `AWAITING_LIVE`, each with its reason
- Audit evidence: tests/truth/lab-notes.test.ts:57: `const AWAITING_LIVE: Readonly<Record<string, { note: string; why: string }>> = {};`. The table is empty, so no note is currently held under AWAITING_LIVE.
- Verification: AWAITING_LIVE exists and the test uses it (lab-notes.test.ts:93, 250), but it is currently {} ('Empty since round 5'). The README describes the mechanism without saying the table is empty. Calling it false would be too strong.
- Fix: Append '(currently empty)' after `AWAITING_LIVE`.

### F054 · `scripts/differential/README.md:403` · partly · low

- Reported (doc-contradicts-code, medium, line 403 at the audit): `scripts/truth/calibrate.ts` … writes `docs/truth/calibration.md`; usage line 406 shows `[--out docs/truth/calibration.md]` as if it were the default
- Audit evidence: scripts/truth/calibrate.ts:471-473: `const out = values.out === undefined ? undefined : resolve(values.out); const { path, stale, code } = disposition(rs, out, …); if (path === undefined) console.log(report); else await writeFile(path, report);`. The script's own header (calibrate.ts:408) says the report goes to `out` (stdout when none). Without `--out` the report is printed and no file is written.
- Verification: calibrate.ts:435 declares `out` with no default, and line 471 prints the report to stdout when --out is absent. So calibrate.ts does not write docs/truth/calibration.md unless it is run with --out docs/truth/calibration.md. In the usage line, brackets only mark the flag as optional and the value is an example. The prose 'and writes docs/truth/calibration.md' is an overclaim.
- Fix: '...and writes its report to --out <file> (stdout without it; `<out>.partial` for --note runs); the committed docs/truth/calibration.md comes from --out docs/truth/calibration.md.' Usage line: `[--out <file>]`.

### F058 · `scripts/differential/differential.ts:212` · partly · low

- Reported (doc-contradicts-code, low, line 212 at the audit): each node by the first selector that names it alone — its identifier, else its text (label or value), else its label, else its value
- Audit evidence: differential.ts:234 emits `text:"…"` only from `n.label`; `value:` is emitted only at :236 and the text tally at :220 counts label and value together. The doc's "text (label or value)" misdescribes the selector emitted.
- Verification: differential.ts:234 emits text:"..." only from n.label, and the `texts` tally counts label and value together (textsOf). So the text selector is chosen on a label that is unique across labels and values. The doc's 'text (label or value)' hides that the selector uses only the label. Later steps (label, value) are real.
- Fix: Say: 'its text (the node's label, unique among all labels and values), else its label (unique among labels), else its value, ...'.

### F060 · `scripts/differential/golden-spec.ts:50` · partly · low

- Reported (doc-contradicts-code, low, line 50 at the audit): The rows live in scripts/differential/golden-spec/ (one file per cell family of fixtures/apps/cells/)
- Audit evidence: fixtures/apps/cells/ has no covered.json (files: bars, base, edges, false-covers, forms, held, presented, react-native, text, views). covered.ts:6 says its rows are the react-native family's (rn-banner), and held/react-native/views have no golden-spec file.
- Verification: golden-spec/ has bars, base, covered, edges, false-covers, forms, presented, text (plus judges and rows). The cell families held, views and react-native have no same-named file, and covered.ts serves react-native.json (covered.ts:6). 'One file per cell family' is therefore inexact. The files are not all rows either, since judges.ts and rows.ts are shared code.
- Fix: Say: one file per cell family that has rows (covered.ts serves react-native.json).

### F062 · `scripts/differential/golden-spec/edges.ts:102` · partly · low

- Reported (misleading, low, line 102 at the audit): No tap or colour row: nothing of it is on the screen to tap or measure, and the off-screen rows already ask both of such targets.
- Audit evidence: edges.ts:49-55 (the off-screen case) applies only to targets with a measured 'off-screen' geometry, which needs a frame. An absent target (edges.ts:105-109, absentRows) has no frame, so the off-screen rows never reach it.
- Verification: The edges.ts:49-55 off-screen rows (R-off tap and colour) apply only to targets with a measured off-screen geometry. An absent target has no frame and no geometry (edges.ts:34), so those rows never reach it. 'Such targets' can be read as the analogous class (off-screen ones), which is true, but it can also be read as covering absent targets, which is wrong.
- Fix: Say: 'No tap or colour row: it has no frame, so nothing is on the screen to tap or measure (the off-screen rows ask this of framed off-screen targets)'.

### F067 · `scripts/differential/golden-spec/judges.ts:10` · partly · low

- Reported (doc-contradicts-code, low, line 10 at the audit): What a reply SAYS is read by scripts/truth/replies.ts alone — the live judges' reader too (also golden-spec.ts:48: "What a reply says is read by scripts/truth/replies.ts alone")
- Audit evidence: judges.ts:101 closesItsOwnLayer tests the reply text directly: `!o.reply.includes('scroll_until')`.
- Verification: judges.ts:101 closesItsOwnLayer does test the reply text directly, with !o.reply.includes('scroll_until'). That is a real exception to 'read by replies.ts alone', but a tiny one, since the helper goes through presentedRemedySaid for the main reading. The exception also applies to golden-spec.ts:48.
- Fix: Add 'except closesItsOwnLayer's scroll_until check', or move that check into replies.ts.

### F071 · `scripts/release/pack-smoke.ts:31` · partly · low

- Reported (misleading, low, line 31 at the audit): exits 0 on PASS, 1 on FAIL (package.json's bin not built among them), 2 when dist/ is missing.
- Audit evidence: smoke() returns exitCode 1 for any problem (pack-smoke.ts:123, `problems.length === 0 ? 0 : 1`). A bin absent from the tarball is one of several problems (pack-smoke.ts:105, pack-files.ts:31), so the parenthetical reads as if it were the only cause of exit 1.
- Verification: smoke() returns exitCode 1 for any problem (pack-smoke.ts:123): undeclared imports, wrong name/version, wrong tools, bin missing from the tarball. The parenthetical '(package.json's bin not built among them)' can be read as the only cause of exit 1, or as one of several. It is ambiguous, not false.
- Fix: Say: '1 on FAIL (any problem, e.g. a bin missing from the tarball), 2 when dist/ is missing'.

### F077 · `scripts/truth/batch/ios-defaults.ts:43` · partly · low

- Reported (false, low, line 42 at the audit): another block's window (batch-13's D65) takes domainLabels(its id)
- Audit evidence: domainLabels is defined at ios-defaults.ts:54 and has no call site in scripts/: rg finds it only in its definition and in comments (ios-defaults.ts:42, :53; ios-domains.ts:342). D65 appears nowhere in the code.
- Verification: scripts/ has no caller of domainLabels, and D65 appears in the code only in a mutation baseline note. tests/truth/batch/ios-domains-sim.test.ts:733 does call domainLabels('D65'). So 'no call site' is overstated, but the batch-13 block the comment describes is not in the repo.
- Fix: Say domainLabels is exported for another block's window (batch-13's, not in this checkout) and is exercised only by tests here.

### F078 · `scripts/truth/batch/ios-domains.ts:57` · partly · low

- Reported (misleading, low, line 57 at the audit): Files are never overwritten: each read of a domain is a fresh file beside the state file, kept as evidence.
- Audit evidence: restore() overwrites the state file at ios-domains.ts:212 (fs.replace), and markDirty at ios-domains.ts:315 rewrites it via abort.ts:156-167. io.ts:29-34 documents replace for exactly this case.
- Verification: ios-domains.ts:212 does fs.replace(stateFile, ...) and markDirty rewrites the state file. 'Files are never overwritten' is therefore too broad, but the sentence goes on to say it means the domain read files.
- Fix: Say: domain read and backup files are never overwritten (each read is a fresh file beside the state file); the state file itself is replaced whole.

### F079 · `scripts/truth/batch/ios-domains.ts:59` · partly · low

- Reported (false, medium, line 59 at the audit): Nothing here names a port.
- Audit evidence: ios-domains.ts:18 imports LAB_WDA_PORT and ios-domains.ts:173 writes `port: LAB_WDA_PORT` into the state file the module creates in backup(). The module does name the port.
- Verification: ios-domains.ts:18 imports LAB_WDA_PORT and :173 writes it into the state file. The sentence sits in a paragraph about which calls and argv go to the lab, and it means no call uses a port. Read literally it is false, and line 48 of the same block lists port in the state file.
- Fix: Say: No call here uses a port; the state file only records LAB_WDA_PORT.

### F084 · `scripts/truth/batch/lab-emu.ts:230` · partly · low

- Reported (doc-contradicts-code, low, line 230 at the audit): it writes its state file clean only once it has read the state back
- Audit evidence: The only in-repo StateRestore, cleanState at lab-run.ts:187-195, writes the file clean with fs.replace and reads nothing back. lab-run.ts:182-186 justifies it differently (no lab data is kept there).
- Verification: This is the StateRestore contract. The in-repo probeRestore (android-lab.ts:193-205) re-reads the state file after the restore and requires 'clean', so it roughly matches. cleanState (lab-run.ts:133) writes clean with no read-back. The sentence is about the probe's own restore, so 'only once it has read the state back' is imprecise for cleanState, not plainly false.
- Fix: Say a StateRestore leaves its state file clean, and that probeRestore checks it afterwards while cleanState just writes it.

### F085 · `scripts/truth/batch/lab-emu.ts:387` · partly · low

- Reported (misleading, low, line 387 at the audit): adb get-state first (unreachable: unknown at once, nothing pressed, never 'missing' and never 'put back')
- Audit evidence: When the step has not started, lab-emu.ts:402 returns { ok: false, why: 'adb unreachable, so nothing could be read or put back' } with checkHand. It does not return an 'unknown' state; only unknownDuringReinstall (lab-emu.ts:385) does, and only once the step has started.
- Verification: chooserWindow's restore uses unreachable(lab) first (lab-emu.ts:~401-402). If the step is 'started' it returns unknownDuringReinstall, which fits 'unknown'. Otherwise it returns ok:false 'nothing could be read or put back' with checkHand, and that is not an 'unknown' state. So 'unknown at once' holds only after the reinstall started.
- Fix: Say: unreachable gives 'nothing could be read or put back' with the check hand line, or 'unknown' if the reinstall had started; nothing is pressed either way.

### F090 · `scripts/truth/batch/words.ts:81` · partly · low

- Reported (misleading, low, line 81 at the audit): stderr's first line before stdout's
- Audit evidence: words.ts:85 is firstLineOf(r.err + r.out). The two streams are concatenated before the first line is taken, so when stderr has no trailing newline its first line runs into stdout's first line.
- Verification: words.ts:85 takes firstLineOf(r.err + r.out). If stderr is non-empty with no trailing newline, its text runs into stdout's first line. Otherwise stderr's first line comes first, so the comment is right for the common case and imprecise in the edge case.
- Fix: Say: the first line of stderr and stdout joined (stderr first).

### F091 · `scripts/truth/calibration-report.ts:31` · partly · low

- Reported (misleading, low, line 31 at the audit): a green row's reply
- Audit evidence: calibration-report.ts:13 (rowLine) prints c.read ?? firstLine(c.reply) for a green row. A green row shows its recorded read when there is one, and its reply's first line only otherwise.
- Verification: calibration-report.ts rowLine prints c.read ?? firstLine(c.reply) for a green row, so the reply is only the fallback. Imprecise, not wrong.
- Fix: a green row's read, else the first line of its reply

### F108 · `scripts/truth/live.ts:301` · partly · low

- Reported (misleading, low, line 301 at the audit): exit 1 on an unknown MISMATCH, on a known case not intermittent that came out ok in a run of this checkout (fixed: strike it off), and on a case whose app wrote no first state (T10, live-cases.ts#noFirstState); and on a stale chooser premise (T20a).
- Audit evidence: live-cases.ts:893-895 also sets exit 1 for failingSkips (a SKIP on a case with skipFails, the ensure group, live-ensure.ts:20-22) and for ceiling.fails (live-carousel.ts#hedgedCeiling). The comment lists neither, so it is incomplete rather than wrong.
- Verification: The list of exit-1 causes is incomplete, not wrong. summarize also fails on failingSkips (a SKIP on a skipFails case), on a failing hedged ceiling (live-cases.ts:909) and on tallies. A comment at live-cases.ts:788 repeats the omission.
- Fix: Add 'a SKIP on a skipFails case' and 'the carousel's hedged ceiling' to the list, or point to live-cases.ts#summarize for the full list.

### F119 · `scripts/truth/schema.ts:411` · partly · low

- Reported (misleading, medium, line 411 at the audit): The selector the target answers to in every tree source: its accessibility identifier.
- Audit evidence: truth.ts:79-82 selectorOf asks a text target by text:"…" and a label target by label:"…", and only other targets by id. schema.ts:40-56 (CatalogTarget.text / .label) and schema.ts:414-419 (TargetTruth.text / .label: 'its rows ask by it') say the same. The TargetTruth.id comment is wrong for text and label targets.
- Verification: id is still every target's accessibility identifier (text/label targets are 'identified as lab.<cell>.<tag>' per CatalogTarget), but rows ask a text or label target by text/label, not by id (truth.ts elementOf/selectorOf), so 'the selector the target answers to' overstates.
- Fix: The target's accessibility identifier, as every tree source lists it (rows ask a text or label target by its text/label instead: truth.ts#elementOf).

### F122 · `skill/SKILL.md:33` · partly · low

- Reported (misleading, low, line 33 at the audit): A failed run has no `appAlive` line.
- Audit evidence: That holds only for a flow or ensure_state that throws: src/run/commands.ts:113-126 (runEnsureState/runNamedFlow) and src/flow/engine.ts:587-598 (run rejects on a failed step, so no health line). It does not hold for asserts or verify checks: src/run/commands.ts:170 (runAsserts) appends appHealth even when asserts fail, and src/run/verify.ts:587-588 appends health to every leg that returns, whatever its assert verdicts. README.md:109 says 'every assert call (failed asserts included)' gets appAlive, and docs/verification.md:21-25 says a FAILED flow or leg (rejected) carries none.
- Verification: runAsserts (commands.ts:165) appends health even when asserts fail, and README/docs say failed asserts get appAlive; only a failed flow/state/leg (error replaces the trace) carries none. 'A failed run' is imprecise but the blanket claim is wrong for asserts.
- Fix: A flow, state or verify leg that fails outright carries no `appAlive` line (check get_logs / screenshot); a failed `assert` still carries it.

### F127 · `src/adapters/android.ts:169` · partly · low

- Reported (misleading, low, line 1706 at the audit): a full-screen window whose content lays a SCRIM above a SHEET ... some node's child that is clickable, labelled and childless
- Audit evidence: composeSheetScrim.holds requires the scrim's content-desc specifically: `emptyToNull(scrim['content-desc']) === null` returns false (android.ts:1717). A scrim labelled only by its text attribute passes the comment's 'labelled' test but is rejected by the code. The UiNode label is contentDesc ?? text (android.ts:1829), so 'labelled' in the comment means something broader than the code's check.
- Verification: The comment is in src/adapters/android-tree-dialect.ts (composeSheetScrim, ~l.169-185), not android.ts, so the cited lines are wrong. The code does require a non-empty raw content-desc (`emptyToNull(scrim['content-desc']) === null` returns false), while the comment says only 'labelled'. The comment's own example uses content-desc, so the imprecision is small.
- Fix: Say 'labelled with a content-desc' in the doc and in 'The label is the guard'.

### F131 · `src/adapters/ios-status-band.ts:11` · partly · low

- Reported (doc-contradicts-doc, medium, line 11 at the audit): Neither tree source lists the status bar.
- Audit evidence: The same file says at lines 25-26 that the status bar's items end at y 39-44 "(SpringBoard's tree, ui-tree/bare-tree.ts)". bare-tree.ts:109 describes SpringBoard's tree as listing "the status bar (text '18:29' at {50,22,48,22}...)". ios-foreground.ts:22-23 says a cold launch's SpringBoard tree holds "the status bar and the zooming icon". The flat claim holds only for the app's own tree.
- Verification: bare-tree.ts:~107-111 documents that for ~2 s after a launch idb reads SpringBoard, whose tree lists the status bar (clock, Cellular, battery). The same file cites that tree at l.25-26. So 'neither tree source lists the status bar' holds for the app's own tree but not during the SpringBoard transient. The sentence sits in a paragraph about the app's tree, so it is narrower than a flat falsehood.
- Fix: Say: 'The app's tree (idb's or WDA's) lists no status bar; only SpringBoard's tree, read during a launch transition, does.'

### F133 · `src/adapters/ios-tree-source.ts:272` · partly · low

- Reported (stale-reference, low, line 272 at the audit): of every idb capture committed (the lab's 31, tests/fixtures/idb-*.json)
- Audit evidence: `find tests -name 'idb-*.json'` returns 8 files, not 31. Under tests/ there are 41 `*.idb.json` files in total. The cited glob and the count of 31 do not match the repo.
- Verification: tests/fixtures holds 8 idb-*.json files. There are 41 *.idb.json files (49 idb json files in all), so the glob matches only part of the idb captures. The count '31' matches neither number and I could not check it against the lab.
- Fix: Say 'of every committed idb capture (tests/fixtures/idb-*.json and *.idb.json)' and drop the count.

### F137 · `src/adapters/types.ts:206` · partly · low

- Reported (false, low, line 206 at the audit): The pixel poll's soft-keyboard check (verify/pixel-poll.ts) asks it (rectsOverlap: any positive overlap counts there)
- Audit evidence: verify/pixel-poll.ts imports only coverText, isUntold, nodeText, rectText and sameRect from ui-tree/geometry.ts (pixel-poll.ts:3); it does not use rectsOverlap or rectIntersection. The overlap question is asked by ui-tree/keyboard-cover.ts (imports rectsOverlap at keyboard-cover.ts:2), plus standing.ts, geometry.ts and wda-source.ts. types.ts:212-214 names the wrong caller.
- Verification: verify/pixel-poll.ts imports no rectsOverlap (its l.3 import is only isUntold, rectText, sameRect), and pixel-text.ts holds only wording. The overlap question is asked by ui-tree/keyboard-cover.ts (l.473), standing.ts and wda-source.ts. The pixel poll reaches it only indirectly, through the keyboard reading (readKeyboard) it consults, so naming pixel-poll.ts as the asker is misleading.
- Fix: Say 'The soft-keyboard reading's coverage check (ui-tree/keyboard-cover.ts, read by the pixel poll) asks it'.

### F142 · `src/adapters/wda-source.ts:261` · partly · low

- Reported (misleading, low, line 261 at the audit): The band node is an `Other` (or, in the fallback, the `Keyboard` itself)
- Audit evidence: bandOf (wda-source.ts:848-851) returns the first ancestor below the Window whose rect passes isBand, whatever its type. `Other` is the usual case, not a rule the code enforces.
- Verification: bandOf (wda-source.ts:~840-852) returns the first ancestor below the Window whose rect passes isBand, whatever its type, else the Keyboard itself. The comment fixes the type as `Other`. It is the measured shape (l.~718 'ONE `Other`'), but the code does not enforce it. The fallback part is correct.
- Fix: Say: 'The band node is the first ancestor below the Window whose rect is a band (measured: an `Other`), or in the fallback the Keyboard itself.'

### F143 · `src/adapters/wda-source.ts:546` · partly · low

- Reported (stale-reference, low, line 546 at the audit): (corpus run16-ios/contacts-sheet-keyboard-wda.json)
- Audit evidence: No file of that name exists in the repo (find returned nothing). The run16-ios configs are cited as external in docs/bugs/2026-10-09-wda-offscreen-cell-text-parked-at-sheet-origin-reads-visible.md:116 and docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md:388, so a reader cannot check the claim here.
- Verification: No file contacts-sheet-keyboard-wda.json exists in the repo. The comment says 'corpus', and the run16-ios captures are cited as outside the repo in docs/bugs and ADR 0018. So this is not a typo but an unmarked external pointer, and a reader here cannot check it.
- Fix: State that the corpus is outside the repo, or cite a committed fixture.

### F145 · `src/adapters/wda-source.ts:735` · partly · low

- Reported (doc-contradicts-code, medium, line 735 at the audit): a window with no usable rect (WDA roots a sheet tree in a rect-less node, ui-tree/geometry.ts) leaves visibility to decide alone.
- Audit evidence: bandOf (wda-source.ts:845) falls back to the root's rect when the Window's rect is unusable: `usableRect(ancestors[windowAt]?.rect) ?? usableRect(ancestors[0]?.rect)`. Visibility alone decides only when the root rect is also unusable (the `screen === undefined` return at line 847). The doc describes the wrong fallback.
- Verification: wda-source.ts bandOf (~845) uses `usableRect(window.rect) ?? usableRect(ancestors[0]?.rect)`, so a rect-less Window is judged against the root's rect. Visibility alone decides only when no usable rect exists at all (screen undefined). The comment's 'rect-less node' case is the root, so it is right only for that case.
- Fix: A window with no usable rect is judged against the root's rect; visibility alone decides only when neither has one (WDA roots a sheet tree in a rect-less node).

### F146 · `src/adapters/wda-source.ts:766` · partly · low

- Reported (doc-contradicts-code, low, line 766 at the audit): (b) the Application's FIRST Window child is never marked through it
- Audit evidence: isInputHostPlaceholder (wda-source.ts:829) exempts only a Window that is the root's first child (`at === 1 && ancestors[0].children?.[0] === window`). It does not exempt the Application's first Window child when the root's first child is some other element, and it does not apply at deeper nesting.
- Verification: isInputHostPlaceholder (~829) exempts only `at === 1 && ancestors[0].children?.[0] === window`: the Window must be the root's first child. A Window that is the Application's first Window but not its first child is not exempted. The comment is looser than the code, though the intended fixture shape matches.
- Fix: (b) a Window that is the Application's first child is never marked through it.

### F147 · `src/adapters/wda.ts:136` · partly · low

- Reported (misleading, low, line 136 at the audit): two WdaServers in this process can NEVER share a port
- Audit evidence: The constructor uses an explicit opts.port when given (wda.ts:245), bypassing the allocator. WdaServerOptions.port is documented as 'Explicit port' (wda.ts:191).
- Verification: wda.ts:245 `opts.port ?? wdaPortFor(udid)` lets an explicit port bypass the allocator. Also wdaPortFor returns one port per UDID, so two servers for the same UDID get the same port. 'NEVER' is overstated on both counts.
- Fix: Two WdaServers for different UDIDs that take the default port never share one (one port per UDID); an explicit `port` option bypasses the allocator.

### F149 · `src/adapters/wda.ts:588` · partly · low

- Reported (doc-contradicts-code, low, line 588 at the audit): The restart path (sourceAttempt) and the process 'exit' hook need this form
- Audit evidence: The exit hook is `() => this.killChild()` (wda.ts:816), not stop(). stop() also removes that hook (wda.ts:595-598), so the exit hook does not use stop()'s form.
- Verification: The restart path does call this.stop() (wda.ts ~477), but the exit hook is `() => this.killChild()` (~816), not stop(), and stop() removes that hook. So half the claim is wrong.
- Fix: The restart path (sourceAttempt) needs this form, it cannot await; the process 'exit' hook calls killChild directly.

### F152 · `src/flow/config.ts:63` · partly · low

- Reported (stale-reference, low, line 63 at the audit): `KEYBOARD_ROLE` (ui-tree/soft-keyboard.ts), which only the WDA parser assigns (wda-source.ts#keyboardMarks)
- Audit evidence: KEYBOARD_ROLE is defined in src/adapters/types.ts:255, not in ui-tree/soft-keyboard.ts (which only reads it, e.g. soft-keyboard.ts:51, 140). The WDA parser is src/adapters/wda-source.ts (assigns it at :264), not a file named wda-source.ts under the path given at ui-tree/. The short name is ambiguous but the assignment fact is true.
- Verification: KEYBOARD_ROLE is defined in src/adapters/types.ts:255. ui-tree/soft-keyboard.ts only imports and reads it, though 'every reader keys on KEYBOARD_ROLE (ui-tree/soft-keyboard.ts)' can be read as naming one reader. wda-source.ts#keyboardMarks exists and does assign it, so the WDA-only assignment claim holds. Ambiguous pointer, not false.
- Fix: `KEYBOARD_ROLE` (adapters/types.ts), read by ui-tree/soft-keyboard.ts, which only the WDA parser assigns (adapters/wda-source.ts#keyboardMarks).

### F153 · `src/flow/config.ts:68` · partly · low

- Reported (misleading, medium, line 574 at the audit): launch_app, whose entry in the policy table (mcp/config-policy.ts#TOOL_CONFIG) reads averi.yaml only when the fallback can apply.
- Audit evidence: src/mcp/config-policy.ts:38 defines onIos = (p) => p === 'ios' ? OPTIONAL_CONFIG : NO_CONFIG, and :43 maps launch_app to launchConsultsConfigActivity(call) ? OPTIONAL_CONFIG : onIos(call.platform). On iOS the policy reads averi.yaml even when the activity fallback cannot apply (launchConsultsConfigActivity is false on iOS, so the second arm is taken and returns OPTIONAL_CONFIG). The 'only when the fallback can apply' rule holds for Android only.
- Verification: The quoted sentence is not in flow/config.ts:574 (that area is parseConfig docs); it is at src/flow/launch.ts:68. There, 'only when the fallback can apply' is imprecise: config-policy.ts:44 returns OPTIONAL_CONFIG on iOS too, via onIos. The mcp/config-policy.ts header itself says 'on Android only', so the fallback sense is right for Android.
- Fix: launch_app, whose entry in the policy table (mcp/config-policy.ts#TOOL_CONFIG) reads averi.yaml on Android only when the fallback can apply (and, as every device tool, optionally on iOS). Cite launch.ts, not config.ts.

### F156 · `src/flow/hold-tracker.ts:31` · partly · low

- Reported (misleading, low, line 31 at the audit): A `HoldTracker` that ends a run once it has held `holdMs`
- Audit evidence: src/flow/hold-tracker.ts:47-48: observe() keeps the run and returns the held duration on every later read while the fingerprint stays the same; it resets `run` only on a bare tree, a progress tree, a failed read, or a changed fingerprint (lines 38-45). Nothing ends the run at holdMs. The engine stops only because it takes the first non-undefined return (src/flow/engine.ts:1148-1151).
- Verification: hold-tracker.ts observe() never ends or resets a run at holdMs; it returns the held duration on each later read while the fingerprint is unchanged, resetting only on a bare, progress, undefined or changed tree. The engine stops polling on the first non-undefined return (engine.ts ~1148). 'ends a run' is loose but the tracker's job (signal once held) is conveyed.
- Fix: A HoldTracker that reports a rendered tree as held once it has been unchanged for holdMs; a run breaks only on a changed, bare, progress or failed read.

### F157 · `src/flow/load.ts:150` · partly · low

- Reported (misleading, low, line 150 at the audit): loadConfig for tools that predate averi.yaml ... (ui_snapshot, tap, assert, launch_app, ... — the `optional` policy of flow/tool-config.ts)
- Audit evidence: src/mcp/config-policy.ts:47-48 sets ui_snapshot and tap to onIos(), which is OPTIONAL_CONFIG only on iOS and NO_CONFIG on Android; src/mcp/config-policy.ts:43 makes launch_app optional only when launchConsultsConfigActivity applies; only assert (line 59) is OPTIONAL on both platforms. A reader would think Android tap/ui_snapshot read an optional averi.yaml, which they do not.
- Verification: config-policy.ts: ui_snapshot and tap use onIos (OPTIONAL on iOS, NO_CONFIG on Android); launch_app is optional on iOS or when launchConsultsConfigActivity; only assert is optional on both platforms. The list of tools under 'the optional policy' is true per call on iOS, not on Android. loadConfigIfPresent itself is correct.
- Fix: for tools that read averi.yaml optionally (assert on both platforms; ui_snapshot, tap, launch_app, ... on iOS), per mcp/config-policy.ts#TOOL_CONFIG.

### F162 · `src/interact/fill-facts.ts:215` · partly · low

- Reported (misleading, low, line 215 at the audit): `unmatched`: ... or nothing was read before typing to compare the screen with.
- Audit evidence: fill.ts:238-239: when there was no pre-typing read (screenBeforeTyping === null, focus re-read skipped), lostOnLastRead is 'screen-changed' if the screen differs from the one the field was resolved on (changedSinceResolved). So 'nothing read before typing' yields screen-changed in that case, not unmatched.
- Verification: fill-refetch.ts:74-76 (typing-unread phase): with nothing read before typing, the answer is screen-changed if the screen the field was resolved on is known and differs, else unmatched. So 'nothing was read before typing' yields unmatched only when that comparison is unavailable or finds no change. The report cites fill.ts:238, which does not hold this logic.
- Fix: unmatched: ... or nothing was read before typing and the screen the field was resolved on is not shown to differ. Add to screen-changed: or, with no read before typing, the screen differs from the one the field was resolved on.

### F164 · `src/interact/fill-text.ts:287` · partly · low · orchestrator-checked

- Reported (false, medium, line 287 at the audit): Lengths and counts only: no row is handed the typed value or the field's text.
- Audit evidence: src/interact/fill.ts:228 passes target: describeTarget(target) into the reread-failed failure. src/interact/resolve.ts describeTarget returns a string selector unchanged (`typeof target === 'string' ? target : describeElementSpec(target)`). fill-text.ts:295-298 prints that target into the thrown message. src/adapters/types.ts:355-357 documents value:"..." selectors, which carry the field's current text. fill-facts.ts:283-284 itself says target is 'the selector as the caller wrote it', and fill-facts.ts:270-272 says 'Lengths and counts only, never content'.
- Verification: fill-text.ts:295-298 prints `target` (describeTarget(target), fill.ts:196) in the reread-failed message, and fill-facts.ts:~294 itself says target is the selector as the caller wrote it. A value:"..." selector would carry field text. But it is the caller's own selector, not the typed value; 'no row is handed the typed value' reads about the typed value and the field's read text, not the caller's selector.
- Fix: Add: 'except the reread-failed row, which echoes the caller's selector verbatim.'

### F167 · `src/interact/fill.ts:76` · partly · low

- Reported (misleading, low, line 98 at the audit): Focus a field (center tap, after resolveClearOfKeyboard ...)
- Audit evidence: fill.ts:180 takes `point` from resolveClearOfKeyboard, and fill.ts:256 taps that point. fill.ts:181-183 says a focus tap may have moved off a covered centre (tap-judgement.ts#TapJudge.aim), and fill-facts.ts:71 documents the moved field.
- Verification: fill.ts:158 takes `point` and `moved` from resolveClearOfKeyboard and fill.ts:202 taps that point; the doc says 'center tap' but the point can be aimed off a covered centre. Minor imprecision.
- Fix: 'Focus a field (tap at the point resolveClearOfKeyboard chose: the centre unless aimed off a cover, ...)'

### F168 · `src/interact/fill.ts:115` · partly · low

- Reported (misleading, low, line 137 at the audit): An EMPTY value is the focus tap and the optional clear alone: nothing is read back, no append warning is raised
- Audit evidence: With clear and an empty value, fill.ts:326-327 re-reads the field before clearing and fill.ts:336-338 re-reads it after every delete round. Only the typed-value read-back (typeAndConfirm) is skipped.
- Verification: For a clear with an empty value fill.ts re-reads the field (clear step reads at fill.ts:~243, readBack 'nothing-typed' / 'lost' at :260). Only the typed-value read-back is absent. 'nothing is read back' is loosely true of the typing but imprecise for the clear.
- Fix: 'nothing typed is read back (a clear alone still re-reads the field while it clears)'

### F169 · `src/interact/fill.ts:119` · partly · low · orchestrator-checked

- Reported (misleading, medium, line 141 at the audit): Errors carry LENGTHS only, never content — values may be credentials.
- Audit evidence: fill.ts:228 puts describeTarget(target) into the reread-failed error. resolve.ts:39-40 returns describeElementSpec(target) for non-string targets, and ui-tree/element-spec.ts:77-82 writes every spec field, including value:"…". A value: selector therefore quotes its value in that error. fill-facts.ts:270-276 has the same 'never content' claim.
- Verification: The reread-failed error includes describeTarget(target) (fill.ts:196), which for a value: selector quotes its text (describeElementSpec). The sentence is about typed values that may be credentials, which are never echoed, but 'never content' is not literally true of the selector echo.
- Fix: 'Errors carry LENGTHS only, never the typed value (the reread-failed one also names the caller's selector as written) — values may be credentials.'

### F170 · `src/interact/flush-check.ts:172` · partly · low

- Reported (doc-contradicts-code, low, line 172 at the audit): `axis` ... — those two only when the tree changed since the probe
- Audit evidence: verdictOf returns unchecked('axis') unconditionally when probeAcrossOnly holds (flush-check.ts:521) and unchecked('room') unconditionally when planProbe finds no room (flush-check.ts:523), with no check that the tree changed since the probe. The 'only when the tree changed' gate is not in the code.
- Verification: verdictOf returns unchecked('axis') / unchecked('room') (flush-check.ts:521,523,553) with no explicit 'tree changed since the probe' test. The qualifier is the doc's reasoning about a proven cut (a probe was planned earlier, so room/axis can only arise after a change), but the code does not gate on it, and it also applies on unproven flush verdicts.
- Fix: Drop the qualifier or reword: 'those two only arise on a proven cut when the tree has changed since the probe was planned'.

### F175 · `src/interact/scroll-rounds.ts:139` · partly · low

- Reported (misleading, low, line 138 at the audit): resolved at the scroll's first read that reads, before anything of it is judged (repeated at scroll-rounds.ts:924-927 as 'before anything of it is judged')
- Audit evidence: round() calls judgeRead(read, ...) at scroll-rounds.ts:922, and only afterwards resolves the named scroll view at :928-931 (resolveWithin on judged.facts). The refusal still stops the scroll before any stroke, but the judgement is computed first.
- Verification: round() calls judgeRead at scroll-rounds.ts:907 and only then resolves `within` at :913. So the read is judged before the within resolution, though the judgement is not acted on and the refusal still precedes any stroke. 'before anything of it is judged' is literally wrong; the intent (stops before any swipe, whatever the read holds) is right.
- Fix: 'resolved on the scroll's first read that reads, before any swipe is sent'; drop 'before anything of it is judged' in both places.

### F176 · `src/interact/scroll-text.ts:1234` · partly · low

- Reported (false, low, line 1247 at the audit): Exported for the live golden's kf judge (scripts/truth/live-forms.ts), which tells it from averi's own refusals.
- Audit evidence: The only importer of TREE_READ_FAILED is scripts/truth/replies.ts:3, used by scrollVerdictSaid at scripts/truth/replies.ts:459-462. scripts/truth/live-forms.ts has no reference to TREE_READ_FAILED (rg finds none).
- Verification: The only direct importer is scripts/truth/replies.ts:3 (scrollVerdictSaid, :462). live-forms.ts imports scrollVerdictSaid (line 4, used at :535) and has no direct reference to TREE_READ_FAILED, so it is only an indirect consumer.
- Fix: 'Exported for scripts/truth/replies.ts#scrollVerdictSaid, which the live golden's kf judge uses to tell it from averi's own refusals.'

### F177 · `src/interact/scroll.ts:73` · partly · low · orchestrator-checked

- Reported (misleading, high, line 70 at the audit): Swipe until the element is present AND visibly inside the viewport
- Audit evidence: Default is fully=false: scroll.ts:27 and rules at scroll.ts:303-306 (fully: opts.fully === true). The default stop accepts partial visibility: scroll-text.ts:343 reports 'visible after N — CLIPPED … share' for a non-fully stop. scroll.ts:84-86 says fully:true 'raises the bar from intersects to entirely inside'.
- Verification: Default fully=false requires only intersection (scroll.ts:25, doc :86 'raises the bar from intersects to entirely inside'). 'visibly inside the viewport' can be read as wholly inside, but the same doc block qualifies it two paragraphs below, so it is imprecise rather than false; high severity is overstated.
- Fix: 'Swipe until the element is present and visibly in the viewport (overlapping it; `fully: true` requires it entirely inside).'

### F181 · `src/interact/stroke-plan.ts:13` · partly · low

- Reported (stale-reference, low, line 12 at the audit): scroll-rounds.ts chose the candidates (`strokeCandidates`, `targetScrollers`), decided the step (`plannedStroke`), turned the step into points ... (`presentedTouchDown`) ... swipe.ts judged the room (`strokeRoom`, `strokeBox`)
- Audit evidence: rg over src finds no definitions or uses of strokeCandidates, plannedStroke, presentedTouchDown or strokeBox. Only targetScrollers (stroke-plan.ts:738), strokeRoom (stroke-plan.ts:876) and touchedOn (stroke-plan.ts:503) exist. The passage is historical ('Until the round-21 architecture pass (A1)') but gives identifiers a reader may search for.
- Verification: stroke-plan.ts:12-15 is explicitly historical ('Until the round-21 architecture pass'). strokeCandidates, plannedStroke, presentedTouchDown and strokeBox no longer exist, but the passage reads as history, not as a current pointer. targetScrollers, strokeRoom and touchedOn do exist.
- Fix: Optional: mark the removed names '(since removed)' so nobody greps for them.

### F182 · `src/interact/swipe.ts:44` · partly · low

- Reported (false, low, line 44 at the audit): Pure; `swipeScreen` and the scroll loop both call it.
- Audit evidence: src/interact/scroll.ts imports only dragMs and screenBox from ./swipe.js (scroll.ts:10). swipeVector reaches the scroll loop only through stroke-plan.ts:811 (fullStroke) and swipeVectorAbove. Direct callers are swipeScreen (swipe.ts:331) and swipeVectorAbove (swipe.ts:123-124).
- Verification: swipe.ts:44-47 says swipeScreen and the scroll loop both call swipeVector. scroll.ts does not call it; it is called from swipe.ts (swipeScreen, swipeVectorAbove), stroke-plan.ts (fullStroke) and motion-shown.ts. 'Scroll loop' is loosely stroke-plan, so only the wording is off.
- Fix: Pure; swipeScreen, swipeVectorAbove and stroke-plan.ts (scroll_until's strokes) call it.

### F186 · `src/interact/target-text.ts:81` · partly · low

- Reported (misleading, low, line 198 at the audit): else scroll the list — `scroll_until it out from under that container first`
- Audit evidence: cutByRemedy's code (target-text.ts:204) emits `scroll_until it out from under that ${by.role} first (${wholeThinWayPast(by)})`: the role is interpolated and the whole-thin way-past clause is appended. The doc (lines 198-200) shows the literal word 'container' and omits that clause.
- Verification: The text is in touch-remedy.ts:81, not target-text.ts:198. cutByRemedy emits `that ${by.role} first (${cutWayPast(cut)})`, so the doc's literal 'container' is a stand-in for the role. The doc does not omit the way-past clause, though: it says 'with the cut's way past (`cutWayPast`)'.
- Fix: Write `scroll_until it out from under that <role> first`, keeping 'with the cut's way past'.

### F191 · `src/run/verify.ts:583` · partly · low

- Reported (doc-contradicts-code, medium, line 583 at the audit): ensure_state always asked before its frame, so overlapping there changed nothing it promised
- Audit evidence: src/run/commands.ts:70-72 says that until D13 (2026-10-31) ensure_state asked the health first and only then took its frame; commands.ts:100-104 says ensure_state's health check and capture now run together via Promise.all (D13, see runOnEngine). The present-tense 'always asked before' is stale.
- Verification: The comment sits in verify.ts about line 449. commands.ts:70-77 and :114 confirm that ensure_state asked health before its frame until D13 and now runs the two together (Promise.all). 'Always asked before its frame' is past-tense reasoning about the old order, which is why overlapping changed nothing it promised. It is not stale as a statement of present behaviour, though the tense is ambiguous.
- Fix: Say 'ensure_state's health was asked at the frame's start (before it, until D13), so overlapping there changed nothing it promised'.

### F192 · `src/ui-tree/bare-tree.ts:193` · partly · low

- Reported (false, low, line 193 at the audit): statusBarBottom doc: the status item 'holds a labelled or valued container/other other than a wrapper'
- Audit evidence: bare-tree.ts:204 tests only STRUCTURAL_ROLES, label or value, and within(); it never calls wrapperBySize (defined at line 162, used only in isBareTree). The qualifier is vacuous in practice, since a wrapper cannot fit inside the top CLOCK_BAND_FRACTION (line 237), but the doc claims a check the code does not perform.
- Verification: statusBarBottom (bare-tree.ts:204) tests STRUCTURAL_ROLES, label or value, and within(); it does not call wrapperBySize, so the doc's 'other than a wrapper' is not checked. In practice a screen-sized wrapper cannot lie within the top clock band.
- Fix: Drop 'other than a wrapper' from the doc.

### F193 · `src/ui-tree/draw-order.ts:45` · partly · low

- Reported (misleading, low, line 45 at the audit): 'coversOf, presentedAt and presentedOver read exposure's' column (header of the seven questions)
- Audit evidence: In draw-order.ts, coversOf (line 1858), presentedAt/presentedOver via lastPresentedSurface (line 1832) and exposure (line 1903) all judge nodes with drawsOverTarget, i.e. the `target` column (lines 1730-1731). No separate 'exposure' column exists. The per-method docs at lines 160-166 and 210-224 say 'target column', contradicting this header.
- Verification: The header at draw-order.ts:45-47 says drawnOverAt reads drawnOver's column, paintsOver filters exposure's, and coversOf/presentedAt/presentedOver read exposure's. NOT_DRAWN has only the `drawnOver` and `target` columns. 'exposure's' is shorthand for the target column that exposure uses, and the per-method docs say `target` column (lines 160-166, 210-224). The shorthand is imprecise.
- Fix: Say they read the `target` column, the one exposure uses.

### F199 · `src/ui-tree/eyes.ts:215` · partly · low

- Reported (misleading, medium, line 215 at the audit): `clear` (verify/eyes.ts#judgeClear: the overlap pixel-identical to the target's own rows beside the text) ... so it is said only on pixel identity (lines 215-217)
- Audit evidence: src/verify/eyes.ts:149 sets EYES_SAME_DE = 1.0, a colour tolerance. judgeClear (src/verify/eyes.ts:418-438) counts pixels within that tolerance via nearCount and accepts up to OWN_PIXELS_MAX * scale * scale stray pixels in both the flank and the overlap. It is not strict pixel identity.
- Verification: eyes.ts judgeClear (verify/eyes.ts:~418-438) counts pixels within EYES_SAME_DE=1.0 (about one JND) and tolerates up to OWN_PIXELS_MAX strays, so it is not strict pixel identity. The comment's own measurement note says 'to the pixel' for the lab, and the claim is directionally fair, only imprecise.
- Fix: Say 'the overlap's pixels match the target's own colour within EYES_SAME_DE (ΔE 1.0), with at most OWN_PIXELS_MAX strays' instead of 'pixel-identical'/'pixel identity'.

### F201 · `src/ui-tree/geometry.ts:270` · partly · low

- Reported (misleading, low, line 270 at the audit): windowRect doc: 'The root is it when the root has one.' (lines 270-271)
- Audit evidence: windowRect (geometry.ts:286-288) returns the root only when isWindow(tree.rect) holds, which requires origin anchoring (isWindow, line 238-239). A root with area that does not start at the origin hits line 288 and returns undefined. Such a root is handled only by insetWindowRect.
- Verification: windowRect (geometry.ts:~286) returns the root only if isWindow (origin-anchored with area); a root with area not at the origin returns undefined at the hasArea line. 'has one' can be read as 'has a window rect', and the next sentence covers only a root with no usable rect, so the off-origin-root case is left unstated rather than contradicted.
- Fix: 'The root is it when it is origin-anchored with area. A root with area elsewhere yields undefined here (insetWindowRect reads it).'

### F206 · `src/ui-tree/keyboard-cover.ts:319` · partly · low

- Reported (misleading, medium, line 319 at the audit): Said only when the input method answered: then the call ran, and the region line was missing or unreadable.
- Audit evidence: keyboard-cover.ts:320 returns refused { kind: 'unreadable' } only when witness === 'shown'; for witness 'hidden' (an answer, the call ran) it returns { panels: [] } with no refusal. The RegionRefusal doc at keyboard-cover.ts:238-240 says 'the input method answered (the call ran)', which also covers 'hidden'.
- Verification: panelsBeyond returns refused unreadable only when witness === 'shown'; for 'hidden' with a missing region it returns { panels: [] } silently. 'Said only when the input method answered' is a necessary condition and true, but reads as sufficient, and the RegionRefusal doc (~238) has the same loose wording. Not strictly false.
- Fix: 'Said only when the input method said shown in the same call and the region line is missing or unreadable.' Align the RegionRefusal `unreadable` bullet.

### F210 · `src/ui-tree/miss.ts:205` · partly · low

- Reported (misleading, low, line 205 at the audit): The remedies both notes open with: close what lies over the element; else, if it shows, what each read leaves.
- Audit evidence: In noIdListedNote (miss.ts:210-213) and idUnlistedNote (miss.ts:219-220) the COVERED_FIRST phrase comes after the fact and idb's reasons (IDB_UNLISTS), not at the opening of either note.
- Verification: In noIdListedNote and idUnlistedNote the COVERED_FIRST phrase comes after the fact and IDB_UNLISTS reasons ('the fact, idb's reasons, then the remedies'), so 'both notes open with' is literally wrong. It likely means the remedies section opens with that phrase, so it is a wording slip.
- Fix: 'The remedy both notes end with: close what lies over the element; else, if it shows, ...'

### F211 · `src/ui-tree/placed.ts:72` · partly · low

- Reported (misleading, low, line 72 at the audit): A rect whose area reaches SCREEN_SIZED_FRACTION of the screen's (screenOf) — the one area test
- Audit evidence: The same test is written independently at src/ui-tree/standing.ts:1571 (screenSized), src/ui-tree/bare-tree.ts:162 (wrapperBySize) and src/adapters/wda-source.ts:447 (screenSized), in addition to placed.ts:75.
- Verification: placed.ts:75 fillsScreen is not the only copy of the SCREEN_SIZED_FRACTION test: standing.ts:1462 (screenSized), bare-tree.ts:162 (wrapperBySize) and wda-source.ts:447 each repeat it. 'The one area test' is true only within placed.ts's predicates and overstates it repo-wide.
- Fix: Drop 'the one area test' (or say 'the area test the frame predicates share').

### F214 · `src/ui-tree/reading-order.ts:73` · partly · low

- Reported (misleading, medium, line 73 at the audit): `unordered`, `seenOver`, `seenUnder`, `listedBefore`, `coversAfter`: of the controls whose order is not told
- Audit evidence: seenOver and seenUnder are, by construction, the peers a screenshot ORDERED (reading-order.ts:187-192 says so; code at reading-order.ts:249-251 builds seenOver/seenUnder from peerSeen, which returns only 'over'/'under' from a seen pair). Calling them 'order not told' contradicts the comment at lines 187-192 and the code.
- Verification: reading-order.ts:249-251 builds seenOver/seenUnder from peerSeen, i.e. peers a screenshot told. The doc's own later text calls seenOver 'named seenOver instead of unordered' and says seenUnder is 'no peer'. Listing 'of the controls whose order is not told' is imprecise: the listing did not tell them, the screenshot did. A heading note says 'peersOf, its doc says each', so it is not a contradiction.
- Fix: 'unordered, listedBefore, coversAfter: controls whose order the listing does not tell; seenOver, seenUnder: such controls whose order a screenshot told (peersOf says each).'

### F219 · `src/ui-tree/soft-keyboard.ts:17` · partly · low

- Reported (stale-reference, low, line 17 at the audit): for the in-tree model's configured dismissals (interact/keyboard-in-tree.ts)
- Audit evidence: accessoryDismissButton is imported and called in src/interact/keyboard-dismissal.ts:7 and :191. keyboard-in-tree.ts does not call it directly (it reaches the strategy through keyboard-dismissal.ts).
- Verification: accessoryDismissButton is called only in interact/keyboard-dismissal.ts:192. keyboard-in-tree.ts imports from keyboard-dismissal.js (line 17) and applies those strategies, so the cited file is the consumer of the dismissals but not the direct caller.
- Fix: Cite interact/keyboard-dismissal.ts#accessory strategy (used by keyboard-in-tree.ts).

### F224 · `src/ui-tree/usable-screen.ts:169` · partly · low

- Reported (doc-contradicts-code, medium, line 169 at the audit): a window may be short, never taller
- Audit evidence: usable-screen.ts:172 accepts size.height <= panelTurned.height * (1 + SCREEN_AGREEMENT_PCT / 100), and SCREEN_AGREEMENT_PCT is 2 (geometry.ts:353). The same comment says '(SCREEN_AGREEMENT_PCT of slack)', so a window up to 2% taller than the turned panel's short side still counts as turned.
- Verification: usable-screen.ts:172 accepts height <= panelTurned.height*(1+2/100), so a window can be up to 2% taller. The same comment states '(SCREEN_AGREEMENT_PCT of slack)', so 'never taller' is a loose shorthand that the parenthetical qualifies.
- Fix: Say: a window may be short, and taller only by that slack.

### F228 · `src/util/count.ts:6` · partly · low

- Reported (stale-reference, low, line 6 at the audit): "scroll.ts's swipesText and its turn count (scroll-text.ts's since 2026-10-09)"
- Audit evidence: swipesText is defined at src/interact/scroll-text.ts:268 (const swipesText = (n) => countOf(n, 'swipe')). Nothing named swipesText exists in src/interact/scroll.ts (rg finds no match). The parenthetical attaches only to the turn count, so a reader is sent to the wrong file for swipesText.
- Verification: swipesText now lives only in interact/scroll-text.ts:270. count.ts's comment is a dated history note (2026-10-08 review, move on 10-09), but its parenthetical attaches only to the turn count, so the pointer to scroll.ts for swipesText is stale and misleading today.
- Fix: Write "scroll-text.ts's swipesText (scroll.ts's before 2026-10-09) and its turn count".

### F229 · `src/util/regex.ts:31` · partly · low

- Reported (doc-contradicts-code, low, line 31 at the audit): "verify's two assert schemas (which flow/config's `assert:` step reuses)"
- Audit evidence: src/flow/config.ts:12 imports only elementAssertSchema from ../verify/element-assert.js. src/verify/assert.ts's assertSpecSchema (rect, color, ocr, screenshot) is not imported by flow/config.ts (its imports are at lines 3-14).
- Verification: regexSource is used by verify/element-assert.ts:34 and verify/assert.ts:139 (the two assert schemas) and by mcp/tools.ts:745. flow/config.ts imports only elementAssertSchema (config.ts:13, used at :306), so 'which flow/config reuses' is true only of the element-assert schema, not both.
- Fix: Say: verify's element-assert and assert schemas (flow/config's `assert:` step reuses the element-assert one).

### F230 · `src/verify/capture.ts:154` · partly · low

- Reported (stale-reference, medium, line 154 at the audit): "exec-out screencap 312–352 ms per call (docs/plans/2026-10-30-performance-backlog.md, D13 note (2026-10-31, averi_lab API 33))"
- Audit evidence: docs/plans/2026-10-30-performance-backlog.md line 43 (the D13 row) lists only small items (appHealth, finalFrame, type_pin, config cache, viewport/getprop parallel, status bands); there is no '### D13' section (rg '^### D13' finds nothing) and no 312–352 figure anywhere in the file. The only screencap timings there are in the D5 section (line 562: exec-out screencap -p 368 ms median), which is a different measurement.
- Verification: The backlog does have '### D13 — per-call overhead' (line 581) and a '312–352 ms per call' figure (line 584). The report was wrong that neither exists. But line 584 attributes 312–352 to 'D3's live baseline', and D13's own run was 347–365 ms, so the citation 'D13 note' is imprecise.
- Fix: Cite 'D13's note, quoting D3's live baseline (D13's own run: 347–365 ms)' or use 347–365 for D13.

### F231 · `src/verify/capture.ts:168` · partly · low

- Reported (misleading, medium, line 168 at the audit): "The same budget for every consumer: a verify leg, the screenshot tool, and an assert inside a flow all wait exactly the same"
- Audit evidence: src/verify/capture.ts:809 stops the re-capture loop as soon as a passed deadline is reached (Date.now() + recaptureMs >= deadline), and the header at lines 90-95 says the pixel poll passes its own deadline (CaptureOptions.deadline). So a polling assert's round waits less than the full stability budget. The same sentence is repeated in ARCHITECTURE.md line 353 ("the same budget for every consumer").
- Verification: The budget (5 re-captures, 300 ms) is the same for all consumers. But stableScreenshot breaks the loop when a caller's deadline is near (capture.ts:809), and the pixel poll passes its own deadline (header lines 90-95). 'Wait exactly the same' is overstated for a polling assert, though the header discloses this.
- Fix: Say: the same budget for every consumer, which a caller's CaptureOptions.deadline may cut short (the pixel poll does).

### F232 · `src/verify/eyes.ts:274` · partly · low

- Reported (misleading, low, line 274 at the audit): ΔE00 of two colours (the line test memoises it per pixel colour, oneColour).
- Audit evidence: distance() (eyes.ts:275) computes ΔE00 directly with no memo. The per-pixel-colour memo is in nearCount (eyes.ts:295-306), and it caches the within-threshold boolean, not the distance.
- Verification: distance() (eyes.ts:275) has no memo. The memo is in nearCount (eyes.ts:295-306), which caches a per-pixel-colour 'within threshold' boolean for oneColour. The parenthetical is a loose pointer, not a false claim.
- Fix: Reduce to 'ΔE00 of two colours.' and leave the memo note on nearCount.

### F233 · `src/verify/eyes.ts:354` · partly · low

- Reported (misleading, low, line 354 at the audit): A band's or the overlap's dominant colour counts only when it holds at least this share of the region (`sampleDominant`)
- Audit evidence: The DOMINANT_SHARE gate is applied only in judgePair (eyes.ts:487 and :504). judgeEdge (eyes.ts:214-215) and judgeClipLine (eyes.ts:261-262) take the band's sampleDominant result with no share check. sampleDominant (color-parity.ts:176-222) only returns the share; it does not gate anything.
- Verification: DOMINANT_SHARE is read only in judgePair (eyes.ts:374, 389, 487, 504). judgeEdge and judgeClipLine take sampleDominant without a share check. The constant's doc speaks of 'a band's or the overlap's' dominant, which are pair-judge terms, so it is imprecise rather than false.
- Fix: Prefix with 'judgePair:' or say the gate is the order judge's only.

### F234 · `src/verify/eyes.ts:411` · partly · low

- Reported (doc-contradicts-code, medium, line 411 at the audit): `clear` excuses a cover, so it is said only on pixel identity
- Audit evidence: src/verify/eyes.ts:100 defines OWN_PIXELS_MAX = 1 (one point of strays allowed), and src/verify/eyes.ts:436 returns 'clear' when `total - near <= OWN_PIXELS_MAX * scale * scale`, i.e. up to one point's worth of non-matching pixels, not identity. The same doc block (eyes.ts:412-416) itself says 'at most OWN_PIXELS_MAX points' worth of strays'.
- Verification: eyes.ts:436 returns 'clear' when total - near <= OWN_PIXELS_MAX*scale*scale (one point of strays allowed). 'Pixel identity' is therefore shorthand, and the same block (lines 403-407) states the OWN_PIXELS_MAX allowance and the strict nearCount rule.
- Fix: Say 'said only when the overlap is the control's own colour to within OWN_PIXELS_MAX points of strays'.

### F237 · `src/verify/ocr.ts:138` · partly · low

- Reported (misleading, low, line 138 at the audit): "so it survives packaging (`files: [dist]`)"
- Audit evidence: package.json "files" is ["dist","skill","SETUP.md","ARCHITECTURE.md","LICENSE"]. The shown value is an abbreviation. The rationale (the source is compiled into dist/, so it ships) holds.
- Verification: package.json files is ["dist","skill","SETUP.md","LICENSE"]. The evidence also lists ARCHITECTURE.md, which is not there. The rationale (embedded in dist/ so it ships) holds, and `files: [dist]` is only a shorthand for the one relevant entry.
- Fix: Say "so it ships inside dist/ (package.json files) with no build-step change".

### F239 · `src/verify/pixel-poll.ts:313` · partly · low

- Reported (misleading, low, line 313 at the audit): "treeFingerprint: every node's role, text, id and rect"
- Audit evidence: src/ui-tree/read-tree.ts:474-491 hashes each node's role, label, identifier, value and rect (via saysOf). The comment's "text" is an approximation that leaves out identifier and value distinctions, and the comment does not name the hashed fields.
- Verification: treeFingerprint hashes role, label, identifier, value and rect (read-tree.ts saysOf at :517, plus rect at :511). The comment's "role, text, id and rect" leaves out value. text and id are loose names for label and identifier.
- Fix: Say "every node's role, label, identifier, value and rect".

### F240 · `src/verify/poll-verdict.ts:12` · partly · low

- Reported (misleading, low, line 12 at the audit): "A leaf module since 2026-10-06, for the reason fail-closed.ts is one"
- Audit evidence: fail-closed.ts has no imports and is a true leaf. poll-verdict.ts has value imports from ../ui-tree/read-tree.js (PollMiss, line 2), ../ui-tree/miss.js (missOf, withMissNote, line 3) and ../util/duration.js (line 5). It is not a leaf of the import graph. What is true is that it imports no assert code and sits below assert.ts.
- Verification: fail-closed.ts has no imports, but poll-verdict.ts imports ui-tree/read-tree, ui-tree/miss and util/duration, so it is not a leaf of the import graph. The same sentence gives the reason: both pixel and tree asserts need it and assert.ts imports the other, which is the sense in which it sits below assert.ts. "Leaf" is loose rather than false.
- Fix: Say "A module below assert.ts that imports no assert code since 2026-10-06, for the reason fail-closed.ts is".

### F241 · `src/verify/rect-parity.ts:552` · partly · low

- Reported (misleading, low, line 552 at the audit): "\|device width / figma frame width − 1\| above this prints the width-bias note."
- Audit evidence: The width-bias note is printed only for iOS, using the ios window width (src/verify/rect-parity.ts:585-588, where ios.width is compared with r.frameWidth). The constant's comment describes it generically as the device width.
- Verification: The note is printed only for the ios width (rect-parity.ts:575-595, the Android comment says Android gets no such line), against a declared figma_frame_width. The constant's comment says "device width", which is imprecise but nearby comments explain it.
- Fix: Say "\|iOS window width / declared figma frame width − 1\| above this prints the width-bias note."

### F242 · `src/verify/rect-parity.ts:667` · partly · low · orchestrator-checked

- Reported (stale-reference, medium, line 667 at the audit): 'was never applied on that platform (that IS a finding — accessibility.md §2).' (text printed to the user when an anchor is MISSING)
- Audit evidence: No file named accessibility.md exists in this repo: not at the root, not under docs/, skill/, AGENTS.md or CLAUDE.md, and no in-repo doc cites it as a file. The printed pointer therefore leads the reader to a document they cannot open here. The same citation appears in src/verify/text-parity.ts and src/verify/color-parity.ts comments.
- Verification: No accessibility.md exists in the averi repo. docs/bugs/2026-08-27-user-settings-run-four-findings.md:236 calls it "the consuming repo's `accessibility.md`", so it is the app-under-test's contract and not a stale pointer. The printed text does assume the reader has that file, and users without it cannot follow the pointer.
- Fix: Say "your app's accessibility contract (e.g. accessibility.md §2)" or drop the section pointer from the printed sentence.

### F243 · `src/verify/rect-parity.ts:722` · partly · low

- Reported (doc-contradicts-code, low, line 722 at the audit): "its caller asks `windowWidth(tree, screen)` for each round's tree against the adapter's memoized screen"
- Audit evidence: assertRect (src/verify/assert.ts:413-427) calls ScreenWitness.read once and then witness.judge(tree) for each round. ScreenWitness.judge (src/verify/capture.ts:677) reaches windowWidth through windowFor (capture.ts:765), with the size and the screen witness passed in. The witness can also be re-read once fresh before a wider-than-screen refusal, which the comment omits.
- Verification: assertRect's planRect (assert.ts:455-460) reads ScreenWitness once and calls witness.judge(tree) each round. judge reaches windowWidth via windowFor (capture.ts) and may re-read the screen fresh once before a refusal. So the comment names the inner function and omits the witness and the one re-read. The adjacent paragraph does say the window comes from windowWidth, which softens it.
- Fix: Say "its caller judges each round's tree with capture.ts#ScreenWitness.judge (windowWidth against the witness's screen, read once and re-read fresh at most once before a wider-than-screen refusal)".

### F244 · `src/verify/scale.ts:280` · partly · low

- Reported (misleading, medium, line 280 at the audit): viewport() is memoized for the adapter's life, so a screen changed after it was read ... would refuse until the server restarted
- Audit evidence: The memo is not permanent for the adapter's life in the way implied: ViewportMemo drops failed reads and offers get({fresh:true}) (src/adapters/viewport-memo.ts:9-25, types.ts:1231). ScreenWitness.judge (src/verify/capture.ts:679-684) re-reads with viewport({fresh:true}) on a widerThanScreen refusal, so the stated consequence is not what the code does; the next sentence describes the actual re-read.
- Verification: viewport() is memoized without fresh. ViewportMemo drops failed reads and get({fresh:true}) replaces the memo (viewport-memo.ts), and ScreenWitness.judge re-reads before a wider-than-screen refusal (capture.ts). "Would refuse until the server restarted" is the counterfactual for a plain memo, and the very next sentence gives the re-read, so it is dated and could be read as current behaviour, but it is not false.
- Fix: Say "viewport() memoizes a successful read, so a screen changed after it was read (a fold or unfold, `wm size`) would be judged stale; a wider-than-screen refusal carries widerThanScreen and its caller re-reads once..."

### F249 · `tests/architecture/layering.test.ts:187` · partly · low

- Reported (misleading, low, line 187 at the audit): The src files `source`, the text of `file`, imports, resolved (`.js` → `.ts`).
- Audit evidence: importsIn (layering.test.ts:187-191) keeps only specifiers that start with '.' (`.filter((s) => s.startsWith('.'))`) and resolves them against dirname(file); it does not return src files. Bare and node: specifiers are dropped. The JSDoc is garbled and does not describe the return value.
- Verification: importsIn (layering.test.ts:188-191) returns the resolved paths of relative import specifiers, with .js mapped to .ts, dropping bare and node: ones. The JSDoc is garbled, but it is read as "the src files imported by `source`", which is approximately right because relative imports from src files land in src.
- Fix: Say "Resolved paths of the relative imports in `source` (the text of `file`), `.js` mapped to `.ts`; bare specifiers are dropped."

### F251 · `tests/flow/config.test.ts:90` · partly · low

- Reported (stale-reference, low, line 90 at the audit): the config-policy table promises every broken averi.yaml fails a call naming it
- Audit evidence: The header of src/mcp/config-policy.ts (lines 1-33) describes which tools read which fields. It contains no promise that a broken averi.yaml fails a call naming the file. The rule is stated in src/flow/tool-config.ts:39-40: 'a present-but-invalid file FAILS it, naming the file, under optional as under required'.
- Verification: The rule is stated in src/flow/tool-config.ts:39-40 and ARCHITECTURE.md:594, and config-policy.ts:1-34 says it is the mapping and that the rule behind it is tool-config's. The test comment's "config-policy table promises" thus attributes the promise loosely, since the table is the mapping and the rule is elsewhere. Spirit is right.
- Fix: Say "flow/tool-config.ts's rule (a present-but-invalid averi.yaml fails a call naming the file) is promised for every tool in the config-policy table."

### F256 · `tests/helpers/rounds.ts:119` · partly · low

- Reported (misleading, low, line 119 at the audit): (outermost first, each clipsDescendants; with none, one screen-sized scrollable unless unscrolled)
- Audit evidence: rounds.ts:143-145 wraps the matches in one screen-sized scrollable only when there are matches (matches.length === 0 gives matches unwrapped) and row.unscrolled is not set.
- Verification: rounds.ts:141-145 wraps the matches in a screen-sized scrollable only when there is no container chain, `unscrolled` is not set, and matches is non-empty. 'With none' is read as 'no containers', so the missing no-matches condition is real but minor.
- Fix: Add 'and at least one match' to the wrap rule.

### F261 · `tests/interact/keyboard-in-tree.test.ts:884` · partly · low

- Reported (stale-reference, low, line 886 at the audit): since 2026-10-08 that is the "found, but never held still" sentence, not the never-found one
- Audit evidence: No source contains the sentence 'found, but never held still' (grep over src finds none). The current wording is 'found once, but no second read came within the budget to confirm its position' in src/interact/resolve.ts:277-278. The comment is changelog text about a sentence that no longer exists; the current-behaviour claim in the same block (lines 888-889, 'since 2026-10-09 worded "found once, but no second read came"') does match resolve.ts:277.
- Verification: The sentence 'found, but never held still' is gone from src; resolve.ts:270-278 words it 'found once, but no second read came within the budget'. The comment does say the wording changed on 2026-10-09 and gives the current wording, so it is history, not a false claim. Its present-tense 'that is the ... sentence' is stale and confusing.
- Fix: Keep only the current wording: the second look reads 'found once, but no second read came' (resolve.ts).

### F263 · `tests/truth/live-rejudge.test.ts:156` · partly · low

- Reported (stale-reference, low, line 126 at the audit): round 7's A2 (LV6 fixed: src arch/r23-parked a1b0b82 through --side, the lab app truth/round-7 461d6fd)
- Audit evidence: `git branch -a` lists no branch named arch/r23-parked or truth/round-7, nor any other round/fix branch that the file cites (fix/r9-lr3, bugs/r14-le1, arch/r23-*). The cited commit SHAs are not checked here. A reader cannot follow these branch names. The same pattern recurs across live-rejudge.test.ts (lines 141, 147, 154, 162, 174, 184, 362, 773).
- Verification: Only main, fix/a38a-idb-backdrop and fix/a38b-band-stroke exist, so arch/r23-parked and truth/round-7 are gone as branches. The cited SHAs a1b0b82 and 461d6fd do resolve (git cat-file says commit). The branch names are provenance for merged-then-deleted branches, not a false claim.
- Fix: Keep the SHAs and drop the branch names, or leave as is (harmless).

## Refuted (38)

### F011 · `CLAUDE.md:13` · refuted

- Reported (doc-contradicts-doc, low, line 13 at the audit): "The lab runs are part of every release: `npm run truth:lab` and live.ts (Gate B, yours), `npm run truth:lab:ios` (Gate C, the owner's). They are not optional and do not run on a schedule."
- Audit evidence: docs/release.md:167-168 and CLAUDE.md:17 say a Gate C with no lab simulator may be waived by the owner ("only the owner may waive Gate C"), so the lab runs are optional for a release in that case. Both documents agree on the waiver, so the sentence "not optional" overstates the rule.
- Verification: CLAUDE.md says the lab runs are 'not optional' for the agent, and the very same block states that only the owner may waive Gate C and that a waiver is recorded (release.md:181-182 says the same). The waiver is the stated exception, not a contradiction; the rewrite would not change behaviour.

### F035 · `docs/release.md:204` · refuted · orchestrator-checked

- Reported (misleading, medium, line 190 at the audit): Gate D step 4: "The body follows the 0.9.0 release commit (`git show v0.9.0`)" as the model for the release commit body, including "what was not proven".
- Audit evidence: `git show -s --format=%B a6df8083` (tag v0.9.0) says "Released without the on-device run of the final tree", and `git show --stat a6df8083` shows only package.json and package-lock.json changed, no record file. That release predates the Gate B/C rules in CLAUDE.md:15-16 and docs/release.md:177-178, which forbid committing a bump before A, B and C pass. Also docs/releases/ does not exist in the repo, so the record location in docs/release.md:187 and CLAUDE.md:21 has no precedent.
- Verification: The 0.9.0 tag body does contain exactly the paragraphs the doc lists (why minor not patch, what consumers will see change, 'Released without the on-device run' = what was not proven). The doc points to it only for the body's content, not for gates or the record. docs/releases/ not existing is expected before the first release under the new rules.

### F040 · `fixtures/apps/android/src/main/java/dev/averi/lab/Forms.kt:18` · refuted

- Reported (misleading, low, line 18 at the audit): The window gets the IME's insets (adjustResize under edge to edge: nothing is resized or panned)
- Audit evidence: Forms.kt:273 sets WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE, the mode whose documented effect is resizing the window. Forms.kt:268 repeats "neither resized nor panned", and nothing in the repo shows the edge-to-edge behaviour the comment relies on.
- Verification: MainActivity.kt:52 calls enableEdgeToEdge(), and under edge-to-edge adjustResize delivers IME insets without resizing the window, which is exactly what the comment says. The evidence only argues from the mode's name.

### F046 · `fixtures/apps/android/src/main/java/dev/averi/lab/Views.kt:136` · refuted

- Reported (misleading, low, line 136 at the audit): T's a TextView `Saved` (a toast)
- Audit evidence: Views.kt:143-150 builds T's cover as a TextView with text "Saved", not an android.widget.Toast.
- Verification: The cover is a TextView showing 'Saved', and '(a toast)' describes the UI pattern it imitates (an rn-banner style toast), not android.widget.Toast. Nothing in the comment claims the Toast API.

### F089 · `scripts/truth/batch/runner.ts:905` · refuted

- Reported (misleading, low, line 879 at the audit): a check that throws is not shown, never the run's error
- Audit evidence: runner.ts:884-885 (shown): a throwing precondition check returns { ok: false, why: 'its check threw: …' }. That why is printed on the block's INCONCLUSIVE line (runner.ts:464 and 468), so it is shown as the block's reason and is not a run error.
- Verification: shown() (runner.ts:906-913) turns a throw into { ok: false, why: 'its check threw: ...' }. 'Is not shown' means the precondition is not shown met, and 'never the run's error' means the throw does not abort the run. The comment matches the code and the evidence misreads 'shown'.

### F093 · `scripts/truth/chooser-premise.ts:186` · refuted

- Reported (misleading, low, line 186 at the audit): This is the one guard on the reads: a read that fails is its fact unread, with adb's words (lab-device.ts#adbSaid), never a throw.
- Audit evidence: A failed adb read is caught and unread (chooser-premise.ts:198-204), but the guard is not: chooser-premise.ts:196 calls await lab.guard() outside any try, and lab-device.ts:452 focus() awaits this.guard() before its try. chooser-premise.ts:195 says a guard refusal is 'no read's failure', so the guard is meant to throw.
- Verification: The sentence is about the reads: a failed adb read is caught and returned as unread via adbSaid (shell helper, ~L200). Line ~195 says explicitly that the lab guard's refusal is not a read's failure, so the guard throwing is already documented and does not contradict the claim.

### F118 · `scripts/truth/replies.ts:494` · refuted

- Reported (stale-reference, low, line 494 at the audit): The ocr assert's fail-closed tail (src/verify/fail-closed.ts: `failing closed, rendered text unchecked`).
- Audit evidence: src/verify/fail-closed.ts contains 'failing closed' only in comments (lines 8, 17, 24) and has no 'rendered text unchecked'. That phrase is in src/verify/text-parity.ts (comment near line 1023) and is matched by the regex at replies.ts:495.
- Verification: fail-closed.ts:29-30 failClosed builds `; failing closed, ${unchecked} unchecked`, and assert.ts:496/504 and text-parity.ts:1054 pass 'rendered text' (a member of Unchecked). So the fail-closed tail with 'rendered text unchecked' is produced via fail-closed.ts; the pointer is accurate.

### F120 · `scripts/truth/schema.ts:517` · refuted

- Reported (misleading, low, line 517 at the audit): ControlTruth's `not-rendered` for a target: not in `targets`, which hold a frame
- Audit evidence: `not-rendered` is a Situation value (schema.ts:605) for form controls (ControlTruth), not for catalog targets. CellTruth.absent targets carry no situation at all.
- Verification: 'ControlTruth's `not-rendered` for a target' is an analogy: the Situation 'not-rendered' means the app laid out no frame, the same condition for a target. Reads as 'the target's counterpart of'; no behaviour claim is wrong.

### F126 · `src/adapters/android-start.ts:89` · refuted

- Reported (misleading, medium, line 89 at the audit): any monkey refusal at exit 0 reads as `started`, as an uncaught exception in `am` does (AM_ERROR_LINE_RE)
- Audit evidence: runStart (android-start.ts:206-211) matches AM_ERROR_LINE_RE over am's output at any exit: READING gives 'am start' exit0IsVerdict false (line 167), so an am Error line or java.lang exception at exit 0 returns kind 'refused' (line 211), not 'started'. Only monkey short-circuits exit 0 to 'started' (line 197). The parenthetical claims am's uncaught exception reads as started, which the code contradicts.
- Verification: The bullet is about a shell-v1 device where the exit status is lost; the same header (Deliberately NOT matched) says am's old-style `Exception in thread "main" java.lang…` at exit 0 is not matched and reads as started on such devices. So 'as an uncaught exception in am does' is consistent; the claim that am Error lines at exit 0 refuse is a different case. Only the (AM_ERROR_LINE_RE) parenthetical is loosely attached.

### F141 · `src/adapters/types.ts:1020` · refuted

- Reported (doc-contradicts-doc, low, line 1020 at the audit): LinkChooser: "the name is D55's, kept through A10 as LinkAlert's is"
- Audit evidence: types.ts:1070-1074 says of LinkAlert: "The name is D54's, kept through A10." The two comments disagree about which decision ID the LinkAlert name carries.
- Verification: The LinkChooser comment says 'the name is D55's, kept through A10 as `LinkAlert`'s is'. This means LinkAlert's name was also kept through A10, and it does not say LinkAlert's name is D55's. The LinkAlert doc (l.~1070) says 'The name is D54's, kept through A10', so the two comments do not disagree.

### F166 · `src/interact/fill-verdict.ts:7` · refuted

- Reported (stale-reference, low, line 7 at the audit): Until 2026-10-09 ... 'is it verified' was `fillUnverifiedText(...) === undefined` ... `fillClearedText`, ... `clearAloneHead`
- Audit evidence: fillUnverifiedText, fillClearedText and clearAloneHead appear only in this comment (fill-verdict.ts:7-12); no definition exists in src. The same holds for `preLen` at fill.ts:271-272.
- Verification: fillUnverifiedText, fillClearedText and clearAloneHead appear only in fill-verdict.ts:8-10, but the paragraph is explicitly dated history ('Until 2026-10-09 each of them asked...') and cites the bug doc; it does not claim the functions exist. preLen is no longer found anywhere in src.

### F172 · `src/interact/keyboard-window.ts:119` · refuted

- Reported (stale-reference, low, line 119 at the audit): `firstLook` is the `denied` verdict's branch in `windowModel.guard` below; `afterBack`'s branch is the skeleton's one shared ternary over the confirming look
- Audit evidence: No symbol `firstLook` or `afterBack` exists in src (rg finds them only in the comment block at keyboard-window.ts:119-137; the afterBack hits in tests are unrelated local helpers). The denied branch is the inline `if (verdict.kind === 'denied')` at keyboard-window.ts:317. The skeleton ternary is unnamed, at keyboard.ts:190-192 (`look.verdict.kind === 'covered' ? { stillUp ... } : { gone ... }`).
- Verification: The block is dated history (2026-10-07) describing two deleted functions; its pointers do resolve: windowModel.guard's `if (verdict.kind === 'denied')` exists at keyboard-window.ts:317 and the shared ternary is at keyboard.ts:~190 (resolveClearOfKeyboard). Not a stale pointer.

### F179 · `src/interact/scroll.ts:243` · refuted

- Reported (misleading, low, line 242 at the audit): six paced strokes reach ~3 400 pt
- Audit evidence: The paced stroke is 524 pt (stroke-plan.ts:264-270, 'a full stroke, 524 pt'; scroll.ts:236 says the same). Six of them are 6 × 524 = 3 144 pt, not ~3 400 pt, and the comment gives no other stroke length to reconcile the figure.
- Verification: The ~3 400 pt is distance carried, not stroke length: stroke-plan.ts:269 says 524 pt in 1.5 s carried the list ~11 rows (~570 pt); 6 x ~570 is ~3 400, set against the fling's ~6 200. The comment says 'reach', consistent with that.

### F195 · `src/ui-tree/draw-order.ts:1320` · refuted

- Reported (misleading, low, line 1320 at the audit): seenClear row doc: 'Asked only of a text the tree suspects lies in the target's touch margin (cover.ts#marginText ...)'
- Audit evidence: The row itself (draw-order.ts:1331-1333) tests only `about.orderSeen?.between(...)?.seen === 'clear'` for any node, with no marginText or role check. The restriction lives upstream: src/ui-tree/eyes.ts:3 imports marginText and only margin pairs get an eyes answer.
- Verification: The seenClear row doc says 'Asked only of a text the tree suspects lies in the target's touch margin ... so a tree-only caller, which hands in no order seen, keeps every such cover.' It describes which pairs are put to the eyes (eyes.ts imports marginText). The row only reads orderSeen, and the doc says the restriction comes from the eyes being asked, so it reads correctly in context.

### F197 · `src/ui-tree/draw-order.ts:1644` · refuted

- Reported (false, medium, line 1644 at the audit): 'outside draw order only ui-tree/miss.ts reads the same mark' (the flatList mark), with the enumeration through geometry.ts and standing.ts#sceneOf
- Audit evidence: src/ui-tree/reading-order.ts:65 reads `parent.node.flatList !== true` directly, and src/ui-tree/standing.ts:827 and :864, geometry.ts, later-edges.ts and interact/within.ts call listsAncestry(tree), which reads the same mark. The enumeration of readers is incomplete and reads as exhaustive.
- Verification: The doc says the dialect is read in draw-order and the reading-order module, with listsInReadingOrder that module's alone. It then says only miss.ts reads it outside draw order, and names geometry.ts and standing.ts#sceneOf, which go through listsAncestry. reading-order.ts:65 is the module the doc already names. rg for the flatList property finds no other direct reader outside miss.ts, reading-order.ts and types. standing.ts, later-edges.ts and within.ts call listsAncestry, which is the sanctioned route.

### F198 · `src/ui-tree/element-spec.ts:7` · refuted

- Reported (doc-contradicts-code, medium, line 7 at the audit): averi.yaml is one consumer (tap/fill/wait steps), the assert layer is another, and neither owns the vocabulary (lines 7-10); describeElementSpec 'appears in flow traces AND in assert descriptions' (lines 73-76)
- Audit evidence: Consumers of element-spec.ts are src/flow/config.ts:6-10, src/flow/condition.ts:2, src/flow/engine.ts:13, src/interact/resolve.ts:2. No file under src/verify/ imports element-spec or describeElementSpec; verify/assert.ts (line 32) imports only findBySpec from ui-tree/selectors.js.
- Verification: The assert layer does consume element-spec. verify/assert.ts:6 imports describeElementSpec, elementSpecSchema and ElementSpec, and calls describeElementSpec in its descriptions (lines 375, 445, 493, 525, 617). verify/element-assert.ts:2 imports elementSpecSchema, and verify/pixel-poll.ts imports ElementSpec. Both claims in the doc hold.

### F216 · `src/ui-tree/selectors.ts:6` · refuted

- Reported (stale-reference, medium, line 6 at the audit): Selector syntax (ARCHITECTURE.md §3): space-separated conditions ... id:login_pin_field text:"Continue"
- Audit evidence: ARCHITECTURE.md §3 ("## 3. Device Adapter layer", lines 85-181) is about the device adapters; no selector grammar appears anywhere in ARCHITECTURE.md (grep for `text~`, `id:`, `role:button` finds nothing describing the syntax). The grammar is defined only by CONDITION_RE at selectors.ts:25.
- Verification: ARCHITECTURE.md §3 spans lines 350-441, and the Selectors paragraph at line 436-438 sits inside it, giving the identical grammar (id:login_pin_field, text:"Continue", role:button label~"Pay.*", fields, : and ~). The reported evidence that no selector grammar appears is wrong.

### F217 · `src/ui-tree/selectors.ts:203` · refuted

- Reported (misleading, low, line 203 at the audit): Returns undefined when still ambiguous.
- Audit evidence: preferInteractive returns undefined whenever `interactive.length !== 1` (selectors.ts:207-208), which includes zero interactive matches as well as several; zero is not 'ambiguous'.
- Verification: selectors.ts:203-209: preferInteractive is called on multiple matches; with zero interactive among several, the choice is still ambiguous, so 'when still ambiguous' reads correctly.

### F218 · `src/ui-tree/selectors.ts:216` · refuted

- Reported (stale-reference, low, line 216 at the audit): `resolveOne` / `findOne` lived here until 2026-10-03 ... `lived here until 2026-10-04` for the viewport predicates
- Audit evidence: Neither resolveOne nor findOne is defined in src/ui-tree/selectors.ts (lines 216-222 are the only mention); the comment describes removed code and a past move rather than current behaviour.
- Verification: selectors.ts:216-222 are deliberate dated history notes. They point to interact/resolve.ts#resolveNow, which exists (resolve.ts:206), and to geometry.ts. They describe a past move and do not claim current behaviour.

### F220 · `src/ui-tree/soft-keyboard.ts:41` · refuted

- Reported (stale-reference, medium, line 41 at the audit): The in-tree `dismissKeyboard` reads it too, and acts only on `shown`
- Audit evidence: No function named dismissKeyboard exists in src; the only matches are the flow config field (src/flow/config.ts:34, :304). The in-tree dismissal is `async dismiss(...)` at src/interact/keyboard-in-tree.ts:395.
- Verification: dismissKeyboard exists at src/interact/keyboard.ts:229 and delegates to keyboardModel(adapter).dismiss, which is the in-tree dismiss at keyboard-in-tree.ts:395. keyboard-in-tree.ts's own comments also call it dismissKeyboard. The reported claim that no such function exists is wrong.

### F222 · `src/ui-tree/standing.ts:1483` · refuted

- Reported (misleading, low, line 1592 at the audit): idb's flat list, which cannot tell, counts as none, as the pixel assert's `pinned` and `stuck` do
- Audit evidence: standing.ts:1000 scrollable() reads `inScroller === false` as pinned and `inScroller === undefined` as stuck, so `pinned` does not treat undefined as none. pinnedSurface (standing.ts:1605-1609) only tests `inScroller === true`, which is a separate rule.
- Verification: standing.ts:1482-1483 says an undefined (idb) inScroller counts as in no scroll view, as the pixel assert's pinned and stuck do. In scrollable() (standing.ts:890-891) undefined yields 'stuck' (no scroll lifts it) and false yields 'pinned', so undefined is treated as no scroll in both places. Wording is loose but the comparison holds.

### F223 · `src/ui-tree/system-bar.ts:35` · refuted

- Reported (doc-contradicts-doc, low, line 35 at the audit): No platform named, and the band in the tree's units — pt on iOS, px on Android
- Audit evidence: The same doc block names the platforms (system-bar.ts:36, 'pt on iOS, px on Android'), and the header at lines 7-8 names iOS's safe area and Android's window insets.
- Verification: 'No platform named' describes the generated clause (underSystemBar output names no platform), not the doc block. The doc then explains the units, so it is not a contradiction.

### F225 · `src/ui-tree/verdict.ts:9` · refuted

- Reported (misleading, low, line 9 at the audit): a cold launch's Android decor for ~9 s
- Audit evidence: src/ui-tree/bare-tree.ts:102-104 records the measured ladder read during the Android cold launch as +5.3 to +13.8 s, before login_screen rendered at +18.3 s. '~9 s' is a paraphrase of a range, not the measured figure.
- Verification: bare-tree.ts:103-104 gives +5.3 to +13.8 s, a span of about 8.5 s, so '~9 s' is a fair duration summary of the same measurement, not a contradicting figure.

### F226 · `src/ui-tree/window-mark.ts:19` · refuted

- Reported (misleading, low, line 19 at the audit): Decisions 3 and 4 then read it as they read the parser's: the wait names the layer, scroll_until sends no stroke but on the window's own scroll view
- Audit evidence: docs/adr/0018 Android window amendment, decision 3 (lines 1249-1258) is 'asked on a miss only, never per poll', and decision 4 (lines 1260-1266) is 'the scroll first' for a presented window holding its own scroll view. Neither says that the wait names the layer, and 'sends no stroke but on' is not what decision 4 states.
- Verification: The comment's 'Decisions 3 and 4' follows the ADR's own sentence in the 2026-10-18 amendment 'Android's presented window' (lines 792-805): decision 3 covers the byMarks scroll_until stop except on a scroll view of its own, and decision 4 covers the wait that names the layer. The reported evidence looked at the 2026-10-24 amendment's decisions 3 and 4 instead.

### F227 · `src/ui-tree/window-mark.ts:35` · refuted

- Reported (stale-reference, low, line 35 at the audit): never a false `Tapped` (ADR 0018's invariant)
- Audit evidence: docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md has no occurrence of 'invariant' (rg count 0), and the Android window amendment at its lines 1209-1290 does not state a never-a-false-Tapped rule in those words.
- Verification: ADR 0018 states the rule: 'a misreading costs a refusal or a stop, never a false `Tapped`' at lines 1299 and 1546. The word 'invariant' is absent, but the pointer is valid.

### F238 · `src/verify/pixel-poll.ts:147` · refuted

- Reported (misleading, low, line 147 at the audit): "`inferScreenSize`'s (the screen's shape, ui-tree/usable-screen.ts#usableScreen)"
- Audit evidence: inferScreenSize is defined at src/ui-tree/geometry.ts:130. The parenthetical points to usable-screen.ts#usableScreen, which is where the usable screen is derived (src/ui-tree/usable-screen.ts:98). A reader looking for inferScreenSize there will not find it.
- Verification: usableScreen (usable-screen.ts:98) is where the round's tree is walked by inferScreenSize (line 108). The parenthetical names the caller that makes the walk, in a list of walks per round, and says nothing about where inferScreenSize is defined. Pointing at the caller is a reasonable reading.

### F245 · `src/verify/text-hint.ts:22` · refuted

- Reported (misleading, low, line 22 at the audit): the tree layer, which "knows no averi.yaml" (ARCHITECTURE.md §2)
- Audit evidence: ARCHITECTURE.md:175 states the rule as 'adapters know no averi.yaml'; the ui-tree layer is described at ARCHITECTURE.md:64 without that phrase. The quoted sentence is attributed to the wrong layer.
- Verification: ARCHITECTURE.md §2 (starts line 37) at line 136 describes the UI tree layer: "Knows no platform command and no averi.yaml." The comment attributes this to the tree layer in §2, which is correct. The quotation is a slight paraphrase, and the auditor cited the adapters line instead.

### F246 · `src/verify/text-parity.ts:436` · refuted

- Reported (stale-reference, low, line 436 at the audit): Until 2026-10-05 they were split — `textRecognizer` produced the notes and a separately exported `measureTextLeg` took the engine as a bare argument
- Audit evidence: No `textRecognizer` exists in src (rg finds only this comment); measureTextLeg is now a non-exported function (text-parity.ts:500) reached only via textMeasurement (line 464).
- Verification: The sentence is explicitly dated history ("Until 2026-10-05 they were split") and explains why one function owns both. measureTextLeg exists (text-parity.ts:500) and was exported then. The absence of `textRecognizer` today is exactly what the history says. Not a stale reference, though the sentence could be deleted without loss.

### F250 · `tests/architecture/layering.test.ts:193` · refuted

- Reported (misleading, low, line 193 at the audit): The src files a module imports.
- Audit evidence: importsOf (layering.test.ts:193-194) returns importsIn(file, readFileSync(file)), which is the resolved relative-import targets only (layering.test.ts:187-191). Targets outside src/ and non-relative imports are not included, so 'the src files a module imports' overstates the result.
- Verification: importsOf returns importsIn(file, readFileSync(file)), the resolved relative imports. For a module under src/ these are src files, so "the src files a module imports" is effectively correct. Dropping bare imports is not an overstatement of src imports.

### F255 · `tests/helpers/lazy-list.ts:7` · refuted

- Reported (stale-reference, medium, line 7 at the audit): (... docs/bugs/2026-10-09-android-scroll-until-fully-trusts-bounds-clipped-to-scroll-container.md and ...-scroll-until-fling-skips-target-in-lazy-list.md)
- Audit evidence: The first cited file exists. The second does not exist under that name: the real file is docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md (no 'android-'), which src/adapters/android.ts's dragSpeed comment cites correctly.
- Verification: The second reference is written '…-scroll-until-fling-skips-target-in-lazy-list.md'. The leading ellipsis abbreviates the shared date prefix, and the real file is docs/bugs/2026-10-09-scroll-until-fling-skips-target-in-lazy-list.md, so the tail matches. The reference is not stale.

### F258 · `tests/helpers/sleep-recorder.ts:18` · refuted

- Reported (false, medium, line 18 at the audit): fill.test.ts and the two keyboard-*.test.ts keep a no-yield recorder of their own ... they fake Date for every test and their recorders advance it
- Audit evidence: tests/interact/keyboard-dismissal.test.ts:20 is vi.mock('../../src/util/sleep.js', () => ({ sleep: async () => {} })) with no recorder and no vi.useFakeTimers in that file. The recorder-with-Date-advance pattern is in keyboard-in-tree.test.ts:27-36 and keyboard-window.test.ts:24-33. 'the two' does not name a set: six keyboard-*.test.ts files exist (tests/ui-tree/ and tests/interact/).
- Verification: The recorder-with-Date-advance pattern is in keyboard-in-tree.test.ts:28-36 and keyboard-window.test.ts:25-33, plus fill.test.ts:21-28. Those are exactly 'fill.test.ts and the two keyboard-*.test.ts'. keyboard-dismissal.test.ts mocks sleep as a no-op but is not claimed to share the clock rule. The comment is accurate, only unnamed.

### F259 · `tests/helpers/synthetic-android-trees.ts:6` · refuted

- Reported (stale-reference, low, line 6 at the audit): so it is no wrapper's own control (ui-tree/draw-order.ts#ownControl)
- Audit evidence: No function or constant named ownControl exists in src (grep). src/ui-tree/draw-order.ts defines ownContent (line 480), ownButton (567), ownField (586) and ownLabelOf (607). Line 487 of draw-order.ts also documents a non-existent ownControl.
- Verification: `ownControl` exists as a rule key in the rule table in src/ui-tree/draw-order.ts (line ~1159, `ownControl: { target: ... ownButton \|\| ownField ... }`). It is also cited in ADRs 0014/0016 and a bug record. The finding's grep only looked for a function or constant and missed the object key.

### F264 · `tests/util/regex.test.ts:7` · refuted

- Reported (stale-reference, low, line 7 at the audit): In tests/verify/text-hint.test.ts until T22 moved the helper to src/util/regex.ts
- Audit evidence: No file tests/verify/text-hint.test.ts exists (ls tests/verify has no hint file). textHint is exercised only indirectly by tests/verify/assert.test.ts. The comment cites a path that no longer exists, so a reader cannot follow it.
- Verification: tests/verify/text-hint.test.ts did exist and was removed by commit 822445c1 (T22, git log). The comment states history ('until T22 moved the helper'), and ADR 0038:1677 and the performance backlog say the same. The pointer is accurate as history.

### F265 · `tests/verify/assert.test.ts:2147` · refuted

- Reported (misleading, low, line 2082 at the audit): without one it behaves like iOS — no oracle, nothing queried, nothing changed
- Audit evidence: src/verify/pixel-poll.ts:110-113: the soft-keyboard reading is 'the adapter's oracle when it has one, else the round's own tree', so without an oracle the round's tree is read and asked 'overlapping'. Only the oracle is not queried.
- Verification: pixel-poll.ts:~110-113 reads the adapter's oracle when it has one, else the round's own tree. 'No oracle, nothing queried' is literally true without an oracle, and iOS has none either. The tree read is not an oracle, and the tests pin 'nothing changed'. Reads correctly in context.

### F266 · `tests/verify/baseline-confirmation.test.ts:27` · refuted

- Reported (stale-reference, low, line 27 at the audit): fill.test.ts and the two keyboard-*.test.ts keep a no-yield recorder
- Audit evidence: Three tests/interact/keyboard-*.test.ts files mock util/sleep: keyboard-dismissal.test.ts:20, keyboard-in-tree.test.ts:28, keyboard-window.test.ts:25 (plus fill.test.ts:20). The count 'two' does not match.
- Verification: Same phrase as F258. The no-yield recorders live in fill.test.ts plus keyboard-in-tree and keyboard-window, so 'the two keyboard-*.test.ts' is correct. keyboard-dismissal's no-op mock is a different thing.

### F267 · `tests/verify/ciede2000.test.ts:8` · refuted

- Reported (stale-reference, low, line 8 at the audit): cross-checked against the superrepo's verified scripts/color-parity.py on 2026-08-14
- Audit evidence: No scripts/color-parity.py exists in this repo (scripts/ holds differential, is-main.ts, mutation, perf, release, truth). The cross-check lives outside this repo and cannot be verified here.
- Verification: The comment says 'the superrepo's verified scripts/color-parity.py', so it already says the script is outside this repo. Other tests refer to 'the superrepo layer' the same way. This is an external reference, not a stale in-repo pointer.

### F268 · `tests/verify/eyes-apart.test.ts:17` · refuted

- Reported (stale-reference, low, line 17 at the audit): (T1, as eyes-order.test.ts)
- Audit evidence: tests/verify/eyes-order.test.ts:18-20 states the same fake-Date rule but never mentions T1; T1 appears only in docs/plans and docs/truth files, not in the test.
- Verification: T1 is the plan item that introduced the shared sleep recorder, which tests/helpers/sleep-recorder.ts cites ('Since T1 (2026-11-02)'). 'as eyes-order.test.ts' points to the sibling that uses the same fake-Date rule (eyes-order.test.ts:18-20). The pointer is valid.

### F269 · `tests/verify/rect-parity.test.ts:57` · refuted

- Reported (stale-reference, low, line 57 at the audit): The real bugs the Python script caught ... are ported as cases below
- Audit evidence: No Python parity script exists in this repo (find over the repo shows only color-parity.ts/test and fixtures' node_modules .py files). tests/verify/color-parity.test.ts:509 makes the same 'Python script's self-test' attribution.
- Verification: docs/verification.md:121-122 says the rect assert is a port of the convergence superrepo's `rect-parity.py`. The 'Python script' is therefore a documented external origin, not a dangling in-repo reference.

## Obsolete: the text is gone (11)

### F001 · `ARCHITECTURE.md:63` · obsolete

- Reported (doc-contradicts-code, low, line 63 at the audit): `usableSize` (2026-10-08, the one "can this size be divided by or swiped in" that `verify/scale.ts` and `ui-tree/standing.ts` share)
- Audit evidence: `usableSize` is defined at src/adapters/types.ts:88. Its importers are src/ui-tree/usable-screen.ts, src/ui-tree/geometry.ts, src/verify/scale.ts, src/interact/swipe.ts and src/adapters/types.ts. src/ui-tree/standing.ts does not reference it (grep finds no usableSize or usableScreen use there).
- Verification: The quoted sentence ("2026-10-08, the one 'can this size be divided...") does not exist in ARCHITECTURE.md (689 lines, no 2026-10-08 at all; grep finds usableSize only at line 122, in a different sentence). The auditor appears to have read a different text. The code facts (standing.ts has no usableSize use; swipe.ts/usable-screen.ts do) are true but there is no claim in the file to fix.

### F002 · `ARCHITECTURE.md:63` · obsolete

- Reported (misleading, low, line 63 at the audit): `interact/` imports no platform module but the one named below (`tests/architecture/layering.test.ts` allows it `adapters/types.ts` and `adapters/typeable.ts`)
- Audit evidence: src/interact/type-text.ts:1 imports adapters/input-text.ts, which the same paragraph names as a second exception ("Two known exceptions in `interact/`"). The test header (tests/architecture/layering.test.ts, interact/ row) lists types.ts and typeable.ts as allowed and input-text.ts as a named exception. The singular "the one named below" does not match the two named exceptions that follow.
- Verification: Neither the quote nor 'Two known exceptions in interact/' appears in ARCHITECTURE.md; grep of the whole repo finds no such sentence. Only interact/type-text.ts:1 importing adapters/input-text.js is real, but there is no doc claim to check.

### F003 · `ARCHITECTURE.md:68` · obsolete · orchestrator-checked

- Reported (doc-contradicts-code, medium, line 68 at the audit): one closed set of cases (`presented`, `unordered`, `keyboard`, `fixed`, `pinned`, `stuck`, `scroll`)
- Audit evidence: src/ui-tree/standing.ts:695-704 defines `Remedy` with nine cases: presented, unordered, seenOver, bothPinned, keyboard, fixed, pinned, stuck, scroll. The doc's list omits `seenOver` and `bothPinned`, so a reader building a switch from the doc would miss two cases of a set the doc calls closed.
- Verification: 'closed set of cases' occurs only in src/ui-tree/standing.ts (lines 48, 480), not in ARCHITECTURE.md, and there it refers to `Remedy` itself, which is defined at standing.ts:562 with nine cases. No list of seven cases exists in the doc; the finding's quoted list is not in the repo.

### F004 · `ARCHITECTURE.md:71` · obsolete

- Reported (stale-reference, low, line 71 at the audit): Besides `engine.ts`, three modules since 2026-10-04 (six now — `flow/launch.ts` and `flow/tool-config.ts` below, and since 2026-10-08 `flow/condition.ts`...)
- Audit evidence: `ls src/flow` shows nine files: condition, config, credentials, engine, hold-tracker, launch, load, tool-config, wipes-ahead. That is eight modules besides engine.ts, not six. `flow/hold-tracker.ts` and `flow/wipes-ahead.ts` are not named anywhere in ARCHITECTURE.md lines 1-195.
- Verification: 'three modules since 2026-10-04 (six now...' is not in ARCHITECTURE.md (no 'Besides' or 'since 2026' text). src/flow does hold nine files incl. hold-tracker.ts and wipes-ahead.ts, but the doc makes no count claim to contradict; the quoted sentence is absent.

### F006 · `ARCHITECTURE.md:171` · obsolete · orchestrator-checked

- Reported (doc-contradicts-code, medium, line 171 at the audit): the adapter reads it only for its keyboard advice (`ios.ts#keyboardAdvice`)
- Audit evidence: src/adapters/ios.ts:567 passes `source: this.treeSource.kind` into `foregroundCheck` (the launch's foreground note). src/adapters/ios-tree-source.ts:48 says the same: the adapter reads `kind` "for its keyboard advice (ios.ts#keyboardAdvice) and the wording of its launch's foreground note". Also ios.ts:864 reads it for keyboardAdvice.
- Verification: 'the adapter reads it only for its keyboard advice (ios.ts#keyboardAdvice)' is not in ARCHITECTURE.md; the nearest text (lines 414-430) says only that keyboardAdvice names a config key. The ios-tree-source.ts comment quoted as evidence is a source comment, not this doc. No false doc claim found.

### F007 · `ARCHITECTURE.md:568` · obsolete

- Reported (misleading, low, line 266 at the audit): `scroll_until` (`element`, `direction`, `maxSwipes`, `fully`, `timeout`)
- Audit evidence: src/flow/config.ts:290-298 (STEP_KINDS.scroll_until) also accepts `within: withinSpec.optional()`, which selects the scroll view to swipe (the MCP tool documents it as `within`, src/mcp/tools.ts around line 545). The step's option list is incomplete.
- Verification: The quoted option list (`element`, `direction`, `maxSwipes`, `fully`, `timeout`) is not in ARCHITECTURE.md. The doc's tool table (line 568) already lists `within` for scroll_until: scroll_until(platform, selector, direction?, maxSwipes?, fully?, timeoutMs?, within?).

### F008 · `ARCHITECTURE.md:275` · obsolete

- Reported (doc-contradicts-doc, low, line 275 at the audit): n states each with two rungs requiring the next: 2^(n+1)−3 reads, 253 at n = 6
- Audit evidence: The doc's own formula gives 2^(6+1)−3 = 125 at n = 6, not 253. 253 equals 2^(n+2)−3 at n = 6. The formula and the example disagree by one power of two. The actual read count was not measured here.
- Verification: grep for '2^(n' and '253' in ARCHITECTURE.md finds nothing; the formula/example pair is not in the file. Nothing to verify or fix there.

### F009 · `ARCHITECTURE.md:321` · obsolete

- Reported (misleading, low, line 321 at the audit): the registry's `get` takes that kind as a required argument (`undefined` is the default, idb): the kind-less overload is gone
- Audit evidence: src/mcp/registry.ts:29-31 declares AdapterOpts with an optional key `treeSource?: IosTreeSourceKind`. src/mcp/registry.ts:176 is `get(platform, opts: AdapterOpts)`, so only the opts object is required. The kind itself may be undefined, and undefined resolves to DEFAULT_IOS_TREE_SOURCE (src/adapters/ios-node.ts:22).
- Verification: 'kind-less overload is gone' is not in ARCHITECTURE.md (line 684 only mentions DEFAULT_IOS_TREE_SOURCE as one constant). registry.get(platform, opts: AdapterOpts) is real (registry.ts:176) but the doc sentence the finding attacks is absent.

### F010 · `ARCHITECTURE.md:661` · obsolete

- Reported (doc-contradicts-code, low, line 363 at the audit): Its forty-eight modules are in two groups, one Stryker process each
- Audit evidence: scripts/mutation/scope.json is an array of 53 module paths (for example src/flow/wipes-ahead.ts first, scripts/truth/live-visibility.ts last). The number is stale.
- Verification: 'forty-eight modules' appears nowhere in the repo. ARCHITECTURE.md:660-664 says Stryker mutates the modules scope.json names 'in four groups (core, android, scene, lab)', with no module count, so nothing is stale. scope.json holds ~66 lines/entries by my count, irrelevant since no number is claimed.

### F184 · `src/interact/tap-judgement.ts:345` · obsolete

- Reported (misleading, low, line 345 at the audit): a scroll, or (`bothPinned`, neither in a scroll view) none
- Audit evidence: The branch tests noScrollHelps(r) (tap-judgement.ts:346). src/ui-tree/standing.ts:607 defines noScrollHelps as unordered \|\| seenOver \|\| bothPinned, so the comment names only one of three kinds that take cutByPinnedRemedy.
- Verification: The quoted phrase 'a scroll, or (`bothPinned`, neither in a scroll view) none' is not in tap-judgement.ts. Line 346 is not a noScrollHelps test. rg for 'bothPinned' in tap-judgement.ts finds nothing, and no file has this wording. The nearest text is in touch-remedy.ts and scroll-text.ts, which list the kinds correctly.

### F189 · `src/mcp/tools.ts:583` · obsolete

- Reported (stale-reference, low, line 555 at the audit): The eyes a `fully visible` claim is confirmed with (ui-tree/eyes.ts), wired here
- Audit evidence: The handler's import is `eyesOn` from '../verify/eyes.js' (tools.ts:14), and the factory is defined in src/verify/eyes.ts:18. src/ui-tree/eyes.ts holds the Eyes contract, so the concept is correctly placed, but the wiring that this line points at is verify/eyes.ts.
- Verification: The actual comment is at tools.ts:583: 'The eyes a `fully visible` claim is confirmed with (ui-tree/eyes.ts), served here: interact/ may not import verify/.' The quote 'wired here' is not in the source. ui-tree/eyes.ts is where the Eyes contract lives, and it says the production adapter is verify/eyes.ts#eyesOn wired at the composition root. The pointer is correct.

## Delta pass, 2026-11-13

A second audit over what the first one could not have seen, at `c63c09d6` (80 commits after the verification above,
189 after the first audit). 20 Sonnet agents, read-only:

- 9 on the files changed since `48f92c5c`: 76 under `src/`, 47 under `scripts/` and the fixture apps, 123 tests, 19
  ADRs (0045 to 0047 new). In a modified file they read the comments the diff added or rewrote and the comments over
  code the diff changed, not the whole file; a new file was read whole.
- 5 on the gaps of the first audit: the 155 test files whose behavioural claims had not been checked, and ADRs 0010,
  0038, 0041 and 0044 in full.
- 2 on the rewritten ARCHITECTURE.md, 1 on the other changed documentation (README.md, CLAUDE.md, docs/release.md,
  docs/verification.md, scripts/differential/README.md, the skill references, docs/mutation-ledger.md: no finding).
- 3 on a control sample: three buckets of the first audit (20 files of `src/`) audited again in full, without the
  first audit's findings.

68 findings (`G` ids), 9 of them from the control sample. **No second model verified them.** The five rated medium
were read by the orchestrating session; each entry says what it saw. The F findings above were verified at `b71b5dba`
and were not re-read at `c63c09d6`; their lines may have moved.

### Control sample: how much one pass finds

| Bucket | Files | Haiku, valid after verification | Sonnet | Found by both | Either |
|---|---|---|---|---|---|
| src-02 (adapters: discovery to input-text) | 8 | 3 | 1 | 1 | 3 |
| src-16 (ui-tree: element-spec, eyes, geometry) | 3 | 5 | 4 | 1 | 8 |
| src-21 (verify: color-parity to ocr-fold) | 7 | 3 | 4 | 1 | 6 |
| **total** | 18 | **11** | **9** | **3** | **17** |

Neither pass contains the other. Sonnet missed 8 of Haiku's 11 valid findings, both medium ones among them (F130,
F203, each still in the code at `c63c09d6`); Haiku missed 6 of Sonnet's 9, all low. With 3 of 17 found twice, one
pass by either model finds roughly a third to a half of what is there, so this record is a lower bound on the false
comments in the repo, not a list of them. (src-21 holds one file changed since the first audit, src-16 one; the
comparison counts findings on unchanged text only as far as the orchestrator could tell.)

### Coverage the agents did not reach

- Tests: tests/truth/batch/abort*.test.ts and ios-domains-*.test.ts internals; the later parts of
  tests/truth/truth.test.ts and replies.test.ts; tests/ui-tree draw-order-android-reading-order, -marked-layers,
  -rn-covers, -paints-over; tests/verify/assert-handoff, assert-margin-text, assert-not-found-note. The scroll test
  diffs were read as filtered diff lines.
- ADRs 0038 and 0044: the S4 and S5 restore and cleanup rules were checked by name, not branch by branch.
- ARCHITECTURE.md: §3 claims about `ios.ts` internals were spot-checked; the layering rules were checked by reading
  the architecture test and grepping imports, not by running it.
- Unmodified text of modified files was not re-read (the first audit covered it at `48f92c5c`).
- Measured device figures, AOSP behaviour and mutant counts were not checked anywhere.

### Findings

#### G001 · `ARCHITECTURE.md:662` · medium · misleading

- Claim: a covered target is hidden by the configured dismissal (`app.ios.keyboardDismiss`), else refused on a second look with the adapter's advice
- Evidence (Sonnet, unverified): src/interact/keyboard-dismissal.ts:26-40 (and ADR 0022): after a configured strategy performed a move that left the keyboard up, the guard walks AVERIS_OWN, an upward drag of the target's scroll view (THE_DRAG), and may scroll the screen. The refusal comes only after every strategy is spent (AfterDismissalTap, keyboard-in-tree.ts). Under WDA, 'else refused' is true only with nothing configured or nothing usable. The paragraph cites ADR 0022 yet omits the drag it introduced.
- Fix: Add: a configured dismissal that leaves the keyboard up is followed by averi's own upward drag of the target's scroll view (ADR 0022); a refusal with the adapter's advice follows only when nothing configured is usable or every move is spent.
- Orchestrator: sentence read; the dismissal ladder in `keyboard-dismissal.ts` was not re-read by the orchestrator.

#### G002 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:50` · medium · doc-contradicts-code

- Claim: both lines are read from display 0's block alone (the default display, where `am start` with no `--display` starts the link), or the first display's when none is display 0.
- Evidence (Sonnet, unverified): src/adapters/android-wm.ts:31-35 `defaultDisplayBlock` returns `blocks.find(... === DEFAULT_DISPLAY)` with no fallback to the first block. src/adapters/android-wm.ts:527 reads `defaultDisplayBlock(dump) ?? ''`, so a headered dump with no display 0 reads no focus and names no chooser. The A35 amendment (lines 944-946) says exactly this and calls the old first-display read 'a guess'. The Decision bullet has no superseded marker, so a reader of the Decision alone gets the old rule.
- Fix: Replace the clause with 'or nothing when none is display 0 (A35: before then, the first display's block; see the A35 amendment)'.
- Orchestrator: confirmed: `android-wm.ts#defaultDisplayBlock` has no first-display fallback.

#### G003 · `docs/adr/0044-a-case-declares-its-reads.md:176` · medium · stale-reference

- Claim: **Not yet run on a device.** `readDevice` has run only over a fake exec: the emulator was down when T16 was built, and the smoke went to the owner's list, its record and log to be committed as `docs/truth/live-records/t16-device-state/smoke-1.json` and `smoke-1.log.txt`
- Evidence (Sonnet, unverified): The smoke has run and is committed: docs/truth/live-records/t16-device-state/ holds smoke-1.json, smoke-1.log.txt and raw-strokes-1.jsonl (git: 63cf9eaf 'T16 smoke — device-state reads live', merged in c2796759, whose message says '~52 s a read'). The section is the only status of the read in this ADR, is not marked superseded, and the 'about 55 s, estimated, not measured' cost in Consequences is likewise measured now.
- Fix: Replace with a dated note that the smoke ran on emulator-5554 (2026-11-11, smoke-1.json), about 52 s a read, same state as raw-strokes-1; keep the remaining 'must confirm' list only for what the record did not settle, or delete the section.
- Orchestrator: confirmed: the smoke record is committed under docs/truth/live-records/t16-device-state/.

#### G004 · `src/adapters/types.ts:1337` · medium · stale-reference

- Claim: idb's describe-all, 300 (IDB_SETTLE_CADENCE_MS); WDA, none (unmeasured).
- Evidence (Sonnet, unverified): WdaTreeSource declares `readonly settleCadenceMs = WDA_SETTLE_CADENCE_MS` (src/adapters/wda-tree-source.ts:12 = 300, :64). The sibling comments were updated in this range: ios.ts:856 says "WDA's 300 (A41b)" and ios-tree-source.ts:70 names WDA_SETTLE_CADENCE_MS. This doc block on DeviceAdapter.settleCadenceMs was left saying WDA has none and is unmeasured.
- Fix: idb's describe-all, 300 (IDB_SETTLE_CADENCE_MS); WDA's /source, 300 (wda-tree-source.ts#WDA_SETTLE_CADENCE_MS, A41b)
- Orchestrator: confirmed: `wda-tree-source.ts` sets `settleCadenceMs = WDA_SETTLE_CADENCE_MS`.

#### G005 · `tests/adapters/android.test.ts:1198` · medium · stale-reference

- Claim: The navigation bar's band (data only: nothing judges it yet; mp-native draws edge-to-edge ...)
- Evidence (Sonnet, unverified): The navigation band is judged now. src/ui-tree/usable-screen.ts:126 copies device.navigationBand into the usable screen. src/ui-tree/standing.ts:1076-1084 (systemBands) builds the bottom system band from bands?.navigationBand and uses it to judge a node as under the system bar. The doc block governs the describe whose title line this diff rewrote.
- Fix: Drop "data only: nothing judges it yet". Say it is read out of the same dumpsys call as the status band and judged as the bottom system band (ui-tree/standing.ts#systemBands).
- Orchestrator: comment read and still says "nothing judges it yet"; the judging code was not re-read by the orchestrator.

#### G006 · `ARCHITECTURE.md:121` · low · false

- Claim: `Rect` and the rect primitives an adapter needs and may not import from above (`rectArea`, `sameRect`, `rectsOverlap`, `usableSize`, `Point`, `Stroke`, re-exported by `ui-tree/geometry.ts`)
- Evidence (Sonnet, unverified): src/ui-tree/geometry.ts:517 re-exports only rectArea, rectCentre, rectIntersection, rectsOverlap, sameRect, sameRectWithinPixel and sameSizeWithinPixel. `usableSize`, `Point` and `Stroke` are not re-exported. geometry.ts:2 imports `usableSize` and `Point` from '../adapters/types.js' for its own use, and `Stroke` appears nowhere in geometry.ts.
- Fix: Say that the rect arithmetic (`rectArea`, `sameRect`, `rectsOverlap`, `rectIntersection`, `rectCentre`, ...) is re-exported by `ui-tree/geometry.ts`. Drop `usableSize`, `Point` and `Stroke` from the re-export clause, or say they are imported from `adapters/types.ts` directly.

#### G007 · `ARCHITECTURE.md:173` · low · false

- Claim: A node not reachable gets one `Remedy` (`presented`, `unordered`, `keyboard`, `fixed`, `pinned`, `stuck`, `scroll`) with ONE precedence
- Evidence (Sonnet, unverified): The `Remedy` union at src/ui-tree/standing.ts:556-565 has nine cases: presented, unordered, seenOver, bothPinned, keyboard, fixed, pinned, stuck, scroll. `seenOver` and `bothPinned` are not in the doc's list. `NoScrollRemedy` (standing.ts:~577) is built from `unordered`, `seenOver` and `bothPinned`, so the two omitted cases are real, load-bearing cases.
- Fix: List all nine: `presented`, `unordered`, `seenOver`, `bothPinned`, `keyboard`, `fixed`, `pinned`, `stuck`, `scroll`.

#### G008 · `ARCHITECTURE.md:227` · low · misleading

- Claim: `type-text.ts` (which text averi types, refused before any device call: no C0 control character; the adapter's `typeable`, ADR 0037)
- Evidence (Sonnet, unverified): src/interact/type-text.ts:12-13 states the rule as no C0 control character (U+0000-U+001F) and no DEL (U+007F). `CONTROL_CHAR_RE` at src/adapters/input-text.ts:18 is /[\u0000-\u001f\u007f]/ and `assertTypeable` (type-text.ts:~66) refuses on it. DEL is refused too and is not a C0 character.
- Fix: no C0 control character and no DEL (U+007F)

#### G009 · `ARCHITECTURE.md:343` · low · misleading

- Claim: **registry** — one cached adapter per device
- Evidence (Sonnet, unverified): src/mcp/registry.ts:119-120 and `kindFor` (registry.ts:~86) key the cache on (platform, deviceId, tree-source kind). On iOS one simulator can have two cached adapters, one per tree source. The doc's own line 333 says 'chosen by platform and tree source'.
- Fix: one cached adapter per (device, tree-source kind)

#### G010 · `ARCHITECTURE.md:348` · low · misleading

- Claim: Leaves every layer may reach: `duration.ts` ..., `count.ts`, `error-message.ts`, `regex.ts` ..., `sleep.ts` ..., `version.ts` (the package version, read at runtime).
- Evidence (Sonnet, unverified): src/util/ holds seven modules: count, duration, error-message, note-line, regex, sleep and version. `note-line.ts` (`withNoteLine`, the one spelling of a claim note's line, used by run/claims.ts, interact/type-text.ts and adapters/ios.ts) is not in the list.
- Fix: Add `note-line.ts` (`withNoteLine`, the one spelling of the `⚠` claim-note line).

#### G011 · `ARCHITECTURE.md:417` · low · misleading

- Claim: input and screenshots through idb
- Evidence (Sonnet, unverified): src/adapters/ios.ts:59-63,244: AVERI_IOS_SCREENSHOT=simctl routes every iOS screenshot through `simctl io screenshot`. src/adapters/wda-tree-source.ts:212 and auto-tree-source.ts typeText: typing goes through WebDriverAgent's /wda/keys when WDA is the source (ADR 0037). The bullet's own last sentence defers typing to ios-typing.ts, but the opening claim is flat.
- Fix: input (taps, swipes, idb-path typing) and screenshots through idb (screenshots through simctl under AVERI_IOS_SCREENSHOT=simctl; wider-than-ASCII typing through WDA, ios-typing.ts)

#### G012 · `ARCHITECTURE.md:435` · low · misleading

- Claim: launch_app pays WDA's bring-up, and the first read after it does not.
- Evidence (Sonnet, unverified): src/adapters/auto-tree-source.ts:~125 (startBeforeLaunch) and src/adapters/wda-tree-source.ts:19-21 (mayStartBeforeLaunch): the start before a launch happens only when WDA's build is already cached in DerivedData ('A build is minutes of xcodebuild, never run inside a launch; the first read runs it'). With no cached build, launch_app does not pay the bring-up and the first read does.
- Fix: Add 'when WDA's build is cached; otherwise the first read builds and chooses'.

#### G013 · `ARCHITECTURE.md:452` · low · misleading

- Claim: WDA child ← `WdaServer` ← `WdaTreeSource` ← `IosAdapter` ← `AdapterRegistry` ← `mcp/lifecycle.ts`
- Evidence (Sonnet, unverified): src/adapters/ios.ts:325-326: IosAdapter.dispose() calls this.treeSource.dispose() and idbHelper.dispose(). Under the default treeSource auto, the injected source is AutoTreeSource (src/adapters/ios-tree-source.ts:167, auto-tree-source.ts:dispose), which owns WdaTreeSource and IdbTreeSource. The chain omits AutoTreeSource and the idb helper that IosAdapter also disposes.
- Fix: WDA child ← WdaServer ← WdaTreeSource ← (AutoTreeSource, under auto) ← IosAdapter (also its idb helper) ← AdapterRegistry ← mcp/lifecycle.ts

#### G014 · `ARCHITECTURE.md:477` · low · misleading

- Claim: # treeSource: wda # optional: RN / SwiftUI container ids (§3); keyboardDismiss needs it
- Evidence (Sonnet, unverified): src/flow/config.ts:88-96: inertKeyboardDismissNote fires only when the resolved kind is 'idb'. The default is 'auto' (src/adapters/ios-node.ts:29), under which keyboardDismiss applies whenever WDA comes up (comment at config.ts:90-91). §3 of the same file says auto picks WDA when it comes up, so WDA already supplies the RN/SwiftUI container ids by default.
- Fix: # treeSource: idb\|wda\|auto (default auto: WDA when it comes up). keyboardDismiss is inert only under treeSource: idb

#### G015 · `docs/adr/0010-pixel-assert-keyboard-first.md:3` · low · misleading

- Claim: Status: accepted, 2026-10-12 (owner). Amended 2026-10-20 (round 14, lab note LE1): the drawn frame on Android (below).
- Evidence (Sonnet, unverified): The file carries amendments dated through 2026-11-12: D59b 11-03, D76 11-09, D78 11-10, D81, D80, D86 and A19 11-11, A38b 11-12. Only the 10-20 one is listed in the Status line, so it reads as the last amendment.
- Fix: List the later amendments (D59b, D76, D78, D80, D81, D86, A19, A38b), as ADR 0041's Status paragraph does.

#### G016 · `docs/adr/0010-pixel-assert-keyboard-first.md:568` · low · doc-contradicts-doc

- Claim: `ScrollOptions.within` (interact/scroll.ts) is a selector string or a `Rect` — no element spec
- Evidence (Sonnet, unverified): src/interact/scroll.ts:49 types it `within?: Within`, and src/interact/within.ts:47 defines `Within = Target \| Rect` (an element spec is allowed since D81). Line 612 strikes the 'not in scope' note, but this sentence is not marked superseded.
- Fix: Add '(since D81: `Within = Target \| Rect`; the MCP tool still takes only a string or a rect)'.

#### G017 · `docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md:1330` · low · false

- Claim: A38a sweep: "of the 53 idb lists committed (the 51 of the lab's captures and tests/fixtures/idb-*, ... and the two describe-all records ...)"
- Evidence (Sonnet, unverified): The sweep now finds 54 lists. tests/adapters/idb-presented-layer.test.ts:174 asserts `lists.length` toBe(54). The count grew when A43 committed tap-catcher-beneath-flat.idb.json (42 truth idb files). It was 53 when A38a was written, so this is dated history that no longer matches the sweep the ADR cites. Line 1330 is approximate: the sentence is in the 'Amendment: idb's backdrop' section, and I did not note its exact line.
- Fix: Add "(54 since A43 added tap-catcher-beneath-flat)", or say "53 at A38a".

#### G018 · `docs/adr/0018-a-later-stacked-screen-layer-covers-the-screen-beneath.md:1384` · low · misleading

- Claim: Amendment A43: "The owner's hand-off, before the next Gate C" (six steps to capture the cell and add the two counts); "while it holds no count for a source's capture, that capture must be absent"; and the future-tense "What the capture settles ... Listed as predicted ...". Line 1384 is approximate: the section is the A43 amendment ('the flat tap-catcher control cell'), and I did not note its exact line.
- Evidence (Sonnet, unverified): The hand-off is done. tests/fixtures/truth/ios-iphone17-ios27/ holds tap-catcher-beneath-flat.{idb,wda}.json plus .png, .state.json and .truth.json. tests/differential/golden/false-covers.known.ts:34-35 holds both counts (12 each), and its line 8 says 'captured 2026-11-13': A–D open, every row green, as predicted. tests/truth/flat-catcher-listing.test.ts now takes its 'counted' branch, which checks the capture lists as predicted. The amendment still reads as pending work.
- Fix: Add a closing sentence: the capture was taken 2026-11-13 and listed as predicted (counts 12 and 12 in false-covers.known.ts). Say the hand-off is done and blur-menu.wda stays KNOWN.

#### G019 · `docs/adr/0021-scroll-until-turns-once-at-a-proven-end.md:551` · low · stale-reference

- Claim: "On Android the tree tells an axis by class only (adapters/android.ts's AXIS_BY_CLASS: ..."
- Evidence (Sonnet, unverified): AXIS_BY_CLASS lives in src/adapters/android-tree-dialect.ts:41 and is not in android.ts. The same ADR's T6d amendment, which the diff did update, already says android-tree-dialect.ts#AXIS_BY_CLASS. Line 551 is outside the diff, but it sits in the file that was edited for this move.
- Fix: adapters/android-tree-dialect.ts's AXIS_BY_CLASS

#### G020 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:57` · low · misleading

- Claim: `vitest.mutation.config.ts` (`include`, with `related: false` and a cache of its own)
- Evidence (Sonnet, unverified): vitest.mutation.config.ts holds only `cacheDir: 'node_modules/.vite-mutation'` and `test.include` (scopeOf(process.env).tests). `related: false` is in stryker.config.mjs: `vitest: { configFile: 'vitest.mutation.config.ts', related: false }`.
- Fix: `vitest.mutation.config.ts` (`include` and a cache of its own) and stryker.config.mjs (`mutate`, and the vitest option `related: false`).

#### G021 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:81` · low · doc-contradicts-code

- Claim: Adding it is one edit: an entry in scope.json with its tests, its floor and its baseline.
- Evidence (Sonnet, unverified): Every entry now also needs a `group`: scripts/mutation/group.mjs:40-47 scopeErrors reports 'has no group in scripts/mutation/scope.json' and scopeOf (line ~70) throws, so stryker.config.mjs and vitest.mutation.config.ts refuse to load. Outside src/, scripts/truth/ (*.ts and batch/), scripts/release/ and scripts/differential/connection.ts a stryker.config.mjs allowlist edit is also needed. The Decision's own scope description (line 54-56) omits `group` as well. The T2b-2 and A32 text corrects this but Consequences is not marked superseded.
- Fix: Adding it is one scope.json entry (tests, floor, baseline, group), plus a stryker.config.mjs allowlist entry for a module outside the allowlisted folders (T2b-2, A11).

#### G022 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:83` · low · doc-contradicts-doc

- Claim: geometry.ts stays out until its direct tests exist. That is a backlog row of its own. (and line 51: 'runs Stryker over five pure leaves'; line 79 'one of the five modules')
- Evidence (Sonnet, unverified): geometry.ts is in scripts/mutation/scope.json (group core, floor 93, tests tests/ui-tree/geometry*.test.ts) since the D45 amendment; scope.json holds 68 modules in four groups (core 36, lab 23, scene 5, android 4). The Decision and Consequences carry no 'superseded' mark, and A32 itself says the merge rule applies to every module.
- Fix: Mark Decision and Consequences as the 2026-11-01 state ('five' then; see the amendments and A32 for the current scope), or delete the geometry.ts bullet.

#### G023 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:221` · low · doc-contradicts-doc

- Claim: Residuals of S2, open: - whether idb_companion really starts in the idb client's group is not measured
- Evidence (Sonnet, unverified): The batch-13 fixes section of the same ADR closes it ('S2's residual ... is closed by the same fb-idb fact: it does not, it starts in a group of its own'), and bounded.ts:64-70 KEEPS_GROUP.idb records the fb-idb 1.1.7 preexec_fn=os.setpgrp fact. The S2 list is not marked closed.
- Fix: Mark as closed in batch-13 (idb_companion leaves the call's group; KEEPS_GROUP keeps idb on the safe side).

#### G024 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:591` · low · doc-contradicts-code

- Claim: the focus is its `chooserInFocus` over its `CHOOSER_FOCUS_COMMAND`
- Evidence (Sonnet, unverified): lab-chooser.ts's focusOf no longer uses src's chooserInFocus: scripts/truth/batch/lab-chooser.ts:110-112 returns focusedChooserOf(r.out) (chooser-readers.ts:196, A22/TL5, which the A22 amendment at the end of this ADR states). The S5 paragraph is not marked superseded.
- Fix: Add '(until A22: now chooser-readers.ts#focusedChooserOf, see the A22 amendment)' after the focus clause.

#### G025 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:1093` · low · doc-contradicts-doc

- Claim: The ask is compared as canonical JSON (canonicalJson in records.ts, a run's identity asked and done ...) [also: 'asksLive ... its ask compared by records.ts's canonicalJson', and 'canonicalJson in records.ts, called directly']
- Evidence (Sonnet, unverified): canonicalJson is exported from scripts/truth/batch/words.ts:205, and runner.ts:50 imports it from './words.js'; the T2b-1 part of this ADR says it moved to words.ts. The S6b text is not marked superseded.
- Fix: canonicalJson in words.ts (moved from records.ts in T2b-1).

#### G026 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:1417` · low · doc-contradicts-code

- Claim: its own incremental file, reports and temp dir (`reports/mutation/stryker-incremental-<group>.json`, `mutation-<group>.json`/`.html`, `node_modules/.stryker-tmp-<group>`) ... `npm run mutate` (mutate.ts) takes `--group core\|lab`; without it, it runs core and then lab ... the loop's command, `npm run mutate -- --force --tempDirName .stryker-tmp-<n>`
- Evidence (Sonnet, unverified): scripts/mutation/group.mjs:75 filesOf gives tempDir `reports/mutation/stryker-tmp-<group>` (A37) and GROUPS is ['core','android','scene','lab'] (group.mjs:13); mutate.ts:17 usage is `--group core\|android\|scene\|lab`. The T2b-2 section has no superseded mark (A25, A27 and A37 correct it later in the file).
- Fix: Mark the T2b-2 mechanics as the state at T2b-2: temp dir now reports/mutation/stryker-tmp-<group> (A37), groups core, android, scene, lab (A25, A27), no --tempDirName needed.

#### G027 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:1480` · low · doc-contradicts-code

- Claim: the modules it imports itself (lab-device.ts, live-carousel.ts, live-cases.ts, replies.ts, schema.ts). That adds 6 files to the rule.
- Evidence (Sonnet, unverified): scripts/truth/run-case.ts:1-8 also imports live-chooser.ts, live-forms.ts and live-visibility.ts (and, via live-chooser.ts, chooser-readers.ts), so the list is incomplete after T7b.
- Fix: Add live-chooser.ts, live-forms.ts and live-visibility.ts to the list (and correct the count).

#### G028 · `docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md:1860` · low · false

- Claim: `focusOf` calls `focusedChooserOf` instead of src's `chooserInFocus` (ADR 0020)
- Evidence (Sonnet, unverified): docs/adr/0020 is 'The truth outranks a hand-written expectation' and does not mention chooserInFocus (0 hits). chooserInFocus is documented in docs/adr/0041-an-android-link-names-the-chooser-in-front.md (8 hits). The code is as stated: scripts/truth/batch/lab-chooser.ts:110-112 focusOf -> focusedChooserOf (scripts/truth/chooser-readers.ts:196); src/adapters/android-chooser.ts:63 defines chooserInFocus.
- Fix: (ADR 0041)

#### G029 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:6` · low · stale-reference

- Claim: The `DeviceAdapter` contract gains one optional field, `DeepLinkOutcome.chooser`.
- Evidence (Sonnet, unverified): No `DeepLinkOutcome` or `LaunchOutcome` type exists in src/ or scripts/ (rg finds neither). src/adapters/types.ts:992-995 defines `AppHolder` (`{ holder: 'chooser'; chooser: LinkChooser }`), which `launch` and `openDeepLink` return (types.ts:1140). The A10 amendment (line 477) records this, but the Status paragraph is unmarked.
- Fix: Add 'since A10, the closed type `AppHolder`, `{ holder: 'chooser', chooser }`' after the field name.

#### G030 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:77` · low · stale-reference

- Claim: The advice is one constant, `CHOOSER_ADVICE`, in the new module.
- Evidence (Sonnet, unverified): rg finds no `CHOOSER_ADVICE` in src/ or scripts/. The A10 amendment (line 481) says it is gone from android-chooser.ts. The advice is now `chooserAdvice(chooser, defaultFor, drops)` in src/interact/app-holder-text.ts:164. This bullet carries no marker.
- Fix: Add '(since A10 `interact/app-holder-text.ts#chooserAdvice`)'.

#### G031 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:89` · low · stale-reference

- Claim: `FOCUSED_WINDOW_COMMAND` (25–26 ms; android.ts)
- Evidence (Sonnet, unverified): `FOCUSED_WINDOW_COMMAND` is defined in src/adapters/android-wm.ts:133, since A27, not android.ts. `FOCUSED_WINDOW_COMMAND` is also named at lines 47-49 as beside `CHOOSER_FOCUS_COMMAND`, which is at android-wm.ts:500.
- Fix: 'android-wm.ts' (A27 moved it).

#### G032 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:160` · low · stale-reference

- Claim: `FOCUS_WINDOW_RE`'s capture is the same and keeps its `\}` ... On `FOCUS_WINDOW_RE`'s: dropped (1).
- Evidence (Sonnet, unverified): `FOCUS_WINDOW_RE` no longer exists. src/adapters/android-wm.ts:143 defines `CURRENT_FOCUS_RE`. The A27 amendment (lines 877-878) says the two focus regexes became one, `CURRENT_FOCUS_RE`, but does not say the old name is gone, and the D55r text is unmarked.
- Fix: Add '(now `CURRENT_FOCUS_RE`, A27)' at the first mention.

#### G033 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:251` · low · stale-reference

- Claim: One advice builder: `chooserAdvice(defaultFor, drops)` in `adapters/android-chooser.ts`. `CHOOSER_ADVICE` is `chooserAdvice('such links', 'the link')` ... The strings live in the mutated module and are pinned whole.
- Evidence (Sonnet, unverified): src/adapters/android-chooser.ts holds only `REFUSAL_ADVICE` (lines 76-78) and `chooserAlsoInFront`. `chooserAdvice` now lives in src/interact/app-holder-text.ts:164 with the signature `(LinkChooser, defaultFor, drops)`. The D73 correction at line 189 covers only monkey's refusal. The A10 'gone' note is at line 481.
- Fix: Mark the bullet 'since A10 in interact/app-holder-text.ts#chooserAdvice, signature (chooser, defaultFor, drops); the adapter keeps REFUSAL_ADVICE'.

#### G034 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:340` · low · stale-reference

- Claim: (`chooserSheetText`: `chooserSheetSays`, then `sheetAdvice`, beside `chooserAdvice`, whose ending both share)
- Evidence (Sonnet, unverified): `chooserSheetText` and `chooserSheetSays` do not exist in src/ or scripts/. The A10 amendment (line 481) lists both as gone. The functions are now `sheetSays` (src/interact/app-holder-text.ts:~202), `sheetAdvice` and `chooserAdvice` in app-holder-text.ts. The 'since A10' parenthetical at line 338 covers only chooserText and launchChooserNote.
- Fix: Rename to `sheetSays` / `sheetAdvice` / `chooserAdvice` in interact/app-holder-text.ts, or add 'since A10: sheetSays'.

#### G035 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:757` · low · stale-reference

- Claim: (live.ts:264 and :288)
- Evidence (Sonnet, unverified): scripts/truth/live.ts calls `readPremiseInto` at line 264 and `summarizeRecord(record, results, ...)` at line 299. Line 288 is in the closers block of another call.
- Fix: Use ':264 and :299', or drop the line numbers.

#### G036 · `docs/adr/0041-an-android-link-names-the-chooser-in-front.md:783` · low · misleading

- Claim: `--groups chooser\|forms\|chooser,forms` selects blocks the way ONLY= does; the default is both
- Evidence (Sonnet, unverified): src/../scripts/truth/batch/lab-run.ts:73 `LAB_RUN_GROUPS = ['chooser','forms','visibility','ensure','carousel']`, so the default is all five blocks. The A22 paragraph (line 850) says `--groups` takes any of the five, but the T20b text is unmarked.
- Fix: Say 'the default is every group (five since A22)'.

#### G037 · `docs/adr/0044-a-case-declares-its-reads.md:28` · low · doc-contradicts-code

- Claim: with a list of exceptions that say why (lv-d62-drop, lv-d62-short, lv-d62-drop-two)
- Evidence (Sonnet, unverified): tests/truth/live-reads.test.ts:20-25 EXCEPTIONS holds four: lv-d62-drop, lv-d62-drop-two, lv-t12-drop-first, lv-d62-short.
- Fix: (lv-d62-drop, lv-d62-drop-two, lv-t12-drop-first, lv-d62-short)

#### G038 · `docs/adr/0044-a-case-declares-its-reads.md:51` · low · doc-contradicts-doc

- Claim: ## What T7b still has to add — This module does not make T7b ready ... The rest is new work: a start verb ... a new read ... a first state() with no cell ...
- Evidence (Sonnet, unverified): All five items are done: Case.fromLauncher (live-cases.ts:187, run-case.ts:104), CaseReads.focus (live-cases.ts:143), FocusLab (run-case.ts:31), the teardown (run-case.ts:159-164), noFirstState (live-cases.ts:768). Only the later 'Amendment: T7b paid the price list' says so; the section is not marked superseded.
- Fix: Retitle to 'What T7b had to add (done: see the 2026-11-09 amendment)' or add that note under the heading.

#### G039 · `docs/adr/0044-a-case-declares-its-reads.md:105` · low · stale-reference

- Claim: The grep and the parser (`frontOf` and `isChooser` in `scripts/truth/live-chooser.ts`) are the harness's own
- Evidence (Sonnet, unverified): frontOf is defined in live-chooser.ts:60, but isChooser is defined in scripts/truth/chooser-readers.ts:184 (moved there by A22/TL5; live-chooser.ts:1 only imports it). The grep itself is FOCUS_WINDOW_COMMAND/ACTIVITIES_COMMAND in lab-device.ts:341-342.
- Fix: `frontOf` in scripts/truth/live-chooser.ts and `isChooser` in scripts/truth/chooser-readers.ts; the grep is lab-device.ts's FOCUS_WINDOW_COMMAND and ACTIVITIES_COMMAND.

#### G040 · `docs/adr/0047-ios-clear-state-leaves-a-fresh-installs-folders.md:6` · low · stale-reference

- Claim: Its contract is ARCHITECTURE.md §6's `launch_app` row: wipe first, count the wipe.
- Evidence (Sonnet, unverified): The `launch_app` row is in §5, the tool surface (ARCHITECTURE.md:584; §5 runs from line 575 to 626). §6 is 'Distribution & privacy' (ARCHITECTURE.md:626).
- Fix: ARCHITECTURE.md §5's `launch_app` row

#### G041 · `scripts/perf/a41.ts:578` · low · doc-contradicts-code

- Claim: The required parts read but not proven (unprovenOf, A44): the cadence judgement, leg (b) of the first tap and the foreground leg.
- Evidence (Sonnet, unverified): unprovenOf (a41.ts:737-748) also pushes `first tap (a) (...)` when leg (a) is unproven or not-measured (lines 741-742). The file header (a41.ts:30-31) and the unprovenOf doc (731-733) list legs (a) and (b), so this field's doc omits leg (a).
- Fix: the cadence judgement, legs (a) and (b) of the first tap and the foreground leg.

#### G042 · `scripts/perf/a41.ts:593` · low · stale-reference

- Claim: /** The waited leg's first tap (WDA's own), and the gap it had from the adapter's creation. */
- Evidence (Sonnet, unverified): waitedGap is spread from AutoRun.waitedGapMs (a41.ts:884). a41-probe.ts:214-216 sets it as the time from launch_app's reply (`replied = performance.now()`, then sleep(WAITED_GAP_MS), `waitedGapMs = performance.now() - replied`). It is not measured from any adapter's creation. a41.ts:536 and :652 say the same, from launch_app's reply. The wording is left over from the pre-A41d pre-warm design.
- Fix: and the gap it had from launch_app's reply.

#### G043 · `scripts/truth/batch/lab-a41-ios.ts:21` · low · stale-reference

- Claim: scripts/perf/baseline.ts `--tree-source idb` (the A41b table's idb column: one session, BASELINE_REPEAT repeats)
- Evidence (Sonnet, unverified): No identifier BASELINE_REPEAT exists anywhere in the repo (grep over scripts/ finds only this comment). The repeat count is the row's `repeat` in scripts/perf/a41.ts A41_CHILDREN (a41.ts:433, 'baseline-idb': repeat 8), passed by childArgs (lab-a41-ios.ts:117,120).
- Fix: "(the A41b table's idb column: one session, A41_CHILDREN's repeats for it — 8)"

#### G044 · `scripts/truth/batch/lab-a41-ios.ts:33` · low · doc-contradicts-code

- Claim: no required part unproven (a41.ts#unprovenOf: the cadence, leg (b) of the first tap, the foreground leg — A44)
- Evidence (Sonnet, unverified): scripts/perf/a41.ts:731-745 unprovenOf also pushes `first tap (a) (...)` when leg (a) (A41d) is unproven or not measured (legAAnswer, a41.ts:741-742); a41.ts's own header (line 30) names "legs (a) and (b)". The report block (lab-a41-ios.ts:279) goes INCONCLUSIVE on it.
- Fix: "(a41.ts#unprovenOf: the cadence, legs (a) and (b) of the first tap, the foreground leg — A44, A41d)"

#### G045 · `scripts/truth/lab-device.ts:153` · low · misleading

- Claim: The lab's own WebDriverAgent build: never the default `averi-wda` derived data, which device-check builds use — a lab capture must not rebuild or replace theirs.
- Evidence (Sonnet, unverified): Lines 153-157: this doc block was left in place when the LAB_WDA_PORT constant and its own doc comment (lines 157-158) were inserted between it and `export const LAB_WDA_DERIVED_DATA` (line 160). The derived-data doc now sits above the port's doc, detached from the constant it describes, and LAB_WDA_PORT carries two stacked doc blocks, the first about derived data.
- Fix: Move the LAB_WDA_PORT constant and its doc above the derived-data doc block, so the derived-data comment again directly precedes LAB_WDA_DERIVED_DATA.

#### G046 · `scripts/truth/lab-device.ts:157` · low · false

- Claim: The lab's WebDriverAgent port: never device-check's 8100/8101. capture.ts, live.ts, baseline.ts and a41-probe.ts use it.
- Evidence (Sonnet, unverified): scripts/truth/capture.ts:62 builds the lab with `wdaPort: Number(values['wda-port'] ?? 8120)`, a literal; capture.ts does not import LAB_WDA_PORT (grep for LAB_WDA_PORT in scripts/ finds live.ts:14,173, perf/baseline.ts, perf/a41-probe.ts:15, perf/session.ts:9, batch/ios-defaults.ts:20 (its own copy), lab-device.ts, never capture.ts).
- Fix: "live.ts, baseline.ts, session.ts and a41-probe.ts use it (capture.ts still defaults to a literal 8120)", or make capture.ts import it.

#### G047 · `src/adapters/android-chooser.ts:11` · low · stale-reference

- Claim: So openDeepLink reads the focus once after the start (CHOOSER_FOCUS_COMMAND) and asks chooserInFocus.
- Evidence (Sonnet, unverified): CHOOSER_FOCUS_COMMAND was moved out of this file by the diff. It is now defined and exported at src/adapters/android-wm.ts:500, and src/adapters/android.ts:8 and :438 import and send it. This file no longer defines or imports it, so a reader looking here for the constant will not find it.
- Fix: (android-wm.ts#CHOOSER_FOCUS_COMMAND)

#### G048 · `src/adapters/idb-helper.ts:219` · low · stale-reference · control sample

- Claim: one `process.once('exit')` hook for all helpers (killIdbHelpersOnExit) kills it as the backstop for anything dispose did not reach — the pattern of WdaServer (wda.ts, spawnChild).
- Evidence (Sonnet, unverified): No `spawnChild` exists anywhere under src (grep -rn spawnChild src finds only this comment). WdaServer in src/adapters/wda.ts spawns through `this.spawnFn` (wda.ts:800), installs its exit hook with `process.once('exit', this.exitHook)` at wda.ts:832-834, and kills via a `killChild()` method (wda.ts:833). The pattern exists, but not under the name spawnChild.
- Fix: (wda.ts, the `exitHook` set up where the child is spawned, `killChild`)
- Same claim as F129 above.

#### G049 · `src/interact/fill-facts.ts:14` · low · false

- Claim: Two functions live here beside the types, `heldText` and `shownText`
- Evidence (Sonnet, unverified): The file also exports the functions `isPoint` (fill-facts.ts:197) and `hasPoint` (:200), so two is not the count. Both are type guards, not measurement definitions, which is the sense the sentence means. The sentence was rewritten in this range from "One function" to "Two functions". The same flaw was in the old wording.
- Fix: Two measurement DEFINITIONS live here beside the types, `heldText` and `shownText` (with the small `isPoint`/`hasPoint` guards)

#### G050 · `src/ui-tree/dialect.ts:9` · low · false

- Claim: The WRITERS — each mark is set there and nowhere else
- Evidence (Sonnet, unverified): The listed writers are the only ones in src/, but scripts/differential/convert.ts:272 also sets `paddedTouchTargets: true, activeWindowOnly: true` on the root of an Android Compose fixture ('the fixture's root lacks them'). That is a dev script, so it is a harmless exception, but 'nowhere else' is not literally true.
- Fix: "each mark is set there and nowhere else in src/ (scripts/differential/convert.ts adds the Android marks to a fixture that lacks them)"

#### G051 · `src/ui-tree/element-spec.ts:50` · low · misleading · control sample

- Claim: Every place that needs "just the selector half" of an extended step payload ... goes through `selectorOnly` instead of destructuring the four names again.
- Evidence (Sonnet, unverified): selectors.ts:128-141 (`conditionsOf`) iterates SELECTOR_FIELDS directly over an ElementSpec and does not call `selectorOnly`. Only flow/engine.ts:1869 uses `selectorOnly`. The no-hand-copied-field-list intent holds, but "goes through selectorOnly" does not.
- Fix: "...goes through `selectorOnly` (or iterates SELECTOR_FIELDS, as selectors.ts#conditionsOf does) instead of destructuring the four names again."

#### G052 · `src/ui-tree/geometry.ts:14` · low · false · control sample

- Claim: The viewport predicates (intersectsViewport, absentFromViewport, visibleFractionInViewport, clippedEdges) are here too, at the end of the file
- Evidence (Sonnet, unverified): The four predicates are at geometry.ts:456-663, in the middle of the file. Clips/clipsOf, evidentCut, largestScroller, the rect-text helpers, FLAT_LIST_TOP_BAR_FRACTION and screenOf follow at lines 681-1478, so they are not at the end.
- Fix: "...are here too, after the screen-size inference and before the scroll-container (Clips) section." Or drop "at the end of the file".
- Same claim as F200 above.

#### G053 · `src/ui-tree/geometry.ts:524` · low · stale-reference · control sample

- Claim: the dismissal picker of the root's rect, and ui-tree/draw-order.ts of every candidate
- Evidence (Sonnet, unverified): containsPoint is imported by standing.ts, presentation.ts, read-tree.ts, keyboard-cover.ts, draw-order.ts, reading-order.ts, cover.ts and interact/stroke-plan.ts, scroll-text.ts and unfit-axis.ts. The picker (interact/keyboard-dismissal.ts) neither imports it nor tests a point against the root's rect (grep for containsPoint there returns nothing, and it has no point-in-root test). The list names a caller that no longer exists and leaves out several real ones.
- Fix: Drop the dismissal-picker clause, or say "the standing (standing.ts), the presentation, draw-order.ts and the stroke plan" instead of a closed list.

#### G054 · `src/ui-tree/geometry.ts:1036` · low · misleading · control sample

- Claim: `ancestry`: whether the tree's nesting is its nodes' ancestry ..., which `inScroller` and `drawnIn` ask; `unclipped`: ... which `axesOf` and `contentToward` ask
- Evidence (Sonnet, unverified): The `ancestry` flag is also read by `contentToward` (geometry.ts:1145) and `scrollViewsOn` (geometry.ts:1171, which `toldOn` uses). The `unclipped` flag is also read by `drawnIn` (`listedWhereItLies: unclipped`, geometry.ts:1123) and by `scrollViewsOn`/`toldOn` via `scrollAxis(node, unclipped)` (geometry.ts:1172). So the lists are incomplete.
- Fix: Say "which the Clips methods ask", or list every reader (ancestry: inScroller, drawnIn, contentToward, scrollViewsOn; unclipped: drawnIn, axesOf, contentToward, scrollViewsOn).

#### G055 · `src/ui-tree/remedy-text.ts:16` · low · false

- Claim: A leaf: types from standing.ts only, so the decision and its words are two modules, and either changes alone.
- Evidence (Sonnet, unverified): The module imports more than types from standing.ts. Line 1 imports the value `isTyped` (and the type `TypedPresentationKind`) from '../adapters/types.js', which it calls in `typedWords` at line 56. Line 2 imports the type `MarkedLayer` from './presentation.js'. Only line 3 takes types from './standing.js'. It is a leaf in the sense that it imports no verbs, but 'types from standing.ts only' is wrong on both counts.
- Fix: A leaf of the UI-tree layer: it imports standing.ts's types (and presentation.ts's `MarkedLayer`, adapters/types.ts's `isTyped`), no verb, so the decision and its words are two modules, and either changes alone.

#### G056 · `src/verify/color-parity.ts:100` · low · false · control sample

- Claim: `patches` reads inside it too, but for a rect under ~60 png px a side, whose corner patches' 9-px squares reach a few pixels past the 12 % line.
- Evidence (Sonnet, unverified): The sampler's region is already the 12%-inset region (pngRegion(..., EDGE_INSET), capture.ts:957-972; sampleRegion at color-parity.ts:87). patchRegions (150-167) clamps every patch into that region: px0 = max(x0, min(trunc(cx - p/2), x1 - p)), with p = min(9, w, h). A patch therefore never extends past the 12% line, whatever the rect size. The 'reach past the 12% line' exception does not exist in this code.
- Fix: Delete the 'but for a rect under ~60 png px ... 12 % line' clause. Say that `patches` reads inside the same region, each 9-px patch clamped into it.

#### G057 · `src/verify/contribution.ts:6` · low · stale-reference · control sample

- Claim: rect contributes the tree, color the measured frame, text its capture with the OCR pass
- Evidence (Sonnet, unverified): run/verify.ts:150-156: rectLegOf returns Contribution<RectLeg> = { tree, window }. Since 2026-10-07 rect contributes the tree and the window width judged at capture, not the tree alone (the comment at run/verify.ts:143-149 says so).
- Fix: rect contributes the tree and the window width (RectLeg), color the measured frame, text its capture with the OCR pass.

#### G058 · `src/verify/ocr-fold.ts:97` · low · doc-contradicts-code · control sample

- Claim: `[^’]` is `(?:(?![\'])[^’])`
- Evidence (Sonnet, unverified): foldClass builds `extra` with classMember (ocr-fold.ts:70, 253). classMember escapes only `] \ ^ -`, not `'`, so the output is `(?:(?!['])[^’])` with no backslash. The same comment writes the non-negated example as `(?:[’ -]\|['])`, also without one.
- Fix: Write `[^’]` as `(?:(?!['])[^’])`.
- Same claim as F235 above.

#### G059 · `src/verify/ocr-fold.ts:190` · low · doc-contradicts-code · control sample

- Claim: where their folds lie in `[start, end)` of `ocrFold(read)` (a dropped mark: where it stood)
- Evidence (Sonnet, unverified): readingFolds, line 199: for a fold of length 0 (a dropped mark), `inside = at >= start && at <= end`. The end bound is inclusive, so a dropped mark standing exactly at `end` is counted. The half-open range holds only for folds that have length.
- Fix: State that a dropped mark counts when its position is in [start, end], end inclusive. Other folds count when their fold overlaps [start, end).

#### G060 · `tests/adapters/android-wm.test.ts:584` · low · false

- Claim: API 14+'s `type=navigationBars` reads alike
- Evidence (Sonnet, unverified): src/adapters/android-wm.ts parseNavigationBand doc says "API 34+: `type=navigationBars` (WindowInsets.Type.toString), unmeasured". API 14 is wrong. The statusBars/navigationBars type strings come with API 34+ (the test's own STATUS_36 and NAV_36 helpers are the API 34+/36 shape).
- Fix: API 34+'s `type=navigationBars` reads alike

#### G061 · `tests/flow/config.test.ts:495` · low · stale-reference

- Claim: Review round 1: the key under the default tree source cannot act — said once at load time (flow/load.ts), decided here.
- Evidence (Sonnet, unverified): The default tree source is `auto` since A41a (the diff's own new test at ~line 503, 'treeSource omitted or auto (the default since A41a): nothing'). src/flow/config.ts inertKeyboardDismissNote returns undefined unless treeSource is explicitly `idb` (kind !== 'idb' -> undefined). The key under the default source is therefore not inert and no note is said. The doc block sits above the describe whose tests this diff rewrote.
- Fix: Review round 1: the key under a pinned `treeSource: idb` cannot act — said once at load time (flow/load.ts), decided here.

#### G062 · `tests/flow/tool-config.test.ts:112` · low · stale-reference

- Claim: Review round 1 of stage B: the key under the default tree source is inert — said on stderr once per file, by every loader.
- Evidence (Sonnet, unverified): The default is `auto` (tests/flow/tool-config.test.ts:139 says "the registry's default (auto)"). src/flow/config.ts inertKeyboardDismissNote notes only a project that pins idb. The diff changed INERT to add `treeSource: idb` for exactly this reason, but the doc above it still says "default tree source".
- Fix: Review round 1 of stage B: the key under a pinned `treeSource: idb` is inert — said on stderr once per file, by every loader.

#### G063 · `tests/mcp/tools.test.ts:1218` · low · stale-reference

- Claim: a handler that resolves its device with the WRONG kind — a `registry.get` with another kind, an aliased registry, a lazy resolver handed the wrong config — binds an idb adapter here.
- Evidence (Sonnet, unverified): Since A41a an omitted or default iOS tree-source setting is `auto`, not `idb`. tests/mcp/registry.test.ts (`an omitted setting is auto (A41a)`, bound = ['sim+auto']) and the sibling test at tests/mcp/tools.test.ts:1257 ('ios without a project config: one auto adapter') both show it. A handler that loses the project's config here therefore binds an auto adapter. A `registry.get` with an explicit `idb` is the only path that binds idb. The test under the comment asserts the bound list equals `[{treeSource:'wda'}]`, so it catches either wrong binding.
- Fix: binds a non-wda adapter here (an `auto` one by default since A41a, or an `idb` one if the wrong kind was named).

#### G064 · `tests/truth/batch/cases-live.test.ts:13` · low · stale-reference

- Claim: the mutation run's sandbox holds scripts/truth/batch/ alone, not live-cases.ts and what it imports.
- Evidence (Sonnet, unverified): stryker.config.mjs:35-40 un-ignores '/scripts/truth/*' and then '!/scripts/truth/*.ts', and its comment says scripts/truth's own modules (run-case.ts, which imports the live cases) are in the sandbox since A11 (commit 25efaa45). scripts/truth/live-cases.ts therefore is in the sandbox. The only scope.json note that agrees with the comment (line 252, 'a temp folder with no live-cases.ts') is dated 2026-11-05, before A11.
- Fix: Drop the sandbox reason, or say that cases-live.test.ts is kept apart because it reads this checkout's live-cases.ts for real. scripts/truth/batch/ is no longer the sandbox's only scripts/truth content.

#### G065 · `tests/truth/batch/cases.test.ts:15` · low · stale-reference

- Claim: (kept apart: the mutation run's sandbox holds only scripts/truth/batch/).
- Evidence (Sonnet, unverified): Same as the cases-live.test.ts finding. stryker.config.mjs:35-40 puts scripts/truth/*.ts, live-cases.ts among them, in the sandbox, so 'only scripts/truth/batch/' is no longer true.
- Fix: Say a fake selector stands in so the test does not depend on live-cases.ts. Delete the claim about what the sandbox holds.

#### G066 · `tests/truth/live-records-replayed.test.ts:26` · low · misleading

- Claim: (A9's raw typing diagnosis, a9-fill-tail-diag/, and T11's evidence, t11-carousel-visible/, are folders, which this guard does not read.)
- Evidence (Sonnet, unverified): The parenthesis names two folders as the ones the guard skips. docs/truth/live-records holds 27 subfolders (a22-gate-b, a22-truth-lab, a34-gate-b, a34-visibility, a35-two-display, a36-gate-c, a38-gate-c, a41-probe*, a42a-gate-b, a43-gate-c, d71..d84, t12-first-probe, t16-device-state, t19-short-state, t23-lab-run, t7b-chooser and others). The guard builds its list at line 140 as `readdirSync(RECORDS).filter((f) => /\.jsonl?$/.test(f))`, so every folder is skipped, not just those two.
- Fix: Say that every subfolder of docs/truth/live-records (a9-fill-tail-diag/, t11-carousel-visible/, the gate folders, and so on) is skipped, because the guard reads only the top-level .json and .jsonl files. Alternatively reword it as "e.g. a9-fill-tail-diag/ and t11-carousel-visible/".

#### G067 · `tests/truth/live-visibility.test.ts:541` · low · false

- Claim: live-visibility.ts produces `tap-claim` only on a `Tapped` reply and `stop-claim` only on a `visible` one, so an entry pinning either rule on another kind could never match.
- Evidence (Sonnet, unverified): judgeAbsentAtEnd in scripts/truth/live-visibility.ts:757 returns cls 'tap-claim' for any reply kind that is not 'visible' (kind = replyKind(scroll)), whenever the app logged something (`fired.length > 0`). A failing scroll_until reply (an error kind) therefore yields a tap-claim, not only a `Tapped` reply. judgeTap (lines 208-209) is the only tap-claim site that requires `Tapped`. stop-claim does only come on 'visible' (lines 390, 755). The test beneath (lines 543-546) forbids a LIVE_KNOWN tap-claim entry with kind other than 'Tapped', which would wrongly reject a legitimate entry for an absent-at-end case.
- Fix: live-visibility.ts produces `stop-claim` only on a `visible` reply, and `tap-claim` on a `Tapped` reply (judgeTap) or, in judgeAbsentAtEnd, on any non-stop reply of a case where the app logged something. Also relax the assertion for tap-claim, or restrict it to the cases judged by judgeTap.

#### G068 · `tests/truth/replies.test.ts:42` · low · stale-reference

- Claim: src's own builders (ui-tree/remedy-text.ts#presentedRemedy, #presentedStop) over every layer they word, and the active-window hint (#ACTIVE_WINDOW_HINT), which is no presented remedy.
- Evidence (Sonnet, unverified): ACTIVE_WINDOW_HINT is defined in src/ui-tree/miss.ts:101, not in ui-tree/remedy-text.ts. The bare `#ACTIVE_WINDOW_HINT` reads as a member of the same file as the two builders named just before it. presentedRemedy (remedy-text.ts:112) and presentedStop (remedy-text.ts:128) are correct.
- Fix: the active-window hint (ui-tree/miss.ts#ACTIVE_WINDOW_HINT)

## Fixed since (2026-11-13)

Entries below keep their text as audited; this section says which are closed. The backlog rows (docs/plans/2026-10-30-performance-backlog.md, A46 to A57) hold the detail.

- **A46** (merged `ade0c4f6`): F026, F044, F047, F051, F052, F056, F059, F068, F088, F092, F099, F100, F105, F107, F117, F125, F130, F148, F151, F171, F178, F180, F194, F203, F207, F260, G001, G002, G003, G005. Each was re-read against the code by the implementer, an independent reviewer and
  a two-axis code review before merge.
- **A47** (merged `7e0dab29`): F030, F080, F132, G004, and every comment pointer to the seven scripts no longer in the repo.
- **F188**: no change needed; the `type_text` description no longer names the key.
- **F039: the finding was wrong**, though verification had confirmed it. The Android toolbar cells never reach
  `FalseCoversScreen`: their layers are not in `Lab.kt#SUPPORTED_LAYERS`, the app shows them unsupported and a capture
  skips them, as the old comment said. A verified entry of this file is still a claim to re-read against the code.
- Everything else is open (A48 to A53 by directory; A54 and A55 are code decisions).

## Appendix: deletion candidates (490, unverified)

Comments Haiku judged to only restate the code. Line numbers are those of `48f92c5c`.

- `src/adapters/android.ts:263`: Restates the adb/runAdb structure ("`adb` and `shell` both end here; `typed` indexes this argv"), which the signatures and the next lines already show.
- `src/adapters/android.ts:1233`: Describes the format of the mCurrentFocus line, a restatement of the regex CURRENT_FOCUS_RE on the next line.
- `src/adapters/android.ts:1235`: Describes the dump's window header format, a restatement of WINDOW_HEADER_RE below it.
- `src/adapters/android.ts:1239`: Gives the Frames line format, which the regex WINDOW_FRAME_RE below already encodes.
- `src/adapters/android.ts:1241`: Says what WINDOW_VISIBLE_RE matches, which the regex and its name already say.
- `src/adapters/android.ts:1322`: Describes the (l,t,r,b) rect shape that TOUCHABLE_RECT_RE encodes.
- `src/adapters/android.ts:1359`: Describes the InsetsSource line shape that INSETS_SOURCE_LINE_RE encodes.
- `src/adapters/android.ts:1367`: Gives the DisplayFrames line format that DISPLAY_FRAMES_RE encodes.
- `src/adapters/android.ts:1525`: Restates what the SystemBands type holds; the Pick<DeviceScreen,...> type expresses it.
- `src/adapters/android.ts:1264`: Says what WmWindow is (one window of the dump as parseFocusedWindow reads it), which the interface and its fields show.
- `src/adapters/android.ts:1770`: Describes idEntry's behaviour (the entry name after ':id/'), visible from its body.
- `src/adapters/android.ts:1843`: "Not enabled, as the dump says it" restates the line `...(raw.enabled === 'false' && { disabled: true })` directly below.
- `src/adapters/adb-shell.ts:87`: "One argv word as the device's sh must see it to deliver it unchanged" restates shellQuote's signature and body; the rule itself is documented at the file header.
- `src/adapters/android-chooser.ts:168`: "The nodes among `nodes` with resource id `id`" restates the withId body (nodes.filter by identifier).
- `src/adapters/android.ts:1764`: Describes someAdjacentPair's traversal (a pair accepted by the callback, in any subtree), which the body states.
- `src/adapters/discovery.ts:154`: Inline `// "com.apple.CoreSimulator.SimRuntime.iOS-17-5" → "17.5"` only restates the regex's output.
- `src/adapters/discovery.ts:60`: `/** `<serial> <state> …` for a state of ADB_STATES. */` restates the ADB_LINE pattern that the next line already shows.
- `src/adapters/discovery.ts:170`: `ReadText` doc restates the type signature (path in, UTF-8 text out).
- `src/adapters/discovery.ts:254-258`: `BoundCheck` doc restates the union's two arms, which the type already shows.
- `src/adapters/discovery.ts:274`: `BootedProof` doc restates the signature and its true/false/throw convention, which the caller's code shows.
- `src/adapters/exec.ts:73`: ExecError `command` field doc restates that the argv is shownCommand's output.
- `src/adapters/exec.ts:34-37`: `execOptions` doc only restates what the function body builds.
- `src/adapters/failure-text.ts:59`: `/** What stands where a typed text stood. */` restates the TYPED_TEXT constant.
- `src/adapters/failure-text.ts:72-75`: shownArgs doc restates that it maps args word by word, which the one-line body shows.
- `src/adapters/failure-text.ts:91`: HOST_FOLDERS doc restates the array's two entries.
- `src/adapters/field-errors.ts:141`: ERROR_IDENTIFIER doc restates the regex in its own line.
- `src/adapters/field-errors.ts:144`: MAX_GAP doc restates the constant's value; its reason is already in the fieldAbove doc.
- `src/adapters/field-errors.ts:147`: overlapX doc restates the function body.
- `src/adapters/idb-helper.ts:88`: killChild doc `SIGKILL, and nothing if it is gone already` restates the try/catch body, and the inline `// already gone` repeats it.
- `src/adapters/idb-helper.ts:291`: dispose doc `Kill the helper and keep it off: the adapter is gone. Idempotent.` restates the body.
- `src/adapters/ios-foreground.ts:200`: Restates the ForegroundCheck interface's fields; the interface members' own docs carry the reasons.
- `src/adapters/ios-foreground.ts:277`: Restates what poll() does and that it returns a WaitEnd; the function name and signature say it.
- `src/adapters/ios-foreground.ts:298`: Restates the branch `if (read.kind === 'declined') return { kind: 'declined' }`.
- `src/adapters/ios-foreground.ts:379`: Restates isSpringBoard's body (label.trim() === '').
- `src/adapters/ios-foreground.ts:382`: Restates the whose() helper's output; the name and body say it.
- `src/adapters/ios-system-alert.ts:34`: Describes the regex OPEN_IN in words that the literal already states; the measured-form provenance is in the module header.
- `src/adapters/ios-url-schemes.ts:12-15`: Restates the body of linkScheme (the regex and toLowerCase); the RFC citation adds no reason.
- `src/adapters/ios-url-schemes.ts:92`: Restates schemeApprovalKey's template literal.
- `src/adapters/ios.ts:238`: Restates that simctl() delegates to xcode-env.ts; a one-line wrapper needs no comment.
- `src/adapters/ios.ts:243`: Section banner that only names the group of methods below it.
- `src/adapters/ios.ts:320`: Section banner that only names the group of methods below it.
- `src/adapters/ios.ts:692`: Section banner that only names the group of methods below it.
- `src/adapters/ios.ts:711`: Restates that viewport() returns screen size and band and is memoized; the types.ts contract already says so.
- `src/adapters/ios-tree-source.ts:471`: Pointer-only comment ('Measured: IDB_SETTLE_CADENCE_MS's doc') that restates where the value is documented.
- `src/adapters/ios-typing.ts:14`: Restates the IDB_REFUSES regex's role, which the constant name already gives.
- `src/adapters/types.ts:1376`: Restates the method name ('logs' returns logcat/os_log lines); the signature says it.
- `src/adapters/types.ts:1379`: Restates isAppRunning; the signature and name already say what it returns.
- `src/adapters/types.ts:1395-1397`: RgbaImage JSDoc restates the interface fields (width, height, data as width*height*4 bytes); only the 'Here, at the bottom of the layers' remark has any reason in it.
- `src/adapters/types.ts:1405-1408`: RawImage JSDoc restates that it extends RgbaImage with a Buffer; the declaration says it.
- `src/adapters/types.ts:1413`: ScreenCapture one-liner restates the union type's two branches.
- `src/adapters/types.ts:326`: Restates the field 'error?: string' ('validation message ... when the platform exposes one').
- `src/adapters/types.ts:133`: Restates the ScrollAxis type alias ('the one axis a scroll view scrolls on').
- `src/adapters/types.ts:790`: Restates the KeyboardWitness union; the pointer to KeyboardOracle.witness adds nothing a reader needs.
- `src/adapters/png-encode.ts:50`: Restates compressedRatio in words ('every 16th row deflated at level 1: its compressed size over its size'), which the body shows.
- `src/adapters/png-encode.ts:101`: Restates changesInRow ('how many of row y's pixels differ from their left neighbour').
- `src/adapters/png-encode.ts:121`: Restates chunk(): length, type, data, CRC, all visible in the body.
- `src/adapters/png-encode.ts:40`: Inline comment restates the IHDR bytes (8-bit, RGBA, deflate, method 0, not interlaced) that the array literal already spells.
- `src/adapters/screenshot-bytes.ts:38`: Restates PNG_SIGNATURE ('every PNG starts with these 8 bytes'); the constant is the signature.
- `src/adapters/screenshot-bytes.ts:142`: Restates described(): '0 bytes' or the size and the first 60 characters, both in the body.
- `src/adapters/simctl-appinfo.ts:60`: Restates scalar(): undefined for none, a dictionary or an array, which its guard shows.
- `src/adapters/wda-source.ts:152`: 'Nested tree, flat rule: rects are absolute, so a walk is all it takes.' restates the walk in the next line; no reason is given.
- `src/adapters/wda-source.ts:319`: 'node.children is el.children mapped one to one, so one count is both.' describes the code's mapping and restates it.
- `src/adapters/wda-source.ts:252`: 'WDA names a secure field by its type ... the lab's PIN is a SecureTextField.' restates the SECURE_BY_TYPE lookup on the next lines.
- `src/adapters/wda-source.ts:42`: 'Structural types that never appear in idb's flat AX list:' is a section label that restates the entries below it.
- `src/adapters/wda-source.ts:843`: 'No Window: the root stands in for it as the SCREEN' restates the ancestors[0] fallback on the same line; the reason is not stated.
- `src/adapters/wda-source.ts:133-136`: The JSDoc 'Parse the raw /source?format=json response body.' restates the name and signature; the function is a one-line wrapper.
- `src/adapters/wda.ts:355`: JSDoc 'This WDA start's session for keys(): the one made on it, or a new one (KEYS_SESSION), single-flight.' restates sessionId()'s body.
- `src/adapters/wda.ts:403`: JSDoc 'A JSON POST of route under timeoutMs; a request that did not complete throws as fetch threw it.' restates post()'s one-line body.
- `src/adapters/wda.ts:603`: JSDoc 'The tail of a failure that names where: ...' restates where()'s one-line return value.
- `src/adapters/wda.ts:146`: JSDoc 'Same UDID → same port; distinct UDIDs → distinct ports (8100, 8101, ...).' restates wdaPortFor's behaviour, which the code shows directly.
- `src/adapters/wda.ts:413`: JSDoc 'One GET of a running WDA under timeoutMs, no start and no retry; fails naming name ...' restates askOnce's body.
- `src/flow/condition.ts:103`: JSDoc 'element id:"x", state logged_in, any(...) ... a condition as the trace and the timeouts name it.' describes describeCondition's output format, which the function body already shows.
- `src/flow/condition.ts:69`: 'The adapter memoizes it (adapters/types.ts): one device read per adapter.' is a state fact about another module that changes with it and is not needed to use viewport().
- `src/flow/condition.ts:60`: JSDoc 'What evaluation needs from outside the tree: a state's detect, and the device's viewport for absent.' restates the ConditionContext fields that follow.
- `src/adapters/wda-tree-source.ts:150-155`: JSDoc on typeText restates the method body (WdaServer.keys, released check, rethrow) and its call path; only the 'WDA not up' note adds anything, and that is stated in the body.
- `src/flow/engine.ts:1377-1388`: Restates when the ⚠ line of scroll_until fires (clipped, covered, unlocated, stopHedges); the rule is in the code and in interact/scroll-text.ts.
- `src/flow/engine.ts:1404-1408`: Restates the value-poll cadence and the 350 ms focus delay constants that live in the code; the reason (late RN value on WDA) is the only part worth keeping.
- `src/flow/engine.ts:1411-1417`: Describes the fill line's wording and points at a bug note; the wording lives in interact/fill-text.ts.
- `src/flow/engine.ts:1425-1435`: Describes which result fields the fill trace reads and when each warning is logged, which the code shows directly.
- `src/flow/engine.ts:1655-1670`: tracingDismissal doc restates the three trace-line shapes the function emits; the function body makes this plain.
- `src/flow/engine.ts:1749-1773`: pollUntil doc restates the loop, its three-valued predicate and its message selection, all visible in the body.
- `src/flow/engine.ts:1717-1725`: evaluate doc restates what it passes to evaluateCondition; the 2026-10-08 history sentence explains nothing about why it exists now.
- `src/flow/engine.ts:1794-1796`: resolveValue doc restates the function (resolve, then register the secret for redaction), which the three body lines show.
- `src/flow/engine.ts:1817`: 'All errors leave the engine redacted, and carrying the partial trace.' restates guard()'s body.
- `src/flow/engine.ts:1836-1840`: stepSummary doc restates the ✗ line format; the reason it omits values is worth keeping but the format sentence is not.
- `src/flow/engine.ts:1361-1368`: Change history (pollMs passed as settleMs until 2026-10-05, and a production timing change nobody measured); it is a changelog, not a reason the current code exists.
- `src/flow/config.ts:26-27`: Location and date note for the Condition re-export ('lives in flow/condition.ts since 2026-10-08'); the import path and git history say the same.
- `src/flow/config.ts:328`: 'What a step may be, said wherever one is not.' restates the STEP_ONE_OF constant's purpose.
- `src/flow/config.ts:560`: 'What a launch call says about its entry point' restates the LaunchEntry interface it sits on.
- `src/flow/credentials.ts:32-35`: Restates the EnvValues type alias (a record of optional strings, assembled by the loader); the type says it.
- `src/interact/fill-clear.ts:54`: `/** What the driver does next. */` restates the ClearStep type; the union shows it.
- `src/interact/fill-clear.ts:96-97`: `/** Every delete sent, all rounds. */` restates the field name `deletes`.
- `src/interact/fill-clear.ts:51`: `One reading of the field ... its value, or why the read found no field` restates the ClearSeen type.
- `src/interact/fill-clear.ts:108`: `The clear before its first reading.` restates startClear, whose body is one object literal.
- `src/interact/fill-clear.ts:4-19`: Refactor history (dated 2026-10-09, the names of the five variables it replaced). It is not a reason the code exists; git history holds it.
- `src/interact/fill-reformat.ts:14`: `The spaces a field may show ... a space, a no-break and a narrow no-break space` restates the SPACES constant's value.
- `src/interact/fill-reformat.ts:71`: `Each added separator between two typed letters or digits; the groups between them.` restates the loop it sits above.
- `src/interact/fill-landing.ts:55`: `What the text rules ask of an Expectation: the value, and the earlier text it is typed after.` restates the TextExpectation alias, which is a Pick of four fields.
- `src/interact/fill-landing.ts:210`: `The bullets the field held after focus, an unread count as none.` restates the one-line heldCount body.
- `src/interact/fill-landing.ts:126`: `What can be said of a reading that did not land ... whether it is a whole landing too is asked here.` restates notLandedOf's signature and return type.
- `src/interact/fill-text.ts:160-174`: The FillWording doc lists each field's wording format. wordingOf() shows the same thing, and the field names say what each holds.
- `src/interact/fill-text.ts:124-134`: The fillStepText layout description restates the line template in its body. Keep only the caveats-before-dismissal note, which is at FillStepText lines 66-70.
- `src/interact/fill-text.ts:196-200`: The reformattedText doc gives example output (`the field shows them reformatted: 2 separators added`) that the function body already produces.
- `src/interact/fill-text.ts:209-213`: The retypedText doc gives example output that the function body already produces.
- `src/interact/fill-facts.ts:79`: `The matched node's role (the one tapped, typed into and read back).` restates the field name `role`.
- `src/interact/fill-type.ts:75`: `/** Delete `count` characters (DeviceAdapter.clearText). */` restates the signature of FieldIo.wipe.
- `src/interact/fill-type.ts:132`: `/** Type the value and confirm it landed; send again what the rules above allow. */` restates typeAndConfirm's name and the module header.
- `src/interact/fill-type.ts:211,216`: Two one-line docs restate the type OtherInputs and the function inputsOf, both obvious from their code.
- `src/interact/fill-verdict.ts:141`: `/** A fill, judged. Built only by `judgeFill`; its invariants are the module header's. */` restates the interface and points to the header.
- `src/interact/fill.ts:38`: `/** The guard's options (the focus tap goes through resolveClearOfKeyboard ...) plus the fill's own. */` restates the extends clause.
- `src/interact/fill.ts:50-53`: nearestInput's doc restates what its loop body does (overlap, then gap, zero-area skipped) and adds no reason.
- `src/interact/flush-check.ts:282`: `/** What the flush check is shown of a read that judges a fully: true stop (`seeFlush`). */` restates FlushStop's own type and the seeFlush signature.
- `src/interact/flush-check.ts:294`: `/** What the round can send a probe with this read. */` restates ProbeMeans, whose fields are documented individually.
- `src/interact/flush-check.ts:391`: `/** `probed` was sent from where an earlier first probe held ...: the same rect, within a pixel, and the same edge. */` restates heldBefore's body.
- `src/interact/keyboard-dismissal.ts:77`: `/** The configured dismissals as strategies, in the config's order. */` restates configuredStrategies's one-line body.
- `src/interact/keyboard-dismissal.ts:83`: `/** The first strategy of `strategies` that chooses a move on `ground`, and why each one before it passed. */` restates nextMove's loop.
- `src/interact/keyboard-dismissal.ts:97`: `/** The move, sent: one tap, or one drag at DRAG_SPEED (`dismissalDragMs`). */` restates perform's body.
- `src/interact/keyboard-dismissal.ts:277`: `/** How long a drag takes at DRAG_SPEED, in ms. */` restates dismissalDragMs's formula; the unit is in the name's code.
- `src/interact/keyboard-in-tree.ts:158,169,172`: Three docs (`Tapped id:…` a still-up refusal's opening; `tapped id:…`, the trace's; `nothing else was tapped, or done`) only show the output format of movesDone, movesTrace and nothingElse, which the code already spells out.
- `src/interact/keyboard-model.ts:186-187`: seenLook's doc restates the function body (builds a SeenLook from resolved + lookOn).
- `src/interact/keyboard-model.ts:80`: Field doc 'Where to tap: the centre (tapPoint), or the moved point moved describes' restates the type and the code.
- `src/interact/keyboard-model.ts:290`: 'The first look that found the point covered, what a model's guard protocol starts from' restates the CoveredLook name.
- `src/interact/keyboard-model.ts:294`: 'Where the target was on that look.' restates the field name point.
- `src/interact/keyboard-model.ts:309`: '`the soft keyboard covered <what>` - the fact every sentence starts from' restates the field's code in the caller (keyboard.ts builds it).
- `src/interact/keyboard-window.ts:101-137`: The 2026-10-05 and 2026-10-07 change history of the decision table is a changelog, not a reason the code exists; it names functions that no longer exist (firstLook, afterBack). Git history holds it.
- `src/interact/keyboard-window.ts:354`: '// confirmed: the normal dismissal below' restates the next statement.
- `src/interact/keyboard-window.ts:381`: '// hold: one more round' restates the loop.
- `src/interact/keyboard-window.ts:483`: '// Shown ANYWHERE is in the way, there is no point to test.' restates the call to dismissal().
- `src/interact/keyboard.ts:179`: '// Handed back clear, nothing sent: judged again on the look that holds the node, off its reading.' restates the next line's code.
- `src/interact/keyboard.ts:182-183`: The loop comment 'Each hiding: its one side effect, then its confirming looks...' restates the for-loop body.
- `src/interact/keyboard.ts:79-106`: 'The protocol, the same shape on both models' walks through the function's steps in order; it duplicates keyboard-model.ts and the code, and goes stale whenever a step changes.
- `src/interact/margin-memo.ts:45`: 'The memo before a call's first read: nothing seen.' restates startMargin's body (close([])).
- `src/interact/margin-memo.ts:57`: 'How far a node moved, in the source's frame units: across (dx) and down (dy).' restates the Offset interface's two field names.
- `src/interact/motion-ledger.ts:172, 176`: Field docs 'Every match's rect at the last read that read.' and 'The whole tree's fingerprint at the last read that read.' restate the Memory field names and types.
- `src/interact/scroll-rounds.ts:872`: /** Another confirming read is within the stroke's budget and the deadline. */ restates the mayConfirm predicate.
- `src/interact/scroll-rounds.ts:1321-1322`: /** One round's step, as `round` returns it. */ restates the type name.
- `src/interact/scroll-rounds.ts:1324-1325`: /** A `visible` stop, as `round` makes it. */ restates the type alias.
- `src/interact/scroll-rounds.ts:1483-1484`: /** The target's matches in this round's tree. */ restates the field name `found`.
- `src/interact/scroll-rounds.ts:1486-1492`: Field docs on BoundRound (best, viewport, miss) that only restate each field's type and source; the context is already in the enclosing round() comments.
- `src/interact/scroll-rounds.ts:611`: /** The screen a round judges in: ... */ restates the Frame alias, whose meaning is given at State.frame.
- `src/interact/scroll-rounds.ts:614-616`: /** Everything the scroll remembers between rounds, one record with one writer (`round`). */ restates the State interface's purpose and repeats the module doc.
- `src/interact/scroll-rounds.ts:226`: /** Whether `cut` is by a node drawn after it, not at a clipping container's edge. */ restates the isCutByLater guard's body.
- `src/interact/scroll-rounds.ts:1290-1291`: 'review round 1, the coordinator's decision' is process history, not a reason the code needs; the reason (a terminal stop rests on a read that read) stands without it.
- `src/interact/scroll-read.ts:243-244`: /** One read's judgement (`judgeRead`) — every fact of the read the round's cross-read steps read. */ restates the ReadJudgement type.
- `src/interact/scroll-read.ts:236-237`: /** The stop's purpose ... mapped once a read. */ restates the StopOf alias.
- `src/interact/scroll-read.ts:86-89`: Field docs on RoundRead.found and RoundRead.ofKeyboard restate what the names and types already say; only the first sentence carries a reason.
- `src/interact/scroll-read.ts:58`: /** What a read followed: the scroll's start, a stroke, or a settle pause that sent nothing (a confirming read). */ restates the three literal values of the Since union.
- `src/interact/resolve.ts:361-366`: WaitEvidence field docs (sighted, treesRead, readError) restate their names; the absence rule that uses them is documented once at absenceError (resolve.ts:371-380).
- `src/interact/resolve.ts:306`: `let run = 0; // consecutive rounds that resolved it, up to the last tree read` restates the variable's name and its increment in the callback.
- `src/interact/scroll-text.ts:220`: Doc on stoppedWhen restates what the function returns ('before any swipe' / 'after N swipes') and adds no reason.
- `src/interact/scroll-text.ts:223`: keyboardUp doc restates the body: it maps Judged.under to KeyboardUp.
- `src/interact/scroll-text.ts:245`: ClipFacts doc says what the type holds; the field names already say it.
- `src/interact/scroll-text.ts:513`: frameWords doc restates the ternary that picks the viewport or the screen above the keyboard.
- `src/interact/scroll-text.ts:536`: whenInFrame doc restates the two-branch output string.
- `src/interact/scroll-text.ts:832-835`: withinRect doc restates JSON.stringify of the rect fields; the reason (scroll_until's schema takes this JSON) is the only part worth keeping.
- `src/interact/scroll-text.ts:844`: DIRECTIONS_ON doc restates the record's contents.
- `src/interact/scroll-text.ts:973`: SIZE_WORDS doc restates the record's contents.
- `src/interact/scroll-text.ts:1054`: CHANGED_IDS_QUOTED doc restates a literal constant's use.
- `src/interact/scroll-text.ts:1080`: shortClause doc restates the switch over shortOf's kinds.
- `src/interact/scroll-text.ts:1219`: BESIDE_NAMED doc carries review history ('review round 1'), which belongs in git, not the code. Delete it or keep only 'the largest are named, the rest counted'.
- `src/interact/scroll.ts:22`: 'Default down.' restates the default at scroll.ts:303; the field name and the code already say it.
- `src/interact/scroll.ts:24,27`: 'Default DEFAULT_MAX_SWIPES.' and 'Default false.' restate the defaults set at scroll.ts:302-306.
- `src/interact/scroll.ts:327`: 'This round's read with the window manager's mark on its tree; a miss as it came.' restates the next line's expression.
- `src/interact/scroll.ts:329-331`: The screen-box comment restates how screenBox is called and what RoundSeen.screen holds; the call and the field are self-explanatory.
- `src/interact/swipe.ts:44-48`: The JSDoc restates swipeVector's body (box, SWIPE_REACH_FRACTION either side of centre). Its caller list ('swipeScreen and the scroll loop') is already wrong and will drift.
- `src/interact/swipe.ts:201-206`: sameStroke's first sentence ('the same touch-down and the same lift-off, point for point') restates the expression. Only the 'points, not spelling' clause explains anything.
- `src/interact/swipe.ts:301-306`: SwipeOptions field docs ('Repeat the same gesture. Default 1.', 'Handed to the adapter's swipe; its own default when absent.') restate the field names and types.
- `src/interact/swipe.ts:310-311`: ScreenSwipe's doc 'What swipeScreen drew, for the caller's report.' restates the type's name and use.
- `src/interact/tap.ts:20-21, 30-31`: 'What a tap by selector says of itself' and 'What the MCP reply prints of a tap' restate the type names. The Tapped and TapMarks fields are self-describing.
- `src/interact/tap-judgement.ts:116-117, 178-179, 309-310`: Section banners ('// ─── The refusals', 'The judgement of a look', 'The outcome of a standing') restate the layout and carry no reason.
- `src/interact/tap-judgement.ts:281`: Inline comment 'The reading's line only for a covered centre of a target on the screen and not cut.' restates the boolean expression on the next line.
- `src/interact/tap-judgement.ts:300`: Inline comment 'Refused on the screen read again; on the first look's when none could be read again.' restates the ternary below it.
- `src/interact/tap-judgement.ts:415`: Inline comment 'On the screen, but outside what its scroll view draws: that scroll view's edge is the edge.' restates the branch condition; the same fact is in the module doc.
- `src/interact/target-text.ts:43`: Inline comment 'Past the edge of what its scroll view draws, that scroll view on the screen' restates the if-clause that follows.
- `src/interact/target-text.ts:145-146`: keyboardUpText's doc 'the one phrase of dismissKeyboardFirstText and keyboardMayCoverText' restates the call sites. The function is a one-line template string.
- `src/interact/target-text.ts:259-262`: coverName's first paragraph ('a cover as the dismissal strategies' skip lines name it: button "Sign in", toolbar') restates the output format. Only the second paragraph, on why it differs from nodeText, explains anything.
- `src/interact/stroke-plan.ts:167`: startStrokes doc 'The memory before any read: no scroll view known, no keyboard line, no stroke sent.' restates the object literal it returns.
- `src/interact/stroke-plan.ts:404`: roomOfNamed's doc ('StrokePlan.noRoom of the named scroll view rect: its length along a stroke toward on gesture...') restates the function body's arithmetic.
- `src/mcp/platforms.ts:10-14`: Restates what normalizePlatforms does (undefined means both, duplicates collapse, canonical order); the body and PLATFORM_ORDER already show it.
- `src/mcp/registry.ts:151`: `Device id the platform's tools currently target, if any binding exists.` restates boundId's body.
- `src/mcp/registry.ts:156`: `Pin the platform's tools to one booted device (id from listAll).` restates select().
- `src/mcp/registry.ts:87`: `The registry's two seams ... both or neither` restates the RegistryDeps interface, and the constructor comment (137-137) says the same.
- `src/mcp/lifecycle.ts:58`: `One shutdown: dispose within budget, flush the transport, exit 0. Exported for tests.` restates the function body.
- `src/interact/within.ts:56-68`: Per-variant docs on WithinRefusal (`The selector matches several nodes`, `The selector matches nothing in the tree`, and similar) restate the variant names and the code that builds them; only the reasons for the stale and across variants are worth keeping.
- `src/interact/unfit-axis.ts:31-37`: Field docs on AxisEvidence (`the room-giving scroll view: the smallest of the target's along along`, the 'facts/motion' gloss) restate the types and the reduce in scroll-read.ts:530.
- `src/mcp/tools.ts:81-82`: `That is several statements, not 'ONE delegation'.` corrects an older wording of this same doc block and says nothing about why the handler exists.
- `src/mcp/tools.ts:43-48`: Historical anecdote about a surviving mutant and test-wall hits from 2026-10-03; it describes the past, not why the seam exists today.
- `src/mcp/tool-text.ts:50-54`: `Moved out of the handler 2026-10-08 with the singular` is migration history; the wording rule it documents is in the code.
- `src/mcp/tool-text.ts:73-74`: `Moved out of the handler 2026-10-03: wording, not delegation.` is migration history.
- `src/run/commands.ts:147-161`: The long 'Until 2026-10-08 this loaded averi.yaml itself ...' paragraph is history of the narrowing; the current guard and the health-line rule are in the code and in the AssertCall.cfg doc.
- `src/run/commands.ts:172`: `// the health line is omitted, as before 2026-10-08; the verdict stands` restates the catch and carries only a date.
- `src/interact/type-text.ts:6-8`: `(code review of the top-4 pass, 2026-10-07)` is a review pointer, not a reason; the rule it introduces is stated in the same block.
- `src/ui-tree/draw-order.ts:1700`: 'Each floating tab bar's item, with its bar' restates the declaration type of tabItems.
- `src/ui-tree/draw-order.ts:1779`: 'Everything drawn after placed's subtree' restates `order.slice(placed.end)` on the next line.
- `src/ui-tree/draw-order.ts:1804`: 'paintsOver's clickable layer: unlabelled, unvalued, interactive, holding the node whole, on its own branch' restates the predicate's body.
- `src/ui-tree/draw-order.ts:1637`: wordsOf doc ('The words a node says ... split at anything not a letter or a digit') restates the one-line body.
- `src/ui-tree/draw-order.ts:1678-1681`: drawOrder doc restates the signature and the orderSeen parameter; the parameter is named in the signature itself.
- `src/ui-tree/draw-order.ts:1691-1694`: 'Every place of each node in the walk' and 'What is presented over what' restate the two const assignments below them.
- `src/ui-tree/draw-order.ts:1760-1763`: Inline comment restates the code of `drawn` (ownLabelOf and drawsAsPeer) line by line; the why (peers judged with no reading order) is already on line 1764.
- `src/ui-tree/cover.ts:58,61-62,64-65`: Docs for drawOrderFound, coverAtPoint and lastPresented restate one-line bodies whose names say the same thing.
- `src/ui-tree/bare-tree.ts:184-190`: largestRect and within docs restate their bodies (the largest rect; a rect wholly between two lines).
- `src/ui-tree/bare-tree.ts:277-281`: treeShape doc restates the format of its return string and its one caller's use; nodeCount is fine but treeShape's example line is the same as the one above it.
- `src/run/verify.ts:380-382`: 'One dimension's problems — none when this contract does not produce its table' restates the one-line body of dimensionProblems.
- `src/run/verify.ts:50`: 'The engine context (environment, session) is flow/engine.ts#EngineContext, shared with run/commands.ts' is a pointer that restates the import on line 7.
- `src/run/verify.ts:663-667`: SectionBuild member docs ('The section body when NO leg contributed', 'The comparator and its renderer') restate the field names and types.
- `src/run/verify.ts:537-541,566-568`: Dated 'Until 2026-10-07 this called ...' and 'until 2026-10-02 this was a bare screenshot' narratives are history that git carries; the current reason (shared trace, settled frame) is already stated beside them.
- `src/ui-tree/geometry.ts:1403-1406`: rectText doc only restates the format (x,y wxh) and that it is used for every sentence; the rect-spelling pair note above it carries the reason.
- `src/ui-tree/geometry.ts:1448-1450`: frameText doc restates the output format of dumpsys; the note about rectText is a pointer to the pair block above.
- `src/ui-tree/geometry.ts:905-906`: isUntold doc restates its one-line body (told === false).
- `src/ui-tree/geometry.ts:908-909`: toldFrame doc restates its body (returns drawn only when told === true).
- `src/ui-tree/geometry.ts:927-928`: UNTOLD doc restates that it is the answer for every node of a tree with no ancestry, which the DrawnUntold block already says.
- `src/ui-tree/geometry.ts:639-640`: EDGES doc restates the array literal (top, bottom, left, right) it sits above.
- `src/ui-tree/geometry.ts:1197`: across doc restates the body (height for top/bottom, width for sides).
- `src/ui-tree/geometry.ts:328-329`: collectRects doc restates its body (first occurrence of each identifier, pre-order).
- `src/ui-tree/geometry.ts:565`: largestRect doc restates its reduce body.
- `src/ui-tree/geometry.ts:991-992`: LISTED doc restates the constant's value (kind listed).
- `src/ui-tree/eyes.ts:63`: CLIP_LINE doc restates the constant and its type, both one line below.
- `src/ui-tree/eyes.ts:147`: EyesFinding doc restates the Exclude<> type alias it sits on.
- `src/ui-tree/eyes.ts:238`: OrderEyes doc restates the Pick<Eyes, 'order'> alias it sits on.
- `src/ui-tree/eyes.ts:433-435`: Inline comment in bandsBeside restates which strips are rows and which are columns, which the code and the doc block above already show.
- `src/ui-tree/eyes.ts:269-275`: Per-field docs on OrderPair (peer, overlap, nodeBands, peerBands) restate the field types and names, with no reason given.
- `src/ui-tree/later-edges.ts:159`: /** Every edge `none`. */ restates uncut(), which returns every edge as none on the next lines.
- `src/ui-tree/keyboard-cover.ts:421`: Memoise doc restates once(): the code's name and body already say it is asked on first need and never again.
- `src/ui-tree/keyboard-cover.ts:395`: keyboardRects doc restates the one-line arrow function (band first, then panels).
- `src/ui-tree/keyboard-cover.ts:439-440`: Inline comment restates the three-call order already written in the module doc (lines 52-65) and in the code it sits beside.
- `src/ui-tree/keyboard-cover.ts:323`: Inline comment '// the band alone (docked), or an empty region' restates the return on the same line.
- `src/ui-tree/keyboard-cover.ts:450`: covering doc restates its signature and body (first covered rect that hits, or unknown).
- `src/ui-tree/look.ts:59`: lookAt doc restates the function: a look of tree with reading, members derived once, no device asked.
- `src/ui-tree/look.ts:90`: lookOn doc restates the one-line body (lookAt of readKeyboard(adapter, tree)).
- `src/ui-tree/miss.ts:286`: missCarried doc restates the body (instanceof MissedError ? miss : undefined).
- `src/ui-tree/miss.ts:228`: missNote doc restates the switch that follows it (which kinds return undefined).
- `src/ui-tree/miss.ts:171`: clippedOutOf doc restates the body (the sides set, or none when one match has none).
- `src/ui-tree/placed.ts:140`: itemless doc restates the one-line predicate (role toolbar and framesOnly).
- `src/ui-tree/placed.ts:143`: screenSized doc restates the predicate (children present and fillsScreen).
- `src/ui-tree/keyboard-position.ts:122`: higher doc restates the one-line ternary: smaller y wins, a is kept on a tie.
- `src/ui-tree/later-edges.ts:164`: classified doc restates the function signature and its one branch on the dialect (cutsAtLater).
- `src/ui-tree/selectors.ts:224`: 'Center of the node's rect — where taps land' restates tapPoint's one-line body (rectCentre(node.rect)).
- `src/ui-tree/selectors.ts:216-222`: History only: notes that resolveOne/findOne and the viewport predicates moved out. Nothing about current behaviour; a reader gains nothing.
- `src/ui-tree/selectors.ts:106`: 'Every node under root (pre-order) that satisfies all conditions. The one walk both lookups share.' restates findMatching.
- `src/ui-tree/sides.ts:45`: clippedOutText doc restates the one-line function that builds the sentence.
- `src/ui-tree/sides.ts:48`: revealText doc restates the function (returns scroll_until it with direction: the side's reveal word).
- `src/ui-tree/read-tree.ts:489`: saysOf doc restates the template literal it returns (role, label, identifier, value).
- `src/ui-tree/read-tree.ts:568`: listedOnce doc restates what the loop and the twice-set do; the function name already says it.
- `src/ui-tree/read-tree.ts:581`: sameScreen doc ('the very same ids') restates the one-line comparison.
- `src/ui-tree/read-tree.ts:584`: anotherScreen doc restates the boolean expression on the next line.
- `src/ui-tree/read-tree.ts:162-168`: pollOnVerdict doc restates the ternary that follows it (yes -> value, unknown -> Undecided, else undefined).
- `src/ui-tree/reading-order.ts:91`: NO_READING_ORDER doc restates the constant's empty fields.
- `src/ui-tree/seen-order.ts:44`: seenOrderOf doc restates the function's body (asks either way round by node identity).
- `src/ui-tree/presentation.ts:159`: NOTHING_OVER doc restates the object literal it is.
- `src/ui-tree/scroll-containers.ts:59`: scrolls doc restates its body (clips(n) or SCROLLING_ROLES.has(role)).
- `src/ui-tree/soft-keyboard.ts:231-233`: cannotHide doc restates the conditional it returns; only the 'one composition' note adds anything, and the code shows it.
- `src/ui-tree/standing.ts:412`: Restates the type it documents: 'The navigation bar: the system bar at the screen's bottom.' Nothing about why it exists.
- `src/ui-tree/standing.ts:415`: Restates the type it documents: 'The status bar: the system bar at the screen's top.'
- `src/ui-tree/standing.ts:481`: Says 'The words for each typed kind' above a const whose name and type already say it.
- `src/ui-tree/standing.ts:817`: 'The scene of tree: its draw order and clip facts, each derived on first use and kept.' restates sceneOf's body (lazy getters on order and clips).
- `src/ui-tree/standing.ts:1257`: Describes pointPlaced's three return branches, which are the body (off, outside, bar).
- `src/ui-tree/standing.ts:1265`: Restates sliverCut's one condition as prose.
- `src/ui-tree/standing.ts:1269`: Restates underLine's body in prose.
- `src/ui-tree/standing.ts:1273`: Restates aboveLine's body in prose (the box's width, cut at the line).
- `src/ui-tree/standing.ts:1346`: 'The facts of a node judged in frame, from its exposure there' restates factsIn's signature.
- `src/ui-tree/standing.ts:1405`: THE ORDER restated as a sentence over stopOrdered's body, which the ordered() call already shows.
- `src/ui-tree/system-bar.ts:20-21`: 'The bar a system band is: status bar at the top, navigation bar at the bottom' restates systemBarName's body.
- `src/ui-tree/usable-screen.ts:114`: 'The usable screen of a device size read (or none) and a tree's inferScreenSize ... the one derivation, pure' restates usableScreenOf's signature.
- `src/ui-tree/usable-screen.ts:203`: sameSides doc restates its one-line body (side-for-side within SCREEN_AGREEMENT_PCT).
- `src/ui-tree/window-mark.ts:39`: Restates windowMayBeTyped's three-term conjunction in prose; the code is clear.
- `src/ui-tree/verdict.ts:60`: 'Is the element there? found is what the selector matched' restates presenceVerdict's signature and body.
- `src/verify/assert.ts:138`: Restates the field's flags and compile path ("Unanchored, no flags"); the only reason, refused at parse, is already in the schema error.
- `src/verify/assert.ts:140`: Restates the unit of heightPct ("Ink height in % of screen width, e.g. 3.8"); the field name and type already say it.
- `src/verify/assert.ts:142`: Restates the default of tolerancePct ("default 10"), which is DEFAULT_SIZE_TOLERANCE_PCT in text-parity.ts.
- `src/verify/assert.ts:243`: Restates the PersistentReadMode type ("whether an assert throws ... or fails on it") that VerifierOptions.persistentRead already documents.
- `src/verify/assert.ts:265`: Restates the FirstSample field ("Where this assert may take a handed-on read as its first round"), which the type and the assert() doc already give.
- `src/verify/assert.ts:690-694`: History narration ("The first cut refused on confirmed === false ...") about a superseded version of the check. The current code and the confirmed===true rule need no account of the earlier cut.
- `src/verify/assert.ts:786`: Restates the constant it precedes ("Crash signatures per platform, scanned over recent device logs").
- `src/verify/assert.ts:798`: Restates scanForCrashes ("Returns crash-related log lines") and its visible 8-line context.
- `src/verify/capture.ts:286`: Field doc that restates values ("2 for a still screen, up to STABILITY_ATTEMPTS + 1 ...") already derivable from the constants and the loop.
- `src/verify/capture.ts:842-852`: One-line interface docs (StabilityRegion, SizedRegion) that restate their shape; the names and fields say the same.
- `src/verify/capture.ts:919`: Restates the EdgeBounds shape ("A rect by its edges, half-open ..."). The inline type says it.
- `src/verify/capture.ts:202`: Provenance line for a re-export that the import/export lines already show; it adds no reason.
- `src/verify/ciede2000.ts:31`: Restates the body ("sRGB (0-255) -> linear -> XYZ (D65) -> CIELAB") line by line.
- `src/verify/ciede2000.ts:99`: Restates the signature ("dE00 between two '#RRGGBB' strings").
- `src/util/duration.ts:8`: Restates the accepted input forms and return unit already visible in the signature and the regex on the next line.
- `src/verify/ocr.ts:39`: JSDoc on OcrRegion restates the interface fields (id, x, y, w, h) and adds nothing a reader cannot see.
- `src/verify/ocr.ts:48`: JSDoc on OcrLine restates the field types and the coordinate origin, which the field names and the producing code already state.
- `src/verify/ocr.ts:51`: Field comment "Vision's confidence for the top candidate, 0..1" restates the type; the filter that uses it is explained elsewhere.
- `src/verify/png.ts:49`: Comment "Chunk types as big-endian uint32, the way they sit in the stream" describes the constants' encoding, which the hex values show.
- `src/verify/png.ts:57`: Comment on BYTES_PER_PIXEL restates the map literal, which is self-describing.
- `src/verify/pixel-poll.ts:274`: JSDoc on foundAt restates what the method does (records a rect, returns the previous one); the body does exactly that.
- `src/verify/pixel-poll.ts:297`: JSDoc "One round — its tree read and its captures — took this long" restates roundTook's signature.
- `src/verify/pixel-poll.ts:302`: Comment "Nothing to capture: the deadline has passed" restates the body of outOfTime, which checks the deadline.
- `src/verify/pixel-poll.ts:365`: JSDoc on unsettled restates its two branches (moving gives a miss, otherwise silence); the code is the same statement.
- `src/verify/rect-parity.ts:136`: JSDoc "Shared inputs for the per-anchor comparisons" restates the CompareContext interface name.
- `src/verify/rect-parity.ts:147`: JSDoc on Comparison restates its two fields (entries, findings).
- `src/verify/rect-parity.ts:153`: JSDoc "A finding, but only when the delta actually exceeds the tolerance" restates the findingIfOver body.
- `src/verify/rect-parity.ts:532`: JSDoc "One-line verdict — the number the caller quotes" restates the function name rectParityVerdict.
- `src/verify/rect-parity.ts:700`: JSDoc "Expected geometry for a single element — the rect assert spec's payload" restates the RectExpectation interface.
- `src/verify/rect-parity.ts:712`: JSDoc on fromWindowLeft restates its body (returns rects unchanged when left is 0 or undefined, otherwise shifts x).
- `src/verify/shot.ts:20`: Restates the field type: 'A raw capture's PNG, once encoded.'
- `src/verify/shot.ts:22`: Restates the field type: 'A PNG capture's pixels, once decoded — or its decode error.'
- `src/verify/shot.ts:27`: Restates the factory signature: 'A shot of whatever the adapter captured: its raw frame, or a PNG.'
- `src/verify/shot.ts:37`: Restates png()'s return: 'the device's bytes, or the raw capture encoded on the host — once.'
- `src/verify/shot.ts:58`: Restates tryDecode()'s signature and its decode() relation; the code shows both.
- `src/verify/text-hint.ts:68`: Restates flattenTree's body: 'Every node under root, for the unscoped case'.
- `src/verify/text-hint.ts:85`: Restates containsTextHint's filter; the function name and body already say it.
- `src/verify/table.ts:16`: Restates Column.align's default and the code's left/right branch.
- `src/verify/table.ts:24`: Restates headerWithRule: 'The header line and the - rule sized to match it.'
- `src/verify/scale.ts:405`: Restates pngScale's split into derivePngScale plus the note; the code shows it.
- `src/verify/scale.ts:479`: Restates axisDisagreement's return (max of ratios); the code shows it.
- `src/verify/text-parity.ts:877`: Restates textParityVerdict: 'One-line verdict — the number the caller quotes.'
- `src/verify/text-parity.ts:1004-1011`: Field docs on OcrExpectation ('Ink height in % of screen width', 'Relative tolerance…') restate the types and the default constant.
- `src/verify/text-parity.ts:436-441`: History of a removed split (textRecognizer, 2026-10-05); it explains no current constraint and is git history, not a reason the code needs.
- `src/verify/text-parity.ts:530`: Restates contractHasTextAnchors: 'Do the contract's anchors opt into text checks at all?'
- `scripts/differential/golden-spec/judges.ts:184`: `A tap that must not land: not Tapped, and no tap sent.` restates the body of notTapped.
- `scripts/differential/golden-spec/judges.ts:186`: `A plain stop that must reach the target where it is: not an ERROR, and no swipe.` restates reachedWithNoSwipe.
- `scripts/differential/golden-spec/judges.ts:188`: `An assert that must pass.` restates passes.
- `scripts/differential/golden-spec/rows.ts:447`: `Within a pixel/point.` restates the body of withinPixel.
- `scripts/differential/golden-spec/rows.ts:444`: `A side a flush probe names (replies.ts#flushProbedSide).` restates the type alias.
- `scripts/differential/fake-device.ts:189`: `A new call: an empty log, the profile's keyboard again, no paint.` restates resetDevice.
- `scripts/differential/fake-device.ts:161`: `Paint paint.rect of every frame until the next reset (one call).` restates paintFrame.
- `scripts/differential/differential.ts:83`: `Keep every call's result, not only the diffs.` restates the keepAll option name.
- `scripts/differential/golden-diff.ts:65`: `A check's verdict as the report words it.` restates checkVerdictText.
- `scripts/differential/golden-diff.ts:43`: `A run's totals, as golden's report heads them.` restates the Tally interface.
- `scripts/differential/convert.ts:56`: `idb's describe-all element: a type and a frame` restates isIdbElement's body.
- `scripts/differential/corpus.ts:74`: `One tree of the corpus, ready to replay` restates the Recording interface's fields.
- `scripts/differential/checkout.ts:47`: `Why a git command failed: the last lines of its stderr ...` restates gitReason's body.
- `scripts/differential/golden.ts:228`: `A capture's cell: its file name up to the first dot` restates cellOf's one expression.
- `scripts/differential/golden-spec/rows.ts:578-586`: Not a comment defect: deletable instance is the tail of the file. Pick instead the overlapColour doc lines 562-566 only if the sampling rule moves to truth.ts#sampleOf; otherwise keep.
- `scripts/perf/report.ts:9`: /** A length in whole ms. */ restates the signature and the Math.round in fmtMs.
- `scripts/perf/stats.ts:83`: /** The length of the union of the intervals. */ restates busyMs; the name and body say the same.
- `scripts/perf/stats.ts:108`: /** The median and range of the numbers; undefined for none. */ restates spread(); the return type and body show it.
- `scripts/perf/instrument.ts:204`: /** setTimeout with averi's sleeps recorded; every other timer passed through untouched. */ restates recordingSetTimeout's body and the header doc above it.
- `scripts/perf/instrument.ts:83`: /** A sleep begins; the returned function is called when it fires. */ restates Recorder.sleep's signature and body.
- `scripts/perf/baseline.ts:345`: /** The JSON, and the table on stdout: of the runs there are, however the run ended. */ restates report(); the finally block at baseline.ts:319-325 already shows it runs on any end.
- `scripts/perf/baseline.ts:117`: /** What the harness does before a scenario's window: a fresh process on a cell, the app stopped, or nothing. */ restates the Setup type on the next line.
- `scripts/truth/batch/bounded.ts:134`: /** Run a command, bounded. */ restates the type alias Run on the next line.
- `scripts/truth/batch/bounded.ts:180`: /** `<signal> to group <id>: <why>`. */ restates the body of undeliveredText, a one-line template.
- `scripts/truth/batch/bounded.ts:205`: /** A run's calls: each bounded in a group of its own; the probes among them stopped together by `stopAll`. */ restates the header doc of bounded.ts:14-17 and the class's bounded/detached fields.
- `scripts/truth/batch/android-lab.ts:26`: /** The need's name in a batch's `needs`. */ restates `export const ANDROID_NEED = 'android'`.
- `scripts/truth/batch/android-lab.ts:35`: /** A count read or why not, as words. */ restates countText, whose name and body say that.
- `scripts/mutation/mutate.ts:71`: /** One Stryker process: its group and the arguments after `stryker run`. */ restates the GroupRun interface directly below it.
- `scripts/mutation/mutate.ts:210`: /** What main does outside itself; paths are relative to the checkout. */ restates MutateDeps, whose members are the answer.
- `scripts/release/pack-files.ts:9`: /** What of package.json the file check reads. */ restates PackageShape, a two-field interface.
- `scripts/truth/batch/io.ts:47`: `/** The real filesystem. */` restates the nodeFs object it sits on.
- `scripts/truth/batch/lab-run.ts:55`: `/** The live groups the batch runs, in its order. */` restates LAB_RUN_GROUPS, whose name and value say the same.
- `scripts/truth/batch/lab-run.ts:58`: `/** The batch's blocks, in its order. */` restates BLOCK_IDS.
- `scripts/truth/batch/lab-run.ts:123`: `/** A live block's id, label and judge, from its group alone. */` restates liveBlock's signature and body.
- `scripts/truth/batch/ios-lab.ts:45`: `/** pkill's, lsof's and kill's bound: host calls, each quick (d43-gate.ts's 10 s). */` restates the HOST_SECS value, and its provenance points to a deleted file.
- `scripts/truth/batch/ios-lab.ts:47`: `/** The need's name in a batch's `needs`. */` restates IOS_NEED.
- `scripts/truth/batch/ios-lab.ts:374`: `/** The WDA window's dirty window's name. */` restates WDA_WINDOW.
- `scripts/truth/batch/lab-build.ts:26`: `/** catalog.ts --check's bound, and xcodegen's. */` restates CATALOG_SECS.
- `scripts/truth/batch/lab-build.ts:28`: `/** `java_home -v 17`'s bound. */` restates JAVA_HOME_SECS.
- `scripts/truth/batch/lab-emu.ts:70`: `/** `unzip -p`'s bound (a host read of the pulled APK, no device call). */` restates UNZIP_SECS.
- `scripts/truth/batch/lab-emu.ts:118`: `/** `adb shell <argv>`, each word quoted for the device's sh (adb-shell.ts#adbShellArgv). */` restates the body of shell().
- `scripts/truth/batch/lab-lines.ts:69`: `/** lsof's argv for the lab port's listeners (d43-gate.ts's listeners): ... */` restates LSOF_ARGV and cites a deleted file for its listeners.
- `scripts/truth/batch/cases.ts:41`: `/** A run's four files, by its name: ... */` restates the four fields of runFiles's return value.
- `scripts/truth/batch/cases.ts:109`: `/** A run: complete, with what it was asked; or why not, every gap at once. */` restates the Completeness type it sits on.
- `scripts/truth/batch/ios-defaults.ts:98`: `/** `<key> <kind>` each, as the lines name them. */` restates differText's one-line body.
- `scripts/truth/batch/steps.ts:161`: Restates step()'s body (a timed note with the word padded); the example adds nothing a reader cannot see.
- `scripts/truth/batch/steps.ts:148`: Restates print(): it appends one line to the .out, which the body shows.
- `scripts/truth/batch/words.ts:58`: Restates twoDigits(): pads a number to two digits; the name and body say it.
- `scripts/truth/batch/words.ts:61`: Restates timeOf()'s output format, which the body shows.
- `scripts/truth/batch/runner.ts:411`: Restates lastSteps(): each step in order, with a try/catch that logs an ERROR and continues. The loop shows all of it.
- `scripts/truth/batch/runner.ts:618`: Restates needCtx(): the body builds a bounded call that records each call with its phase.
- `scripts/truth/batch/records.ts:27`: Restates recordFiles(): it returns the asked and done paths, which the return object shows.
- `scripts/truth/calibrate.ts:348`: Restates regressedElsewhere(): the filter condition is the comment. The reason the check exists is not given.
- `scripts/truth/calibrate.ts:355`: Restates unrecorded(): it filters rows by the regressions recorded at the after commit. The filter line says the same.
- `scripts/truth/calibrate.ts:420`: Restates notesOf(): it filters the table by name and throws on an unknown name, which the code shows.
- `scripts/truth/calibrate-run.ts:112`: Restates sideLine(): the template literal below it is its own description.
- `scripts/truth/calibrate-run.ts:123`: Restates pool(): the body is a worker loop, which the comment paraphrases.
- `scripts/truth/capture-run.ts:362`: Restates probe(): relaunch, run first, tap, wait one second, read the events. The body does these in that order.
- `scripts/truth/capture-android.ts:3`: A pointer to the other two files. It says nothing about why this file exists.
- `scripts/truth/batch/runner-lines.ts:98`: Restates the NeedResult type: met with how, or not met with why. The type says the same.
- `scripts/truth/lab-device.ts:76`: Restates the LabDevice.launch signature; the body and the 10 s wait are visible in code.
- `scripts/truth/lab-device.ts:78`: Restates the return type of state(): undefined is already in the signature.
- `scripts/truth/lab-device.ts:504`: Restates the mode mapping that the return expression at :508 spells out.
- `scripts/truth/chooser-readers.ts:117`: Restates ENTRY_CHARS and entryText's truncation, both in the next lines.
- `scripts/truth/chooser-readers.ts:123`: Restates leaksOf's filter (`always === true`), which the name and body already give.
- `scripts/truth/live-known.ts:264`: Restates knownEntry's one-line lookup.
- `scripts/truth/live-forms.ts:204`: Restates underBar's body: the overlap of field and bar in px.
- `scripts/truth/live-forms.ts:407`: Restates the Measured interface fields (panel, strip), which are typed.
- `scripts/truth/live-carousel.ts:99`: Restates Swiper.swipe's signature and that it is the adapter's swipe.
- `scripts/truth/live-carousel.ts:147`: Restates PreDragLab's two members, which are typed.
- `scripts/truth/live-cases.ts:674`: Restates the run order that the array literal at :682-687 already gives.
- `scripts/truth/live-cases.ts:735`: Restates the CaseEvidence type alias, which is typed.
- `scripts/truth/live-chooser.ts:151`: Restates the choosers() helper's one-line body.
- `scripts/truth/live-chooser.ts:153`: Restates the labRecords() helper's one-line body.
- `scripts/truth/device-state.ts:85`: Restates the Side type alias, which is typed.
- `scripts/truth/truth.ts:39-40`: Restates nearPoint's body (within TOUCH_SLACK on each axis). The name and the code already say it.
- `scripts/truth/truth.ts:84`: Restates decodeXml (decode XML references and five entities). The function name and body say this.
- `scripts/truth/truth.ts:233-234`: Describes probeEvents' slice and map. No reason is given; the code is short enough to read directly.
- `scripts/truth/truth.ts:297`: Restates pointText's output format ("(x,y)"). The template literal shows it.
- `scripts/truth/schema.ts:22`: Restates the Declared type's purpose. The union literal already lists the kinds.
- `scripts/truth/schema.ts:114`: Restates labSelector's output (id:"lab.<cell>.<tag>"). The template literal shows it.
- `scripts/truth/schema.ts:426`: Restates TargetTruth.probe's contents. The type and its neighbours say the same.
- `scripts/truth/schema.ts:659`: Restates FieldTruth's purpose (the field as the model held it). The interface shows it.
- `scripts/truth/schema.ts:682`: Restates FormTruth.screenError's type (message plus frame). The type already says it.
- `scripts/truth/schema.ts:685`: Restates FormTruth.sheet (the picker sheet's frame when presented). The optional field shows it.
- `scripts/truth/live-visibility.ts:150`: Restates strokesSince (the strokes since launch). The function body shows it; no reason is given.
- `scripts/truth/live-visibility.ts:155`: Restates touchesSince (the touch tags since launch). The filter and map show it.
- `scripts/truth/replies.ts:44`: Restates claimsTap (reply starts with 'Tapped'). The predicate is the same one-line check.
- `scripts/truth/replies.ts:137`: Restates claimsVisible (VISIBLE_STOP test). The predicate says it.
- `scripts/truth/run-case.ts:60`: Restates WRITE_SETTLE_MS (how long the app is given to write). The constant name and the pause call say it; the 800 ms value is not explained.
- `tests/differential/golden/presented.known.ts:9-10`: Status log of a fixed lab finding ("were this KNOWN's until round 6's fix (d43df5d ...) struck them off"). It says nothing about why the rows exist and goes stale with each round.
- `tests/differential/golden/presented.known.ts:3-7`: Header listing which cell families sit in which phase or round. It restates the file's contents and the round history.
- `tests/differential/golden/presented.known.ts:37-40`: Status narration of fixed rows: 'green since', 'struck off here', 'calibrated in'. The reason the rows exist is in the lines above; the verdict belongs in the commit history, not the file.
- `tests/differential/golden/edges.known.ts:3-14`: Family header that lists the cells by round and records which calibration.json link is 'calibrated since round N'. This is status narration and goes stale as the calibration changes.
- `tests/differential/golden/forms.known.ts:5-12`: Narrates the history of a lab note's fix (d43df5d, round 6, accepted 2026-10-18). The reason a residual exists is worth keeping in one line; the chronology is not.
- `tests/flow/engine.test.ts:1351-1353`: History of a module global that no longer exists ('The count used to be a module global the engine tests zeroed by hand (2026-10-07)'). Describes a removed design, so a reader cannot act on it.
- `tests/flow/engine.test.ts:2896-2900`: Doc block that restates what the run() entry does and attributes it to a dated review candidate. Only the first clause carries a reason; the rest restates the code.
- `tests/flow/tool-config.test.ts:21-26`: Move history: which describe block the rows moved from and where the remaining halves now live. Git history records moves; the file does not need it.
- `tests/flow/load.test.ts:14-21`: Move history ('moved here verbatim from tests/flow/config.test.ts on 2026-10-04 (C6)'). Records a past refactor, not a property of the code under test.
- `tests/flow/load.test.ts:91-93,107-108`: 'Until 2026-10-04 the file was written into process.env ...' describes a bug that the current test already prevents. The test name carries the claim; the dated history is removable.
- `tests/flow/credentials.test.ts:8-9`: '(2026-10-04, C2; the tests these replace lived in config.test.ts and set process.env.AVERI_ENV)'. Move history about deleted tests; keep only the sentence that the module reads no process.env.
- `tests/flow/bare-tree-ladder.test.ts:270-271`: 'The round-3 device check (2026-10-08) saw two identical ⚠ detect ... bare lines'. The test asserts the lines differ or are not duplicated; the device-check history is removable.
- `tests/flow/condition.test.ts:80`: '// On ONE bare tree, three leaves with each answer.' restates the table directly below it. The test body already says this.
- `tests/helpers/android-dumps.ts:37,46,54,62`: Per-fixture doc comments that describe what the dump contains ('Floating, IBAN field focused, the panel drawn at about x 359–1040 ...'). They restate the data in the fixture itself; keep only the provenance (device and date) once per group.
- `tests/differential/golden/react-native.known.ts:19-20`: '(backlog D77, sub-case b; captured 2026-11-11)' is a backlog reference and a capture date. The fixture's contents and the residual reason are what matter; the backlog tag and date are removable.
- `tests/helpers/lazy-list.ts:47`: 'How far each stroke moved the content, in order.' restates the field's type and name (moves: number[]).
- `tests/helpers/lazy-list.ts:52`: 'The furthest the content scrolls.' restates the maxOffset getter, whose body is one line.
- `tests/helpers/lazy-list.ts:57`: 'Row label's whole (uncut) rect at the current offset.' restates rowRect's body.
- `tests/helpers/fake.ts:228`: 'Every key pressed, in order.' restates the keys: Key[] field.
- `tests/helpers/fake.ts:144`: Restates droppedTails: number[] and its push in noteDroppedTail.
- `tests/helpers/fake.ts:151`: 'Every swipe drawn, with the duration when the caller passed one' restates the swipes field type; the 'absent otherwise' remark is the only why.
- `tests/helpers/fake.ts:254`: 'The live screen object, for a test's onKey/onTap to mutate' restates live()'s body.
- `tests/helpers/rounds.ts:226-227`: 'The stop's result, rendered as the driver returns it; throws unless the scroll stopped visible' restates resultOf's body.
- `tests/helpers/rounds.ts:240`: 'The direction each stroke was drawn toward' restates strokesToward's one-line body.
- `tests/helpers/rounds.ts:243`: 'Each stroke's cover cut (coverTop), undefined for a whole-screen stroke' restates strokeCovers' body.
- `tests/helpers/rounds.ts:250`: 'A shown keyboard covering band alone, as the reading's cover() gives it' restates coverOver's signature.
- `tests/helpers/rounds.ts:253`: 'A match: identifier id, at rect.' restates match()'s signature.
- `tests/helpers/pixels.ts:5`: 'An opaque colour, 0-255 a channel.' restates the Rgb type.
- `tests/helpers/live-records.ts:26`: 'A record of docs/truth/live-records by its file name.' restates readLiveRecord's signature and body.
- `tests/helpers/live-records.ts:30`: 'A recorded case by its source and id.' restates recordedCase's body.
- `tests/interact/keyboard-dismissal.test.ts:192`: Restates fixture arithmetic ('centre 621 asks a lift of 621 − 190 + 16 = 447 pt'); the test's expect already pins the number.
- `tests/interact/flush-check.test.ts:151`: Describes the fixture state ('the list grows 40 px ... nothing scrolled'), not why the case exists.
- `tests/interact/flush-check.test.ts:164`: Restates the test title's scenario ('a read with no stop, then the row flush there again ... a reveal at once').
- `tests/interact/scroll-end-turn.test.ts:92`: 'Planned, not sent: no stroke went over anything yet.' describes the assertion's state only.
- `tests/interact/scroll-end-turn.test.ts:48`: 'No scroll view of that rect in the tree: nothing to say.' restates the fixture's shape.
- `tests/interact/scroll-carousel-android.test.ts:498`: 'No probe was sent on either course: the flush check had no cut to prove' restates what the assertion shows.
- `tests/interact/resolve.test.ts:553`: 'The on-screen field beside them taps as before.' restates the expectation.
- `tests/interact/resolve.test.ts:726`: Describes what the fake does for a key tap; the code of the fake and the assertion already show it.
- `tests/interact/resolve.test.ts:1548`: 'Exactly one device read, and the tree returned is the fresh one.' restates the following expect.
- `tests/interact/keyboard-in-tree.test.ts:275`: '…and alone it is as good as absent.' is a restatement of the fixture's effect.
- `tests/interact/scroll-screen-change.test.ts:153`: 'NI1.' is a bare review tag with no explanation; the test name carries the meaning.
- `tests/interact/motion-region.test.ts:165`: 'fully: true asks all of it: R at 380 has its top 11 pt short of the line, its centre past it.' restates the arithmetic in the assertion.
- `tests/interact/parked-cell-content.test.ts:25`: 'The look of the tree on an adapter with no oracle: the in-tree reading, no dismissal.' restates the call's arguments.
- `tests/interact/scroll-rounds.test.ts:96`: 'scrollingFake(2580): 600 a stroke; 1980–2020 is clipped at the bottom' restates the fixture parameters the call passes.
- `tests/interact/scroll-carousel.test.ts:55`: 'C's centre is inside the carousel (x ≥ 24) down to x −153; the fling slows through …' restates the offsets the test feeds in.
- `tests/truth/truth.test.ts:103`: Restates the assertion directly below it (one pixel off is the same scroller, two are not). The expect lines already show it.
- `tests/truth/truth.test.ts:562`: Describes the fixture's scenario state (bad's probe tap dies, its trees and screenshot read already). It does not say why the scenario matters.
- `tests/truth/truth.test.ts:657`: 'Failed again: listed once, with the new reason.' restates the assertion that follows.
- `tests/truth/truth.test.ts:672`: 'Captured again: its failure is gone' restates the expect that follows.
- `tests/truth/run-case.test.ts:456`: 'Dropped: nothing said.' restates the expectation and adds no reason.
- `tests/truth/replies.test.ts:187`: 'The eyes could not tell ...: still the claim.' restates the assertion; the reason lives in the src wording it quotes.
- `tests/truth/t11-records.test.ts:158`: Hard-codes a run count ('33') and a case-state description. It is state that goes stale and the expect shows the same thing.
- `tests/truth/target-contract.test.ts:107`: Describes which fixture cell's node is listed where. The fixture name and the expect already carry this.
- `tests/ui-tree/standing.test.ts:704`: 'Nothing to judge: no exposure asked, so no minimum piece.' restates the test's input; the expect shows it.
- `tests/ui-tree/standing.test.ts:1571`: 'What the rule leaves alone, on the same trees.' is a section label that restates the next assertions.
- `tests/ui-tree/draw-order.test.ts:1123`: 'Its top AT the target's is no break.' restates the expectation that follows it.
- `tests/ui-tree/draw-order.test.ts:1094`: '...and the screenshot sees row_0 under the chooser's row: nothing covers it, tapped at its centre as before.' restates the expected verdict. The reason for the break exception is in the comment above it, which should stay.
- `tests/ui-tree/draw-order.test.ts:2067`: 'The box ends at 740, above the centre: ... but no tap lands at the centre.' restates the input geometry and the expected result.
- `tests/ui-tree/draw-order.test.ts:2018`: 'Nor an icon's padded control: no node lies inside the 0x0 root (both below the top bar's band, so content).' describes the fixture shape and restates the assertion.
- `tests/verify/eyes-order.test.ts:426`: Narrates the test body ('the plain stop asks the question; the tap moves clear ...'); the assertion below already states it.
- `tests/verify/assert.test.ts:1113`: 'movingA, movingB, settled, settled — the capture that confirmed stability is the one stored': describes the capture sequence the test sets up.
- `tests/verify/assert.test.ts:1122`: 'The same still screen on a rerun is a 0% diff ... two identical captures': restates the expect() below it.
- `tests/verify/capture.test.ts:72`: 'a, b, b — the capture that confirmed stability is the one returned': restates the frame array in the test.
- `tests/verify/table.test.ts:42`: 'The right-aligned columns must end where their titles end': restates the indexOf assertion on the next line.
- `tests/verify/eyes.test.ts:150`: 'The right strip (x 90–100) on the neighbour's rows another grey': describes a fixture painting step that the code already shows.
- `tests/verify/eyes-order.test.ts:366`: 'From the third capture on, C's blurred green fills the overlap': narrates the fixture's frame sequence.
- `tests/verify/assert.test.ts:2141`: 'Reads at 0, 300, 600, 900 ms are asked; the read at 1200 ms is past the deadline': a timeline restating the expect() beneath it.
- `tests/verify/assert.test.ts:1630`: 'Round 1: found, silent. Round 2: not found, no capture ...': round-by-round narration of the test's own sequence.
- `tests/verify/assert.test.ts:1804-1812`: Row labels ('element exists: never found', 'text content: never found', 'rect: never found', 'absent: present the whole time'): restate the table values.
- `tests/verify/scale.test.ts:72`: 'scaleX is 3 (1206/402), so a png this tall makes scaleY exactly 3 x the limit': arithmetic of the fixture, visible from the numbers.
- `tests/verify/scale.test.ts:121`: '…and with the device screen it is simply right.': restates the expect() on the following line.
- `tests/verify/eyes-clip-line.test.ts:69-70`: '100x200 white; the target 10,60 80x70, blue on its rows 60–110 ...': describes the fixture geometry that the code literally builds.
- `tests/verify/pixel-chrome.test.ts:57`: 'The round's look and the screen it is judged on: the usable screen on the device, else the tree's own': describes the two lines of code below it.
- `tests/verify/eyes-views-drawn-over.test.ts:124-125`: 'Synthetic frames at the cell's geometry (1080x2220, scale 1): the screen white, A blue, B red': fixture description that the frame builder already shows.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Edges.kt:94`: Pure pointer '/** Edges.swift#EdgeLayout.sticky. */' above four constants, restating only where they come from.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Edges.kt:214`: '// Laid out down a column (not offset): each container's clip is where the layout puts it.' describes the else-branch's layout, which the code shows directly.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Edges.kt:264`: '// The list's offset in pixels down its content: the header item (index 0) then rows of ROW_HEIGHT.' restates the arithmetic on the next lines.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Lab.kt:131`: '/** The empty state of the catalog list (no cell asked for). */' restates the none() body and its call site.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Lab.kt:147`: '/** A scroll container's clip on the screen, by the id the catalog's targets name (`scrollView`). */' restates scrollView(id, r).
- `fixtures/apps/android/src/main/java/dev/averi/lab/Lab.kt:154`: '/** App UI drawn over content (a sticky header, a bar), by name, its frame on the screen. */' restates chrome(name, r).
- `fixtures/apps/android/src/main/java/dev/averi/lab/Lab.kt:194`: '/** One field as the model holds it: its value, whether it has the focus, the error it shows (text and id) or none. */' restates the field() signature.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Forms.kt:225`: '/** Reports a layout's unclipped frame on the screen, in pixels (Lab.kt#screenFrame). */' restates the reporting() body.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Forms.kt:277`: '// The oracle: every field as the model holds it, after each change.' restates the forEach LaunchedEffect below it.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Forms.kt:302`: '// The top bar: the title, centred; a principal title with an identifier ends the editing when tapped.' narrates the Box below it.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Bars.kt:103`: '/** Ready once the insets have been dispatched and the first layouts reported. */' restates Settle's delay(800) plus lab.settled().
- `fixtures/apps/android/src/main/java/dev/averi/lab/FalseCovers.kt:72`: '/** The node's frame in SCREEN pixels, reported as `tag` (as TargetBox reports its own). */' restates reportFrame's body.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Views.kt:28`: '/** The views family's layout, in dp, beside Base.kt's slot (SLOT_WIDTH, SLOT_HEIGHT, slotTop). */' restates the object's use of those constants.
- `docs/truth/live-records/t11-carousel-visible/final-ab/settings-network.mts:41`: '// The oracle: what the screen shows after both.' labels the screencap line, which the next line's filename already states.
- `fixtures/apps/android/src/main/java/dev/averi/lab/Presented.kt:107-109`: '// Partially expanded (the medium detent): content taller than half the screen, ...' describes the ModalBottomSheet arguments directly beneath it.
