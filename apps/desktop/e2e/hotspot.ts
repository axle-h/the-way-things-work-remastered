// Finds, with the engine running headless in the test process on the same disc image, a hotspot of
// a base page that opens or changes to another page, and a point inside it (page coordinates). The
// app's production build has no `window.twtw` to ask, so the tests work it out themselves.
import { Engine, IsoDataSource, loadDiscContent, type PageRef } from '@twtw/engine';
import { openIso } from '@twtw/formats';
import { openFileSource } from '@twtw/node';

export interface Hotspot {
  readonly x: number;
  readonly y: number;
  readonly target: PageRef;
}

/** The click event of a handler (behaviour.md). */
const CLICK = 4;

export async function findHotspot(isoPath: string, ref: PageRef): Promise<Hotspot | null> {
  const file = await openFileSource(isoPath);
  try {
    const source = await IsoDataSource.open(await openIso(file));
    const engine = new Engine(source, await loadDiscContent(source));
    await engine.reset(ref);
    for (const panel of engine.basePage?.panels ?? []) {
      for (const placed of panel.objects) {
        const { object, rect } = placed;
        if (object.kind !== 'hotspot' || rect === null) continue;
        const action = object.handlers
          .filter((handler) => handler.event === CLICK)
          .flatMap((handler) => handler.actions)
          .find((candidate) => candidate.kind === 'openPage' || candidate.kind === 'changePage');
        if (action === undefined || !('page' in action) || action.page === null) continue;
        const x = panel.x + Math.floor((rect.left + rect.right) / 2);
        const y = panel.y + Math.floor((rect.top + rect.bottom) / 2);
        // The release is tested one pixel lower (behaviour.md §1.5): both must hit the hotspot.
        if (engine.hitTest(x, y)?.object !== placed || engine.hitTest(x, y + 1)?.object !== placed) continue;
        return { x, y, target: action.page };
      }
    }
    return null;
  } finally {
    await file.close();
  }
}
