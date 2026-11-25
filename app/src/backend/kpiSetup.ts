import { route } from '@forge/api';
import {
  DEFAULT_KPI_DIRECTION_FIELD_NAME,
  DEFAULT_KPI_UNIT_FIELD_NAME,
  DEFAULT_KPI_WORK_TYPE_NAME,
  KPI_DIRECTION_OPTION_VALUES,
  assessKpiSetup,
  type KpiFieldChoice,
  type KpiFieldOption,
  type KpiFieldsConfig,
  type KpiSetupStatus,
  type KpiSiteConfig,
  type KpiSpaceChoice,
  type KpiSpaceSetupStatus,
  type KpiSpaceStep,
  type KpiWorkTypeChoice,
  type KpiWorkTypeRef,
  type SetUpKpiFieldsInput,
  type SetUpKpiWorkTypeInput,
} from '../domain/index';
import {
  ensureKpiIssueTypeOnProject,
  findProject,
  forgetIssueTypes,
  jiraError,
  listIssueTypes,
  type SiteIssueType,
} from './jira';
import { KPI_WORK_TYPE_ICON_PNG_BASE64, KPI_WORK_TYPE_ICON_SIZE } from './kpiIcon';
import { loadKpiSiteConfig } from './kpiConfig';
import { asApp, asUser, forgetPerInvocation, perInvocation } from './requestLog';

/**
 * KPI building blocks (spec 11 · 04): the Jira configuration Settings creates
 * or points the app at — the KPI work type, the unit and direction fields, and
 * what a space needs to hold KPIs (the work type in its work type scheme, the
 * fields in its field scheme for that type, optionally on its screens).
 *
 * Every function is idempotent: run twice, it changes nothing the second time.
 * Reads run as the app; changes run as the admin (spec 10), so Jira itself
 * requires Administer Jira for each one. All calls are covered by the app's
 * current scopes (01 B3).
 */

const CUSTOM = 'com.atlassian.jira.plugin.system.customfieldtypes';
const TEXT_FIELD = `${CUSTOM}:textfield`;
const SELECT_FIELD = `${CUSTOM}:select`;
const json = { 'Content-Type': 'application/json' };

// ── Work type ───────────────────────────────────────────────────────────────

/** A type KPIs can be created as: a standard, site-wide type (not a sub-task, not a team-managed space's own). */
function isStandardType(t: SiteIssueType): boolean {
  return !t.subtask && !t.projectScoped && (t.hierarchyLevel ?? 0) === 0;
}

export async function listKpiWorkTypeChoices(): Promise<KpiWorkTypeChoice[]> {
  return (await listIssueTypes())
    .filter(isStandardType)
    .map((t) => ({ id: t.id, name: t.name, iconUrl: t.iconUrl }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Give a work type the app created the bullseye icon. Best effort: a type without it still works. */
async function setKpiWorkTypeIcon(typeId: string): Promise<void> {
  try {
    const png = Buffer.from(KPI_WORK_TYPE_ICON_PNG_BASE64, 'base64');
    const body = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer;
    const size = KPI_WORK_TYPE_ICON_SIZE;
    const upload = await asUser().requestJira(
      route`/rest/api/3/universal_avatar/type/issuetype/owner/${typeId}?x=0&y=0&size=${size}`,
      { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Atlassian-Token': 'no-check' }, body },
    );
    if (!upload.ok) throw new Error(await jiraError(upload, 'upload the KPI icon'));
    const avatar = (await upload.json()) as { id: string | number };
    const set = await asUser().requestJira(route`/rest/api/3/issuetype/${typeId}`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ avatarId: Number(avatar.id) }),
    });
    if (!set.ok) throw new Error(await jiraError(set, 'set the KPI icon'));
    forgetIssueTypes();
  } catch (e) {
    console.warn('[kpiSetup] the KPI work type was created without its icon:', (e as Error)?.message ?? e);
  }
}

/**
 * The KPI work type: create the app's `KPI` type (or use one of that name the
 * site already has), or use an existing standard type. Only a type the app
 * creates gets the bullseye icon; existing types are left alone (Q11).
 */
export async function ensureKpiWorkType(input: SetUpKpiWorkTypeInput): Promise<KpiWorkTypeRef> {
  const types = await listIssueTypes();
  if (input.mode === 'existing') {
    const type = types.find((t) => t.id === input.id);
    if (!type) throw new Error(`There's no work type with id "${input.id}" on this site.`);
    if (!isStandardType(type)) {
      throw new Error(`${type.name} can't hold KPIs. Pick a standard work type (not a sub-task or a team-managed space's own type).`);
    }
    return { id: type.id, name: type.name };
  }
  const existing = types.find((t) => t.name === DEFAULT_KPI_WORK_TYPE_NAME && isStandardType(t));
  if (existing) return { id: existing.id, name: existing.name };
  const res = await asUser().requestJira(route`/rest/api/3/issuetype`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({
      name: DEFAULT_KPI_WORK_TYPE_NAME,
      type: 'standard',
      description: 'A KPI (Measure of Success). Every work item of this type is a KPI.',
    }),
  });
  if (!res.ok) throw new Error(await jiraError(res, `create the "${DEFAULT_KPI_WORK_TYPE_NAME}" work type`));
  const created = (await res.json()) as { id: string | number; name?: string };
  forgetIssueTypes();
  const id = String(created.id);
  await setKpiWorkTypeIcon(id);
  return { id, name: created.name ?? DEFAULT_KPI_WORK_TYPE_NAME };
}

// ── Fields ──────────────────────────────────────────────────────────────────

type RawField = { id: string; name?: string; schema?: { type?: string; custom?: string } };

/** Every field on the site, read once per invocation (as the app). */
function listFields(): Promise<RawField[]> {
  return perInvocation('siteFields', async () => {
    const res = await asApp().requestJira(route`/rest/api/3/field`);
    if (!res.ok) throw new Error(await jiraError(res, 'list fields'));
    return (await res.json()) as RawField[];
  });
}

/** What a field can hold for a KPI: short text, a single select, or neither. */
function fieldKind(field: RawField): 'text' | 'select' | null {
  const custom = field.schema?.custom;
  if (custom === TEXT_FIELD) return 'text';
  if (custom === SELECT_FIELD) return 'select';
  return null;
}

/** Short-text and single-select fields, for the unit and direction pickers. */
export async function listKpiFieldChoices(): Promise<KpiFieldChoice[]> {
  const out: KpiFieldChoice[] = [];
  for (const f of await listFields()) {
    const kind = fieldKind(f);
    if (kind) out.push({ id: f.id, name: f.name ?? f.id, kind });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** The id of a field's global context (Jira gives each custom field one, 01 A3); it holds a select's options. */
async function globalContextId(fieldId: string): Promise<string> {
  const res = await asApp().requestJira(route`/rest/api/3/field/${fieldId}/context?maxResults=100`);
  if (!res.ok) throw new Error(await jiraError(res, `read the contexts of ${fieldId}`));
  const body = (await res.json()) as { values?: Array<{ id: string | number; isGlobalContext?: boolean }> };
  const context = body.values?.find((c) => c.isGlobalContext) ?? body.values?.[0];
  if (!context) throw new Error(`${fieldId} has no context to hold its options.`);
  return String(context.id);
}

async function contextOptions(fieldId: string, contextId: string): Promise<KpiFieldOption[]> {
  const res = await asApp().requestJira(route`/rest/api/3/field/${fieldId}/context/${contextId}/option?maxResults=100`);
  if (!res.ok) throw new Error(await jiraError(res, `read the options of ${fieldId}`));
  const body = (await res.json()) as { values?: Array<{ id: string | number; value: string; disabled?: boolean }> };
  return (body.values ?? []).filter((o) => !o.disabled).map((o) => ({ id: String(o.id), value: o.value }));
}

/** A single select's options (its global context), for the direction mapping. */
export async function listKpiFieldOptions(fieldId: string): Promise<KpiFieldOption[]> {
  return contextOptions(fieldId, await globalContextId(fieldId));
}

async function createField(name: string, type: string, searcherKey: string, description: string): Promise<string> {
  const res = await asUser().requestJira(route`/rest/api/3/field`, {
    method: 'POST',
    headers: json,
    body: JSON.stringify({ name, description, type, searcherKey }),
  });
  if (!res.ok) throw new Error(await jiraError(res, `create the "${name}" field`));
  forgetPerInvocation('siteFields');
  return String(((await res.json()) as { id: string }).id);
}

/** The app's own field of that name and kind, if an earlier run created it. */
async function ownField(name: string, kind: 'text' | 'select'): Promise<string | null> {
  return (await listFields()).find((f) => f.name === name && fieldKind(f) === kind)?.id ?? null;
}

/** Make sure the direction select has Increase and Decrease options; returns their ids. */
async function ensureDirectionOptions(fieldId: string): Promise<{ increase: string; decrease: string }> {
  const contextId = await globalContextId(fieldId);
  const options = await contextOptions(fieldId, contextId);
  const find = (value: string) => options.find((o) => o.value.toLowerCase() === value.toLowerCase())?.id;
  const missing = Object.values(KPI_DIRECTION_OPTION_VALUES).filter((v) => !find(v));
  if (missing.length > 0) {
    const res = await asUser().requestJira(route`/rest/api/3/field/${fieldId}/context/${contextId}/option`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ options: missing.map((value) => ({ value, disabled: false })) }),
    });
    if (!res.ok) throw new Error(await jiraError(res, `add the direction options to ${fieldId}`));
    const added = (await res.json()) as { options?: Array<{ id: string | number; value: string }> };
    for (const o of added.options ?? []) options.push({ id: String(o.id), value: o.value });
  }
  const increase = find(KPI_DIRECTION_OPTION_VALUES.increase);
  const decrease = find(KPI_DIRECTION_OPTION_VALUES.decrease);
  if (!increase || !decrease) throw new Error(`Couldn't find the Increase and Decrease options of ${fieldId}.`);
  return { increase, decrease };
}

async function requireFieldKind(fieldId: string, kinds: Array<'text' | 'select'>, role: string): Promise<'text' | 'select'> {
  const field = (await listFields()).find((f) => f.id === fieldId);
  if (!field) throw new Error(`There's no field with id "${fieldId}" on this site.`);
  const kind = fieldKind(field);
  if (!kind || !kinds.includes(kind)) {
    const want = kinds.length > 1 ? 'a short text field or a single select' : 'a short text field';
    throw new Error(`${field.name ?? fieldId} can't hold a KPI's ${role}: pick ${want}.`);
  }
  return kind;
}

/**
 * The unit and direction fields: create the app's `KPI Unit` (short text) and
 * `KPI Direction` (single select: Increase / Decrease), or check and use the
 * admin's picks. Returns both, to be saved together.
 */
export async function ensureKpiFields(input: SetUpKpiFieldsInput): Promise<KpiFieldsConfig> {
  let unitId: string;
  if (input.unit.mode === 'existing') {
    await requireFieldKind(input.unit.fieldId, ['text'], 'unit');
    unitId = input.unit.fieldId;
  } else {
    unitId =
      (await ownField(DEFAULT_KPI_UNIT_FIELD_NAME, 'text')) ??
      (await createField(
        DEFAULT_KPI_UNIT_FIELD_NAME,
        TEXT_FIELD,
        `${CUSTOM}:textsearcher`,
        "A KPI's unit (Measure of Success), e.g. % or users.",
      ));
  }

  let direction: KpiFieldsConfig['direction'];
  const dir = input.direction;
  if (dir.mode === 'create') {
    const fieldId =
      (await ownField(DEFAULT_KPI_DIRECTION_FIELD_NAME, 'select')) ??
      (await createField(
        DEFAULT_KPI_DIRECTION_FIELD_NAME,
        SELECT_FIELD,
        `${CUSTOM}:multiselectsearcher`,
        "Whether a KPI is better when it goes up or down (Measure of Success).",
      ));
    direction = { fieldId, kind: 'select', optionIds: await ensureDirectionOptions(fieldId) };
  } else if (dir.kind === 'text') {
    await requireFieldKind(dir.fieldId, ['text'], 'direction');
    direction = { fieldId: dir.fieldId, kind: 'text' };
  } else {
    await requireFieldKind(dir.fieldId, ['select'], 'direction');
    const options = await listKpiFieldOptions(dir.fieldId);
    for (const optionId of [dir.optionIds.increase, dir.optionIds.decrease]) {
      if (!options.some((o) => o.id === optionId)) throw new Error(`The direction field has no option with id "${optionId}".`);
    }
    direction = { fieldId: dir.fieldId, kind: 'select', optionIds: dir.optionIds };
  }
  if (unitId === direction.fieldId) throw new Error('Unit and direction need two different fields.');
  return { unit: { fieldId: unitId }, direction };
}

// ── A space: work type, field scheme, screens ───────────────────────────────

const fieldIdsOf = (fields: KpiFieldsConfig): string[] => [fields.unit.fieldId, fields.direction.fieldId];

/**
 * Add unit and direction to the space's current field scheme, for the KPI
 * work type only (01 A3/A4/B2): harmless when the scheme is shared, since
 * other work types don't get them. Returns whether anything was (or, with
 * `dryRun`, would be) added.
 */
export async function ensureKpiFieldsInSpace(
  projectId: string,
  workType: KpiWorkTypeRef,
  fields: KpiFieldsConfig,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<boolean> {
  const { schemeId, present } = await readKpiFieldsInScheme(projectId, fields);
  const changes: Record<string, Array<{ schemeIds: number[]; restrictedToWorkTypes: number[] }>> = {};
  for (const fieldId of fieldIdsOf(fields)) {
    const entry = present.find((v) => v.fieldId === fieldId);
    const restricted = (entry?.restrictedToWorkTypes ?? []).map(String);
    // In the scheme for every type (no restriction), or already for the KPI type: nothing to do.
    if (entry && (restricted.length === 0 || restricted.includes(workType.id))) continue;
    // The list replaces the field's types in this scheme, so keep the ones it has.
    changes[fieldId] = [{ schemeIds: [Number(schemeId)], restrictedToWorkTypes: [...restricted, workType.id].map(Number) }];
  }
  if (Object.keys(changes).length === 0) return false;
  if (dryRun) return true;
  await putFieldSchemeAssociations(changes);
  return true;
}

type SchemeEntry = { fieldId: string; restrictedToWorkTypes?: string[] };

/** The space's field scheme and its entries (if any) for the unit and direction fields. */
async function readKpiFieldsInScheme(
  projectId: string,
  fields: KpiFieldsConfig,
): Promise<{ schemeId: string; present: SchemeEntry[] }> {
  const schemeRes = await asApp().requestJira(route`/rest/api/3/config/fieldschemes/projects?projectId=${projectId}`);
  if (!schemeRes.ok) throw new Error(await jiraError(schemeRes, "read the space's field scheme"));
  const schemeId = ((await schemeRes.json()) as { values?: Array<{ projectId?: number | string; schemeId?: number | string }> })
    .values?.find((v) => v.projectId === undefined || String(v.projectId) === projectId)?.schemeId;
  if (schemeId === undefined || schemeId === null) {
    throw new Error("This space doesn't use a field scheme, so the KPI fields can't be added to it.");
  }
  const [unitId, directionId] = fieldIdsOf(fields);
  const listRes = await asApp().requestJira(
    route`/rest/api/3/config/fieldschemes/${String(schemeId)}/fields?fieldId=${unitId}&fieldId=${directionId}&maxResults=50`,
  );
  if (!listRes.ok) throw new Error(await jiraError(listRes, "read the space's field scheme"));
  return { schemeId: String(schemeId), present: ((await listRes.json()) as { values?: SchemeEntry[] }).values ?? [] };
}

async function putFieldSchemeAssociations(
  changes: Record<string, Array<{ schemeIds: number[]; restrictedToWorkTypes: number[] }>>,
): Promise<void> {
  const res = await asUser().requestJira(route`/rest/api/3/config/fieldschemes/fields`, {
    method: 'PUT',
    headers: json,
    body: JSON.stringify(changes),
  });
  if (!res.ok) throw new Error(await jiraError(res, "add the KPI fields to the space's field scheme"));
  const failed = ((await res.json().catch(() => ({}))) as { results?: Array<{ fieldId: string; success: boolean; error?: string }> })
    .results?.filter((r) => !r.success);
  if (failed && failed.length > 0) {
    throw new Error(`Jira didn't add the KPI fields to the field scheme: ${failed.map((f) => f.error ?? f.fieldId).join('; ')}`);
  }
}

/** The screens a space uses for a work type: its work type screen scheme → screen scheme → screens. */
async function kpiScreenIds(projectId: string, workTypeId: string): Promise<string[]> {
  const itssRes = await asApp().requestJira(route`/rest/api/3/issuetypescreenscheme/project?projectId=${projectId}`);
  if (!itssRes.ok) throw new Error(await jiraError(itssRes, "read the space's work type screen scheme"));
  const itss = ((await itssRes.json()) as { values?: Array<{ issueTypeScreenScheme?: { id: string } }> }).values?.[0]
    ?.issueTypeScreenScheme?.id;
  if (!itss) throw new Error("This space has no work type screen scheme (team-managed spaces can't hold KPIs).");
  const mapRes = await asApp().requestJira(
    route`/rest/api/3/issuetypescreenscheme/mapping?issueTypeScreenSchemeId=${itss}&maxResults=100`,
  );
  if (!mapRes.ok) throw new Error(await jiraError(mapRes, "read the space's work type screen scheme"));
  const mappings = ((await mapRes.json()) as { values?: Array<{ issueTypeId: string; screenSchemeId: string }> }).values ?? [];
  const mapping = mappings.find((m) => m.issueTypeId === workTypeId) ?? mappings.find((m) => m.issueTypeId === 'default');
  if (!mapping) throw new Error("The space's work type screen scheme has no screens for the KPI work type.");
  const ssRes = await asApp().requestJira(route`/rest/api/3/screenscheme?id=${mapping.screenSchemeId}`);
  if (!ssRes.ok) throw new Error(await jiraError(ssRes, "read the space's screen scheme"));
  const screens = ((await ssRes.json()) as { values?: Array<{ screens?: Record<string, number | string> }> }).values?.[0]?.screens;
  return [...new Set(Object.values(screens ?? {}).map(String))];
}

/**
 * Add unit and direction to the first tab of every screen the space uses for
 * the KPI work type (01 B5: only for people editing in Jira; the app's writes
 * don't need it). Shared screens are fine: the field scheme hides the fields
 * from other work types. Returns whether anything was (or would be) added.
 */
export async function ensureKpiFieldsOnScreens(
  projectId: string,
  workType: KpiWorkTypeRef,
  fields: KpiFieldsConfig,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<boolean> {
  let changed = false;
  // Adding a field to a screen resets its field scheme entry to every work type
  // (seen live on bitovi-training, 2026-11-24), so note the restrictions first
  // and put them back afterwards.
  const before = dryRun ? null : await readKpiFieldsInScheme(projectId, fields);
  for (const screenId of await kpiScreenIds(projectId, workType.id)) {
    const tabsRes = await asApp().requestJira(route`/rest/api/3/screens/${screenId}/tabs`);
    if (!tabsRes.ok) throw new Error(await jiraError(tabsRes, `read the tabs of screen ${screenId}`));
    const tabs = (await tabsRes.json()) as Array<{ id: number | string }>;
    if (tabs.length === 0) continue;
    const onScreen = new Set<string>();
    for (const tab of tabs) {
      const res = await asApp().requestJira(route`/rest/api/3/screens/${screenId}/tabs/${String(tab.id)}/fields`);
      if (!res.ok) throw new Error(await jiraError(res, `read the fields of screen ${screenId}`));
      for (const f of (await res.json()) as Array<{ id: string }>) onScreen.add(f.id);
    }
    const missing = fieldIdsOf(fields).filter((id) => !onScreen.has(id));
    if (missing.length === 0) continue;
    changed = true;
    if (dryRun) continue;
    for (const fieldId of missing) {
      const res = await asUser().requestJira(route`/rest/api/3/screens/${screenId}/tabs/${String(tabs[0].id)}/fields`, {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ fieldId }),
      });
      if (!res.ok) throw new Error(await jiraError(res, `add ${fieldId} to screen ${screenId}`));
    }
  }
  if (changed && before) {
    const restore: Record<string, Array<{ schemeIds: number[]; restrictedToWorkTypes: number[] }>> = {};
    for (const fieldId of fieldIdsOf(fields)) {
      const entry = before.present.find((v) => v.fieldId === fieldId);
      // An unrestricted field stays unrestricted; one that wasn't in the scheme is for KPIs only.
      const types = entry ? (entry.restrictedToWorkTypes ?? []) : [workType.id];
      if (types.length > 0) restore[fieldId] = [{ schemeIds: [Number(before.schemeId)], restrictedToWorkTypes: types.map(Number) }];
    }
    if (Object.keys(restore).length > 0) await putFieldSchemeAssociations(restore);
  }
  return changed;
}

const message = (e: unknown): string => (e as Error)?.message ?? String(e);

/** Which of the guide's steps a space has done (null = can't tell until the block is chosen). */
export async function kpiSpaceSetupStatus(projectId: string, config: KpiSiteConfig): Promise<KpiSpaceSetupStatus> {
  const project = await findProject(projectId);
  if (!project) throw new Error(`There's no space with id "${projectId}".`);
  const { workType, fields } = config;
  const problems: string[] = [];
  const check = async (run: () => Promise<boolean>): Promise<boolean | null> => {
    try {
      return !(await run());
    } catch (e) {
      problems.push(message(e));
      return null;
    }
  };
  const ready = workType && fields;
  const [inScheme, onScreens] = await Promise.all([
    ready ? check(() => ensureKpiFieldsInSpace(project.id, workType, fields, { dryRun: true })) : null,
    ready ? check(() => ensureKpiFieldsOnScreens(project.id, workType, fields, { dryRun: true })) : null,
  ]);
  return {
    projectId: project.id,
    key: project.key,
    name: project.name,
    workType: workType ? project.issueTypeIds.includes(workType.id) : null,
    fields: inScheme,
    screens: onScreens,
    ...(problems.length > 0 ? { problem: [...new Set(problems)].join(' ') } : {}),
  };
}

/** Do one of the guide's steps for a space (the "Do it for {space}" action). */
export async function applyKpiSpaceStep(projectId: string, step: KpiSpaceStep, config: KpiSiteConfig): Promise<void> {
  const { workType, fields } = config;
  if (!workType) throw new Error('Choose the KPI work type first.');
  if (step === 'workType') {
    await ensureKpiIssueTypeOnProject(projectId, workType);
    return;
  }
  if (!fields) throw new Error('Choose the KPI fields first.');
  if (step === 'fields') await ensureKpiFieldsInSpace(projectId, workType, fields);
  else await ensureKpiFieldsOnScreens(projectId, workType, fields);
}

/**
 * Make a space usable for KPIs: the work type in its scheme, then (once the
 * fields are chosen) the fields in its field scheme and on its screens. The
 * field steps don't stop the rest; their errors come back as warnings.
 */
export async function makeSpaceUsableForKpis(projectId: string, config: KpiSiteConfig): Promise<string[]> {
  const warnings: string[] = [];
  if (!config.workType) return warnings;
  await ensureKpiIssueTypeOnProject(projectId, config.workType);
  if (!config.fields) return warnings;
  try {
    await ensureKpiFieldsInSpace(projectId, config.workType, config.fields);
  } catch (e) {
    warnings.push(`The KPI fields weren't added to the space's field scheme: ${message(e)}`);
  }
  try {
    await ensureKpiFieldsOnScreens(projectId, config.workType, config.fields);
  } catch (e) {
    warnings.push(`The KPI fields weren't added to the space's screens: ${message(e)}`);
  }
  return warnings;
}

/** Company-managed spaces, for the central space and guide pickers (team-managed ones can't hold KPIs). */
export async function listKpiSpaceChoices(workTypeId: string | null): Promise<KpiSpaceChoice[]> {
  const out: KpiSpaceChoice[] = [];
  for (let startAt = 0, page = 0; page < 50; page += 1) {
    const res = await asApp().requestJira(
      route`/rest/api/3/project/search?startAt=${startAt}&maxResults=100&expand=issueTypes&orderBy=name`,
    );
    if (!res.ok) throw new Error(await jiraError(res, 'list spaces'));
    const body = (await res.json()) as {
      values?: Array<{ id: string | number; key: string; name: string; style?: string; issueTypes?: Array<{ id: string | number }> }>;
      isLast?: boolean;
    };
    const values = body.values ?? [];
    for (const p of values) {
      if (p.style && p.style !== 'classic') continue;
      out.push({
        id: String(p.id),
        key: p.key,
        name: p.name,
        hasKpiWorkType: !!workTypeId && (p.issueTypes ?? []).some((t) => String(t.id) === workTypeId),
      });
    }
    if (body.isLast !== false || values.length === 0) break;
    startAt += values.length;
  }
  return out;
}

// ── Settings' view ──────────────────────────────────────────────────────────

/** The configuration, every saved id checked against the site (a deleted field or type shows as broken). */
export async function kpiSetupStatus(): Promise<KpiSetupStatus> {
  const { config, saved } = await loadKpiSiteConfig();
  const direction = config.fields?.direction;
  const [issueTypes, fields, directionOptions, centralProject] = await Promise.all([
    listIssueTypes().catch(() => null),
    config.fields ? listFields().catch(() => null) : Promise.resolve(null),
    direction?.kind === 'select' ? listKpiFieldOptions(direction.fieldId).catch(() => null) : Promise.resolve(null),
    config.centralSpace ? findProject(config.centralSpace.projectId).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  return assessKpiSetup(config, saved, {
    issueTypes,
    fields: fields?.map((f) => ({ id: f.id, name: f.name ?? f.id })) ?? null,
    directionOptions,
    centralProject,
  });
}
