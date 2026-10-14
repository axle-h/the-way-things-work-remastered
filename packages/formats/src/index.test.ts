import { describe, expect, it } from 'vitest';
import * as formats from './index.ts';

describe('@twtw/formats', () => {
  it('loads', () => {
    expect(formats).toBeTypeOf('object');
  });
});
