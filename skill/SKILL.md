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
4. Navigate to the changed screen: `run_flow` if a flow exists, else `tap`/`swipe` with selectors.
5. Verify, cheapest tier first:
   - `assert` with element specs — deterministic, no vision needed: `{"element":{"id":"amount"},"text":"100.00"}`, `{"element":{"id":"error_banner"},"absent":true}`
   - `screenshot` — look at it yourself for layout/visual judgment.
   - `assert` with `{"screenshot":{"baseline":"name"}}` — pixel regression vs. stored baseline (auto-created on first run under `.averi/baselines/`).
6. Cross-platform tasks: finish with `verify_both(state, flow?, asserts)` — same sequence on both platforms, paired screenshots. Do this before declaring the task done.

## Rules

- **Always `ensure_state` instead of manual login.** It is idempotent — call it freely; it no-ops when already there.
- **Prefer `ui_snapshot` + element asserts over screenshots** for text/presence checks. Screenshots are for visual judgment, baselines for regression.
- Selectors: prefer `id:` (stable), then `label:`/`text:`, then `role:` combinations. `ui_snapshot(platform, filter)` shows you what's there.
- Off-screen elements aren't in the tree (especially iOS). If an expected element is missing, scroll: `swipe` or a flow `swipe:` step, then re-check.
- Watch `appAlive` in every flow/assert response. `appAlive: false` comes with a crash excerpt — report it with the log lines, don't retry blindly.
- On an unexpected screen: `screenshot` + `ui_snapshot`, try the flow's `optional` dismissals by re-running `ensure_state`, and if still stuck, surface to the human with both artifacts.
- **Never ask the user for credentials.** If a `${VAR}` is missing, the error names it — tell the user which env var to export, or to put `VAR=value` in a gitignored `.env.averi` next to averi.yaml (auto-loaded; real env vars take precedence). You never see credential values; traces show `***`.

## Recipes

- **Reproduce a bug report**: `ensure_state` → `run_flow`/taps along the reported path → `screenshot` + `get_logs(platform, sinceSeconds)` → compare with the report.
- **Check a flow after refactor**: `verify_both(state, flow, asserts)` with the flow's key asserts; baselines catch visual drift.
- **Update `averi.yaml` when navigation changes**: if a flow times out because the UI changed, fix the descriptor as part of your change (it lives in the repo — treat it like code) and re-run. Keep selectors on stable `id:`s; add `optional:` steps for new interstitials.

## averi.yaml quick reference

```yaml
app:
  android: { package: com.example.dev, apk: path/to.apk }
  ios:     { bundleId: com.example.dev, app: path/to.app }
credentials:          # env refs only — values never live in YAML
  pin: ${AVERI_PIN}   # from env, or gitignored .env.averi beside this file
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

Steps: `launch`, `tap`, `type`, `type_pin` (`twice:` for set+confirm; `keypad:` takes `id_pattern` or — for keypads without resource-ids, common in Compose — `text_pattern: "{digit}"`), `swipe` (`direction`, `times`), `wait` (element/state), `branch` (first matching `when` wins), `optional` (absence is fine), and per-platform overrides (`android:`/`ios:` on one step).
