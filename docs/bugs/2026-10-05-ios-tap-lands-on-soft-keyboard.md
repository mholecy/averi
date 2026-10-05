# BUG: on iOS a tap under the soft keyboard presses the keyboard, and the trace reports it done

Measured 2026-10-05 during the on-device verification of the 2026-10-04/05 series
(`docs/plans/2026-10-05-device-verification-handoff.md`), tree at `56a111f`, finportal `login` flow,
iPhone 17 simulator (iOS 26.5), `app.ios.treeSource: wda`.

**Not a regression of the series.** `git diff c4a2491 HEAD -- src/adapters/ios.ts src/interact/` changes nothing
for iOS behaviour: before the series `IosAdapter.softKeyboard()` answered `unknown` without running anything and
`resolveClearOfKeyboard` acted on nothing; now the adapter has no `keyboard` oracle and
`src/interact/keyboard.ts:361` returns the first resolution unchanged. The gap is older than the series; this run
is the first to hit it.

## Claim

The iOS leg of the handoff's `logged_in` step should stop at the 2FA screen, as it did on the 2026-10-05 baseline
run against `5473982`, with this trace:

```
fill: id:"login_username" = *** (cleared)
fill: id:"login_password" = *** (cleared)
tap: id:"login_submit"
optional: skipped text:"Not Now" (not present)
wait: state post_login_fork
flow login: done
```

## What happened

7 runs of the same flow on the same simulator, one session:

| run | result |
|---|---|
| `ios.json` `logged_in` (after a `fresh_launch` with `clearState`) | ✗ `Timed out after 45000ms waiting for state post_login_fork` |
| `run_flow login` alone, `screenshot` straight after | ✗ same |
| `run_flow login` × 5, a few minutes later | ✓ 5/5 reached `twofactor_*` |

Both failing traces are **identical** to the passing ones up to the wait: both fills land and
`tap: id:"login_submit"` is reported done. Nothing in the trace tells the runs apart.

The screenshot taken straight after a failure (1206 × 2622 px, 402 × 874 pt) shows:

- the password field still focused, with the caret after the 16 masked characters;
- the **software keyboard up**, with the "Passwords" AutoFill bar above the keys; its top edge is at about
  y = 546 pt (measured on the screenshot);
- `login_submit` at `{x: 36, y: 547, w: 109, h: 48}` (from `ui_snapshot` in the same state). Its centre,
  (90, 571), is about 25 pt *inside* the keyboard, in the AutoFill bar.

The tap at the centre therefore hit the keyboard's AutoFill bar. Nothing was submitted, and the flow waited out
its 45 s.

In the passing state, a screenshot after `type_text` into `login_password` shows the field focused with a caret but
**no software keyboard on screen**. The keyboard is still in the WDA tree, but parked off-screen:

```
container  UIKeyboardLayoutStar Preview  {x: 0, y: 874, width: 402, height: 233}   ← y == screen height
other      'q'                           {x: 4, y: 881, ...}
button     'done'                        {x: 300, y: 1043, ...}
```

So the outcome depends on whether the simulator happens to show its software keyboard. The simulator hides it once
it believes a hardware keyboard is typing, and shows it again after a restart or a fresh launch. This is consistent
with the failures coming first, right after `clearState`, and the passes afterwards. The exact trigger was not
isolated. What matters is that averi does not look.

## Code says

- `src/adapters/ios.ts:230` — no `keyboard` oracle: "the iOS keyboard is part of the accessibility tree … so
  'which rect does it cover' is a tree question nobody has needed answered yet".
- `src/interact/keyboard.ts:361` — `if (oracle === undefined) return first;` the target is tapped where it
  stands, wherever the keyboard is.
- `src/interact/keyboard.ts:541` — `dismissKeyboard` presses `enter` on an oracle-less adapter. finportal's `login`
  flow does not ask for a dismissal, and `enter` in the password field would submit the form anyway (a different
  path from the one the flow is meant to test).
- `src/adapters/wda-source.ts:27` — `Keyboard: 'container'`: the WDA tree already carries the keyboard. Its
  rect is the answer the oracle needs. The flat idb AX list (`treeSource: idb`) does not include it.

On Android the same situation was fixed on 2026-10-03 (`KeyboardOracle` docs in `src/adapters/types.ts`, the
finportal submit button under the IME). The iOS half was deferred as "nobody has needed it". This run needed it.

## Change (proposed, not made)

1. **An iOS `KeyboardOracle` read from the tree** (WDA source): `state()` = the rect of the `Keyboard` element (and
   the AutoFill bar above it, if that is a separate node; check on device), `shown` only when that rect
   **intersects the screen**. The measurement above shows the keyboard present in the tree at `y == screen height`
   while hidden, so "a Keyboard node exists" would be wrong. `witness()` could compare a second tree read, or
   answer `unknown` and let the existing policy take its conservative branch. That policy question is for the
   design.
2. **Hiding it on iOS** needs a non-submitting key: `enter` in the last field submits, and a `back` key does not
   exist. Candidates to measure: tapping a neutral point outside every interactive node (the keyboard's
   `Done`/`done` button is not always present), or `idb ui key` for the keyboard-dismiss HID usage. Whichever is
   chosen, the target must be resolved again afterwards, exactly as on Android.
3. On `treeSource: idb` there is no keyboard node. The oracle stays absent there and the behaviour is today's.
   Say so in the tool description.

Before changing `src/`: a unit test in `tests/interact/keyboard*.test.ts` that feeds an iOS adapter a tree whose
`Keyboard` rect covers the target's centre and asserts the tap is not sent to that point. Add a second test with the
keyboard at `y == screen height` that asserts nothing changes.

## Workaround for finportal now

`dismissKeyboard` on the password fill is not a fix on iOS: it presses `enter`, which submits from the field, so the
flow's `tap: login_submit` would then race the submission. A safer stopgap is a `tap` on a neutral, non-interactive
point (for example the `login_title` label) between the last fill and the submit. Deciding that is up to the app's
`averi.yaml`.

## Reproduce

Simulator showing its software keyboard (fresh boot, or after a `clearState` launch), finportal `login` flow via the
handoff's driver. The failure is intermittent by nature: the simulator decides whether the keyboard is shown, and
nothing in averi's trace shows which state the run was in. Take a `screenshot` straight after the flow fails.
