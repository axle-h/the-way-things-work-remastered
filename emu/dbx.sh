#!/usr/bin/env bash
# Run DOSBox-X headless-ish on a nested X server (default :6) so it can be screenshotted
# and driven with xdrive.py. Records the PID so only this instance is ever killed.
#   dbx.sh start [dosbox-x args...]   start in background (PID in $RUNDIR/dosbox.pid)
#   dbx.sh stop                       kill the instance started above
#   dbx.sh shot FILE                  screenshot the nested X screen
#   dbx.sh key|type|click ...         forwarded to xdrive.py
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMU="${EMU_DIR:-$HERE/../vendor/emu}"
RUNDIR="$EMU/run"
PY="${XDRIVE_PY:-python3}"
export DISPLAY="${XDISPLAY:-:6}"
export SDL_VIDEODRIVER=x11 SDL_VIDEO_DRIVER=x11
unset WAYLAND_DISPLAY
mkdir -p "$RUNDIR"

cmd="${1:-}"; shift || true
case "$cmd" in
  start)
    if [[ -f "$RUNDIR/dosbox.pid" ]] && kill -0 "$(cat "$RUNDIR/dosbox.pid")" 2>/dev/null; then
      echo "already running: $(cat "$RUNDIR/dosbox.pid")" >&2; exit 1
    fi
    cd "$EMU"
    nohup dosbox-x -nopromptfolder -conf "$HERE/dosbox-x.base.conf" "$@" >"$RUNDIR/dosbox.log" 2>&1 &
    echo $! >"$RUNDIR/dosbox.pid"
    echo "started pid $!"
    ;;
  stop)
    if [[ -f "$RUNDIR/dosbox.pid" ]]; then
      kill "$(cat "$RUNDIR/dosbox.pid")" 2>/dev/null || true
      rm -f "$RUNDIR/dosbox.pid"
    fi
    ;;
  running)
    [[ -f "$RUNDIR/dosbox.pid" ]] && kill -0 "$(cat "$RUNDIR/dosbox.pid")" 2>/dev/null && echo yes || echo no
    ;;
  *)
    exec "$PY" -I "$HERE/xdrive.py" "$cmd" "$@"
    ;;
esac
