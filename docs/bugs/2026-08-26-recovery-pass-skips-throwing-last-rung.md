# BUG: the recovery pass never arms when the LAST reach rung THROWS — the shape real login flows have

**Follow-up to** `2026-08-26-ensure-state-no-recovery-pass.md` (read it first for the incident and
the 0.5.0 fix). Self-contained repro + verdict below; filed 2026-08-26 after on-device verification
of 0.5.0.

## The gap

`ensureStateInner` (`src/flow/engine.ts`) arms the recovery pass only when the ladder's **final
`waitFor` times out**. A LAST rung that **throws** is rethrown immediately
(`if (last || e instanceof SetupError) throw e`) — the final wait is never reached, so the recovery
pass never runs.

Real-world configs routinely end a login flow with its own success criterion —
`- wait: { state: logged_in, timeout: 20s }` as the flow's last step. When a late interstitial
blocks that wait, the timeout is **the flow throwing from the last rung**, not the ladder's final
wait. Result: 0.5.0 does not cover the exact incident that motivated the recovery pass.

This is the shape the 0.5.0 review already met as the "vacuous test" finding (a regression test
whose last rung threw, so recovery never ran and the test passed with the destructiveness filter
deleted) — the **test** was fixed, the **engine path** was not.

## Evidence (on device, 0.5.0)

Skeleton superrepo (`/Users/mholecy/Finshape/skeleton`), Android emulator, `pm clear`, one
`ensure_state("transaction_filter")`, config at superrepo commit `7eab53e` (login still ended with
its trailing wait, no post-PIN gate yet): identical failure to pre-fix, **no `↻ recovery` line**,
timeout text is the login flow's own wait. Control experiment the same evening: with the trailing
wait removed so the flow COMPLETES and the ladder's final wait takes over, the recovery pass fired
(`↻ recovery` in trace) and one call converged — so the pass itself works; only the throw path
bypasses it.

## Fix shape

When the LAST rung throws (and it is not a `SetupError`), run the same bounded recovery pass before
rethrowing — it re-runs only provably-repeatable rungs, so by construction it adds no wipes and is
safe on any throw. If recovery reaches the state, succeed; otherwise rethrow the ORIGINAL error
(the recovery attempt visible in the trace either way).

Regression test: `reach: [cheap, destructive]` where `destructive`'s LAST STEP is a
`wait:` that times out because the fake adapter shows the interstitial only after `destructive`'s
earlier steps complete — assert one call converges, `destructive` ran exactly once, and the
recovery attempt is in the trace. (This is the previously-vacuous shape, now as a POSITIVE case.)

## Notes for the fixer

- Keep the `SetupError` early-abort: a config mistake must still abort the ladder, recovery
  included — the next run cannot fix an undeclared credential.
- The skeleton repo no longer exercises this gap (its login flows gate on a post-PIN `any:` state
  since superrepo `cc62ee7`), so verify with the regression test or a temporarily reverted config.

## Fixed

Reproduced first, locally, in exactly the reported shape (`reach: [dismiss_prompt, login]`, `login`
ending with its own `wait: { state: logged_in }`, fake adapter showing the interstitial only after
`login`'s `launch`): the call failed with **no `↻ recovery` line and no tap**, while the interstitial
sat on screen and one tap would have converged. Control experiment isolates the cause to a single
line of config — the same test with the trailing `wait:` removed (last rung COMPLETES instead of
throwing) passes, recovery pass and all. So the pass works; only the throw path bypassed it, as
reported.

Fixed in `src/flow/engine.ts`. The ladder no longer rethrows a throwing last rung blind
(`if (last || e instanceof SetupError) throw e` → `salvageThrowingLastRung`), which hands it the two
chances every other rung already gets, then rethrows the ORIGINAL error:

- The **recovery pass**, unchanged and with both of its bounds intact — last rung never re-run,
  every candidate provably non-destructive — so it adds no wipes here either, whatever made the rung
  throw. `recoveryPass` now takes the reason it armed, so the trace reads `↻ recovery logged_in:
  login failed — re-running dismiss_prompt once` instead of claiming a timeout that did not happen.
- The rung's own **`detect` re-check**, which turned out to be a second, adjacent gap the report did
  not name: the ladder re-checks `detect` after a failed rung on purpose ("the flow may have reached
  the state before dying on a later step"), and `throw e` sat *above* that check, so the last rung
  alone never got it. Probe: `reach: [login]`, `login` = `launch` (lands on the dashboard) + a
  trailing `tap:` that is not there — `dashboard_root` was on screen when the flow died and
  `ensure_state` failed anyway. This is separate from the recovery pass, not a special case of it:
  with a single-rung `reach` the pass has nothing to run at all. It is also the cheaper and safer of
  the two — a pure read, no flow re-run.
- Both probes go through `attempt()`, so neither a rung that fails again nor an adapter that dies
  mid-probe can replace the error the caller must see. `attempt()` now takes a label rather than
  assuming `recovery`.
- `SetupError` still aborts before any of this, per the report's note.

Regression tests: `tests/flow/engine.test.ts`, describe `'the last rung THROWING gets the same two
chances as any other rung'` — 6 cases: the reported shape as a POSITIVE (one call converges,
`destructive` ran exactly once, `↻ recovery` in the trace — i.e. the previously-vacuous test, now
load-bearing), the detect re-check, the `SetupError` abort, the destructiveness filter holding on
the throw path, the original error surviving the salvage, and (added after review) the ORDER of the
two probes.

Mutation-tested: reverting the fix fails 3, dropping the salvage detect fails 1, dropping the
destructiveness filter fails 5 (4 pre-existing + the new throw-path one), dropping the `SetupError`
exemption fails 3. Full suite 492/492, lint and typecheck clean.

Docs corrected where they described the pass as arming on the final wait: README.md, ARCHITECTURE.md
§4, skill/SKILL.md.

Not re-verified on device — the skeleton repo no longer exercises this gap (its login flows gate on
a post-PIN `any:` state since superrepo `cc62ee7`, confirmed present), so the regression tests are
the standing evidence, as this report's own notes anticipated.

## Reviewed independently (2026-08-27) by two Fable 5 agents, correctness and architecture

Correctness: no critical or major findings; all five invariants re-verified, including by mutation
on the new path. It could construct no config shape that adds a wipe, doubles the pass, buys
recovery for a `SetupError`, or replaces the caller's error, and confirmed the non-last-rung control
flow is behaviourally unchanged. Architecture: sound with minor cleanups, no restructuring — it
argued against extracting a ladder policy object (`flowIsDestructive` in config.ts already owns
*which* rungs may repeat, the engine owns *when and how*; extracting today buys a name at the price
of a five-callback interface) and against typing `why` as a union (nothing branches on it). Revisit
the extraction if a third recovery variant lands.

Findings acted on:

- **The probe order was load-bearing and unpinned.** Swapping detect and recovery pass inside
  `salvageThrowingLastRung` survived all 79 tests. It is not a wash: the state can already be on
  screen when the rung dies, and a recovery rung is a real tap on a real device — with a dismissable
  banner sitting ON the target screen, a pass that runs first taps a LIVE screen, navigates off the
  state that was reached, and turns a success into a failure while spending the one pass to do it.
  Now pinned by `'checks detect BEFORE re-running anything'`; the swapped mutant fails it and
  nothing else.
- The salvage detect probe was labelled `reach ${flow}`, so an adapter dying mid-probe produced two
  consecutive `⚠ reach <flow>` lines meaning different things — and SKILL.md tells agents to go fix
  the flow when they see one. Now `salvage ${flow}`. (Both reviewers, independently.)
- A test comment still taught the PRE-fix behaviour as current fact ("a rung that THROWS is rethrown
  by the ladder and never reaches the final wait") — precisely what this change repeals.
- README still closed with "fails with the original timeout" after its opening had been widened to
  cover the throw; on that path the error need not be a timeout at all. ARCHITECTURE.md had it
  right. Same overclaiming failure mode an earlier round caught in SKILL.md.
- `lateInterstitial` was duplicated verbatim across two describes — shared knowledge, not the
  per-block `screens()` idiom — now one module-level helper. Error-headline munging is now a
  `headline()` helper instead of being spelled twice, one of them inside a policy-level function.
  ARCHITECTURE.md's "the salvage below" referred to a method name the document never defines.

Known and NOT changed: an absence-style `detect` (e.g. `element: { id: login_button, absent: true }`)
can read as satisfied on a screen that is not the app at all — so a last rung that wipes and then
crashes to the launcher would now report `reached`, where 0.5.0 failed loudly. This is the ladder's
existing post-failure re-check semantics, which every non-last rung already has; the fix widens the
exposure to one more path rather than creating it. Narrowing it is a decision about what `absent:`
means in a `detect`, not about this fix.
