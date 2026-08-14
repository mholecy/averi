# averi — on-device verification for AI coding agents

averi is an [MCP](https://modelcontextprotocol.io) server that gives a coding agent hands on **iOS Simulators and Android Emulators**: launch the app, tap, type, read the screen, assert, screenshot. Its differentiator is `ensure_state` — the project checks in an `averi.yaml` describing app states (like *logged in*) and how to reach them, so the agent gets past login and deep into the app **deterministically**, instead of fumbling through it tap by tap on every task.

averi itself is project-independent: it ships only tools. Everything app-specific — states, flows, credentials — lives in **your app repo**.

## How it works

```
agent ──MCP──▶ averi server ──adb / simctl+idb──▶ emulator / simulator
                    │
                    ├── averi.yaml   (in YOUR repo: states, flows, selectors)
                    └── .env.averi   (in YOUR repo, gitignored: credential values)
```

1. Both platforms' accessibility trees are normalized into one model, so one selector language (`id:`, `text:"…"`, `role:`) and often **one yaml** drives both OSes (per-platform step overrides where they differ).
2. `ensure_state("logged_in")` checks the screen against the state's `detect:` element; if it doesn't match, it runs the state's `reach:` flow (e.g. `login`) and confirms. Idempotent — costs ~1 s when already there.
3. Credential values never live in yaml — `${ENV_VAR}` references resolve from the environment, with a gitignored `.env.averi` next to averi.yaml auto-loaded (real env vars win, so CI injects secrets normally). Values are redacted (`***`) from every trace and error.
4. Verification is tiered: element asserts (deterministic, cheap) → screenshots for the agent to look at → pixel-diff against stored baselines. Geometry and fills are never eyeballed: a `rect` assert checks one element against Figma-frame values, a `color` assert samples its fill against an expected hex (CIEDE2000), an `ocr` assert reads back the text an element actually renders (the accessibility tree often does not carry it), and `verify` with a layout contract prints per-anchor geometry, color and text/type-size tables — numbers over impressions (see [Layout contracts](#layout-contracts--geometry-with-numbers)). Every flow response reports `appAlive` with a crash-log excerpt if the app died.

## Requirements

- Node 20+
- **Android**: `adb` on PATH (Android SDK platform-tools), an emulator running. Works on macOS, and nothing in the Android path is macOS-specific — Linux/Windows should work but are untested.
- **iOS**: **macOS only** (Apple ships simulators only with Xcode). Xcode, a booted simulator, and `idb`:
  `brew install idb-companion && pipx install fb-idb --python python3.13` (fb-idb breaks on 3.14).
  If `xcode-select -p` points at CommandLineTools, averi injects `DEVELOPER_DIR` itself — no sudo needed.
- `verify`'s default (both platforms) needs a Mac. Everything else degrades per platform: on a Linux/Windows box you get the full Android toolset — including `verify` with `platforms: ["android"]`; iOS tools error only when called.

## Installation (in your app repo)

averi is on npm, so there is nothing to clone or build — `npx` fetches it on first use.

Set up three things in the **app repo root** (`averi.yaml` and `.env.averi` must sit in the directory the agent session runs from):

1. Register the MCP server — two ways, same result. Either way Claude Code runs the server with your **repo root as its working directory**, which is how averi finds the config below; no paths need configuring in averi itself.

   **For yourself:**

   ```bash
   claude mcp add averi -- npx -y averi
   # add --scope user to enable averi in all your projects at once
   ```

   **For the whole team** — `.mcp.json` at the repo root, committed (teammates get a one-time approval prompt):

   ```json
   {
     "mcpServers": {
       "averi": { "command": "npx", "args": ["-y", "averi"] }
     }
   }
   ```

   For a team, pin the version (`averi@0.1.0`) so everyone runs the same build.

2. `.gitignore` entry for `.env.averi`, then create that file with the test credentials your login flow needs. Variable names are yours to choose — they only have to match the `${...}` references in `averi.yaml`:

```
APP_USERNAME=...
APP_PASSWORD=...
```

3. The agent skill — copy `skill/SKILL.md` to `.claude/skills/averi/SKILL.md` (or your agent's equivalent) so the agent knows the golden path: build → install → `ensure_state` → navigate → assert → `verify`.

Restart the agent session; it now has 18 `averi` tools (`list_devices`, `select_device`, `install_app`, `launch_app`, `terminate_app`, `open_deep_link`, `screenshot`, `ui_snapshot`, `tap`, `swipe`, `scroll_until`, `type_text`, `press_key`, `ensure_state`, `run_flow`, `assert`, `verify`, `get_logs`). Notes: tools target the **first booted device** per platform unless you pin one with `select_device` (with a phone, an emulator, and a watch emulator all connected, pin it — the pick is otherwise arbitrary, and a pinned device going offline is an error, never a silent fallback); averi never builds your app — your normal build produces the `.apk`/`.app`, whose path in `averi.yaml` is what `install_app` installs; `verify` runs the same state/flow/asserts on the requested platforms (`platforms:` array, default **both**; legs always run android-then-ios) and returns per-platform screenshots; screenshot baselines auto-create under `.averi/baselines/` on first use (delete one to re-baseline).

## Let the agent write `averi.yaml` for you

You don't hand-author the login flow — **the agent bootstraps it by driving your app**. With a booted device and the dev build installed, prompt your agent:

> Using the averi tools, author an `averi.yaml` for this repo. Launch the app with `clearState`, and at each screen use `ui_snapshot` (and `screenshot` when unsure) to find stable selectors — prefer `id:`, else exact visible `text:` (text selectors are locale-sensitive: pin the device language they were captured in). Walk the full login using the test credentials from `.env.averi` (reference them as `${VARS}` in yaml, never paste values). Record every screen as flow steps; wrap dismissable interstitials (permission dialogs, promos) in `optional:`. Define a `logged_out` state (first screen after clearState) and a `logged_in` state (a stable element on the home screen) with `reach: [login]`. Then prove it: run `ensure_state("logged_in")` twice — once from a cleared app (full flow) and once already logged in (must detect in ~1 s) — and iterate on the yaml until both pass.

The yaml is code: it lives in the repo, and when navigation changes and a flow times out, the agent fixes the descriptor as part of the change. Real-world quirks the schema already covers: per-platform steps (`android:`/`ios:`), keypads whose digits have no resource-ids (`type_pin` with `text_pattern: "{digit}"`), auto-advancing OTP boxes (per-digit typing built in), and `branch:` for state-dependent paths (e.g. Keychain-surviving PIN login on iOS).

### Give your screens stable ids — it pays off immediately

averi can only select what the accessibility tree exposes. Screens without identifiers force `text:"…"` selectors, which are **locale-fragile** (break the moment the device language changes) and **blind to which component** rendered the text. Stable ids make flows locale-proof and asserts component-precise — on **both platforms**:

- **Android (Compose)**: `Modifier.testTag("login_submit")` — and note it only surfaces as a `resource-id` averi can see if the app sets `testTagsAsResourceId = true` on the semantics tree (`Modifier.semantics { testTagsAsResourceId = true }` at the root).
- **iOS (SwiftUI/UIKit)**: `.accessibilityIdentifier("login_submit")`.

Adding ids to every **new** feature screen as you build it is cheap; retrofitting an entire app is not. Make it part of the definition of done — it also improves real accessibility tooling.

> **Resolved (2026-08-12) — React Native on iOS.** RN sets `testID` → `accessibilityIdentifier` on the
> *host view*, but the accessibility *element* iOS publishes for static text (and plain containers) is a
> child that carries no identifier — and `idb ui describe-all`, averi's **default** iOS tree source,
> returns only accessibility elements. On the RN repro screen (MyPort, iPhone 17 / iOS 26.5) idb saw
> **6 elements, all `AXUniqueId: null`**. The fix is one line in `averi.yaml` —
> `app.ios.treeSource: wda` — which routes only the iOS *tree read* through WebDriverAgent (16.1.7,
> pinned devDependency `appium-webdriveragent`); taps, typing, and app lifecycle stay on idb/simctl.
> WDA's `/source` reads the id off the host view, so `id:` resolves on static text **and** the plain
> container — verified on-device end-to-end through the adapter on the repro screen
> (`id:placeholder_screen` → container, `placeholder_title`/`placeholder_status` → text; idb control on
> the same screen: 0 hits). Native projects need no change: the default stays `idb`, and the full
> skeleton states regression (login registration + transactions_list) passed on-device with **both**
> `treeSource: idb` and `wda` the same day, as did active WDA-backed navigation (tab taps + waits:
> transactions_list, account_detail).
>
> `wda` stays **opt-in**: on the same deep screen (transactions list visible), idb `describe-all`
> median 167 ms vs WDA `/source` median 322 ms (first call after start ~2.9 s) — ~2× slower per read,
> so no `auto` promotion for now; these numbers are the basis for that deferred decision. Operational
> notes: the first WDA build per Xcode version takes **minutes** (then cached in
> `DerivedData/averi-wda`) — the server start announces it on stderr, and build/start failures name
> the xcodebuild log. A simulator runs **one** XCTest UI-test session at a time: a WDA started by
> another process/session is refused loudly, never silently adopted (`/status` carries no UDID, so
> identity cannot be verified). Recovery: `pkill -f WebDriverAgentRunner` or reboot the simulator.

### Minimal `averi.yaml`

```yaml
app:
  # activity is optional but set it if your debug build bundles LeakCanary: without it,
  # launches resolve the launcher activity via monkey, which picks ARBITRARILY among the
  # package's launcher activities — and LeakCanary registers one, so it may open instead.
  android: { package: com.example.dev, apk: app/build/outputs/apk/dev/debug/app.apk, activity: .MainActivity }
  ios:     { bundleId: com.example.dev, app: build/Debug-iphonesimulator/Example.app }

credentials:                 # env refs only — values come from .env.averi / real env
  password: ${APP_PASSWORD}

states:
  logged_out:
    detect: { element: { text: "Welcome!" } }
  logged_in:
    detect: { element: { text: "Accounts" } }
    reach: [login]

flows:
  login:
    steps:
      - launch: { clearState: true }
      - wait: { element: { text: "Welcome!" }, timeout: 15s }
      - tap: { text: "Log in" }
      - tap: { role: textfield }
      - type: { value: $password }
      - tap: { text: "Continue" }
      - optional:
          - android: { tap: { id: permission_allow_button } }   # Android 13+ notifications
      - wait: { state: logged_in, timeout: 20s }
```

Non-launcher entry points (Android only): a flow's `launch:` step can name a specific activity
and intent — `launch: { activity: .ShareActivity, intent: { action: android.intent.action.SEND,
mimeType: image/png, extras: { ... } } }` — to exercise share-sheet or other deep-entry paths
that never pass through the main activity. iOS has a single entry point; use deep links there.

### One app, several backends

When the same app is pointed at different backends, the credentials usually differ in one key — the
login name — while the password/OTP/PIN are shared. Declaring that explicitly beats swapping a single
env var by hand, because **the wrong login name is rejected one screen AFTER it is typed**, so an
environment mix-up looks exactly like a credentials problem (this cost an hour on a real project).

```yaml
credentials:                 # base: shared by every environment
  username: ${APP_USERNAME}
  password: ${APP_PASSWORD}

environments:                # per-backend overrides, layered ON TOP of `credentials`
  dev:
    credentials:
      username: ${DEV_USERNAME}
  staging:
    credentials:
      username: ${STAGING_USERNAME}

defaultEnvironment: dev      # optional
```

Selection, most specific first: the tool's `environment` argument → `$AVERI_ENV` (set it in
`.env.averi`, so switching backend is one line in an already-gitignored file) → `defaultEnvironment:`
→ base `credentials:` alone. Only `ensure_state`, `run_flow` and `verify` take the argument —
they are the tools that run flows.

`ensure_state`/`run_flow` print the active environment and which keys it overrode as the first trace
line, so the run's provenance is visible without printing any value. An unknown environment name fails
before the device is touched, and a missing env var names both the credential and the environment that
needed it.

Forms & validation (added 2026-08-05, dogfooded on a real cross-platform payment form):

```yaml
flows:
  check_validation:
    requires: payment_form
    steps:
      - scroll_until: { element: { id: submit_button } }   # swipe until visible — no coordinates
      - tap: { id: submit_button }                          # dirty submit
      - assert:                                             # inline checks mid-flow
          - { element: { text: "Required" } }
      - fill: { id: amount_input, value: "1.00", clear: true }  # focus + clear + type in one step
      - assert:
          - { element: { text: "Required" }, absent: true }
```

- **`absent` semantics** (assert + state `detect:`): an element is absent when it is *not in the tree, or its rect does not intersect the visible viewport*. This is the one portable meaning — Android prunes off-screen nodes from its tree while iOS keeps them with off-viewport rects, so a raw tree check would pass on one platform and fail on the other for the same screen. (Behavior change for iOS `absent` asserts, which previously only checked tree presence.)
- **`fill`** clears opt-in only: typing APPENDS on both platforms, but dev flavors may pre-fill login fields that must survive. Fills are verified against a fresh accessibility tree when the field exposes its text — a clear-fill that lands wrong is wiped and retyped once; a no-clear fill never destroys existing content (it fails loudly instead). Android types one character per `input text` call: bulk injection races Compose's async state and drops most characters (measured 3 of 11 landing).
- **Field errors**: `ui_snapshot` attaches `error` to an input when the platform exposes the association (iOS: a same-identifier text below the field — the SwiftUI convention when titles/errors share the field's `accessibilityIdentifier`); assert with `{ element: { id: amount_input }, error: "Required" }`.
- **Tap disambiguation**: when a selector matches several nodes and exactly one is interactive (button/textfield/switch/…), `tap`/`fill` target that one and say so in the trace. Several interactive matches stay an error.

### Layout contracts — geometry with numbers

The screenshot judge cannot see a 46-vs-24pt margin or a 1.81-vs-1.60 aspect ratio — geometry is
arithmetic, so averi checks it with numbers (a port of the convergence superrepo's `rect-parity.py`,
consuming averi's own normalized UI tree). Two entry points, no new tool:

- **One element** — a `rect` assert spec:
  `{"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}}`. Expected values are
  Figma-frame units; both sides are normalized to **% of screen width** before comparing (default
  tolerance 2%). `y` is measured and reported but **never fails**: absolute y drifts between devices
  with different aspect ratios from geometry alone.
- **Whole screen** — `verify` with `contract: path/to/contract.json`: after the legs run, each leg's
  UI tree is compared per anchor and a `## rect parity` table is appended — per-field deltas vs the
  contract and android-vs-ios, **gap-to-previous-anchor** rows for vertical position (local,
  aspect-independent — this is why absolute y never fails), aspect-ratio spread, and MISSING anchors
  listed separately with their likely causes.

```json
{
  "screen": "transactions.list",
  "figma_frame_width": 393,
  "tolerance_pct": 2.0,
  "anchors": [
    { "id": "transactions.list.pill_bar", "x": 24, "y": 247, "w": 345, "h": 32 },
    { "id": "transactions.list.row_0", "x": 24, "w": 345 }
  ]
}
```

Anchor ids are the elements' test identifiers (identical on both platforms — see the stable-ids
section above); omitted fields are compared platform-to-platform only, never against the contract.

**Color, same contract file** (a port of the superrepo's `color-parity.py`, live-validated on
device 2026-08-14): anchors may additionally carry `bg` (expected fill, `#RRGGBB` or `#RRGGBBAA`
— alpha dropped), `bg_dark` (the dark-theme counterpart — **carried, not yet exercised**:
`verify` always runs the light axis, because averi cannot switch device themes and sampling a
light capture against dark hexes would fake evidence; `bg_dark` waits for the dark-mode round,
which needs a theme input plus a device actually captured in dark mode) and `sample` (`"dominant"`, the default —
mode of the region after a 12% edge inset, reported as the winning bucket's mean — or
`"patches"`: 4 corners + center, for busy centers). When any anchor opts in, `verify` samples
each leg's final screenshot at the anchors' tree rects and appends a `## color parity` table next
to `## rect parity`:

```json
{ "id": "payment.form.debit_select", "x": 24, "y": 106, "w": 345, "h": 129,
  "bg": "#FDFDFD", "bg_dark": "#363644", "sample": "dominant" }
```

```
anchor                                   android       ios  dE(a,i)  dE(a,c)  dE(i,c)  verdict
payment.form.debit_select                #CFCFD3   #FDFDFD    10.19    10.19     0.00  FAIL
```

Deltas are CIEDE2000. Android-vs-ios is the **primary** axis (tolerance `tolerance_de`, default
8); each platform vs the contract hex runs at 1.5× that — deliberately looser, because the app
background is a gradient and translucent fills composite differently per y-position, so both
devices drift off the contract hex together while staying close to each other. The calibration
point is the real 2026-08-13 bug (`base.color4` grey vs `base.color1` white = dE00 10.19): over
the primary axis, **under** the default contract axis — so a single-platform run at defaults
misses it, and the output then suggests `tolerance_de: 6`. Hex only in contracts at this level;
token names (`base.color1`) are skipped with a note — resolve them to hex in the layer that owns
the token definitions. Anchors without `bg` are color-compared platform-to-platform only. The
single-element form is a `color` assert: `{"element":{"id":"card"},"color":{"expected":"#FDFDFD",
"deltaE":8,"sample":"dominant"}}` — compared directly against `deltaE` (no 1.5× slack: the caller
chose the hex), so the default catches the 10.19 bug. Thin 1–2 px strokes are invisible to region
sampling — borders stay with the screenshot judge.
Screen width per platform is inferred from the widest rect in the whole tree (the id-less
root/window node). **Reliability caveat:** when the widest rect starts inset, the inferred width is
a content width and every delta is scaled wrong — the output says so explicitly. On iOS this
typically means the default idb tree source surfaced no real window rect (width came from the
widest accessibility element): set `app.ios.treeSource: wda` in `averi.yaml`, whose tree carries a
real window rect. Otherwise the tree was filtered before it reached the comparator.

**Text and type size, same contract file** (live-validated on device 2026-08-14): anchors may carry
`text` — the exact string the anchor renders — or `text_dynamic: true` for amounts, balances and
dates, whose locale formatting differs legitimately (`1,121.00` vs `1 121,00`). When any anchor opts
in, `verify` reads the copy back off the same screenshots with the macOS Vision recognizer and
appends a `## text parity` table:

```json
{ "id": "payment.form.amount_input", "text": "Enter amount" }
```

```
anchor                       src   android   ios             contract      Δsize  verdict
payment.form.amount_input    ocr   0.00      Enter amount    Enter amount      —  FAIL
payment.form.continue_button ocr   CONTINUE  CONTINUE        CONTINUE      0.74%  OK
```

Why OCR rather than the tree: **the accessibility tree does not record rendered copy.** On iOS
SwiftUI collapses a card or button into one element carrying an authored a11y label — measured on
the payment form, `credit_select` exposes `'To account'` while the screen reads `'Select credit
account'`, and the visible `CONTINUE` is missing from the tree entirely. Tree-only comparison
covered 2 of 7 anchors there. The tree remains the fallback when the recognizer cannot run
(macOS-only); the `src` column names the source per row, and the two are never mixed across
platforms.

The same read yields the **type-size** check: Vision returns a bounding box per string, i.e. the
rendered ink height, compared android-vs-ios in % of screen width at `tolerance_size_pct` (default
10) and only where both strings match. Calibration: a matching `CONTINUE` reads 0.74% apart, the
real 22sp-vs-17pt title drift 12.63%. `text_dynamic` anchors are never size-checked.

Two kinds of row are withheld from findings, because comparing them would dispatch a phantom: an
anchor whose tree copy vanished from the reading (something covers its rect — usually the IME — or
the text sits at a contrast the recognizer cannot resolve, which would be a real defect; the output
says the cause is undetermined), and an anchor whose source yields no string at all. Both still fail
the run. Single-element form: `{"element":{"id":"cta"},"ocr":{"text":"CONTINUE","heightPct":2.96}}`.

Full schema and design: [ARCHITECTURE.md](ARCHITECTURE.md). Agent workflow, rules and recipes: [skill/SKILL.md](skill/SKILL.md).

## Development

```bash
npm install
npm test           # vitest
npm run build      # tsc → dist/
npm run dev        # run the MCP server over stdio from source
```

Layout: `src/adapters/` (adb, simctl/idb, opt-in WDA tree source, one normalized tree) · `src/flow/` (yaml schema + engine) · `src/verify/` (asserts, baselines, crash scan) · `src/mcp/` (tool layer) · `skill/` · `docs/plans/`.
