// Where the device checks find the extracted disc: `$TWTW_CD`, or `vendor/cd` in the repository.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
export const discDir = resolve(process.env['TWTW_CD'] ?? resolve(repoRoot, 'vendor/cd'));
export const hasDisc = existsSync(resolve(discDir, 'manifest.json'));
