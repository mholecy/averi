# Differential harness

Replays recorded device trees through two checkouts of averi — OLD and NEW — and reports every tool call whose
answer differs. It is how a change that should move behaviour only where intended is checked against every tree a
device check ever saved, without a device.

It depends on each side only through two interfaces (`side.ts`):

- the **tool interface**: the side's own `createAveriServer` over an `AdapterRegistry`, called through an in-memory MCP
  client exactly as `tests/mcp/tools.test.ts` does — the reply an agent would read;
- the **adapter seam**: the side's own adapters over a recorded payload. Nothing behind the tools (standing, scroll
  rounds, tap judgement, the pixel poll …) is imported, so a refactor inside averi needs no change here.

Where the recording meets each side:

| recording | adapter | parser exercised |
|---|---|---|
| iOS, raw WDA `/source?format=json` | side's `IosAdapter` over `RecordedTreeSource` (`recorded-source.ts`), which reads it with the side's `parseWdaSourceValue` — WdaTreeSource's own parse | yes |
| iOS, raw idb `ui describe-all --json` | side's live wiring (`defaultFactory`, kind idb): its `IdbTreeSource` asks the fake device | yes |
| Android, raw `uiautomator dump` XML | side's live wiring: its `AndroidAdapter` asks the fake device for the dump | yes |
| normalized `ui_snapshot` tree, either platform | served as it is (iOS through `RecordedTreeSource`, Android in place of the adapter's tree read) | **no** |

The **fake device** (`fake-device.ts`) is the process boundary: `child_process.execFile` is replaced before either side
loads, and answers `idb`, `xcrun simctl`, `adb` and the OCR recognizer's `swiftc` from the recording and a small device
profile: the screen size; the screenshot frame (grey, one rect painted on request); on iOS the launch commands and
`appinfo` (the recording's app); on Android the `dumpsys window displays` captures in `tests/fixtures` (API 33 Pixel_3a
with the keyboard hidden, docked or floating; API 36 with no IME entry), the `mInputShown` witness and the touchable
region (tests/helpers/android-dumps.ts's Gboard measurements), and `back` hiding the keyboard. Every command is logged —
what the tool would have sent. A command of a known binary the fake does not model is answered with nothing and logged
`UNMODELLED <command>`; the report counts them. Every other way of starting a process, and `fetch`, throws, so a run
cannot touch a device. Time is virtual (`clock.ts`): the sleeps of averi's one sleep owner (`src/util/sleep.ts`) move a
fake `Date.now` and return at once, so a 12 s pixel poll or a five-stroke `scroll_until` runs in milliseconds and the
same on both sides; a run with calls and no virtual sleep warns that the owner has moved.

The recorded source is not in `src/` and not an `IosTreeSourceKind`: no averi.yaml can select it. It has to work against
an OLD checkout that predates it, so it takes the side's parser as an argument.

## Running it

```sh
# OLD and NEW each a git ref (checked out detached in a temporary worktree, removed afterwards) or a path;
# NEW defaults to this checkout. One checkout on both sides is refused: its modules would be compared with themselves.
node --import tsx scripts/differential/run.ts --old e1384aa --corpus <corpus dir> --out <report dir> \
     [--new <ref | path>] [--shards N] [--cap N] [--tools tap,scroll_until] [--only <regex on tree id>] [--worktrees <dir>] [--all]
```

`node --import tsx`, not `npx tsx`: tsx's CLI opens an IPC pipe some sandboxes refuse. Git worktrees and the child
processes need a shell that may create them. The run writes `report.md` (counts per tool, unmodelled device commands,
the trees with diffs, the diffs grouped by what changed — numbers and quoted values blurred so one change on many trees
is one group, `device calls only` when the replies agree, with an example each), `diffs.jsonl` (every differing call,
both outcomes) and, with `--all`, `calls.jsonl` (every call).

On 12 cores a corpus of 479 trees (about 245 000 calls, each on both sides) takes about five and a half minutes.

Per tree:

1. **Device variants**
   - iOS: the screen; no screen (`idb describe` fails); with the keyboard in the tree, `tap` again under
     `app.ios.keyboardDismiss: [accessory]` and `[tap: <the first text with a unique label>]`.
   - Android: keyboard hidden; docked (back hides it); floating; API 36 with the keyboard shown by the input method but
     no IME entry in the window state; no screen (`wm size` fails).
   - Both: `real scale` (the frame at 3× on iOS, 1× on Android) and `other screen` (an iPhone 17 Pro Max, 430×932; a
     1080×2400 phone — a device that differs from the tree), on the first three targets, `tap` and the colour assert.
   - The no-screen variant calls `tap` and `assert`; the dismissal variants `tap`; floating and API 36 `tap` and
     `scroll_until`. Every other frame is at half the screen (scale 0.5, inside the pixel asserts' plausible range):
     a 1080×2220 frame costs ~100 ms to decode in pngjs.
2. **Targets** — `ui_snapshot` on both sides; every node either side's tree lets a selector address: a unique identifier
   (`id:"…"`), else a unique text (`text:"…"`, label or value), else a unique `label:` or `value:`, else its role with
   text or id (`role:… text:"…"`, `role:… id:"…"`); values holding `"` cannot be written in the grammar.
3. **Calls**, each on both sides with the same arguments, the device and the clock reset before each:
   - per tree: `ui_snapshot`; `swipe` up and down; one `tap` per text more than one node carries (the many-matches
     path); on a raw iOS tree `launch_app` (its foreground wait asks the source which app the tree is of);
   - per target: `tap`; `scroll_until` down, up and down `fully`; `assert` element, colour and ocr (a 1 s budget each —
     a static tree keeps its verdict, a longer budget only adds rounds); `type_text` on a textfield.
   - A colour assert's target is painted its own colour in the frame (at the frame's scale) and the assert expects
     that colour: sampling another rect, or the right rect at the wrong scale, fails. OCR reads no text in any region,
     so the ocr assert is compared on whether it may look and how it refuses.
   - The outcome of a call is the reply (text blocks, image sizes and content hashes, `isError`) and the device calls
     it made.

`tests/differential/` runs the harness on a committed sample — two `tests/fixtures` payloads (a raw WDA source, a raw
idb list) and a Compose dump from `tests/helpers/android-dumps.ts` — and checks that the recorded adapters read like the
live ones, that OLD = NEW differs nowhere, that a parser change shows where a tool reads it, that a device-only change
groups as `device calls only`, and that a colour assert passes on its own painted target. The converter's tests cover
`session.log` extraction, the classification of each file, de-duplication, and the names a raw payload and its saved
`ui_snapshot` take side by side.

## Corpus format

One directory per capture run, one file per tree, and a `manifest.json` (`corpus.ts`). The directory's name is the run —
the manifest names none — and a tree's id in a report is `<run>/<file>`:

```json
{
  "platform": "ios",
  "screen": { "width": 402, "height": 874 },
  "device": "iPhone 17 simulator, iOS 27.0",
  "note": "optional",
  "captures": [
    { "file": "D-swift-form.json", "source": "wda", "form": "raw", "app": "Skeleton Internal" },
    { "file": "B2-idb-iban.snapshot.json", "source": "idb", "form": "normalized" }
  ]
}
```

- `source`: `wda` | `idb` (iOS), `uiautomator` (Android). `form`: `raw` — the payload the source read off the device
  (WDA's `/source?format=json` body, idb's `ui describe-all --json` array, the `uiautomator dump` XML) — or
  `normalized` — a UiNode tree as `ui_snapshot` printed it, replayed without the parser.
- `screen` (in the tree's units: points on iOS, pixels on Android) is what the fake device answers for the screen; a
  capture's own `screen` and `app` override the run's.

The corpus of real device trees stays out of git. `convert.ts` builds one from the device-check scratch directories
(`run<N>-ios`, `run<N>-android`, subdirectories included), each file classified by its content: raw WDA `/source`
bodies, raw idb `describe-all` lists, raw dumps, saved `ui_snapshot` trees, and every unfiltered `ui_snapshot` the
averi server logged in the run's `session.log` — all de-duplicated by content across the runs. It also takes the
repository's fixtures and the synthetic trees in `synthetic.ts` (among them two raw WDA captures whose status-band
header beneath a presented screen is given an identifier, so a selector reaches it). Skipped, with the reason in the
manifest's `note`: WDA's XML `/source` (no parser reads it), filtered snapshots, and files that hold no tree.

A device-run file's name in the corpus (`convert.ts#corpusName`) is its path, subdirectories flattened into it
(`F1poll/1.json` → `F1poll.1.json`), with an extension that says what it holds:

- a raw payload is `<name>.json` (WDA, idb) or `<name>.xml` (a `uiautomator` dump) — a `.txt` or `.raw` takes the one
  of its content;
- a normalized tree saved as `.json` keeps its name; saved under any other extension (`.txt`, `.raw`, `.xml`) it is
  `<name>.snapshot.json`. So a raw payload saved beside the `ui_snapshot` of the same screen under the same name, as
  below (`acct2.xml` beside `acct2.txt`, `contacts-list-wda.json` beside `contacts-list-wda.txt`), is kept as two trees
  — `acct2.xml` and `acct2.snapshot.json` — and a normalized Android tree is never named `.xml`;
- a tree the server logged is `session-<call>.json`.

The ids of normalized trees saved as `.json` are what they were before this rule; those saved under another extension
moved, so an id quoted before it now reads `….snapshot.json` (`run14-ios/B1-idb-swift.json` is
`run14-ios/B1-idb-swift.snapshot.json`; run11–run14 Android's `snap*.xml` are `snap*.snapshot.json`).

A raw payload saved as `.txt` or `.raw` beside a different `.json` of the same name (`x.txt` holding a WDA body
beside `x.json`) still fails the conversion (`duplicate corpus file x.json`): rename one.

**Rebuilt runs are not device captures.** A run may hold raw payloads REBUILT from normalized trees — the corpus's
`rebuilt-idb-ios` holds an idb `describe-all` list rebuilt from each normalized idb tree (idb's normalization maps
element by element, so the inverse is exact up to the type within a role and minus the parser's own marks, such as a
field's `error`: 41 of its 94 trees carry such marks from the parser that read them, so an OLD parser gives back 53 of
the 94 exactly). Such
a run says so in its manifest (`device` and `note`, and each capture's `note`), and every tree in it is also in its own
run as normalized: it lets an idb parser change show where no raw payload was saved (the IBAN `_error` pairing), but
it is no evidence of what a device sends. `report.md` lists each run replayed with what its manifest says it is. `convert.ts` does not build it: the script that does is kept in the run's
directory, outside the repository like the corpus.

```sh
node --import tsx scripts/differential/convert.ts --runs <dir of run<N>-* dirs> --repo . --out <corpus dir>
```

## Saving raw payloads in a device check

A normalized tree hides every parser change: the harness can only replay what the parser already made of it. A device
check should save, next to each tree it reads, the raw payload the tree source returned:

- iOS WDA: `curl -s 'http://127.0.0.1:<port>/source?format=json' > <name>.json` (session-less, as the fixtures
  `tests/fixtures/wda-capture-*.json` were captured; averi gives the first simulator port 8100, the next 8101 —
  adapters/wda.ts#wdaPortFor), right after the `ui_snapshot` of the same screen;
- iOS idb: `idb ui describe-all --json --udid <udid> > <name>.json`;
- Android: `adb -s <serial> exec-out uiautomator dump /dev/tty > <name>.xml` (the trailing status line is fine —
  the converter keeps the XML as is and the adapter strips it).

Then add them to a run directory with a manifest (`form: "raw"`), or let `convert.ts` pick them up — the raw payload
and the saved `ui_snapshot` under the same name are both kept (the naming rule above).

## What it does not cover

The scratch harness this replaces drove averi's internal functions directly; several of its sections ask questions no
tool call can express:

| section | at the tool level | how, and what not |
|---|---|---|
| TAP | **covered** for addressable nodes | `tap` per target, screen / no screen, Android keyboard hidden / docked / floating / API 36, iOS dismissal configs, many-matches texts. Not: nodes no selector addresses (no unique id, text, label, value or role pairing — the unlabelled headers and content containers); the "sent" sentence variant; a synthetic keyboard line over trees without one. The status-bar sentence beneath a presented screen in particular: the real status-band headers of the device trees (`0,0 402x102`, `0,0 402x116`) carry no identifier or label, so no selector addresses them, and it is covered only on the two synthetic header-id trees |
| PIXEL | **covered** for addressable nodes | `assert` colour (on a painted target) and ocr per target, with and without a screen, at real scale and on another screen for the first three. Not: the turned device; OCR content (the fake recognizer reads no text) |
| ROUNDS | **partly** | `scroll_until` down, up and down `fully` on the recorded static tree with real strokes. Not: plays with a synthetic corroborated or vetoed keyboard cover, `found` pairs, the band and two-way-screen variants — reducer inputs a static recorded tree cannot produce |
| GUARD | **partly** | `tap` under the iOS dismissal configs on trees with an in-tree keyboard; Android's oracle hidden, docked, floating, API 36 (no IME entry), back hides. Not: the synthetic WDA band on keyboard-less iOS trees; a witness that answers unknown |
| PICK | **partly** | the dismissal tap inside `tap` under `[tap: first unique text]` — one candidate per tree, not every non-interactive node |
| KEYPOS | **not covered** | keyboard-position internals; their effect shows in `tap` and `scroll_until` |
| SEQ | **not covered** | the scroll tests' own `round` sequences are unit tests, not trees |

Tools not called: `run_flow`, `ensure_state` and `verify` need an averi.yaml with states and flows written for the
app on screen, and drive several screens — a static recorded tree is one; `press_key`, `terminate_app`,
`open_deep_link`, `install_app`, `get_logs`, `list_devices` and `select_device` read no tree (one device command
each, or none); `screenshot` would return the fake's grey frame.
