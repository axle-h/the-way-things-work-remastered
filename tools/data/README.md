# tools/data

`pnpm data` prepares the disc data for the web app:

1. If `vendor/cd` (or `$TWTW_CD`) does not exist, it extracts the disc image with the project's own ISO 9660 reader (`openIso` in `packages/formats`, spec in `docs/formats/iso9660.md`). The image is `$TWTW_ISO`, or the only `.iso` file in `vendor/`. File names are kept as on the disc (upper case, without the `;1` version), and modification times come from the directory records. Extraction goes to a temporary directory that is renamed when complete.
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
