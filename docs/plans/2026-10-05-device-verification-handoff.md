# Handoff: on-device verification of the 2026-10-04/05 architecture series

*For the next agent. Written 2026-10-05 after the second architecture pass landed; the device run was
deferred by the user. Nothing below has been run against the final tree — the numbers and screens quoted
are from the 2026-10-05 run against `5473982` (the end of the first series), which is the baseline to
compare with.*

## What changed and what each commit needs proven on a device

Ten commits on `architecture/deepening` since `c4a2491`, all passing 1 145 unit tests and `npm run lint`,
every one differential- or mutation-tested, none yet exercised end to end against the current tree:

| commit | what moved | device-visible behaviour to confirm |
|---|---|---|
| `f543b2f` C1+C7 | soft-keyboard guard is a pure table; `DeviceAdapter.keyboard?` oracle | **unchanged**: a tap whose target is under the Android keyboard still logs `⚠ tap: the soft keyboard covered id:"…"; hidden before tapping` and lands (seen on device 2026-10-05 against this commit's series) |
| `256f195` C2+C6 | credentials resolve from a `{cfg, env}` value; `flow/load.ts`, `flow/credentials.ts` | `.env.averi` values still reach `fill:`; the stderr line `averi: loaded A, B … from .env.averi` prints once per config per session; **delta**: `.env.averi` values no longer reach adb/xcrun child processes |
| `b655091` C3 | text parity measures its own legs | text table unchanged (needs a contract with `text` anchors — finportal has none, see §5) |
| `a7f4775` C8 | one selector matcher; viewport predicates in geometry | every `id:` selector in `averi.yaml` resolves as before (differential-proved; a run of `smoke` + `login` is the device proof) |
| `5473982` C9 | baseline screenshot assert takes a settled frame | a `screenshot` assert's first run creates a baseline from a settled frame |
| `427c45e` V8 | cleanup only | nothing |
| `4954ab4` V2+V3 | capture owns the stability budget; `Frame.stability`; color/ocr refuse moving frames; baseline creation refuses a moving frame; `⚠ frame:` note | **tightening**: on a STATIC screen nothing changes and NO `⚠ frame:` line appears in `ensure_state`/`screenshot`/`verify` output; on a screen with an animation or caret the note appears and a color/ocr assert fails "the screen did not settle …"; **unmeasured**: flows' post-swipe pause went 500 → 400 ms (`scroll_until`) |
| `5ed1478` V1 | keyboard decision per phase | same device proof as `f543b2f` (differential 3 × 25 000 sequences says identical) |
| `eadca61` V6 | unknown `environment` refused before any adapter | `ensure_state`/`verify` with `environment: "nope"` returns the SetupError immediately, no device work, no `## android` leg section |
| `e28576b` V4+V5 | `run/verify.ts` fact table; `TreeFrame`; `textMeasurement` | `verify` sections unchanged in wording and order (`## rect parity` / `## color parity` / `## text parity`); needs a contract to see them |

## 1. Prerequisites

- A booted Android emulator and a booted iPhone simulator (`adb devices`, `xcrun simctl list devices booted`).
  On 2026-10-05 these were `emulator-5554` (sdk_gphone64_arm64, API 33) and `iPhone 17` (iOS 26.5).
- `idb` and `idb_companion` on PATH; Xcode for the WDA tree source (finportal's `averi.yaml` sets
  `app.ios.treeSource: wda`, so the first iOS tree read may build WebDriverAgent — minutes).
- The dogfood project: `/Users/mholecy/dev/finportal/app` — `averi.yaml`, a gitignored `.env.averi`
  (`AVERI_STAGE_*`, `AVERI_EDU_*`), a debug APK at `android/app/build/outputs/apk/debug/app-debug.apk`
  and `ios/build/MyPort.app`. Flows: `open_app`, `fresh_launch` (destructive), `login`, `switch_to_sk`,
  `open_forgot`, `close_forgot`, `smoke`. States: `logged_out`, `post_launch`, `post_login_fork`, `logged_in`.
- Build THIS repo and drive its `dist/`, not the `averi` finportal has installed under `tooling/node_modules`:
  ```sh
  cd /Users/mholecy/dev/mobile-verify && npm run build   # dist/mcp/server.js
  ```

## 2. The driver

A stdio MCP client over `dist/mcp/server.js`, run with `cwd` = the finportal app so `averi.yaml` and
`.env.averi` resolve exactly as the agent's `.mcp.json` would. Save as `run-tools.mts` in a scratch
directory (it is ESM; a `.ts` name under a dir without `"type": "module"` is treated as CJS and fails on
top-level `await`). Run from the repo root so `tsx` and the SDK resolve from this repo's `node_modules`:

```sh
node --import tsx /path/to/run-tools.mts /path/to/<scenario>.json /path/to/out
```

```ts
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from '/Users/mholecy/dev/mobile-verify/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '/Users/mholecy/dev/mobile-verify/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const SERVER = process.env.AVERI_SERVER ?? '/Users/mholecy/dev/mobile-verify/dist/mcp/server.js';
const APP_CWD = process.env.AVERI_APP_CWD ?? '/Users/mholecy/dev/finportal/app';

type Step = { name: string; args?: Record<string, unknown>; label?: string; timeoutMs?: number };
const [stepsFile, outDirArg] = process.argv.slice(2);
if (!stepsFile) { console.error('usage: run-tools.mts <steps.json> [outDir]'); process.exit(2); }
const outDir = resolve(outDirArg ?? resolve(stepsFile, '..', 'out'));
await mkdir(outDir, { recursive: true });
const steps = JSON.parse(await readFile(stepsFile, 'utf8')) as Step[];

const transport = new StdioClientTransport({
  command: process.execPath, args: [SERVER], cwd: APP_CWD,
  // the real environment: adb / xcrun / idb / swiftc must resolve from PATH. .env.averi is read by the server itself from cwd.
  env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
  stderr: 'pipe',
});
transport.stderr?.on('data', (d: Buffer) => process.stderr.write(`[server] ${d}`));

const client = new Client({ name: 'device-verification', version: '0' });
let failed = 0; const t0 = Date.now();
try {
  await client.connect(transport);
  console.log(`connected: ${JSON.stringify(client.getServerVersion())}`);
  let i = 0;
  for (const step of steps) {
    i += 1;
    const label = step.label ?? `${step.name}(${JSON.stringify(step.args ?? {})})`;
    const started = Date.now();
    console.log(`\n=== [${i}/${steps.length}] ${label}`);
    const result = (await client.callTool({ name: step.name, arguments: step.args ?? {} }, undefined, { timeout: step.timeoutMs ?? 600_000 })) as
      { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> };
    if (result.isError) failed += 1;
    console.log(`--- ${result.isError ? 'ERROR' : 'ok'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    let img = 0;
    for (const c of result.content) {
      if (c.type === 'text') console.log(c.text);
      else if (c.type === 'image' && c.data) {
        img += 1;
        const file = resolve(outDir, `${String(i).padStart(2, '0')}-${step.name}-${img}.png`);
        await writeFile(file, Buffer.from(c.data, 'base64'));
        console.log(`[image → ${file}]`);
      } else console.log(`[${c.type}]`);
    }
  }
} finally {
  await client.close();
  console.log(`\n=== done: ${steps.length} steps, ${failed} error(s), ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
}
process.exit(failed === 0 ? 0 : 1);
```

Tool argument shapes that bit the first run: `tap` takes `selector` (a selector STRING, e.g.
`text:"Odhlásiť sa"`), not `text:`; `ui_snapshot`'s `filter` is a selector too (`id~"twofactor|login|home"`).

## 3. Scenarios

Run them one at a time (each spawns its own server; the two devices are independent but iOS WDA builds
are heavy). Use a fresh out dir per scenario or the `02-ensure_state-1.png` files overwrite each other.

**android.json**
```json
[
  { "name": "list_devices", "args": {} },
  { "name": "ensure_state", "args": { "state": "logged_out", "platform": "android" } },
  { "name": "ensure_state", "args": { "state": "logged_in", "platform": "android" }, "label": "login flow — expected to STOP at the 2FA screen (see §4)" },
  { "name": "run_flow", "args": { "flow": "smoke", "platform": "android" } },
  { "name": "ui_snapshot", "args": { "platform": "android" } }
]
```

**ios.json** — the installed iOS build keeps its session in the keychain, which `clearState` does not wipe,
so a cleared launch lands on the HOME screen and `logged_out`/`smoke` would time out waiting for
`login_screen`. Log out first:
```json
[
  { "name": "tap", "args": { "platform": "ios", "selector": "text:\"Odhlásiť sa\"" }, "label": "log out (keychain session survives clearState)" },
  { "name": "ensure_state", "args": { "state": "logged_out", "platform": "ios" } },
  { "name": "ensure_state", "args": { "state": "logged_in", "platform": "ios" }, "label": "login flow via WDA — expected to STOP at the 2FA screen", "timeoutMs": 400000 },
  { "name": "ui_snapshot", "args": { "platform": "ios", "filter": "id~\"twofactor|login|home\"" } }
]
```

**both.json** — the `verify` run, both legs, no contract (finportal has none):
```json
[
  { "name": "verify", "args": { "state": "logged_out", "asserts": [
      { "element": { "id": "login_username" } }, { "element": { "id": "login_password" } },
      { "element": { "id": "login_submit" } }, { "element": { "id": "home_screen" }, "absent": true } ] },
    "timeoutMs": 1200000 }
]
```
(Run ios.json's logout first, or the iOS leg fails with the keychain shape.)

**unknown-env.json** — V6:
```json
[
  { "name": "ensure_state", "args": { "state": "logged_out", "platform": "android", "environment": "nope" }, "label": "must refuse IMMEDIATELY, no adapter work" },
  { "name": "verify", "args": { "state": "logged_out", "asserts": [], "environment": "nope" }, "label": "must be a thrown refusal, not per-leg FAILED sections" }
]
```

## 4. Expected results (baseline from 2026-10-05 against `5473982`)

| step | expected | why |
|---|---|---|
| android `logged_out` | ok, ~10 s; trace has `⚠ reach fresh_launch: … DESTRUCTIVE` and `⚠ clearState` | fresh launch |
| android `logged_in` | **ERROR, expected**: `Timed out after 20000ms waiting for state logged_in after reach flows`; the trace shows `fill: id:"login_username"`, `fill: id:"login_password"`, `⚠ tap: the soft keyboard covered id:"login_submit"; hidden before tapping`, `tap: id:"login_submit"`, `wait: state post_login_fork` … `flow login: done`, then `↻ recovery` | the test account has SMS 2FA; `averi.yaml` says the agent types the code, not the flow. The `⚠ tap` line IS the keyboard guard proof. If that line is missing, or the tap pressed a key (a stray character in the password field), C1/V1 regressed |
| android `smoke` | ok; 4 × `assert PASS`; **no `⚠ frame:` line** | static login screen; a `⚠ frame:` here means the stability wait regressed (V2+V3) or the screen really animates |
| android `ui_snapshot` | ok, JSON tree with `login_*` ids | |
| ios logout `tap` | `Tapped text:"Odhlásiť sa" (3 matches; picked the only interactive one (button))` | |
| ios `logged_out` | `state logged_out: already active` | |
| ios `logged_in` | **ERROR, expected** (2FA, as Android); trace shows both fills and `tap: id:"login_submit"`, NO `⚠ tap` line (no oracle on iOS), `optional: skipped text:"Not Now"` | |
| ios `ui_snapshot` | `twofactor_*` ids | proves the login reached the code screen |
| `verify` both | ok (not isError); `## android` with `All 4 asserts passed`; `## ios` the same after a logout, else `FAILED: Timed out … login_screen` contained in its leg with the other leg intact | |
| unknown-env | both steps ERROR within ~1 s, message `Unknown environment "nope" (from requested) — known: stage, edu`; **no** `## android` section, no `launch:` trace | V6 |

Stderr: exactly one `averi: loaded AVERI_STAGE_USERNAME, … from .env.averi` line per scenario (per config
per server process) — C2.

## 5. Not covered by finportal — needs a small extra config

- **Color / OCR asserts and `verify` with a `contract`** (C3, V2+V3's "moving frame is a miss", V4+V5's
  tables): finportal has no layout contract and no `color`/`ocr` asserts. Author a 2-anchor contract for
  the login screen (`login_submit` with a `bg`, `login_title`/label with `text`) from one `ui_snapshot` +
  a screenshot, run `verify … contract: <path>` and `assert` with `{ color: … }` / `{ ocr: … }` on the
  static login screen (must PASS, no `⚠ frame:`), then on the 2FA screen if it has a spinner or a
  blinking caret (a color/ocr assert must FAIL with `the screen did not settle: N captures …`, and
  `screenshot`/`ensure_state` output must carry one `⚠ frame:` line). Compare the `## text parity` section
  against a run of the same contract on `5473982` — wording and row order must be identical.
- **`scroll_until`** (V2+V3 changed flows' post-swipe pause 500 → 400 ms): no finportal flow scrolls. Add a
  throwaway `scroll_until` step on any scrollable screen (or use mp-native, which has one) and watch
  for a swipe that "overshoots" because the read happened before the list settled — if it does, 400 ms is
  too short on that device and `interact/scroll.ts`'s default is the knob.
- **Baseline screenshot assert** (C9, V2+V3): run `assert { screenshot: 'login', threshold: 0.01 }` twice
  on the static login screen: first `baseline created`, second `0.00% of pixels differ`; then on a moving
  screen the first run must say `baseline not created: the screen did not settle …`.

## 6. Reading a failure

- A `✗` line in a flow trace names the failing step; `⚠` lines before it are the context (keyboard guard,
  recovery pass, destructive rung). `appAlive: unknown` means the device could not be asked, not that the
  app died.
- Per-leg `FAILED:` inside a `## android` / `## ios` section is contained: the run continued. A thrown error
  (isError with no sections) is a pre-flight refusal: bad contract field, unknown environment.
- `the screen did not settle: N captures …` is V2+V3 working as designed on a moving screen; on a screen you
  believe is static it is a finding — capture the screenshot series (`captures` is the count) and file it
  under `docs/bugs/` in the style of the 2026-09-18 handoff (claim → code says → change).
- Anything that differs from §4 that is not a device/network hiccup: file it under `docs/bugs/`, name the
  commit it implicates from the table in §0, and reproduce it in a unit test before changing `src/`.
