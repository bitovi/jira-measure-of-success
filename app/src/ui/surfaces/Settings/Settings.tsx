import { useEffect, useState } from 'react';
import { useSettingsData, type UseSettings } from '@ui/data/useSettingsData/index.js';
import {
  DEFAULT_ROLLUP_METHOD,
  isValidProjectKey,
  labelsFor,
  leafLabel,
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

function itypeLetter(name: string): string {
  return name.charAt(0).toUpperCase();
}

export function Settings({ useSettings = useSettingsData }: { useSettings?: UseSettings }) {
  const { levels, config, space, pending, error, save, saveSpaceKey, createSpace } = useSettings();
  const [methods, setMethods] = useState<Record<string, RollupMethod>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (levels && config) setMethods(resolveConfig(config, levels));
  }, [levels, config]);

  const leaf = levels ? levels[levels.length - 1] : undefined;

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
    <div className="mx-auto max-w-3xl p-6 text-text">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-subtle">
        App-level configuration. These choices decide how an issue's{' '}
        <strong className="text-text">effective due date</strong> is computed, which anchors any KPI
        target date set <em>relative</em> to the due date.
      </p>

      {space && <KpiSpaceCard space={space} onSaveKey={saveSpaceKey} onCreate={createSpace} />}

      {/* Due Date Rollup card */}
      <section className="mt-6 rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Due Date Rollup</h2>
          <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-text-subtle">
            per hierarchy level
          </span>
        </header>
        <div className="px-5 py-4">
          <p className="mb-4 text-sm text-text-subtle">
            Which dates are prioritized between a parent and its children? Levels are read at runtime
            from the site's issue-type configuration — nothing is hard-coded.
          </p>

          {levels.map((level, i) => {
            const isLeaf = level === leaf;
            const child = levels[i + 1];
            const labels = child ? labelsFor(level, child) : null;
            return (
              <div
                key={level}
                className="flex flex-wrap items-center gap-3 py-2"
                style={{ paddingLeft: i * 24 }}
              >
                <div className="flex w-44 flex-none items-center gap-2 text-sm font-medium">
                  <span className="grid h-5 w-5 place-items-center rounded bg-brand text-[11px] font-bold text-white">
                    {itypeLetter(level)}
                  </span>
                  {level}
                </div>
                <select
                  className="min-w-[22rem] flex-1 rounded border border-border bg-surface px-2 py-1.5 text-sm disabled:bg-surface-sunken disabled:text-text-subtle"
                  value={isLeaf ? 'parentOnly' : methods[level] ?? DEFAULT_ROLLUP_METHOD}
                  disabled={isLeaf}
                  onChange={(e) => setMethod(level, e.target.value as RollupMethod)}
                >
                  {isLeaf || !labels ? (
                    <option value="parentOnly">{leafLabel(level)}</option>
                  ) : (
                    METHOD_ORDER.map((m) => (
                      <option key={m} value={m}>
                        {labels[m]}
                      </option>
                    ))
                  )}
                </select>
                <span className="text-xs text-text-subtle">
                  {isLeaf ? 'no children to roll up' : `rolls up from ${child}`}
                </span>
              </div>
            );
          })}

          <div className="mt-4 flex gap-2 rounded bg-surface-sunken p-3 text-xs text-text-subtle">
            <span className="grid h-4 w-4 flex-none place-items-center rounded-full bg-brand text-[10px] text-white">
              i
            </span>
            <span>
              <strong className="text-text">How each rule resolves a due date</strong> (bottom-up,
              memoized): <strong>From children</strong> — always use the merged child dates;{' '}
              <strong>From children, then parent</strong> — children if any, else own date;{' '}
              <strong>From parent, then children</strong> — own date wins, children fill gaps;{' '}
              <strong>From parent only</strong> — never roll up; <strong>Earliest → latest</strong> —
              the widest range across parent and children.
            </span>
          </div>
        </div>
      </section>

      <div className="mt-4 flex items-center justify-end gap-3">
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
      </div>
    </div>
  );
}

const SPACE_BADGE: Record<KpiSpaceStatus['state'], { label: string; cls: string }> = {
  unset: { label: 'Not set', cls: 'bg-surface-sunken text-text-subtle' },
  missing: { label: 'Not created', cls: 'bg-surface-sunken text-danger' },
  ready: { label: 'Connected', cls: 'bg-surface-sunken text-success' },
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
        <span className={`rounded px-2 py-0.5 text-xs ${badge.cls}`}>{badge.label}</span>
      </header>
      <div className="px-5 py-4">
        <p className="mb-4 text-sm text-text-subtle">
          KPIs are stored as issues in a dedicated Jira project so they can span every project and
          be read/written over standard Jira REST. Choose the project key for that space.
        </p>

        {space.state === 'ready' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="grid h-6 w-6 flex-none place-items-center rounded bg-brand text-[11px] font-bold text-white">
              {key.charAt(0)}
            </span>
            <span className="font-medium text-text">{space.name}</span>
            <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-text-subtle">
              {space.key}
            </span>
            <span className="text-xs text-text-subtle">KPIs live here.</span>
          </div>
        ) : (
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
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
              onClick={() => run('create')}
              disabled={!valid || busy !== null}
            >
              {busy === 'create' ? 'Creating…' : 'Create space'}
            </button>
            <button
              className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-sunken disabled:opacity-60"
              onClick={() => run('save')}
              disabled={!valid || busy !== null}
            >
              {busy === 'save' ? 'Saving…' : 'Save key'}
            </button>
            {!valid && <span className="text-xs text-danger">2–10 letters/digits, starts with a letter.</span>}
            {space.state === 'missing' && valid && (
              <span className="text-xs text-text-subtle">
                No project <strong className="text-text">{space.key}</strong> yet — create it or connect an existing one.
              </span>
            )}
          </div>
        )}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>
    </section>
  );
}
