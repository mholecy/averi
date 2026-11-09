#!/bin/zsh
# D71's live regression (uiautomator, averi_lab): the no-clear cases p1, f13, f15, f16, g3, fp1, fp2 (native) and rfe2
# (React Native) on base 3b7393ba (`--side`, a git-archive extract) and on the fix (this checkout), plus p1o — a
# temporary case, the outer-space append D72 covers as os1/os2 (not in the committed harness: added for the run, removed
# after). usage: run.sh <base checkout> <limit min>
export PATH=/opt/homebrew/opt/node@22/bin:$PATH:$HOME/Library/Android/sdk/platform-tools
BASE=${1:?base checkout}; LIMIT=$(( ${2:?limit min} * 60 ))
O=${0:A:h}; I=$O/index.txt; W=${0:A:h}/../../../..; cd $W; T0=$(date +%s)
CASES=scripts/truth/live-cases.ts
A() { adb -s emulator-5554 shell "$@"; }
restore() { git checkout -- $CASES; }
die() { echo "ABORT: $*" | tee -a $I; A am force-stop dev.averi.lab; A am force-stop dev.averi.lab.rn; restore; exit 3; }
[[ $(A getprop sys.boot_completed | tr -d '\r') == 1 ]] || die "not booted"
START=$(A getprop sys.system_server.start_count | tr -d '\r'); [[ -n $START ]] || die "no start count"
stamp() { local c; c=$(A getprop sys.system_server.start_count | tr -d '\r') || die "adb failed at $1"; [[ $c == $START ]] || die "start count $START -> $c at $1"
  echo "$1 $(date +%H:%M:%S) host=[$(uptime | sed 's/.*averages*: //')] start_count=$c dev=[$(A cat /proc/loadavg | tr -d '\r')] uptime=$(A cat /proc/uptime | tr -d '\r' | cut -d' ' -f1)" >> $I; }
left() { echo $(( LIMIT - ($(date +%s) - T0) )); }
recorded() { node -e "const r=JSON.parse(require('fs').readFileSync('$1','utf8'));process.exit(r.results?.length>0?0:1)" 2>/dev/null; }
live() { local nm=$1; shift; (( $(left) > 60 )) || die "out of time before $nm"; stamp "before $nm"
  node --import tsx scripts/truth/live.ts --serial emulator-5554 "$@" --record $O/$nm.json > $O/$nm.log.txt 2>&1; local rc=$?; stamp "after $nm rc=$rc"
  recorded $O/$nm.json || die "$nm left no record (rc=$rc): $O/$nm.log.txt"; }
git diff --quiet -- $CASES || die "$CASES has local changes"
# p1o: ` Jr. ` (a trailing outer space) appended to p1's prefill; the app should hold `Jan Šťastný Jr. `
perl -0pi -e "s/(  \{ id: 'p1', cell: P,[^\n]*\n)/\$1  { id: 'p1o', cell: P, says: 'D71 run only: a no-clear fill appends text with a trailing outer space', calls: [fill(P, 'name', ' Jr. ')], judge: holds('name', 'Jan Šťastný Jr. ') },\n/" $CASES
grep -q "id: 'p1o'" $CASES || die "p1o not added"
echo "commit $(git log -1 --format=%H) (fix); base $(basename $BASE)" >> $I
NATIVE=p1,p1o,f13,f15,f16,g3,fp1,fp2
live base-forms --groups forms --cases $NATIVE --side $BASE
live fix-forms --groups forms --cases $NATIVE
live base-rn --app react-native --groups forms --cases rfe2 --side $BASE
live fix-rn --app react-native --groups forms --cases rfe2
A am force-stop dev.averi.lab; A am force-stop dev.averi.lab.rn; restore
echo "done, device time $(( $(date +%s) - T0 )) s" >> $I
