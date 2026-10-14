import { describe, expect, it } from 'vitest';
import { createFramebuffer, SCREEN_HEIGHT, SCREEN_WIDTH } from './screen.ts';

describe('createFramebuffer', () => {
  it('creates a 640×480 indexed framebuffer cleared to index 0', () => {
    const fb = createFramebuffer();
    expect([fb.width, fb.height]).toEqual([SCREEN_WIDTH, SCREEN_HEIGHT]);
    expect(fb.pixels).toHaveLength(640 * 480);
    expect(fb.pixels.every((p) => p === 0)).toBe(true);
  });
});
