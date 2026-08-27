# BUG: `ensure_state` cannot recover when the state becomes reachable by an EARLIER reach rung after the LAST rung ran

**Measured 2026-08-26** in `/Users/mholecy/Finshape/skeleton` (Android emulator, app
com.finshape.skeleton.dev, state `logged_in` with `reach: [dismiss_post_login_prompts, login]`).
One `ensure_state` call failed; an **immediately repeated, identical call succeeded with no other
intervention** — the asymmetry that breaks the tool's own advertised contract ("Idempotent — call
it freely"; the skill tells agents to ALWAYS prefer it over manual login).

## Observed (first call — FAILED)

```
flow dismiss_post_login_prompts: start
optional: skipped text:"MAYBE LATER" (not present)        ← rung 1 ran while the app was logged OUT
⚠ reach dismiss_post_login_prompts: failed, escalating to login — Timed out ... id:"nav.tab_transactions"
flow login: start
launch: com.finshape.skeleton.dev (state cleared)          ← rung 2 = the destructive flow
... full registration ...
type_pin: 4 digits, twice
optional: skipped text:"SKIP" (not present)
optional: skipped step (not present)                       ← interstitial not there YET (network-gated)
Timed out after 20000ms waiting for state logged_in        ← final waitFor; screen sat on the interstitial
```

Screenshot at failure: the **"Activate Biometrics"** interstitial (MAYBE LATER / ACTIVATE), which
appears a beat after PIN setup — gated on a network round-trip, i.e. after `login`'s short optional
windows had already closed.

## Observed (second call, seconds later — PASSED)

```
flow dismiss_post_login_prompts: start
tap: text:"MAYBE LATER"
wait: element id:"nav.tab_transactions"
state logged_in: reached after dismiss_post_login_prompts
```

## What the engine does today (`src/flow/engine.ts`, `ensureStateInner`, ~lines 160–215)

The escalation ladder is well built for the destructive-protection direction: it re-detects after
EVERY rung (with a `reachRecheckMs` grace between non-last rungs), a throwing rung escalates
instead of aborting, and the detect is checked even after a failed rung — all to keep a cheap
prelude from escalating into a `clearState: true` login (the comment cites the 2026-08-26
registration burn). **The gap is the mirror direction:** the ladder is strictly one-shot and
forward-only. After the last rung, the engine only sits in `waitFor(state, ensureTimeoutMs)`
(line ~213). If the last rung's own aftermath produces a screen that an EARLIER rung exists to
clear — here: login ends → interstitial arrives late → `dismiss_post_login_prompts` is exactly the
cure and has already been consumed — nothing ever re-runs it, and the call fails while recovery is
demonstrably one cheap flow away.

## Why this is a bug and not just config

A config mitigation exists and is even documented in the skill text (put `timeout: 10s` on the
interstitial's optional tap, or model the post-login fork as a state with `any:` over both
outcomes) — the skeleton's `login` flow should adopt it regardless. But the tool-level contract is
what agents build on: "idempotent, call it freely" implies a single call converges wherever an
immediate second call would. Today the second call converges precisely because the ladder restarts
from rung 1 — i.e. the engine already contains the recovery, it just never applies it within one
invocation.

## Fix shape (keep the destructive-protection invariant!)

Do NOT naively re-pass the whole ladder on final-wait timeout: if rung 1 failed again, that would
escalate into the destructive last rung a second time (another `clearState`, another registration
burned). Safe, bounded variant:

- When the final `waitFor` times out (or, better, periodically while it polls), re-run only the
  **non-last** rungs — by construction the cheap preludes; the last rung is the escalation anchor
  and often destructive — at most once, then re-check the detect.
- If the detect still fails, fail exactly as today, with the re-pass visible in the trace.
- Alternatively/additionally: let config mark reach flows `destructive: true` (`launch:
  clearState` implies it) and allow recovery passes over non-destructive rungs only.

Regression test: a state with `reach: [cheap, destructive]` where the fake adapter makes the
"interstitial" appear only AFTER `destructive` completes — assert one `ensure_state` call
converges and `destructive` ran exactly once.

## Related

`docs/bugs/2026-08-26-ios-ocr-crop-scale.md` (same session, unrelated mechanism).

## Fixed

Reproduced first (fake adapter, interstitial appearing only after the destructive rung): the
first `ensure_state` threw `Timed out ... waiting for state logged_in after reach flows`, an
immediately repeated call passed with no second `launch`. Fixed in `src/flow/engine.ts`
(`recoveryPass`) + `src/flow/config.ts` (`flows.<name>.destructive`):

- The final `waitFor` timing out is no longer terminal. It triggers ONE recovery pass over the
  reach rungs that are safe to repeat, re-checking `detect` after each, then fails with the
  original timeout if the state is still not reached.
- Candidates are the **non-last** rungs filtered by a static destructiveness check
  (`flowIsDestructive`): `launch { clearState: true }` anywhere in a flow's steps — including
  inside `branch`/`optional`/platform overrides — or reachable through `requires`, or an explicit
  `destructive: true`. Conservative by construction, at every level: unknown flow, `requires`
  cycle, and — after review — any Step kind the walk does not recognise all count as destructive,
  so a container kind added to `Step` later costs a skipped recovery, never a second wipe. Index
  alone was not enough: nothing stops a wipe from sitting at index 0.
- Bounded once per tool call (`recoveryUsed`), so nested `requires` cannot multiply it.

Regression tests: `tests/flow/engine.test.ts`, describe
`'the ladder gets one recovery pass, over the repeatable rungs only'` — 6 cases, including the
exact shape asked for above (one call converges, `destructive` ran exactly once) plus the
destructive-rung-not-last, `destructive: true`, `requires`, still-stuck, and single-rung guards.

Reviewed independently (2026-08-26) by two Fable 5 agents, correctness and architecture. Findings
acted on: one regression test was vacuous (its last rung THREW, so the ladder rethrew before the
final wait and the recovery pass never ran — the test passed with the destructiveness filter
deleted); the step-level walk defaulted to non-destructive; `destructive: false` parsed as a no-op
override; a rung that threw during recovery skipped its own detect. Mutation-tested afterwards: removing the
filter (4 tests), including the last rung (1), and removing the once-per-call bound (1) each fail.
Dropping a container kind from the shared `childSteps` walker does NOT fail an engine test, and
should not: the inverted fallthrough then classifies the unrecursed kind as destructive, so the
invariant holds and only recovery coverage is lost — the validation side of that walker is pinned
in tests/flow/config.test.ts instead. Docs updated in README.md, ARCHITECTURE.md §4 and skill/SKILL.md, which
all described the ladder as forward-only. A third round caught that SKILL.md then overclaimed
"at most one wipe per failing call" — false, since a rung's `requires:` chain can wipe on top of
the last rung; the honest invariant is that the recovery pass adds none.

## Verified on device against 0.5.0 (2026-08-26, later the same day) — the fix does NOT cover the production shape

Re-ran the original scenario (Android emulator, `pm clear`, one `ensure_state("transaction_filter")`)
on a fresh 0.5.0 server. Same failure as pre-fix, and **no `↻ recovery` line in the trace.** Reason,
visible in the trace: the timeout is thrown by the `login` flow's OWN trailing step
`wait: { state: logged_in, timeout: 20s }` — i.e. the LAST rung THROWS. `ensureStateInner` rethrows a
throwing last rung (`if (last || e instanceof SetupError) throw e`) before ever reaching the final
`waitFor`, which is the only place the recovery pass arms. This is the exact shape the review already
met as the "vacuous test" (its last rung threw, so the recovery never ran) — the test was fixed, the
engine path was not. Real-world configs commonly end a login flow with a state wait as its success
criterion, so the shipped fix misses the very case that motivated it.

Follow-up fix shape: when the LAST rung throws (not a `SetupError`), run the same bounded recovery
pass before rethrowing — by construction it adds no wipes, so it is safe on any throw; keep the
original error as the reported failure if recovery does not reach the state.

Meanwhile the skeleton repo adopted the config mitigation (widened
`optional: [ { tap: { text: "MAYBE LATER", timeout: 15s } } ]` inside `login`, before its trailing
wait) and one wiped-state `ensure_state` call now converges end to end — measured 22:30, trace shows
the tap firing inside `login`. So the skeleton no longer exercises the engine gap; the regression
shape for it lives in this report.

## Recovery pass POSITIVELY verified on device (2026-08-26, synthetic probe)

The interstitial would no longer trigger naturally (its appearance is device-conditioned — it did
not show on a factory-fresh AVD, only on the long-lived one), so the pass was probed with a
synthetic ladder on the real app, zero registration cost: state `probe_recovery` (detect = the type
sheet's save button), `reach: [probe_open_types, probe_open_filter]` where rung 1 needs the filter
sheet that only rung 2 opens. One `ensure_state` call, trace:

```
⚠ reach probe_open_types: failed, escalating to probe_open_filter
flow probe_open_filter: done                     ← last rung COMPLETED, state not reached
↻ recovery probe_recovery: timed out — re-running probe_open_types once (a late screen may need clearing)
flow probe_open_types: ... done
state probe_recovery: reached after recovery probe_open_types
```

So the verdict splits cleanly: **the recovery pass works as shipped for its covered shape**
(last rung completes; the ladder's final wait times out) — and **the one remaining gap is the
last-rung-THROWS shape** (a trailing `wait:` inside the flow, the section above), which is what
real login flows tend to end with. Fix that path and the original incident class is fully closed.

**Closed** in `docs/bugs/2026-08-26-recovery-pass-skips-throwing-last-rung.md`: the throw path now
runs the same bounded pass (plus the last rung's own `detect` re-check, which the rethrow also
skipped). The incident class is fully covered.

## CLOSED (2026-08-27, averi 0.6.0)

The remaining throw-path gap was fixed in 0.6.0 and verified on device — both salvage halves, with
traces, in `2026-08-26-recovery-pass-skips-throwing-last-rung.md` §"Verified on device". Together
with the 0.5.0 recovery pass (positively probed on device 2026-08-26), the incident class this
report opened is fully closed: one `ensure_state` call now converges in every measured shape.
