# BUG: the "this rung is DESTRUCTIVE" warning fires on a one-tap flow whose `requires` is already satisfied

> **Status (2026-10-08):** fixed on main in `b2b3d02` (2026-10-06) — the DESTRUCTIVE warning now speaks for the rung's own steps only, so "Why (read from the source)" below describes the code before the fix.

**Measured 2026-10-05 21:26 UTC** in `/Users/mholecy/Finshape/mp-native` (config `averi.yaml`), averi 0.9.0-era tree
(`src/flow/engine.ts`, `src/flow/config.ts` as of `a6df808`), both platforms (emulator-5554 Pixel_3a API 33, iPhone 17
simulator iOS 26.5). Filed from the SWIFT-payment journey-developer run (`debug-ai-logger/2026-10-05-1304-swift-payment/`).

## Observed (measured)

`run_flow { platform: android, flow: goto_swift_payment_form }` printed, verbatim:

```
environment starterkit: overrides: username
⚠ reach goto_payment_type_chooser: this rung is DESTRUCTIVE — it wipes app state, and any device registration with it. If the app is on a RECOVERABLE screen (an inactivity timeout, an expired session), a cheaper non-destructive rung declared BEFORE this one would restore it instead
state account_detail: already active
flow goto_payment_type_chooser: start
tap: id:"accounts.detail.action_pay"
wait: element id:"accounts.detail.payment_type_sheet.row_swift"
flow goto_payment_type_chooser: done
```

The iOS run of the same flow, 0.4 s later, printed the same warning. The flow being warned about is one tap and one wait:

```yaml
goto_payment_type_chooser:
  requires: account_detail
  steps:
    - tap: { id: accounts.detail.action_pay }
    - wait: { element: { id: accounts.detail.payment_type_sheet.row_swift }, timeout: 10s }
```

Nothing destructive ran or could have run: the trace's next line is `state account_detail: already active`, so the
`requires` chain was never entered.

## Why (read from the source)

`src/flow/engine.ts:257` emits the warning `if (flowIsDestructive(this.cfg, flow))`, BEFORE `runFlowInner(flow)`.
`flowIsDestructive` (`src/flow/config.ts:458`) is a static, deliberately conservative policy: it follows `requires`
transitively (`stateReachIsDestructive`). Here `account_detail` → … → `logged_in`, whose last rung is the
`clearState` registration login, so every flow that requires any logged-in state is "destructive".

That is the right answer for the question the function was written for (its own doc: "The only thing it gates is
whether a rung may be re-run in the recovery pass"). It is the wrong answer for the pre-flight warning, which claims
"this rung … wipes app state" about a rung that will only wipe if its `requires` is NOT already met, and that check has
not happened yet when the line is printed.

## Cost

In this config every navigation flow requires a logged-in state, so the warning fires on essentially every
`run_flow` / `ensure_state` that reaches anything. The warning exists to stop the one mistake that has burned device
registrations on this project (2026-08-12, 2026-09-11, 2026-09-16). If it shows on every harmless navigation, people
stop reading it, and then it is not read on the call that does wipe.

## Possible fix directions (owner's choice)

- Warn on the rung's OWN steps only (`stepsAreDestructive(flow.steps)` / `flow.destructive`), and emit a second,
  precise warning at the moment a `requires` actually escalates into a destructive reach (i.e. after the required
  state's `detect` failed). Both halves are then true when printed.
- Or keep one warning but make it conditional on the required state not being detected (probe first, warn second).
- Keep `flowIsDestructive` as is for the recovery-pass policy; only the pre-flight message changes.

## Repro

Any config where state S has `reach: [F]`, `F.requires: T`, `T` is reachable only through a `clearState` flow, and the
device already sits on `T`. `ensure_state S` / `run_flow F` prints the DESTRUCTIVE warning and then
`state T: already active`.
