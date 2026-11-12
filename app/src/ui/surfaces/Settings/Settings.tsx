import { useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import Spinner from '@atlaskit/spinner';
import Textfield from '@atlaskit/textfield';
import { useSettingsData, type UseSettings } from '@ui/data/useSettingsData/index.js';
import {
  DEFAULT_ROLLUP_METHOD,
  type DateFieldChoice,
  type DateFieldDefaults,
  isValidProjectKey,
  labelsFor,
  levelKey,
  levelLabel,
  levelSetting,
  normalizeProjectKey,
  resolveConfig,
  type HierarchyLevel,
  type KpiSpaceStatus,
  type RollupConfig,
  type RollupMethod,
} from '@domain/index.js';
import { DateFieldsTable } from './components/DateFieldsTable/index.js';
import { KpiHierarchyCard } from './components/KpiHierarchyCard/index.js';

/**
 * Settings — Date Rollup (global admin page). Two areas: which date fields each
 * level reads (ST-5), then one parent-vs-children dropdown per discovered
 * hierarchy level (ST-1/ST-2/ST-3). Levels are read at runtime — nothing is
 * hardcoded — and settings are keyed by hierarchy level, so they apply to every
 * issue type at a level (e.g. Milestone AND Increment). Mock: specs/00-mocks/settings.html.
 *
 * Data comes from an INJECTABLE loader hook (`useSettings`) — see usePanelData.ts.
 */
const DEPTH_CAP_OPTIONS: SelectOption[] = [
  { label: 'No limit (roll up all levels)', value: '' },
  { label: '1 level deep', value: '1' },
  { label: '2 levels deep', value: '2' },
  { label: '3 levels deep', value: '3' },
  { label: '4 levels deep', value: '4' },
];

const METHOD_ORDER: RollupMethod[] = [
  'childrenFirstThenParent',
  'childrenOnly',
  'parentFirstThenChildren',
  'parentOnly',
  'widestRange',
];

type SelectOption = { label: string; value: string };

/** Every level's start/due field ids (by level key), filled in from the site defaults. */
function resolveDateFields(
  stored: RollupConfig['dateFields'],
  levels: HierarchyLevel[],
  defaults: DateFieldDefaults,
): Record<string, DateFieldDefaults> {
  return Object.fromEntries(
    levels.map((level) => {
      const choice = levelSetting(stored, { name: level.name, hierarchyLevel: level.level });
      return [levelKey(level.level), { start: choice?.start ?? defaults.start, due: choice?.due ?? defaults.due }];
    }),
  );
}

/** Only the choices that differ from the defaults are stored, keeping the config sparse. */
function toStoredDateFields(
  fields: Record<string, DateFieldDefaults>,
  defaults: DateFieldDefaults,
): Record<string, DateFieldChoice> {
  const out: Record<string, DateFieldChoice> = {};
  for (const [level, { start, due }] of Object.entries(fields)) {
    const choice: DateFieldChoice = {};
    if (start !== defaults.start) choice.start = start;
    if (due !== defaults.due) choice.due = due;
    if (choice.start || choice.due) out[level] = choice;
  }
  return out;
}

export function Settings({ useSettings = useSettingsData }: { useSettings?: UseSettings }) {
  const {
    levels,
    config,
    dateFields,
    space,
    pending,
    error,
    save,
    saveSpaceKey,
    createSpace,
    hierarchy,
    saveHierarchy,
    createHierarchyLinkType,
  } = useSettings();
  const [methods, setMethods] = useState<Record<string, RollupMethod>>({});
  const [fields, setFields] = useState<Record<string, DateFieldDefaults>>({});
  const [depthCap, setDepthCap] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (levels && config) setMethods(resolveConfig(config, levels));
  }, [levels, config]);

  useEffect(() => {
    if (config) setDepthCap(config.depthCap ?? null);
  }, [config]);

  useEffect(() => {
    if (levels && config && dateFields) {
      setFields(resolveDateFields(config.dateFields, levels, dateFields.defaults));
    }
  }, [levels, config, dateFields]);

  const setLevelFields = (level: string, next: DateFieldDefaults) => {
    setFields((f) => ({ ...f, [level]: next }));
    setSaveState('idle');
  };

  const setMethod = (level: string, method: RollupMethod) => {
    setMethods((m) => ({ ...m, [level]: method }));
    setSaveState('idle');
  };

  const resetDefaults = () => {
    if (levels) setMethods(resolveConfig({ dueDateRollup: {} }, levels));
    if (levels && dateFields) setFields(resolveDateFields({}, levels, dateFields.defaults));
    setDepthCap(null);
    setSaveState('idle');
  };

  const doSave = async () => {
    setSaveState('saving');
    try {
      const next: RollupConfig = {
        dueDateRollup: { ...methods },
        // Without the field list (lookup failed) keep whatever was stored.
        dateFields: dateFields ? toStoredDateFields(fields, dateFields.defaults) : config?.dateFields,
        depthCap,
      };
      await save(next);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  if (error) return <div className="p-6 text-danger">Failed to load settings: {error}</div>;
  if (pending || !levels) return <div className="p-6 text-text-subtle">Loading settings…</div>;

  return (
    <div className="min-h-screen text-text">
      <header className="border-b border-border">
        <h1 className="mx-auto max-w-3xl px-6 py-4 text-xl font-semibold">KPI Settings</h1>
      </header>
      <div className="mx-auto max-w-3xl p-6">
        {space && <KpiSpaceCard space={space} onSaveKey={saveSpaceKey} onCreate={createSpace} />}
        {hierarchy && (
          <KpiHierarchyCard
            // Remount on outside changes (e.g. "Create space" also sets up nesting) so the form resyncs.
            key={`${hierarchy.state}:${hierarchy.linkTypeId}:${hierarchy.parentEnd}`}
            hierarchy={hierarchy}
            onSave={saveHierarchy}
            onCreate={createHierarchyLinkType}
          />
        )}

        {/* Date Rollup card */}
        <section className="mt-6 rounded-lg border border-border bg-surface">
          <header className="flex items-center gap-2 border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">Date Rollup</h2>
          </header>
          <div className="px-5 py-4">
            <p className="mb-4 text-sm text-text-subtle">
              Levels are read at runtime from the site's issue-type configuration — nothing is
              hard-coded.
            </p>

            {/* Which fields hold each level's own dates */}
            {dateFields && (
              <div className="mb-6 border-b border-border pb-6">
                <h3 className="text-sm font-medium">Date fields</h3>
                <p className="mb-3 mt-0.5 text-sm text-text-subtle">
                  Which Jira fields hold each level's start and end dates.
                </p>
                <DateFieldsTable
                  levels={levels}
                  fields={dateFields.fields}
                  value={fields}
                  onChange={setLevelFields}
                />
              </div>
            )}

            {/* Whose dates win between a parent and its children */}
            <h3 className="text-sm font-medium">Parent vs. children</h3>
            <p className="mb-2 mt-0.5 text-sm text-text-subtle">
              Which dates are prioritized between a parent and its children?
            </p>
            <div className="flex flex-col gap-2">
              <div className="py-2 text-sm font-medium">{levelLabel(levels[0])}</div>
              {levels.slice(0, -1).map((lvl, i) => {
                const level = levelKey(lvl.level);
                const child = levels[i + 1];
                const labels = labelsFor(lvl.name, child.name);
                return (
                  <div key={level} className="flex flex-row" style={{ paddingLeft: i * 32 }}>
                    <div className="mb-4 w-6 flex-none rounded-bl-lg border-b-2 border-l-2 border-border">
                      &nbsp;
                    </div>
                    <div className="flex w-full flex-col">
                      <Select<SelectOption>
                        aria-label={`Due date rollup for ${levelLabel(lvl)} and ${levelLabel(child)}`}
                        options={METHOD_ORDER.map((m) => ({ label: labels[m], value: m }))}
                        value={{
                          label: labels[methods[level] ?? DEFAULT_ROLLUP_METHOD],
                          value: methods[level] ?? DEFAULT_ROLLUP_METHOD,
                        }}
                        onChange={(o) => o && setMethod(level, o.value as RollupMethod)}
                        isSearchable={false}
                      />
                      <div className="p-2 pt-4 text-sm font-medium">{levelLabel(child)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rollup depth cap (Feature 03, FR-19) */}
            <div className="mt-6 border-t border-border pt-4">
              <label className="text-sm font-medium" htmlFor="rollup-depth-cap">
                Rollup depth limit
              </label>
              <p className="mb-2 mt-0.5 text-sm text-text-subtle">
                How many levels below an issue due-date rollup may descend. Lower is faster on large
                hierarchies; unlimited is most accurate.{' '}
                <span className="text-text">Recommended: cap on large sites.</span>
              </p>
              <div className="sm:w-72">
                <Select<SelectOption>
                  inputId="rollup-depth-cap"
                  options={DEPTH_CAP_OPTIONS}
                  value={DEPTH_CAP_OPTIONS.find((o) => o.value === (depthCap === null ? '' : String(depthCap)))}
                  onChange={(o) => {
                    if (!o) return;
                    setDepthCap(o.value === '' ? null : Number(o.value));
                    setSaveState('idle');
                  }}
                  isSearchable={false}
                />
              </div>
            </div>
          </div>
          <footer className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            {saveState === 'saved' && <span className="text-sm text-success">Saved.</span>}
            {saveState === 'error' && <span className="text-sm text-danger">Save failed.</span>}
            <Button onClick={resetDefaults}>Reset to defaults</Button>
            <Button appearance="primary" onClick={doSave} isDisabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : 'Save settings'}
            </Button>
          </footer>
        </section>
      </div>
    </div>
  );
}

const SPACE_BADGE: Record<
  KpiSpaceStatus['state'],
  { label: string; appearance: 'default' | 'removed' | 'moved' | 'success' }
> = {
  unset: { label: 'Not set', appearance: 'default' },
  missing: { label: 'Not created', appearance: 'removed' },
  misconfigured: { label: 'Needs setup', appearance: 'moved' },
  ready: { label: 'Connected', appearance: 'success' },
};

/**
 * KPI Space provisioning (storage-model.md). An admin picks a Jira project key;
 * the app creates the KPI project (or records the key to connect an existing
 * one). KPIs then live as issues in that project.
 */
function KpiSpaceCard({
  space,
  onSaveKey,
  onCreate,
}: {
  space: KpiSpaceStatus;
  onSaveKey: (key: string) => Promise<KpiSpaceStatus>;
  onCreate: (key: string) => Promise<KpiSpaceStatus>;
}) {
  const [key, setKey] = useState(space.key ?? 'KPI');
  const [busy, setBusy] = useState<'create' | 'save' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const badge = SPACE_BADGE[space.state];
  const valid = isValidProjectKey(key);

  const run = async (which: 'create' | 'save') => {
    setBusy(which);
    setErr(null);
    try {
      await (which === 'create' ? onCreate(key) : onSaveKey(key));
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">KPI Space</h2>
        <Lozenge appearance={badge.appearance}>{badge.label}</Lozenge>
      </header>
      <div className="px-5 py-4">
        {space.state === 'ready' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="grid h-6 w-6 flex-none place-items-center rounded bg-brand text-[11px] font-bold text-white">
              {key.charAt(0)}
            </span>
            <span className="font-medium text-text">{space.name}</span>
            <span className="text-text-subtle">
              KPIs are created as work items in the space{' '}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-text">{space.key}</code>.
            </span>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-text-subtle">
              KPIs are stored as issues in a dedicated Jira project so they can span every project and
              be read/written over standard Jira REST. Choose the project key for that space.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium">Project key</span>
                <Textfield
                  width="small"
                  isCompact
                  value={key}
                  onChange={(e) => {
                    setKey(normalizeProjectKey(e.currentTarget.value));
                    setErr(null);
                  }}
                  placeholder="KPI"
                  aria-label="Project key"
                />
              </label>
              <Button
                appearance="primary"
                onClick={() => run('create')}
                isDisabled={!valid || busy !== null}
                isLoading={busy === 'create'}
              >
                {busy === 'create' ? 'Creating…' : 'Create space'}
              </Button>
              <Button
                onClick={() => run('save')}
                isDisabled={!valid || busy !== null}
                isLoading={busy === 'save'}
              >
                {busy === 'save' ? 'Saving…' : 'Save key'}
              </Button>
              {!valid && <span className="text-xs text-danger">2–10 letters/digits, starts with a letter.</span>}
              {space.state === 'missing' && valid && busy === null && (
                <span className="text-xs text-text-subtle">
                  No project <strong className="text-text">{space.key}</strong> yet — create it or connect an existing one.
                </span>
              )}
              {space.state === 'misconfigured' && busy === null && (
                <span className="text-xs text-text-subtle">
                  Project <strong className="text-text">{space.key}</strong> exists but is missing the{' '}
                  <strong className="text-text">KPI</strong> issue type — click{' '}
                  <strong className="text-text">Create space</strong> to finish setup.
                </span>
              )}
            </div>
            {busy === 'create' && (
              <p className="mt-3 flex items-center gap-2 text-xs text-text-subtle">
                <Spinner size="small" label="Creating project" />
                Creating the project and configuring the KPI work-item type — this can take up to a
                minute. Please keep this page open.
              </p>
            )}
          </>
        )}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>
    </section>
  );
}
