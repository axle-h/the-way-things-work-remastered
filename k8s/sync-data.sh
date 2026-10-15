#!/usr/bin/env bash
# Mirrors the extracted disc (`vendor/cd`, with the `manifest.json` that `pnpm data` writes) onto the
# `data` volume: rsync, tunnelled through `kubectl exec` into a throwaway loader pod (`loader.yml`)
# that mounts the volume read-write. No node SSH, and incremental: a re-run sends only what changed,
# and deletes what the source no longer has.
#
#   ./sync-data.sh                    # from ../vendor/cd
#   ./sync-data.sh /path/to/cd        # or $TWTW_CD
#
# Interrupted, it leaves the volume's files whole (partial transfers wait in `.rsync-partial/`) and a
# re-run resumes. The server opens files per request, so it needs no restart afterwards.
set -euo pipefail

NS=${NS:-twtw}
POD=data-loader

# rsync runs `<rsh> <host> rsync --server …`; this re-entry turns that into `kubectl exec`. Over
# SPDY, not kubectl's default websockets: on a sustained upload the websocket transport's pings
# time out behind the data, and kubectl drops stdin.
if [[ "${1:-}" == --rsh ]]; then
  pod=$2
  shift 2
  KUBECTL_REMOTE_COMMAND_WEBSOCKETS=false exec kubectl exec -i -n "$NS" "$pod" -- "$@"
fi

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
src=$(cd "${1:-${TWTW_CD:-$here/../vendor/cd}}" && pwd)

# The web app finds every file through the manifest, so a disc without one serves nothing.
if [[ ! -f "$src/manifest.json" ]]; then
  echo "$src has no manifest.json: run \`pnpm data\` first, or point this at the extracted disc." >&2
  exit 1
fi
if [[ ! -f "$src/DKCODE/TWTW.PNG" ]]; then
  echo "$src has no DKCODE/TWTW.PNG: is it the extracted disc?" >&2
  exit 1
fi
command -v rsync >/dev/null || { echo "rsync is not installed locally" >&2; exit 1; }

cleanup() {
  kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait=false >/dev/null || true
}

# A loader left over from an interrupted run is replaced, not reused: it may be on an old spec.
kubectl -n "$NS" delete pod "$POD" --ignore-not-found --wait=true
trap cleanup EXIT
# The claim too, so the first sync works before `apply.sh` has run; applying it again changes nothing.
kubectl apply -f "$here/twtw/pvc.yml"
kubectl apply -f "$here/loader.yml"
# The first run also binds the volume (`WaitForFirstConsumer`), and the pod installs rsync.
kubectl -n "$NS" wait --for=condition=Ready "pod/$POD" --timeout=300s

echo "syncing $src/ ($(du -sh "$src" | cut -f1)) to $NS/pvc/data"
# -rlt and not -a: owners are meaningless on the volume, and the server only needs to read, hence
# --chmod. --delete-after removes files only once everything new has arrived.
rsync -rlt --chmod=D755,F644 \
  --delete-after --partial-dir=.rsync-partial \
  --no-inc-recursive --info=progress2,stats1 --human-readable \
  --blocking-io -e "$here/sync-data.sh --rsh" \
  "$src/" "$POD:/data/"

kubectl -n "$NS" exec "$POD" -- df -h /data
