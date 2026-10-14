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
profile (screen size; on Android the API 33 Pixel_3a `dumpsys window displays` captures in `tests/fixtures`, keyboard
hidden or shown, `back` hiding it). Every command is logged — what the tool would have sent — and every other way of
starting a process throws, so a run cannot touch a device. Time is virtual (`clock.ts`): the sleeps of averi's one sleep
owner (`src/util/sleep.ts`) move a fake `Date.now` and return at once, so a 12 s pixel poll or a five-stroke
`scroll_until` runs in milliseconds and the same on both sides.

The recorded source is not in `src/` and not an `IosTreeSourceKind`: no averi.yaml can select it. It has to work against
an OLD checkout that predates it, so it takes the side's parser as an argument.

## Running it

```sh
# OLD as a git ref (checked out detached in a temporary worktree, removed afterwards) or a path; NEW defaults to this checkout.
node --import tsx scripts/differential/run.ts --old e1384aa --corpus <corpus dir> --out <report dir> \
     [--new <path>] [--shards N] [--cap N] [--tools tap,scroll_until] [--only <regex on tree id>] [--worktrees <dir>] [--all]
```

`node --import tsx`, not `npx tsx`: tsx's CLI opens an IPC pipe some sandboxes refuse. Git worktrees and the child
processes need a shell that may create them. The run writes `report.md` (counts per tool, the trees with diffs, the diffs
grouped by what changed — numbers and quoted values blurred so one change on many trees is one group, with an example
each), `diffs.jsonl` (every differing call, both outcomes) and, with `--all`, `calls.jsonl` (every call).

On 12 cores a corpus of 384 trees (about 184 000 calls, each on both sides) takes four to five minutes.

Per tree:

1. **Device variants** — iOS: the screen; no screen (`idb describe` fails); with the keyboard in the tree, `tap` again
   under `app.ios.keyboardDismiss: [accessory]` and `[tap: <the first text with a unique label>]`. Android: keyboard
   hidden; keyboard shown (back hides it); no screen (`wm size` fails). The no-screen variant calls `tap` and `assert`
   only, the dismissal variants `tap` only.
2. **Targets** — `ui_snapshot` on both sides; every node either side's tree lets a selector address: a unique identifier
   (`id:"…"`), else a unique text (`text:"…"`, label or value), else its role with either (`role:… text:"…"`,
   `role:… id:"…"`); values holding `"` cannot be written in the grammar.
3. **Calls**, each on both sides with the same arguments, the device and the clock reset before each: per tree
   `ui_snapshot` and `swipe` up/down; per target `tap`, `scroll_until` down, up and down `fully`, `assert` element / colour / ocr (a
   1 s budget each — a static tree keeps its verdict, a longer budget only adds rounds), `type_text` on a textfield.
   The outcome of a call is the reply (text blocks, image sizes, `isError`) and the device calls it made.

The frame a screenshot returns is one grey PNG at half the screen (scale 0.5, inside the pixel asserts' plausible range —
a full 1080×2220 frame costs ~100 ms to decode in pngjs, and no verdict here reads a pixel). OCR reads no
text in any region. So the pixel asserts are compared on whether they may look and how they refuse, not on what they see.

`tests/differential/` runs the harness on a committed sample (three `tests/fixtures` trees, one per raw source kind):
the recorded adapters read like the live ones, OLD = NEW differs nowhere, and a parser change shows where a tool reads it.

## Corpus format

One directory per capture run, one file per tree, and a `manifest.json` (`corpus.ts`):

```json
{
  "platform": "ios",
  "screen": { "width": 402, "height": 874 },
  "device": "iPhone 17 simulator, iOS 27.0",
  "note": "optional",
  "captures": [
    { "file": "D-swift-form.json", "source": "wda", "form": "raw", "app": "Skeleton Internal" },
    { "file": "B2-idb-iban.json", "source": "idb", "form": "normalized" }
  ]
}
```

- `source`: `wda` | `idb` (iOS), `uiautomator` (Android). `form`: `raw` — the payload the source read off the device
  (WDA's `/source?format=json` body, idb's `ui describe-all --json` array, the `uiautomator dump` XML) — or
  `normalized` — a UiNode tree as `ui_snapshot` printed it, replayed without the parser.
- `screen` (in the tree's units: points on iOS, pixels on Android) is what the fake device answers for the screen; a
  capture's own `screen` and `app` override the run's.

The corpus of real device trees stays out of git. `convert.ts` builds one from the device-check scratch directories
(`run<N>-ios`, `run<N>-android`: the `ui_snapshot` JSON a device agent saved, raw WDA `/source` bodies, raw dumps, and
every unfiltered `ui_snapshot` the averi server logged in the run's `session.log`, de-duplicated by content), the
repository's fixtures and the synthetic trees in `synthetic.ts`. WDA's XML `/source` is not taken: no parser reads it.

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

Then add them to a run directory with a manifest (`form: "raw"`), or let `convert.ts` pick them up.

## What it does not cover

The scratch harness this replaces drove averi's internal functions directly; several of its sections ask questions no
tool call can express:

| section | at the tool level | why not, where not |
|---|---|---|
| TAP | yes — `tap` per addressable target, with/without screen, keyboard shown/hidden | nodes no selector can address (duplicate ids and labels); the "sent" sentence and synthetic keyboard lines over trees without one |
| PIXEL | yes — `assert` colour and ocr per target | turned and wider devices: the tree and the device would disagree, a pairing no device check produced |
| ROUNDS | yes — `scroll_until` down, up and down `fully` per target | static plays with a synthetic keyboard cover (corroborated or vetoed), `found` pairs, the band and two-way-screen variants: reducer inputs only a live, moving screen (or a synthetic one) produces; on a static recorded tree a target already in view is found before any stroke |
| GUARD / PICK | yes for iOS trees with the keyboard in them (`tap` under the dismissal configs) and Android's oracle (hidden, shown, back hides) | the synthetic WDA band added to keyboard-less trees; the oracle's denied/unknown witness |
| KEYPOS | no | keyboard-position internals; their effect shows in `tap` and `scroll_until` |
| SEQ | no | the scroll tests' own `round` sequences are unit tests, not trees |
