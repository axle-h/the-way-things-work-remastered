import { describe, expect, it } from 'vitest';
import { contentTypeFor, CONTENT_SECURITY_POLICY, isAppUrl, routeRequest } from './routes.ts';

describe('routeRequest', () => {
  it.each([
    ['app://twtw/', { kind: 'web', segments: ['index.html'] }],
    ['app://twtw/assets/index-1.js', { kind: 'web', segments: ['assets', 'index-1.js'] }],
    ['app://twtw/?x=1#page=1538', { kind: 'web', segments: ['index.html'] }],
    ['app://twtw/desktop/', { kind: 'picker', segments: ['index.html'] }],
    ['app://twtw/desktop/assets/a.css', { kind: 'picker', segments: ['assets', 'a.css'] }],
    ['app://twtw/data/manifest.json', { kind: 'manifest' }],
    ['app://twtw/data/ARTICLE1/AIRP/AIRP0M.DIB', { kind: 'data', path: 'ARTICLE1/AIRP/AIRP0M.DIB' }],
    ['app://twtw/data/A%20B/C.TXT', { kind: 'data', path: 'A B/C.TXT' }],
    ['app://twtw/data/SUB/manifest.json', { kind: 'data', path: 'SUB/manifest.json' }],
    // Dot segments, even escaped, are resolved by URL parsing: they cannot climb out of the root.
    ['app://twtw/data/%2e%2e/x', { kind: 'web', segments: ['x'] }],
    ['app://twtw/data/../../../etc/passwd', { kind: 'web', segments: ['etc', 'passwd'] }],
  ])('%s', (url, route) => {
    expect(routeRequest(url)).toEqual(route);
  });

  it.each([
    'app://other/index.html',
    'https://twtw/index.html',
    'file:///etc/passwd',
    'app://twtw/data/',
    'app://twtw/a//b',
    'app://twtw/a/%2E%2E%2Fb',
    'app://twtw/a%5Cb',
    'app://twtw/a%00b',
    'app://twtw/%E0%A4%A',
    'not a url',
  ])('refuses %s', (url) => {
    expect(routeRequest(url)).toEqual({ kind: 'invalid' });
  });
});

describe('isAppUrl', () => {
  it('accepts only our origin', () => {
    expect(isAppUrl('app://twtw/desktop/index.html')).toBe(true);
    expect(isAppUrl('app://twtw/#page=1')).toBe(true);
    expect(isAppUrl('app://evil/')).toBe(false);
    expect(isAppUrl('https://example.com/')).toBe(false);
    expect(isAppUrl('javascript:alert(1)')).toBe(false);
    expect(isAppUrl('')).toBe(false);
  });
});

describe('responses', () => {
  it('types our files by extension', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('index-1.JS')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('manifest.webmanifest')).toBe('application/manifest+json');
    expect(contentTypeFor('README')).toBe('application/octet-stream');
  });

  it('allows nothing remote, no inline or evaluated script', () => {
    expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("script-src 'self';");
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/unsafe-eval|https?:|\*/);
  });
});
