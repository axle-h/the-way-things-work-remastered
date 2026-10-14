#!/bin/bash
# usage: dec.sh outfile addr...   (addresses like 1008:0b44); runs Ghidra headless on saved project
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
R=$ROOT/analysis/decompiled
GHIDRA=${GHIDRA_HOME:-$HOME/ghidra}
out=$1; shift
$GHIDRA/support/analyzeHeadless $R/ghidra TWTW -process TWTW.EXE -noanalysis -scriptPath $ROOT/tools/ghidra/scripts -postScript DecompAt.java "$out" "$@" > $R/out/dec_last.log 2>&1
grep -v '^\s*$' "$out"
