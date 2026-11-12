import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => store.get(key),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  },
}));

import { kvs } from '@forge/kvs';
import { readKpiHierarchyConfig, readRollupConfig, writeKpiHierarchyConfig } from './storage.js';

const ROLLUP_KEY = 'kpi:config:rollup';
const HIERARCHY_KEY = 'kpi:hierarchy';

beforeEach(() => {
  store.clear();
  vi.mocked(kvs.set).mockClear();
});

describe('readRollupConfig', () => {
  it('returns a level-keyed config as stored', async () => {
    store.set(ROLLUP_KEY, { dueDateRollup: { '1': 'parentOnly' } });
    expect(await readRollupConfig()).toEqual({ dueDateRollup: { '1': 'parentOnly' } });
  });

  it('returns a legacy (issue-type-name keyed) config unchanged and never writes', async () => {
    const legacy = { dueDateRollup: { Milestone: 'childrenOnly' }, dateFields: { Milestone: { start: 'cf_ts', due: 'cf_te' } } };
    store.set(ROLLUP_KEY, legacy);
    expect(await readRollupConfig()).toEqual(legacy);
    expect(kvs.set).not.toHaveBeenCalled();
  });

  it('falls back to an empty config when nothing valid is stored', async () => {
    store.set(ROLLUP_KEY, { dueDateRollup: { '1': 'not-a-method' } });
    expect(await readRollupConfig()).toEqual({ dueDateRollup: {} });
  });
});

describe('readKpiHierarchyConfig / writeKpiHierarchyConfig', () => {
  it('round-trips a valid config', async () => {
    await writeKpiHierarchyConfig({ linkTypeId: '10500', parentEnd: 'outward' });
    expect(await readKpiHierarchyConfig()).toEqual({ linkTypeId: '10500', parentEnd: 'outward' });
  });

  it('reads unset or malformed values as null', async () => {
    expect(await readKpiHierarchyConfig()).toBeNull();
    store.set(HIERARCHY_KEY, { linkTypeId: '', parentEnd: 'inward' });
    expect(await readKpiHierarchyConfig()).toBeNull();
    store.set(HIERARCHY_KEY, { linkTypeId: '10500', parentEnd: 'sideways' });
    expect(await readKpiHierarchyConfig()).toBeNull();
  });

  it('refuses to write an invalid config', async () => {
    await expect(writeKpiHierarchyConfig({ linkTypeId: '', parentEnd: 'inward' })).rejects.toThrow();
    expect(kvs.set).not.toHaveBeenCalled();
  });
});
