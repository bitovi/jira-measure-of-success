import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PanelData, PanelListData, PanelValuesData } from '@domain/index.js';

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
    const save = deferred<PanelData>();
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

    await act(async () => save.resolve(panel('A')));
    expect(result.current.data?.issueKey).toBe('B');
    expect(result.current.busy).toBe(false);
  });

  it('surfaces a failed record as actionError instead of an unhandled rejection', async () => {
    const base = call.getMockImplementation()!;
    call.mockImplementation((key: string, payload?: unknown) =>
      key === 'recordValue' ? Promise.reject(new Error('Network error')) : base(key, payload),
    );

    const { result } = renderHook(() => usePanelData('A'));
    await waitFor(() => expect(result.current.data?.issueKey).toBe('A'));

    await act(async () => result.current.record('K', '2026-01-01', 5));
    await waitFor(() => expect(result.current.actionError).toBe('Network error'));
    expect(result.current.busy).toBe(false);
    expect(result.current.data?.issueKey).toBe('A');

    act(() => result.current.dismissActionError());
    expect(result.current.actionError).toBeNull();
  });
});
