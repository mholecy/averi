# BUG: an iOS `fill` / `type_text` with an empty value fails in idb after the field was tapped

> **Status (2026-10-08):** fixed on main in `5786fc3` (2026-10-07).

**Measured 2026-10-07** during the stage B keyboard device check (`0036762`), finportal, iPhone 17 iOS 26.5
(`D34212DB-…`), scratch config with `treeSource: wda`. Found while trying to focus a field without typing, so that the
keyboard would stay up for `dismissKeyboard: true`. See
[2026-10-05-ios-tap-lands-on-soft-keyboard.md](2026-10-05-ios-tap-lands-on-soft-keyboard.md), "Device check of the fix
(stage B…)", B4.

## Claim

`fill.value` and the `type_text` tool's `text` accept any string (`z.string()` in `src/flow/config.ts` and
`src/mcp/tools.ts`). `interact/fill.ts` expects an empty value: it skips the read-back with `if (value !== '')`. So
`fill: { id: x, value: "", clear: true }` reads as "clear the field", and on Android it does that (`AndroidAdapter.typeText`
loops over zero characters).

## Measured

Flow step `fill: { id: twofactor_code, value: "", dismissKeyboard: true }`, with the number pad up:

```
✗ fill id:"twofactor_code": failed — Command failed (exit 1): idb ui text --udid D34212DB-2134-43E4-99D8-FA89136C729B
('Request was not sent',)
```

It took 3.7 s. The focus tap had already been sent. The pad stayed up, because nothing was typed and the step threw before
the dismissal.

## Code says

`src/adapters/ios.ts#typeText` passes the text straight to `idb ui text <text>`, and idb refuses an empty string.
`fillField` calls `adapter.typeText(value)` unconditionally after the focus tap and the optional clear. So on iOS:
- `value: ""` without `clear` throws after a tap;
- `value: ""` with `clear: true` clears the field and THEN throws, so the step fails although the field ended up as
  asked.

The error is idb's raw text, which names neither the empty value nor the field.

## Suggestion

Return early for an empty string in `IosAdapter.typeText` (`if (text === '') return;`), to match Android's
zero-iteration loop. Alternatively, skip the `typeText` call in `fillField` when `value === ''`, which covers every
adapter. Add a test that pins `fill { value: "", clear: true }` on iOS to clearing and passing. Low severity: no
measured flow uses an empty value. It does block the obvious "focus without typing" probe, and it would block a "clear
this field" step written as `value: ""`.

## Fix (2026-10-07, branch `fix/ios-idb-and-keyboard-2026-10-07`; device-checked below, `5786fc3`)

The first suggestion: `IosAdapter.typeText` returns before idb on `''`, and the `DeviceAdapter.typeText` contract in
`src/adapters/types.ts` now says that an empty string types nothing and does not fail. Not the second, because
`fillField` is one of three callers that hand user text to the adapter unexamined — the flow `type` step
(`engine.ts#runType`) and the `type_text` tool WITHOUT a selector (`tools.ts`) are the other two, and a skip in
`fillField` would have left both throwing the same bare idb error on iOS. The other two call sites are safe as they
were: the fill's retry sits inside `if (value !== '')`, and `type_pin` types one digit at a time. The refusal is idb's,
a platform fact, so the guard sits where the platform lives; `fillField` still hands the `''` over. Android is
unchanged: its per-character loop already ran zero times for `''` (the DPAD commit nudge is still sent, as before —
pinned, so the two adapters' empty-string behaviour is a decision, not an accident).

Follow-up (2026-10-07, later, branch `architecture/keyboard-model-2026-10-07`): the Android nudge no longer goes out
for `''` — `AndroidAdapter.typeText` returns before the loop, as iOS returns before idb, and the pin now expects no
device call. The contract sentence "an empty string types nothing" was not true of two key events and a 150 ms sleep
sent to commit a composition that did not exist; the device-checked behaviour above (E5) is unaffected, since nothing
observable rested on the nudge.

Two more lines in `interact/fill.ts`, one per shape of the empty fill (both from the review of this fix):
- `value: ""` WITHOUT clear — the focus-only probe — skips the post-focus re-read that feeds the masked-append
  warning. A focus-only `fill` on a password field that already held text would otherwise have warned `typing
  APPENDS; pass clear: true to replace` about a typing that never happened.
- `value: ""` WITH clear — "clear this field" — re-reads the field once after the focus tap and counts the clear from
  that, not from the pre-tap tree. A clear alone has no read-back behind it (a clear with a value has: its retry wipes
  whatever the field shows), so a field that autofills on focus (Android, measured 2026-09-18) read as empty before the
  tap, was skipped, and kept the autofilled text — on the one fill whose whole point is an empty field.

A consequence in `flow/credentials.ts`, also from the review: now that `""` types as a no-op on both platforms, a
credential whose variable is set but EMPTY (`PASSWORD=` in `.env.averi` parses to `""`; `expand` threw only on
`undefined`) would have typed nothing, passed, printed `***` in the trace, and been rejected by the bank one screen
later — the 2026-08-06 misdiagnosis shape the module exists to prevent. `expand` now refuses an empty value with
`Environment variable X is set but empty (needed for credential "…" in environment "…") — give it a value in
.env.averi beside averi.yaml, or export it with one; an empty variable exported in the shell or CI shadows the value
in .env.averi, so unset it there, and retry` (the shadowing tail added in review round 2: an exported variable wins
over the file). A literal `value: ""` in the YAML never passes through `expand` (`resolve` hands plain
strings through, `secret: false`), so "clear this field" stays writable — pinned at both the credentials and the
engine level. Checked: `expand` has one caller (`resolve`, both the `$name` and the bare `${VAR}` paths), `resolve`
has one (`engine.ts#resolveValue`, behind `type`, `type_pin` and `fill`), and `run/preflight.ts` calls
`resolveCredentials` for the unknown-environment check alone; nothing resolved an empty variable on purpose. An empty
`AVERI_ENV` was already loud (`Unknown environment ""`), and `engine.ts#redact` already skipped a zero-length secret.

Checked and left alone: the read-back and the masked-length rule never ran for `''`; `dismissKeyboard: true` after an
empty fill now runs instead of being skipped by the throw (it is keyboard.ts's and unchanged); the trace line reads
`fill id:"x" = ` and `=  (cleared)` (two spaces: the empty value between them), the tool answers `Typed 0 characters` and `Filled id:x (0 characters, cleared
first)`; ARCHITECTURE.md lists `typeText` without semantics. The tests that pin `fillField` handing the `''` to the
adapter are deliberate (said in a comment on each): the guard lives in one place, and a second one in `fillField`
would read as the fix for a bug that is not there.

Pinned by `tests/adapters/ios.test.ts` (`''` makes no idb call; `alice` goes to `idb ui text`),
`tests/adapters/android.test.ts` (the zero-iteration loop), `tests/interact/fill.test.ts` (`''` with clear clears and
passes, and clears what an autofill put in on focus; `''` without clear is the tap alone, no warning on a held masked
field), `tests/mcp/tools.test.ts` (both `type_text` paths with `text: ""`), `tests/flow/credentials.test.ts` (the
empty variable's message; a literal `''` passes through) and `tests/flow/engine.test.ts` (an empty `TEST_PIN` fails
the fill before the tap; a literal `value: ""` with clear clears and passes). The B4 probe — `fill: { id:
twofactor_code, value: "", dismissKeyboard: true }` — was the device check; it ran, below.

## Device check of the fix (2026-10-07, `5786fc3`)

finportal, iPhone 17 iOS 26.5 (`D34212DB-…`) and `emulator-5554` (the only Android device attached). The run used
`dist/` built from `5786fc3` through `run-tools.mts`. The config was a scratch copy of the stage B `wdacfg` (`treeSource:
wda`, `keyboardDismiss: [login_title, twofactor_title, accessory]`, with `.env.averi` symlinked), plus helper flows
`fill_code_one`, `fill_code_empty_clear`, `fill_user_empty_clear`, `fill_user_bare_empty_var` (`value:
"${AVERI_EMPTY_PROBE}"`) and `fill_user_cred_empty_var` (`value: $probe`, with a base credential `probe:
${AVERI_EMPTY_PROBE}`). A second copy, `cfg-acc`, keeps only `- accessory: true` in the list. Nothing in finportal was
edited. **Real login submits: 1** (`fill_creds` → `submit_only` → 2FA). No 2FA code was completed, and at most one
digit was typed and then cleared. Server stderr held only the `.env.averi` keys line. The string `Request was not
sent` appears in no output.

- **E1, the B4 probe `fill: { id: twofactor_code, value: "", dismissKeyboard: true }`: PASS, three times.**
  - (a) The pad was parked by the `fill_creds` HID typing (`0 matches for role:keyboard`, toolbar parked) and the field
    was still focused: `ok in 6.4s`, `fill: id:"twofactor_code" = ` with no suffix. The focus tap on the focused field
    opened the "AutoFill" edit menu, and no keyboard came up, so there was nothing to hide. As designed.
  - (b) Tap on the parked `Done`, then the pref toggle (`AutomaticMinimizationEnabled` true → false), then the probe. Its
    focus tap raised the pad: `ok in 6.3s`, `fill: id:"twofactor_code" = ; keyboard hidden by tapping
    id:"twofactor_title"`. After it: `0 matches for role:keyboard`, `0 matches for role:toolbar`, and the field was
    unfocused. With the full list, `login_title` is absent on 2FA, so the second entry was used.
  - (c) Same probe with `cfg-acc` (accessory only). The pad was down and the field unfocused before it: `ok in 4.2s`,
    `fill: id:"twofactor_code" = ; keyboard hidden by tapping the accessory toolbar's "Done"`. Then `0 matches for
    role:keyboard` / `role:toolbar`, and the screenshot shows no pad. **This is the first device run of the accessory
    strategy through `dismissKeyboard`**, which stage B could not reach.
  - That a focus without typing leaves the pad UP was confirmed separately in E3a: a `keyboard` node and a `Toolbar`
    were present, and the screenshot shows the number pad with `Done`.
- **E2, clear: PASS.** `fill_code_one` → `fill: id:"twofactor_code" = 1`, then `value: "1"`. `fill_code_empty_clear`
  → `ok in 5.1s`, `fill: id:"twofactor_code" =  (cleared)`, then `value: null`. The screenshot shows an empty field
  and "Log in" disabled. Then `back_only` → `login_screen`.
- **E3, MCP `type_text` with `text: ""`: PASS.** With selector `id:twofactor_code` → `Filled id:twofactor_code (0
  characters)` (4.3 s), and the pad stayed up. Without a selector, with the field focused → `Typed 0 characters` (0.2
  s). With selector plus `clear: true` → `Filled id:twofactor_code (0 characters, cleared first)`.
- **E4, empty or unset variable: PASS, before any tap** (0.1 s each; the username field's value was unchanged before
  and after). With `AVERI_EMPTY_PROBE=` exported empty in the driver's environment (it is not in `.env.averi`):
  - bare `${VAR}`: `Environment variable AVERI_EMPTY_PROBE is set but empty — give it a value in .env.averi beside
    averi.yaml, or export it with one; an empty variable exported in the shell or CI shadows the value in .env.averi, so
    unset it there, and retry`
  - credential: `Environment variable AVERI_EMPTY_PROBE is set but empty (needed for credential "probe") — …` (same
    tail)
  - The trace was `flow …: start` / `✗ fill id:"login_username": failed — <same message>`.

  With the variable unset: `Environment variable AVERI_EMPTY_PROBE is not set — set it in .env.averi beside averi.yaml,
  or export it, and retry`, and `… is not set (needed for credential "probe") — …`. No `in environment "…"` part was
  printed, because no environment was selected (base credentials).
- **E5, Android regression: PASS.** After `fresh_launch` (finportal, clearState) the fields were empty. (a)
  `fill_user_empty_clear` on the empty field → `ok in 7.4s`, `fill: id:"login_username" =  (cleared)`, `value: null`.
  (b) After `type_text id:login_username "averi"` (`value: "averi"`), the same flow → `ok in 10.1s`, `= 
  (cleared)`, `value: null`. The screenshot shows both fields empty and Gboard up. No submit.
- Cosmetic: the trace line for a cleared empty fill has two spaces, `=  (cleared)`, where the Fix section above says
  `= (cleared)`. That comes from the `= ${value}` + ` (cleared)` join. It appears on both platforms and is harmless.

Cleanup: `AutomaticMinimizationEnabled` was set back to `1`, and the `com.apple.keyboard.preferences` dumps before and
after are identical. No xcodebuild, WebDriverAgent or server from this run is left. Ports 8100–8110 and 8199 are quiet.
The other session's `npm exec averi@0.9.0` (pid 703/1199) was not touched. The iOS app is on the login screen; Android
is on the login screen with empty fields.
