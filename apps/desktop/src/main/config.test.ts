import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG_NAME, EMPTY_CONFIG, loadConfig, parseConfig, saveConfig } from './config.ts';

describe('config', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'twtw-config-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('is empty before the first save', async () => {
    expect(await loadConfig(directory)).toEqual(EMPTY_CONFIG);
  });

  it('saves and loads the disc', async () => {
    const config = { disc: { kind: 'iso', path: '/home/me/TWTW.iso' } } as const;
    await saveConfig(directory, config);
    expect(await loadConfig(directory)).toEqual(config);
    expect(JSON.parse(await readFile(join(directory, CONFIG_NAME), 'utf8'))).toEqual(config);
  });

  it('ignores damaged or unexpected contents', async () => {
    await writeFile(join(directory, CONFIG_NAME), '{ not json');
    expect(await loadConfig(directory)).toEqual(EMPTY_CONFIG);
    expect(parseConfig('null')).toEqual(EMPTY_CONFIG);
    expect(parseConfig('{"disc":{"kind":"tape","path":"/x"}}')).toEqual(EMPTY_CONFIG);
    expect(parseConfig('{"disc":{"kind":"iso","path":""}}')).toEqual(EMPTY_CONFIG);
    expect(parseConfig('{"disc":{"kind":"directory","path":"D:\\\\","extra":1}}')).toEqual({
      disc: { kind: 'directory', path: 'D:\\' },
    });
  });
});
