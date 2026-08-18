# averi setup guide

> **This document is written for an AI coding agent** setting up averi in a user's app repo.
> Human reading this? It works fine as a manual guide too — but the fastest path is to paste
> the prompt from the [README](README.md#installation) into your agent and let it drive.

You are setting up [averi](https://github.com/mholecy/averi) — an MCP server that lets you verify
mobile app changes on iOS Simulators and Android Emulators. Setup means creating three things in
the **app repo root**: the MCP registration, an `averi.yaml` describing the app's states and flows,
and a gitignored `.env.averi` with test credentials.

Follow the steps **in order**. Every step ends with a **Check** — run it and do not move on until
it passes. Do not declare setup complete until the final verification in step 6 passes.

---

## Step 0 — Prerequisites

averi needs Node 20+ and the platform tools for whichever platforms the project targets.
Ask the user which platforms they need if the repo doesn't make it obvious.

**Android** (macOS/Linux/Windows):
- `adb` on PATH (Android SDK platform-tools)
- An emulator running

**iOS** (macOS only — Apple ships simulators only with Xcode):
- Xcode and a booted simulator
- `idb`: `brew install idb-companion && pipx install fb-idb --python python3.13`
  (fb-idb breaks on Python 3.14 — pin 3.13)
- If `xcode-select -p` points at CommandLineTools, that's fine — averi injects `DEVELOPER_DIR`
  itself, no sudo needed.

**Check:**

```bash
node --version          # >= 20
adb devices             # Android: lists a device/emulator (state "device")
xcrun simctl list devices booted   # iOS: lists at least one booted simulator
idb list-targets        # iOS: runs without error
```

Only verify the platforms the project targets. If a tool is missing, tell the user the exact
install command from above — don't skip the platform silently.

---

## Step 1 — Register the MCP server

averi is on npm; nothing to clone or build. Two ways to register, same result — ask the user
whether this is just for them or for the whole team:

**Just this user:**

```bash
claude mcp add averi -- npx -y averi
# add --scope user to enable averi in all of the user's projects at once
```

**Whole team** — create `.mcp.json` at the repo root and commit it (teammates get a one-time
approval prompt). Pin the version so everyone runs the same build:

```json
{
  "mcpServers": {
    "averi": { "command": "npx", "args": ["-y", "averi@0.2.0"] }
  }
}
```

Either way the agent session runs the server with the **repo root as its working directory** —
that's how averi finds `averi.yaml`. No paths need configuring in averi itself.

> **Monorepo / nested repo?** If sessions run somewhere other than the directory holding
> `averi.yaml`, tools accept `configPath: app/averi.yaml`. Everything the config points at
> (build paths, `.env.averi`, `.averi/baselines/`) resolves against **the config file**, not the
> working directory, so the yaml stays identical either way.

**Check:** the session must be restarted for the tools to appear — tell the user, and after
restart confirm you have 18 `averi` tools (`list_devices`, `select_device`, `install_app`,
`launch_app`, `terminate_app`, `open_deep_link`, `screenshot`, `ui_snapshot`, `tap`, `swipe`,
`scroll_until`, `type_text`, `press_key`, `ensure_state`, `run_flow`, `assert`, `verify`,
`get_logs`). Then call `list_devices` — it should list the booted device(s) from step 0.

> With a phone, an emulator, and a watch emulator all connected, pin the right one with
> `select_device` — otherwise tools target the first booted device per platform, an arbitrary
> pick. A pinned device going offline is an error, never a silent fallback.

---

## Step 2 — Credentials: `.env.averi`

Credential **values** never live in yaml — `averi.yaml` references them as `${ENV_VAR}` and the
values come from a gitignored `.env.averi` next to it (auto-loaded; real env vars take
precedence, so CI injects secrets normally). Values are redacted (`***`) from every trace and
error — you will never see them.

1. Add `.env.averi` to `.gitignore` **before** creating the file.
2. Ask the user for the test credentials their login flow needs and write them to `.env.averi`
   at the repo root. Variable names are free-form — they only have to match the `${...}`
   references you'll write in `averi.yaml`:

```
APP_USERNAME=...
APP_PASSWORD=...
```

**Never ask the user to paste credentials into the chat if they'd rather not** — they can edit
`.env.averi` themselves; you only need to know the variable *names*.

**Check:**

```bash
git check-ignore .env.averi   # must print the path — if not, fix .gitignore first
```

---

## Step 3 — Install the agent skill

Copy the skill so future sessions know the golden path (build → install → `ensure_state` →
navigate → assert → `verify`) without re-deriving it:

```bash
mkdir -p .claude/skills/averi
curl -fsSL https://raw.githubusercontent.com/mholecy/averi/main/skill/SKILL.md \
  -o .claude/skills/averi/SKILL.md
```

(For agents other than Claude Code, put it wherever that agent loads skills/instructions from.)

**Check:** the file exists and starts with `name: averi` frontmatter.

---

## Step 4 — Author `averi.yaml` by driving the app

**Do not hand-author the login flow — bootstrap it by driving the real app.** You need a booted
device and the dev build installed (the user's normal build produces the `.apk`/`.app`; averi
never builds the app — it installs what the yaml points at).

Procedure:

1. Ask the user for the build output paths (`.apk` / `.app`) and package/bundle ids, or find
   them in the build config. Start `averi.yaml` from this skeleton:

   ```yaml
   app:
     # activity is optional but SET IT if the debug build bundles LeakCanary: without it,
     # launches resolve the launcher activity via monkey, which picks ARBITRARILY among the
     # package's launcher activities — and LeakCanary registers one.
     android: { package: com.example.dev, apk: app/build/outputs/apk/dev/debug/app.apk, activity: .MainActivity }
     ios:     { bundleId: com.example.dev, app: build/Debug-iphonesimulator/Example.app }

   credentials:                 # env refs only — values come from .env.averi / real env
     username: ${APP_USERNAME}
     password: ${APP_PASSWORD}
   ```

   Build paths are relative to the yaml file itself.

2. `install_app`, then launch with `clearState: true` and walk the full login using the test
   credentials (reference them as `${VARS}` — never paste values into yaml).

3. At each screen use `ui_snapshot` (and `screenshot` when unsure) to find **stable selectors**:
   prefer `id:`, else exact visible `text:` (text selectors are locale-sensitive — pin the
   device language they were captured in). Record every screen as flow steps; wrap dismissable
   interstitials (permission dialogs, promos) in `optional:`.

4. Define two states:
   - `logged_out` — `detect:` on a stable element of the first screen after `clearState`
   - `logged_in` — `detect:` on a stable element of the home screen, with `reach: [login]`

   ```yaml
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

Real-world quirks the schema already covers — reach for these instead of workarounds:
per-platform steps (`android:`/`ios:` on one step), keypads whose digits have no resource-ids
(`type_pin` with `text_pattern: "{digit}"`), auto-advancing OTP boxes (per-digit typing built
in), and `branch:` for state-dependent paths (e.g. Keychain-surviving PIN login on iOS). Full
step reference is in the skill you installed in step 3.

> **React Native app on iOS:** if `id:` selectors miss static text and containers under the
> default tree source, that's expected — add `app.ios.treeSource: wda` to `averi.yaml` (one
> line; taps/typing stay on idb, only the tree read routes through WebDriverAgent; first WDA
> build per Xcode version takes minutes). Details: `docs/plans/ios-wda-tree-source.md`.

> **Screens without stable ids?** Recommend to the user that new screens get test identifiers —
> `Modifier.testTag("login_submit")` on Android Compose (plus `testTagsAsResourceId = true` on
> the semantics root) and `.accessibilityIdentifier("login_submit")` on iOS. Text selectors
> break on locale changes; ids don't. Don't block setup on it — flag it in the final report.

**Check:** `ensure_state("logged_in")` — it should run the login flow and confirm the state.
Iterate on the yaml until it does. The yaml is code: it lives in the repo and gets fixed like
code when navigation changes.

---

## Step 5 — Multiple backends (only if the app targets several)

Skip this step unless the user says the app points at different backends (dev/staging/…).

When credentials differ per backend — usually just the login name — declare it explicitly rather
than swapping env vars by hand. A wrong login name is rejected one screen *after* it is typed,
so an environment mix-up looks exactly like a credentials problem:

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
`.env.averi` — switching backend becomes a one-line change in an already-gitignored file) →
`defaultEnvironment:` → base `credentials:` alone. Only `ensure_state`, `run_flow` and `verify`
take the argument.

**Check:** run `ensure_state("logged_in", environment: "<one of them>")` and confirm the first
trace line names the active environment and the overridden keys.

---

## Step 6 — Final verification (required)

Prove the setup end to end. **Both** runs must pass:

1. **Cold:** launch with `clearState: true` (or run the login flow's launch step), then
   `ensure_state("logged_in")` — must execute the full login flow and confirm.
2. **Warm:** call `ensure_state("logged_in")` again immediately — must detect the state in
   ~1 second without re-running the flow (it's idempotent).

Then report to the user:

- [ ] MCP server registered (personal or team `.mcp.json`, version pinned for teams)
- [ ] `.env.averi` created and confirmed gitignored; which variable names it defines
- [ ] Skill installed at `.claude/skills/averi/SKILL.md`
- [ ] `averi.yaml` committed-ready: which states and flows it defines
- [ ] Cold + warm `ensure_state` both passed (include the timings)
- [ ] Anything flagged: missing test ids, `treeSource: wda` enabled, platforms skipped and why

If any box is unchecked, setup is **not done** — say so plainly and list what's missing.

---

## Updating averi

For when the user asks to update averi in an already-set-up repo. An update touches up to
three things — the server version, the copied skill, and `averi.yaml` — and only the first
one happens by itself.

1. **Find the versions.** Latest published: `npm view averi version`. Currently used: the pin
   in `.mcp.json`, if the team setup is in place; an unpinned personal registration
   (`npx -y averi`) resolves the latest version each time the session starts.

2. **Update the server registration.**
   - *Unpinned personal:* nothing to edit — restarting the agent session picks up the latest.
   - *Team `.mcp.json`:* bump the pinned version and commit; teammates get it on their next
     session start.

3. **Re-sync the skill copy — it does not update itself.** The file at
   `.claude/skills/averi/SKILL.md` was copied once at setup. Replace it with the copy shipped
   inside the exact version now in use:

   ```bash
   curl -fsSL "$(npm view averi@<version> dist.tarball)" \
     | tar -xzO package/skill/SKILL.md > .claude/skills/averi/SKILL.md
   ```

   Commit it alongside the `.mcp.json` bump so the skill and server never drift apart.

4. **Check for `averi.yaml` schema changes** in the release notes / commit log
   (https://github.com/mholecy/averi/commits/main) between the old and new version. If a
   flow step or state field changed, update `averi.yaml` accordingly.

5. **Re-verify.** Restart the session, confirm the `averi` tools are present, and re-run the
   step 6 proof: cold + warm `ensure_state("logged_in")`. Setup isn't updated until both pass.

6. **Baselines.** If the update legitimately changes rendering or screenshot behavior, expect
   baseline diffs — delete the affected files under `.averi/baselines/` to re-baseline, and
   say so in the report rather than silently regenerating everything.

---

## Troubleshooting

- **`idb` install fails** — fb-idb requires Python ≤ 3.13: `pipx install fb-idb --python python3.13`.
- **Launch opens LeakCanary instead of the app** — set `app.android.activity` (see step 4 skeleton).
- **iOS `id:` selectors find nothing on a React Native app** — `app.ios.treeSource: wda` (step 4).
- **WDA refuses to start** — a simulator runs one XCTest UI-test session at a time; another
  process's WDA is refused loudly. Recovery: `pkill -f WebDriverAgentRunner` or reboot the simulator.
- **A `${VAR}` is missing** — the error names the credential (and environment) that needed it;
  add the variable to `.env.averi`. Never ask the user for the value itself.
- **Flow times out after a UI change** — fix the descriptor as part of the change; it's code.
