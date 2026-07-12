import { describe, it, expect } from 'vitest';
import { resolveConfig } from './resolveConfig.js';
import type { RollupConfig } from '../models/index.js';

const LEVELS = ['Outcome', 'Initiative', 'Increment', 'Epic', 'Story'];

describe('resolveConfig', () => {
  it('fills every level; unconfigured non-leaf → widestRange, leaf → parentOnly', () => {
    const stored: RollupConfig = { dueDateRollup: {} };
    expect(resolveConfig(stored, LEVELS)).toEqual({
      Outcome: 'widestRange',
      Initiative: 'widestRange',
      Increment: 'widestRange',
      Epic: 'widestRange',
      Story: 'parentOnly',
    });
  });

  it('keeps stored non-leaf choices and overrides the leaf to parentOnly', () => {
    const stored: RollupConfig = {
      dueDateRollup: { Outcome: 'childrenOnly', Story: 'widestRange' },
    };
    const resolved = resolveConfig(stored, LEVELS);
    expect(resolved.Outcome).toBe('childrenOnly');
    expect(resolved.Initiative).toBe('widestRange');
    expect(resolved.Story).toBe('parentOnly'); // leaf forced regardless of stored
  });

  it('handles a single-level hierarchy (the only level is the leaf)', () => {
    expect(resolveConfig({ dueDateRollup: {} }, ['Task'])).toEqual({ Task: 'parentOnly' });
  });
});
