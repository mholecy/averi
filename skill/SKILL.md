---
name: averi
description: Verify mobile app changes on iOS Simulators and Android Emulators via the averi MCP server — build, install, get past login with ensure_state, navigate, and assert. Use whenever you changed native mobile code and need to confirm it works on-device, reproduce a bug report, or check a flow after a refactor.
---

# averi — verify your mobile work on real simulators

You have the `averi` MCP tools. They drive booted iOS Simulators and Android Emulators, and they understand the app: the repo's `averi.yaml` declares how to reach known states (logged in, specific screens). You never fumble through login screens tap by tap.

## Golden path (verify a UI change)

1. Build the app (the project's usual build command).
2. `install_app(platform)` — uses the build path from `averi.yaml`.
3. `ensure_state("logged_in", platform)` — detects, logs in only if needed, returns a screenshot.
4. Navigate to the changed screen: `run_flow` if a flow exists, else `tap`/`scroll_until` with selectors.
5. Verify, cheapest tier first:
   - `assert` with element specs — deterministic, no vision needed: `{"element":{"id":"amount"},"text":"100.00"}`, `{"element":{"id":"error_banner"},"absent":true}`, `{"element":{"id":"amount"},"error":"Required"}` (validation message paired to the input, where the platform exposes it — `absent` means gone from the tree OR outside the viewport, the same on both platforms)
   - `screenshot` — look at it yourself for layout/visual judgment.
   - `assert` with `{"screenshot":{"baseline":"name"}}` — pixel regression vs. stored baseline (auto-created on first run under `.averi/baselines/`).
6. Cross-platform tasks: finish with `verify_both(state, flow?, asserts)` — same sequence on both platforms, paired screenshots. Do this before declaring the task done.

## Rules

- **Always `ensure_state` instead of manual login.** It is idempotent — call it freely; it no-ops when already there.
- **Several devices booted (phone + emulator + watch)?** Pin the right one first: `list_devices` → `select_device(platform, id)`. Otherwise tools target the first booted device the platform tools list — an arbitrary pick.
- **React Native app on iOS: an `id:` selector misses a static text or container?** Under the default `treeSource: idb` that is expected, not a broken selector and not an RN bug — RN puts `testID` on the host view, idb returns only accessibility elements, so only interactive elements (Pressable/TextInput) carry ids. RN projects fix it with one line in `averi.yaml`: `app.ios.treeSource: wda` routes the iOS tree read through WebDriverAgent, and `id:` then resolves on static text and containers, symmetric with Android. Everything else in this workflow is unchanged (taps/typing/install stay on idb/simctl; expect ~2× slower tree reads and a minutes-long first WDA build per Xcode version). Details: `docs/plans/ios-wda-tree-source.md`.
- **Launch opened LeakCanary instead of the app?** The debug build has two launcher activities and the default launch picks arbitrarily — set `app.android.activity` in `averi.yaml` (e.g. `.MainActivity`). Non-launcher entry points (share sheet etc.) are reachable with `launch: { activity: ..., intent: { action: ..., extras: {...} } }` — Android only; on iOS use deep links.
- **Prefer `ui_snapshot` + element asserts over screenshots** for text/presence checks. Screenshots are for visual judgment, baselines for regression.
- Selectors: prefer `id:` (stable), then `label:`/`text:`, then `role:` combinations. `ui_snapshot(platform, filter)` shows you what's there.
- If an expected element is missing or below the fold, use `scroll_until(platform, selector)` (or the `scroll_until:` flow step) — element-targeted, no coordinates, portable. Raw `swipe` remains for gestures that aren't "bring X into view" (its coordinates are per-platform units).
- Filling fields: `type_text(platform, text, selector, clear)` focuses the field for you; `clear: true` deletes existing content first — typing APPENDS on both platforms, so pass `clear` when a value may already be there, and leave it off for pre-filled fields that must survive (dev-flavor logins). In flows use `fill: { id: amount, value: "1.00", clear: true }`.
- Watch `appAlive` in every flow/assert response. `appAlive: false` comes with a crash excerpt — report it with the log lines, don't retry blindly.
- On an unexpected screen: `screenshot` + `ui_snapshot`, try the flow's `optional` dismissals by re-running `ensure_state`, and if still stuck, surface to the human with both artifacts.
- **Never ask the user for credentials.** If a `${VAR}` is missing, the error names it — tell the user which env var to export, or to put `VAR=value` in a gitignored `.env.averi` next to averi.yaml (auto-loaded; real env vars take precedence). You never see credential values; traces show `***`.
- **When one app targets several backends**, credentials live under `environments:` and you pick one with the `environment` argument on `ensure_state`/`run_flow`/`verify_both` (or `$AVERI_ENV`). Check the first trace line — it names the active environment. A login rejected as "user does not exist" right after a *correct-looking* username is usually the wrong environment, not a wrong credential: the bank rejects the login name one screen after it is typed.

## Recipes

- **Reproduce a bug report**: `ensure_state` → `run_flow`/taps along the reported path → `screenshot` + `get_logs(platform, sinceSeconds, grep)` → compare with the report. Always pass `grep` (case-insensitive regex, e.g. `"okhttp|validation"`) — unfiltered pulls run to thousands of lines.
- **Test form validation**: dirty-submit (tap submit on an invalid form), `assert` the error text or the field's `error` attribute, fix the field with `fill`/`type_text(clear)`, then assert the error `absent` — the disappearance check is portable. Flows can assert mid-way with an inline `assert:` step (a failing spec fails the flow with the diff in the trace).
- **Check a flow after refactor**: `verify_both(state, flow, asserts)` with the flow's key asserts; baselines catch visual drift.
- **Update `averi.yaml` when navigation changes**: if a flow times out because the UI changed, fix the descriptor as part of your change (it lives in the repo — treat it like code) and re-run. Keep selectors on stable `id:`s; add `optional:` steps for new interstitials.

## averi.yaml quick reference

```yaml
app:
  android: { package: com.example.dev, apk: path/to.apk }
  ios:     { bundleId: com.example.dev, app: path/to.app }
credentials:          # env refs only — values never live in YAML
  pin: ${AVERI_PIN}   # from env, or gitignored .env.averi beside this file
environments:         # optional: per-backend overrides layered on `credentials`
  staging:            # declare only the keys that differ; the rest is inherited
    credentials:
      username: ${STAGING_USERNAME}
states:
  logged_in:
    detect: { any: [ { element: { id: dashboard_root } } ] }
    reach: [login]
flows:
  login:
    steps:
      - launch: { clearState: false }
      - branch:
          - when: { element: { id: pin_keyboard } }
            do: [ { type_pin: { value: $pin, keypad: { id_pattern: "pin_key_{digit}" } } } ]
      - optional: [ { tap: { text: "Not now" } } ]
      - wait: { state: logged_in, timeout: 20s }
```

Steps: `launch`, `tap`, `type`, `type_pin` (`twice:` for set+confirm; `keypad:` takes `id_pattern` or — for keypads without resource-ids, common in Compose — `text_pattern: "{digit}"`), `fill` (element spec + `value`, opt-in `clear`), `swipe` (`direction`, `times`), `scroll_until` (`element`, optional `direction`/`maxSwipes`/`timeout` — swipe until visible), `assert` (inline element asserts; a failure fails the flow), `wait` (element/state), `branch` (first matching `when` wins), `optional` (absence is fine), and per-platform overrides (`android:`/`ios:` on one step).

State `detect:` conditions take `element`/`state`/`any`/`all`, and an element condition accepts `absent: true` — "row visible AND card face gone" is expressible, which disambiguates screens that embed the same reused list.
