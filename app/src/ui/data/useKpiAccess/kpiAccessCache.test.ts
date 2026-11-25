import { describe, it, expect, vi } from 'vitest';
import { createKpiAccessCache } from './kpiAccessCache.js';

const FULL = { browse: true, create: true, edit: true, link: true };
const READ_ONLY = { browse: true, create: false, edit: false, link: false };

describe('createKpiAccessCache', () => {
  it('asks once per space: actions on two KPIs in the same space make one lookup', async () => {
    const fetchAccess = vi.fn(async (key: string) => (key === 'PORT' ? READ_ONLY : FULL));
    const cache = createKpiAccessCache(fetchAccess);
    const [a, b] = await Promise.all([cache.load('PORT'), cache.load('PORT')]);
    expect(await cache.load('PORT')).toEqual(READ_ONLY);
    expect([a, b]).toEqual([READ_ONLY, READ_ONLY]);
    expect(fetchAccess).toHaveBeenCalledTimes(1);
    await cache.load('KPI');
    expect(fetchAccess.mock.calls.map(([k]) => k)).toEqual(['PORT', 'KPI']);
  });

  it('reports loading while the lookup is in flight, then ready', async () => {
    let resolve!: (v: typeof FULL) => void;
    const cache = createKpiAccessCache(() => new Promise((r) => (resolve = r)));
    const changes: string[] = [];
    cache.subscribe(() => changes.push(cache.get('KPI')?.status ?? 'none'));
    expect(cache.get('KPI')).toBeUndefined();
    const loading = cache.load('KPI');
    expect(cache.get('KPI')).toEqual({ status: 'loading' });
    resolve(FULL);
    await loading;
    expect(cache.get('KPI')).toEqual({ status: 'ready', access: FULL });
    expect(changes).toEqual(['loading', 'ready']);
  });

  it('a failed or unanswered lookup resolves null and is asked again next time', async () => {
    const fetchAccess = vi
      .fn<(key: string) => Promise<typeof FULL | null>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(FULL);
    const cache = createKpiAccessCache(fetchAccess);
    expect(await cache.load('KPI')).toBeNull();
    expect(cache.get('KPI')).toBeUndefined();
    expect(await cache.load('KPI')).toBeNull();
    expect(await cache.load('KPI')).toEqual(FULL);
    expect(fetchAccess).toHaveBeenCalledTimes(3);
  });
});
