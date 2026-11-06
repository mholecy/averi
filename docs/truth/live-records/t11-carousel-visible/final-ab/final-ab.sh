#!/bin/zsh
# T11's final measurement. usage: final-ab.sh <commit under test> [dry]. dry: every count at 1, records in final-dry, marked and not counted.
# Reading rule for the fix arm: a 90-px stroke carrying 0, then a first probe `checked` MISMATCH, is T12: name it, not a failure of this fix.
# Not on a healthy AVD: lv-d62-drop or control as a rate (0 on both arms says nothing there). The headline is lv-d62-short.
S=<scratchpad>
export PATH=/opt/homebrew/opt/node@22/bin:$PATH:$HOME/Library/Android/sdk/platform-tools
COMMIT=${1:?commit under test}; DRY=$2; BASE=b3ce0150
W=$S/wt/t11; B=$S/wt/t11-base; O=$S/t11-records/final${DRY:+-dry}; I=$O/index.txt; mkdir -p $O
n() { [[ -n $DRY ]] && echo 1 || echo $1; }
die() { echo "ABORT: $*" | tee -a $I; exit 3; }
A() { adb -s emulator-5554 shell "$@"; }
[[ -n $DRY ]] && echo "DRY RUN, not counted" >> $I
# S1: both checkouts exactly what they claim, clean.
[[ -d $B ]] || git -C <repo> worktree add --detach $B $BASE > /dev/null 2>&1 || die "no base worktree"
[[ -e $B/node_modules ]] || ln -s <repo>/node_modules $B/node_modules
for pair in "$B $BASE" "$W $COMMIT"; do d=${pair% *}; c=${pair#* }
  [[ $(git -C $d rev-parse HEAD) == $(git -C $d rev-parse $c) ]] || die "$d is not at $c"
  [[ -z $(git -C $d status --porcelain) ]] || die "$d is not clean"
done
cd $W
# S2: a booted device, and the framework never restarting under the run.
[[ $(A getprop sys.boot_completed | tr -d '\r') == 1 ]] || die "not booted"
START=$(A getprop sys.system_server.start_count | tr -d '\r'); [[ -n $START ]] || die "no start count"
stamp() { local c; c=$(A getprop sys.system_server.start_count | tr -d '\r') || die "adb failed at $1"; [[ $c == $START ]] || die "start count $START -> $c at $1"
  echo "$1 $(date +%H:%M:%S) host=[$(uptime | sed 's/.*averages*: //')] start_count=$c dev=[$(A cat /proc/loadavg | tr -d '\r')]" >> $I; }
recorded() { node -e "const r=JSON.parse(require('fs').readFileSync('$1','utf8'));process.exit(r.results?.length>0||r.first?1-1:1)" 2>/dev/null; }
live() { local nm=$1 side=$2; shift 2; stamp "before $nm"; node --import tsx scripts/truth/live.ts --serial emulator-5554 --side $side "$@" --record $O/$nm.json > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"
  recorded $O/$nm.json || die "$nm left no record (rc=$rc): harness failure, $O/$nm.log"; }
custom() { local nm=$1 side=$2 c=$3; stamp "before $nm"; T11_WT=$W T11_SIDE=$side node --import tsx $S/custom.mts $O/$nm.json $c > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"; recorded $O/$nm.json || die "$nm left no record (rc=$rc)"; }
settings() { local nm=$1 side=$2; stamp "before $nm"; T11_WT=$W T11_SIDE=$side node --import tsx $S/settings-network.mts $O/$nm.json > $O/$nm.log 2>&1; local rc=$?; stamp "after $nm rc=$rc"; recorded $O/$nm.json || die "$nm left no record (rc=$rc)"; }
# Every pair ABBA: abba <count> <runner> <name> <args…>
abba() { local cnt=$1 run=$2 nm=$3; shift 3; local i; for i in $(seq 1 $cnt); do
  if (( i % 2 )); then $run $nm-base-$i $B "$@"; $run $nm-fix-$i $W "$@"; else $run $nm-fix-$i $W "$@"; $run $nm-base-$i $B "$@"; fi; done; }
read_device() { local l=$1; local F=$O/frames-$l.txt; stamp "before raw-$l"
  node docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs $O/raw-$l.jsonl 6 $l > /dev/null 2>&1
  stamp "after raw-$l"
  A 'am force-stop dev.averi.lab; am start -W -n dev.averi.lab/.MainActivity --es cell carousel-recycler-free' > /dev/null; sleep 1.5
  A 'dumpsys gfxinfo dev.averi.lab reset > /dev/null; input swipe 872 497 432 497 1000'; sleep 1.2; A input swipe 824 497 682 497 300; sleep .8
  { node $S/fs.mjs dev.averi.lab; A 'dumpsys gfxinfo dev.averi.lab' | grep -E 'Total frames|Janky frames:|50th percentile|90th percentile|Slow UI|Slow issue|Missed'; A 'dumpsys input' | grep -A11 RecentQueue | head -12 | grep -E 'Motion|Recent'; } >> $F 2>&1
  A 'am force-stop dev.averi.lab; am start -W -a android.settings.SETTINGS' > /dev/null; sleep 2
  A 'dumpsys gfxinfo com.android.settings reset > /dev/null; input swipe 540 1700 540 1300 1000'; sleep 1
  { node $S/fs.mjs com.android.settings; A 'dumpsys gfxinfo com.android.settings' | grep -E 'Janky frames:|50th percentile|Slow UI|Slow issue|Missed'; } >> $F 2>&1
  A 'am force-stop com.android.settings; input keyevent 3'; stamp "after frames-$l"; }
guest_read() { { echo "== scales"; for k in window_animation_scale transition_animation_scale animator_duration_scale; do echo "$k=$(A settings get global $k | tr -d '\r')"; done; echo "== top"; A top -b -n2 -d2 -m 25; echo "== cpuinfo"; A dumpsys cpuinfo | head -40; echo "== host (ps was refused in this sandbox; its error kept)"; ps -Ao pcpu,pmem,comm 2>&1 | grep -i -E 'qemu|emulator|not permitted' | head -5; } > $O/guest-$1.txt 2>&1; }
# Every group labelled by a raw read before and after it (6 rounds, about 75 s, the after doubling as the next group's before).
# Short: 6 or more of 24 strokes at 94 px or less. A group whose reads disagree is marked in each of its records, not dropped.
LAST_RAW=""; RAW_N=0
raw_read() { RAW_N=$((RAW_N+1)); local f=$O/raw-group-$RAW_N.jsonl; stamp "before raw-group-$RAW_N"
  node docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs $f $(n 6) "$1" > /dev/null 2>&1; stamp "after raw-group-$RAW_N"; [[ -s $f ]] || die "no $f"; LAST_RAW=$f; }
group() { local g=$1; shift; local before=$LAST_RAW; "$@"; raw_read "after $g"
  node $S/label-group.mjs $O "$g" $before $LAST_RAW >> $I || die "could not label $g"; }
git -C $W log -1 --format='fix commit %H' >> $I; git -C $B log -1 --format='base commit %H' >> $I
guest_read fresh; read_device fresh
# S3: fails closed.
[[ -s $O/raw-fresh.jsonl ]] || die "no raw-fresh.jsonl"
SHORT=$(node -e "const l=require('fs').readFileSync('$O/raw-fresh.jsonl','utf8').trim().split('\n').flatMap(x=>JSON.parse(x).strokes);console.log(l.filter(s=>s.carry<=94).length)") || die "raw-fresh unreadable"
[[ $SHORT == <-> ]] || die "SHORT is '$SHORT'"
echo "fresh raw short $SHORT of 24" >> $I
LAST_RAW=$O/raw-fresh.jsonl
# If strokes run short after the boot, T12 needs that state now, and it may not last.
if (( SHORT >= 6 )); then
  guest_read short
  t12() { for i in $(seq 1 $(n 12)); do
    live t12-control-$i $W --groups carousel --cases lv-d62-control
    live t12-cut-$i $W --groups visibility --cells scroll-bounded-flush
  done; }
  group t12 t12
  DROP_PAIRS=$(n 20)
else DROP_PAIRS=$(n 6); fi
group short abba $(n 20) live short --groups carousel --cases lv-d62-short
group drop abba $DROP_PAIRS live drop --groups carousel --cases lv-d62-drop
group control abba $(n 6) live control --groups carousel --cases lv-d62-control
group pins abba $(n 4) live pins --groups visibility --cells scroll-sticky-cut,scroll-bounded-flush
two() { abba $(n 4) live two --groups carousel --cases lv-d62-drop-two; for i in $(seq 1 $(( $(n 8) - $(n 4) ))); do [[ -n $DRY ]] && break; live two-fix-extra-$i $W --groups carousel --cases lv-d62-drop-two; done; }
group two two
# Settings: a no-change check. No real app reaches the held path: its text comes whole and off the edge on the first probe.
group settings abba $(n 4) settings settings
# Harm: (1) the one predicted harm, (2) the whole carousel group, (3) the whole visibility group, replies diffed.
group harm-sticky-max2 abba $(n 3) custom harm-sticky-max2 sticky-R-2
group harm-carousel abba $(n 2) live harm-carousel --groups carousel
# Base, fix, base: the second base run is the noise floor (diffvis.mjs says what counts as caused by the fix).
vis3() { live harm-visibility-base-1 $B --groups visibility; live harm-visibility-fix-1 $W --groups visibility; live harm-visibility-base-2 $B --groups visibility; }
group harm-visibility vis3
node $S/diffvis.mjs $O/harm-visibility-base-1.json $O/harm-visibility-fix-1.json $O/harm-visibility-base-2.json > $O/harm-visibility-diff.txt 2>&1 || die "the visibility diff failed"
guest_read end; read_device end
A am force-stop dev.averi.lab
echo done >> $I
