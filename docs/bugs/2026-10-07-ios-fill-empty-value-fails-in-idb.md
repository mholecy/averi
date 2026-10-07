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
