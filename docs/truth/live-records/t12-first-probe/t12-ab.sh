#!/bin/zsh
# T12's live measurement. usage: t12-ab.sh <fix commit> [dry]. dry: every count at 1, records in t12-dry, marked and not counted.
# One harness (the fix's checkout), each arm's src by --side / T12_SIDE; ABBA; a raw read (6 rounds) between groups labels each.
S=<scratchpad>
REPO=<repo>
export PATH=/opt/homebrew/opt/node@22/bin:$PATH:$HOME/Library/Android/sdk/platform-tools
COMMIT=${1:?fix commit}; DRY=$2; BASE=5f126fdc
W=$S/wt/t12; B=$S/wt/t12-base; H=$S/t12-harness; O=$S/t12-records/run${DRY:+-dry}; I=$O/index.txt; mkdir -p $O
T0=$(date +%s); LIMIT=$(( ${T12_LIMIT_MIN:-118} * 60 ))
n() { [[ -n $DRY ]] && echo 1 || echo $1; }
die() { echo "ABORT: $*" | tee -a $I; adb -s emulator-5554 shell am force-stop dev.averi.lab; exit 3; }
A() { adb -s emulator-5554 shell "$@"; }
# The device-time limit: no step starts that would end past it (estimate in minutes).
budget() { local used=$(( $(date +%s) - T0 )); (( used + $1 * 60 <= LIMIT )) || die "device time: ${used}s used, $1 min more would pass $(( LIMIT / 60 )) min"; }
[[ -n $DRY ]] && echo "DRY RUN, not counted" >> $I
for pair in "$B $BASE" "$W $COMMIT"; do d=${pair% *}; c=${pair#* }
  [[ $(git -C $d rev-parse HEAD) == $(git -C $d rev-parse $c) ]] || die "$d is not at $c"
  [[ -z $(git -C $d status --porcelain) ]] || die "$d is not clean"
done
cd $W
[[ $(A getprop sys.boot_completed | tr -d '\r') == 1 ]] || die "not booted"
START=$(A getprop sys.system_server.start_count | tr -d '\r'); [[ -n $START ]] || die "no start count"
stamp() { local c; c=$(A getprop sys.system_server.start_count | tr -d '\r') || die "adb failed at $1"; [[ $c == $START ]] || die "start count $START -> $c at $1"
  echo "$1 $(date +%H:%M:%S) host=[$(uptime | sed 's/.*averages*: //')] start_count=$c dev=[$(A cat /proc/loadavg | tr -d '\r')] uptime=$(A cat /proc/uptime | tr -d '\r' | cut -d' ' -f1)" >> $I; }
recorded() { node -e "const r=JSON.parse(require('fs').readFileSync('$1','utf8'));process.exit(r.results?.length>0||r.first?0:1)" 2>/dev/null; }
live() { local nm=$1 side=$2; shift 2; stamp "before $nm"; node --import tsx scripts/truth/live.ts --serial emulator-5554 --side $side "$@" --record $O/$nm.json > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"
  recorded $O/$nm.json || die "$nm left no record (rc=$rc): harness failure, $O/$nm.log"; }
custom() { local nm=$1 side=$2 c=$3; stamp "before $nm"; T12_WT=$W T12_SIDE=$side node --import tsx $H/custom.mts $O/$nm.json $c > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"; recorded $O/$nm.json || die "$nm left no record (rc=$rc)"; }
settings() { local nm=$1 side=$2; stamp "before $nm"; T12_WT=$W T12_SIDE=$side node --import tsx $H/settings-network.mts $O/$nm.json > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"; recorded $O/$nm.json || die "$nm left no record (rc=$rc)"; }
abba() { local cnt=$1 run=$2 nm=$3; shift 3; local i; for i in $(seq 1 $cnt); do
  if (( i % 2 )); then $run $nm-base-$i $B "$@"; $run $nm-fix-$i $W "$@"; else $run $nm-fix-$i $W "$@"; $run $nm-base-$i $B "$@"; fi; done; }
LAST_RAW=""; RAW_N=0
raw_read() { RAW_N=$((RAW_N+1)); local f=$O/raw-group-$RAW_N.jsonl; stamp "before raw-group-$RAW_N"
  node docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs $f $(n 6) "$1" > /dev/null 2>&1; stamp "after raw-group-$RAW_N"; [[ -s $f ]] || die "no $f"; LAST_RAW=$f; }
group() { local g=$1 need=$2; shift 2; budget $need; local before=$LAST_RAW; "$@"; raw_read "after $g"
  node $H/label-group.mjs $O "$g" $before $LAST_RAW >> $I || die "could not label $g"; }
git -C $W log -1 --format='fix commit %H' >> $I; git -C $B log -1 --format='base commit %H' >> $I
raw_read fresh
# 1. The headline: the first probe after the pre-drag dropped.
group drop-first 10 abba $(n 8) live drop-first --groups carousel --cases lv-t12-drop-first
# 2. The residual, fix only: the first two strokes dropped.
residual() { for i in $(seq 1 $(n 3)); do custom residual-fix-$i $W lv-t12-drop-two-first; done; }
group residual 4 residual
# 3. Cost: sticky rest R, bounded S and P, then Settings' "Network" (a no-change check).
group pins 20 abba $(n 4) live pins --groups visibility --cells scroll-sticky-rest,scroll-bounded-flush
group settings 5 abba $(n 4) settings settings
# 4. Sticky rest R with maxSwipes 1.
group rest-max1 4 abba $(n 2) custom rest-max1 rest-R-1
# 5. Whole visibility, base, fix, base.
vis3() { budget 26; live vis-base-1 $B --groups visibility; budget 26; live vis-fix-1 $W --groups visibility; budget 26; live vis-base-2 $B --groups visibility; }
group vis 80 vis3
node $H/diffvis.mjs $O/vis-base-1.json $O/vis-fix-1.json $O/vis-base-2.json > $O/vis-diff.txt 2>&1 || die "the visibility diff failed"
A am force-stop dev.averi.lab
echo "done, device time $(( ($(date +%s) - T0) / 60 )) min" >> $I
