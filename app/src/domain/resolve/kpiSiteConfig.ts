import type { KpiHierarchyLink } from '../models/kpiHierarchy';
import {
  DEFAULT_KPI_WORK_TYPE_NAME,
  StoredKpiSiteConfig,
  type KpiFieldsConfig,
  type KpiSiteConfig,
} from '../models/kpiSiteConfig';
import type {
  KpiCentralSpaceStatus,
  KpiFieldsStatus,
  KpiSetupStatus,
  KpiWorkTypeStatus,
} from '../contracts';

/**
 * The site configuration (spec 11 · 04), kept pure: how an install's config is
 * put together from what's stored, and how Settings checks it against the site.
 */

/** `kpi:space` as older versions store it. */
export interface LegacyKpiSpace {
  key: string | null;
  projectId: string | null;
  name: string | null;
}

export interface KpiSiteConfigSources {
  /** what `kpi:config:site` holds (anything; validated here) */
  stored: unknown;
  space: LegacyKpiSpace | null;
  hierarchy: KpiHierarchyLink | null;
  /** the site's work types: only read when nothing usable is stored */
  issueTypes?: ReadonlyArray<{ id: string; name: string }> | null;
}

/** The stored record, or null when there's none (or it doesn't parse). */
export function parseStoredKpiSiteConfig(stored: unknown): StoredKpiSiteConfig | null {
  const parsed = StoredKpiSiteConfig.safeParse(stored);
  return parsed.success ? parsed.data : null;
}

function centralSpaceFrom(space: LegacyKpiSpace | null): KpiSiteConfig['centralSpace'] {
  if (!space?.key || !space.projectId) return null;
  return { projectId: space.projectId, key: space.key, name: space.name ?? space.key };
}

/**
 * An install with no saved configuration (an upgraded one, or a fresh one):
 * its central space and hierarchy as stored, the work type named `KPI` if the
 * site has one, and no fields (05 keeps using `kpi-meta` only).
 */
export function deriveKpiSiteConfig({ space, hierarchy, issueTypes }: Omit<KpiSiteConfigSources, 'stored'>): KpiSiteConfig {
  const type = issueTypes?.find((t) => t.name === DEFAULT_KPI_WORK_TYPE_NAME);
  return {
    workType: type ? { id: type.id, name: type.name } : null,
    fields: null,
    centralSpace: centralSpaceFrom(space),
    hierarchy,
    schemes: {},
  };
}

/** The install's configuration: the saved one when there is one, else derived. */
export function kpiSiteConfigFrom(sources: KpiSiteConfigSources): { config: KpiSiteConfig; saved: boolean } {
  const stored = parseStoredKpiSiteConfig(sources.stored);
  if (!stored) return { config: deriveKpiSiteConfig(sources), saved: false };
  return {
    config: { ...stored, centralSpace: centralSpaceFrom(sources.space), hierarchy: sources.hierarchy },
    saved: true,
  };
}

/** What Settings found on the site. A `null` list = it couldn't be read, so nothing is marked broken. */
export interface KpiSiteFacts {
  issueTypes: ReadonlyArray<{ id: string; name: string; iconUrl?: string | null }> | null;
  fields: ReadonlyArray<{ id: string; name: string }> | null;
  /** the select direction field's options (its global context) */
  directionOptions?: ReadonlyArray<{ id: string; value: string }> | null;
  /** the central space as Jira has it: null = gone; undefined = not looked up */
  centralProject?: { id: string; key: string; name: string; issueTypeIds: string[] } | null;
}

function assessWorkType(config: KpiSiteConfig, facts: KpiSiteFacts): KpiWorkTypeStatus {
  const saved = config.workType;
  if (!saved) return { state: 'unset', id: null, name: null, iconUrl: null };
  if (!facts.issueTypes) return { state: 'ready', id: saved.id, name: saved.name, iconUrl: null };
  const live = facts.issueTypes.find((t) => t.id === saved.id);
  if (!live) return { state: 'broken', id: saved.id, name: saved.name, iconUrl: null };
  return { state: 'ready', id: live.id, name: live.name, iconUrl: live.iconUrl ?? null };
}

function assessFields(fields: KpiFieldsConfig | null, facts: KpiSiteFacts): KpiFieldsStatus {
  if (!fields) return { state: 'unset', unit: null, direction: null };
  const nameOf = (fieldId: string): string | null | undefined =>
    facts.fields ? (facts.fields.find((f) => f.id === fieldId)?.name ?? null) : undefined;
  const unitName = nameOf(fields.unit.fieldId);
  const dirName = nameOf(fields.direction.fieldId);
  const unit = { id: fields.unit.fieldId, name: unitName === undefined ? fields.unit.fieldId : unitName };
  const direction: KpiFieldsStatus['direction'] = {
    id: fields.direction.fieldId,
    name: dirName === undefined ? fields.direction.fieldId : dirName,
    kind: fields.direction.kind,
  };
  const problems: string[] = [];
  if (unitName === null) problems.push(`The unit field (${fields.unit.fieldId}) no longer exists.`);
  if (dirName === null) problems.push(`The direction field (${fields.direction.fieldId}) no longer exists.`);
  if (fields.direction.kind === 'select' && dirName !== null) {
    const options = facts.directionOptions;
    const label = (optionId: string) => (options ? (options.find((o) => o.id === optionId)?.value ?? null) : undefined);
    const increase = label(fields.direction.optionIds.increase);
    const decrease = label(fields.direction.optionIds.decrease);
    direction.increase = increase === undefined ? null : increase;
    direction.decrease = decrease === undefined ? null : decrease;
    if (increase === null || decrease === null) {
      problems.push(`An option of ${dirName ?? 'the direction field'} that the app maps to a direction was deleted.`);
    }
  }
  return problems.length > 0
    ? { state: 'broken', unit, direction, problem: problems.join(' ') }
    : { state: 'ready', unit, direction };
}

function assessCentralSpace(config: KpiSiteConfig, facts: KpiSiteFacts): KpiCentralSpaceStatus {
  const space = config.centralSpace;
  if (!space) return { state: 'unset', projectId: null, key: null, name: null };
  const base = { projectId: space.projectId, key: space.key, name: space.name };
  const live = facts.centralProject;
  if (live === undefined) return { state: 'ready', ...base };
  if (live === null) return { state: 'broken', ...base, problem: `The space ${space.key} no longer exists.` };
  const current = { projectId: live.id, key: live.key, name: live.name };
  if (config.workType && !live.issueTypeIds.includes(config.workType.id)) {
    return {
      state: 'misconfigured',
      ...current,
      problem: `${live.name} doesn't offer the ${config.workType.name} work type, so KPIs can't be created in it.`,
    };
  }
  return { state: 'ready', ...current };
}

/** Settings' view of the configuration, with every saved id checked against the site. */
export function assessKpiSetup(config: KpiSiteConfig, saved: boolean, facts: KpiSiteFacts): KpiSetupStatus {
  return {
    saved,
    workType: assessWorkType(config, facts),
    fields: assessFields(config.fields, facts),
    centralSpace: assessCentralSpace(config, facts),
  };
}
