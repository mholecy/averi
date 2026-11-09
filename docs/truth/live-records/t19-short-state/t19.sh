#!/bin/zsh
# T19's live measurement, main's src (T12 merged), no injection: lv-d62-control and bounded-flush P/S `fully` at their real
# lengths, interleaved with raw-strokes reads (no averi) that label each block fast or short. usage: t19.sh <out dir> <limit min> [smoke]
export PATH=/opt/homebrew/opt/node@22/bin:$PATH:$HOME/Library/Android/sdk/platform-tools
O=${1:?out dir}; LIMIT=$(( ${2:?limit min} * 60 )); SMOKE=$3; I=$O/index.txt; mkdir -p $O
W=${0:A:h}/../../../..; cd $W; T0=$(date +%s)
A() { adb -s emulator-5554 shell "$@"; }
die() { echo "ABORT: $*" | tee -a $I; A am force-stop dev.averi.lab; exit 3; }
[[ $(A getprop sys.boot_completed | tr -d '\r') == 1 ]] || die "not booted"
START=$(A getprop sys.system_server.start_count | tr -d '\r'); [[ -n $START ]] || die "no start count"
stamp() { local c; c=$(A getprop sys.system_server.start_count | tr -d '\r') || die "adb failed at $1"; [[ $c == $START ]] || die "start count $START -> $c at $1"
  echo "$1 $(date +%H:%M:%S) host=[$(uptime | sed 's/.*averages*: //')] start_count=$c dev=[$(A cat /proc/loadavg | tr -d '\r')] uptime=$(A cat /proc/uptime | tr -d '\r' | cut -d' ' -f1)" >> $I; }
left() { echo $(( LIMIT - ($(date +%s) - T0) )); }
recorded() { node -e "const r=JSON.parse(require('fs').readFileSync('$1','utf8'));process.exit(r.results?.length>0?0:1)" 2>/dev/null; }
live() { local nm=$1; shift; stamp "before $nm"; node --import tsx scripts/truth/live.ts --serial emulator-5554 "$@" --record $O/$nm.json > $O/$nm.log.txt 2>&1; local rc=$?; stamp "after $nm rc=$rc"
  recorded $O/$nm.json || die "$nm left no record (rc=$rc): $O/$nm.log.txt"; }
RAW_N=0
raw_read() { RAW_N=$((RAW_N+1)); local f=$O/raw-$RAW_N.jsonl; stamp "before raw-$RAW_N"
  node docs/truth/live-records/t11-carousel-visible/raw/raw-strokes.mjs $f $1 "$2" > /dev/null 2>&1; stamp "after raw-$RAW_N"; [[ -s $f ]] || die "no $f"; }
git log -1 --format='commit %H' >> $I
if [[ -n $SMOKE ]]; then
  raw_read 1 smoke; live control-1 --groups carousel --cases lv-d62-control
  live flush-1 --groups visibility --cases scroll:scroll-bounded-flush.P.fully,scroll:scroll-bounded-flush.S.fully
else
  C=0; F=0; B=0
  raw_read 4 fresh
  while (( $(left) > 150 )); do B=$((B+1)); echo "block $B" >> $I
    for k in 1 2 3 4 5 6; do (( $(left) > 90 )) || break; C=$((C+1)); live control-$C --groups carousel --cases lv-d62-control; done
    (( $(left) > 120 )) && { F=$((F+1)); live flush-$F --groups visibility --cases scroll:scroll-bounded-flush.P.fully,scroll:scroll-bounded-flush.S.fully; }
    (( $(left) > 55 )) && raw_read 4 "after block $B"
  done
fi
A am force-stop dev.averi.lab
echo "done, device time $(( ($(date +%s) - T0) )) s" >> $I
