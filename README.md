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
4. Verification is tiered: element asserts (deterministic, cheap) → screenshots for the agent to look at → pixel-diff against stored baselines. Every flow response reports `appAlive` with a crash-log excerpt if the app died.

## Requirements

- Node 20+
- **Android**: `adb` on PATH (Android SDK platform-tools), an emulator running. Works on macOS, and nothing in the Android path is macOS-specific — Linux/Windows should work but are untested.
- **iOS**: **macOS only** (Apple ships simulators only with Xcode). Xcode, a booted simulator, and `idb`:
  `brew install idb-companion && pipx install fb-idb --python python3.13` (fb-idb breaks on 3.14).
  If `xcode-select -p` points at CommandLineTools, averi injects `DEVELOPER_DIR` itself — no sudo needed.
- `verify_both` needs both platforms, hence a Mac. Everything else degrades per platform: on a Linux/Windows box you get the full Android toolset; iOS tools error only when called.

## Installation (in your app repo)

Until the npm package is published, clone and build averi once:

```bash
git clone git@github.com:mholecy/native-app-verify.git ~/tools/averi
cd ~/tools/averi && npm install && npm run build
```

(For a team, pin a tag/commit so everyone runs the same build.)

Then set up three things in the **app repo root** (`averi.yaml` and `.env.averi` must sit in the directory the agent session runs from):

1. Register the MCP server — two ways, same result. Either way Claude Code runs the server with your **repo root as its working directory**, which is how averi finds the config below; no paths need configuring in averi itself.

   **For yourself** (recommended while averi is unpublished — the command embeds a machine-specific path that shouldn't be committed):

   ```bash
   claude mcp add averi -- node /absolute/path/to/averi/dist/mcp/server.js
   # add --scope user to enable averi in all your projects at once
   ```

   **For the whole team** — `.mcp.json` at the repo root, committed (teammates get a one-time approval prompt). Best once the npm package is published, when the command becomes portable (`"command": "npx", "args": ["-y", "averi-mcp"]`):

   ```json
   {
     "mcpServers": {
       "averi": { "command": "node", "args": ["/absolute/path/to/averi/dist/mcp/server.js"] }
     }
   }
   ```

2. `.gitignore` entry for `.env.averi`, then create that file with the test credentials your login flow needs. Variable names are yours to choose — they only have to match the `${...}` references in `averi.yaml`:

```
APP_USERNAME=...
APP_PASSWORD=...
```

3. The agent skill — copy `skill/SKILL.md` to `.claude/skills/averi/SKILL.md` (or your agent's equivalent) so the agent knows the golden path: build → install → `ensure_state` → navigate → assert → `verify_both`.

Restart the agent session; it now has 17 `averi` tools (`list_devices`, `select_device`, `install_app`, `launch_app`, `terminate_app`, `open_deep_link`, `screenshot`, `ui_snapshot`, `tap`, `swipe`, `type_text`, `press_key`, `ensure_state`, `run_flow`, `assert`, `verify_both`, `get_logs`). Notes: tools target the **first booted device** per platform unless you pin one with `select_device` (with a phone, an emulator, and a watch emulator all connected, pin it — the pick is otherwise arbitrary, and a pinned device going offline is an error, never a silent fallback); averi never builds your app — your normal build produces the `.apk`/`.app`, whose path in `averi.yaml` is what `install_app` installs; `verify_both` runs the same state/flow/asserts on **both platforms** and returns paired screenshots; screenshot baselines auto-create under `.averi/baselines/` on first use (delete one to re-baseline).

## Let the agent write `averi.yaml` for you

You don't hand-author the login flow — **the agent bootstraps it by driving your app**. With a booted device and the dev build installed, prompt your agent:

> Using the averi tools, author an `averi.yaml` for this repo. Launch the app with `clearState`, and at each screen use `ui_snapshot` (and `screenshot` when unsure) to find stable selectors — prefer `id:`, else exact visible `text:` (text selectors are locale-sensitive: pin the device language they were captured in). Walk the full login using the test credentials from `.env.averi` (reference them as `${VARS}` in yaml, never paste values). Record every screen as flow steps; wrap dismissable interstitials (permission dialogs, promos) in `optional:`. Define a `logged_out` state (first screen after clearState) and a `logged_in` state (a stable element on the home screen) with `reach: [login]`. Then prove it: run `ensure_state("logged_in")` twice — once from a cleared app (full flow) and once already logged in (must detect in ~1 s) — and iterate on the yaml until both pass.

The yaml is code: it lives in the repo, and when navigation changes and a flow times out, the agent fixes the descriptor as part of the change. Real-world quirks the schema already covers: per-platform steps (`android:`/`ios:`), keypads whose digits have no resource-ids (`type_pin` with `text_pattern: "{digit}"`), auto-advancing OTP boxes (per-digit typing built in), and `branch:` for state-dependent paths (e.g. Keychain-surviving PIN login on iOS).

### Give your screens stable ids — it pays off immediately

averi can only select what the accessibility tree exposes. Screens without identifiers force `text:"…"` selectors, which are **locale-fragile** (break the moment the device language changes) and **blind to which component** rendered the text. Stable ids make flows locale-proof and asserts component-precise — on **both platforms**:

- **Android (Compose)**: `Modifier.testTag("login_submit")` — and note it only surfaces as a `resource-id` averi can see if the app sets `testTagsAsResourceId = true` on the semantics tree (`Modifier.semantics { testTagsAsResourceId = true }` at the root).
- **iOS (SwiftUI/UIKit)**: `.accessibilityIdentifier("login_submit")`.

Adding ids to every **new** feature screen as you build it is cheap; retrofitting an entire app is not. Make it part of the definition of done — it also improves real accessibility tooling.

> **Known gap — React Native on iOS.** RN sets `testID` → `accessibilityIdentifier` on the *host view*,
> but the accessibility *element* iOS publishes for static text (and plain containers) is a child that
> carries no identifier — and `idb ui describe-all`, averi's iOS tree source, returns only accessibility
> elements. Net effect: on RN apps, iOS `id:` selectors work **only on interactive elements**
> (Pressable, TextInput); Android sees every `testID`. This is **not an RN bug** — the ids are on the
> view, and XCTest-based drivers (Maestro) see them. Planned fix: an XCTest/WDA-backed tree source
> behind the adapter ([docs/plans/ios-wda-tree-source.md](docs/plans/ios-wda-tree-source.md)). Until
> then, key iOS automation on interactive ids, and pin the device language wherever `text:` fills in.

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
→ base `credentials:` alone. Only `ensure_state`, `run_flow` and `verify_both` take the argument —
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

Full schema and design: [ARCHITECTURE.md](ARCHITECTURE.md). Agent workflow, rules and recipes: [skill/SKILL.md](skill/SKILL.md).

## Development

```bash
npm install
npm test           # vitest
npm run build      # tsc → dist/
npm run dev        # run the MCP server over stdio from source
```

Layout: `src/adapters/` (adb, simctl/idb, one normalized tree) · `src/flow/` (yaml schema + engine) · `src/verify/` (asserts, baselines, crash scan) · `src/mcp/` (tool layer) · `skill/` · `docs/plans/`.
