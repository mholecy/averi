# BUG: an iOS `fill` / `type_text` with an empty value fails in idb after the field was tapped

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

## Fix (2026-10-07, branch `fix/ios-idb-and-keyboard-2026-10-07`, not device-checked)

The first suggestion: `IosAdapter.typeText` returns before idb on `''`, and the `DeviceAdapter.typeText` contract in
`src/adapters/types.ts` now says that an empty string types nothing and does not fail. Not the second, because
`fillField` is one of three callers that hand user text to the adapter unexamined — the flow `type` step
(`engine.ts#runType`) and the `type_text` tool WITHOUT a selector (`tools.ts`) are the other two, and a skip in
`fillField` would have left both throwing the same bare idb error on iOS. The other two call sites are safe as they
were: the fill's retry sits inside `if (value !== '')`, and `type_pin` types one digit at a time. The refusal is idb's,
a platform fact, so the guard sits where the platform lives; `fillField` still hands the `''` over. Android is
unchanged: its per-character loop already ran zero times for `''` (the DPAD commit nudge is still sent, as before —
pinned, so the two adapters' empty-string behaviour is a decision, not an accident).

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
`Environment variable X is set but empty (needed for credential "…" in environment "…") — set it in .env.averi …`,
the unset message's shape. A literal `value: ""` in the YAML never passes through `expand` (`resolve` hands plain
strings through, `secret: false`), so "clear this field" stays writable — pinned at both the credentials and the
engine level. Checked: `expand` has one caller (`resolve`, both the `$name` and the bare `${VAR}` paths), `resolve`
has one (`engine.ts#resolveValue`, behind `type`, `type_pin` and `fill`), and `run/preflight.ts` calls
`resolveCredentials` for the unknown-environment check alone; nothing resolved an empty variable on purpose. An empty
`AVERI_ENV` was already loud (`Unknown environment ""`), and `engine.ts#redact` already skipped a zero-length secret.

Checked and left alone: the read-back and the masked-length rule never ran for `''`; `dismissKeyboard: true` after an
empty fill now runs instead of being skipped by the throw (it is keyboard.ts's and unchanged); the trace line reads
`fill id:"x" = ` and `= (cleared)`, the tool answers `Typed 0 characters` and `Filled id:x (0 characters, cleared
first)`; ARCHITECTURE.md lists `typeText` without semantics. The tests that pin `fillField` handing the `''` to the
adapter are deliberate (said in a comment on each): the guard lives in one place, and a second one in `fillField`
would read as the fix for a bug that is not there.

Pinned by `tests/adapters/ios.test.ts` (`''` makes no idb call; `alice` goes to `idb ui text`),
`tests/adapters/android.test.ts` (the zero-iteration loop), `tests/interact/fill.test.ts` (`''` with clear clears and
passes, and clears what an autofill put in on focus; `''` without clear is the tap alone, no warning on a held masked
field), `tests/mcp/tools.test.ts` (both `type_text` paths with `text: ""`), `tests/flow/credentials.test.ts` (the
empty variable's message; a literal `''` passes through) and `tests/flow/engine.test.ts` (an empty `TEST_PIN` fails
the fill before the tap; a literal `value: ""` with clear clears and passes). The B4 probe — `fill: { id:
twofactor_code, value: "", dismissKeyboard: true }` — is the device check to run.
