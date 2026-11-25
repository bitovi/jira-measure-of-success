import { useCallback, useEffect, useState } from 'react';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import { useSettingsData, type UseSettings } from '@ui/data/useSettingsData/index.js';
import { useKpiSetupData, type UseKpiSetup } from '@ui/data/useKpiSetupData/index.js';
import type { UseMigrations } from '@ui/data/useMigrationsData/index.js';
import {
  DEFAULT_ROLLUP_METHOD,
  type DateFieldChoice,
  type DateFieldDefaults,
  labelsFor,
  levelKey,
  levelLabel,
  levelSetting,
  resolveConfig,
  type HierarchyLevel,
  type RollupConfig,
  type RollupMethod,
} from '@domain/index.js';
import { DateFieldsTable } from './components/DateFieldsTable/index.js';
import { KpiHierarchyCard } from './components/KpiHierarchyCard/index.js';
import { UpgradeDataCard } from './components/UpgradeDataCard/index.js';
import { KpiBuildingBlocks } from './components/KpiBuildingBlocks/index.js';
import { CentralSpaceCard } from './components/CentralSpaceCard/index.js';
import { OtherSpacesGuide } from './components/OtherSpacesGuide/index.js';

/**
 * KPI Settings (global admin page). From the top: Upgrade data (spec 11 · 04,
 * shown expanded only while a data migration isn't done), the KPI building
 * blocks, the central KPI space and how KPIs nest, the guide for using KPIs in
 * other spaces, then Date Rollup.
 *
 * Date Rollup: two areas: which date fields each
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

export interface SettingsProps {
  useSettings?: UseSettings;
  useKpiSetup?: UseKpiSetup;
  /** Upgrade data; defaults to the real loader inside the card */
  useMigrations?: UseMigrations;
}

export function Settings({ useSettings = useSettingsData, useKpiSetup = useKpiSetupData, useMigrations }: SettingsProps) {
  const {
    levels,
    config,
    dateFields,
    pending,
    error,
    save,
    hierarchy,
    saveHierarchy,
    createHierarchyLinkType,
    reloadHierarchy,
  } = useSettings();
  const kpiSetup = useKpiSetup();
  // A building block change can make a data migration applicable (05's needs the fields).
  const [setupVersion, setSetupVersion] = useState(0);
  const { apply: applySetup } = kpiSetup;
  const apply = useCallback<typeof applySetup>(
    async (change) => {
      const next = await applySetup(change);
      setSetupVersion((v) => v + 1);
      return next;
    },
    [applySetup],
  );
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
        <UpgradeDataCard useMigrations={useMigrations} refreshKey={setupVersion} />
        {kpiSetup.error && (
          <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-3 text-sm text-danger">
            Couldn’t read the KPI configuration: {kpiSetup.error}
          </section>
        )}
        {kpiSetup.setup && (
          <>
            <KpiBuildingBlocks
              setup={kpiSetup.setup}
              api={kpiSetup.api}
              apply={apply}
              onSetUpEverything={() => void reloadHierarchy().catch(() => undefined)}
            />
            <CentralSpaceCard
              setup={kpiSetup.setup}
              api={kpiSetup.api}
              apply={apply}
              onChanged={() => void reloadHierarchy().catch(() => undefined)}
            />
          </>
        )}
        {hierarchy && (
          <KpiHierarchyCard
            // Remount on outside changes (e.g. "Create space" also sets up nesting) so the form resyncs.
            key={`${hierarchy.state}:${hierarchy.linkTypeId}:${hierarchy.parentEnd}`}
            hierarchy={hierarchy}
            onSave={saveHierarchy}
            onCreate={createHierarchyLinkType}
          />
        )}
        {kpiSetup.setup && <OtherSpacesGuide setup={kpiSetup.setup} api={kpiSetup.api} />}

        {/* Date Rollup card. Without the site's levels (the issue-type lookup failed) there's
            nothing to configure, and saving would overwrite the stored settings, so explain
            instead — the KPI space and hierarchy cards above still work. */}
        {levels.length === 0 ? (
          <section className="mt-6 rounded-lg border border-border bg-surface">
            <header className="flex items-center gap-2 border-b border-border px-5 py-3">
              <h2 className="text-base font-semibold">Date Rollup</h2>
            </header>
            <p className="px-5 py-4 text-sm text-text-subtle">
              Couldn’t read this site’s issue types, so date rollup settings can’t be shown. Your saved
              settings are unchanged. Reload the page to try again.
            </p>
          </section>
        ) : (
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
        )}
      </div>
    </div>
  );
}
