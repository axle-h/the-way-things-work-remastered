# Kubernetes deployment

k3s. The ingress assumes traefik and cert-manager, and the volume assumes the `local-path`
provisioner. One pod, `twtw`, serves the web app baked into the image and reads the extracted disc
from the `data` volume, mounted read-only at `/data`. Modelled on the Encarta project's `k8s/`.

The disc data is not in the image or in git, because it is DK's material. It gets onto the volume from
a local `vendor/cd` with `sync-data.sh`.

The public hostname is not in git either, nor anywhere else in the repository, CI or commit messages.
`apply.sh` reads it from `$TWTW_HOST`, or else from the first line of `host.local` beside it that is
neither blank nor a `#` comment. `host.local` is gitignored. The hostname is substituted into
`ingress.template.yml`, which the API server rejects as it stands.

```shell
printf '# Public hostname for k8s/apply.sh. Gitignored: never commit it.\ntwtw.example.com\n' > k8s/host.local   # once; or export TWTW_HOST
pnpm data                     # extract the ISO to vendor/cd and write vendor/cd/manifest.json, if not done yet
./k8s/apply.sh --dry-run      # server-side dry run; changes nothing
./k8s/sync-data.sh            # vendor/cd → the volume (creates the claim if need be)
./k8s/apply.sh                # namespace.yml, then twtw/, then the ingress
```

The namespace must be `twtw`. The ingress names the redirect middleware as
`twtw-redirect-http-https@kubernetescrd`, and traefik resolves that by namespace. The certificate is
`twtw-tls`, from the `letsencrypt-production` ClusterIssuer, by an HTTP-01 challenge: it issues once
the hostname resolves to the cluster and port 80 reaches traefik.

| File | What |
|---|---|
| `namespace.yml` | the `twtw` namespace |
| `twtw/deployment.yml` | the server: uid 10001, read-only root filesystem, probes on `/healthz` |
| `twtw/service.yml` | `twtw`, port 80 → the pod's 8080 |
| `twtw/pvc.yml` | `data`, 1Gi on `local-path` |
| `twtw/redirect-http-https.yml` | traefik middleware: HTTP → HTTPS |
| `ingress.template.yml` | the ingress, with `${TWTW_HOST}` for the hostname |
| `loader.yml` | the throwaway pod `sync-data.sh` copies through |

## The data

`sync-data.sh [CD_DIR]` mirrors `vendor/cd` (the default, or `$TWTW_CD`) onto the volume. The web
app finds every file through `manifest.json` at the root of the extracted disc, which `pnpm data`
writes, so the script refuses a directory without one. It starts `loader.yml`, an alpine pod and the
only thing that mounts the volume read-write, then runs rsync with `kubectl exec` as its transport,
and deletes the loader when it is done. No node SSH is needed.

A re-run sends only what changed, and deletes from the volume whatever `vendor/cd` no longer has. An
interrupted run leaves the volume's files whole: partial transfers wait in `/data/.rsync-partial/`, and
the next run picks them up. A loader left behind by a killed run is replaced at the next start. The
server opens files per request, so it needs no restart after a sync.

The claim asks for 1Gi against a 275M `vendor/cd`; a CD holds at most 650M. `local-path` neither
enforces the size nor expands a bound claim. Raising it means deleting the claim and running a full
sync again. Nothing is lost, since all of it comes from `vendor/cd`.

## The image

`ghcr.io/axle-h/the-way-things-work-remastered:latest` is published on every push to main by
`.github/workflows/container.yml`, after two checks:
- `.github/scripts/check-image-has-no-disc-data.sh` fails on disc file names, anything in `/data`, a
  data manifest, or any file over 1 MiB other than node and its libraries;
- `.github/scripts/smoke-test.sh` proves the image starts on an empty, read-only `/data` and serves
  `/healthz`, the web app, `robots.txt` (which disallows everything) and `X-Robots-Tag: noindex` on
  every response.

Every build is also tagged with its commit, which is the tag to pin or roll back to.
`imagePullPolicy: Always` means a `rollout restart` picks up the newest build:

```shell
kubectl -n twtw rollout restart deploy/twtw
```

GHCR creates a package private regardless of the repository's visibility. The first CI push
succeeds, and the cluster then fails to pull with `denied` or `403` (ImagePullBackOff). Make the
package public once, in its own settings (Package settings → Danger Zone → Change visibility).

To build and check it locally (podman or docker):

```shell
podman build --format docker -t localhost/twtw:local .
ENGINE=podman .github/scripts/check-image-has-no-disc-data.sh localhost/twtw:local
podman run -d --rm --name twtw-local --read-only --tmpfs /tmp -p 127.0.0.1:48080:8080 \
  --security-opt label=disable -v "$PWD/vendor/cd:/data:ro" localhost/twtw:local
.github/scripts/smoke-test.sh http://127.0.0.1:48080 --data   # without --data for an empty /data
podman stop twtw-local
```

The image is Alpine with only the node binary taken from the official node image (no npm, Corepack or
yarn), the server's TypeScript source, which node runs directly, and the built web app. It runs as
uid 10001 on a read-only root filesystem, with `/tmp` an emptyDir. The server reads `TWTW_CD=/data`,
`TWTW_DIST=/app/web`, `HOST=0.0.0.0` and `PORT=8080` (`apps/server/src/main.ts`). Service links are
off, so the `twtw` Service does not inject `TWTW_PORT=…` and friends into the same variable namespace.
The base images in the `Dockerfile` and the loader's image are pinned by version and digest.
