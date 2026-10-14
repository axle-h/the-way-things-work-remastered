import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('index.html', () => {
  it('has a 640×480 stage canvas', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/<canvas id="stage" width="640" height="480">/);
  });
});
