#!/usr/bin/env bash
# Launch "The Way Things Work" (1994, Win16) in DOSBox-X on MS-DOS 6.22 + Windows 3.1.
#
#   emu/twtw.sh [--builtin] [--win|--dos] [--nested] [--scale N] [-- extra dosbox-x args]
#
#   default     boot real MS-DOS 6.22 from vendor/emu/hdd.img, start Windows 3.1, run the game
#   --builtin   use DOSBox-X's built-in DOS instead (same hdd.img mounted as C:)
#   --win       stop at Program Manager instead of starting the game
#   --dos       stop at the DOS prompt
#   --nested    run on the nested X server ${XDISPLAY:-:6} (for screenshots / xdrive.py automation)
#   --scale N   integer window scale (default 2; 1 when --nested)
#
# Hardware: 486 / 16 MB / S3 Trio64 (Win3.1 S3 1.70.04 driver, 640x480x256) / SB16 @ 220,7,1,5
# (Win3.1 "Sound Blaster 1.5" driver) / ATAPI CD-ROM on IDE secondary master holding the ISO.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
EMU="${EMU_DIR:-$ROOT/vendor/emu}"
ISO="${TWTW_ISO:-$ROOT/vendor/Way Things Work, The (1994)(Dorling Kindersley).iso}"
HDD="$EMU/hdd.img"
PART_OFFSET=$((63 * 512))   # first partition of the imgmake hd_520 image

mode=realdos target=game nested=0 scale=""
extra=()
while (($#)); do
  case "$1" in
    --builtin) mode=builtin ;;
    --win) target=win ;;
    --dos) target=dos ;;
    --nested) nested=1 ;;
    --scale) scale="$2"; shift ;;
    --) shift; extra=("$@"); break ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

[[ -f "$HDD" ]] || { echo "missing $HDD" >&2; exit 1; }
[[ -f "$ISO" ]] || { echo "missing $ISO" >&2; exit 1; }

case "$target" in
  game) runline='WIN C:\DKMM\TWTW\TWTW.EXE' ;;
  win)  runline='WIN' ;;
  dos)  runline='' ;;
esac

args=(-nopromptfolder -conf "$HERE/dosbox-x.base.conf")
if ((nested)); then
  export DISPLAY="${XDISPLAY:-:6}" SDL_VIDEODRIVER=x11 SDL_VIDEO_DRIVER=x11
  unset WAYLAND_DISPLAY
  scale="${scale:-1}"
fi
scale="${scale:-2}"
if ((scale > 1)); then
  args+=(-set "render scaler=normal${scale}x forced")
fi

if [[ "$mode" == realdos ]]; then
  # C:\AUTORUN.BAT is called at the end of AUTOEXEC.BAT; rewrite it for the chosen target.
  tmp="$(mktemp)"
  if [[ -n "$runline" ]]; then printf '%s\r\n' "$runline" >"$tmp"; else : >"$tmp"; fi
  mcopy -o -i "$HDD@@$PART_OFFSET" "$tmp" ::AUTORUN.BAT
  rm -f "$tmp"
  args+=(
    -c "imgmount 2 \"$HDD\" -t hdd -fs none"
    -c "imgmount d \"$ISO\" -t iso -ide 2m"
    -c "boot c:"
  )
else
  args+=(
    -c "imgmount c \"$HDD\" -t hdd"
    -c "imgmount d \"$ISO\" -t iso"
    -c "set PATH=Z:\\;C:\\WINDOWS;C:\\DOS"
    -c "set TEMP=C:\\TEMP"
    -c "set BLASTER=A220 I7 D1 H5 P330 T6"
    -c "c:"
  )
  [[ -n "$runline" ]] && args+=(-c "$runline")
fi

cd "$EMU"
exec dosbox-x "${args[@]}" "${extra[@]}"
