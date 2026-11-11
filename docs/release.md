# Releasing averi

The gates a new averi version passes before it is tagged, and who runs each. The standing lab runs (`npm run
truth:lab` on Android, `npm run truth:lab:ios` on iOS), which run the live golden's groups, are run here, before a
release, and not on a schedule (backlog T24, which replaced T20c).

## When this applies

Any request to release averi, publish it to npm, cut a tag, or bump its version (`package.json` `version`), in any
words. The agent follows this runbook from the top. It does not commit a version bump or a tag before gates A, B and C
have passed, and it never pushes, tags or publishes: the owner does (Gate D).

A gate that fails stops the release. Report what failed with the log, and do not bump, tag or "fix forward" inside the
release. An unproven result is not a pass: `truth:lab`'s exit 3, a live run past its bound, a run with no summary, or a
device that is not up. A fix is a normal change on main. Once it is merged, the release starts again from Gate A.

## Preconditions

- The averi checkout on `main`, clean, and equal to `origin/main` (Gate A checks this). Every gate runs against that
  one commit. Write its hash down; the record names it.
- An out folder outside the checkout for everything the gates write, one per release attempt (`OUT` below; for
  example under the session's temporary folder). Only the cleaned `.log.txt` files from it are committed.
- Android: the `averi_lab` AVD running as `emulator-5554`. iOS: the lab simulator (`averi-lab …`), for the owner.
- Node 20+ (`node --version`), the repo's `node_modules` installed (`npm ci` when the lockfile changed).

Every log that goes into the record passes through `scripts/release/clean-log.ts`, which replaces the checkout, the
temporary folder and home with `<repo>`, `<tmp>` and `~` (pass `"$OUT=<out>"` for the out folder):

```
<command> 2>&1 | node --import tsx scripts/release/clean-log.ts "$OUT=<out>" > "$OUT/<name>.log.txt"
```

## Gate A: off the device (agent)

Run in this order. Each step must pass before the next one runs. The mutation run and the golden take minutes, so run
them in the background.

1. **Clean main, in sync with origin.**

   ```
   git switch main && git fetch origin
   git status --porcelain            # nothing
   git rev-parse HEAD origin/main    # the same hash twice
   ```

   If HEAD is ahead of `origin/main`, ask the owner to push. Never push yourself. If the fetch cannot reach the
   network (the agent's sandbox), compare with the last fetched `origin/main` and say so in the record.

2. **Lint:** `npm run lint`, exit 0.
3. **Tests:** `npm test` (the full vitest suite), exit 0 with no failed test. Keep the last lines (the `Test Files` and
   `Tests` tallies).
4. **Build:** `npm run build`, exit 0.
5. **Golden** (the replayed truth corpus, judged against this checkout's KNOWN tables, not against the last tag):

   ```
   G='node --import tsx scripts/differential/golden.ts --corpus tests/fixtures/truth'
   $G > "$OUT/golden.txt"                           # exit 0
   $G --json > "$OUT/golden.json"                   # exit 0
   $G --against "$OUT/golden.json"                  # exit 0
   ```

   The pass criterion (`goldenReport` and `diffReport` in golden.ts and golden-diff.ts; the exit code is `exitCode`
   in ratchet.ts):
   - each run exits 0. Exit 1 means a mismatch not in KNOWN, a known one that drifted from its class, reply kind,
     calls or pin, a harness fault, or a broken target;
   - the report's first line reads `# Golden: N checks, M mismatches (M known, 0 new), 0 broken targets`. "New" is the
     report's word for a mismatch KNOWN does not list. There is no `, … with a harness fault` part;
   - the report has no `## Ratchet:` section. That section also appears at exit 0 when a known row is fixed (`N to
     strike`) or a pin is stale;
   - the `--against` report (the run judged against a `--json` of itself, so `## Changed: 0 checks`) reads
     `## Strike from KNOWN: 0 rows`, `## COUNTS: 0 captures` and `## Re-pin: 0 rows`. These three sections are
     computed from this run and the checkout's tables only, never from the base.

   Inside the agent's sandbox the macOS Vision recognizer does not run, so the first line ends `, K skipped (no OCR on
   this host: …)`. That is expected there; say it in the record. On the owner's Mac nothing is skipped.

6. **Mutation, cold:** `npm run mutate -- --force` (every group: core, android, scene, then lab, each bounded at 600 s),
   exit 0. Each group's floors are met (`checkFloors` in mutate.ts). Keep the per-module score lines and the last lines,
   and record each group's time (`npm run mutate: <group> passed in N s`); a group over ~480 s on a quiet host means the
   next change to it moves a module out or adds a group (ADR 0038's threshold rule and its A21 amendment).
7. **The package:** `npm pack --dry-run` lists what ships. Then `npm run release:smoke` (after the build in step 4;
   `pack-smoke.ts` in scripts/release) packs the real tarball into a temporary folder and checks it. Its file list
   must hold the bin's target (`dist/mcp/server.js`), every `files` entry (dist, skill, SETUP.md, ARCHITECTURE.md),
   README.md, LICENSE and package.json, and nothing from tests/, fixtures/, docs/, reports/, src/ or scripts/, and no
   compiled test. Every bare import in its dist must be a declared dependency. Its bin, started with node over stdio,
   must answer `initialize` with package.json's name and version and `tools/list` with exactly the 18 tools of
   tests/helpers/tool-names.ts, in order. Exit 0 and the last line `release smoke: PASS`. Exit 1 is a FAIL that names
   each problem. Exit 2 means dist is missing (run `npm run build`).

   Its limit: the extracted package runs over the checkout's node_modules, devDependencies among them, so a
   dependency missing from `dependencies` only shows through the import check. That check reads the static
   `import`/`export … from` lines and string-literal `import('…')` calls of dist. An import whose name is built at
   run time (`import(name)`, `createRequire`) of a devDependency would pass the smoke and fail for a user.

## Gate B: Android (agent)

**The device rules.** Only `emulator-5554`, the `averi_lab` AVD (live.ts and lab-run.ts refuse any other device
before touching it). Never start, restart, cold-boot or kill an AVD or emulator (`emulator -avd`, `adb reboot`, `adb
emu kill`, wipe-data). Never `pm clear`, and never dexopt or recompile (`cmd package compile`, `bg-dexopt-job`).
Installing, uninstalling and reinstalling the lab APK is allowed: truth:lab's build and cleanup do it. Run one agent on
the device at a time: before starting, check that no other live.ts or lab-run.ts is running (`pgrep -fl
'live.ts|lab-run.ts'`). Run it in the background and wait for its exit.

**When the emulator is not up.** `adb devices` must list `emulator-5554` as `device`. If it is missing, `offline` or
`unauthorized`, or the lab guard refuses it, stop the release at Gate B and tell the owner what you saw. Do not start
or restart anything to bring it up.

**The standing lab run** (docs/verification.md, "Standing lab run"), one command with one exit code:

```
npm run truth:lab -- --out "$OUT/truth-lab" --serial emulator-5554
```

It builds the lab app from this checkout under JDK 17 and installs it, runs the live golden's `chooser` group between a
check of the chooser's lab defaults before and after, then live.ts's other Android groups, `forms`, `visibility`,
`ensure` and `carousel`, each as its own block (backlog A22). The `dismissal` group is iOS only: Gate C runs it. It
bounds itself: each live run 1800 s (`B_LIVE`'s default, standing.ts's KNOBS), the visibility group 3000 s of its own
(lab-run.ts's LIVE_SECS, backlog A34), the build 2400 s. Setting `B_LIVE` bounds every other live run with it, and can
only raise the visibility group's 3000 s: that group takes the larger of the two, so `B_LIVE=1800` leaves it at 3000 s
and `B_LIVE=3600` raises it to 3600 s. Each call runs in a process group of its own, which a run past its bound has
killed whole (the `adb` it started among it), and its block is INCONCLUSIVE; each live run's header in the run's output
names its bound (`== visibility live android-visibility (bound 3000 s; log: …) ==`). After such an INCONCLUSIVE, `adb -s
emulator-5554 shell echo ok` must answer before you report the run; if it does not, stop and tell the owner.

**Its wall time.** About 52 min at the pace of A22's first run on main (2026-11-11, docs/truth/live-records/a22-gate-b/,
its load not recorded): the build and the chooser group a few minutes, `forms` about 12 min, `visibility` about 31 min
(181 cases, about 10 s each), `ensure` under 2 min, `carousel` about 5 min. Other agents' mutation runs on the same
machine stretch every group: in A34's runs of the visibility group alone (docs/truth/live-records/a34-visibility/) a
case took about 10 s while the load stayed under 15 and about 28 s at 50–65, which would take the group about 85 min,
past its own bound, and the emulator's framework restarted under it both times. Run Gate B when the machine is not
loaded. Setting `B_LIVE` (seconds, up to 7200) is the way to give a slow run more time: every live run gets at least
that much.

It passes only on **exit 0**: every block PASS, and no INCONCLUSIVE or ERROR line. Exit 1 is a FAIL or a `RESTORE.txt`
to act on by hand, and it goes to the owner. Exit 2 means refused, and 3 means unproven. Neither is a pass. Any line in
the SUMMARY's ERROR section makes the run unproven (exit 3), an unread log's NOTE included. The record keeps the
SUMMARY (`$OUT/truth-lab/meta/run-<id>/summary.txt`), cleaned.

Each live block's verdict is main's rejudge of its run (`summarize` in live-cases.ts), and its FAIL names the failure
reasons the rejudge wrote beside its summary (`<block>/run-<id>/android-<group>.rejudge.json`): a case marked `[NOT
known: …]` (every mismatch must be one live-known.ts lists), `FIXED, not intermittent — strike off live-known.ts`,
`SKIPPED where a skip proves nothing`, `NO FIRST STATE`, `MISMATCH (hedged ceiling)`, a stale chooser premise. The
block's line quotes the summary's header, `# Live golden: N cases, … M mismatches (0 not known), …`, and its rejudge
summary (`android-<group>.rejudge.txt`) holds the rest. The carousel group reads the device's state before and after
its cases (about 55 s each) into the `Device:` line of its rejudge summary,
`carousel/run-<id>/android-carousel.rejudge.txt`. That line is a label, not a gate: record it.

**A `loud` count above 0 does not fail the gate.** A LOUD case is one where the app's model does not hold what the case
asked and averi said so (an error, or `NOT verified`): honest, not a pass of that case, and not counted against the run
by `summarize`. Two LOUD kinds do fail it there: a case whose app wrote no state (class `no-state`, the `NO FIRST
STATE` line) and the carousel's hedged ceiling when it is a MISMATCH. Its unjudged form (`LOUD (hedged ceiling): …
fewer than … judged`) is a LOUD, said in the record. The record lists every LOUD case by id and class, Gate B's and
Gate C's alike.

## Gate C: iOS (owner, outside the agent's sandbox)

The agent's sandbox cannot drive simctl, idb, xcodebuild or WebDriverAgent. The agent asks the owner to run, from the
checkout at the commit Gate A tested (`xcrun simctl list devices | grep 'averi-lab '` names the lab simulator):

```
npm run truth:lab:ios -- --out <dir outside the checkout> --udid <lab simulator> [--groups forms|visibility|…]
```

This is lab-run-ios.ts in scripts/truth/batch, lab-run's iOS counterpart through the same runner. Its `lab` block
guards the simulator (device-check's and any simulator not named `averi-lab …` are refused before any call), resets
it, builds the lab app from the checkout and installs it, and checks that the installed `cells.json` is the
checkout's. Then it runs live.ts once per iOS group (forms, visibility, dismissal, ensure) under idb, each after a
health check. live.ts builds the iOS adapter as the server does, the idb helper included (ADR 0032, amendment A23),
and says so on its log's `ios:` line.
Then it runs each group under WebDriverAgent, each inside its own D43 settings window: the simulator's
settings backed up, the run, WebDriverAgent ended, the settings put back key by key and compared. The finportal key is
read at the start and at the end, and a change fails the run. A signal puts an open window back and exits 130. Each
live run is bounded (`B_LIVE`, 1800 s by default).

It passes only on **exit 0**, the same codes as `truth:lab`; each live block's verdict is its run's rejudge exit
code, so the live golden's rules above hold, LOUD cases included. Exit 1 is a FAIL or a `RESTORE.txt`, exit 2 means
refused or nothing ran (no udid, the simulator not the lab's or not booting), 3 means unproven, 130 means interrupted.
If no lab simulator is available, only the owner may waive Gate C, never the agent. Gate C is not skipped silently: a
release without it says so, with the owner's waiver, in the record and in the release commit's message.

The owner hands back the SUMMARY (`<out>/meta/run-<id>/summary.txt`) for the record, cleaned with clean-log.ts.

## Gate D: the release (agent prepares, owner publishes)

Only after A, B and C passed, on the commit they tested:

1. **The version, by semver** (reason from `git log v<last>..HEAD` and `git diff v<last> -- src/mcp skill
   package.json`, not from commit counts):
   - **major**: a consumer must change something to keep working. An MCP tool or a parameter is removed or renamed,
     its type is narrowed or it becomes required, an `averi.yaml` key is removed or changes meaning, or the Node engine
     floor is raised;
   - **minor**: new tools, parameters or yaml keys, or behaviour consumers will see change without opting in (a reply
     that now refuses, warns or takes longer). The house style counts the latter as minor even while 0.x;
   - **patch**: fixes only, with no new surface and no change a consumer sees except the bug gone.
2. **The bump:** `npm version X.Y.Z --no-git-tag-version` (it writes package.json and package-lock.json). Then `npm
   run build && npm run release:smoke` again. The smoke only proves that the bin reads the package.json shipped
   beside it, so check by eye that its `server:` line shows the new version.
3. **The record:** `docs/releases/vX.Y.Z.md` (the template below) and its logs under `docs/releases/vX.Y.Z/`, each a
   cleaned `.log.txt`. Then `npx vitest run tests/docs`: the path-hygiene test holds docs/ to no host path.
4. **The commit:** one commit, `chore(release): X.Y.Z`, holding package.json, package-lock.json and the record. The
   body follows the 0.9.0 release commit (`git show v0.9.0`): why this version and not the next one up or down, what
   consumers will see change without opting in, and what was not proven (a skipped gate, the OCR rows skipped in the
   sandbox). End it with the Co-Authored-By line.
5. **Hand over to the owner.** Stop here, and give the owner the commands:

   ```
   git tag -a vX.Y.Z -m X.Y.Z
   git push origin main vX.Y.Z
   npm publish            # prepublishOnly runs npm test and npm run build again
   ```

### The record template

```markdown
# averi X.Y.Z

- Date: YYYY-MM-DD
- Commit under test: <full hash> (main == origin/main at <hash>)
- Release commit: chore(release): X.Y.Z
- Version reasoning: <one line: major/minor/patch and why>

| Gate | Result | Log |
| --- | --- | --- |
| A clean main | main == origin/main, clean | — |
| A lint | exit 0 | vX.Y.Z/lint.log.txt |
| A tests | N files, M tests passed | vX.Y.Z/test.log.txt |
| A build | exit 0 | vX.Y.Z/build.log.txt |
| A golden | N checks, M mismatches (M known, 0 new), 0 broken; K skipped (no OCR) | vX.Y.Z/golden.log.txt |
| A golden diff | Strike 0, COUNTS 0, Re-pin 0 | vX.Y.Z/golden-against.log.txt |
| A mutation | core PASS, android PASS, scene PASS, lab PASS (cold) | vX.Y.Z/mutate.log.txt |
| A package | release smoke: PASS (N files, 18 tools) | vX.Y.Z/release-smoke.log.txt |
| B truth:lab | exit 0: lab, chooser, forms, visibility, ensure, carousel PASS | vX.Y.Z/android-truth-lab.log.txt |
| B carousel label | Device: <label> | vX.Y.Z/android-carousel.rejudge.log.txt (from `android-carousel.rejudge.txt`) |
| C iOS | exit 0: lab, 4 idb and 4 wda blocks PASS (or: not run, and why) | vX.Y.Z/ios-truth-lab.log.txt |

Not proven: <anything skipped or unproven, or "nothing">.
```

For the golden log, keep the report's first lines (`head -5`) rather than all of its rows. For the test, mutation and
live logs, keep the tallies and anything not ok.
