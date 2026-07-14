import type {
  Assignment,
  KpiDefinition,
  KpiDirection,
  KpiReading,
  RollupConfig,
} from '@domain/index.js';

/**
 * Harness fixtures — a slice of a real Jira hierarchy plus a KPI tree, used to
 * render every Custom UI surface locally and drive computer-vision checks.
 * Shapes are validated against the same zod models the app uses (fixtures.test),
 * so the mock cannot silently drift from production data.
 *
 * Issue tree (for the panel + settings preview):
 *   OUT-12  Outcome     Grow POS revenue      start 2026-01-01  due 2026-12-31
 *     INIT-48 Initiative Multi-store support    start 2026-02-01  due 2026-09-30
 *       INC-90 Increment Q1 rollout             start 2026-01-15  due 2026-03-31
 *         EPIC-231 Epic  Launch retail stores   start 2026-02-01  due 2026-05-31
 */

// ── Hierarchy levels (discovered at runtime; deepest-parent → leaf) ──────────
export const HIERARCHY_LEVELS = ['Outcome', 'Initiative', 'Increment', 'Epic', 'Story'];

// ── KPI catalog ─────────────────────────────────────────────────────────────
function kpi(
  id: string,
  name: string,
  unit: string,
  direction: KpiDirection | null,
): KpiDefinition {
  return {
    id,
    name,
    unit,
    direction: direction ?? 'increase',
    description: '',
    archived: false,
    createdBy: 'acc-jm',
    createdAt: 1_730_000_000_000,
  };
}

export const CATALOG: KpiDefinition[] = [
  kpi('revenue', 'Revenue', 'USD', 'increase'),
  kpi('orders', '# of Orders', 'count', 'increase'),
  kpi('stores', 'Number of Stores', 'count', 'increase'),
  kpi('feature-parity', 'Feature Parity', 'score', 'increase'),
  kpi('time-to-install', 'Time To Install', 'hours', 'decrease'),
  kpi('order-throughput', 'Order Throughput', 'orders/hr', 'increase'),
  kpi('time-to-checkout', 'Time To Checkout', 'seconds', 'decrease'),
  kpi('error-rate', 'Error Rate', '%', 'decrease'),
  kpi('costs', 'Costs', 'USD', 'decrease'),
  kpi('opportunity-enablement', 'Opportunity Enablement', 'future value', 'increase'),
];

// ── Assignment builders ─────────────────────────────────────────────────────
type DueOver = Partial<Assignment['timing']['due']>;

function relDue(over: DueOver = {}): Assignment['timing']['due'] {
  return { mode: 'relative', absolute: null, anchor: 'issueDueDate', offsetMonths: 0, ...over };
}

function assignment(over: Partial<Assignment> & { kpiId: string }): Assignment {
  return {
    inheritFromParent: false,
    target: null,
    targetType: 'absolute',
    timing: { start: null, due: relDue() },
    updatedBy: 'acc-jm',
    updatedAt: 1_730_000_000_000,
    ...over,
  };
}

// ── Issue tree ──────────────────────────────────────────────────────────────
export interface FixtureIssue {
  id: string;
  key: string;
  summary: string;
  issueTypeName: string;
  hierarchyLevel: number;
  parentId: string | null;
  ownStart: string | null;
  ownDue: string | null;
  assignments: Assignment[];
}

export const ISSUES: FixtureIssue[] = [
  {
    id: '10012',
    key: 'OUT-12',
    summary: 'Grow POS revenue',
    issueTypeName: 'Outcome',
    hierarchyLevel: 4,
    parentId: null,
    ownStart: '2026-01-01',
    ownDue: '2026-12-31',
    assignments: [
      assignment({
        kpiId: 'revenue',
        target: 1_500_000,
        timing: { start: '2026-01-01', due: relDue({ offsetMonths: 3 }) },
      }),
      assignment({
        kpiId: 'costs',
        target: 800_000,
        targetType: 'absolute',
        timing: { start: null, due: relDue({ mode: 'absolute', absolute: '2026-10-15' }) },
      }),
    ],
  },
  {
    id: '10048',
    key: 'INIT-48',
    summary: 'Multi-store support',
    issueTypeName: 'Initiative',
    hierarchyLevel: 3,
    parentId: '10012',
    ownStart: '2026-02-01',
    ownDue: '2026-09-30',
    assignments: [
      assignment({
        kpiId: 'revenue',
        target: 100_000,
        timing: { start: null, due: relDue({ offsetMonths: 1 }) },
      }),
      assignment({
        kpiId: 'stores',
        target: 250,
        targetType: 'absolute',
        timing: { start: null, due: relDue({ mode: 'absolute', absolute: '2026-09-30' }) },
      }),
    ],
  },
  {
    id: '10090',
    key: 'INC-90',
    summary: 'Q1 rollout',
    issueTypeName: 'Increment',
    hierarchyLevel: 2,
    parentId: '10048',
    ownStart: '2026-01-15',
    ownDue: '2026-03-31',
    assignments: [
      assignment({
        kpiId: 'stores',
        target: 145,
        targetType: 'absolute',
        timing: { start: null, due: relDue({ offsetMonths: 0 }) },
      }),
    ],
  },
  {
    id: '10231',
    key: 'EPIC-231',
    summary: 'Launch retail stores',
    issueTypeName: 'Epic',
    hierarchyLevel: 1,
    parentId: '10090',
    ownStart: '2026-02-01',
    ownDue: '2026-05-31',
    assignments: [],
  },
];

export const ROLLUP_CONFIG: RollupConfig = {
  dueDateRollup: {
    Outcome: 'childrenFirstThenParent',
    Initiative: 'parentFirstThenChildren',
    Increment: 'childrenFirstThenParent',
    Epic: 'parentOnly',
    Story: 'parentOnly',
  },
};

export function issueById(id: string): FixtureIssue | undefined {
  return ISSUES.find((i) => i.id === id);
}

// ── Issue-type icons ────────────────────────────────────────────────────────
const ISSUE_TYPE_ICON_COLORS: Record<string, string> = {
  Outcome: '#8777D9',
  Initiative: '#5243AA',
  Increment: '#00A3BF',
  Epic: '#904EE2',
  Story: '#36B37E',
  Task: '#4BADE8',
  Bug: '#E5493A',
  KPI: '#0052CC',
};

/**
 * A small inline SVG data URI standing in for a Jira issue-type icon — harness
 * only. The live app carries Jira's real `issuetype.iconUrl` instead.
 */
export function issueTypeIconUri(type: string): string {
  const color = ISSUE_TYPE_ICON_COLORS[type] ?? '#6B778C';
  const letter = (type.trim()[0] ?? '?').toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
    `<rect width="16" height="16" rx="3" fill="${color}"/>` +
    `<text x="8" y="12" font-size="10" font-family="Arial, sans-serif" fill="#fff" text-anchor="middle">${letter}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// ── Timeline KPI tree ───────────────────────────────────────────────────────
// The timeline is organized by the KPI tree (nested KPIs), each KPI carrying
// targets (set on source issues) and recorded readings.
export interface TimelineTargetFixture {
  date: string;
  value: number;
  source: { issue: string; type: string; title: string; iconUrl?: string | null };
}

export interface KpiTreeNode {
  kpiId: string;
  /** Jira issue key of the KPI issue (KPIs are issues in the KPI space) */
  issueKey: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  targets: TimelineTargetFixture[];
  readings: KpiReading[];
  children?: KpiTreeNode[];
}

const RECORDED_AT = 1_730_000_000_000;
function reads(pairs: Array<[string, number]>): KpiReading[] {
  return pairs.map(([date, value]) => ({ date, value, recordedBy: 'acc-jm', recordedAt: RECORDED_AT }));
}

// deterministic PRNG (mulberry32) so generated series render the same each load
function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function series(
  startISO: string,
  endISO: string,
  cadenceDays: number,
  from: number,
  to: number,
  noise: number,
  seed: number,
  round: (v: number) => number,
): KpiReading[] {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();
  const step = cadenceDays * 86_400_000;
  const rand = rng(seed);
  const out: KpiReading[] = [];
  for (let t = start; t <= end; t += step) {
    const frac = (t - start) / (end - start);
    const base = from + (to - from) * frac;
    const v = base * (1 + (rand() - 0.5) * 2 * noise);
    out.push({ date: new Date(t).toISOString().slice(0, 10), value: round(v), recordedBy: 'acc-jm', recordedAt: RECORDED_AT });
  }
  return out;
}
const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

export const KPI_TREE: KpiTreeNode[] = [
  {
    kpiId: 'revenue',
    issueKey: 'KPI-1',
    name: 'Revenue',
    unit: 'USD',
    direction: 'increase',
    targets: [
      { date: '2026-02-15', value: 990_000, source: { issue: 'INIT-48', type: 'Initiative', title: 'Enter New Markets' } },
      { date: '2026-06-30', value: 1_300_000, source: { issue: 'OUT-12', type: 'Outcome', title: 'Grow Revenue' } },
      { date: '2026-09-30', value: 1_400_000, source: { issue: 'OUT-12', type: 'Outcome', title: 'Grow Revenue' } },
      { date: '2026-12-20', value: 1_500_000, source: { issue: 'OUT-12', type: 'Outcome', title: 'Grow Revenue' } },
    ],
    readings: reads([
      ['2026-01-03', 1_000_000], ['2026-02-04', 1_018_000], ['2026-03-04', 1_072_000],
      ['2026-04-03', 1_051_000], ['2026-05-05', 1_129_000], ['2026-06-02', 1_176_000], ['2026-07-06', 1_243_000],
    ]),
    children: [
      {
        kpiId: 'orders',
        issueKey: 'KPI-2',
        name: '# of Orders',
        unit: 'count',
        direction: 'increase',
        targets: [
          { date: '2026-03-31', value: 7_800, source: { issue: 'INIT-48', type: 'Initiative', title: 'Expand Order Volume' } },
          { date: '2026-08-15', value: 11_500, source: { issue: 'INIT-48', type: 'Initiative', title: 'Expand Order Volume' } },
          { date: '2026-12-15', value: 13_000, source: { issue: 'INIT-48', type: 'Initiative', title: 'Expand Order Volume' } },
        ],
        readings: reads([
          ['2026-01-04', 8_000], ['2026-02-03', 8_320], ['2026-03-05', 8_080],
          ['2026-04-04', 8_990], ['2026-05-06', 9_380], ['2026-06-03', 9_210], ['2026-07-05', 10_380],
        ]),
        children: [
          {
            kpiId: 'stores',
            issueKey: 'KPI-3',
            name: 'Number of Stores',
            unit: 'count',
            direction: 'increase',
            targets: [
              { date: '2026-05-01', value: 145, source: { issue: 'EPIC-231', type: 'Epic', title: 'Launch Retail Stores' } },
              { date: '2026-09-30', value: 250, source: { issue: 'EPIC-231', type: 'Epic', title: 'Launch Retail Stores' } },
            ],
            readings: reads([['2026-01-15', 120], ['2026-04-15', 151], ['2026-07-05', 171]]),
            children: [
              {
                kpiId: 'feature-parity',
                issueKey: 'KPI-4',
                name: 'Feature Parity',
                unit: 'score',
                direction: 'increase',
                targets: [
                  { date: '2026-04-15', value: 50, source: { issue: 'STORY-882', type: 'Story', title: 'Store App Parity' } },
                  { date: '2026-11-30', value: 90, source: { issue: 'STORY-882', type: 'Story', title: 'Store App Parity' } },
                ],
                readings: reads([
                  ['2026-01-06', 40], ['2026-02-05', 47], ['2026-03-06', 53], ['2026-04-04', 57],
                  ['2026-05-06', 54], ['2026-06-05', 65], ['2026-07-06', 71],
                ]),
              },
              {
                kpiId: 'time-to-install',
                issueKey: 'KPI-5',
                name: 'Time To Install',
                unit: 'hours',
                direction: 'decrease',
                targets: [
                  { date: '2026-06-01', value: 8, source: { issue: 'STORY-905', type: 'Story', title: 'Faster Install' } },
                  { date: '2026-10-31', value: 4, source: { issue: 'STORY-905', type: 'Story', title: 'Faster Install' } },
                ],
                readings: series('2026-01-05', '2026-07-08', 7, 12, 6.8, 0.05, 11, r1),
              },
            ],
          },
          {
            kpiId: 'order-throughput',
            issueKey: 'KPI-6',
            name: 'Order Throughput',
            unit: 'orders/hr',
            direction: 'increase',
            targets: [
              { date: '2026-05-15', value: 360, source: { issue: 'EPIC-244', type: 'Epic', title: 'Scale Checkout' } },
              { date: '2026-12-31', value: 450, source: { issue: 'EPIC-244', type: 'Epic', title: 'Scale Checkout' } },
            ],
            readings: reads([
              ['2026-01-09', 300], ['2026-02-08', 322], ['2026-03-10', 345], ['2026-04-09', 335],
              ['2026-05-08', 352], ['2026-06-09', 372], ['2026-07-08', 384],
            ]),
            children: [
              {
                kpiId: 'time-to-checkout',
                issueKey: 'KPI-7',
                name: 'Time To Checkout',
                unit: 'seconds',
                direction: 'decrease',
                targets: [
                  { date: '2026-03-15', value: 190, source: { issue: 'STORY-921', type: 'Story', title: 'Checkout Speed' } },
                  { date: '2026-08-31', value: 120, source: { issue: 'STORY-921', type: 'Story', title: 'Checkout Speed' } },
                ],
                readings: series('2026-01-06', '2026-07-07', 7, 205, 145, 0.04, 23, r0),
              },
              {
                kpiId: 'error-rate',
                issueKey: 'KPI-8',
                name: 'Error Rate',
                unit: '%',
                direction: 'decrease',
                targets: [
                  { date: '2026-04-30', value: 3.0, source: { issue: 'STORY-934', type: 'Story', title: 'Reduce Errors' } },
                  { date: '2026-11-15', value: 1.5, source: { issue: 'STORY-934', type: 'Story', title: 'Reduce Errors' } },
                ],
                readings: series('2026-01-07', '2026-07-08', 7, 4.2, 2.8, 0.05, 37, r1),
              },
            ],
          },
        ],
      },
    ],
  },
  {
    kpiId: 'costs',
    issueKey: 'KPI-9',
    name: 'Costs',
    unit: 'USD',
    direction: 'decrease',
    targets: [
      { date: '2026-03-20', value: 885_000, source: { issue: 'OUT-15', type: 'Outcome', title: 'Control Costs' } },
      { date: '2026-10-15', value: 800_000, source: { issue: 'OUT-15', type: 'Outcome', title: 'Control Costs' } },
    ],
    readings: reads([
      ['2026-01-15', 900_000], ['2026-02-14', 895_000], ['2026-03-14', 878_000], ['2026-04-13', 884_000],
      ['2026-05-15', 862_000], ['2026-06-14', 851_000], ['2026-07-08', 843_000],
    ]),
  },
  {
    kpiId: 'opportunity-enablement',
    issueKey: 'KPI-10',
    name: 'Opportunity Enablement',
    unit: 'future value',
    direction: null,
    targets: [
      { date: '2026-09-01', value: 100, source: { issue: 'INIT-53', type: 'Initiative', title: 'Sales Enablement' } },
    ],
    readings: [],
  },
];
