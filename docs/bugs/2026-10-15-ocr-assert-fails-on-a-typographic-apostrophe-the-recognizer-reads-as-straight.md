# BUG: the ocr assert compares a typographic apostrophe (’, U+2019) literally, but the recognizer reads it as a straight one (', U+0027) — an expected text copied from the tree fails on a field that shows exactly that text

**Measured 2026-10-15 09:17 UTC** on the iPhone 17 simulator, iOS 27.0, averi `arch/round-18` @ `dda435b`, `treeSource: wda`, mp-native SWIFT form.

## Symptom


The form's label is `Payee’s name` (with U+2019) — so says the tree (`text 'Payee’s name' v='Payee’s name' 42,816 103x22`, `swift-rest.txt`) and so is it drawn (`img-43-0.png`). An ocr assert with that text, copied from `ui_snapshot`, fails though the recognizer read the right words:

```
#41 assert ocr { element: { id: "swift_payment.form.payee_name_input" }, text: "Payee’s name" }
→ FAIL  element id:"swift_payment.form.payee_name_input" renders text "Payee’s name" — read "Payee's name"; vs expected "Payee’s name" ≠
#44 … text: "Payee's name"
→ PASS  element id:"swift_payment.form.payee_name_input" renders text "Payee's name" — read "Payee's name"; vs expected "Payee's name" =
```

The two quoted strings in #41's reply differ only in the apostrophe, which is hard to see in the reply; nothing in it names the difference.

## Repro


1. iOS (WDA or idb), mp-native SWIFT form, `payee_name_input` drawn (here 74% drawn at `23,740 356x54`, `swift-straddle2.txt` #39; the text line `y 755–777` lies wholly in the drawn part).
2. `assert` ocr on `id:swift_payment.form.payee_name_input`, text `Payee’s name` (U+2019) → FAIL; with `Payee's name` (U+0027) → PASS.

## Evidence


- `session.log` #41 (09:17:33), #44 (09:17:55); `swift-straddle2.txt`, `img-43-0.png`.
- Round 17's ocr asserts with `’` (`Payee’s street` #36, `Payee’s bank country*` #24, `Payee’s bank street & no.*` #51) all failed closed before comparing, so this did not show up there.

## Expected


Typographic and straight apostrophes (and likely other look-alike punctuation the recognizer folds: ‘ ’ ʼ ′, “ ” vs ", – — vs -) compare equal — the recognizer cannot tell them apart in most fonts — or, at least, a mismatch that differs only in such characters says so (`… differs only in ’ vs '`).

## Suspected cause


The ocr comparison normalises case/whitespace (not checked) but not Unicode punctuation; Vision's recogniser returns ASCII `'` for U+2019.
