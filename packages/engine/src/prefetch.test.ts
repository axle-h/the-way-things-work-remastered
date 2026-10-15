// Prefetch order on the synthetic interaction disc.
import { describe, expect, it } from 'vitest';
import { loadDiscContent } from './content.ts';
import { filesToPrefetch } from './prefetch.ts';
import { interactionDisc, interactionRef as ref } from './testing/interaction-disc.ts';

const { database } = await loadDiscContent(interactionDisc.source);

describe('filesToPrefetch', () => {
  it('lists what a tap plays first, then the linked pages: pictures, sounds, animations', () => {
    const paths = filesToPrefetch(database, [ref('home')]);
    const at = (path: string): number => paths.indexOf(path);
    // The page's sound and animation, and the navigation buttons' press-in animations.
    const firstPicture = paths.findIndex((path) => path.endsWith('.DIB'));
    for (const path of ['ART/ANIM.ANI', 'ART/SND.WAV', 'nav/navb0.ANI', 'nav/navb8.ANI']) {
      expect(at(path)).toBeGreaterThanOrEqual(0);
      expect(at(path)).toBeLessThan(firstPicture);
    }
    // The popups and pages its hotspots and navigation buttons open.
    expect(at('ART/P60X40.DIB')).toBeGreaterThanOrEqual(firstPicture); // pop1
    expect(at('ART/P70X30.DIB')).toBeGreaterThanOrEqual(firstPicture); // options
    // The movie page (reached from home) has its movie fetched after every picture.
    const lastPicture = paths.findLastIndex((path) => path.endsWith('.DIB'));
    expect(at('ART/MOVIE.ANI')).toBeGreaterThan(lastPicture);
  });

  it('lists each file once, ignoring case, and skips pages that cannot be read', () => {
    const paths = filesToPrefetch(database, [ref('article'), ref('pop1')], [ref('home'), 999_999]);
    expect(new Set(paths.map((path) => path.toLowerCase())).size).toBe(paths.length);
    // The article's link block leads to rela; the Back target (home) to its sound.
    expect(paths).toContain('ART/P40X30.DIB');
    expect(paths).toContain('ART/SND.WAV');
    // One step ahead only: pop1 is two taps away from the principles page (via home).
    expect(
      filesToPrefetch(database, [ref('principles')], []).filter((p) => p.endsWith('.DIB')),
    ).not.toContain('ART/P60X40.DIB');
  });
});
