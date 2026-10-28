import { RegionVerdictCache } from './region-verdict-cache.helper';

describe('RegionVerdictCache', () => {

  it('knows nothing before it has been told', () => {
    expect(new RegionVerdictCache().recall(123)).toBeNull();
  });

  it('gives back the verdict it was given for the same strip, true or false', () => {
    const cache = new RegionVerdictCache();

    cache.remember(1, true);
    expect(cache.recall(1)).toBeTrue();

    cache.remember(2, false);
    expect(cache.recall(2)).toBeFalse();
  });

  it('says nothing about a strip it has not read, so that strip is read', () => {
    const cache = new RegionVerdictCache();
    cache.remember(1, true);

    expect(cache.recall(2)).toBeNull();
  });

  it('remembers the latest strip only: going back to an earlier one reads it again', () => {
    const cache = new RegionVerdictCache();
    cache.remember(1, true);
    cache.remember(2, false);

    expect(cache.recall(1)).toBeNull();
    expect(cache.recall(2)).toBeFalse();
  });

  it('keeps answering "saving" for as long as the dialog\'s strip does not change', () => {
    // The caller asks again and again while the dialog is up; every ask is the same strip.
    const cache = new RegionVerdictCache();
    cache.remember(0xdead, true);

    for (let i = 0; i < 20; i++) {
      expect(cache.recall(0xdead)).toBeTrue();
    }
  });

  it('forgets everything on request', () => {
    const cache = new RegionVerdictCache();
    cache.remember(1, true);
    cache.forget();

    expect(cache.recall(1)).toBeNull();
  });

  it('treats a hash of zero as a hash like any other', () => {
    const cache = new RegionVerdictCache();
    expect(cache.recall(0)).toBeNull();

    cache.remember(0, false);
    expect(cache.recall(0)).toBeFalse();
  });
});
