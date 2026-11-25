import type { ParentOption } from './ParentField.js';

/** Sample Parent options (stories). */
export const space = (key: string, name: string) => ({ key, name });
export const PARENT_OPTIONS: ParentOption[] = [
  { kpiId: '1', key: 'KPI-1', name: 'Profit', space: space('KPI', 'Global KPIs') },
  { kpiId: '2', key: 'KPI-2', name: 'Revenue', space: space('KPI', 'Global KPIs') },
  { kpiId: '101', key: 'DCOM-101', name: 'Online revenue', space: space('DCOM', 'Digital Commerce') },
  { kpiId: '301', key: 'CHK-301', name: 'Checkout conversion', space: space('CHK', 'Checkout') },
  { kpiId: '302', key: 'CHK-302', name: 'Payment success rate', space: space('CHK', 'Checkout') },
];

