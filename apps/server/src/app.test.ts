import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestListener, ROBOTS_TXT } from './app.ts';

describe('createRequestListener', () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'twtw-app-'));
    const dataRoot = join(root, 'data');
    const distRoot = join(root, 'dist');
    await mkdir(join(dataRoot, 'DIR'), { recursive: true });
    await mkdir(join(distRoot, 'assets'), { recursive: true });
    await writeFile(join(dataRoot, 'DIR', 'FILE.BIN'), 'abc');
    await writeFile(join(distRoot, 'index.html'), '<!doctype html><script src="/assets/a.js"></script>');
    await writeFile(join(distRoot, 'assets', 'a.js'), 'console.log(1);');
    server = createServer(createRequestListener({ dataRoot, distRoot }));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });

  it('answers /healthz', async () => {
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok\n');
  });

  it('serves a robots.txt that disallows everything', async () => {
    const response = await fetch(`${base}/robots.txt`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await response.text()).toBe(ROBOTS_TXT);
    expect(ROBOTS_TXT).toMatch(/^User-agent: \*\nDisallow: \/\n$/);
  });

  it('serves the app, falling back to index.html for routes', async () => {
    const index = await (await fetch(`${base}/`)).text();
    expect(index).toContain('<script');
    expect(await (await fetch(`${base}/some/route`)).text()).toBe(index);
    expect(await (await fetch(`${base}/assets/a.js`)).text()).toBe('console.log(1);');
  });

  it('serves /data ignoring case', async () => {
    const response = await fetch(`${base}/data/dir/file.bin`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('abc');
    expect((await fetch(`${base}/data/MISSING`)).status).toBe(404);
  });

  it.each(['/healthz', '/robots.txt', '/', '/assets/a.js', '/data/DIR/FILE.BIN', '/data/MISSING', '/x.y'])(
    'marks %s noindex',
    async (path) => {
      const response = await fetch(`${base}${path}`);
      await response.arrayBuffer();
      expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    },
  );
});
