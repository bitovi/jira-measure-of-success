import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, migrateItems, MIGRATION_WRITE_CONCURRENCY } from './index';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe('mapWithConcurrency', () => {
  it('keeps at most `limit` running and returns results in order', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 5, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      return n * 2;
    });
    expect(peak).toBe(5);
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24]);
  });

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 5, async () => 1)).toEqual([]);
  });
});

describe('migrateItems', () => {
  it('tallies outcomes, turns thrown items into failures, and writes five at a time', async () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ issueId: String(i), issueKey: `APP-${i}` }));
    let running = 0;
    let peak = 0;
    const result = await migrateItems(items, async ({ issueId }) => {
      running += 1;
      peak = Math.max(peak, running);
      await tick();
      running -= 1;
      const n = Number(issueId);
      if (n === 3) throw new Error('Jira 403: nope');
      return n % 4 === 0 ? 'alreadyDone' : n === 7 ? 'skipped' : 'migrated';
    });
    expect(peak).toBe(MIGRATION_WRITE_CONCURRENCY);
    expect(result).toEqual({
      migrated: 7,
      alreadyDone: 3,
      skipped: 1,
      failures: [{ issueId: '3', issueKey: 'APP-3', message: 'Jira 403: nope' }],
    });
  });
});
