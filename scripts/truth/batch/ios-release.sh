#!/bin/zsh
# Gate C of docs/release.md: the live golden (scripts/truth/live.ts) on the lab simulator, both iOS tree sources (idb,
# wda), the iOS-capable groups (forms, visibility, dismissal, ensure; carousel and chooser are Android only) — one
# live.ts run per source and group, each after a reset, each bounded. The owner's, outside the agent's sandbox (simctl,
# idb, xcodebuild and WebDriverAgent do not run inside it). Modeled on docs/truth/live-records/d74-dash-text/run.sh, its
# reset the batch's (ios-lab.ts#reset): the lab's idb companion and WebDriverAgent ended by their exact patterns
# (lab-lines.ts), never device-check's; the simulator restarted; no companion started by hand (idb starts its own).
#
# usage: scripts/truth/batch/ios-release.sh <out dir> [--udid <lab simulator>] [--limit <seconds per run>] [--no-build]
#   <out dir>   created if missing; gets ios-<source>-<group>.log.txt per run and ios-release.log.txt (the summary),
#               none holding an absolute path (the checkout, the temporary folder, home and the out dir are
#               replaced by <repo>, <tmp>, ~ and <out>: scripts/release/clean-log.ts), so they can be committed
#               under docs/releases/vX.Y.Z/; ios-build.log.txt, the build's last lines; the live records and the
#               screenshots of cases not ok under <out dir>/records and <out dir>/shots (not for committing).
#   --udid      the lab simulator; by default the one simulator whose name starts `averi-lab ` (lab-device.ts's
#               LAB_SIMULATOR_PREFIX) — the booted one when several are, else refused: name it.
#   --limit     each live.ts run's bound in seconds (default 1800); a run past it is UNPROVEN.
#   --no-build  skip building and installing the lab app from this checkout (the installed one must still carry this
#               checkout's cells.json).
# Exit: 0 every run PASS; 1 a run FAILed (live.ts exit 1: a mismatch not known, a known case fixed and not struck off, a
# skip that proves nothing, no first state); 2 refused (no out dir, no lab simulator, a tool missing, the build or the
# install failed); 3 unproven (a run past its bound, a run with no summary, a reset that failed) and nothing FAILed.
emulate -L zsh
setopt pipe_fail no_bg_nice
[[ -d /opt/homebrew/opt/node@22/bin ]] && path=(/opt/homebrew/opt/node@22/bin $path)

REPO=${0:A:h}/../../..; REPO=${REPO:A}; cd $REPO
OUT=''; U=''; LIMIT=1800; BUILD=1
while (( $# > 0 )); do
  case $1 in
    --udid) U=$2; shift 2 ;;
    --limit) LIMIT=$2; shift 2 ;;
    --no-build) BUILD=0; shift ;;
    -*) echo "ios-release: unknown flag $1" >&2; exit 2 ;;
    *) [[ -z $OUT ]] || { echo "ios-release: one out dir, not $1 too" >&2; exit 2; }; OUT=$1; shift ;;
  esac
done
[[ -n $OUT ]] || { echo 'usage: ios-release.sh <out dir> [--udid <lab simulator>] [--limit <seconds>] [--no-build]' >&2; exit 2; }
[[ $LIMIT == <60-> ]] || { echo "ios-release: --limit is whole seconds, at least 60, not $LIMIT" >&2; exit 2; }
mkdir -p $OUT/records $OUT/shots || exit 2
OUT=${OUT:A}
SUMMARY=$OUT/ios-release.log.txt; : > $SUMMARY
SOURCES=(idb wda)
GROUPS_IOS=(forms visibility dismissal ensure)

# A log's host paths replaced by <repo>, <tmp>, ~ and <out> (scripts/release/clean-log.ts).
clean() { node --import tsx scripts/release/clean-log.ts "$OUT=<out>"; }
say() { echo "$*" | clean | tee -a $SUMMARY; }
refuse() { say "REFUSED: $*"; say 'ios-release: exit 2'; exit 2; }

# `bounded <secs> <log> <command…>`: the command's output into <log>, TERM past <secs> (KILL 15 s later); 124 when
# past its bound, the command's exit code otherwise.
bounded() {
  local secs=$1 log=$2; shift 2
  local flag=$OUT/.past-bound-$$
  rm -f $flag
  "$@" > $log 2>&1 &
  local pid=$!
  ( sleep $secs; : > $flag; kill -TERM $pid 2>/dev/null; sleep 15; kill -KILL $pid 2>/dev/null ) &
  local dog=$!
  wait $pid; local rc=$?
  pkill -P $dog 2>/dev/null; kill $dog 2>/dev/null; wait $dog 2>/dev/null
  [[ -e $flag ]] && { rm -f $flag; return 124; }
  return $rc
}

for tool in xcrun idb node git; do command -v $tool > /dev/null || refuse "$tool not on PATH"; done

# The lab simulator: found by lab-device.ts's prefix, or the one named checked against it — before anything touches it
# (device-check's simulator never).
U=$(xcrun simctl list devices -j | node --import tsx --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { LAB_SIMULATOR_PREFIX, isDeviceCheckSimulator } from "./scripts/truth/lab-device.ts";
  const named = process.argv[1];
  const all = Object.values(JSON.parse(readFileSync(0, "utf8")).devices).flat()
    .filter((d) => d.name.startsWith(LAB_SIMULATOR_PREFIX) && d.isAvailable !== false && !isDeviceCheckSimulator(d.udid));
  const booted = all.filter((d) => d.state === "Booted");
  const pick = named !== "" ? all.filter((d) => d.udid === named) : booted.length === 1 ? booted : all;
  if (pick.length === 1) console.log(pick[0].udid);
  else {
    process.exitCode = 1;
    console.error(named !== "" ? `${named} is no available simulator named ${LAB_SIMULATOR_PREFIX}…: refused`
      : `${pick.length === 0 ? "no" : pick.length} simulators named ${LAB_SIMULATOR_PREFIX}…${pick.map((d) => ` ${d.udid} (${d.name}, ${d.state})`).join(",")}: name one with --udid`);
  }' "$U") || refuse 'no single lab simulator (see above)'
[[ -n $U ]] || refuse 'no single lab simulator (see above)'

say "ios-release: commit $(git rev-parse HEAD)$(git diff --quiet HEAD || echo ' (with local changes)'); $(date '+%Y-%m-%d %H:%M:%S'); udid $U; $(xcrun xcodebuild -version 2>/dev/null | head -1); node $(node --version); limit ${LIMIT} s per run"

# The lab's processes ended and the simulator restarted (ios-lab.ts#reset's order); 1 when the boot failed.
# The lab's idb companion (and its entry in idb's list) and its WebDriverAgent ended, port 8120's listeners too
# (ios-lab.ts#endCompanion, #killLabWda; the patterns lab-lines.ts's).
end_lab() {
  pkill -f "idb_companion --udid $U" 2>/dev/null; idb disconnect $U > /dev/null 2>&1
  pkill -f 'DerivedData/averi-wda-lab([/ ]|$)' 2>/dev/null; pkill -f "Devices/$U/.*WebDriverAgentRunner" 2>/dev/null
  local p; for p in $(lsof -nP -t -iTCP:8120 -sTCP:LISTEN 2>/dev/null); do kill -TERM $p 2>/dev/null; done
}
reset() {
  end_lab
  xcrun simctl shutdown $U 2>/dev/null
  bounded 300 $OUT/.boot.txt xcrun simctl boot $U || return 1
  bounded 300 $OUT/.boot.txt xcrun simctl bootstatus $U -b || return 1
  rm -f $OUT/.boot.txt
  sleep 5
}

# The lab app from this checkout (lab-build.ts's iOS need): the catalog checked, xcodegen, xcodebuild, installed; then
# the installed cells.json must be main's.
reset || refuse "the lab simulator $U did not boot"
if (( BUILD )); then
  BUILD_LOG=$OUT/ios-build.log.txt
  bounded 120 $OUT/.catalog.txt node --import tsx scripts/truth/catalog.ts --check || { clean < $OUT/.catalog.txt >> $SUMMARY; refuse "fixtures/apps/cells.json is stale (catalog.ts --check)"; }
  rm -f $OUT/.catalog.txt
  bounded 2400 $OUT/.build.txt zsh -c 'cd fixtures/apps/ios && xcodegen generate && xcodebuild -scheme AveriLab -destination "id=$1" -derivedDataPath build build' _ $U
  rc=$?; tail -20 $OUT/.build.txt | clean > $BUILD_LOG; rm -f $OUT/.build.txt
  (( rc == 0 )) || refuse "the lab app's build failed or ran past 2400 s (exit $rc; ios-build.log.txt, its last 20 lines)"
  xcrun simctl install $U fixtures/apps/ios/build/Build/Products/Debug-iphonesimulator/AveriLab.app || refuse 'the lab app did not install'
  say "lab app: built from this checkout and installed"
fi
CONTAINER=$(xcrun simctl get_app_container $U dev.averi.lab app 2>/dev/null) || refuse 'the lab app (dev.averi.lab) is not installed'
cmp -s $CONTAINER/cells.json fixtures/apps/cells.json || refuse "the installed lab app's cells.json is not this checkout's (build it: leave out --no-build)"

# The runs: groups outer, sources inner; each after a reset.
FAILED=0; UNPROVEN=0
for g in $GROUPS_IOS; do
  for s in $SOURCES; do
    name=ios-$s-$g; log=$OUT/$name.log.txt; raw=$OUT/.$name.raw
    if ! reset; then say "UNPROVEN $name: the reset before it failed (simctl boot)"; UNPROVEN=1; continue; fi
    start=$SECONDS
    bounded $LIMIT $raw node --import tsx scripts/truth/live.ts --udid $U --sources $s --groups $g --record $OUT/records/$name.json --shots $OUT/shots/$name
    rc=$?
    clean < $raw > $log; rm -f $raw
    took=$(( SECONDS - start ))
    tally=$(grep -m1 '^# Live golden:' $log)
    if (( rc == 124 )); then say "UNPROVEN $name: past its bound (${LIMIT} s)"; UNPROVEN=1
    elif [[ -z $tally ]]; then say "UNPROVEN $name: no summary (exit $rc, ${took} s) — the run threw; see $name.log.txt"; UNPROVEN=1
    elif (( rc == 0 )); then say "PASS $name (${took} s): ${tally#\# Live golden: }"
    else say "FAIL $name (exit $rc, ${took} s): ${tally#\# Live golden: }"; FAILED=1
    fi
  done
done

# The lab's processes ended at the end too; the simulator left booted.
end_lab
xcrun simctl terminate $U dev.averi.lab 2>/dev/null
if (( FAILED )); then code=1; elif (( UNPROVEN )); then code=3; else code=0; fi
say "ios-release: exit $code ($(date '+%H:%M:%S'))"
exit $code
