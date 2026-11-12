import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PanelData, PanelListData, PanelParts, PanelValuesData } from '@domain/index.js';

const call = vi.fn();
vi.mock('@ui/bridge.js', () => ({ call: (...args: unknown[]) => call(...args) }));

const { usePanelData } = await import('./usePanelData.js');

const panel = (issueKey: string): PanelData => ({
  issueKey,
  rows: [],
  catalog: [],
  issueDueDate: null,
  issueDueRolledUp: false,
});
const list = (issueKey: string): PanelListData => ({ panel: panel(issueKey) });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('usePanelData mutations', () => {
  beforeEach(() => {
    call.mockReset();
    call.mockImplementation((key: string, payload?: { issueId?: string }) => {
      if (key === 'getPanelList') return Promise.resolve(list(payload?.issueId ?? '?'));
      if (key === 'getPanelValues') return new Promise<PanelValuesData>(() => {});
      throw new Error(`unexpected call ${key}`);
    });
  });

  it('drops a mutation result that lands after the issue changed', async () => {
    const save = deferred<PanelParts>();
    const base = call.getMockImplementation()!;
    call.mockImplementation((key: string, payload?: unknown) =>
      key === 'saveAssignment' ? save.promise : base(key, payload),
    );

    const { result, rerender } = renderHook(({ id }) => usePanelData(id), { initialProps: { id: 'A' } });
    await waitFor(() => expect(result.current.data?.issueKey).toBe('A'));

    act(() => result.current.save({ kpiId: 'K' } as never));
    expect(result.current.busy).toBe(true);

    rerender({ id: 'B' });
    await waitFor(() => expect(result.current.data?.issueKey).toBe('B'));
    expect(result.current.busy).toBe(false);

    const values: PanelValuesData = { today: '2026-01-01', issueDue: { date: null, source: 'pending' }, parent: null, readings: {} };
    await act(async () => save.resolve({ list: list('A'), values }));
    expect(result.current.data?.issueKey).toBe('B');
    expect(result.current.busy).toBe(false);
  });

  it('a failed record rejects (the record modal shows it) and leaves the panel untouched', async () => {
    const base = call.getMockImplementation()!;
    call.mockImplementation((key: string, payload?: unknown) =>
      key === 'recordValue' ? Promise.reject(new Error('Network error')) : base(key, payload),
    );

    const { result } = renderHook(() => usePanelData('A'));
    await waitFor(() => expect(result.current.data?.issueKey).toBe('A'));

    await act(async () => {
      await expect(result.current.record('K', '2026-01-01', 5)).rejects.toThrow('Network error');
    });
    expect(result.current.actionError).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(result.current.data?.issueKey).toBe('A');
  });

  it('a recorded value is applied locally — no panel reload', async () => {
    const kpiPanel: PanelData = {
      ...panel('KPI-1'),
      kpiView: {
        today: '2026-07-10',
        contributions: [],
        node: {
          id: '1',
          kpiId: 'KPI-1',
          issueKey: 'KPI-1',
          name: 'Revenue',
          unit: 'USD',
          direction: 'increase',
          depth: 0,
          readings: [{ date: '2026-01-01', value: 100 }],
          targets: [],
          undated: [],
          children: [],
        },
      },
    };
    const base = call.getMockImplementation()!;
    call.mockImplementation((key: string, payload?: unknown) => {
      if (key === 'getPanelList') return Promise.resolve({ panel: kpiPanel });
      if (key === 'recordValue') return Promise.resolve(null);
      return base(key, payload);
    });

    const { result } = renderHook(() => usePanelData('KPI-1'));
    await waitFor(() => expect(result.current.data?.kpiView).toBeTruthy());
    await act(async () => result.current.record('KPI-1', '2026-07-01', 130));

    expect(result.current.data?.kpiView?.node.readings.map((r) => r.value)).toEqual([100, 130]);
    expect(call.mock.calls.filter(([key]) => key === 'getPanelList' || key === 'getPanelData')).toHaveLength(1);
  });
});
