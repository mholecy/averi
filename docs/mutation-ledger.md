# Mutation ledger

The earlier baselines of the modules `scripts/mutation/scope.json` scores, newest first under each module.
What goes here, and when, is ADR 0038's rule (docs/adr/0038-a-mutation-run-guards-the-pure-leaves-tests.md, the A32
amendment).

Moved here from scope.json by backlog A32 (2026-11-11), entry by entry and unedited.

## src/flow/wipes-ahead.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/interact/fill-reformat.ts

- 94.80 % on 2026-11-03 (T4's cold run, its tests unchanged since D60: the move is D60's, not recorded then): 346 mutants, 18 survived, 1 timeout (counted killed) — the 18th is D60's new line 218, prefixOf's `walked.tokens.at(-1) === -1` emptied to true, equivalent: a last token that is no added mark is a character the typing holds (holdsMark, all spaces one kind), so `next` stays '' and the judgment is the pre-D60 one
- 94.69 % on 2026-11-02 (D53, separatedOf; the same after review round 1's walkWhole): 320 mutants, 17 survived, 1 timeout (counted killed) — none of them in separatedOf
- 94.35 % on 2026-11-02 (D51, markKind, digitGrouping and maskTemplate): 301 mutants, 17 survived, 1 timeout — the two survivors D51 added equivalent (markKind's `'none'` and `'grouping'` emptied: reformatOf tells only `'thousands'` and undefined apart)

## src/interact/fill-verdict.ts

- 99.35 % on 2026-11-06 (D64b-3, the focus-unread caveat; cold): 155 mutants, 1 survived
- 99.33 % on 2026-11-01 (D36): 150 mutants, 1 survived

## src/interact/fill-landing.ts

- 97.04 % on 2026-11-10 (D79 after the code review: the three optionals one `equal: EqualCount`, the equal-count condition computed once, `equalCountOf`; `npm run mutate -- --group core --force --mutate src/interact/fill-landing.ts`, cold): 371 mutants, 11 survived, 1 timeout — D71's 10 and one new, equivalent: `equalCountOf`'s `held === e.value` emptied to true under `wholeToo` — a whole landing too holds the value (`wholeLandingToo`), and a held reading of the typed count that holds it is it; the floor stays
- 97.26 % on 2026-11-10 (D79 after review round 1, differenceOf's `length` of the typed count carries `appended` (the value itself: the count an append would show), `past` (the typing's part past the earlier text) or `partlyMasked`; `npm run mutate -- --group core --force --mutate src/interact/fill-landing.ts`, cold): 365 mutants, 10 survived, 1 timeout — the same survivors as D71's run, none in the new code; the floor stays
- 97.10 % on 2026-11-09 (D71, showsExactly's value-itself disjunct narrowed, notLandedOf's wholeToo widened and gated on tookText; `npm run mutate -- --group core --force` at 444c8210, cold): 345 mutants, 10 survived, 1 timeout; the floor rises 94 → 95 (two points under the score's whole number)
- 96.98 % on 2026-11-06 (D64b-3, landingOf carries focusUnread, textAroundUnread; cold): 331 mutants, 10 survived, 1 timeout — none of them in the new code; the floor stays: a floor sits two points under the score's whole number
- 96.53 % on 2026-11-05 (A9, readingOf one answer about a reading, tookText, tailOf and differenceOf private, droppedTail folded into notLandedOf, withoutWholeToo; cold, compared with a cold run of the base): 317 mutants, 11 survived, 1 timeout — of the base's 12 survivors 2 are now killed (two mutants of the case loop's condition), the others the same; the 1 new one is withoutWholeToo's guard emptied to false, equivalent: another kind holds no wholeToo, and its copy is equal
- 95.83 % on 2026-11-03 (D64, showsExactly without clear looks for the value in typedPartOf past each of priorsOf's earlier texts, D63's unchangedSinceTyping folded into it; droppedTail's wholeLandingToo, differenceOf's wholeToo on a dropped-tail and a length; cold, after the code review): 288 mutants, 12 survived, 4 timeouts — none of them in the new code, the same survivors as D63's run
- 95.73 % on 2026-11-03 (D63, landingOf's unmoved guard: without clear, a reading equal to before has not landed unless it is the value; the same after the code review's unchangedSinceTyping rename and main's D55 merge, cold): 281 mutants, 12 survived, 4 timeouts — none of them in the new guard
- 95.52 % on 2026-11-03 (D61, priorsOf's value-alone fallback when the reading's letters and digits are exactly the value's): 268 mutants, 12 survived, 4 timeouts — none of them in the new condition
- 95.33 % on 2026-11-02 (D53, differenceOf's separated rule; the same after review round 1's overPriors): 257 mutants, 12 survived, 4 timeouts — none of them in the new rule
- 95.20 % on 2026-11-02 (D51, priorsOf asks maskTemplate): 250 mutants, 12 survived, 4 timeouts

## src/interact/fill-type.ts

- 93.16 % on 2026-11-11 (T9, joined; `npm run mutate -- --group core --force --mutate src/interact/fill-type.ts`, cold, 15 s): 234 mutants, 213 killed, 5 timeouts (counted killed), 11 survived, 5 without coverage; 86.32 % before T9's tests (234 mutants, 20 survived, 12 without coverage: the unread arm, pollValue's no-field stop, the wipe of nothing, the read-back without a tree, a non-input and an input over the field's rect in whereTyped, `missing !== undefined` beside a gain). Its tests mock src/util/sleep.ts (vi.mock), so the poll's sleeps cost the run nothing (the file's tests 10 ms; 443 ms with the real sleep at pollMs 1). The 16 not killed: untested by design (2) — the landed arm's `answer.reformatted !== undefined` and `answer.focusUnread !== undefined` emptied to true, which add the key as undefined: the tests pin behaviour, not object shape (this ADR's Consequences), and fill.ts, the one caller, copies both values and tests them only with `!== undefined` (fill.ts:422-423, 451-452), so an undefined key reads as an absent one; equivalent (12) — whereTyped's `unproven` emptied to `{}` or kind '' at its before/now guard and at its last return (4: a Whereabouts is read only as `field` or `elsewhere`, so any other kind is unproven); pollValue's `steady: true` beside a landing (steady is read only when the poll did not land); pollValue's no-field return emptied to `{}` or said steady, and its last return's `observed !== undefined` emptied to true (3: an undefined reading returns unread before steady is read); the sentinel strings — inputKey's `identifier ?? ''` (no coverage: keys are compared only with each other, so any constant keys a missing identifier alike, unless an identifier is literally '' or that constant), whereTyped's `is.value ?? ''` twice (no coverage: a sibling emptied to null gains nothing, or only the sentinel, which is no part of the missing text) and its `: ''` for a value not appended (a sentinel gained is no part of the missing text: unproven as before); unreachable (2) — the switch's `default` arm and its block, the `never` check: readingOf and landingOf answer only the four kinds handled.

## src/interact/fill-refetch.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/interact/unfit-axis.ts

- 98.51 % on 2026-11-05 (D59, inferredAlong and cardMoved; cold, after condition 3 dropped its axisOfEdge test, an equivalent survivor of the first cold run at 97.22 %): 67 mutants, 1 survived, 0 timeouts — sideShift's 'vertical' emptied, equivalent (gone with sideShift)

## src/interact/aim-floor.ts

- 96.77 % on 2026-11-05 (D68 review round 1, the module's header worded as a likelihood, flush-check.ts's keyboard-aware plan beside it; cold): 31 mutants, the same 1 equivalent survivor
- 96.77 % on 2026-11-05 (D68, aimFloor; cold, after a test killed the first run's non-equivalent survivor at 93.55 %, the tie's `b.moved === a.moved` made true): 31 mutants, 1 survived, 0 timeouts — the tie-break's `b.drawn < a.drawn` as `<=`, equivalent: on equal drawn and equal moved, either stroke gives the same AimFloor

## src/interact/flush-check.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/interact/within.ts

- 100 % on 2026-11-11 (D80 review round 1, `noRoom` carrying `keyboard: KeyboardUp`, a type and comments only; same command, cold): 106 mutants, 0 survived
- 100 % on 2026-11-11 (D80, `WithinRefusal` `noRoom` (a type, the stroke plan's facts) and comments only; `npm run mutate -- --group core --force --mutate src/interact/within.ts --tempDirName reports/mutation/stryker-tmp-d80`, cold): 106 mutants, 0 survived
- 100 % on 2026-11-11 (D81 code review: `WithinRefusedError` moved here, named; `npm run mutate -- --group core --force --tempDirName reports/mutation/stryker-tmp-d81 --mutate src/interact/within.ts`, cold): 106 mutants, 0 survived
- 100 % on 2026-11-11 (D81, `Within` a selector string, an element spec or a rect — a flow's `within` a spec, found by `findTarget`; `isRect` a rect's `x`; `npm run mutate -- --group core --force --mutate src/interact/within.ts`, cold): 105 mutants, 0 survived; 100 % in the cold full core group run on 2026-11-10 (D78 code review: `Within` a selector or a rect, the stale refusal offering every scroll view of the stroke's or an untold axis through Clips.scrollViewsOn; `npm run mutate -- --group core --force`, 308 s; every core module at or above its floor, geometry.ts 95.34 % with scrollViewsOn): 102 mutants, 0 survived
- 100 % on 2026-11-10 (D78 review round 1: checkWithin, a string `within` parsed up front; one rule for a match, the scroll view of its very rect else its nearest; `npm run mutate -- --group core --force --mutate src/interact/within.ts`, cold): 86 mutants, 0 survived — checkWithin's `e instanceof Error ? … : String(e)` cut to `(e as Error).message` (both throwers throw Errors: no equivalent survivor)
- 100 % on 2026-11-10 (D78, resolveWithin; `npm run mutate -- --group core --force`, cold, 307 s): 70 mutants, 0 survived, 0 timeouts — before it the across check read `axes?.axis` and `axes?.nested ?? []` (axes always found there: 2 equivalent survivors and 1 no-coverage); folded into the unscrolled refusal (a selector's scroll view found by `Clips.axesOf` like a rect's), they are gone

## src/ui-tree/draw-order.ts

- 86.60 % on 2026-11-09 (D75, comments only; `npm run mutate -- --group core --force` at 0a52f450, cold): 821 mutants, 124 survived, 3 without coverage
- 86.60 % on 2026-11-02 (D45, direct tests of paintsOver, drawnOverAt, drawnOverStrip, ofKeyboardBand): 948 mutants, 124 survived, 3 without coverage
- 77.22 % on 2026-11-01 (D36)

## src/ui-tree/geometry.ts

- 95.30 % on 2026-11-03 (D55c review round 1, rectCentre moved to adapters/types.ts and re-exported here; cold): 1170 mutants, 55 survived, 0 without coverage — the same survivors, the 6 fewer mutants rectCentre's, now outside the mutated file
- 95.32 % on 2026-11-03 (D59b review round 2, toldOn meets the usable screen and leaves out the keyboard's own; cold): 1175 mutants, 55 survived, 0 without coverage — the same survivors, none in toldOn
- 95.29 % on 2026-11-03 (D59b review round 1, Clips.toldOn and INPUT_ROLE; cold): 1168 mutants, 55 survived, 0 without coverage — the same survivors, none in toldOn
- 95.25 % on 2026-11-03 (D59b, axesOf's nested leaves out text inputs, its test in geometry-clips; cold): 1157 mutants, 55 survived, 0 without coverage — the same survivors, none in the new clause
- 95.23 % on 2026-11-02 (D47, walkExtent tie under a root of no area; the root-area checks share one hasArea): 1152 mutants, 55 survived, 0 without coverage
- 95.10 % on 2026-11-02 (D45): 1143 mutants, 56 survived, 0 without coverage; 49.52 % from tests/ui-tree/geometry.test.ts alone before D45. draw-order*.test.ts, in the same run, reach it too

## src/ui-tree/standing.ts

- 95.26 % on 2026-11-11 (A26, its clauses moved to ui-tree/remedy-text.ts, `bothPinned` carrying `under`, `noScrollStanding`; `npm run mutate -- --group scene --force`, cold, 151 s): 1119 mutants, 47 survived, 6 without coverage — the A25 run's set less the two `layer?.label` that moved, no new one (`noScrollStanding`'s kind test killed by remedy-agreement.test.ts)
- 96.23 % on 2026-11-11 (A25, joined; `npm run mutate -- --group scene --force --mutate src/ui-tree/standing.ts`, cold): 1220 mutants, 40 survived, 6 without coverage — ADR 0038's A25 amendment lists them

## src/ui-tree/reading-order.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/ui-tree/later-edges.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/ui-tree/remedy-text.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/interact/touch-remedy.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/adapters/failure-text.ts

- 99.00 % on 2026-11-11 (D74 + A17, IDB_TYPING, ADB_TYPING, withoutTypedText and the argparse branch deleted, shownCommand and shownArgs added; `npm run mutate -- --group core --force`, cold, 350 s, on 9f8bd349): 200 mutants, 198 killed, 2 survived, 0 timeouts, 0 without coverage — the equivalent survivor below, and shownCommand's default `typed = []` filled with a string, equivalent: `typed.includes(at)` holds no index either way; floor 97 kept (99 − 2); a first cold run the same day read 98.51 % with shownArgs' own default never reached (no coverage), and that default went: every caller passes its indexes; checked after the code review narrowed to the module (`--mutate src/adapters/failure-text.ts`, 19 s, on a81f0dbe): 98.99 %, 200 mutants, 197 killed, the same 2 survived, 1 runtime error — a StringLiteral mutant emptying a piece of WORD_START's String.raw, which makes the RegExp built from it invalid when the module loads, so no test runs and Stryker leaves it out of the score (the cold group run counted the same mutant killed)
- 99.54 % on 2026-11-06 (D70 verification, a word starting scheme: is a URL word, scrub before the bound, the bound in code points; cold): 218 mutants, 1 survived, 0 timeouts — the same equivalent survivor as below
- 99.53 % on 2026-11-06 (D70 code review, URL words, `=` and file://, a prefixed header, the bounded exception; cold): 211 mutants, 1 survived, 0 timeouts — the same equivalent survivor as below
- 99.44 % on 2026-11-06 (D70 review round 2, argparse at exit 2 to stderr's end, lastResortText, the colon rule; cold): 180 mutants, 1 survived, 0 timeouts — the survivor is exceptionUnder's `why === undefined` emptied to false, equivalent: /^\s/ on undefined reads "undefined", no match, so the exception stands alike; 100 % on the same day (D70 review round 1; cold): 153 mutants

## src/util/regex.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/adapters/ios-link-failure.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/adapters/ios-liveness.ts

- 100 % on 2026-11-02 (D33 after review, pgrepReason and the case-free UDID added): 70 mutants, 0 survived, 0 without coverage — after a test killed the first run's one survivor (the ExecError check) and covered one string

## src/adapters/ios-data-container.ts

- 90.00 % on 2026-11-12 (A44 review round 1, the first cold core run with isAppDataContainer; `npm run mutate -- --group core --force`, 402 s): 20 mutants, 2 survived, both equivalent — the dot-segment check's `^` and `$` alternatives emptied: a dot segment at either end is refused by the container pattern's own anchors; the alternatives were dropped, not kept equivalent
- 100 % on 2026-11-12 (A44, `force` removed from rm; `npm run mutate -- --force --mutate src/adapters/ios-data-container.ts --tempDirName reports/mutation/stryker-tmp-a44`, cold, alone, 24 s): 10 mutants, 0 survived
- 90.91 % on 2026-11-12 (A44, new; `npm run mutate -- --group core --force`, 397 s): 11 mutants, 1 survived, equivalent — rm's `force: true` made false (each entry was just listed); review round 1 put `force` back and killed it with an entry that vanishes between the listing and its removal

## src/adapters/android-accessibility-order.ts

No earlier baseline: the latest, in scope.json, is its first.

## src/adapters/android-chooser.ts

- 100 % on 2026-11-11 (A27 review round 2, moved to the `android` group with the window manager module it reads; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27c`, cold, the group 34 s at load 10–20 (a lab run elsewhere)): 109 mutants, 0 survived
- 100 % on 2026-11-11 (A27, the focus read moved to android-wm.ts as defaultDisplayFocus, chooserInFocus keeping the judgement; `npm run mutate -- --group core --force --mutate src/adapters/android-chooser.ts,… --tempDirName reports/mutation/stryker-tmp-a27`, cold): 109 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-06 (D73, monkeyChooserRefusal gone, chooserAlsoInFront kept; `npm run mutate -- --force` at 8f9286d6, cold): 143 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-06 (A10, the chooser's words moved to interact/app-holder-text.ts, monkey's refusal kept with REFUSAL_ADVICE; cold): 152 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-03 (D55c review round 1, the cold run: adviceEnd shared, sheetAdvice's enables clause, launchChooserNote takes the LinkChooser, rectCentre and labelOf moved to types.ts): 204 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-03 (D55c, the cold run: chooserSheet, chooserSheetSays and sheetAdvice, launchChooserNote with a sheet): 221 mutants, 0 survived, 0 without coverage — after a test pinned that a row with no text2 has no `detail` key, whose spread survived the first run at 99.55 % (220 of 221)
- 100 % on 2026-11-03 (D55b code review, the cold run: the reason filter moved to android-start.ts, chooserAlsoInFront pinned): 70 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-03 (D55b review round 1, the cold run: monkeyChooserRefusal with the shared advice, the exit code and its real reasons, SYS_KEYS's warning filtered): 79 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-03 (D55b, the cold run: chooserAdvice, launchChooserNote and monkeyChooserRefusal pinned whole): 64 mutants, 0 survived, 0 without coverage
- 100 % on 2026-11-03 (D55r review round 1, the cold run: FOCUSED_APP_RE ends the component at a space or `}`, API 33's brace shape read, and a record cut right after the component names nothing): 51 mutants, 0 survived, 0 without coverage; 100 % (52) on D55r's first final run, the terminator `[\s}]`
- 100 % on 2026-11-03 (D55 final, the two focus regexes literals again): 50 mutants, 0 survived, 0 without coverage; 100 % (31) while the code review's RECORD_COMPONENT built them with `new RegExp`, which Stryker's regex mutator does not reach (reverted for that); 100 % (50) after review round 1 (display 0's block, API 29's AppWindowToken); 92.54 % on that round's first run (67 mutants, 5 survived: an index-based block slice whose no-display-0 branch was equivalent, and the header regex's anchor and `\d+`), rewritten as a split; 100 % (40) after the code review; 87.80 % on the first run (41 mutants, 5 survived: the `u\d+` user token, the class's `^` alternative, dropped as dead, and CHOOSER_ADVICE's two strings, now pinned in its own test)

## src/adapters/android-wm.ts

- 95.93 % on 2026-11-13 (A35, the one display rule: onDefaultDisplay; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a35b`, cold, the group 23 s at load 3–11): 615 mutants, 590 killed, 25 survived. The 4 new survivors are equivalent: `?? ''` and the focus-less `''` as any other string (no line in it reads), WINDOW_DISPLAY_RE's `^` and `\d+` as `\d` (a block's own `mDisplayId=` line is its first, and only "is it 0" is asked); the other 21 as A27 left them
- 96.33 % on 2026-11-11 (A27 code review, unchanged; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27d`, cold, the group 23 s at load 2–9): 572 mutants, 21 survived
- 96.33 % on 2026-11-11 (A27 review round 2: five of the six anchors pinned by a synthetic variant of a captured line each — the window header's `^` and `$`, `Frames:`'s `^`, DisplayFrames' `r=(\d+)` and its blank tail; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27c`, cold, the group 34 s at load 10–20 (a lab run elsewhere)): 572 mutants, 551 killed, 21 survived — the 20 equivalents below and InsetsSource's `$` dropped, equivalent: JS's `.` stops before every line terminator multiline `$` matches before, so `(.*)` ends where `(.*)$` does; the floor back to 94
- 95.45 % on 2026-11-11 (A27 review round 1, the `android` group, its lists lean: android.test.ts out, the parsers' cases moved to android-wm.test.ts; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27b`, cold, the group 23 s at load 11–17): 572 mutants, 546 killed, 26 survived — the 20 below, and 6 regex anchors the core run had counted as timeouts (the window header's `^` and `$`, `Frames:`'s `^`, InsetsSource's `$`, DisplayFrames' `r=(\d)` and its tail), none a captured dump tests; INPUT_SHOWN_COMMAND's and TOUCHABLE_COMMAND's strings were killed only through the adapter's calls in android.test.ts and are pinned in android-wm.test.ts now; the floor 94 → 93 (two under the score's whole number)
- 96.50 % on 2026-11-11 (A27, joined: the window manager's reads moved out of android.ts, the chooser's focus read with them, one mCurrentFocus reader; `npm run mutate -- --group core --force --mutate src/adapters/android-wm.ts,src/adapters/android-tree-dialect.ts,src/adapters/android-bounds.ts,src/adapters/android-chooser.ts --tempDirName reports/mutation/stryker-tmp-a27`, cold, 351 s): 572 mutants, 535 killed, 17 timeouts (counted killed), 20 survived — equivalent (`type === undefined` before a Set lookup, a frame missing read as a zero rect, a missing DisplayFrames or focus caught by a later guard, `\s` for `\s+` in a replace to '', `/^\d+/` and `/\d+$/` on a capture of digits or letters only, `recognised--` where only zero is asked, `rect.y >= 0` where a bar from y 0 is no portrait bar) or an anchor no captured dump tests (the window header's `^` and `$`, `Frames:`'s `^`, InsetsSource's `$`, DisplayFrames' `r=(\d)`); 88.81 % before A27's tests (61 survived, 3 without coverage)

## src/adapters/android-tree-dialect.ts

- 95.44 % on 2026-11-11 (A27 review round 2, unchanged; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27c`, cold, the group 34 s at load 10–20 (a lab run elsewhere)): 505 mutants, 21 survived, 2 without coverage
- 95.44 % on 2026-11-11 (A27 review round 1, the `android` group; tests/adapters/android-accessibility-order.test.ts joins its tests: the node-provider rule (`providesNodes`, `inProvider`, the `provided` set and the one window's copy of it) was killed only by android-presented-window.test.ts's plays before, and by the reading-order cases now; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27b`, cold, the group 23 s at load 11–17): 505 mutants, 481 killed, 21 survived, 2 without coverage, 1 runtime error — the same survivors as below
- 95.45 % on 2026-11-11 (A27, joined: the uiautomator dialect moved out of android.ts; `npm run mutate -- --group core --force --mutate src/adapters/android-wm.ts,src/adapters/android-tree-dialect.ts,src/adapters/android-bounds.ts,src/adapters/android-chooser.ts --tempDirName reports/mutation/stryker-tmp-a27`, cold, 351 s): 505 mutants, 482 killed, 21 survived, 2 without coverage — the 2 the single-node arms of `childrenOf`/`rawChildren` (`isArray: node` makes every `node` an array); equivalent: a missing class or id read as '' or any other non-name, `presentedWindow` asked of several windows (the synthetic root takes no presentation), `idEntry`'s `at < 0`; untested here: `uncut`'s skip conditions and `widenUnderCovers`' empty guard (the widening is pinned through draw order, tests/ui-tree), the sheet recognizers' `s.x` and `s.height > 0`; 86.34 % before A27's tests (65 survived, 4 without coverage). A run under load scored it 98.61 % with 42 timeouts counted killed

## src/adapters/android-bounds.ts

- 100 % on 2026-11-11 (A27 review round 2; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27c`, cold, the group 34 s at load 10–20 (a lab run elsewhere)): 9 mutants
- 100 % on 2026-11-11 (A27 review round 1, the `android` group; `npm run mutate -- --group android --force --tempDirName reports/mutation/stryker-tmp-a27b`, cold, the group 23 s at load 11–17): 9 mutants, 0 survived
- 100 % on 2026-11-11 (A27, joined: `[l,t][r,b]` moved out of android.ts; `npm run mutate -- --group core --force --mutate src/adapters/android-wm.ts,src/adapters/android-tree-dialect.ts,src/adapters/android-bounds.ts,src/adapters/android-chooser.ts --tempDirName reports/mutation/stryker-tmp-a27`, cold, 351 s): 9 mutants, 0 survived; 66.67 % before A27's tests (`r - l` at x 0, a missing bounds attribute)

## src/interact/app-holder-text.ts

- 96.88 % on 2026-11-06 (A10 review round 1, the never defaults, holdsIt's table, the link leads moved here; cold): 128 mutants, 0 survived, 4 without coverage: the two never defaults, unreachable while the types hold
- 97.70 % on 2026-11-06 (A10, every word about what holds the app, moved here from android-chooser.ts, ios-system-alert.ts, ios-foreground.ts and mcp/tool-text.ts; cold): 87 mutants, 2 survived, 0 without coverage: both on appHolderText's `case 'none'` (the condition and the emptied string), equivalent, as a switch that falls off its end returns undefined too

## src/adapters/typeable.ts

- 90.24 % on 2026-11-03 (D43 review round 2, the no-path remedy names the character WDA refuses; cold, after main's merge): 41 mutants, 4 survived — the same four equivalent anchors in named(); the floor rises 86 → 88 with it (ADR 0038's floor rule)
- 88.89 % on 2026-11-03 (D43 review round 1, widerPath judged by the whole value; cold): the same 36 mutants and 4 survivors
- 88.89 % on 2026-11-03 (D43, Typeable.otherPath and widerPath; cold): 36 mutants, 4 survived, 0 without coverage — all four in named()'s two class tests, whose ^ or $ anchor dropped is equivalent (a refusal's character is one code point)

## src/adapters/ios-typing.ts

- 100 % on 2026-11-03 (D43 review round 2, cold, after main's merge): 25 mutants, 23 valid, 0 survived, 2 runtime errors
- 100 % on 2026-11-03 (D43 review round 1, the Specials refused, "any other character" in the refusal; cold): 25 mutants, 23 valid, 0 survived, 2 runtime errors
- 100 % on 2026-11-03 (D43, IDB_TYPEABLE, WDA_TYPEABLE and typingPathOf; cold, after a test pinned WDA's whole says clause, whose middle string survived the first run at 95.65 %): 25 mutants, 23 valid, 0 survived, 2 runtime errors (a class fragment emptied: an invalid RegExp) — Stryker's regex mutator does not reach the two sets, built with new RegExp: the hand mutants do (ADR 0037's D43 amendment, residual 9)

## scripts/truth/batch/words.ts

- 100 % on 2026-11-05 (T2 S6a review round 2: NONE_RAN_LINE; cold): 143 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S6a review round 1: exit 2 when no wanted block ran, EXIT.nothingRan; cold): 136 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S5 code review: failedCall; cold): 130 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S5: exitText shared from here, tested here; cold): 124 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S4 review round 1: WARN a verdict word; cold): 113 mutants, 0 survived
- 100 % on 2026-11-04 (T2 S3 review round 1: nameInLine and firstLineOf; cold): 113 mutants, 0 survived
- 100 % on 2026-11-04 (T2 S2 code review: messageOf and timeOf shared from here; interruptedBlock's why; cold): 104 mutants, 0 survived
- 100 % on 2026-11-04 (T2 S1 code review: refusedLine, NOTHING_DONE and twoDigits shared here; cold): 97 mutants, 0 survived
- 100 % on 2026-11-04 (T2 S1 review round 1, failsIn as batch-12's exit rule plus the step form, restore.written; cold): 91 mutants, 0 survived
- 100 % on 2026-11-04 (T2 S1, cold): 95 mutants, 0 survived, 0 without coverage

## scripts/truth/batch/select.ts

- 99.43 % on 2026-11-04 (T2 S1 review round 2, the m flag refused too; cold): 176 mutants, 1 survived — the same equivalent
- 99.43 % on 2026-11-04 (T2 S1 review round 1, a text pattern matched whole, no g or y flag, values typed from the spec; cold): 176 mutants, 1 survived — the same equivalent
- 99.41 % on 2026-11-04 (T2 S1, cold): 170 mutants, 1 survived, 0 without coverage — equivalent: `spec.atMost ?? []` turned into a one-string list, whose destructured `low` and `high` are undefined, so the cross check compares NaN and adds nothing

## scripts/truth/batch/run-dir.ts

- 99.38 % on 2026-11-05 (T2 S6a review round 1: blockName shared with the runner; cold): 161 mutants, 1 survived — the same equivalent
- 99.37 % on 2026-11-05 (T2 S3 code review: plainSegment, shared with cases.ts; cold): 159 mutants, 1 survived — the same equivalent
- 99.36 % on 2026-11-04 (T2 S1 code review, one PLAIN_SEGMENT, isEexist, refusedLine; cold): 157 mutants, 1 survived — the same equivalent
- 99.39 % on 2026-11-04 (T2 S1 review round 2, the mv hand line single-quoted, only the date left to the shell; cold): 164 mutants, 1 survived — the same equivalent
- 99.37 % on 2026-11-04 (T2 S1 review round 1, batchReasons, the quoted mv, writeRestore returns its lines, summaryFile; cold): 159 mutants, 1 survived — the same equivalent
- 99.36 % on 2026-11-04 (T2 S1, cold): 157 mutants, 1 survived, 0 without coverage — equivalent: stateOf's `?? ''` for a missing file turned into another string that is no JSON either (both read unreadable)

## scripts/truth/batch/shell.ts

No earlier baseline: the latest, in scope.json, is its first.

## scripts/truth/batch/steps.ts

- 99.25 % on 2026-11-04 (T2 S2 code review, timeOf from words.ts; cold): 133 mutants, 1 survived, 6 timeouts — the same equivalent
- 99.26 % on 2026-11-04 (T2 S1 code review, the options renamed, twoDigits and isEexist shared; cold): 135 mutants, 1 survived, 6 timeouts — the same equivalent; floor 98 → 97 on 2026-11-04 (T2 S1 code review): ADR 0038's rule puts a floor about 2 points below its baseline, and 98 sat 0.28 points under 99.28 %, less than one mutant of 139 — so any new survivor, equivalent or not, would fail the run
- 99.28 % on 2026-11-04 (T2 S1 review round 2, terminalOf's deadline: 1.5 s with no byte taken, reset by every byte, a 0-byte write no progress, EIO gone; cold): 139 mutants, 1 survived, 6 timeouts — equivalent: the `?? ''` for an error with no code turned into another string, neither a gone code nor EAGAIN, so it is thrown either way
- 100 % on 2026-11-04 (T2 S1 review round 1, terminalOf: a synchronous write to fd 1, EPIPE and EBADF gone, EAGAIN waited out within a bound; summary.txt; cold): 135 mutants, 0 survived, 7 timeouts — after a test pinned the EAGAIN bound's count and its wait, whose three mutants survived the first run at 97.78 %
- 100 % on 2026-11-04 (T2 S1, cold): 96 mutants, 0 survived, 0 without coverage — after linkLatest's lstat catch was narrowed to ENOENT; the run before, at 97.94 %, left open's `latestOut === undefined` set false surviving, since a bare catch read the missing path as nothing there

## scripts/truth/batch/io.ts

- 95.71 % on 2026-11-04 (T2 S2 code review, withAppend for a child's log; cold): 70 mutants, 3 survived — the same three equivalents
- 95.38 % on 2026-11-04 (T2 S2, replace for markDirty, its folder and temp-name refusals tested; cold): 65 mutants, 3 survived — the same three equivalents; floor 92 → 93 as the baseline rose
- 94.55 % on 2026-11-04 (T2 S1 code review, isEexist shared from here; cold): 55 mutants, 3 survived — the same three equivalents
- 94.00 % on 2026-11-04 (T2 S1 review round 1, realpathSync.native; cold): 50 mutants, 3 survived — the same three equivalents
- 94.00 % on 2026-11-04 (T2 S1, cold): 50 mutants, 3 survived, 0 without coverage — all equivalent: read's catch emptied (it returns undefined either way), list's `.sort()` dropped (APFS lists a folder sorted already, so no test on this machine tells them apart), real's root guard set false (realpath of the root never fails)

## scripts/truth/batch/bounded.ts

- 99.12 % on 2026-11-05 (T2 S5: execOf shared from here; cold): 226 mutants, 2 survived — the same two equivalents
- 99.09 % on 2026-11-04 (T2 S3: git's own bound, GIT_SECS, in boundFor; cold): 220 mutants, 2 survived — the same two equivalents
- 99.08 % on 2026-11-04 (T2 S2 final check: stopKept(owner), the owner recorded when a group is kept; cold): 218 mutants, 2 survived — the same two equivalents
- 99.04 % on 2026-11-04 (T2 S2 code review: kept groups apart from the probes, ended by stopKept; the log opened through io.ts; emulator out of KEEPS_GROUP; cold): 209 mutants, 2 survived — the same two equivalents
- 99.02 % on 2026-11-04 (T2 S2 review round 4: every new call first drops the kept groups gone since; cold): 204 mutants, 2 survived — the same two equivalents
- 98.96 % on 2026-11-04 (T2 S2 review round 3: a kept group asked with kill(-id, 0) when its leader ends and before stopAll, an empty or ended one dropped; undelivered kills reported as they happen with their scope's owner; cold): 193 mutants, 2 survived — the same two equivalents
- 98.84 % on 2026-11-04 (T2 S2 review round 2: kill results, never thrown, EPERM tried once more, a group gone at TERM not killed again, a stopped scope refuses calls, KEEPS_GROUP; cold): 172 mutants, 2 survived — the same `bound === undefined` equivalent, and signal's `typeof r === 'object'` set true (a 'sent' or 'gone' string has no notSent, so it is not EPERM either); the score fell from 99.10 % by the new mutants' share, not by a test lost, so the floor stays 97
- 99.10 % on 2026-11-04 (T2 S2 review round 1: the leader's leftovers killed, keepGroup, the 142 race, MAX_SECS, Calls.scope, the close grace moved here from proc.ts, no timer left behind; cold): 111 mutants, 1 survived — the same `bound === undefined` equivalent; floor 96 → 97 as the baseline rose
- 97.87 % on 2026-11-04 (T2 S2, cold): 94 mutants, 2 survived, 0 without coverage — both equivalent: the bound's `bound === undefined` set false (`!(undefined > 0)` refuses it as well; the test is there for the type), and the not-started `pid === undefined` set false (its `done` has settled already, so the timer is cleared before it can fire and the call is never in the running map past its end)

## scripts/truth/batch/abort.ts

- 98.89 % on 2026-11-05 (T2c: the budget races on fake time; cold): 451 mutants, 1 survived, 4 without coverage — open's `stateFile !== undefined`, the equivalent named below; the judges' budget `left <= 0` turned `< 0` is no longer equivalent: on fake time a block left exactly 0 ms is spent, a test kills it; floor stays 96 (98.89 − 2)
- 98.67 % on 2026-11-05 (T2 S6b, final cold run): 451 mutants, the same two equivalents
- 98.67 % on 2026-11-05 (T2 S6b: lastly, the run's last steps on both ends; cold): 451 mutants, 2 survived, 4 without coverage — open's `stateFile !== undefined` (named below) and S6a's judges' budget `left <= 0` turned `< 0`, a boundary only a left of exactly 0 ms reaches (killed in the run before on timing): equivalent
- 98.85 % on 2026-11-05 (T2 S6a review round 6: completeness read within the judges' budget, checked once per block, complete() may say why; cold): 436 mutants, 1 survived, 4 without coverage — open's `stateFile !== undefined`, the equivalent named before, and the same unreachable catch; the round's first run left the old pre-judge budget check dead (designed away: one check per block) and the judge's budget frozen before the completeness reading (killed by a timing test)
- 98.10 % on 2026-11-05 (T2 S6a code review: head's errors replace the steps', writeRestore's how a union; cold): 421 mutants, 4 survived, 4 without coverage — the same equivalents and unreachable catch
- 98.11 % on 2026-11-05 (T2 S6a: leave, interrupted, head's errors; cold): 423 mutants, 4 survived, 4 without coverage — the same equivalents and unreachable catch
- 98.04 % on 2026-11-05 (T2 S5 review round 1: a put back may carry WARN; cold): 401 mutants, 4 survived, 4 without coverage — the same equivalents and unreachable catch
- 98.03 % on 2026-11-04 (T2 S2 final check: finish() async, ending the kept groups after its RESTORE and appending their undelivered kills; stopKept(owner) for a block; cold): 407 mutants, 4 survived, 4 without coverage — the same equivalents and unreachable catch
- 98.02 % on 2026-11-04 (T2 S2 code review: the kept groups ended last, after the restores and the judging; messageOf and timeOf from words.ts; cold): 404 mutants, 4 survived, 4 without coverage — the same equivalents and unreachable catch
- 98.03 % on 2026-11-04 (T2 S2 review round 3: a RESTORE hand line per group whose kill was not delivered — stopAll's, a scope's, the one after a leader's end, on the normal end too — and a late restore still running said so; cold): 407 mutants, 4 survived, 4 without coverage — the same equivalents and the same unreachable catch as round 2; floor stays 96
- 98.08 % on 2026-11-04 (T2 S2 review round 2: stopAll in a try of its own, the kills not delivered said, open() checks secs, one stderr header; cold): 365 mutants, 3 survived, 4 without coverage — the survivors as before (open's `stateFile !== undefined`, the budget check's `skip === undefined`, completeOf's catch); without coverage markDirty's `?? ''` and the three mutants of abortOnce's catch around stopAll, which cannot run: stopAll never rejects (bounded.ts turns every kill failure into a result), the try kept as defence the review asked for; floor stays 96
- 98.54 % on 2026-11-04 (T2 S2 review round 1: the windows snapshotted, close() and finish() noted while aborting, the log not relied on, each window on its own, stderr for a RESTORE that cannot be written, a restore stopped at its bound with its calls, the judges' one budget, no timer left behind; cold): 343 mutants, 4 survived, 1 without coverage — open's `stateFile !== undefined` set true, completeOf's catch emptied and markDirty's `?? ''` (without coverage), as before; and the budget check's `skip === undefined` set true and `left <= 0` as `left < 0`, both equivalent: a skip already set is the lateness of a restore, which stays the reason, and a budget left of exactly 0 s hands within() a 0 s bound that is late at once; floor 95 → 96 as the baseline rose
- 97.53 % on 2026-11-04 (T2 S2, cold): 243 mutants, 5 survived, 1 without coverage — all equivalent: within's `finally { clearTimeout }` emptied or its call dropped (a timer left armed resolves a race already settled, and the abort exits next); open's and putBack's `stateFile !== undefined` set true (nodeFs.exists of no path is false, so markDirty says missing and the state check is skipped either way); completeOf's catch emptied (it returns undefined, falsy as false); and, without coverage, markDirty's `?? ''` for a file that exists but cannot be read (a folder) turned into another string that is no JSON either

## scripts/truth/batch/preconditions.ts

- 100 % on 2026-11-04 (T2 S3 review round 1: the top of the checkout by --show-toplevel, the env's config dropped, names quoted in a why, the table's load failure named; cold): 285 mutants, 0 survived, 1 timeout — after a test pinned the env regex's end anchor (GIT_CONFIG_PARAMETERSX kept)
- 100 % on 2026-11-04 (T2 S3, cold): 247 mutants, 0 survived, 1 timeout (counted killed) — after the first run's 7 survivors were killed by tests (a modified path holding an R or a C is no rename; main unreadable with nothing on stderr, and past its bound; git's line trimmed; the groups named in a missing case's why) or designed away (main's sha read once, so its message's trim is no longer a second, equivalent copy); the real-git and real-table tests (preconditions-git.test.ts, cases-live.test.ts) run in the normal suite only

## scripts/truth/batch/cases.ts

- 99.64 % on 2026-11-05 (T2 S6a: incompleteLine takes any run result of Completeness's shape; cold): 275 mutants, 1 survived — the same equivalent
- 99.64 % on 2026-11-05 (T2 S3 code review: writeCases takes an Asked only, checked at run time; plainSegment from run-dir.ts; unreadLive from live-table.ts; cold): 275 mutants, 1 survived — the same equivalent
- 99.64 % on 2026-11-04 (T2 S3 review round 1: a run that proves nothing is incomplete, a stray .cases a gap, names quoted, the cases checked against a summary without its header; cold): 277 mutants, 1 survived — the same equivalent; liveCasesOf moved out to live-table.ts, so none is without coverage; the sources text of the selection's whys made once, after its ' or ' survived in the zero-pick why alone
- 99.23 % on 2026-11-04 (T2 S3, cold): 259 mutants, 1 survived, 1 without coverage — equivalent: completeness's `asked !== undefined` set true (no gap means the .cases was read as asked; the check is for the type); without coverage liveCasesOf, the dynamic import of main's live-cases.ts, which cases-live.test.ts runs in the normal suite only (the sandbox holds scripts/truth/batch/ alone); the first run's other survivors killed by tests (an invalid groups, a case line before any `## <source>`, a source header inside a line) or designed away (askedOf's object check, JSON's null read as no field)

## scripts/truth/batch/live-table.ts

No earlier baseline: the latest, in scope.json, is its first.

## scripts/truth/batch/ios-defaults.ts

- 99.81 % on 2026-11-05 (T2 S5: exitText moved to words.ts; cold): 530 mutants, 1 survived, 2 timeouts — the same equivalent
- 99.82 % on 2026-11-05 (T2 S4 code review: the pure half of ios-domains.ts split out — typed values, diffMaps, decideRestore in one pass, one table of the restore's actions, the defaults allowlist, the protected key's absent words pinned to that key, the state's shape, every line; cold): 544 mutants, 1 survived, 4 timeouts — equivalent: valueOf's `p.state === 'value'` set true (an absent read has no value, so it reads undefined either way; narrowed on state as the review asked, not cast); before the split its parts were ios-domains.ts's, at 100 % (904 mutants)

## scripts/truth/batch/ios-domains.ts

- 100 % on 2026-11-05 (T2 S5: execOf from bounded.ts, exitText from words.ts; cold): 326 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S4 code review: the io half after the split — LabSim, backup, restore, compare, readProtected, the abort window — against ios-domains-sim.test.ts; cold): 334 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S4 review round 2: absent by a `defaults read` probe after an empty export, the host's not-found words, values cut by code points, an unreadable state said in the window's hand; cold): 904 mutants, 0 survived, 3 timeouts — after its first run's one survivor, an export's `map?.` that can no longer be null, was typed away
- 100 % on 2026-11-05 (T2 S4 review round 1: compare's line, its dirty and udid refusals, the state's three domains each once, the builder an allowlist, absent on that domain's words only, the window's hand per domain; cold): 882 mutants, 0 survived, 3 timeouts — after its first run's 6 survivors and 1 without coverage were killed by tests (absent on exit 0 or past its bound, before → after of a domain absent before or gone, a state file gone when marked)
- 100 % on 2026-11-05 (T2 S4, cold): 823 mutants, 0 survived, 2 timeouts (counted killed) — after the first run's 38 survivors and 4 without coverage were killed by tests (two keys in a join, a typed read of every type, an export past its bound that wrote its file, a value with two trailing line breaks, an absent-before domain whose export fails, the restore's and compare's whys) or designed away as equivalents (guards the type already gave: decideRestore's backup and kv checks, `verb === undefined`, `typeof … !== 'object'` before a field check that refuses the same, the import exit tracked twice, a put back with nothing done, a domain's why and hand made always present, the protected read compared by value alone); tests/truth/batch/ios-domains-plist.test.ts, which starts python3, runs in the normal suite only

## scripts/truth/batch/lab-chooser.ts

- 99.85 % on 2026-11-11 (T20a code review: the preferred block's parse, the leak rule, the handler count, the entry's quote, the unread wording and the default's and the check's hand lines in ../chooser-readers.ts, re-exported; preferredOf and handlersOf kept as CallResult wrappers; cold, 243 s): 659 mutants, 1 survived, 1 timeout (counted killed) — the same equivalent (chooserOf)
- 99.89 % on 2026-11-05 (T2 S5 review round 4: stateFileHand names the probe's --state run; cold): 884 mutants, 1 survived — the same equivalent (chooserOf)
- 99.89 % on 2026-11-05 (T2 S5 code review: CHECK_OUTCOME, an entry with no mAlways unproven, HandBase, installedOf over pm path alone, two resolver_lists not unique; cold): 882 mutants, 1 survived — the same equivalent (chooserOf)
- 99.88 % on 2026-11-05 (T2 S5 review round 2: tags matched quote-aware, each tag's resource-id checked against src's identifier, Always asked of src's identifier too; cold): 851 mutants, 1 survived — the same equivalent (chooserOf); the ids read once, so the map and the check share them
- 99.88 % on 2026-11-05 (T2 S5 review round 1: the dump's tags read beside src's tree — resource-id, text, content-desc apart, enabled fail closed; cold): 826 mutants, 1 survived, 0 timeouts — the same equivalent (chooserOf); an entity decoder designed away (uiautomator writes none in an id or the word always), a tag's missing field read by String()
- 99.87 % on 2026-11-05 (T2 S5, cold): 777 mutants, 1 survived, 1 timeout (counted killed) — equivalent: chooserOf's `f.state === 'read'` set true (an unread read has no chooser, so it reads undefined either way; narrowed on state for the type); the first targeted run's 51 survivors and 6 without coverage killed by tests (an entry's blank lines, one-line entries, trailing spaces, decoys, two entries at one indent, the 200-character cut, CRLF answers, handlersOf's whole lines, Always just touching the target, a row's name from text1 and text2) or designed away (the block read line by line, ancestry by parent links, chooserOf, String() over a missing label or line)

## scripts/truth/batch/lab-emu.ts

- 99.75 % on 2026-11-05 (T2b-1: cleanUp takes its label; cold): 393 mutants, 1 survived, 3 timeouts — the same equivalent
- 99.75 % on 2026-11-05 (T2 S5 review round 4: the window's state restore whenever its state file is not clean; cold): 392 mutants, 1 survived, 3 timeouts — equivalent: the window's `o.stateFile !== undefined` set true (stateOf of no path reads unreadable, not clean, so the restore runs either way; the check is for the type)
- 100 % on 2026-11-05 (T2 S5 code review: LabOptions, the outcome table, no reinstall without a dirty mark, the state restore only after a reinstall started, readClipboard; cold): 386 mutants, 0 survived, 3 timeouts — after a test pinned a verified state restore inside the reinstall
- 100 % on 2026-11-05 (T2 S5 review round 1: proven only on exits 0/5/6, the abort's get-state first and cells.json proof, StateRestore, per-step hand lines; cold): 438 mutants, 0 survived, 3 timeouts — after the round's survivors were killed by tests (pm path unknown inside the abort's reinstall, an empty hand, the uninstall failing with adb gone) or designed away (installHandOf narrowed to a lab not installed)
- 100 % on 2026-11-05 (T2 S5, cold): 397 mutants, 0 survived, 3 timeouts (counted killed) — after the first targeted run's 5 survivors and 1 without coverage were killed by tests (a pull that fails leaving a file, the window's accepted exit and its put-back how, a put-back failing with no hand) or designed away (dismissChooser asks chooserOf; the fake's unzip names the entry literally)

## scripts/truth/batch/runner-lines.ts

- 100 % on 2026-11-05 (T2b-1: needCallLine, needCallsFile, needCallsCutLine; cold): 359 mutants, 2 timeouts (counted killed)
- 100 % on 2026-11-05 (T2 S6b: a typed warning in labLine, NO_UDID and NO_SERIAL, the SDK in configOf; cold): 341 mutants, 2 timeouts (counted killed)
- 100 % on 2026-11-05 (T2 S6a review round 5: only steps.log's lines timed; cold): 322 mutants, 0 survived, 2 timeouts
- 100 % on 2026-11-05 (T2 S6a code review: the step time set aside, liveTs, the records moved out; cold): 318 mutants, 0 survived, 2 timeouts
- 100 % on 2026-11-05 (T2 S6a review round 3: logErrors counts across this run's logs; cold): 350 mutants, 0 survived, 2 timeouts — after its one survivor, an unread log's `?? ''`, was designed away (the log skipped by name)
- 100 % on 2026-11-05 (T2 S6a review round 2: fileErrors deduplicates with counts; cold): 322 mutants, 0 survived, 2 timeouts
- 100 % on 2026-11-05 (T2 S6a review round 1: fileErrors, liveCalls, judgedNothingLine; cold): 306 mutants, 0 survived, 2 timeouts
- 100 % on 2026-11-05 (T2 S6a, cold): 271 mutants, 0 survived, 2 timeouts (counted killed) — after the first cold run's 4 survivors were killed by tests (a detail line ending in == kept, one starting with it dropped; a lone CR ends a line) or designed away (configOf's `out === undefined` beside its error, typed by `as`; parsedRecord's catch left empty, the record read after it)

## scripts/truth/batch/records.ts

- 100 % on 2026-11-05 (T2 S6b code review: canonicalJson, a run's identity; cold): 96 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S6a review round 5: recordsComplete, a file-presence rule, removed; cold): 73 mutants, 0 survived
- 100 % on 2026-11-05 (T2 S6a code review: a non-live block's records moved here from runner-lines.ts and the runner — recordOf, recordGap, writeAsked, writeDone, recordsIn, recordsComplete; cold): 100 mutants, 0 survived

## scripts/truth/batch/runner.ts

- 99.45 % on 2026-11-05 (T2b-1 code review: the need end's words in runner-lines.ts, one specOf; cold, final): 545 mutants, 0 survived, 3 without coverage — the same three
- 99.45 % on 2026-11-05 (T2b-1 review round 1: an end for every need met once, a late end's lines taken when settled, endUnread on a throw, a bound passed and the abort; cold): 543 mutants, 0 survived, 3 without coverage — the same three
- 99.40 % on 2026-11-05 (T2b-1: a need's end, its calls recorded; cold, after the first run's four equivalent survivors were designed away): 495 mutants, 0 survived, 3 without coverage — the same three
- 99.32 % on 2026-11-05 (T2 S6b code review: canonicalJson called directly; cold, final): 444 mutants, 0 survived, 3 without coverage — the same three; superseded: 99.33 % on 2026-11-05 (T2 S6b: asksLive, fs in the ctx, the run's last steps; cold): 446 mutants, 0 survived, 3 without coverage — the same three `?? ''` named below
- 99.29 % on 2026-11-05 (T2 S6a review round 6: complete() only adds a requirement, a run cut short INTERRUPTED with its gap; cold): 422 mutants, 0 survived, 3 without coverage — the same equivalents
- 99.27 % on 2026-11-05 (T2 S6a review round 5: one completeness rule, assess, on both paths; noRecords guarded; cold): 409 mutants, 0 survived, 3 without coverage — the same equivalents; the round's first run left 7 survivors, killed by tests (the noRecords throw's call names) or designed away (assess's state strings, now { complete, gap })
- 99.20 % on 2026-11-05 (T2 S6a code review: judgeable on both paths, noRecords, the steps' ERRORs counted with the logs', the records moved out to records.ts; cold): 373 mutants, 0 survived, 3 without coverage — the same equivalents; the first run's 5 survivors killed by tests (the judge's guards, two step ERRORs, the step time) or designed away (judgeable's catch left empty)
- 99.27 % on 2026-11-05 (T2 S6a review round 3: the logs named <block>/<file> for logErrors; cold): 410 mutants, 0 survived, 3 without coverage — the same equivalents
- 99.26 % on 2026-11-05 (T2 S6a review round 2: the none-ran line, the deduplicated ERROR lines, the needs loop stopped at the interrupt; cold): 407 mutants, 0 survived, 3 without coverage — the same equivalents; the round's one survivor, the blocks loop's interrupt check, killed by a test (a later block skipped for its precondition is not said skipped once the abort began)
- 99.25 % on 2026-11-05 (T2 S6a review round 1: the judged-nothing line, the need's recheck, after-interrupt notes, exit 2 when no block ran, fileErrors; cold): 400 mutants, 0 survived, 3 without coverage — each a `?? ''` turned into "Stryker was here!", equivalent because that text holds no `# Live golden:` header (live.ts's log, the rejudge summary: stepOutcome reads the same) and no run's header (steps.log: stepsOfRun finds none either way); the round's one survivor, a run counter only compared with 0 (`ran--`), designed away as a boolean
- 98.88 % on 2026-11-05 (T2 S6a, cold): 357 mutants, 0 survived, 4 without coverage — the same equivalents, and a log the folder lists read as "Stryker was here!", which holds no ERROR line (now fileErrors' NOTE, covered); the first cold run, at 90.44 % (331 mutants, 27 survived, 8 without coverage), had its survivors killed by tests (a run folder of this id refused, a block not stateful never refused, the default clock and pid, the ctx's steps and print, the lab line noted, a need's step, the abort's judge and complete() reading the folder, a judge-less block's no analyze line, a record's other write error, a details file missing, the no-device outcome and the live banner, an interrupt during the end's judging or the last block) or designed away (preconditions() returning an empty map once interrupted, the SKIP why read with `!`, the log folders taken in openRun's order)

## scripts/truth/batch/lab-lines.ts

- 100 % on 2026-11-05 (T2 S6b code review: the one hand-line builder, freshIn moved to io.ts; cold, final): 272 mutants, 0 survived; superseded: 100 % on 2026-11-05 (T2 S6b review round 1, cold): 283 mutants, 1 timeout (counted killed), 0 survived

## scripts/truth/batch/ios-lab.ts

- 100 % on 2026-11-05 (T2b-1: the ios need's end reads the finportal key; cold): 396 mutants, 1 timeout (counted killed)
- 100 % on 2026-11-05 (T2 batch-13 code review: iosCheck returns the reset's shape, wdaWindow its checks' warnings; cold): 392 mutants, 1 timeout (counted killed), 0 survived
- 100 % on 2026-11-05 (T2 batch-13 fixes: endCompanion — pkill, then idb disconnect — in the reset and the last step, ResetResult, the stale-companion why; cold): 380 mutants, 1 timeout (counted killed), 0 survived — after two equivalents of its first cold run (99.49 %: an optional field spread only when defined) were designed away
- 100 % on 2026-11-05 (T2 S6b code review: checkDevice, portFree once, Opened; cold, final): 359 mutants, 1 timeout (counted killed), 0 survived; superseded: 100 % on 2026-11-05 (T2 S6b review round 2, cold): 388 mutants, 1 timeout (counted killed), 0 survived

## scripts/truth/batch/android-lab.ts

- 100 % on 2026-11-05 (T2 S6b code review; cold, final): 180 mutants, 0 survived; superseded: 100 % on 2026-11-05 (T2 S6b review round 1, cold): 198 mutants, 0 survived

## scripts/truth/batch/lab-build.ts

- 100 % on 2026-11-05 (T2 S6b code review: checkDevice, GradleCall, the stop's reason; cold, final): 266 mutants, 0 survived; superseded: 100 % on 2026-11-05 (T2 S6b review round 2, cold): 241 mutants, 0 survived

## scripts/truth/batch/lab-run.ts

- 93.37 % on 2026-11-11 (A22: visibility, ensure and carousel join LAB_RUN_GROUPS as live blocks; cold full lab group `npm run mutate -- --group lab --force --tempDirName reports/mutation/stryker-tmp-a22`, 319 s at load 6–17 on main c5227d28 + A22 (ADR 0038's A22 amendment; a first run at 562 s, load 45–38, was load-inflated)): 182 mutants, 6 survived, 6 without coverage, 1 runtime error — the T24 classes
- 93.14 % on 2026-11-11 (A21; cold full lab group, 367 s at load 30–10): 176 mutants, 6 survived, 6 without coverage, 1 runtime error — the T24 classes
- 95.42 % on 2026-11-11 (T24 code review: standingSelection, standingRun typed from RunBatchOptions; cold, `npm run mutate -- --group lab --force --mutate scripts/truth/batch/lab-run.ts,scripts/truth/batch/lab-run-ios.ts --tempDirName reports/mutation/stryker-tmp-t24`, whose exit 1 is the narrowed run's): 525 mutants, 498 killed, 2 timeouts (counted killed), 15 survived, 1 runtime error, 9 no coverage — classified as T20b's: equivalent (ACCEPTED seeded, `summary ?? ''` seeded, the out folder's `meta` branches and `run-` filter, leftLine's `at < 0` as `at <= 0`, the selection's `[]` on a refusal), untested (the B_BUILD bound, the `io` fallbacks the command line alone takes, the held seam's `stderr`, the hand line's serial placeholder), unreachable under the fakes (`!opened.ok`), unreachable (`apk === undefined` and its block), the entry guard's line; superseded: 95.31 % on 2026-11-11 (T23, final: the `jvms` option passed to labBuild; cold, `npm run mutate -- --group lab --force --mutate scripts/truth/batch/lab-lines.ts,scripts/truth/batch/lab-build.ts,scripts/truth/batch/lab-run.ts`, whose exit 1 is the narrowed run's): 513 mutants, 486 killed, 2 timeouts, 15 survived, 9 without coverage, 1 runtime error — the same survivors as T20b's; the labBuild call's `pre.ok` ternary is killed again (its `{ secs }` emptied stays in the untested class below); superseded: 95.30 % on 2026-11-11 (T20b code review: a selection with no live group refused, leftLine's tail guarded, liveBlock, LAB_RUN_EXIT from words.ts#EXIT; the cold full lab group run, `npm run mutate -- --group lab --force`, 279 s, every lab module at or above its floor): 512 mutants, 485 killed, 2 timeouts, 15 survived, 9 without coverage, 1 runtime error. Equivalent (9): `summary ?? ''` seeded twice (no `# Live golden:` header, no failure line either way); ACCEPTED seeded with a string (it matches no entry); `meta === undefined`'s two branches and the `run-` filter, twice each (meta is undefined only on a refused config, whose exit 2 stands, and meta holds only `run-` folders); `wanted`'s `[]` on a refused selection (the run is refused); leftLine's `at < 0` as `at <= 0` (the cleanup's tail is never at the line's start, which is its label). Untested (6): labBuild's `{ secs }` emptied (B_BUILD's default is BUILD_SECS, and no test waits out a build's bound); `o.io?.seam`, `o.io?.fs` and its `??` (the tests always pass io; only the command line runs without); the held seam's `stderr` (no test makes the runner write there); the stateful hand line's placeholder for a serial not given (that refusal is the serial's own). Unreachable under the fakes only (2): `!opened.ok` and its why — the android need's guard ran just before, but a real emulator can go away between the need and the block. Unreachable (4): `apk === undefined`, its block and its two words — a met android need has pulled the APK. The entry guard's line (4): `isMain` is never true under the tests. Superseded: 95.39 % on 2026-11-11 (T20b review round 2, narrowed, 478 mutants); 95.25 % (round 1, the cold group run, 464 mutants); 94.12 % (the first cut, 205 mutants)

## scripts/truth/batch/lab-run-ios.ts

- 87.07 % on 2026-11-11 (T24 code review: the selection moved to lab-run.ts's standingSelection; cold, `npm run mutate -- --group lab --force --mutate scripts/truth/batch/lab-run.ts,scripts/truth/batch/lab-run-ios.ts --tempDirName reports/mutation/stryker-tmp-t24`, whose exit 1 is the narrowed run's): 117 mutants, 101 killed, 0 timeouts, 8 survived, 1 runtime error, 7 no coverage — classified: the entry guard's line (3); unreachable (`!sim.ok` in both blocks and its reason: the ios need's guard passed first; 4); not staged by the fake lab (the WebDriverAgent work's own health check failing or warning after the window's check passed; 5); untested (the B_BUILD bound; 2); the WDA block's WARN step text emptied (1); superseded: 86.76 % on 2026-11-11 (T24): 137 mutants, 9 survived, 9 no coverage

## scripts/truth/batch/standing.ts

- 98.97 % on 2026-11-11 (A21: standingRun sets its own exit code over the runner's; cold, `--group lab --force --mutate`): 291 mutants, 2 survived (`summary ?? ''`, equivalent; `o.io?.seam` as `o.io.seam`, only the command line passes no io), 1 without coverage
- 99.31 % on 2026-11-11 (A21; cold full lab group, 367 s at load 30–10): 289 mutants, 1 survived (`summary ?? ''`, equivalent), 1 without coverage

## scripts/release/pack-files.ts

No earlier baseline: the latest, in scope.json, is its first.

## scripts/release/clean-log.ts

No earlier baseline: the latest, in scope.json, is its first.

## scripts/truth/chooser-readers.ts

- 100 % on 2026-11-11 (T20a code review: ENTRY_CHARS and entryText, preferredUnread and handlersUnread shared with lab-chooser.ts, DefaultCause.predates a union; cold, 243 s): 249 mutants, 0 survived, 0 timeouts
- 100 % on 2026-11-10 (T20a review round 1: split out of chooser-premise.ts as the leaf the batches and the live premise share — preferredIn, the leak rule, handlersArgv and handlersIn, the hand lines' parts, defaultHand given its cause; `npm run mutate -- --group lab --force`, cold, 249 s): 234 mutants, 0 survived, 0 timeouts

## scripts/truth/chooser-premise.ts

- 100 % on 2026-11-10 (T20a review round 1: the premise alone, its readers in chooser-readers.ts — each fact carrying its hand, readPremiseInto, the WARN quoting the first entry by slice; cold, 249 s): 227 mutants, 0 survived, 0 timeouts; the round's first cold run scored 99.15 % (2 survived: readPremiseInto with no note, and the WARN's unused empty quote, designed away), the first killed by a test since
- 100 % on 2026-11-10 (T20a: the readers moved out of batch/lab-chooser.ts — preferredIn, the leak rule, handlersArgv and handlersIn, the hand lines' parts — and readChooserPremise, its four facts, its lines and the new hand lines; `npm run mutate -- --group lab --force`, cold, 260 s): 456 mutants, 0 survived, 0 timeouts; the first cold run scored 99.12 % (4 survived: the default's fresh state, the stack's join separator, the handler query's first line trimmed, the 200-character cut's boundary), each killed by a test since

## scripts/truth/rejudge-failures.ts

No earlier baseline: the latest, in scope.json, is its first.

## scripts/truth/device-state.ts

- 100 % on 2026-11-10 (T16 code review: deviceLabelling the one guard, DeviceLabel reads or an error, the offset read after LAUNCH_SETTLE_MS — an unreadable state file there fails the read — and the closing force-stop; `npm run mutate -- --group lab --force`, cold, 215 s): 181 mutants, 180 killed, 1 timeout (the same `n++` as `n--`), 0 survived — the first cold run of this round left the offset read's `?.` survived (99.44 %), killed since by the unreadable-after-launch test
- 100 % on 2026-11-10 (T16 review round 1: LAUNCH_SETTLE_MS after the launch, RECYCLER_FREE reused, rounds < 1 refused, the framework restart on the Device line, deviceLabelAtStart with `--device-read none`; `npm run mutate -- --group lab --force`, cold, 174 s): 170 mutants, 169 killed, 1 timeout (the same `n++` as `n--`), 0 survived
- 100 % on 2026-11-10 (T16, stateOf, parseGfxinfo, deviceLine, readDevice over AndroidLab, readInto; `npm run mutate -- --group lab --force`, cold, 184 s): 132 mutants, 131 killed, 1 timeout (counted killed: the stroke loop's `n++` as `n--`), 0 survived; the first cold run scored 89.39 % (14 survived: parseGfxinfo's one-line-missing checks, the unreadable state file, the launch's offset, the frames key), each killed by a test since

## scripts/truth/live-finish.ts

- 100 % on 2026-11-11 (D82, finishRun: the record written before the closes, each closer tried, a failed close and a failed write said on stderr; `npm run mutate -- --group lab --force --mutate scripts/truth/live-finish.ts --tempDirName .stryker-tmp-d82`, cold, 24 s): 21 mutants, 21 killed, 0 timeouts, 0 survived, 0 without coverage

## scripts/differential/connection.ts

- 96.00 % on 2026-11-12 (A33, joined; `npm run mutate -- --group lab --force --tempDirName reports/mutation/stryker-tmp-a33`, cold, 315 s at load 7 → 10): 25 mutants, 24 killed, 1 survived, 0 without coverage — the client's version `'0'` emptied, equivalent (nothing reads the client's version; the server's, `name`, is pinned)

## scripts/truth/run-case.ts

- 100 % on 2026-11-10 (T10, no first state: the case's named LOUD `no-state`, no judge, no late or panel read, the focus, screenshot and teardown kept; cold): 225 mutants, 0 survived
- 100 % on 2026-11-09 (T7b, the chooser group: fromLauncher, the focus reads, the teardown; cold): 216 mutants, 0 survived
- 100 % on 2026-11-06 (A11 review round 2: `swipes?: { drop?: number }`, no ternary; cold): 142 mutants, 0 survived
- 98.62 % on 2026-11-06 (A11 review round 1, `swipes?: true | { drop }`; cold): 145 mutants, 2 survived, both equivalent
- 99.32 % on 2026-11-06 (A11; cold): 148 mutants, 1 survived

## scripts/truth/replies.ts

- 97.86 % on 2026-11-10 (T13, joined; cold): 376 mutants, 374 valid (2 runtime errors), 7 survived, 1 without coverage, all equivalent, its own test alone (the same score with the judges' tests in the group) — HEDGE_WHAT_PATTERN's longest-first sort removed or broken three ways (the alternation is followed by `): `, so backtracking reaches the longest whatever the order); bareEntry's `first !== undefined` true (RegExp.test(undefined) reads "undefined", which never matches); MOVED_TAP's last `\d+` cut to `\d` (an unanchored tail: any reply the whole pattern takes, the cut one takes); namesUntried's `end >= 0` as `> 0` (a found end lies past the lead); snapshotNodes' `end < 2` false (end 1 slices `[`, which JSON.parse refuses into the same undefined) and its catch emptied (undefined either way, no coverage). The bandSaid test's one device record copied into the sandbox

## scripts/truth/live-carousel.ts

- 98.87 % on 2026-11-10 (T10 review round 1: hedgedCeiling counts its judged legs by live-visibility.ts#isJudged, a `no-state` leg not judged; cold): 798 mutants, 796 valid (2 runtime errors), 8 survived, 1 without coverage — T13's, the same equivalents
- 98.88 % on 2026-11-10 (T13, joined; cold): 802 mutants, 800 valid (2 runtime errors), 8 survived, 1 without coverage, all equivalent — the SwipeHook entry's `durationMs !== undefined` true (a `durationMs: undefined` key); D68_SPREAD's id emptied (compared only with itself); judgeFully's band check behind `hasClip(launched)`: `scrollViews?.carousel` unguarded, `clip === undefined` false, its ternary and its 'no carousel clip at launch' words (unreachable, no coverage); judgeSettledRead's `snapshot ?? ''` fallbacks seeded twice (replyKind and snapshotNodes read the seed as they read ''), and `clip === undefined` false (JSON.stringify(undefined) never equals the lab's clip). The live cases' lab cell catalog (fixtures/apps/cells.json) copied into the sandbox

## scripts/truth/live-visibility.ts

- 98.37 % on 2026-11-11 (T21 review round 1: judgeCarry's view filter killed by the review's counterexample — another view's still stroke read as a carry past a narrow window — and judgeAndroidTurn's `v.kind === 'visible'` by a synthetic stop naming a direction; rectText's dead `null` removed; cold): 1 470 mutants, 23 survived, 1 without coverage, all equivalent; floor 96 (two below the score's integer part). Equivalent (24): showRegion's status trim on a region already below the band (y 0, the screen's top) — `r.y < …` true or `<=`, the height's `+` and `status.y - status.height` (the second rect only grows past r); a chrome starting at the region's bottom (`c.y <= …`: trimmed to its own height), centred on its middle (`<= mid`: the first branch's), ending at its top (`>= r.y`: set as it was); judgeScroll's `g !== undefined` true twice (stopHolds and CUT_GEOMETRIES.includes take undefined as no geometry; kept for the narrowing), its classStrokes `?? []` seeded (no frame or clip: the end is 0, the seed neither closer nor not), `tap === undefined || tapped === undefined` three ways (tapped is undefined exactly when tap is); judgeAndroidTurn's `v.outcome === 'ok'` false and its 'ok' emptied (an ok verdict has no cls, so the next clause returns it), its classStrokes `?? []` seeded (no coverage, the same); visibilityCases' `t?.scrollView !== undefined` true (named is undefined when it is); judgeAbsentAtEnd's `swipes !== undefined` true (undefined <= 2 is false; kept for the type); the 'android' platform emptied in judgeBlankStretch, judgeWithin and judgeAtRest, the 'ios' in judgeCarry's showRegion (judgedContext tells iOS from any other, and the region reads no home indicator); judgeAtRest's view filter `s.view === view` true (it is reached only on an ok verdict: another view's stroke that moved more than the slack is judgeScroll's R-direction first, one that did not is under the slack); touchTurns' `>=` as `<` (the halves swapped, every turn still a change). The new test reads the static truth under tests/ (already in the sandbox)
- 98.03 % on 2026-11-11 (T21: tests/truth/live-visibility-words.test.ts — each judge's verdicts whole, outcome, rule, kind and words, at their edges, and the cases the live run asks of the committed static truth; T17's gate without `!holds` and `lead !== undefined`, judgeCarry's clip read without its guard; cold): 1 474 mutants, 28 survived, 1 without coverage; floor 72 → 96
- 75.42 % on 2026-11-10 (T10 code review: isStateless beside isJudged, hedgedStops' `replied`; cold): 1 485 mutants, 345 survived, 20 without coverage — every new mutant killed
- 75.37 % on 2026-11-10 (T10 review round 1: isJudged, not SKIP and not `no-state`, shared by the hedged ceiling and the residual tally; cold): 1 482 mutants, 345 survived, 20 without coverage — every new mutant killed (the T10 base read 75.20 %, 1 472 mutants, 345 survived)
- 74.71 % on 2026-11-10 (T15 after its code review: hedgedStop, hedgedStops — the visibility group only, one `all` list, HEDGED_CUT shared with judgeScroll — and hedgedStopsLine; cold): 1 396 mutants, 334 survived, 19 without coverage — T13's, every one of T15's 103 new mutants killed; floor 70 → 72 (two below the score's integer part)
- 72.70 % on 2026-11-10 (T13, joined at its measured score; cold): 1 293 mutants, 334 survived, 19 without coverage — 90 % would take some 230 more kills over thirty judges: backlog row T21. T17's LOUD gate is held but for its conjuncts redundant given a hedged lead, so counted survivors (T21), not argued equivalent (`visible`, `!holds`, `c.fully`, `g !== undefined`, `lead !== undefined`, each implied by a cut geometry and a hedged lead); its one gap, a hedged stop with no tap after it (`tapped?.outcome` unguarded), killed by T13's test. Floor low on purpose, like draw-order's: raise it as its tests come
