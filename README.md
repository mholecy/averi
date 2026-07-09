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

- macOS, Node 20+
- **Android**: `adb` on PATH (Android SDK platform-tools), an emulator running
- **iOS**: Xcode, a booted simulator, and `idb`:
  `brew install idb-companion && pipx install fb-idb --python python3.13` (fb-idb breaks on 3.14).
  If `xcode-select -p` points at CommandLineTools, averi injects `DEVELOPER_DIR` itself — no sudo needed.

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

Restart the agent session; it now has 16 `averi` tools (`list_devices`, `install_app`, `launch_app`, `terminate_app`, `open_deep_link`, `screenshot`, `ui_snapshot`, `tap`, `swipe`, `type_text`, `press_key`, `ensure_state`, `run_flow`, `assert`, `verify_both`, `get_logs`). Notes: averi never builds your app — your normal build produces the `.apk`/`.app`, whose path in `averi.yaml` is what `install_app` installs; `verify_both` runs the same state/flow/asserts on **both platforms** and returns paired screenshots; screenshot baselines auto-create under `.averi/baselines/` on first use (delete one to re-baseline).

## Let the agent write `averi.yaml` for you

You don't hand-author the login flow — **the agent bootstraps it by driving your app**. With a booted device and the dev build installed, prompt your agent:

> Using the averi tools, author an `averi.yaml` for this repo. Launch the app with `clearState`, and at each screen use `ui_snapshot` (and `screenshot` when unsure) to find stable selectors — prefer `id:`, else exact visible `text:` (text selectors are locale-sensitive: pin the device language they were captured in). Walk the full login using the test credentials from `.env.averi` (reference them as `${VARS}` in yaml, never paste values). Record every screen as flow steps; wrap dismissable interstitials (permission dialogs, promos) in `optional:`. Define a `logged_out` state (first screen after clearState) and a `logged_in` state (a stable element on the home screen) with `reach: [login]`. Then prove it: run `ensure_state("logged_in")` twice — once from a cleared app (full flow) and once already logged in (must detect in ~1 s) — and iterate on the yaml until both pass.

The yaml is code: it lives in the repo, and when navigation changes and a flow times out, the agent fixes the descriptor as part of the change. Real-world quirks the schema already covers: per-platform steps (`android:`/`ios:`), keypads whose digits have no resource-ids (`type_pin` with `text_pattern: "{digit}"`), auto-advancing OTP boxes (per-digit typing built in), and `branch:` for state-dependent paths (e.g. Keychain-surviving PIN login on iOS).

### Minimal `averi.yaml`

```yaml
app:
  android: { package: com.example.dev, apk: app/build/outputs/apk/dev/debug/app.apk }
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

Full schema and design: [ARCHITECTURE.md](ARCHITECTURE.md). Agent workflow, rules and recipes: [skill/SKILL.md](skill/SKILL.md).

## Development

```bash
npm install
npm test           # vitest
npm run build      # tsc → dist/
npm run dev        # run the MCP server over stdio from source
```

Layout: `src/adapters/` (adb, simctl/idb, one normalized tree) · `src/flow/` (yaml schema + engine) · `src/verify/` (asserts, baselines, crash scan) · `src/mcp/` (tool layer) · `skill/` · `docs/plans/`.
