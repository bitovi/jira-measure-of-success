import { describe, it, expect } from 'vitest';
import { parseTimelineFilters, storageTimelineFilters, TIMELINE_FILTERS_KEY } from './timelineFilters';

function fakeStorage(items: Record<string, string> = {}): Storage {
  return {
    getItem: (k: string) => items[k] ?? null,
    setItem: (k: string, v: string) => {
      items[k] = v;
    },
    removeItem: (k: string) => {
      delete items[k];
    },
    clear: () => {},
    key: () => null,
    length: 0,
  };
}

describe('timeline filters', () => {
  it('round-trips through storage', () => {
    const items: Record<string, string> = {};
    const store = storageTimelineFilters(() => fakeStorage(items));
    store.write({ spaces: ['PORT'], workFrom: ['APP'] });
    expect(JSON.parse(items[TIMELINE_FILTERS_KEY])).toEqual({ spaces: ['PORT'], workFrom: ['APP'] });
    expect(store.read()).toEqual({ spaces: ['PORT'], workFrom: ['APP'] });
  });

  it('reads nothing remembered from junk, and drops non-string keys', () => {
    expect(parseTimelineFilters(null)).toBeNull();
    expect(parseTimelineFilters('{nope')).toBeNull();
    expect(parseTimelineFilters('7')).toBeNull();
    expect(parseTimelineFilters('{"spaces":["A",3,""],"workFrom":"B"}')).toEqual({ spaces: ['A'], workFrom: [] });
  });

  it('is fail-safe when storage is blocked (partitioned or cleared iframe storage)', () => {
    const blocked = storageTimelineFilters(() => {
      throw new Error('SecurityError');
    });
    expect(blocked.read()).toBeNull();
    expect(() => blocked.write({ spaces: ['X'], workFrom: [] })).not.toThrow();
    const throwing = storageTimelineFilters(() => ({
      ...fakeStorage(),
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    }));
    expect(throwing.read()).toBeNull();
    expect(() => throwing.write({ spaces: [], workFrom: [] })).not.toThrow();
  });
});
