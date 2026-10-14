/**
 * Debug state in the URL hash, e.g. `#page=410776` or `#page=410776,popup=2534,popup=2600`
 * (page refs are heap offsets in the page database). Unknown keys and malformed values are
 * ignored.
 */
export interface DebugState {
  readonly page: number | null;
  readonly popups: readonly number[];
  readonly presentation: 'win31' | 'wine' | null;
}

export function parseDebugHash(hash: string): DebugState {
  let page: number | null = null;
  const popups: number[] = [];
  let presentation: DebugState['presentation'] = null;
  for (const part of hash.replace(/^#/, '').split(/[,&]/)) {
    const [key, value = ''] = part.split('=', 2);
    const number = /^\d+$/.test(value) ? Number(value) : null;
    if (key === 'page' && number !== null) page = number;
    else if (key === 'popup' && number !== null) popups.push(number);
    else if (key === 'presentation' && (value === 'win31' || value === 'wine')) presentation = value;
  }
  return { page, popups, presentation };
}
