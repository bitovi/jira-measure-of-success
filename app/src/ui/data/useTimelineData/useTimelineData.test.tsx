import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type {
  AddedTarget,
  AddTargetInput,
  CreatedKpi,
  TimelineData,
  TimelineNodeDto,
  TimelineTargetsData,
  UpdatedKpi,
  UpdateKpiResult,
} from '@domain/index.js';

const call = vi.fn();
vi.mock('@ui/bridge.js', () => ({ call: (...args: unknown[]) => call(...args) }));

const { useTimelineData } = await import('./useTimelineData.js');

const node = (kpiId: string, over: Partial<TimelineNodeDto> = {}): TimelineNodeDto => ({
  id: kpiId,
  kpiId,
  issueKey: kpiId,
  name: kpiId,
  unit: 'USD',
  direction: 'increase',
  depth: 0,
  targets: [],
  undated: [],
  readings: [{ date: '2026-01-01', value: 100 }],
  children: [],
  resolving: true,
  ...over,
});

const SKELETON: TimelineData = { today: '2026-07-10', roots: [node('KPI-1')] };

const added = (value: number): AddedTarget => ({
  assignment: {
    kpiId: 'KPI-1',
    inheritFromParent: false,
    target: value,
    targetType: 'absolute',
    timing: { start: null, due: { mode: 'absolute', absolute: '2026-12-31', anchor: 'issueDueDate', offsetMonths: 0 } },
    updatedBy: 'acc',
    updatedAt: 0,
  },
  source: { key: 'APP-1', type: 'Epic', title: 'Bet', iconUrl: null, due: null },
});
const addInput = { kpiId: 'KPI-1', issueId: '1', issueKey: 'APP-1', date: '2026-12-31', value: 0 } as AddTargetInput;

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Answer each bridge call from `handlers`, else the default (skeleton + no targets). */
function bridge(handlers: Record<string, (payload: unknown) => Promise<unknown>> = {}) {
  call.mockImplementation((key: string, payload?: unknown) => {
    if (handlers[key]) return handlers[key](payload);
    if (key === 'getTimelineSkeleton') return Promise.resolve(SKELETON);
    if (key === 'getTimelineTargets') return Promise.resolve({ contributions: {} } satisfies TimelineTargetsData);
    throw new Error(`unexpected call ${key}`);
  });
}

async function loaded() {
  const hook = renderHook(() => useTimelineData());
  await waitFor(() => expect(hook.result.current.targetsPending).toBe(false));
  return hook;
}

const kpi1 = (data: TimelineData | null) => data!.roots[0];

describe('useTimelineData mutations', () => {
  beforeEach(() => {
    call.mockReset();
  });

  it.each([
    ['record', (c: ReturnType<typeof useTimelineData>) => c.record('KPI-1', '2026-07-01', 130), 'recordValue'],
    ['createKpi', (c: ReturnType<typeof useTimelineData>) => c.createKpi({ name: 'X', unit: '', direction: null, parentKpiId: 'KPI-1' }), 'createKpi'],
    ['updateKpi', (c: ReturnType<typeof useTimelineData>) => c.updateKpi({ kpiId: 'KPI-1', name: 'X' }), 'updateKpi'],
    ['addTarget', (c: ReturnType<typeof useTimelineData>) => c.addTarget(addInput), 'addTarget'],
  ] as const)('a failed %s rejects and leaves the timeline untouched', async (_name, run, key) => {
    bridge({ [key]: () => Promise.reject(new Error('Jira 403')) });
    const { result } = await loaded();
    const before = result.current.data;

    await act(async () => {
      await expect(run(result.current)).rejects.toThrow('Jira 403');
    });
    expect(result.current.data).toEqual(before);
  });

  it('a recorded value is applied locally — no reload', async () => {
    bridge({ recordValue: () => Promise.resolve(null) });
    const { result } = await loaded();

    await act(async () => result.current.record('KPI-1', '2026-07-01', 130));
    expect(kpi1(result.current.data).readings.map((r) => r.value)).toEqual([100, 130]);
    expect(call.mock.calls.filter(([key]) => key === 'getTimelineSkeleton')).toHaveLength(1);
  });

  it('a created KPI is spliced in under its parent', async () => {
    const created: CreatedKpi = {
      id: '99',
      kpiId: 'KPI-9',
      issueKey: 'KPI-9',
      name: 'Churn',
      unit: '%',
      direction: 'decrease',
      parentKpiId: 'KPI-1',
    };
    bridge({ createKpi: () => Promise.resolve(created) });
    const { result } = await loaded();

    await act(async () => result.current.createKpi({ name: 'Churn', unit: '%', direction: 'decrease', parentKpiId: 'KPI-1' }));
    expect(kpi1(result.current.data).children.map((c) => c.kpiId)).toEqual(['KPI-9']);
  });

  it('an edited KPI is laid over the tree — renamed and moved, no reload', async () => {
    const edited: UpdatedKpi = {
      id: '2',
      kpiId: 'KPI-2',
      issueKey: 'KPI-2',
      name: 'Orders (net)',
      unit: 'count',
      direction: 'increase',
      parentKpiId: 'KPI-1',
    };
    const twoRoots: TimelineData = { today: '2026-07-10', roots: [node('KPI-1'), node('KPI-2')] };
    bridge({
      getTimelineSkeleton: () => Promise.resolve(twoRoots),
      updateKpi: () => Promise.resolve({ kpi: edited, error: null } satisfies UpdateKpiResult),
    });
    const { result } = await loaded();

    await act(async () => result.current.updateKpi({ kpiId: 'KPI-2', name: 'Orders (net)', parentKpiId: 'KPI-1' }));
    expect(result.current.data!.roots.map((r) => r.kpiId)).toEqual(['KPI-1']);
    expect(kpi1(result.current.data).children[0]).toMatchObject({ kpiId: 'KPI-2', name: 'Orders (net)', unit: 'count', depth: 1 });
    expect(call.mock.calls.filter(([key]) => key === 'getTimelineSkeleton')).toHaveLength(1);
  });

  it('a direction change re-scores the KPI’s targets', async () => {
    // A past target of 90 against a reading of 100: hit when higher is better, missed when lower is.
    const past = { ...added(90), assignment: { ...added(90).assignment, timing: { start: null, due: { mode: 'absolute' as const, absolute: '2026-01-01', anchor: 'issueDueDate' as const, offsetMonths: 0 } } } };
    bridge({
      getTimelineTargets: () => Promise.resolve({ contributions: { 'KPI-1': [past] } }),
      updateKpi: () =>
        Promise.resolve({
          kpi: { id: 'KPI-1', kpiId: 'KPI-1', issueKey: 'KPI-1', name: 'KPI-1', unit: 'USD', direction: 'decrease' },
          error: null,
        } satisfies UpdateKpiResult),
    });
    const { result } = await loaded();
    expect(kpi1(result.current.data).targets.map((t) => t.status)).toEqual(['hit']);

    await act(async () => result.current.updateKpi({ kpiId: 'KPI-1', direction: 'decrease' }));
    expect(kpi1(result.current.data).targets.map((t) => t.status)).toEqual(['missed']);
  });

  it('a partly saved edit (moved, then the rename failed) shows the move, then rejects', async () => {
    const twoRoots: TimelineData = { today: '2026-07-10', roots: [node('KPI-1'), node('KPI-2')] };
    const partial: UpdateKpiResult = {
      kpi: { id: '2', kpiId: 'KPI-2', issueKey: 'KPI-2', name: 'KPI-2', unit: 'USD', direction: 'increase', parentKpiId: 'KPI-1' },
      error: "KPI-2 was moved, but its name, unit and direction weren't saved: Jira 500",
    };
    bridge({ getTimelineSkeleton: () => Promise.resolve(twoRoots), updateKpi: () => Promise.resolve(partial) });
    const { result } = await loaded();

    await act(async () => {
      await expect(result.current.updateKpi({ kpiId: 'KPI-2', name: 'Orders', parentKpiId: 'KPI-1' })).rejects.toThrow(
        /was moved, but its name/,
      );
    });
    expect(result.current.data!.roots.map((r) => r.kpiId)).toEqual(['KPI-1']);
    expect(kpi1(result.current.data).children[0]).toMatchObject({ kpiId: 'KPI-2', name: 'KPI-2' });
  });

  it('an edit that leaves the parent out keeps the KPI where it is', async () => {
    const nested: TimelineData = { today: '2026-07-10', roots: [node('KPI-1', { children: [node('KPI-2', { depth: 1 })] })] };
    bridge({
      getTimelineSkeleton: () => Promise.resolve(nested),
      updateKpi: () =>
        Promise.resolve({
          kpi: { id: '2', kpiId: 'KPI-2', issueKey: 'KPI-2', name: 'Orders', unit: 'USD', direction: 'increase' },
          error: null,
        } satisfies UpdateKpiResult),
    });
    const { result } = await loaded();

    await act(async () => result.current.updateKpi({ kpiId: 'KPI-2', name: 'Orders' }));
    expect(result.current.data!.roots.map((r) => r.kpiId)).toEqual(['KPI-1']);
    expect(kpi1(result.current.data).children[0]).toMatchObject({ kpiId: 'KPI-2', name: 'Orders', depth: 1 });
  });

  it('re-adding a target for the same (issue, KPI) replaces it rather than duplicating it', async () => {
    let value = 200;
    bridge({ addTarget: () => Promise.resolve(added(value)) });
    const { result } = await loaded();

    await act(async () => result.current.addTarget(addInput));
    value = 300;
    await act(async () => result.current.addTarget(addInput));
    expect(kpi1(result.current.data).targets.map((t) => t.value)).toEqual([300]);
  });

  it('a target saved before the targets load arrives is kept once they do', async () => {
    const targets = deferred<TimelineTargetsData>();
    bridge({ getTimelineTargets: () => targets.promise, addTarget: () => Promise.resolve(added(200)) });
    const { result } = renderHook(() => useTimelineData());
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => result.current.addTarget(addInput));
    // The load started before the save, so it doesn't include the new target.
    await act(async () => targets.resolve({ contributions: {} }));
    expect(result.current.targetsPending).toBe(false);
    expect(kpi1(result.current.data).targets.map((t) => t.value)).toEqual([200]);
  });
});
