# 45. ARCHITECTURE.md holds the current layering; the history lives in its records

Status: accepted 2026-11-11 (performance backlog row A32, docs/plans/2026-10-30-performance-backlog.md; architecture
review 2026-11-11, card 14, docs/architecture-reviews/2026-11-11-ten-agent-review.html). Docs only: no behaviour
changes, golden unchanged.

## Context

- ARCHITECTURE.md had grown to 301,741 bytes in 383 lines. Its §2, meant to give the layering and the words of each
  layer, had one 44 KB line (the UI-tree layer) and one 36 KB line (Interaction). The review counted 191 dated
  "since/until/round" marks in it. The layering could no longer be read from it.
- The same history was written three times — in the ADRs, in the backlog and inline in ARCHITECTURE.md (and in the
  code's comments) — and the copies had started to disagree.
- The file shipped in the npm package (`package.json` `files`), so every user downloaded it, though nothing at runtime
  or in the skill reads it.
- scripts/mutation/scope.json was 98 KB, 69 KB of it baseline history that no code reads (ADR 0038's A32 amendment).

## Decision

**ARCHITECTURE.md is the current design only: the layer order and its exceptions, each layer's job, modules and
vocabulary, the adapter interface, the averi.yaml example and design points, the tool surface and the reliability
rules. It carries no dates. Why a rule is so, and when it became so, lives in its records, and ARCHITECTURE.md points
at them:**

- an owner decision, with its measurements and residuals: its ADR (docs/adr/);
- a row of work and its commit: the backlog (docs/plans/2026-10-30-performance-backlog.md);
- a rule's cases, measured device shapes and stated residuals: the owning symbol's doc comment in `src/`;
- the finding behind a rule: its bug note (docs/bugs/), and the reviews (docs/architecture-reviews/);
- the long form itself (301,741 bytes, ≈295 KB), unedited: `git show 57ba80d8:ARCHITECTURE.md`.

ARCHITECTURE.md went from 301,741 to about 51,000 bytes; its prose wraps at 120
columns; only the diagram and the tables run longer.
The section numbers §1–§10 are kept, because `src/` and the tests cite them (§2 the order, §3 the adapter and
selectors, §4 averi.yaml, §5 the tools and the config table, §8 waits, the keyboard guard and `appAlive`). The named
exceptions to the layer order are kept word for word in substance, since tests/architecture/layering.test.ts requires
each to be named in ARCHITECTURE.md with its reason.

**ARCHITECTURE.md leaves the npm package.** `files` is now `dist`, `skill`, SETUP.md and LICENSE (README.md and
package.json are always packed). The reasons:

- Its readers are contributors, and they read it in the repository. An agent using averi reads the tool descriptions,
  the server's `instructions` and the skill; neither SKILL.md nor any file under `skill/` names ARCHITECTURE.md, and no
  code reads it.
- README.md links it relatively, and npm renders that link against the repository (`repository` in package.json), so
  the link still resolves from the package page.
- The release smoke (`npm run release:smoke`, scripts/release/pack-files.ts) checks the packed list against whatever
  `files` says, so it needs no change: it requires every `files` entry and forbids the checkout's trees, and
  ARCHITECTURE.md is in neither list. tests/release/pack-files.test.ts's sample package names ARCHITECTURE.md only as
  an example `files` entry; it tests the check, not this package, and was left alone. docs/release.md's Gate A
  description of the expected entries is updated.

**In `src/`, a comment keeps the why and drops the when — on touch, never as a sweep.** A32 touched no source file, so
it rewrote no comment.

## Where the long form went

Every paragraph of the long form, by section, with the records that hold its decisions and history. "Code" means the
named modules' doc comments, which the new ARCHITECTURE.md names in the layer's module list.

| Long form | Kept in ARCHITECTURE.md as | Decisions and history in |
|---|---|---|
| §1 problem and positioning | §1, unchanged in substance | — |
| §2 diagram and the one-way rule | §2, "The rule", with every named exception | backlog A4, A5, A16, A18, A24; tests/architecture/layering.test.ts |
| §2 Device Adapter bullet (the platform-agnostic roles, `everyNode`, the rect primitives) | §2 Device Adapter | backlog A16, A18, A24; ADR 0018 (`PACED`); code: adapters/types.ts |
| §2 UI tree bullet (geometry, draw order and its NOT_DRAWN rows, covers, presentation, flat-list rules, floating tab bar, bare tree, soft keyboard) | §2 UI tree, by question | ADR 0001–0004, 0010, 0013–0015, 0018, 0019, 0021; backlog A2, A5, D17; the bug notes it cited; code: ui-tree/draw-order.ts (`NOT_DRAWN`, the flat-list and tab-bar constants with the owner's decisions), placed.ts, presentation.ts, bare-tree.ts, soft-keyboard.ts, keyboard-cover.ts |
| §2 Standing, the eyes, the remedy and the keyboard position | §2 UI tree (standing, one look, the keyboard read, the eyes) | ADR 0005, 0010, 0012, 0013, 0015, 0016, 0024, 0026; backlog A3, A26, A30; code: ui-tree/standing.ts, look.ts (why the screen is not a look's), keyboard-position.ts, eyes.ts |
| §2 UI-tree vocabulary | §2 UI tree, vocabulary | — |
| §2 Flow Engine bullet (the modules; `process.env` read once; the one launch; one run per call; the session) | §2 Flow Engine | backlog A19; code: flow/credentials.ts, launch.ts, tool-config.ts, engine.ts (`FlowEngine.run`, `EngineSession`) |
| §2 Interaction bullet (resolve, tap, the status and navigation bands, slivers, fill, keyboard, scroll_until) | §2 Interaction, by verb; §8 for the guard | ADR 0009, 0013, 0018, 0021, 0023, 0026, 0028, 0034; backlog A1, A2, A9, A10, A28, D2, D5, D18, D24, D25, D28, D29, D59, D60, D64b, D68, T4, T5, T11; the bug notes it cited; code: interact/ modules, adapters/android.ts (`viewport`'s status band: kept as an answer, a timed-out read kept as none) and ui-tree/geometry.ts (`inScroller` reading `clipsDescendants`) |
| §2 Verification Engine bullet (capture, scale, pixel poll, OCR, parity) | §2 Verification Engine | ADR 0013, 0024, 0025; backlog D15; docs/bugs/2026-08-26-png-scale-needs-out-of-tree-screen-size.md; code: verify/capture.ts, scale.ts, pixel-poll.ts |
| §2 Orchestration and MCP layer bullets | §2 Orchestration, §2 MCP layer | backlog A10, A24, A29, A30; code: run/preflight.ts, run/commands.ts, mcp/tools.ts, mcp/config-policy.ts, flow/tool-config.ts; tests/mcp/tool-descriptions.test.ts |
| §3 interface members' platform notes | §3 interface sketch; each member's doc in adapters/types.ts | ADR 0027 (`touchable`), 0040 (`settleCadenceMs`), 0021 (`treeReadSettles`); backlog A3 |
| §3 discovery off the adapter, `unauthorized` devices, selector tapping off the adapter | §3 | code: adapters/discovery.ts, mcp/registry.ts; ADR 0031 |
| §3 Android bullets (modules, capture, screenshot bytes, tree, input, launch, the shell) | §3 Android | ADR 0035, 0037, 0038 (A27), 0041; backlog A27, D19, D43a, D55, D73; code: adapters/android.ts, android-start.ts, adb-shell.ts, screenshot-bytes.ts, input-text.ts |
| §3 iOS bullets (screenshot, launch and links, input, the idb helper, the tree sources) | §3 iOS | ADR 0019, 0031, 0032 (with its D26b, D44, D49a, D54, D74 amendments), 0036, 0037, 0039; backlog D7a, D7b, D20, D21, D24, D39, D42, D48, D57, A1, A20, A23; the bug notes it cited; code: adapters/ios.ts, ios-foreground.ts, ios-tree-source.ts, wda.ts, wda-source.ts; docs/plans/ios-wda-tree-source.md |
| §3 the iOS exception to "adapters know no averi.yaml" | §3 iOS, with the decision not to translate the words above the seam | ADR 0032, the A32 note (the review's remedy owner above the seam, not taken) |
| §3 shutdown contract | §3 iOS, shutdown | code: mcp/lifecycle.ts, adapters/wda.ts |
| §3 normalized tree and selectors | §3 | ADR 0028 (`secure`); code: adapters/types.ts (`UiNode`), ui-tree/selectors.ts |
| §4 example and its comments | §4, the example with its dated comments shortened | — |
| §4 design points (the ladder, the recovery pass, never wiping blind, a bare tree, `requires:` loops, traces, `optional:`, secrets) | §4 design points | ADR 0030, 0033; backlog A31, D2, D21, D27, D50; docs/bugs/2026-08-26-ensure-state-no-recovery-pass.md, docs/bugs/2026-08-26-recovery-pass-skips-throwing-last-rung.md; code: flow/engine.ts (`OptionalNotSkipped` and the owner's decision on a present-but-refused element, `ReentryError`), flow/condition.ts |
| §5 tool table (each row's refusal cases and history) | §5, one line per tool | skill/references/tools.md (every refusal case); ADR 0010 (D78), 0013, 0018, 0021, 0032 (D41, D48); backlog D1, D3, D52, D54, D55, T11, T12; the bug notes it cited |
| §5 which tools read averi.yaml | §5, the table and the three policies | code: mcp/config-policy.ts, flow/tool-config.ts; backlog A29, A30 |
| §6 distribution, §7 skill | §6, §7 | this ADR (the package's files, and the two sentences below the table) |
| §8 waits, the keyboard guard, crash detection, host-command words | §8 | ADR 0013, 0016, 0017, 0022, 0027, 0029, 0030, 0036, 0039, 0043; backlog A17, A29, D13, D21, D33, D65, D70, D74; the bug notes it cited; code: verify/capture.ts, interact/keyboard*.ts, run/app-health.ts |
| §8 differential harness, performance baseline, device batches, live cases, mutation run | §8, one line each | scripts/differential/README.md; scripts/perf/baseline.ts; ADR 0020, 0038, 0041, 0044; backlog A11, A21, A22, A34, T2, T10, T16, T20a, T20b, T24; docs/mutation-ledger.md |
| §9 roadmap (status as of 0.9.0) | §9, shipped and open | the backlog |
| §10 risks | §10 | docs/plans/ios-wda-tree-source.md (decision 4) |

Two reasons the long form gave in prose, kept here because no other record holds them:

- §7: the skill teaches the workflow and only what the tool descriptions do not already say, because an eval on Opus
  5.5 (2026-10-08) found that most of the old single-file skill duplicated the descriptions, and that the value it
  measured was in the `ensure_state` reach ladder and the `averi.yaml` modelling.
- §8 (login edge cases, design intent, not implemented): an OTP would come from a `prompt_human` step or a test-backend
  hook (`otp: { source: … }`); wrong-PIN lockout protection would allow at most one automatic retry, then stop and
  report, never brute-forcing a real backend. Neither key exists in the strict schema, which refuses both.

## Consequences

- A new decision gets an ADR (or an amendment), a row of work a backlog row; ARCHITECTURE.md changes only where the
  layering, a module's job or a word of a layer's vocabulary changes, and says it without a date.
- A reader who wants the history of a paragraph starts at the table above, then at the long form in git.
- A citation in `src/` of a moved paragraph (`ARCHITECTURE.md §N, "…"`) resolves through the table above, and is
  repointed when its file is next touched; A32 changed no source file.
- tests/docs/references.test.ts still resolves every symbol reference in ARCHITECTURE.md, the skill docs and the ADRs;
  the new text names fewer symbols, each of which resolves.
- The package is about 290 KB smaller.
