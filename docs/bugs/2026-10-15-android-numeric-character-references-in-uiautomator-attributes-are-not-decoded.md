# Android: numeric character references in uiautomator attributes are not decoded (`&#10;` stays literal in label/text)

**Found:** 2026-10-15, round 18 device check at `dda435b`, emulator-5554 (API 33), Google Contacts (Organize tab).

## Symptom


A `content-desc` that holds a newline is dumped by uiautomator as `&#10;`. averi's tree keeps those five characters
literally instead of decoding them to `\n`:

- raw dump `contacts1.xml`: `content-desc="Signed in as <account name> <account e-mail>&#10;Account and settings."`
- `ui_snapshot` (#23, `contacts1.txt`): `"label": "Signed in as <account name> <account e-mail>&#10;Account and settings."`

So a selector or assert written with the real string never matches, and one written with the XML escape does. In #25,
one `assert` call:

```
FAIL  element label:"Signed in as <account name> <account e-mail>\nAccount and settings." exists — not found within 3 s
PASS  element label:"Signed in as <account name> <account e-mail>&#10;Account and settings." exists
```

(The first assert's JSON carried a real newline, `\n`.)

Named entities are decoded (`text="Wallpaper &amp; style"` shows as `Wallpaper & style` in `settings1.txt`). So only
numeric references (`&#10;`, `&#9;`, `&#13;` and any other `&#N;` / `&#xN;` the serializer writes) are affected.

## Cause (by reading, not changed)


`src/adapters/android.ts` `parseUiautomatorXml` builds `new XMLParser({ ignoreAttributes: false,
attributeNamePrefix: '', isArray })` (fast-xml-parser 5.9.3). With these options the parser decodes the five XML named
entities but leaves numeric character references as they are. Android's serializer writes control characters, newline
among them, as numeric references in attribute values.

## Impact


- Any Android node whose text or content description spans lines (multi-line labels, `TextView` text with `\n`) is
  listed, matched and reported with a literal `&#10;`.
- `text:"…"` and `label:"…"` exact selectors and `exists`/`text` asserts written from what the user sees fail with a
  plain "not found", with no hint. `ui_snapshot` shows the escaped form, so an agent may copy it into a test and make
  that test depend on the XML encoding.
- The ocr assert compares against what is rendered, so an `ocr.text` copied from the tree would carry `&#10;`. That
  path is not exercised here.
- iOS (WDA JSON, idb JSON) is not affected by this path; not checked on device in this run.

## Expected


Decode numeric character references in uiautomator attribute values, so the tree, selectors and asserts see `\n`, as
the same string does on iOS. One possible fix is the parser's HTML/numeric entity option, or a decode step in
`normalizeNode`. Add a fixture with `&#10;` in `text` and `content-desc`.

## Evidence


`run18-android/contacts1.txt` + `contacts1.xml` (#23), `session.log` #25, `img-24-0.png`. The dump holds the
signed-in Google account's e-mail; keep it out of commits.
