import { useEffect, useState } from 'react';
import { useSettingsData, type UseSettings } from '@ui/data/useSettingsData/index.js';
import {
  DEFAULT_ROLLUP_METHOD,
  isValidProjectKey,
  labelsFor,
  normalizeProjectKey,
  resolveConfig,
  type KpiSpaceStatus,
  type RollupConfig,
  type RollupMethod,
} from '@domain/index.js';

/**
 * Settings — Due Date Rollup (global admin page). One dropdown per discovered
 * hierarchy level (ST-1/ST-2/ST-3). Level names are read at runtime — nothing is
 * hardcoded. Mock: specs/00-mocks/settings.html.
 *
 * Data comes from an INJECTABLE loader hook (`useSettings`) — see usePanelData.ts.
 */
const METHOD_ORDER: RollupMethod[] = [
  'childrenFirstThenParent',
  'childrenOnly',
  'parentFirstThenChildren',
  'parentOnly',
  'widestRange',
];

export function Settings({ useSettings = useSettingsData }: { useSettings?: UseSettings }) {
  const { levels, config, space, pending, error, save, saveSpaceKey, createSpace } = useSettings();
  const [methods, setMethods] = useState<Record<string, RollupMethod>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (levels && config) setMethods(resolveConfig(config, levels));
  }, [levels, config]);

  const setMethod = (level: string, method: RollupMethod) => {
    setMethods((m) => ({ ...m, [level]: method }));
    setSaveState('idle');
  };

  const resetDefaults = () => {
    if (levels) setMethods(resolveConfig({ dueDateRollup: {} }, levels));
    setSaveState('idle');
  };

  const doSave = async () => {
    setSaveState('saving');
    try {
      const next: RollupConfig = { dueDateRollup: { ...methods } };
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

        {/* Due Date Rollup card */}
        <section className="mt-6 rounded-lg border border-border bg-surface">
          <header className="flex items-center gap-2 border-b border-border px-5 py-3">
            <h2 className="text-base font-semibold">Due Date Rollup</h2>
          </header>
          <div className="px-5 py-4">
            <p className="mb-4 text-sm text-text-subtle">
              Which dates are prioritized between a parent and its children? Levels are read at
              runtime from the site's issue-type configuration — nothing is hard-coded.
            </p>

            <div className="flex flex-col gap-2">
              <div className="py-2 text-sm font-medium">{levels[0]}</div>
              {levels.slice(0, -1).map((level, i) => {
                const child = levels[i + 1];
                const labels = labelsFor(level, child);
                return (
                  <div key={level} className="flex flex-row" style={{ paddingLeft: i * 32 }}>
                    <div className="mb-4 w-6 flex-none rounded-bl-lg border-b-2 border-l-2 border-border">
                      &nbsp;
                    </div>
                    <div className="flex w-full flex-col">
                      <select
                        className="w-full rounded border border-border bg-surface px-2 py-1.5 text-sm"
                        value={methods[level] ?? DEFAULT_ROLLUP_METHOD}
                        onChange={(e) => setMethod(level, e.target.value as RollupMethod)}
                      >
                        {METHOD_ORDER.map((m) => (
                          <option key={m} value={m}>
                            {labels[m]}
                          </option>
                        ))}
                      </select>
                      <div className="p-2 pt-4 text-sm font-medium">{child}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <footer className="flex items-center justify-end gap-3 border-t border-border px-5 py-3">
            {saveState === 'saved' && <span className="text-sm text-success">Saved.</span>}
            {saveState === 'error' && <span className="text-sm text-danger">Save failed.</span>}
            <button
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-sunken"
              onClick={resetDefaults}
            >
              Reset to defaults
            </button>
            <button
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              onClick={doSave}
              disabled={saveState === 'saving'}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save settings'}
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

const SPACE_BADGE: Record<KpiSpaceStatus['state'], { label: string; cls: string }> = {
  unset: { label: 'Not set', cls: 'bg-surface-sunken text-text-subtle' },
  missing: { label: 'Not created', cls: 'bg-surface-sunken text-danger' },
  misconfigured: { label: 'Needs setup', cls: 'bg-surface-sunken text-danger' },
  ready: { label: 'Connected', cls: 'bg-surface-sunken text-success' },
};

/** Inline loading spinner for in-progress provisioning actions. */
function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" className="opacity-25" />
      <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

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
        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
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
                <input
                  className="w-40 rounded border border-border bg-surface px-2 py-1.5 text-sm uppercase tracking-wide"
                  value={key}
                  onChange={(e) => {
                    setKey(normalizeProjectKey(e.target.value));
                    setErr(null);
                  }}
                  placeholder="KPI"
                  aria-label="Project key"
                />
              </label>
              <button
                className="inline-flex items-center gap-1.5 rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                onClick={() => run('create')}
                disabled={!valid || busy !== null}
              >
                {busy === 'create' && <Spinner />}
                {busy === 'create' ? 'Creating…' : 'Create space'}
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-sunken disabled:opacity-60"
                onClick={() => run('save')}
                disabled={!valid || busy !== null}
              >
                {busy === 'save' && <Spinner />}
                {busy === 'save' ? 'Saving…' : 'Save key'}
              </button>
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
                <Spinner />
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
