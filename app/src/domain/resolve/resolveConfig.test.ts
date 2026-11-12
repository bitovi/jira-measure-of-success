import { describe, it, expect } from 'vitest';
import { resolveConfig } from './resolveConfig.js';
import type { HierarchyLevel, RollupConfig } from '../models/index.js';

const lvl = (level: number, ...issueTypeNames: string[]): HierarchyLevel => ({
  level,
  name: issueTypeNames[0],
  issueTypeNames,
});
const LEVELS = [lvl(4, 'Outcome'), lvl(3, 'Initiative'), lvl(2, 'Milestone', 'Increment'), lvl(1, 'Epic'), lvl(0, 'Story')];

describe('resolveConfig', () => {
  it('fills every level; unconfigured non-leaf → widestRange, leaf → parentOnly', () => {
    const stored: RollupConfig = { dueDateRollup: {} };
    expect(resolveConfig(stored, LEVELS)).toEqual({
      '4': 'widestRange',
      '3': 'widestRange',
      '2': 'widestRange',
      '1': 'widestRange',
      '0': 'parentOnly',
    });
  });

  it('keeps stored non-leaf choices and overrides the leaf to parentOnly', () => {
    const stored: RollupConfig = {
      dueDateRollup: { '4': 'childrenOnly', '0': 'widestRange' },
    };
    const resolved = resolveConfig(stored, LEVELS);
    expect(resolved['4']).toBe('childrenOnly');
    expect(resolved['3']).toBe('widestRange');
    expect(resolved['0']).toBe('parentOnly'); // leaf forced regardless of stored
  });

  it('reads legacy issue-type-name keys for the level', () => {
    const resolved = resolveConfig({ dueDateRollup: { Milestone: 'childrenOnly' } }, LEVELS);
    expect(resolved['2']).toBe('childrenOnly');
  });

  it('handles a single-level hierarchy (the only level is the leaf)', () => {
    expect(resolveConfig({ dueDateRollup: {} }, [lvl(0, 'Task')])).toEqual({ '0': 'parentOnly' });
  });
});
