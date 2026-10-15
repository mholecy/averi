# BUG: on iOS `type_text` cannot type a diacritic or typographic punctuation — the fill fails with idb's raw traceback

**Measured 2026-10-15**, lab simulator `averi-lab iPhone 17` (`3AB1E82E-47C1-4BEF-9F89-1FF62DBBC348`, iOS 27.0,
402×874 pt), averi = mobile-verify `truth/forms-ios` (src as on `truth/phase-0-1` @ `9604314`), through
`scripts/truth/live.ts` (createAveriServer over a real AdapterRegistry, `treeSource: wda`, WDA on port 8120), the lab
app's `form-basic` / `form-keyboard` cells (fixtures/apps/ios, Form.swift). Found by the live golden of phase 1b
(docs/plans/2026-10-15-ground-truth-lab-app.md); the app's own model of the field is the oracle.

## Observed (measured)

```
type_text { selector: 'id:"lab.form-basic.name"', text: 'Jan Šťastný' }
→ ERROR Command failed (exit 1): idb ui text Jan Šťastný --udid 3AB1E82E-…
  2026-10-15 13:20:02,150 [ERROR] - root - Exception thrown in main
  Traceback (most recent call last): … idb/common/hid.py, line 187, in text_to_events
      raise Exception(f"No keycode found for {character}")
  Exception: No keycode found for Š
app model: name = ""   (nothing typed)

type_text { selector: 'id:"lab.form-basic.name"', text: 'O’Brien “Jr.” – Co…' }
→ ERROR Command failed (exit 1): idb ui text O’Brien “Jr.” – Co… … No keycode found for ’
app model: name = ""
```

`idb ui text` maps each character to a US-keyboard HID keycode (`idb/common/hid.py#text_to_events`) and raises on the
first it has none for — before sending anything, so the field is untouched. Reproduced directly: `idb ui text "Šť"` →
`No keycode found for Š`; `idb ui text "’"` → `No keycode found for ’`. The same text the app SHOWS reads back fine:
the static golden's `assert … text:` rows pass on `Jan Šťastný`, `1 234,56` (NBSP) and the P5 titles under idb and
WDA alike — only typing fails.

## Why it matters

The owner verifies a banking app: names (`Šťastný`, `Ľubomír`), addresses and payment notes carry diacritics, and
copy-pasted references carry typographic quotes and dashes. Today no such value can be filled on iOS, and the reply is
idb's Python traceback (with the host's pipx paths), not a sentence an agent can act on. Nothing is typed, so no wrong value lands —
the failure is loud, which is why this is a capability gap with a bad reply rather than a false report.

## Expected

Either type it (a channel that takes Unicode: WebDriverAgent's `/wda/keys` or `/element/…/value` when the WDA
source is up, or the simulator pasteboard — `simctl pbcopy` then a paste — for idb), or refuse BEFORE any device call
in one sentence naming the first character idb cannot type and the workaround (e.g. "idb types only characters of a
US keyboard; `Š` has no keycode — fill an ASCII value, or …"). docs/verification.md (fill semantics) and the
type_text description should say which it is.

## Neighbours

- Android: `input text` takes no non-ASCII either (unmeasured here; phase 2 of the lab app).
- `run_flow`'s `fill:` step goes through the same adapter call (adapters/ios.ts#typeText) — same failure.
