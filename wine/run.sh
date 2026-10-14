#!/usr/bin/env bash
# Run The Way Things Work under Wine (needs a Wine build with Win16 support,
# e.g. Fedora's wine 11 WoW64). Everything generated lives under vendor/.
#
#   wine/run.sh            set up (first run only) and launch
#   TWTW_ISO=... wine/run.sh   use a different ISO
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ISO=${TWTW_ISO:-"$ROOT/vendor/Way Things Work, The (1994)(Dorling Kindersley).iso"}
CD="$ROOT/vendor/cd"
APP="$ROOT/vendor/patched"
export WINEPREFIX=${WINEPREFIX:-"$ROOT/vendor/wineprefix"}
export WINEDEBUG=${WINEDEBUG:--all}

if [ ! -f "$CD/DKCODE/TWTW.EXE" ]; then
    7z x -y -o"$CD" "$ISO" >/dev/null
fi
# The app checks the CD volume label starts with "DKMM"; Wine reads it from here.
printf 'DKMMTWTW' > "$CD/.windows-label"

if [ ! -f "$APP/TWTW.EXE" ]; then
    mkdir -p "$APP"
    python3 -I "$ROOT/wine/patch_palette.py" "$CD/DKCODE/TWTW.EXE" "$APP/TWTW.EXE"
    ln -sf "$CD/DKCODE/TWTW.PNG" "$APP/TWTW.PNG"
fi

if [ ! -f "$WINEPREFIX/drive_c/windows/twtw.ini" ]; then
    wineboot -i >/dev/null 2>&1
    ln -sfn "$CD" "$WINEPREFIX/dosdevices/d:"
    wine reg add 'HKLM\Software\Wine\Drives' /v 'd:' /t REG_SZ /d cdrom /f >/dev/null
    printf '[Directory]\r\nData=D:\r\n' > "$WINEPREFIX/drive_c/windows/twtw.ini"
    wineserver -w
fi

exec wine "$(winepath -w "$APP/TWTW.EXE")"
