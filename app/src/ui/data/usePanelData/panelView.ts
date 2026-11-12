import {
  applyReadingEdits,
  applyReadingEditsToKpiView,
  assemblePanel,
  clearPanelResolving,
  type PanelData,
  type PanelListData,
  type PanelParts,
  type PanelValuesData,
  type RecordValueInput,
} from '@domain/index.js';

/**
 * What the Issue panel should show, derived from the pieces of a progressive
 * load (specs/07-issue-panel-performance). Pure, so the rules are unit-tested
 * without React:
 *
 *  - `mutated` (the parts a save/remove returned) always wins over the initial
 *    load: a Phase 1/2 result that lands later can never overwrite it;
 *  - a KPI issue's Phase 1 is already the complete panel (the KPI chart);
 *  - otherwise the target list shows as soon as Phase 1 arrives (rows
 *    `resolving`), and Phase 2 fills in the values;
 *  - if Phase 2 failed, the list stays visible with the shimmer cleared.
 *
 * `recordValue` returns nothing, so values recorded this session
 * (`readingEdits`) are applied to whichever readings are showing — the KPI
 * chart's series (its markers rebuilt), or the Phase 2 readings behind the
 * target cards. A no-op once the loaded data already includes them.
 */
export interface PanelLoadState {
  list: PanelListData | null;
  values: PanelValuesData | null;
  valuesError: string | null;
  mutated?: PanelParts | null;
  readingEdits?: readonly RecordValueInput[];
}

export interface PanelView {
  data: PanelData | null;
  /** Phase 2 is still outstanding (estimates are shimmering) */
  valuesPending: boolean;
  /** Phase 2 failed (and no save/remove result has superseded it) */
  valuesError: string | null;
}

function withEdits(values: PanelValuesData, edits: readonly RecordValueInput[]): PanelValuesData {
  if (edits.length === 0) return values;
  const readings = { ...values.readings };
  for (const kpiId of new Set(edits.map((e) => e.kpiId))) {
    readings[kpiId] = applyReadingEdits(readings[kpiId] ?? [], edits, kpiId);
  }
  return { ...values, readings };
}

export function derivePanelView(state: PanelLoadState): PanelView {
  const edits = state.readingEdits ?? [];
  const list = state.mutated?.list ?? state.list;
  const values = state.mutated?.values ?? state.values;
  const valuesError = state.mutated ? null : state.valuesError;
  if (!list) return { data: null, valuesPending: false, valuesError: null };
  if (list.panel) {
    const { panel } = list;
    const data = panel.kpiView ? { ...panel, kpiView: applyReadingEditsToKpiView(panel.kpiView, edits) } : panel;
    return { data, valuesPending: false, valuesError: null };
  }
  if (values) {
    return { data: assemblePanel(list.basis, withEdits(values, edits)), valuesPending: false, valuesError: null };
  }
  if (valuesError) {
    return { data: clearPanelResolving(assemblePanel(list.basis, null)), valuesPending: false, valuesError };
  }
  return { data: assemblePanel(list.basis, null), valuesPending: true, valuesError: null };
}
