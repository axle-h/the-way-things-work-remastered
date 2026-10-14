# tools/data

`pnpm data` prepares the disc data for the web app:

1. If `vendor/cd` (or `$TWTW_CD`) does not exist, it extracts the disc image with `7z`. The image is `$TWTW_ISO`, or the only `.iso` file in `vendor/`. Extraction goes to a temporary directory that is renamed when complete.
2. It writes `manifest.json` at the root of the extracted disc, and rewrites it only when its contents change. Running it again is harmless.

The manifest lists every file on the disc (hidden files and the manifest itself excluded), sorted by path:

```json
{
  "version": 1,
  "files": [
    { "path": "DKCODE/TWTW.PNG", "size": 123456 }
  ]
}
```

- `path` is relative to the disc root, uses `/` separators and keeps the case found on the disc.
- `size` is in bytes.

The type and validator are `Manifest` and `parseManifest` in `packages/engine/src/manifest.ts`.
