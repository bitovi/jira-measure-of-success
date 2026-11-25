import {
  buildKpiSuggestions,
  kpiMatches,
  kpiRefOf,
  parseKpiRefInput,
  toKpiOptions,
  type Assignment,
  type DueTiming,
  type KpiDirection,
  type KpiOptionDto,
  type KpiPickerSpace,
  type KpiRefLookup,
  type KpiSuggestionsDto,
  type PickerKpi,
  type TargetType,
  type WorkItemRefDto,
} from '@domain/index.js';
import type { KpiPickerApi } from '@ui/data/useKpiPicker/index.js';
import { TYPE_ICONS } from './typeIcons.js';

export { TYPE_ICONS };

/**
 * A KPI picker "world" (spec 11 · 07): spaces, KPIs and work items with
 * targets, plus what the backend would answer for them — the opening views
 * (`worldSuggestions`) and the lazy loads (`worldPickerApi`), built with the
 * same pure rules the backend uses. The stories use the prototype's world
 * (`PROTOTYPE_WORLD`) and a scale world; the harness adapts its own fixtures.
 */
export interface WorldKpi {
  id: string;
  key: string;
  name: string;
  unit: string;
  direction: KpiDirection | null;
  /** the KPI-tree parent's key (any space), or null */
  parentKey: string | null;
}

export interface WorldItem {
  id: string;
  key: string;
  summary: string;
  typeName: string;
  parentKey: string | null;
  /** its targets, by KPI id */
  targets: Assignment[];
}

export interface PickerWorld {
  /** space key → name */
  spaces: Record<string, string>;
  kpis: WorldKpi[];
  items: WorldItem[];
  /** the central space ("Global KPIs"), or null */
  centralKey: string | null;
  /** spaces the user can't browse */
  hidden: ReadonlySet<string>;
  /** a moved KPI's old key → its new key */
  moved: Record<string, string>;
  /** a KPI's latest reading */
  currentValue: (kpiId: string) => number | null;
  /** a work type's inlined icon (default: the prototype's icons) */
  typeIcon?: (typeName: string) => string | null;
}

const spaceKeyOf = (key: string) => key.split('-')[0];
const prototypeIcon = (typeName: string): string | null => (TYPE_ICONS as Record<string, string>)[typeName] ?? null;
const typeIconOf = (world: PickerWorld, typeName: string): string | null => (world.typeIcon ?? prototypeIcon)(typeName);

export function worldSpace(world: PickerWorld, key: string): KpiPickerSpace {
  return { key, name: world.spaces[key] ?? key };
}

function visibleKpis(world: PickerWorld): WorldKpi[] {
  return world.kpis.filter((k) => !world.hidden.has(spaceKeyOf(k.key)));
}

function toPickerKpi(world: PickerWorld, k: WorldKpi, rank: number): PickerKpi {
  const parent = k.parentKey ? world.kpis.find((p) => p.key === k.parentKey) : undefined;
  return {
    id: k.id,
    key: k.key,
    name: k.name,
    typeIconUrl: typeIconOf(world, 'KPI'),
    unit: k.unit,
    direction: k.direction,
    space: worldSpace(world, spaceKeyOf(k.key)),
    parentIds: parent ? [parent.id] : [],
    rank: `0|a${String(rank).padStart(6, '0')}:`,
  };
}

function pickerKpis(world: PickerWorld, kpis: WorldKpi[]): PickerKpi[] {
  return kpis.map((k) => toPickerKpi(world, k, world.kpis.indexOf(k)));
}

function itemRef(world: PickerWorld, item: WorldItem): WorkItemRefDto {
  return { id: item.id, key: item.key, summary: item.summary, typeName: item.typeName, typeIconUrl: typeIconOf(world, item.typeName) };
}

/** The work item's parents, nearest first (cycle-guarded, capped at 10). */
export function worldChain(world: PickerWorld, itemKey: string): WorldItem[] {
  const out: WorldItem[] = [];
  const seen = new Set([itemKey]);
  let next = world.items.find((i) => i.key === itemKey)?.parentKey ?? null;
  while (next && !seen.has(next) && out.length < 10) {
    seen.add(next);
    const parent = world.items.find((i) => i.key === next);
    if (!parent) break;
    out.push(parent);
    next = parent.parentKey;
  }
  return out;
}

/** What opening the panel on `itemKey` sends the picker (`PanelBasis.picker`). */
export function worldSuggestions(world: PickerWorld, itemKey: string, ownTargetIds?: string[]): KpiSuggestionsDto {
  const item = world.items.find((i) => i.key === itemKey);
  const thisKey = spaceKeyOf(itemKey);
  return buildKpiSuggestions({
    thisSpace: worldSpace(world, thisKey),
    centralSpace: world.centralKey ? worldSpace(world, world.centralKey) : null,
    chain: worldChain(world, itemKey).map((p) => ({
      item: itemRef(world, p),
      space: worldSpace(world, spaceKeyOf(p.key)),
      targets: p.targets,
    })),
    kpis: pickerKpis(world, visibleKpis(world)),
    ownTargetIds: ownTargetIds ?? item?.targets.map((a) => a.kpiId) ?? [],
  });
}

/** A list as the backend sends it: rank order, nested within itself. */
function optionList(world: PickerWorld, kpis: WorldKpi[]): KpiOptionDto[] {
  return toKpiOptions(pickerKpis(world, kpis), { key: '', name: '' });
}

const SEARCH_CAP = 50;
const SPACE_PAGE = 50;

/** The picker's lazy loads over the world, each after `delayMs` (the round trip). */
export function worldPickerApi(world: PickerWorld, { delayMs = 0 }: { delayMs?: number } = {}): KpiPickerApi {
  const later = <T>(value: () => T): Promise<T> =>
    new Promise((resolve, reject) => {
      const run = () => {
        try {
          resolve(value());
        } catch (e) {
          reject(e);
        }
      };
      if (delayMs > 0) setTimeout(run, delayMs);
      else void Promise.resolve().then(run);
    });
  const kpiSpaces = () => [...new Set(world.kpis.map((k) => spaceKeyOf(k.key)))];
  return {
    listKpisInSpaces: (keys) =>
      later(() => optionList(world, visibleKpis(world).filter((k) => keys.includes(spaceKeyOf(k.key))))),
    searchKpis: (text, projectKey) =>
      later(() => {
        const words = text.trim().toLowerCase();
        const found = visibleKpis(world).filter(
          (k) =>
            (!projectKey || spaceKeyOf(k.key) === projectKey) &&
            (!words || k.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(words)) || k.name.toLowerCase().startsWith(words)),
        );
        return { kpis: optionList(world, found.slice(0, SEARCH_CAP)), truncated: found.length > SEARCH_CAP };
      }),
    listKpiSpaces: (query, startAt = 0) =>
      later(() => {
        const q = query.trim().toLowerCase();
        const all = kpiSpaces()
          .filter((key) => !world.hidden.has(key))
          .sort()
          .filter((key) => !q || key.toLowerCase().includes(q) || (world.spaces[key] ?? '').toLowerCase().includes(q));
        const page = all.slice(startAt, startAt + SPACE_PAGE);
        return {
          spaces: page.map((key) => worldSpace(world, key)),
          nextStartAt: startAt + SPACE_PAGE < all.length ? startAt + SPACE_PAGE : null,
        };
      }),
    lookupKpiRef: (raw) =>
      later((): KpiRefLookup => {
        const ref = kpiRefOf(parseKpiRefInput(raw));
        if (!ref) return { kind: 'hidden' };
        const key = world.moved[ref] ?? ref;
        const kpi = world.kpis.find((k) => k.key === key || k.id === key);
        if (kpi) {
          if (world.hidden.has(spaceKeyOf(kpi.key))) return { kind: 'hidden' };
          return { kind: 'kpi', option: { ...optionList(world, [kpi])[0], parentId: null, hasChildren: false } };
        }
        const item = world.items.find((i) => i.key === key || i.id === key);
        if (item && !world.hidden.has(spaceKeyOf(item.key))) return { kind: 'notKpi', item: itemRef(world, item) };
        return { kind: 'hidden' };
      }),
    getKpiCurrentValue: (kpiId) => later(() => ({ kpiId, value: world.currentValue(kpiId) })),
  };
}

/** An option for a KPI of the world (e.g. a story's picked value). */
export function worldOption(world: PickerWorld, key: string): KpiOptionDto {
  const kpi = world.kpis.find((k) => k.key === key)!;
  return { ...optionList(world, [kpi])[0], parentId: null, hasChildren: false };
}

/** Does any visible KPI match? (stories' expectations) */
export function worldMatches(world: PickerWorld, text: string): WorldKpi[] {
  return visibleKpis(world).filter((k) => kpiMatches(k, text));
}

// ── The prototype's world (kpi-picker.html) ─────────────────────────────────

const absolute = (date: string): DueTiming => ({ mode: 'absolute', absolute: date, anchor: 'issueDueDate', offsetMonths: 0 });

function target(kpiId: string, value: number, targetType: TargetType, due: DueTiming): Assignment {
  return { kpiId, inheritFromParent: false, target: value, targetType, timing: { start: null, due }, updatedBy: 'acc', updatedAt: 0 };
}

const PROTOTYPE_KPIS: Array<[key: string, name: string, unit: string, parentKey: string | null]> = [
  ['TEAM-501', 'Checkout conversion', '%', 'PROG-210'],
  ['TEAM-502', 'Cart abandonment', '%', 'TEAM-501'],
  ['TEAM-505', 'Saved-card usage', '%', 'TEAM-501'],
  ['TEAM-503', 'Checkout p95 latency', 'ms', null],
  ['TEAM-504', 'Payment errors / day', 'count', null],
  ['PROG-210', 'Conversion rate', '%', 'PORT-12'],
  ['PROG-211', 'Trial-to-paid', '%', 'PROG-210'],
  ['PROG-214', 'Signup-to-trial', '%', 'PROG-210'],
  ['PROG-212', 'Activation rate', '%', null],
  ['PROG-213', 'Day-7 retention', '%', 'PROG-212'],
  ['PORT-12', 'Net revenue', '$', null],
  ['PORT-13', 'Expansion revenue', '$', 'PORT-12'],
  ['PORT-14', 'Gross margin', '%', null],
  ['PORT-20', 'Customer NPS', 'score', null],
  ['OPS-40', 'Uptime', '%', null],
  ['OPS-41', 'Incident MTTR', 'h', 'OPS-40'],
  ['OPS-42', 'Deploys / week', 'count', null],
  ['MKT-9', 'Signups / week', 'count', null],
  ['MKT-10', 'Customer acquisition cost', '$', 'MKT-9'],
  ['MKT-11', 'Conversion from paid ads', '%', 'MKT-9'],
  ['FIN-2', 'Operating cash flow', '$', null],
  ['KPI-1', 'Revenue growth', '%', null],
  ['KPI-2', 'Gross retention', '%', null],
  ['KPI-3', 'Employee engagement', 'score', null],
  ['KPI-7', 'Customer satisfaction (CSAT)', 'score', null],
  ['HR-3', 'Time to hire', 'days', null],
  ['SEC-8', 'Critical vulnerabilities open', 'count', null],
  ['DATA-4', 'Pipeline freshness', 'h', null],
  ['MOB-6', 'App store rating', 'score', null],
  ['MOB-7', 'Mobile checkout conversion', '%', null],
  ['WEB-9', 'Page load (LCP)', 's', null],
  ['SUP-12', 'First response time', 'h', null],
  ['SUP-13', 'Ticket backlog', 'count', 'SUP-12'],
  ['LOG-2', 'On-time delivery', '%', null],
  ['LEGAL-1', 'Contract cycle time', 'days', null],
];

const protoKpis: WorldKpi[] = PROTOTYPE_KPIS.map(([key, name, unit, parentKey], i) => ({
  id: String(70_000 + i),
  key,
  name,
  unit,
  direction: /latency|errors|abandonment|MTTR|cost|backlog|response|cycle|LCP|vulnerab|hire|freshness/i.test(name) ? 'decrease' : 'increase',
  parentKey,
}));
const idOf = (key: string) => protoKpis.find((k) => k.key === key)!.id;

/** The prototype's site: TEAM-123 Story → PROG-45 Epic → PORT-7 Initiative; FIN is hidden; KPI-5 moved to PORT-20. */
export const PROTOTYPE_WORLD: PickerWorld = {
  spaces: {
    TEAM: 'Checkout Team',
    PROG: 'Growth Program',
    PORT: 'Company Portfolio',
    OPS: 'Platform Ops',
    MKT: 'Marketing',
    NEW: 'Loyalty Squad',
    FIN: 'Finance',
    KPI: 'Global KPIs',
    HR: 'People Ops',
    SEC: 'Security',
    DATA: 'Data Platform',
    MOB: 'Mobile App',
    WEB: 'Web Storefront',
    SUP: 'Customer Support',
    LOG: 'Logistics',
    LEGAL: 'Legal',
  },
  kpis: protoKpis,
  items: [
    {
      id: '40007',
      key: 'PORT-7',
      summary: 'FY27 growth',
      typeName: 'Initiative',
      parentKey: null,
      targets: [
        target(idOf('PORT-12'), 12, 'percent', absolute('2026-12-31')),
        target(idOf('PROG-210'), 3, 'relative', absolute('2026-12-31')),
      ],
    },
    {
      id: '40045',
      key: 'PROG-45',
      summary: 'Frictionless checkout',
      typeName: 'Epic',
      parentKey: 'PORT-7',
      targets: [
        target(idOf('PROG-210'), 2, 'relative', absolute('2026-06-30')),
        target(idOf('TEAM-501'), 5, 'percent', absolute('2026-03-31')),
      ],
    },
    {
      id: '40123',
      key: 'TEAM-123',
      summary: 'Apple Pay at checkout',
      typeName: 'Story',
      parentKey: 'PROG-45',
      targets: [target(idOf('TEAM-503'), -10, 'percent', absolute('2026-03-31'))],
    },
    { id: '40008', key: 'NEW-8', summary: 'Points on every order', typeName: 'Story', parentKey: 'PROG-45', targets: [] },
  ],
  centralKey: 'KPI',
  hidden: new Set(['FIN']),
  moved: { 'KPI-5': 'PORT-20' },
  currentValue: (kpiId) => 37 + ((Number(kpiId) % 13) * 7.3) % 50,
};

/** The prototype's site with no central space. */
export const PROTOTYPE_WORLD_NO_CENTRAL: PickerWorld = { ...PROTOTYPE_WORLD, centralKey: null };

/**
 * The scale check (Q6): 300 KPIs over 25 spaces, a work item whose Epic
 * targets 6 KPIs (each with a few sub-KPIs) and whose Initiative targets 2.
 */
export function scaleWorld(): PickerWorld {
  const spaces: Record<string, string> = { KPI: 'Global KPIs', TEAM: 'Checkout Team', PROG: 'Growth Program' };
  const names = ['Revenue', 'Conversion', 'Retention', 'Latency', 'Errors', 'Signups', 'Activation', 'Churn', 'Margin', 'NPS', 'Uptime', 'Cost'];
  for (let s = 1; Object.keys(spaces).length < 25; s += 1) spaces[`S${String(s).padStart(2, '0')}`] = `Team space ${s}`;
  const keys = Object.keys(spaces);
  const kpis: WorldKpi[] = [];
  for (let i = 0; kpis.length < 300; i += 1) {
    const space = keys[i % keys.length];
    const n = Math.floor(i / keys.length) + 1;
    const key = `${space}-${n}`;
    // Every fourth KPI of a space is a root; the next three nest under it.
    const parentKey = n % 4 === 1 ? null : `${space}-${n - ((n - 1) % 4)}`;
    kpis.push({
      id: String(80_000 + i),
      key,
      name: `${names[i % names.length]} ${space.toLowerCase()} ${n}`,
      unit: i % 3 === 0 ? '%' : 'count',
      direction: 'increase',
      parentKey,
    });
  }
  const id = (key: string) => kpis.find((k) => k.key === key)!.id;
  const epicTargets = ['PROG-1', 'PROG-5', 'PROG-9', 'TEAM-1', 'TEAM-5', 'KPI-1'].map((k, i) =>
    target(id(k), i + 2, i % 2 ? 'percent' : 'relative', absolute('2026-09-30')),
  );
  return {
    spaces,
    kpis,
    items: [
      {
        id: '50001',
        key: 'PROG-900',
        summary: 'FY27 checkout growth',
        typeName: 'Initiative',
        parentKey: null,
        targets: [target(id('KPI-1'), 8, 'percent', absolute('2026-12-31')), target(id('KPI-5'), 4, 'percent', absolute('2026-12-31'))],
      },
      { id: '50002', key: 'PROG-901', summary: 'One-tap checkout', typeName: 'Epic', parentKey: 'PROG-900', targets: epicTargets },
      { id: '50003', key: 'TEAM-950', summary: 'Wallets at checkout', typeName: 'Story', parentKey: 'PROG-901', targets: [] },
    ],
    centralKey: 'KPI',
    hidden: new Set(),
    moved: {},
    currentValue: () => 42,
  };
}
