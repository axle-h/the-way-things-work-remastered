import { describe, expect, it } from 'vitest';
import type { DesktopBridge } from '../src/desktop-bridge.ts';
import { BROWSER_HOST, findHost } from '../src/host.ts';

function fakeBridge(): DesktopBridge & { copied: Uint8Array[]; changes: number } {
  const bridge = {
    platform: 'linux',
    copied: [] as Uint8Array[],
    changes: 0,
    copyPng: async (png: Uint8Array) => void bridge.copied.push(png),
    changeDisc: async () => void bridge.changes++,
    discStatus: async () => ({ path: null, kind: null, problem: null }),
    chooseDisc: async () => ({ outcome: 'cancelled' as const }),
    openApp: async () => {},
  };
  return bridge;
}

describe('findHost', () => {
  it('is the browser without the desktop bridge', () => {
    expect(findHost({})).toBe(BROWSER_HOST);
    expect(BROWSER_HOST).toMatchObject({ kind: 'browser', dataUrl: '/data/', autoplay: false });
    expect(BROWSER_HOST.writeClipboardPng).toBeUndefined();
    expect(BROWSER_HOST.changeDisc).toBeUndefined();
  });

  it('is the desktop app with the bridge, which takes the clipboard and the disc choice', async () => {
    const bridge = fakeBridge();
    const host = findHost({ twtwDesktop: bridge });
    expect(host).toMatchObject({ kind: 'desktop', dataUrl: '/data/', autoplay: true });
    await host.writeClipboardPng!(Uint8Array.of(0x89, 0x50));
    expect(bridge.copied).toEqual([Uint8Array.of(0x89, 0x50)]);
    await host.changeDisc!();
    expect(bridge.changes).toBe(1);
  });
});
