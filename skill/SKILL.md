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
   - `assert` with `{"element":{...},"ocr":{"text":"CONTINUE"}}` — what the element RENDERS, read back off the screenshot. Different question from `text` above: the tree carries what a11y is told, which on iOS is often an authored summary rather than the visible copy.
   - `screenshot` — look at it yourself for layout/visual judgment.
   - `assert` with `{"screenshot":{"baseline":"name"}}` — pixel regression vs. stored baseline (auto-created on first run under `.averi/baselines/`).
6. Close with `verify(platforms?, state?, flow?, asserts)` — same sequence on the requested platforms, per-platform screenshots (legs always run android-then-ios). Defaults to **both** platforms: cross-platform tasks run that default before declaring the task done; single-platform work passes `platforms: ["android"]` or `["ios"]`.

## Rules

- **Always `ensure_state` instead of manual login.** It is idempotent — call it freely; it no-ops when already there.
- **Several devices booted (phone + emulator + watch)?** Pin the right one first: `list_devices` → `select_device(platform, id)`. Otherwise tools target the first booted device the platform tools list — an arbitrary pick.
- **React Native app on iOS: an `id:` selector misses a static text or container?** Under the default `treeSource: idb` that is expected, not a broken selector and not an RN bug — RN puts `testID` on the host view, idb returns only accessibility elements, so only interactive elements (Pressable/TextInput) carry ids. RN projects fix it with one line in `averi.yaml`: `app.ios.treeSource: wda` routes the iOS tree read through WebDriverAgent, and `id:` then resolves on static text and containers, symmetric with Android. Everything else in this workflow is unchanged (taps/typing/install stay on idb/simctl; expect ~2× slower tree reads and a minutes-long first WDA build per Xcode version). Details: `docs/plans/ios-wda-tree-source.md`.
- **Launch opened LeakCanary instead of the app?** The debug build has two launcher activities and the default launch picks arbitrarily — set `app.android.activity` in `averi.yaml` (e.g. `.MainActivity`). Non-launcher entry points (share sheet etc.) are reachable with `launch: { activity: ..., intent: { action: ..., extras: {...} } }` — Android only; on iOS use deep links.
- **Prefer `ui_snapshot` + element asserts over screenshots** for text/presence checks. Screenshots are for visual judgment, baselines for regression.
- **Geometry is checked with numbers — never eyeball margins from screenshots.** One element: `assert` with `{"element":{"id":"card"},"rect":{"x":24,"w":345,"h":129,"frameWidth":393}}` (Figma-frame units, deltas in % of screen width; `y` is reported but never fails — absolute y drifts with device aspect ratio, vertical position is judged by gaps). Whole screen: `verify` with `contract: path/to/layout-contract.json` — appends a `## rect parity` per-anchor table (deltas vs contract and android-vs-ios, gap and aspect rows, MISSING anchors). If the output warns the width is a CONTENT width (widest rect starts inset), every delta is scaled wrong — on iOS set `app.ios.treeSource: wda` (the default idb source surfaces no real window rect); don't quote those numbers. **Fills are numbers too:** one element: `assert` with `{"element":{"id":"card"},"color":{"expected":"#FDFDFD","deltaE":8}}` (CIEDE2000 over the element's sampled region; hex only — token names resolve in the superrepo layer, never here). Whole screen: contract anchors carrying `bg`/`bg_dark`/`sample` add a `## color parity` table to `verify` (android-vs-ios primary at `tolerance_de` 8, vs-contract at 1.5×). A single-platform run only gets the looser vs-contract axis and at defaults MISSES real bugs — the 2026-08-13 grey-card bug measured dE00 10.19, under the default 12 — so set `tolerance_de: 6` in the contract when only one platform is in the loop. Thin 1–2 px strokes (borders) are invisible to region sampling — those stay with the screenshot judge.
- Selectors: prefer `id:` (stable), then `label:`/`text:`, then `role:` combinations. `ui_snapshot(platform, filter)` shows you what's there.
- If an expected element is missing or below the fold, use `scroll_until(platform, selector)` (or the `scroll_until:` flow step) — element-targeted, no coordinates, portable. Raw `swipe` remains for gestures that aren't "bring X into view" (its coordinates are per-platform units).
- Filling fields: `type_text(platform, text, selector, clear)` focuses the field for you; `clear: true` deletes existing content first — typing APPENDS on both platforms, so pass `clear` when a value may already be there, and leave it off for pre-filled fields that must survive (dev-flavor logins). In flows use `fill: { id: amount, value: "1.00", clear: true }`.
- **Rendered text: use `ocr`, not `text`.** `{"element":{"id":"cta"},"text":"CONTINUE"}` checks the accessibility tree. `{"element":{"id":"cta"},"ocr":{"text":"CONTINUE"}}` checks what the screen shows. These differ: on iOS a button collapses into one node carrying an authored a11y label, so the visible string is often missing from the tree. Measured: `credit_select` exposes `'To account'` while rendering `'Select credit account'`. OCR is macOS-only and fails closed elsewhere.
- **`text:` is EXACT, and exactness is not portable.** iOS `.accessibilityElement(children: .combine)` merges a container's children into one node, so a tile whose two labels read `"Select transaction type"` and `"1 of 13 selected"` arrives as a single `"Select transaction type, 1 of 13 selected"` — no node EQUALS either half. `{"element":{"id":"tile"},"text":"1 of 13 selected"}` then passes on Android and fails on iOS, which reads as an app defect. Use `match` (unanchored regex) for any assert that must hold on both platforms. A failing `text` assert says so itself when the string is present inside a longer label — read the hint before filing a bug.
- **Whole screen:** contract anchors with `text` (exact rendered string) or `text_dynamic: true` (amounts, dates — locale formatting differs) add a `## text parity` table to `verify`. Read the `src` column: `ocr` is what renders, `tree` is the weaker fallback.
- **Type size comes with it:** ink height, android-vs-ios, `tolerance_size_pct` (default 10), compared only where both strings match. A matching CTA reads 0.74% apart; the real 22sp-vs-17pt title drift reads 12.63%. Single element: `"ocr":{"heightPct":2.96}`.
- **Assert placeholders in the EMPTY state** — iOS drops the placeholder node once a field is filled.
- **An UNREAD row means "could not read", not "drift".** Either something covers the anchor (usually the IME) or the text sits at unreadable contrast — the second is a finding. Open the screenshot to tell them apart.
- **Copy drift is a spec question first.** Check which side matches Figma before dispatching a fix: the 2026-08-14 `'0.00'` vs `'Enter amount'` drift had Figma on iOS's side. Where nothing settles it, escalate and use `text_dynamic: false` to compare without naming a winner.
- Watch `appAlive` in every flow/assert response. `appAlive: false` comes with a crash excerpt — report it with the log lines, don't retry blindly.
- On an unexpected screen: `screenshot` + `ui_snapshot`, try the flow's `optional` dismissals by re-running `ensure_state`, and if still stuck, surface to the human with both artifacts.
- **Never ask the user for credentials.** If a `${VAR}` is missing, the error names it — tell the user which env var to export, or to put `VAR=value` in a gitignored `.env.averi` next to averi.yaml (auto-loaded; real env vars take precedence). You never see credential values; traces show `***`.
- **When one app targets several backends**, credentials live under `environments:` and you pick one with the `environment` argument on `ensure_state`/`run_flow`/`verify` (or `$AVERI_ENV`). Check the first trace line — it names the active environment. A login rejected as "user does not exist" right after a *correct-looking* username is usually the wrong environment, not a wrong credential: the bank rejects the login name one screen after it is typed.

## Recipes

- **Reproduce a bug report**: `ensure_state` → `run_flow`/taps along the reported path → `screenshot` + `get_logs(platform, sinceSeconds, grep, maxLines?)` → compare with the report. Always pass `grep` (case-insensitive regex, e.g. `"okhttp|validation"`) — unfiltered pulls run to thousands of lines. `grep` alone is not a budget either: a broad one matched 2,002 lines / 483k characters in one measured session. Only the last `maxLines` (default 400) come back, and the header says how many the grep matched against how many are shown — widen it deliberately, and narrow the regex before you widen the tail.
- **Test form validation**: dirty-submit (tap submit on an invalid form), `assert` the error text or the field's `error` attribute, fix the field with `fill`/`type_text(clear)`, then assert the error `absent` — the disappearance check is portable. Flows can assert mid-way with an inline `assert:` step (a failing spec fails the flow with the diff in the trace).
- **Check a flow after refactor**: `verify(state, flow, asserts)` with the flow's key asserts (add `platforms:` when only one platform is in scope); baselines catch visual drift.
- **Update `averi.yaml` when navigation changes**: if a flow times out because the UI changed, fix the descriptor as part of your change (it lives in the repo — treat it like code) and re-run. Keep selectors on stable `id:`s; add `optional:` steps for new interstitials.

## averi.yaml quick reference

Not in the directory the config lives in? Pass `configPath:` — paths *inside* the yaml resolve against the yaml, so nothing else needs adjusting.

```yaml
app:
  # build paths are relative to THIS FILE (absolute ones pass through)
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

`reach:` is tried in order and `detect` is re-checked after each flow, so the rest are skipped once the state is reached. A rung that FAILS escalates to the next one rather than failing the call — it shows up as `⚠ reach <flow>` in the trace, and if you see one, fix that flow: it is doing nothing but costing time. Put the cheap, idempotent recovery first and the destructive one last — `reach: [dismiss_post_login_prompts, login]` — and note what "destructive" means here: `launch { clearState: true }` deletes the app's data container (iOS) / runs `pm clear` (Android), so everything the app persisted goes with it — on apps that bind to the device, that is a backend re-registration per wipe. averi logs a `⚠ clearState` line with a running count each time one executes; if you see that count climbing while you debug selectors, stop and re-read the trace instead. A rung that fails because of a CONFIG mistake (undeclared credential, unset `${VAR}`) aborts the ladder instead of escalating — the next flow cannot fix it and would only cost you a wipe.

Steps: `launch`, `tap` (element spec + optional `timeout:` overriding the default find-and-settle budget), `type`, `type_pin` (`twice:` for set+confirm; `keypad:` takes `id_pattern` or — for keypads without resource-ids, common in Compose — `text_pattern: "{digit}"`), `fill` (element spec + `value`, opt-in `clear`), `swipe` (`direction`, `times`), `scroll_until` (`element`, optional `direction`/`maxSwipes`/`timeout` — swipe until visible), `assert` (inline element asserts; a failure fails the flow), `wait` (element/state), `branch` (first matching `when` wins), `optional` (absence is fine), and per-platform overrides (`android:`/`ios:` on one step).

An `optional:` tap gives the element a short window (~1.5s of polling) to be present, then skips. An interstitial gated on a network round-trip (a post-login biometric offer, a server-driven promo) can take far longer than that to exist at all — put `timeout:` on the tap to widen its presence window: `optional: [ { tap: { text: "Not now", timeout: 10s } } ]`. Mind the cost: the full window is burned every run where the interstitial never shows. When the screen that appears INSTEAD is detectable, prefer a state with `any:` over both outcomes plus `branch:` — it exits immediately whichever one arrives:

```yaml
states:
  post_login_gate:
    detect:
      any:
        - element: { text: "Not now" }   # the interstitial
        - state: logged_in               # or it never showed
# in the flow:
      - wait: { state: post_login_gate, timeout: 30s }
      - branch:
          - when: { element: { text: "Not now" } }
            do: [ { tap: { text: "Not now" } } ]
          - when: { state: logged_in }   # fallback arm — a branch with NO matching arm
            do: []                       # times out and FAILS the flow, so cover both
```

State `detect:` conditions take `element`/`state`/`any`/`all`, and an element condition accepts `absent: true` — "row visible AND card face gone" is expressible, which disambiguates screens that embed the same reused list.
