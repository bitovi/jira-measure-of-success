import {
  assemblePanel,
  clearPanelResolving,
  type PanelData,
  type PanelListData,
  type PanelValuesData,
} from '@domain/index.js';

/**
 * What the Issue panel should show, derived from the pieces of a progressive
 * load (specs/07-issue-panel-performance). Pure, so the rules are unit-tested
 * without React:
 *
 *  - `full` (a complete panel returned by a save/remove/record) always wins: a
 *    Phase 2 result that lands later can never overwrite it;
 *  - a KPI issue's Phase 1 is already the complete panel (the KPI chart);
 *  - otherwise the target list shows as soon as Phase 1 arrives (rows
 *    `resolving`), and Phase 2 fills in the values;
 *  - if Phase 2 failed, the list stays visible with the shimmer cleared.
 */
export interface PanelLoadState {
  list: PanelListData | null;
  values: PanelValuesData | null;
  valuesError: string | null;
  full: PanelData | null;
}

export interface PanelView {
  data: PanelData | null;
  /** Phase 2 is still outstanding (estimates are shimmering) */
  valuesPending: boolean;
  /** Phase 2 failed (and no complete result has superseded it) */
  valuesError: string | null;
}

export function derivePanelView(state: PanelLoadState): PanelView {
  const { list, values, valuesError, full } = state;
  if (full) return { data: full, valuesPending: false, valuesError: null };
  if (!list) return { data: null, valuesPending: false, valuesError: null };
  if (list.panel) return { data: list.panel, valuesPending: false, valuesError: null };
  if (values) return { data: assemblePanel(list.basis, values), valuesPending: false, valuesError: null };
  if (valuesError) {
    return { data: clearPanelResolving(assemblePanel(list.basis, null)), valuesPending: false, valuesError };
  }
  return { data: assemblePanel(list.basis, null), valuesPending: true, valuesError: null };
}
