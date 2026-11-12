# averi — Architecture

*A free MCP server that lets coding agents verify their work on iOS Simulators and Android Emulators, including apps
that require a login step.*

This file is the current design: the layers, what each owns, and the words each uses. It is written for a reader who
is about to change the code. It is not a history. Why a rule is the way it is, and when it became so, lives in its
records (ADR 0045), and this file points at them rather than retelling them:

- **docs/adr/** — every owner decision, with its measurements and residuals, amended in place as it moves.
- **docs/plans/2026-10-30-performance-backlog.md** — every row of work (Dn, An, Tn), with its commit.
- **the code's own docs** — a module or symbol named here holds its rule, its measured device shapes and its stated
  residuals in its doc comment.
- **docs/bugs/** and **docs/architecture-reviews/** — the finding behind a rule, and the reviews that shaped a layer.
- **the long form** this file replaced (dated history inline, 301,741 bytes, ≈295 KB) — `git show
  57ba80d8:ARCHITECTURE.md`; ADR 0045 maps each of its paragraphs to the records above.

---

## 1. Problem & positioning

Coding agents can write native mobile code, but they cannot close the loop: build → install → **get past login** →
navigate → verify. Generic tools exist, but none solve the *stateful app* problem:

| Tool | Strength | Gap for us |
|---|---|---|
| [mobile-mcp](https://github.com/mobile-next/mobile-mcp) | Generic taps/screenshots via the accessibility tree, iOS+Android | No app knowledge: the agent rediscovers login every session |
| [Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp) | Agent writes/repairs Maestro YAML tests | Oriented at test suites, heavy dependency; login state still the agent's problem |
| Appium | Mature drivers | Per-project setup, slow, overkill for "verify my change" |

**Differentiator:** averi is *app-aware*. A team checks an `averi.yaml` descriptor into the repo that declares how to
reach known states (logged in, specific screens). The agent calls `ensure_state("logged_in")` instead of fumbling
through a PIN keyboard with 15 taps. Determinism, cross-platform parity and verification helpers are the product.

---

## 2. High-level architecture

```
┌────────────┐  MCP (stdio)  ┌──────────────────────────────────────┐
│ Coding     │◄─────────────►│  averi MCP server (local)            │
│ agent      │               │ ┌──────────────────────────────────┐ │
│ + skill    │               │ │ MCP layer (mcp/) — tool schemas  │ │
└────────────┘               │ └────────────────┬─────────────────┘ │
                             │ ┌────────────────▼─────────────────┐ │
                             │ │ Orchestration (run/)             │ │
                             │ │ one run across per-platform legs │ │
                             │ └────┬──────────────────┬──────────┘ │
                             │ ┌────▼─────┐   ┌────────▼──────────┐ │
                             │ │ Flow     │   │ Verification      │ │
                             │ │ Engine   │   │ Engine            │ │
                             │ │ (flow/)  │   │ (verify/)         │ │
                             │ └────┬─────┘   └────────┬──────────┘ │
                             │ ┌────▼───────┐          │            │
                             │ │ Interaction│          │            │
                             │ │ (interact/)│          │            │
                             │ └────┬───────┘          │            │
                             │ ┌────▼──────────────────▼──────────┐ │
                             │ │ UI tree (ui-tree/)               │ │
                             │ │ selectors, geometry, tap targets │ │
                             │ └────────────────┬─────────────────┘ │
                             │ ┌────────────────▼─────────────────┐ │
                             │ │ Device Adapter interface         │ │
                             │ └───┬──────────────────────┬───────┘ │
                             │ ┌───▼──────┐      ┌────────▼───────┐ │
                             │ │ Android  │      │ iOS            │ │
                             │ │ (adb +   │      │ (simctl +      │ │
                             │ │ uiauto)  │      │ idb/WDA)       │ │
                             │ └──────────┘      └────────────────┘ │
                             └──────────────────────────────────────┘
```

The arrows show the main path; a layer may import any layer below it (flow → verify for inline `assert:` steps,
verify → adapters for captures, mcp → interact/adapters for the primitive tools).

### The rule: dependencies point one way only

`mcp → run → flow → interact → verify → ui-tree → adapters`, with `util/` a leaf every layer may import and that
imports no layer. `interact/` imports `ui-tree`, `adapters` and `util` only: it sits above `verify` so that `verify`
stays reachable from both engines without knowing how an element is acted on. That is why a fact both need lives in
`ui-tree/` (the absent-in-viewport rule, `ui-tree/geometry.ts#windowTurnsScreen`, the remedy clauses), and why the
eyes' judge is handed into `interact/` from the composition roots instead of imported.

`tests/architecture/layering.test.ts` checks the order on every `npm test`, fail closed: an import against it, or a
directory of `src/` it does not name, fails naming the edge. The same test holds each layer's row of what it may import
from `adapters/`:

- every layer: `adapters/types.ts`, the interface module (the `DeviceAdapter` interface, its types and the constants
  both sides quote, such as `adapters/types.ts#FOREGROUND_WAIT_MS`);
- `mcp/`: only the composition root, `mcp/registry.ts`, imports platform modules — it chooses the adapter by platform;
- `interact/`: also `adapters/typeable.ts` (the per-adapter typing fact and its one reader, ADR 0037);
- the named exceptions, each a platform module one file needs, with its reason:
  - `interact/type-text.ts` → `adapters/input-text.ts`: Android's `input text` control-character vocabulary, worded
    by the refusal before any device call (a leaf, so `interact/` does not import the Android adapter for a sentence);
  - `flow/config.ts` and `flow/tool-config.ts` → `adapters/ios-node.ts`: the iOS tree source's kinds (pure; the config
    chooses by platform);
  - `verify/ocr.ts` → `adapters/exec.ts`: the host's OCR recognizer is a host process, not a device command;
  - `verify/shot.ts` → `adapters/png-encode.ts`: a raw capture encoded on the host (the codec split, backlog A5).

One platform fact sits above the adapters on purpose: the stroke pace `interact/stroke-plan.ts#PACED`, an
idb-measured constant that `interact/scroll-rounds.ts#strokeKind` picks by the tree's `flatList` mark (ADR 0018
Decision 4; backlog A4 tracks moving it onto the adapter).

The rule earned its keep: the platform layer once imported the selector layer (for a `tapElement` with no platform
code in it), and `flow/config.ts` had become the home of vocabulary neither flow nor config owns. Both inversions were
invisible until the arrows were drawn.

Everything runs locally on the dev machine; nothing talks to the cloud.

### The layers

Each layer below gives its job, its modules and its vocabulary, then the ADRs that hold its decisions. "The one owner
of X" means: nothing else in `src/` decides X, and a change to X starts there.

#### Device Adapter (`adapters/`)

The only layer that knows platform commands: one interface, `adapters/types.ts#DeviceAdapter`, two implementations
(§3). The layers above run no platform command; `verify/` and `run/verify.ts` branch on the platform only where a check
differs per platform, and their words may name a platform when the fact's kind says so.

`adapters/types.ts` also holds what every layer shares about a tree: `UiNode` (§3), `Rect` and the rect primitives an
adapter needs and may not import from above (`rectArea`, `sameRect`, `rectsOverlap`, `usableSize`, `Point`, `Stroke`,
re-exported by `ui-tree/geometry.ts`), the one pre-order walk `adapters/types.ts#everyNode`, `KEYBOARD_ROLE`,
`STRUCTURAL_ROLES`, `PresentationKind`, and the ports wired at the composition root (`DrawnOverStrip`).

Vocabulary: **adapter** — a `DeviceAdapter` bound to one device (serial or UDID, a constructor invariant);
**tree source** — where iOS reads its tree, idb or WebDriverAgent (`IosTreeSource`); **dialect** — what a source's
listing means (`flatList`, `unclippedFrames`, `boundsCutAtScreen`, …: marks the parser puts on the root);
**capability** — an optional member present only where the platform has the fact (`keyboard?`, `dragSpeed?`,
`treeReadSettles?`, `settleCadenceMs?`, `capture?`); **`AppHolder`** — what holds the app after a launch or link
(`alert`, `chooser`, `unknown`, `none`); **`DeviceScreen`** — the device's raw size with its status band, before a tree
orients it.

#### UI tree (`ui-tree/`)

The normalized tree and everything asked OF it. Knows no platform command and no averi.yaml. Its modules, by
question:

- **Finding** — `selectors.ts` (the selector grammar, §3), `element-spec.ts` (the structured `ElementSpec`, matched by
  the grammar's own matcher), `verdict.ts` (an element question against one tree: `yes` / `no` / `unknown`, `unknown`
  only on a bare tree), `bare-tree.ts` (`isBareTree`: does the tree hold anything a user could read or act on;
  `treeShape` names one that does not), `miss.ts` (`missOf`: why a target is not in the tree — the one decision behind
  every not-found reply), `masked-value.ts` (mask characters).
- **Reading and waiting** — `read-tree.ts`: the read seam (`readTreeOrMiss`, `readTreeOrThrow`; a failure no wait cures
  is `PersistentReadError`, thrown at once, ADR 0036) and `pollTree`, the one owner of the deadline loop (its pause
  counts the read, ADR 0029; a `PollObserver` is told each fresh read's timing); `read-handoff.ts` (`ReadHandOff`: the
  last read handed to the next poll only as a first sample or a positive verdict, ADR 0030).
- **Geometry** — `geometry.ts`: viewport predicates, rect arithmetic, and `clipsOf` (each node's clipping ancestors,
  slivers, drawn frame, scroll axes, one walk per question); `scroll-containers.ts` (a node `clips` and/or `scrolls`,
  `clips ⇒ scrolls`); `sides.ts` (a rect's sides and the direction that brings one back); `later-edges.ts` (the one
  classification of Compose's cut at a later node, `LaterEdge`).
- **Draw order** — `draw-order.ts`: what a tree says is drawn on top of what. One pre-order walk read as paint order,
  and `exposure(node, within)`: a target's covers, what share shows, its largest uncovered piece and where a tap goes.
  What draws is ONE table, `draw-order.ts#NOT_DRAWN`, a named row per kind of node judged to draw nothing, each with its
  two columns (`drawnOver`, `target`) and the device tree it was measured on. `placed.ts` (where a node lies in the
  walk, and the frame predicates both draw order and presentation ask), `cover.ts` (`Cover`: one record per node drawn
  over a target, with its order — drawn, untold, seen over, overlaid — and words), `reading-order.ts` (what a listing
  in reading order says of a target's order, ADR 0015), `seen-order.ts` (the order the eyes saw, an input of the pure
  draw order, never a dependency).
- **Presentation** — `presentation.ts` (`presentationOf`): which layer is presented over a target or a point, and on
  what evidence — the source's marks where it judged them (`byMarks`), else the shape fallback (`byShape`), ADR 0018;
  `window-mark.ts` (what Android's window manager says of an unmarked root, asked on a miss only).
- **Standing** — `standing.ts`: the one answer to "can this target be used where it stands?", shared by the tap,
  `scroll_until`'s stop and the pixel assert, over a tree's scene (`sceneOf`: draw order and clip facts, derived once).
  Its order per purpose is its contract, `ui-tree/standing.ts#Scene` (ADR 0005, ADR 0010). A node not reachable gets
  one `Remedy` (`presented`, `unordered`, `keyboard`, `fixed`, `pinned`, `stuck`, `scroll`) with ONE precedence, a
  presented screen first. `standing.ts` decides and words nothing. `usable-screen.ts` (`UsableScreen`: the one screen
  every judgement reads and the box a swipe strokes in), `system-bar.ts` (each system bar's name, band and words),
  `remedy-text.ts` (the remedy clauses more than one verb quotes, `presentedRemedy`).
- **One look** — `look.ts` (`Look`, built by `lookAt`): one tree read as every verb judges it — its scene, its keyboard
  reading and keyboard position — handed whole to the verbs, so none derives a scene of its own. The screen is not a
  look's, by decision (`look.ts#Look`'s doc says why).
- **The keyboard, read** — `soft-keyboard.ts` (what the tree says: `keyboardInTree`, never `hidden`; idb's band by
  shape, `flatListKeyboardBand`, ADR 0006, ADR 0007), `keyboard-cover.ts` (`readKeyboard`: THE one reading — the
  adapter's oracle when it has one, else the tree; composes the oracle's calls in one order, owns the input method's
  veto), `keyboard-position.ts` (`KeyboardPosition`: where the keyboard lies on one look, its line merged once).
- **The eyes** — `eyes.ts`: the questions a screenshot answers where the tree cannot (`Eyes.fully`, `Eyes.order`, the
  margin text's `ClearPair`) and `judgedWithOrder`, the one judge-ask-judge cycle. The judge is verify's.

Vocabulary: **standing** — where a node stands for what a verb means to do with it; **`Standing`** /
**`PixelStanding`** — that answer, and, not reachable, its **`Remedy`**; **`Purpose`** — `stop`, `fully`, `tap`,
`pixel`; **`UsableScreen`** — the screen every judgement and gesture reads; **`Scene`** — a tree's draw order and clip
facts; **`Look`** — one read as every verb judges it; **cover** — a node drawn over a target (`Cover`); **presented
layer** — a screen, alert, sheet or popover over another, by the source's mark or by shape; **cut** / **sliver** — a
target clipped by its scroll container, to under the tap minimum; **`KeyboardLine`** — the top edge nothing may be
aimed or stroked under, `{ y, witnessed }`; **`KeyboardPosition`** — that line and the keyboard's own UI on one look;
**system bar** — the status bar (top) or navigation bar (bottom), off the usable screen; **bare** — a tree holding
nothing a user could read or act on; **verdict** — `yes` / `no` / `unknown`.

Decisions: ADR 0001–0019 (chrome, slack, cover exemptions, idb's flat list, cut before cover, idb's keyboard band and
keys, status and navigation bands, the pixel assert's keyboard and residuals, slivers, a text input and its label,
reading-order breaks, the dismissal picker, the keyboard's own UI, presented layers, WDA's hidden subtrees), 0024
(the eyes' order question), 0026 (a margin text), 0029, 0030, 0036 (reads), 0042 (disabled nodes).

#### Interaction (`interact/`)

What it takes to ACT on an element, and how an action's outcome is said, written once for the flow engine's steps and
the MCP tools. Its modules, by verb:

- **Resolve** — `resolve.ts`: the one resolution policy (zero-area nodes are never targets; a sole interactive match
  wins with a note; `resolveSettled`, the rect-stable wait, at the adapter's settle cadence, ADR 0040; the absence rule
  and its found-but-refused counterpart). Its errors say which way a wait failed: never appeared, or never held still.
- **Tap** — `tap.ts` (what a tap needs of the device), `tap-judgement.ts` (`judgeTap`: one judgement per look over the
  tap's standing — on screen, cut, cover, keyboard — and the refusals beside it), `target-text.ts` and
  `touch-remedy.ts` (`touchRemedyText`: the one sentence of a `cut` or `covered` remedy the tap and `scroll_until`
  share).
- **The keyboard, acted on** — `keyboard.ts` (`resolveClearOfKeyboard`, the guard every tap on a resolved node goes
  through, and the post-fill dismissal, written once over the model seam; `keyboardModel` the one switch),
  `keyboard-model.ts` (the seam), `keyboard-window.ts` (the window model, Android: `back`, witness-vetoed),
  `keyboard-in-tree.ts` and `keyboard-dismissal.ts` (the in-tree model, iOS: configured dismissals as ordered,
  named strategies). §8 has the guard's guarantees.
- **Fill** — `fill.ts` (`fillField` orchestrates: focus tap, clear, type, read back; it judges no reading),
  `fill-clear.ts` (`clearStep`, the clear as one pure reducer), `fill-type.ts` (`typeAndConfirm`: when typed text has
  landed and what is typed again, ADR 0023), `fill-landing.ts` (`readingOf`: did a reading land — exactly, reformatted,
  as a placeholder — and what tail it proves dropped, ADR 0034), `fill-reformat.ts` (a field's own separators, a pure
  leaf), `fill-refetch.ts` (every read of the field after the focus tap, ADR 0028), `fill-facts.ts` (what a fill
  measured, a leaf), `fill-verdict.ts` (`judgeFill`: what the facts mean, as codes), `fill-text.ts` (every sentence, two
  renderers side by side: `fillReply` for the MCP reply, `fillStepText` for the flow line). Judge emits codes, renderer
  owns the sentences, so a new code without wording does not compile and the two media cannot drift.
- **Type** — `type-text.ts` (which text averi types, refused before any device call: no C0 control character; the
  adapter's `typeable`, ADR 0037).
- **Scroll** — `scroll.ts` drives `scroll_until`; its rules are pure: `scroll-read.ts` (what ONE read means),
  `scroll-rounds.ts` (`round(state, seen) → { state, step }`: what a read means ACROSS reads, the one owner of every
  rule that compares reads), `course.ts` (which way and how far the next stroke goes, ADR 0021), `stroke-plan.ts`
  (which scroll view, which box, which points; on idb's flat list, before the motion shows a region, a sideways stroke
  goes over the target's own row, ADR 0010's A38b amendment), `motion-ledger.ts` (every "did it move"),
  `motion-shown.ts` (the scroll view the motion shows on idb's flat list), `flush-check.ts` (the `fully: true` stop's
  flush probe, ADR 0013),
  `margin-memo.ts` (ADR 0026), `aim-floor.ts` and `unfit-axis.ts` (proofs from the call's own evidence, D68, D59),
  `within.ts` (the scroll view the caller names, D78), `scroll-text.ts` (every sentence: `describeScrollResult`,
  `scrollFailure`). `swipe.ts`: a direction over the device box, `swipe.ts#screenBox`. Its orientation read is the
  one reader of the read seam that opts out of its throw: a failure no wait cures loses only the witness, the swipe goes
  over the device box and its note quotes the failure (ADR 0036).
- **What holds the app** — `app-holder-text.ts` (A10): the words over the adapters' `AppHolder`.

Vocabulary: **resolve** / **settle** — find a target / see it at the same rect twice; **guard** — the keyboard check
every tap goes through; **window model** / **in-tree model** — the keyboard as its own window (Android) / as nodes of
the tree (iOS); **dismissal** — hiding the keyboard after a fill; **landed** / **reformatted** / **dropped tail** — what
a read-back proves; **round** — one read of `scroll_until` and what it decides; **course** — the run's direction and
reach; **stop** — `scroll_until` ending on a target it judged visible (plain) or wholly visible (`fully`); **turn** —
reversing at a proven end.

Decisions: ADR 0013, 0016, 0017, 0021, 0022, 0023, 0026, 0027, 0028, 0034, 0037, 0040, and ADR 0010's D78 amendment
(`within`).

#### Verification Engine (`verify/`)

Asserts, the layout contract, rect/colour/text parity, OCR and screenshot diffing.

- **Frames** — `capture.ts`: the one owner of a trustworthy frame — SETTLED (two identical consecutive captures; the
  one exception by design is the eyes' single capture after a settled stop, ADR 0013), the png scale, the crop, and the
  baseline's confirmation window (`captureBaselineFrame`). `scale.ts`: the one owner of trusting a screen width
  (`pngScale`, `windowWidth`). `shot.ts` (a capture as pixels or PNG, ADR 0035), `png.ts` (the one decoder).
- **Asserts** — `assert.ts` (the `Verifier`; three tiers, cheapest first), `element-assert.ts` (exists / absent / text
  / match / error, shared with averi.yaml's inline `assert:`), `pixel-poll.ts` (`pollPixels`: the colour and OCR
  asserts' one round, budget and deadline), `pixel-text.ts` (the pixel verb's words), `poll-verdict.ts`,
  `fail-closed.ts` (the one sentence of a check not done: never a pass), `text-hint.ts` (why an exact text missed while
  on screen).
- **OCR** — `ocr.ts` (anchored OCR: what the user sees inside an element's rect, macOS Vision), `ocr-fold.ts`
  (`readingDifference`: the one notion of a recognizer difference, ADR 0025).
- **Parity** — `layout-contract.ts` (one contract feeds every dimension), `rect-parity.ts`, `color-parity.ts`
  (`ciede2000.ts`), `text-parity.ts`, `contribution.ts` (what one leg contributes), `table.ts` (column mechanics only;
  deliberately not a reporting framework).
- **The eyes' judge** — `eyes.ts` (`eyesOn`: one screenshot per question, judged; handed into the verbs at the
  composition roots, required by their options).

Vocabulary: **settled** — two identical consecutive captures; **scale** — tree units to PNG pixels; **fail closed** —
a check not done reads as a failure, never a pass; **baseline** — a stored screenshot a diff compares against;
**contract** — a screen's anchors in Figma-frame units; **ΔE00** — CIEDE2000 colour difference.

Decisions: ADR 0001–0003, 0010, 0012, 0024, 0025, 0035; docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md
(the window, not the device, is the rect denominator).

#### Flow Engine (`flow/`)

Interprets `averi.yaml` (§4) and keeps a model of where the app is. Its `tap:`/`fill:`/`scroll_until:`/`swipe:` steps
are one-line callers of `interact/`; it converts the YAML vocabulary before calling and owns the trace wording (the fill
line excepted: `interact/fill-text.ts`).

- `engine.ts` — `FlowEngine.run(cfg, adapter, opts, { state?, flow? })`, the single entry: one tool call is one run,
  with one trace, one environment line, one `FlowError` guard and one recovery budget. The constructor is private, so
  the rule is the shape. A failing run carries its trace (`FlowError`); `formatTrace` is the one rendering.
- `config.ts` — the schema, its types and the pure walks (references, `detect` cycles, the container and destructive
  rules, `stepsAreDestructive`, `appIdOf`); no I/O. `load.ts` — everything that touches the file system;
  `loadProjectConfig` is the one place `flow/` reads `process.env`, and nothing in `src/` writes it.
  `credentials.ts` — `$name`/`${VAR}` expansion, frozen per run; a secret is never empty.
- `condition.ts` — everything asked of a `Condition` (`evaluateCondition`, three-valued over `ui-tree/verdict.ts`).
- `launch.ts` — the ONE launch (`launchApp`), the flow's `launch:` step and the `launch_app` tool alike;
  `EngineSession` counts wipes per server; `launchedLine` the one spelling.
- `tool-config.ts` — the MCP tools' config policy carried out (`loadForCall`: at most one read per call, handed down
  as a value; `iosToolSettings`).
- `hold-tracker.ts`, `wipes-ahead.ts` — the reach ladder's second look before a cheap rung (ADR 0033).

Vocabulary: **state** — a named screen with a `detect`; **flow** — named steps; **reach ladder** — a state's `reach:`
flows, cheapest first; **rung** — one of them; **destructive** — a flow that wipes app data; **recovery pass** — the
run's one re-run of the earlier rungs; **trace** — the run's lines (`✓`, `⚠`, `✗`, `↻`); **environment** — a named
credential overlay; **session** — the server's wipe count.

Decisions: ADR 0033; §4's design points.

#### Orchestration (`run/`)

Composes the two engines; its own layer because it needs BOTH and neither may depend on the other.

- `verify.ts` — the `verify` tool: per-platform legs run concurrently, sections and images always android-then-ios
  (`mcp/platforms.ts#normalizePlatforms`), error containment, the parity tables (`paritySection`); `runVerification`
  reads and validates the contract before resolving any adapter.
- `commands.ts` — the single-platform compositions: one `ensure_state`, `run_flow` or `assert` call, each taking a
  resolved adapter (or a resolver) and the config its handler read, never a path.
- `preflight.ts` — `refuseUnknownEnvironment`, before any adapter is resolved.
- `app-health.ts` (`appHealth`, the `appAlive:` line, §8), `log-excerpt.ts` (`get_logs`' grep and tail),
  `run-reply.ts` (the final frame and the asserts' verdict) — leaves of the replies (A29).

Vocabulary: **leg** — one platform's part of a `verify` run; **parity table** — a per-anchor comparison across legs
and against the contract.

#### MCP layer (`mcp/`)

Thin: tool schemas, descriptions and one-line delegations. No logic.

- `tools.ts` — every tool's schema, description and handler, registered on a server it builds but never connects
  (`createAveriServer`), so tests run it over the SDK's in-memory transport. A handler makes one call,
  `mcp/tools.ts#serve`, which reads the config under its policy and hands back the config, the device
  (`deviceFor`) and the eyes together (A30), then delegates — to an adapter method, `interact/`, `flow/launch.ts` or
  `run/` — and returns the callee's words or `tool-text.ts`'s.
- `config-policy.ts` — `TOOL_CONFIG`, which tool reads what of averi.yaml (§5).
- `registry.ts` — the composition root: one adapter per device, chosen by platform and tree source, with device
  discovery injected beside the factory (`RegistryDeps`, both or neither).
- `server.ts` — the stdio entry only; `lifecycle.ts` — shutdown within a budget (§3); `platforms.ts` — leg order.

A number a description quotes as a default is built from the constant that owns it, never restated as a literal;
`tests/mcp/tool-descriptions.test.ts` pins each. Their size is held to the budget
`tests/mcp/tool-surface-budget.test.ts` pins.

Vocabulary: **tool** — one MCP entry, its schema, description and handler; **handler** — the one call to `serve` and
one delegation; **policy** — what a tool reads of averi.yaml (`none`, `optional`, `required`, §5); **composition
root** — where adapters are chosen by platform (`registry.ts`) and the eyes handed in (`tools.ts`); **registry** —
one cached adapter per device; **`configPath`** — where the call's averi.yaml is.

#### util (`util/`)

Leaves every layer may reach: `duration.ts` (`durationSchema`, the one parser of a timeout, refused at load),
`count.ts`, `error-message.ts`, `regex.ts` (a regex field validated where it is parsed), `sleep.ts` (one owner, so
"waits, not sleeps" stays a rule), `version.ts` (the package version, read at runtime).


Vocabulary: **duration** — a timeout as written (`"15s"`) or as a number of ms, parsed by one schema;
**count** — a number with its noun (`1 swipe`, `3 swipes`).

---

## 3. Device Adapter layer (raw adb + simctl/idb)

The interface, in short (`adapters/types.ts#DeviceAdapter` is the contract; each member's doc holds its platform
facts):

```
interface DeviceAdapter {             // bound to ONE device: the constructor requires the serial / UDID
    readonly platform: 'android' | 'ios'
    install(appPath)
    launch(bundleId, opts?: {clearState?, activity?, intent?}): AppHolder   // activity/intent: Android only
    terminate(bundleId)
    openDeepLink(url): AppHolder
    screenshot(): Png
    capture?(): ScreenCapture         // Android's raw pixels (ADR 0035)
    uiTree(opts?: {settle?}): UiNode  // normalized; `settle`: one re-read of an unreadable first read
    viewport(opts?: {fresh?}): DeviceScreen   // memoized (adapters/viewport-memo.ts); `fresh` re-reads
    tap(x, y), longPress, swipe(from, to, durationMs?), typeText, clearText(count), pressKey(back|home|enter)
    typeable                          // which characters typeText can type (ADR 0037)
    keyboard?: KeyboardOracle         // Android: state(), witness(), touchable() — never throw
    keyboardAdvice?: string           // iOS: why this adapter cannot hide a keyboard, quoted verbatim
    dragSpeed?, treeReadSettles?, settleCadenceMs?, typingDelivery?   // measured platform facts
    logs(since): string[]
    isAppRunning(appId): boolean      // the appAlive line (§8)
    dispose?()                        // the adapter's hop of the shutdown chain
}
```

Directions are not on the interface: a swipe's direction is `interact/swipe.ts`'s, over the device box. Nor is
selector tapping: `interact/tap.ts` resolves the target and calls `tap(x, y)`. Nor is device discovery, a question
about the platform: `adapters/discovery.ts#DeviceDiscovery` (`list`, `check`), which the registry asks on every `get()`
— on iOS `check` first reads the simulator's own record (`adapters/discovery.ts#iosBootedFromDevicePlist`, ADR 0031).
An `unauthorized` or `offline` Android device is listed and never picked; `adapters/discovery.ts#androidUnusable`
words why.

A failed host command's words have one seam, `adapters/failure-text.ts#commandFailureText` (ADR 0043): every tool,
error and trace line says the same, host paths stripped; the error's fields keep every byte for detectors.

**Android** — pure `adb`:

- `android.ts` is the adapter (the adb calls, their bounds and memos). What it reads is parsed in pure modules beside
  it: `android-tree-dialect.ts` (the uiautomator XML as a normalized tree, its roles, axes and root marks, the
  presented-window recognizers), `android-wm.ts` (the window manager's and input method's dumps: IME insets, status and
  navigation bands, touchable region, `mInputShown`, the focused window), `android-bounds.ts` (`[l,t][r,b]`),
  `android-accessibility-order.ts` (AOSP's accessibility order of a ViewGroup's children, ADR 0015).
- What the device's shell receives has one owner, `adapters/adb-shell.ts`: every word quoted (`shellQuote`), `exec-out`
  left to the adb client, a raw line only by name. Whether a start started anything:
  `adapters/android-start.ts#runStart`.
  An "Open with" chooser in front: `android-chooser.ts` (ADR 0041).
- Capture: raw RGBA gzipped on the device, PNG encoded on the host only where one leaves the process (ADR 0035);
  `screenshot-bytes.ts` judges any capture's bytes before anyone above sees them.
- Tree: `uiautomator dump`, which waits for the screen at rest (`treeReadSettles`).
- Input: `adb shell input`; `input text` types printable ASCII only (`typeable`), and `input-text.ts` says what it does
  with a control character.

**iOS** — `xcrun simctl` plus idb, behind one more seam:

- `ios.ts` is the adapter: install, launch, terminate and links through simctl (`xcode-env.ts#simctl`, under the
  DEVELOPER_DIR probe); input and screenshots through idb. Every launch and link first re-enables the simulator's
  accessibility (docs/bugs/2026-10-07-one-wda-session-makes-idb-stick-until-reboot.md). After a launch it waits until
  the tree is the launched app's (`ios-foreground.ts`); an "Open in …?" alert in front is `ios-system-alert.ts`'s; a
  link's scheme is `ios-url-schemes.ts`'s; liveness is the host's process list (`ios-liveness.ts`, ADR 0039); the
  status band is `ios-status-band.ts`'s.
- idb calls all go through `adapters/idb.ts#runIdb`; a persistent helper per adapter (`idb-helper.ts`) runs the CLI
  in-process (ADR 0032). What iOS types, and through which path, is `ios-typing.ts`'s (ADR 0037).
- **Tree sources** — `adapters/ios-tree-source.ts#IosTreeSource` (`read()`, `applicationLabel()`, `dispose()`), chosen
  by `app.ios.treeSource` and injected at construction; node normalization is one pure module, `ios-node.ts`
  (`normalizeIosElement`; the default kind, `DEFAULT_IOS_TREE_SOURCE`). Two adapters:
  - **idb** (`IdbTreeSource`, the default): `idb ui describe-all`, a FLAT list under a synthetic root. An empty or
    area-less list is a read error (`IdbEmptyTreeError`), never a tree that reads "absent"; a wedged service is
    `PersistentReadError` (ADR 0036). Settle cadence 300 ms (`IDB_SETTLE_CADENCE_MS`, ADR 0040).
  - **WebDriverAgent** (`WdaTreeSource`, opt-in `treeSource: wda`): the NESTED XCUIElement tree, for the React Native
    and SwiftUI container ids idb drops. `wda.ts` owns the server's lifecycle (build once per Xcode, from the pinned
    `appium-webdriveragent` optional dependency), `wda-source.ts` parses `/source` and marks the keyboard band, hidden
    subtrees (ADR 0019) and presented layers (ADR 0018). Plan: docs/plans/ios-wda-tree-source.md.
- The iOS exception to "adapters know no averi.yaml": the tree source is shaped by a config key, but the kind arrives
  as a value (`flow/tool-config.ts#iosToolSettings` → `registry.get` → the factory); the adapter never reads the file.
  What does cross is words: a refusal may name the config key that is the reader's next move (`keyboardAdvice` names
  `app.ios.keyboardDismiss`, `IdbEmptyTreeError` names `treeSource: wda`), as Android's launch refusals name theirs —
  a typed error translated above the seam would need a translation site per caller (ADR 0032, A32 note).
- **Shutdown** runs down the ownership chain, never across it: WDA child ← `WdaServer` ← `WdaTreeSource` ←
  `IosAdapter` ← `AdapterRegistry` ← `mcp/lifecycle.ts`, which handles SIGTERM/SIGINT/SIGHUP within a 1.5 s budget.

**Normalized UI tree** — the key abstraction, identical on both platforms: `{role, label, identifier, value, rect,
children}` plus the optional source marks `adapters/types.ts#UiNode` documents (`error`, `ofKeyboard`, `hidden`,
`secure`, `presentation`, `readingOrder`, …) and the root's dialect marks.

**Selectors** resolve against it on either OS (`ui-tree/selectors.ts`): space-separated conditions, all must match —
`id:login_pin_field`, `text:"Continue"`, `role:button label~"Pay.*"`. Fields `id`, `text`, `role`, `label`, `value`;
`:` exact, `~` an unanchored regex; `text` matches label or value.

---

## 4. Flow descriptors (`averi.yaml`)

Checked into the app repo. Describes app states and how to reach them. Every path in it — the build paths, the sibling
`.env.averi`, the `.averi/baselines/` directory — resolves relative to the descriptor's own location. Example for a
PIN-login banking app:

```yaml
app:
  android: { package: md.victoriabank.myvb.dev, apk: app/build/outputs/apk/dev/debug/app-dev-debug.apk }
  ios:
    bundleId: md.victoriabank.myvb.dev
    app: build/Debug-iphonesimulator/MyVB.app
    # treeSource: wda                 # optional: RN / SwiftUI container ids (§3); keyboardDismiss needs it
    keyboardDismiss:                  # optional, ordered (§8): how to hide the soft keyboard when it covers a tap target —
      - tap: { id: login_title }      #   a NON-interactive element (a title, a label) whose tap hides it without submitting,
      - accessory: true               #   or the input-accessory toolbar's trailing button (the "Done" above a number pad)

credentials:              # values come from the environment (or .env.averi), never from YAML
  username: ${AVERI_USER}
  password: ${AVERI_PASSWORD}
  pin:      ${AVERI_PIN}
# Real env vars take precedence over a gitignored `.env.averi` next to averi.yaml.
# The file is re-read on every call that resolves credentials and never written into process.env.

environments:             # optional: per-backend credential overrides
  dev:
    credentials:
      username: ${AVERI_DEV_USER}
  staging:
    credentials:
      username: ${AVERI_STAGING_USER}
# Layered ON TOP of `credentials:` per key. Selected by the tool's `environment`
# argument, else $AVERI_ENV, else `defaultEnvironment:`; resolved once per run, so
# one run never mixes two environments; an unknown name is refused before any
# device is touched. The active environment is the first trace line.

states:
  logged_in:
    detect:                       # how to recognize we're already there
      any:
        - element: { id: dashboard_root }
        - element: { text: "Accounts" }
    reach: [login]                # flows that get us there, cheapest first

flows:
  login:
    steps:
      - launch: { clearState: false }
      - branch:
          - when: { element: { id: pin_keyboard } }     # returning user → PIN
            do:
              # keypad matches per-digit keys by resource-id or, for keypads
              # without ids (common in Compose), by visible text:
              #   keypad: { text_pattern: "{digit}" }
              - type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } }
          - when: { element: { id: username_field } }   # fresh install → full login
            do:
              - tap:  { id: username_field }
              - type: { value: $username }
              - tap:  { id: password_field }
              - type: { value: $password }
              - tap:  { text: "Log in" }
              - wait: { element: { id: pin_setup_screen }, timeout: 15s }
              - type_pin: { value: $pin, twice: true }   # set + confirm
      - optional:                                        # dismissable interstitials
          - tap: { text: "Not now" }        # biometrics prompt
          - tap: { id: promo_close }        # marketing popup
      - wait: { state: logged_in, timeout: 20s }

  goto_transfers:
    requires: logged_in
    steps:
      - tap:  { id: tab_payments }
      - tap:  { text: "New transfer" }
      - wait: { element: { id: transfer_form } }
```

The example is not the whole schema — that is `flow/config.ts` (its `configSchema`, typed as `AveriConfig`), and
`skill/references/averi-yaml.md` is the agent-facing reference.

Design points (each rule's owner holds its cases):

- **State detection before action.** `ensure_state` checks `detect` first; login runs only when needed, so a reinstall
  that wiped the session is handled, and the call is idempotent.
- **`reach:` is an escalation ladder, not a script.** `detect` is re-checked after each rung and the rest skipped once
  it holds; a rung that throws escalates like one that completes without reaching the state.
- **…and it gets one pass backwards.** After a ladder fails, the non-destructive rungs before the last run once more
  per call (`↻ recovery`), because the last rung's aftermath can bring a screen an earlier rung exists to clear
  (docs/bugs/2026-08-26-ensure-state-no-recovery-pass.md,
  docs/bugs/2026-08-26-recovery-pass-skips-throwing-last-rung.md).
- **…and it never wipes blind.** A destructive rung whose preceding probe never read a RENDERED tree is refused: a probe
  is `unknown` when every read failed and `bare` when every tree was bare (`ui-tree/bare-tree.ts#isBareTree`). A
  probe that may end early on a held "no" does so only with no wipe ahead (ADR 0033).
- **…and a bare tree decides no condition.** `flow/condition.ts#evaluateCondition` answers `yes`, `no` or `unknown`;
  `unknown` never satisfies or refutes a `detect`, `wait:` or `when:`.
- **…and a loop through `requires:` fails its rung, never the call's chance to escalate.** A state re-entered while its
  own ensure is on the stack throws `ReentryError` naming the loop; only a `detect` cycle is a config error.
- **Failures carry their trace** — the whole run's (`FlowError`), so a failing flow shows the state's lines and any
  wipe before its own.
- **`branch` + `optional`** absorb the two realities of real apps: different login paths and random interstitials. An
  `optional:` step never fails the flow on what the screen did, but a config refusal (an empty or undeclared credential,
  an unset `${VAR}`) fails it even there, and a present-but-refused element stops rather than escalating (the owner's
  decision; `flow/engine.ts`'s `OptionalNotSkipped` doc holds it).
- **Secrets** are referenced (`$name` → `credentials:` → `${VAR}`), never stored, and redacted from traces, errors and
  replies: the agent never sees the PIN, it calls the flow. Keychain URIs are not implemented (§10).
- Platform overrides per step where needed: `ios: { tap: {...} }`. The same file documents the app's navigation for
  humans.

---

## 5. MCP tool surface

Small and high-level — agents do better with fewer, smarter tools. Each tool's description is its contract;
`skill/references/tools.md` has every refusal case.

| Tool | Purpose |
|---|---|
| `list_devices()` / `select_device(platform, device)` | Devices with boot state; pin the platform's target. A pinned device going offline is an error, never a silent fallback |
| `install_app(platform, path?)` | Install, `averi.yaml`'s build by default |
| `launch_app(platform, appId, clearState?, activity?, intent?)` | Launch; `clearState` wipes first and counts in the session's wipe count. `activity`/`intent` Android only |
| `terminate_app(platform, appId)` / `open_deep_link(platform, url)` | Force-stop; open a link, saying what holds the app when it is not in front (`AppHolder`) |
| `ensure_state(state, platform, environment?)` | The killer tool: detect → reach ladder → confirm. Trace and final screenshot |
| `run_flow(flow, platform, environment?)` | A named flow, honouring its `requires:`. Trace |
| `screenshot(platform)` | A settled PNG as MCP image content |
| `ui_snapshot(platform, filter?)` | The normalized tree as JSON; an empty filter result says whether the tree is bare |
| `tap` / `swipe` / `type_text` / `press_key` | Low-level escape hatches: a selector or coordinates; a direction or four coordinates |
| `scroll_until(platform, selector, direction?, maxSwipes?, fully?, timeoutMs?, within?)` | Swipe until the element is in the viewport; `fully: true` for wholly inside; `within` names the scroll view |
| `assert(platform, asserts)` | Element, rect, colour, OCR and baseline asserts, cheapest first |
| `verify(platforms?, state?, flow?, asserts?, contract?, environment?)` | The same sequence on both platforms, legs concurrent; parity tables from a layout contract |
| `get_logs(platform, sinceSeconds?, grep?, maxLines?)` | Crash/exception scan with a header of what the grep matched |

Every tool that resolves a device takes `configPath` (default `./averi.yaml`), so on iOS each gets the project's tree
source. `record_flow` is not a tool — a v2 idea (§9).

### Which tools read averi.yaml

Declared once per tool in `mcp/config-policy.ts#TOOL_CONFIG`, carried out by `flow/tool-config.ts#loadForCall`: at
most one read of averi.yaml (and of `.env.averi`, where marked) per call, handed down as a value.

| Tool | Android | iOS | `.env.averi` |
|---|---|---|---|
| `install_app` | required without `path`; none with one | required without `path`; optional (tree source) with one | no |
| `launch_app` | optional — only with neither `activity` nor `intent` (the `app.android.activity` fallback) | optional (tree source) | no |
| `ui_snapshot`, `tap`, `type_text`, `scroll_until`, `swipe` | none | optional (tree source; dismissals for `tap`/`type_text`) | no |
| `terminate_app`, `open_deep_link`, `screenshot`, `press_key`, `get_logs` | none | optional (tree source) | no |
| `assert` | optional (health line) | optional (tree source, health line) | no |
| `ensure_state`, `run_flow`, `verify` | required | required | yes |
| `list_devices`, `select_device` | none | none | no |

- **none** — the file is not read; a broken one is not the call's business.
- **optional** — a MISSING file is no config and the call proceeds on the defaults.
- **required** — a missing file fails the call.
- Under **optional** and **required** alike, a present-but-INVALID file fails the call, naming the file, before any
  device is bound. The platforms differ only where the tool uses different values, never in how a broken file is
  judged.

Verification philosophy: three tiers, cheapest first — (1) tree asserts (fast, deterministic), (2) a screenshot to the
agent's own vision (semantic judgement), (3) pixel checks against a baseline or contract. The skill teaches which.

---

## 6. Distribution & privacy

- averi is **free**: no licence key, no accounts, no feature gating.
- Distribution: `npx -y averi` (or `npm i -g averi`; from a clone, `npx tsx`). The package ships `dist`, `skill`,
  SETUP.md, README.md and LICENSE; this file stays in the repository for contributors (ADR 0045).
- Zero telemetry. Screenshots, trees and secrets never leave the machine.

---

## 7. The skill

Ships with the package (`skill/`; SETUP.md copies it into the app repo). It teaches the workflow, not the plumbing, and
only what the tool descriptions do not already say:

1. **SKILL.md** (every session): the golden path (build → `install_app` → `ensure_state` → navigate → cheapest assert →
   `verify` on both platforms), short rules, and the reach ladder: cheap rungs first, destructive last.
2. **references/averi-yaml.md** (writing yaml): every key and step kind.
3. **references/tools.md** (a surprising reply): each tool's full behaviour, so the descriptions can stay short; the
   shared vocabulary is said once, in the server's `instructions`.
4. **references/troubleshooting.md** (a `⚠`/`✗` line it does not understand): by symptom.

---

## 8. Reliability details that make or break this

- **Waits, not sleeps.** Every action polls the tree for its postcondition (`ui-tree/read-tree.ts#pollTree`, the one
  loop; its callers own only their words), and every frame measured or returned is settled first
  (`verify/capture.ts`). The one exception by design: `scroll_until`'s eyes measure one capture taken after the stop's
  settled tree reads (ADR 0013); a bar still animating then is the stated residual. A read failure no wait cures is
  thrown at once (ADR 0036); a timeout counts the rounds that read a tree, so "never matched" and "never read" differ.
- **A tap on a resolved node is guarded against the soft keyboard** (`interact/keyboard.ts#resolveClearOfKeyboard`).
  On Android the keyboard is a window absent from the tree, so a node under it would take a key press. The adapter's
  oracle reads the window; a covering keyboard is hidden with `back`, the target resolved again and checked once more,
  and a keyboard that stays is an error, never a loop. `back` is vetoed by an independent witness (the input method's
  `mInputShown`) asked right before it; when the two disagree past a short wait, nothing is sent. Every failure after a
  `back` says it was pressed. On iOS (WDA) the keyboard is in the tree: a covered target is hidden by the configured
  dismissal (`app.ios.keyboardDismiss`), else refused on a second look with the adapter's advice; under idb the
  reading stays `unknown` and nothing is pressed blind. What is guaranteed: averi sends no `back` the input method
  denies, and taps no point both sources place under a keyboard (ADR 0017, ADR 0022, ADR 0027).
- **Crash detection.** A successful `ensure_state` or `run_flow`, every returning `assert` and each completed `verify`
  leg ends with `appAlive: true | false | unknown` (`run/app-health.ts#appHealth`) when averi.yaml names the app:
  `false` with a crash excerpt from the last 60 s of logs, `unknown` when the device could not be asked — deliberately
  not `false`. iOS asks the host's process list (ADR 0039).
- **A failed host command's words have one seam** (ADR 0043, §3).
- **Login edge cases** — NOT IMPLEMENTED, design intent only: wrong-PIN lockout protection (one retry, then stop — never
  brute-force a real backend) and an OTP source; the strict schema refuses both keys. Today's only re-run is §4's
  recovery pass, which knows no lockout.
- **Determinism aids**: `clearState` per launch. NOT IMPLEMENTED: status-bar override / demo mode, fixed locale and
  timezone.
- **A differential harness replays recorded trees through two checkouts** (`scripts/differential/README.md`): every
  saved tree through OLD's and NEW's tool handlers, each differing reply or device call reported. The golden corpus
  (`scripts/differential/golden.ts`) pins replies a change must not move.
- **A performance baseline times the tools on the lab devices** (`scripts/perf/baseline.ts`), recording device calls,
  host processes and sleeps per caller without changing `src/`.
- **The device batches' safety core is a tested module** (`scripts/truth/batch/`, backlog T2), and **one live case's
  device cycle is a module** (`runCase` in `scripts/truth/run-case.ts`, ADR 0044): what a case reads is declared on the
  case, never inferred. ADR 0020: the truth outranks a hand-written expectation.
- **A mutation run guards the pure leaves' tests** (`npm run mutate`, ADR 0038): Stryker mutates the modules
  `scripts/mutation/scope.json` names, in four groups (`core`, `android`, `scene`, `lab`), and fails when a module's
  score drops below its floor; each group is one Stryker process bounded at 600 s. A branch that touches a scoped
  module, its tests or anything they import runs it cold (`npm run mutate -- --force`) before merging; a cold run reads
  no incremental file, and each group's temp dir is in the checkout's own reports/mutation/. scope.json holds each
  module's floor and latest baseline; earlier baselines are in docs/mutation-ledger.md.
- **Releases** follow docs/release.md: gates A (off-device), B (Android) and C (iOS) before any version commit.

---

## 9. Roadmap

Shipped: the adapter core (with the WDA tree source), the flow engine, verification and the skill, and the npm package.
Open, none implemented: a docs site; a pilot with friendly teams; `record_flow` (watch an interaction, emit a draft
flow); real devices (physical Android devices appear in `list_devices`, but support is not claimed); a CI mode; and,
from §8 and §10, lockout protection, an OTP source, status-bar and locale control, keychain-backed credentials and an
accessibility-id lint tool. Current work is the backlog, docs/plans/2026-10-30-performance-backlog.md.

## 10. Risks

- **Compose/SwiftUI semantics gaps** → a sparse tree; mitigations: coordinate taps and swipes, `treeSource: wda` for
  container ids idb drops, `text`/`label`/`role` selectors, `ocr` asserts for copy the tree lacks. Not built: a lint
  tool for missing `testTag`/`accessibilityIdentifier`.
- **idb maintenance risk** → the tree read sits behind `IosTreeSource` with two adapters; changing the default is
  one constant (`adapters/ios-node.ts#DEFAULT_IOS_TREE_SOURCE`). Input is NOT behind it: leaving idb entirely still
  needs a WDA input path (docs/plans/ios-wda-tree-source.md, decision 4).
- **Overlap with mobile-mcp** → averi's value over raw taps is the flow-descriptor layer, cross-platform parity and the
  maintained skill.
- **Secrets in a banking context** → local-only processing and redaction are in place; keychain integration is open —
  credentials come from the environment or a gitignored `.env.averi`.
