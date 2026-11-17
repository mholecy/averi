# Architecture review, 2026-11-17

Base: `main` at 72af77b4, after the comment truth programme (A47–A66). Read-only review; the backlog rows it filed are
A67–A79 in docs/plans/2026-10-30-performance-backlog.md.

## Method

Five Opus reviewers, one per area: src/adapters; src/interact; src/ui-tree; src/verify with src/util; src/flow, src/mcp,
src/run and the harness seams of scripts/differential and scripts/truth. Each used the deep-module vocabulary
(mattpocock-skills:codebase-design), read ARCHITECTURE.md, the 2026-11-11 ten-agent review and the backlog's verdicts,
and looked for evidence in churn: `git log --since=2026-11-11 --stat` and files that change together. A candidate names
its problem with evidence, the deeper module or seam it proposes, what that deletes, a cost (S/M/L), its risk (device,
golden) and a verdict: Strong, Worth exploring, or Not worth it. Nothing the backlog already decided is proposed again
without new evidence. The orchestrator merged the reports, checked the claim two reviewers made independently (A67) in
the code, and ranked them.

Since 2026-11-11 most commits in every area were comment slices. The code churn worth reading was A41a/b/d (iOS tree
source), A38a/b (backdrop, keyboard line), A45 (dialect) and A54/A66 (the privacy leaks), and most of the candidates
below come from it.

## Candidates, by rank

### Strong

**A67. One module names a node, and the A54 rule holds in all of its sentences** (interact and ui-tree, independently;
cost S–M; no device; golden Changed 0 or only rows where an input is a cover).
The rule "an input labelled by its own text is said by its length and rect, never quoted" (ADR 0043, A54 amendment)
lives in src/ui-tree/listed-text.ts#listedText and src/interact/resolve.ts#labelByLength. The other spellings of "name
this node" do not apply it: src/ui-tree/geometry.ts#nodeText and #coverText (tap, scroll_until and pixel replies, about
20 call sites: cover sentences, scroll views, `within` ambiguity lists, flush neighbours), src/interact/target-text.ts#coverName,
the touched node in src/interact/scroll-text.ts, the accessory button in src/interact/keyboard-dismissal.ts, and
src/ui-tree/remedy-text.ts. They cannot apply it: `QuotedNode` is `Pick<UiNode, 'role' | 'label' | 'identifier' |
'rect'>` and `quoted()` drops `value`. An Android EditText with no content-desc drawn over a tap target is quoted as
`under textfield "<its text>" (…)`, which may be a password. A54 and A66 mended this one sentence family at a time
(ad14f99d, 81a897bd, 718d1070, 657a566f), and the leak sweeps cover only fill and assert. Proposal: one ui-tree
node-words module owns `QuotedNode` (carrying whether the label is the node's own text) and every namer (`nodeText`,
`coverText`, `coverName`, `listedText`, the scroll-view and rect words), with the short and listed forms as shapes of one
function; `ResolveOptions.labelsByLength` becomes a naming policy, not a resolution option. A sweep in the A66 style over
tap, scroll_until and pixel cover sentences pins it; ADR 0043's amendment says the rule covers every sentence that names
a node. Folded in: remedy-text's "idb lists … before" / "WDA lists … after", a dialect fact re-derived in the words
(ui-tree #4).

**A68. verify owns its last finding; pollTree stops carrying a string miss** (verify; cost M; no device; golden Changed 0).
`pollTree` (src/ui-tree/read-tree.ts) keeps the last miss as a string later rounds cannot erase and has no way to say a
miss is final; only verify builds `PollMiss` (src/verify/poll-verdict.ts). Both polls work around it: pixel-poll keeps
`lastCovered`/`coverCleared`/`findingStands` to withdraw a covered miss and throws `FinalMiss` out of its predicate to
stop, though `pollTree<T>` already ends on any T; assert keeps a `subject` variable in the round closure that must stay
in step with the string, and two of A66's four fixes were that drift (657a566f, 718d1070). The types also allow a tree
assert's `final` verdict, which `verdictToPoll` turns into an ordinary miss that keeps polling. Proposal: a pass and a
final miss are both T; a miss is a typed value handed to verify's memory, where it is replaced or withdrawn; the element
assert's miss is one record `{content, subject}`; the two timeout tails become one function in poll-verdict.ts.
Folded in: `textHint(expected, {subject} | {tree})`, so the quote-or-length choice is the argument's shape and not a
`HintScope` flag a caller pairs by hand (verify #2, privacy-relevant like A67).

**A69. One judged screen, and `failsOpen` in the type** (ui-tree; cost S; no device; golden Changed 0; a latent bug).
`UsableScreen` (src/ui-tree/usable-screen.ts) is not a discriminated union; `treeScreen` returns `UsableScreen &
{failsOpen}`, standing.ts widens it back and `touchScreen` drops it. Callers rebuild the fallback with two policies:
`usableScreen(...) ?? treeScreen(tree)` in pixel-poll, tap-judgement and eyes, `screen?.box ?? screenOf(tree)` in
keyboard-dismissal. Any spread copy would silently lose `failsOpen`, and the idb 0×0-root pixel assert would judge off
the largest node. Proposal: `from: 'tree'` carries `failsOpen`; one `judgedScreen(adapter, look)` answers device,
window or tree, deleting the fallbacks and standing's widening.

**A70. The applied keyboard hands out its `KeyboardUp`** (interact; cost S; no device; golden Changed 0).
`{lineY, remedy}` is assembled by hand at six places (tap-judgement, resolve, scroll-text, scroll-rounds twice, with an
inline copy of the type in scroll-read). In scroll-rounds the line comes from the stroke plan's bare
`noRoom.keyboardTop` and the remedy from the last cover, held together by a comment ("a band on WDA or Android would
break that"); a `keyboardTop` with no cover drops the keyboard from the refusal, and the types allow it. A38b's three
review rounds were about this line. Proposal: `AppliedKeyboard` gives its `KeyboardUp`, and `noRoom` carries one. Not
ST2.

**A71. The pre-flight refuses unknown state and flow names before any device** (run; cost S; no device; golden not
affected, verify tests change).
src/run/preflight.ts only resolves credentials. An unknown state or flow is caught inside the engine after
`resolveAdapter` has bound a device; a `verify` probes discovery and binds a device for every leg and reports N `FAILED:
Unknown flow` sections where one refusal would do, and with no flows defined the message ends in an empty `known: `.
Proposal: `preflight(project, request, environment)` validates the request's names and returns the RunRequest; both
`runOnEngine` and `runVerification` call it, and the engine's top-level checks stay as invariants.

**A72. The iOS tree source owns its lifecycle and its fallback** (adapters; cost S; golden Changed 0; touches the iOS
launch path, so the owner's next Gate C covers it).
src/adapters/ios-tree-source.ts and ios.ts say the seam holds only the tree read and that swapping the backend touches
no line of IosAdapter; IosAdapter in fact words the source's start failure ("WebDriverAgent did not come up before
launching…"), un-wraps a release by `instanceof TreeSourceReleasedError` imported from wda-tree-source.ts (a class born
of an A41d review bug, 19311124), and backstops the fallback with `fellBack`. "A value only WDA types is refused with
the claim note after the fallback" lives in three places, split by when the choice was made (auto-tree-source.ts
`typeThroughWda`, ios.ts's backstop, src/interact/type-text.ts#assertTypeableOn), because the typer is an optional
`typeText?` that comes and goes. ios.ts was in 10 of the 11 A41 code commits. Proposal: `startBeforeLaunch` rejects with
its own worded error; a required `typeWide(text)` (idb refuses, WDA types, auto chooses and adds the note once; the
differential harness's recorded source refuses); `typeable` is the source's fact. Folded in: one `fallback?: {note}`
member instead of `fellBack` and `claimNote` on two interfaces (adapters #3), and the stale comments the reviewer saw
(the seam claims in ios.ts and ios-tree-source.ts; `IDB_TYPEABLE.otherPath` still sending the user to
`ios.treeSource: wda` though `auto` is the default).

### Worth exploring

**A73. One engine leg in run/** (run; S–M; at most one golden row, ensure_state, on purpose). "Run the engine, assert,
capture the final frame, add the health line and the claim note" is put together four times (run/commands.ts's
`runOnEngine`, `runEnsureState`, `runNamedFlow`, `runAsserts`; run/verify.ts's `runOne`), with different line orders and
a third assert-line format in the engine's trace. Cross-cutting leg changes had to land in both files (07790979,
2794f5e4, dfde0442, eadca61b, c2ec5b2a, 80635e6e). A `runLeg` returning `{trace, results, frame, health}` and one
`assertLine`. Pairs with A71.

**A74. One WDA come-up policy** (adapters; S; Gate C and the a41 probe's legs). `AutoTreeSource.startBeforeLaunch` and
`WdaTreeSource.startBeforeLaunch` each decide "up already, cached build, released"; the policy moved three times in four
days and the two files co-changed seven times; WdaTreeSource repeats its release wrapper five times. `comeUp(mode)` →
`'up' | 'notNow'` and one private `guarded(call)`. After A72.

**A75. geometry.ts split (UT2, unblocked since A25 and A26)** (ui-tree; M; a move; scripts/mutation/scope.json's
geometry floor splits). 1,444 lines holding rect primitives, tree screen inference, scroll clips with `Drawn`/`Cut`, and
sentence words; 125 commits, 29 importers. After A67 and A69 take the words and the screen out, what is left is the
clips going beside scroll-containers.ts.

**A76. One selector→node choice** (interact; S–M; a golden case for `within`). Three policies over `findTarget`: resolve
(zero-area filtered, a sole interactive match preferred, the caller's ambiguity policy, at most five listed),
keyboard-dismissal (a non-interactive match preferred, its own wording) and within.ts (no zero-area filter, always
refuses, every match listed). A React Native zero-area wrapper beside a list with the same id would make `within:
"id:list"` refuse what a tap resolves; not reproduced on a device.

**A77. Frame types without impossible states** (verify; S; compile-time only). `Frame.stability` and `settledOver`
allow `moving` with `settledOver: 'region'`; the `{tree}` overload of `captureFrame` returns a type that still allows
`Treeless`, and pixel-poll leans on a comment that it never is.

**A78. One error headline and the eyes' untold sentences in one place** (util, verify; XS; low value). "The first line
of an error" is written by hand about ten times; "the screenshot could not be scaled to the tree" three times in eyes.ts;
"the screenshot failed" in eyes.ts and pixel-poll.ts.

**A79. A structured outcome kind beside the reply text** (mcp, harness; M; the golden base is re-cut; low). scripts/truth/replies.ts
reads replies with about 50 regexes and had 52 commits since 2026-10-15; src/ exports word constants used only so the
harness can find them. A `structuredContent` carrying only the closed reply kind, from the same result objects. ADR 0020
and A14 judge the words on purpose, so this would replace only the kind classification. Only if replies.ts keeps
churning.

### Not worth it

- Tool descriptions as their own module: a relocation, not depth; drift is guarded by tool-surface-budget and
  tool-descriptions tests, and the repeated prose belongs to A32.
- Step-kind exhaustiveness as a module: kinds are rarely added. A `never` check in the engine's `dispatchStep` is a
  three-line cut any change there may take.
- The baseline diff out of src/verify/assert.ts: only together with A5, if ever.
- iOS constants collecting in src/adapters/types.ts (`WDA_READY_TIMEOUT_MS` beside `FOREGROUND_WAIT_MS`): two are too
  few; revisit at a third, or name the exception in the layering test.
- `labelsByLength` as an option on its own: folded into A67.
- `screenSized` meaning two things (placed.ts and standing.ts): an XS rename of standing's at most.

## Found fine

- interact: fill's ten files change one owning module per fact; scroll-rounds' `round()` coordinates its modules behind
  one interface (ST3 still open, no new evidence); stroke-plan.ts kept A38b's four commits inside it; scroll-text.ts is
  the one place scroll replies are worded; the opaque-state casts encapsulate pure state machines.
- ui-tree: the A45 dialect seam holds (no source branch outside `dialectOf`); the Scene seam holds; draw-order.ts and
  standing.ts are deep; presentation.ts has two real adapters; window-mark.ts marks a copy; `ADAPTER_SURFACE` is
  exhaustive by type. ST2, ST3, UT3 and UT5 stand as filed.
- verify: assert.ts is deep since A20 made `decided` the one policy site; pixel-poll.ts is deep apart from A68's
  workaround; the parity modules keep table and assert together on purpose; the colour region's unit divergence is
  documented as unmeasured; the eyes are two real adapters of one port; util/ passes the deletion test.
- adapters: Android is stable after A27 and A35; `WdaTreeSource` passes the deletion test beside wda.ts; claim notes
  follow ADR 0046; A4, A5, A8, A15 and IOS2 stand as decided.
- flow, mcp, run: claim notes are pinned by the `CLAIMING` test; the two front doors decide fill words and launch once;
  registry and lifecycle are deep and small; config-policy and tool-config are two halves kept apart on purpose; the
  harness imports little from src/ and side.ts's shims serve replayed old checkouts; engine.ts's size holds the last
  review's verdict.

## Order

A67 first (a privacy rule with no single home; two reviewers found it apart), with A71 beside it in its own worktree
since the two touch disjoint files. Then A68, A69, A70, A72 by rank; A72 and A74 go together and wait on the owner's
Gate C before a release. The Worth-exploring rows are analysed before any implementation.
