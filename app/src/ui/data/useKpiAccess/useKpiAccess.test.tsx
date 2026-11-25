import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { kpiActionBlockedReason } from '@domain/index.js';
import { useKpiAccess } from './useKpiAccess.js';

const FULL = { browse: true, create: true, edit: true, link: true };
const READ_ONLY = { browse: true, create: false, edit: false, link: false };
const recordReason = (label: string) => (access: typeof FULL | null) =>
  kpiActionBlockedReason('record', access, label, 'PORT-1');

describe('useKpiAccess', () => {
  it('looks the space up on first use (busy meanwhile), then refuses with the reason naming the space', async () => {
    let resolve!: (v: typeof READ_ONLY) => void;
    const fetchAccess = vi.fn(() => new Promise<typeof READ_ONLY>((r) => (resolve = r)));
    const proceed = vi.fn();
    const { result } = renderHook(() => useKpiAccess(fetchAccess));
    act(() => result.current.guard('record:1', 'PORT', recordReason('Portfolio'), proceed));
    expect(result.current.pendingAction).toBe('record:1');
    expect(result.current.stateOf('PORT')).toEqual({ status: 'loading' });
    await act(async () => resolve(READ_ONLY));
    expect(result.current.pendingAction).toBeNull();
    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.refusal).toBe(
      'Recording a value on PORT-1 needs Edit Issues permission on the Portfolio space. Ask a Jira admin.',
    );
    expect(result.current.accessOf('PORT')).toEqual(READ_ONLY);
    act(() => result.current.dismissRefusal());
    expect(result.current.refusal).toBeNull();
  });

  it('a second action in the same space reuses the answer: one lookup, no busy state', async () => {
    const fetchAccess = vi.fn(async () => FULL);
    const proceed = vi.fn();
    const { result } = renderHook(() => useKpiAccess(fetchAccess));
    act(() => result.current.guard('record:1', 'KPI', recordReason('KPIs'), proceed));
    await waitFor(() => expect(proceed).toHaveBeenCalledTimes(1));
    act(() => result.current.guard('record:2', 'KPI', recordReason('KPIs'), proceed));
    expect(result.current.pendingAction).toBeNull();
    expect(proceed).toHaveBeenCalledTimes(2);
    expect(fetchAccess).toHaveBeenCalledTimes(1);
  });

  it('a failed lookup lets the action go ahead', async () => {
    const proceed = vi.fn();
    const { result } = renderHook(() => useKpiAccess(() => Promise.reject(new Error('503'))));
    act(() => result.current.guard('record:1', 'KPI', recordReason('KPIs'), proceed));
    await waitFor(() => expect(proceed).toHaveBeenCalled());
    expect(result.current.refusal).toBeNull();
  });

  it('without a lookup (or a space) every action goes ahead at once', () => {
    const proceed = vi.fn();
    const { result } = renderHook(() => useKpiAccess());
    act(() => result.current.guard('record:1', null, recordReason('KPIs'), proceed));
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});
