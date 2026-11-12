import { describe, expect, it } from 'vitest';
import {
  hasLegacyRollupKeys,
  levelLabel,
  levelSetting,
  migrateRollupConfigToLevels,
  type HierarchyLevel,
  type RollupConfig,
} from './config';

const LEVELS: HierarchyLevel[] = [
  { level: 2, name: 'Milestone', issueTypeNames: ['Milestone', 'Increment'] },
  { level: 1, name: 'Epic', issueTypeNames: ['Epic'] },
  { level: 0, name: 'Story', issueTypeNames: ['Story', 'Task', 'Bug'] },
];

describe('levelSetting', () => {
  it('finds a level setting for every issue type at the level', () => {
    const map = { '2': 'childrenOnly' };
    expect(levelSetting(map, { name: 'Milestone', hierarchyLevel: 2 })).toBe('childrenOnly');
    expect(levelSetting(map, { name: 'Increment', hierarchyLevel: 2 })).toBe('childrenOnly');
    expect(levelSetting(map, { name: 'Epic', hierarchyLevel: 1 })).toBeUndefined();
  });

  it('falls back to a legacy name key', () => {
    expect(levelSetting({ Epic: 'parentOnly' }, { name: 'Epic', hierarchyLevel: 1 })).toBe('parentOnly');
    expect(levelSetting(undefined, { name: 'Epic', hierarchyLevel: 1 })).toBeUndefined();
  });
});

describe('levelLabel', () => {
  it('lists every issue type at the level', () => {
    expect(levelLabel(LEVELS[0])).toBe('Milestone / Increment');
  });
});

describe('migrateRollupConfigToLevels', () => {
  it('re-keys legacy name entries by level', () => {
    const legacy: RollupConfig = {
      dueDateRollup: { Milestone: 'childrenOnly', Epic: 'parentFirstThenChildren' },
      dateFields: { Milestone: { start: 'cf_ts', due: 'cf_te' } },
      depthCap: 2,
    };
    expect(hasLegacyRollupKeys(legacy)).toBe(true);
    const migrated = migrateRollupConfigToLevels(legacy, LEVELS);
    expect(migrated).toEqual({
      dueDateRollup: { '2': 'childrenOnly', '1': 'parentFirstThenChildren' },
      dateFields: { '2': { start: 'cf_ts', due: 'cf_te' } },
      depthCap: 2,
    });
    expect(hasLegacyRollupKeys(migrated)).toBe(false);
  });

  it('lets an existing level key win over a legacy one', () => {
    const migrated = migrateRollupConfigToLevels(
      { dueDateRollup: { Increment: 'childrenOnly', '2': 'widestRange' } },
      LEVELS,
    );
    expect(migrated.dueDateRollup).toEqual({ '2': 'widestRange' });
  });

  it('drops names no longer on the site', () => {
    const migrated = migrateRollupConfigToLevels({ dueDateRollup: { Gone: 'childrenOnly', '1': 'parentOnly' } }, LEVELS);
    expect(migrated.dueDateRollup).toEqual({ '1': 'parentOnly' });
  });

  it('is a no-op when already level-keyed or when the levels are unknown', () => {
    const levelKeyed: RollupConfig = { dueDateRollup: { '1': 'childrenOnly' } };
    expect(migrateRollupConfigToLevels(levelKeyed, LEVELS)).toBe(levelKeyed);
    const legacy: RollupConfig = { dueDateRollup: { Epic: 'childrenOnly' } };
    expect(migrateRollupConfigToLevels(legacy, [])).toBe(legacy);
  });
});
