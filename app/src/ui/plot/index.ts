/**
 * Shared plot module — the code-sharing seam between the KPI Timeline and the
 * KPI View (Feature 04). Both surfaces draw the SAME plot (quarter date axis,
 * recorded-value sparkline, target markers, hover tooltip, record/edit modals);
 * only the vertical value scale differs (`bandScale` vs `niceScale`), and that
 * is passed in as `yOf`. See specs/04-kpi-view/plan.md §2.
 */
export * from './axis.js';
export * from './scale.js';
export * from './markers.js';
export * from './modals.js';
export * from './hover.js';
