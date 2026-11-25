import {
  assessKpiSetup,
  DEFAULT_KPI_DIRECTION_FIELD_NAME,
  DEFAULT_KPI_UNIT_FIELD_NAME,
  DEFAULT_KPI_WORK_TYPE_NAME,
  isValidProjectKey,
  normalizeProjectKey,
  type KpiFieldChoice,
  type KpiFieldOption,
  type KpiFieldsConfig,
  type KpiSetupStatus,
  type KpiSiteConfig,
  type KpiSpaceChoice,
  type KpiSpaceSetupStatus,
  type KpiSpaceStep,
  type KpiWorkTypeChoice,
  type SetUpCentralSpaceInput,
  type SetUpKpiFieldsInput,
  type SetUpKpiSpaceStepInput,
  type SetUpKpiWorkTypeInput,
} from '@domain/index.js';

/**
 * An in-memory site for Settings' KPI building blocks (spec 11 · 04): work
 * types, fields, spaces and what each space has set up. The harness serves it
 * through the mock bridge (`?setup=fresh|upgraded|blocks|configured|broken`);
 * stories create their own. Methods are async like the bridge.
 */
export type KpiSetupScenario = 'fresh' | 'upgraded' | 'blocks' | 'configured' | 'broken';

export function kpiSetupScenario(search: string = globalThis.location?.search ?? ''): KpiSetupScenario {
  const s = new URLSearchParams(search).get('setup');
  return s === 'fresh' || s === 'blocks' || s === 'configured' || s === 'broken' ? s : 'upgraded';
}

const ICON = (color: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" rx="3" fill="${color}"/></svg>`,
  )}`;
const KPI_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none"><circle cx="8" cy="8" r="6.75" stroke="#C9372C" stroke-width="1.5"/><circle cx="8" cy="8" r="3.75" stroke="#C9372C" stroke-width="1.5"/><circle cx="8" cy="8" r="1.25" fill="#C9372C"/></svg>',
)}`;

interface SimType {
  id: string;
  name: string;
  iconUrl: string;
  standard: boolean;
}
interface SimField {
  id: string;
  name: string;
  kind: 'text' | 'select' | 'other';
  options?: KpiFieldOption[];
}
interface SimSpace {
  id: string;
  key: string;
  name: string;
  teamManaged?: boolean;
  /** work type ids in its scheme */
  types: string[];
  /** field ids in its field scheme for the KPI type, and on its screens */
  schemeFields: string[];
  screenFields: string[];
}

export interface KpiSetupSim {
  getKpiSetup(): Promise<KpiSetupStatus>;
  getKpiWorkTypeChoices(): Promise<KpiWorkTypeChoice[]>;
  getKpiFieldChoices(): Promise<KpiFieldChoice[]>;
  getKpiFieldOptions(fieldId: string): Promise<KpiFieldOption[]>;
  getKpiSpaceChoices(): Promise<KpiSpaceChoice[]>;
  getKpiSpaceSetup(projectId: string): Promise<KpiSpaceSetupStatus>;
  setUpKpiWorkType(input: SetUpKpiWorkTypeInput): Promise<KpiSetupStatus>;
  setUpKpiFields(input: SetUpKpiFieldsInput): Promise<KpiSetupStatus>;
  setUpCentralSpace(input: SetUpCentralSpaceInput): Promise<KpiSetupStatus>;
  setUpKpiSpaceStep(input: SetUpKpiSpaceStepInput): Promise<KpiSpaceSetupStatus>;
  setUpEverything(input?: { key?: string }): Promise<KpiSetupStatus>;
  /** the current configuration (harness wiring: migrations, hierarchy) */
  config(): KpiSiteConfig;
}

export interface KpiSetupSimOptions {
  /** called when a central space is set up, so the harness can set up KPI nesting as the backend does */
  onCentralSpace?: () => void;
  /** reject every write with this message (error states) */
  failWrites?: string;
}

export function createKpiSetupSim(scenario: KpiSetupScenario = 'upgraded', options: KpiSetupSimOptions = {}): KpiSetupSim {
  const types: SimType[] = [
    { id: '10001', name: 'Epic', iconUrl: ICON('#904EE2'), standard: false },
    { id: '10002', name: 'Story', iconUrl: ICON('#63BA3C'), standard: true },
    { id: '10003', name: 'Task', iconUrl: ICON('#4BADE8'), standard: true },
    { id: '10004', name: 'Bug', iconUrl: ICON('#E5493A'), standard: true },
    { id: '10005', name: 'Sub-task', iconUrl: ICON('#4BADE8'), standard: false },
    { id: '10020', name: 'Metric', iconUrl: ICON('#FFAB00'), standard: true },
  ];
  const fields: SimField[] = [
    { id: 'customfield_10100', name: 'Unit', kind: 'text' },
    { id: 'customfield_10101', name: 'Metric unit', kind: 'text' },
    {
      id: 'customfield_10102',
      name: 'Polarity',
      kind: 'select',
      options: [
        { id: '10300', value: 'Up' },
        { id: '10301', value: 'Down' },
      ],
    },
    {
      id: 'customfield_10103',
      name: 'Team',
      kind: 'select',
      options: [
        { id: '10310', value: 'Web' },
        { id: '10311', value: 'Mobile' },
      ],
    },
    { id: 'customfield_10104', name: 'Story points', kind: 'other' },
  ];
  const spaces: SimSpace[] = [
    { id: '10900', key: 'KPI', name: 'KPIs (KPI)', types: [], schemeFields: [], screenFields: [] },
    { id: '10910', key: 'ECOM', name: 'E-commerce', types: ['10001', '10002'], schemeFields: [], screenFields: [] },
    { id: '10920', key: 'MOBILE', name: 'Mobile app', types: ['10002', '10004'], schemeFields: [], screenFields: [] },
    { id: '10930', key: 'PLAT', name: 'Platform', types: ['10002', '10003'], schemeFields: [], screenFields: [] },
    { id: '10940', key: 'DESIGN', name: 'Design (team-managed)', teamManaged: true, types: [], schemeFields: [], screenFields: [] },
  ];
  let nextId = 11_000;
  const id = () => String(nextId++);
  const config: KpiSiteConfig = { workType: null, fields: null, centralSpace: null, hierarchy: null, schemes: {} };
  let saved = false;

  const createWorkType = (): { id: string; name: string } => {
    const found = types.find((t) => t.name === DEFAULT_KPI_WORK_TYPE_NAME);
    if (found) return { id: found.id, name: found.name };
    const t = { id: id(), name: DEFAULT_KPI_WORK_TYPE_NAME, iconUrl: KPI_ICON, standard: true };
    types.push(t);
    return { id: t.id, name: t.name };
  };
  const createField = (name: string, kind: 'text' | 'select'): SimField => {
    const found = fields.find((f) => f.name === name && f.kind === kind);
    if (found) return found;
    const f: SimField = { id: `customfield_${id()}`, name, kind };
    if (kind === 'select') f.options = [{ id: id(), value: 'Increase' }, { id: id(), value: 'Decrease' }];
    fields.push(f);
    return f;
  };
  const createDefaultFields = (): KpiFieldsConfig => {
    const unit = createField(DEFAULT_KPI_UNIT_FIELD_NAME, 'text');
    const dir = createField(DEFAULT_KPI_DIRECTION_FIELD_NAME, 'select');
    return {
      unit: { fieldId: unit.id },
      direction: { fieldId: dir.id, kind: 'select', optionIds: { increase: dir.options![0].id, decrease: dir.options![1].id } },
    };
  };
  const space = (projectId: string): SimSpace => {
    const s = spaces.find((x) => x.id === projectId);
    if (!s) throw new Error(`There's no space with id "${projectId}".`);
    return s;
  };
  const kpiFieldIds = (): string[] => (config.fields ? [config.fields.unit.fieldId, config.fields.direction.fieldId] : []);
  const doStep = (s: SimSpace, step: KpiSpaceStep) => {
    if (s.teamManaged) {
      throw new Error('No issue-type scheme found for this project. Team-managed projects cannot hold KPIs — use a company-managed project.');
    }
    if (!config.workType) throw new Error('Choose the KPI work type first.');
    if (step === 'workType') {
      if (!s.types.includes(config.workType.id)) s.types.push(config.workType.id);
      return;
    }
    if (!config.fields) throw new Error('Choose the KPI fields first.');
    const list = step === 'fields' ? s.schemeFields : s.screenFields;
    for (const f of kpiFieldIds()) if (!list.includes(f)) list.push(f);
  };
  const makeUsable = (s: SimSpace) => {
    if (!config.workType) return;
    doStep(s, 'workType');
    if (!config.fields) return;
    doStep(s, 'fields');
    doStep(s, 'screens');
  };

  // ── scenarios ──
  const kpiSpace = spaces[0];
  if (scenario !== 'fresh') {
    const kpiType = createWorkType();
    config.workType = kpiType;
  }
  if (scenario === 'upgraded') {
    kpiSpace.types.push(config.workType!.id);
    config.centralSpace = { projectId: kpiSpace.id, key: kpiSpace.key, name: kpiSpace.name };
  }
  if (scenario === 'blocks' || scenario === 'configured' || scenario === 'broken') {
    config.fields = createDefaultFields();
    saved = true;
  }
  if (scenario === 'configured' || scenario === 'broken') {
    config.centralSpace = { projectId: kpiSpace.id, key: kpiSpace.key, name: kpiSpace.name };
    makeUsable(kpiSpace);
    makeUsable(spaces[1]);
  }
  if (scenario === 'broken') {
    // Someone deleted the direction field in Jira.
    const dirId = config.fields!.direction.fieldId;
    fields.splice(
      fields.findIndex((f) => f.id === dirId),
      1,
    );
  }
  // A fresh site has no KPI space yet.
  if (scenario === 'fresh') spaces.shift();

  const status = (): KpiSetupStatus => {
    const dir = config.fields?.direction;
    const central = config.centralSpace ? spaces.find((s) => s.id === config.centralSpace!.projectId) : undefined;
    return assessKpiSetup(config, saved, {
      issueTypes: types,
      fields: fields.map((f) => ({ id: f.id, name: f.name })),
      directionOptions: dir?.kind === 'select' ? (fields.find((f) => f.id === dir.fieldId)?.options ?? null) : null,
      centralProject: config.centralSpace
        ? central
          ? { id: central.id, key: central.key, name: central.name, issueTypeIds: central.types }
          : null
        : undefined,
    });
  };
  const spaceStatus = (s: SimSpace): KpiSpaceSetupStatus => {
    const ready = !!config.workType && !!config.fields;
    const ids = kpiFieldIds();
    return {
      projectId: s.id,
      key: s.key,
      name: s.name,
      workType: config.workType ? s.types.includes(config.workType.id) : null,
      fields: ready && !s.teamManaged ? ids.every((f) => s.schemeFields.includes(f)) : null,
      screens: ready && !s.teamManaged ? ids.every((f) => s.screenFields.includes(f)) : null,
      ...(s.teamManaged ? { problem: "This space doesn't use a field scheme, so the KPI fields can't be added to it." } : {}),
    };
  };
  const write = <T>(fn: () => T): Promise<T> => {
    if (options.failWrites) return Promise.reject(new Error(options.failWrites));
    try {
      return Promise.resolve(fn());
    } catch (e) {
      return Promise.reject(e);
    }
  };

  const setUpCentralSpace = (input: SetUpCentralSpaceInput) => {
    let s: SimSpace;
    if (input.mode === 'existing') s = space(input.projectId);
    else {
      const key = normalizeProjectKey(input.key);
      if (!isValidProjectKey(key)) throw new Error(`Invalid project key: "${key}"`);
      s = spaces.find((x) => x.key === key) ?? { id: id(), key, name: `KPIs (${key})`, types: [], schemeFields: [], screenFields: [] };
      if (!spaces.includes(s)) spaces.push(s);
    }
    if (s.teamManaged) throw new Error("A team-managed space can't hold KPIs: pick a company-managed one.");
    if (!config.workType) config.workType = createWorkType();
    config.centralSpace = { projectId: s.id, key: s.key, name: s.name };
    saved = true;
    makeUsable(s);
    options.onCentralSpace?.();
  };
  const syncCentral = () => {
    if (config.centralSpace) makeUsable(space(config.centralSpace.projectId));
  };

  return {
    config: () => structuredClone(config),
    getKpiSetup: async () => status(),
    getKpiWorkTypeChoices: async () =>
      types
        .filter((t) => t.standard)
        .map((t) => ({ id: t.id, name: t.name, iconUrl: t.iconUrl }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    getKpiFieldChoices: async () =>
      fields
        .filter((f): f is SimField & { kind: 'text' | 'select' } => f.kind !== 'other')
        .map((f) => ({ id: f.id, name: f.name, kind: f.kind }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    getKpiFieldOptions: async (fieldId) => structuredClone(fields.find((f) => f.id === fieldId)?.options ?? []),
    getKpiSpaceChoices: async () =>
      spaces
        .filter((s) => !s.teamManaged)
        .map((s) => ({ id: s.id, key: s.key, name: s.name, hasKpiWorkType: !!config.workType && s.types.includes(config.workType.id) })),
    getKpiSpaceSetup: async (projectId) => spaceStatus(space(projectId)),
    setUpKpiWorkType: (input) =>
      write(() => {
        if (input.mode === 'existing') {
          const t = types.find((x) => x.id === input.id);
          if (!t) throw new Error(`There's no work type with id "${input.id}" on this site.`);
          config.workType = { id: t.id, name: t.name };
        } else config.workType = createWorkType();
        saved = true;
        syncCentral();
        return status();
      }),
    setUpKpiFields: (input) =>
      write(() => {
        const unitId = input.unit.mode === 'create' ? createField(DEFAULT_KPI_UNIT_FIELD_NAME, 'text').id : input.unit.fieldId;
        let direction: KpiFieldsConfig['direction'];
        if (input.direction.mode === 'create') direction = createDefaultFields().direction;
        else if (input.direction.kind === 'text') direction = { fieldId: input.direction.fieldId, kind: 'text' };
        else direction = { fieldId: input.direction.fieldId, kind: 'select', optionIds: input.direction.optionIds };
        if (unitId === direction.fieldId) throw new Error('Unit and direction need two different fields.');
        config.fields = { unit: { fieldId: unitId }, direction };
        saved = true;
        syncCentral();
        return status();
      }),
    setUpCentralSpace: (input) =>
      write(() => {
        setUpCentralSpace(input);
        return status();
      }),
    setUpKpiSpaceStep: ({ projectId, step }) =>
      write(() => {
        const s = space(projectId);
        doStep(s, step);
        return spaceStatus(s);
      }),
    setUpEverything: (input) =>
      write(() => {
        if (!config.workType) config.workType = createWorkType();
        if (!config.fields) config.fields = createDefaultFields();
        saved = true;
        if (config.centralSpace) syncCentral();
        else setUpCentralSpace({ mode: 'create', key: input?.key ?? 'KPI' });
        return status();
      }),
  };
}
