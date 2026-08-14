# averi — architectural review

*2026-08-14 · reviewed at commit `683dc45` plus the uncommitted color-parity work in the tree.*

Scope: separation of concerns, clean-code alignment (function size / parameter count / readability), and
abstraction extraction for shared code — with an explicit bias against over-abstraction.

Measured state: 14 test files, 287 tests, all green; `tsc --noEmit` clean. ~2,900 lines of `src`,
~3,300 of tests (excluding fixtures). Work in progress: color parity (`ciede2000.ts`,
`color-parity.ts` + tests, untracked) wired into `assert.ts` and `server.ts`.

---

## Verdict

The architecture described in ARCHITECTURE.md §2 is **real, not aspirational** — the adapter boundary
held under the hardest test it could get (the WDA tree source landed with only `uiTree()` dispatching,
nothing above it changed). The code is unusually well-commented, with the *why* and the measurement
date attached to the non-obvious decisions. It is **not over-abstracted**: test seams are structural
(`ExecFn`, `FetchFn`, `SpawnFn`, `AdapterFactory`), there are no speculative interfaces, no DI
container, no premature base classes.

Three things need attention, in this order:

1. **The MCP layer is no longer thin** (§2 promises "no logic"). `verify` holds ~120 lines of
   orchestration — the most complex code in the tool, and the only code with no tests.
2. **Three dependency arrows point upward**, all traceable to one cause: `flow/config.ts` has become
   the home of shared vocabulary that isn't flow-specific.
3. **The polling/deadline rule is written six times.** It is the tool's core reliability behaviour
   ("a failed tree read is a miss, not a failure") and it has six owners.

Nothing here is a rewrite. The fixes are mechanical and mostly subtractive.

---

## 1. Separation of concerns

### S1 — The MCP layer is not thin (highest impact)

ARCHITECTURE.md §2: *"MCP layer — thin; exposes tools, no logic."* `src/mcp/server.ts` is 666 lines
and holds real logic:

| Location | What leaked in | Belongs in |
|---|---|---|
| `server.ts:513-634` | the whole `verify` orchestration: leg execution, `Promise.allSettled`, section assembly, rect-parity assembly, PNG decode, color-parity assembly | `verify/` (a `runVerification()` / `VerificationRun`) |
| `server.ts:380-392` | `appHealth` — composes adapter + `scanForCrashes` into the appAlive contract (§8) | `verify/` |
| `server.ts:213-235` | the screen-stability wait (`STABILITY_ATTEMPTS`, `STABILITY_DELAY_MS`) | adapter or `verify/` — it is already implemented a second time at `assert.ts:289` |
| `server.ts:176-181` | resolving the default launch activity from `averi.yaml` when the package matches | `flow/` — `engine.ts:145-147` implements the same rule |

The cost is concrete and measurable: `src/mcp/` has `registry.test.ts` and `platforms.test.ts` but
**no `server.test.ts`**, because `server.ts` ends in a top-level `await server.connect(transport)` —
importing it opens a stdio transport. So the 122-line `verify` handler, which contains the trickiest
error containment in the codebase (a comparator throw must not discard a minutes-long device run),
cannot be tested at all, while everything one layer below it has 287 tests.

**Fix:** move the handler bodies into `verify/`, leave `server.ts` holding tool descriptions, zod
schemas, and one-line delegations. `verify` becomes testable with `FakeAdapter`, which already exists
and already supports everything the legs need (`screenshot`, `uiTree`, `logs`, `isAppRunning`).

### S2 — Three upward dependency edges, one root cause

```
adapters/android.ts ──▶ ui-tree/selectors      (adapters reach UP into the layer above)
adapters/ios.ts     ──▶ ui-tree/selectors
ui-tree/selectors.ts ──▶ flow/config           (ElementSpec)
verify/assert.ts     ──▶ flow/config           (elementSpecSchema, elementAssertSchema, parseDuration)
flow/engine.ts       ──▶ verify/assert         (Verifier, for inline `assert:` steps)
```

The last two together mean `flow` and `verify` are mutually entangled at package level
(`flow/engine → verify/assert → flow/config`). ESM copes; the design intent does not — neither
package can be reasoned about, or reused, without the other.

The root cause is single and cheap to fix: **`flow/config.ts` (464 lines) is the de-facto home of
vocabulary that is not flow-specific.**

- `ElementSpec` / `elementSpecSchema` — a structured selector. This is a **ui-tree** concept.
  `selectors.ts` consuming it from `flow/config` is backwards.
- `ElementAssert` / `elementAssertSchema` — an assertion. This is a **verify** concept; `flow` uses
  it for inline `assert:` steps, which is the correct direction (flow depends on verify).
- `parseDuration` (`config.ts:458`) — a generic string→ms utility, imported by both `flow/engine`
  and `verify/assert`.

Move those three, and every arrow points down: `mcp → flow → verify → ui-tree → adapters`.

`adapters → ui-tree` is a separate cause — see **E1**.

### S3 — `flow/config.ts` bundles five responsibilities

Schema + types (L9–295), file loading (L297–329), credential resolution (L331–367), `.env.averi`
loading (L369–406), cross-reference validation (L408–455), plus `parseDuration`.

Most of that grouping is defensible — it is all "turn averi.yaml into a validated config". Two parts
are not:

- **`loadEnvBeside` carries module-level mutable state** (`envVarsFromFile`, `config.ts:381`) and
  mutates `process.env`. A hidden global inside an otherwise-pure parsing module. The refresh
  semantics it implements are correct and well-documented (the 2026-08-05 stale-credential bug), but
  they belong in their own `flow/env-file.ts` where the state is visibly owned.
- `parseDuration` — see S2.

Not urgent. Worth doing when `config.ts` is next touched.

### S4 — Adapters own a rule they cannot own

`AndroidAdapter.tapElement` (`android.ts:130-135`) and `IosAdapter.tapElement` (`ios.ts:186-191`) are
**byte-identical**:

```ts
const { node, note } = resolveOne(await this.uiTree(), selector);
const point = tapPoint(node);
await this.tap(point.x, point.y);
return note;
```

Nothing in it is platform-specific — it is selector resolution, which lives above the adapter. Having
`tapElement` on the `DeviceAdapter` interface is what forces both adapters to import
`ui-tree/selectors` and inverts the layering. See **E1** for the fix.

### S5 — The verify package's internal boundaries are drawn wrong

`color-parity.ts` imports `collectRects`, `inferScreenWidth` and `RectContract` from `rect-parity.ts`
(`collectRects` was un-privated for exactly this in the WIP diff). That produces two problems:

- `collectRects` and `inferScreenWidth` are **tree geometry**, not rect *parity*. They walk a `UiNode`
  and answer questions about it. They belong next to `intersectsViewport` / `tapPoint` in `ui-tree/`.
- `RectContract` is not a rect contract — it is **the layout contract**, and colour now reads `bg`,
  `bg_dark` and `sample` out of it through a `.passthrough()` schema and `Record<string, unknown>`
  casts (`color-parity.ts:195, 206`). Colour anchors are typed as `unknown` because the schema that
  owns them is named after the other consumer.

This is the clearest case where the WIP work has outgrown the existing shape. See **E2**.

---

## 2. Clean-code alignment

Naming, comment quality and error messages are the strongest part of this codebase — error strings
routinely tell the user how to recover (`registry.ts:99`, `wda.ts:241`, `engine.ts:458`). Parameter
counts are broadly disciplined: options-objects are used where they should be (`EngineOptions`,
`VerifierOptions`, `WdaServerOptions`, `RectParityOptions`). The issue is **function length**, in five
specific places.

### C1 — Five functions well over any readable budget

| Function | Lines | Why it is long |
|---|---|---|
| `compareRectParity` (`rect-parity.ts:178`) | **207** | setup + per-anchor field loop + gap chain + aspect, with local closures |
| `runStep` (`engine.ts:132`) | **163** | a 12-arm `if ('x' in step)` chain; every step type is a mini-handler inline |
| `compareColorParity` (`color-parity.ts:298`) | **166** | tolerance validation + per-platform stats/scale + sampling loop + 3 comparison axes + row assembly |
| `verify` handler (`server.ts:513`) | **122** | see S1 |
| `formatRectParity` / `formatColorParity` | **104 / 103** | hand-rolled fixed-width table rendering |

`runStep` is the one that will keep growing: every new step type adds an arm. A `Record<StepKind,
handler>` dispatch table would flatten it and make the step vocabulary readable in one screen. The
two `compare*` functions decompose cleanly along seams that are already marked by their own comments
(setup / per-anchor / findings). The two `format*` functions are linear and low-risk — see **E4**
before touching them.

### C2 — `assertElement` takes exclusive options positionally

```ts
private async assertElement(
  element: ElementSpec, text: string|undefined, match: string|undefined,
  error: string|undefined, timeoutMs: number)          // assert.ts:144
```

Five positional parameters, three of them mutually exclusive optionals, called as
`this.assertElement(spec.element, spec.text, spec.match, spec.error, timeoutMs)` (`assert.ts:141`) —
the spec object is destructured only to be reassembled. Pass the spec.

### C3 — Default values duplicated away from their constant

- Rect tolerance `2.0` is written three times: `assert.ts:202` (used for the *description* string),
  `rect-parity.ts:541` (used for the *evaluation*), `rect-parity.ts:186`. There is no
  `DEFAULT_TOLERANCE_PCT` constant.
- Colour tolerance: `assert.ts:244` writes `expectation.deltaE ?? 8` for the description while
  `color-parity.ts:618` evaluates against the exported `DEFAULT_TOLERANCE_DE`. **The constant exists
  and the WIP code bypasses it.** Change the constant today and the assert description reports a
  tolerance the assert does not use.

Same shape in a third place: the baseline directory is `resolve('.averi/baselines')` at
`server.ts:473` and `server.ts:531`, and `'.averi/baselines'` (unresolved — a different path when cwd
differs) as the default at `assert.ts:122`.

### C4 — `sleep` exists four times and is bypassed three more

Defined privately in `engine.ts:636`, `assert.ts:434`, `wda.ts:485`. Written inline as
`new Promise((r) => setTimeout(r, ms))` at `server.ts:227`, `android.ts:176`, `android.ts:187`, and —
inside the file that defines it — `engine.ts:191`, `engine.ts:417`, `engine.ts:548`.

### C5 — `describeSpec` and `describe` are the same function

`engine.ts:650` and `assert.ts:427` have identical bodies and different names. Both render an
`ElementSpec` for human output; they are the tool's user-facing vocabulary for "which element", so
divergence would be visible to users.

### C6 — Two swipe-vector tables with deliberately opposite semantics

`engine.ts:206-211` (`swipe` step — `direction` = **finger** movement) and `engine.ts:510-515`
(`scrollUntilVisible` — `direction` = where the **content** lies). `up` and `down` map to opposite
vectors in the two tables. Both are correct and both are documented, but the duplication is a trap:
the next person to fix a bug in one table will "fix" the other to match.

One function, `swipeVector(viewport, direction, { as: 'finger' | 'content' })`, makes the inversion
explicit and single-owner.

---

## 3. Abstraction extraction

Ordered by value. Everything here is **de-duplication of an existing rule that already has multiple
owners** — none of it is speculative.

### E1 — Lift `tapElement` off the adapter interface *(fixes S4 and the adapters→ui-tree inversion)*

Replace the two identical adapter methods with one free function:

```ts
// ui-tree/tap.ts
export async function tapElement(adapter: DeviceAdapter, selector: Selector) { … }
```

Removes a method from `DeviceAdapter` (every future adapter no longer has to implement it), deletes
two identical bodies, and removes the `adapters → ui-tree` import from both adapters. `FakeAdapter`
also drops its stub. Small, purely subtractive.

### E2 — Give the layout contract its own module *(fixes S5)*

```
verify/layout-contract.ts   contract schema + parse + typed anchors (id, x/y/w/h, bg, bg_dark, sample)
ui-tree/geometry.ts         collectRects, inferScreenWidth   (join intersectsViewport, tapPoint)
verify/rect-parity.ts       consumes both
verify/color-parity.ts      consumes both — no longer imports rect-parity
```

This is the extraction the WIP work is currently asking for by force: `sampleModeOf` and
`contractTargetOf` take `Record<string, unknown>` and re-validate anchor fields at read time
(`color-parity.ts:195, 206`) purely because the schema that owns those fields is named after the
other consumer. Typing them once at parse removes both functions' defensive branches. Best done
**before** committing the colour work — it is a rename-and-move now, a migration later.

### E3 — One polling primitive for the verify layer

`assertElement`, `assertRect`, `assertColor` and `assertAbsent` (`assert.ts:144, 197, 239, 318`) each
contain the identical skeleton:

```
deadline = now + timeoutMs
loop: read tree (failure = miss, remember error)
      → evaluate → pass? return
      → past deadline? return fail(lastDetail ?? readError ?? "not found")
      → sleep(pollMs)
```

Four copies. Counting the whole codebase, the "poll with a deadline and tolerate a failed tree read"
rule has **six** implementations: those four, plus `FlowEngine.pollUntil` (`engine.ts:389`), plus the
loop inside `scrollUntilVisible` (`engine.ts:520`) — and `readTreeWithRetry` (`assert.ts:385`) is a
seventh variant of the read-retry half.

This is the tool's central reliability behaviour (ARCHITECTURE §8, "waits, not sleeps"). It should
have one owner:

```ts
pollForVerdict(adapter, evaluate: (tree) => Verdict|undefined, { timeoutMs, pollMs, describe })
```

`assert.ts` loses roughly 60 lines and the four asserts reduce to their actual differences.
`engine.ts`'s `pollUntil` can then be a thin wrapper or the same function — worth checking, not worth
forcing.

### E4 — A small fixed-width table renderer

`formatRectParity` and `formatColorParity` each hand-roll `padEnd(38)` / `padStart(8)` column
assembly, a `'-'.repeat(header.length)` rule, a MISSING section, a findings section and a verdict
line. ~200 lines between them with the same skeleton.

A `table({ columns, rows })` helper plus a shared `renderSections({ notes, missing, findings,
verdict })` would remove the alignment drift risk (the two tables already use different column
counts and different padding for the same anchor column).

**Caveat:** this is the lowest-priority item and the easiest to overdo. The two tables' *content*
differs meaningfully (rect has gap/aspect rows and per-field grouping; colour has per-platform stats
lines). Extract the *mechanics* (column padding, rule, section headers) only. Do not build a generic
reporting framework.

### E5 — One owner for `attachFieldErrors`

`ios.ts:321` (flat idb list) and `wda-source.ts:109` (nested WDA tree) implement the same measured
business rule — *a field's error label shares its accessibilityIdentifier and sits below it; nearest
wins* — twice, over different traversals. The comments in both files already acknowledge the
duplication.

Each source can collect its own `(fields, texts)` — that part genuinely differs — then call one
shared `pairFieldErrors(fields, texts)`. Exactly the precedent already set by `IOS_ROLE_MAP`, which
was extracted for the same reason ("the two copies this replaces were identical and would have
drifted").

### Deliberately *not* extracting

Called out so a future pass doesn't undo good judgement:

- **`ExecFn` / `FetchFn` / `SpawnFn` / `AdapterFactory` / `wdaServerFactory`** — structural test
  seams, minimal, each used. Correct as-is. Do not formalize into a DI layer.
- **`evaluateRectAssert` vs `compareRectParity`** — single-element vs whole-screen-with-gap-chain.
  They already share `norm` and `inferScreenWidth`; the rest genuinely differs. Leave separate.
- **`AndroidAdapter` / `IosAdapter` common shape** — the `viewportPromise` memoization pattern
  repeats, but the bodies are entirely different commands. A shared base class would buy ~6 lines and
  cost the flat, readable "one file per platform" property that made the WDA swap cheap. Leave.
- **`mcp/platforms.ts` (19 lines)** — a tiny module, but it owns one rule with one obvious home and
  its own test. Fine.
- **The long comment headers** (`color-parity.ts` opens with 50 lines) — these carry measurement
  dates and rejected alternatives. They are the reason this codebase is reviewable. Keep them.

---

## 4. Notes on the work in progress

The colour-parity work is well-built and consistent with the existing rect-parity shape: pure
comparator + formatter, `fail closed, never a vacuous pass` applied uniformly (`color-parity.ts:324,
327`; `assert.ts` mirrors it), findings carrying their own numbers, tolerances justified against a
real measured bug. `ciede2000.ts` is pure and separately tested. `assertColor` correctly reuses the
stable-screenshot wait so a mid-animation frame is never the verdict.

Two things to settle **before committing**, both cheap now and expensive later:

1. **E2 (layout contract module).** The `Record<string, unknown>` anchor reads and the
   `export`-ing of `collectRects` out of `rect-parity` are the shape complaining. Renaming
   `RectContract` → `LayoutContract` after it ships means touching the tool schema description,
   the docs and the tests.
2. **C3 (`?? 8` vs `DEFAULT_TOLERANCE_DE`).** One-line fix; today it is a latent inconsistency
   between what the assert reports and what it enforces.

Also worth deciding now: `server.ts`'s colour-parity block (`server.ts:597-630`) is a near-copy of
the rect-parity block above it (`server.ts:569-591`) — gather per-leg artifacts → build notes →
`SKIPPED` when empty → `try/format/catch FAILED`. Two copies today; a third parity dimension makes
it three. This is S1 and E3's territory: a `paritySection(name, gather, format)` in `verify/` would
collapse both.

---

## 5. Suggested order

Each step is independently shippable and leaves the tree green.

| # | Action | Fixes | Effort |
|---|---|---|---|
| 1 | Use `DEFAULT_TOLERANCE_DE` in `assertColor`; add `DEFAULT_TOLERANCE_PCT` and use it in all three rect sites | C3 | minutes |
| 2 | Extract `verify/layout-contract.ts` + `ui-tree/geometry.ts` — **before committing the colour work** | S5, E2 | ~1h |
| 3 | Move `ElementSpec`→`ui-tree`, `ElementAssert`→`verify`, `parseDuration`→own module | S2, S3 | ~1h |
| 4 | Lift `tapElement` off `DeviceAdapter` | S4, E1 | ~30m |
| 5 | Extract `pollForVerdict`; collapse the four assert loops | E3 | ~2h |
| 6 | Move `verify` / `appHealth` / stability-wait out of `server.ts` into `verify/`; add `tests/verify/run.test.ts` | S1, C1 | ~3h |
| 7 | Dispatch-table `runStep`; decompose `compareRectParity` / `compareColorParity` | C1 | ~3h |
| 8 | Shared `pairFieldErrors`; `swipeVector`; one `sleep`; one `describeSpec` | E5, C4, C5, C6 | ~1h |
| 9 | Table-rendering helper — mechanics only | E4 | ~1h |

Steps 1–2 are the ones tied to the WIP and should land with it. Step 6 is the one that pays for
itself in test coverage.
