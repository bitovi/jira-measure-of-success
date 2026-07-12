import { useEffect, useMemo, useState } from 'react';
import { call } from '@ui/bridge.js';
import {
  DEFAULT_ROLLUP_METHOD,
  labelsFor,
  leafLabel,
  resolveConfig,
  type PreviewRowDto,
  type RollupConfig,
  type RollupMethod,
} from '@domain/index.js';

/**
 * Settings — Due Date Rollup (global admin page). One dropdown per discovered
 * hierarchy level (ST-1/ST-2/ST-3) plus a read-only relative-target-date preview
 * (ST-4). Level names are read at runtime — nothing is hardcoded. Mock:
 * specs/00-mocks/settings.html.
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

export function Settings() {
  const [levels, setLevels] = useState<string[] | null>(null);
  const [methods, setMethods] = useState<Record<string, RollupMethod>>({});
  const [preview, setPreview] = useState<PreviewRowDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [lv, cfg, pv] = await Promise.all([
          call<string[]>('getHierarchyLevels'),
          call<RollupConfig>('getRollupConfig'),
          call<PreviewRowDto[]>('getSettingsPreview'),
        ]);
        if (!alive) return;
        setLevels(lv);
        setMethods(resolveConfig(cfg, lv));
        setPreview(pv);
      } catch (e: unknown) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const leaf = levels ? levels[levels.length - 1] : undefined;

  const setMethod = (level: string, method: RollupMethod) => {
    setMethods((m) => ({ ...m, [level]: method }));
    setSaveState('idle');
  };

  const resetDefaults = () => {
    if (levels) setMethods(resolveConfig({ dueDateRollup: {} }, levels));
    setSaveState('idle');
  };

  const save = async () => {
    setSaveState('saving');
    try {
      const config: RollupConfig = { dueDateRollup: { ...methods } };
      await call('saveRollupConfig', { config });
      const pv = await call<PreviewRowDto[]>('getSettingsPreview');
      setPreview(pv);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  if (error) return <div className="p-6 text-danger">Failed to load settings: {error}</div>;
  if (!levels) return <div className="p-6 text-text-subtle">Loading settings…</div>;

  return (
    <div className="mx-auto max-w-3xl p-6 text-text">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <p className="mt-1 max-w-2xl text-sm text-text-subtle">
        App-level configuration. These choices decide how an issue's{' '}
        <strong className="text-text">effective due date</strong> is computed, which anchors any KPI
        target date set <em>relative</em> to the due date.
      </p>

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

      {/* Relative KPI target dates preview */}
      <section className="mt-4 rounded-lg border border-border bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold">Relative KPI target dates</h2>
          <span className="rounded bg-surface-sunken px-2 py-0.5 text-xs text-text-subtle">preview</span>
        </header>
        <div className="px-5 py-4">
          <p className="mb-4 text-sm text-text-subtle">
            When a KPI target date is an <strong className="text-text">offset</strong> instead of a
            fixed date, the offset applies to the issue's effective due date computed with the rules
            above. Read-only / derived.
          </p>
          <PreviewTable rows={preview} />
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
          onClick={save}
          disabled={saveState === 'saving'}
        >
          {saveState === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}

function PreviewTable({ rows }: { rows: PreviewRowDto[] | null }) {
  const empty = useMemo(() => !rows || rows.length === 0, [rows]);
  if (!rows) return <div className="text-sm text-text-subtle">Loading preview…</div>;
  if (empty) return <div className="text-sm text-text-subtle">No relative KPI target dates to preview.</div>;

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-subtle">
          <th className="py-2 font-semibold">Issue</th>
          <th className="py-2 font-semibold">Effective due date</th>
          <th className="py-2 font-semibold">KPI target timing</th>
          <th className="py-2 font-semibold">Resolved target date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.issueKey} className="border-b border-border">
            <td className="py-2" style={{ paddingLeft: r.indent * 16 }}>
              <span className="mr-1 inline-grid h-5 w-5 place-items-center rounded bg-brand align-middle text-[11px] font-bold text-white">
                {itypeLetter(r.issueTypeName)}
              </span>
              {r.issueKey} · {r.summary}
            </td>
            <td className="py-2">
              {r.effectiveDue.date ?? <span className="text-text-subtle">pending</span>}{' '}
              <SourceTag endpoint={r.effectiveDue} />
            </td>
            <td className="py-2 font-mono text-xs">{r.timingLabel}</td>
            <td className="py-2 font-mono text-xs">
              {r.resolved.pending ? (
                <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-text-subtle">pending</span>
              ) : (
                r.resolved.date
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceTag({ endpoint }: { endpoint: PreviewRowDto['effectiveDue'] }) {
  if (endpoint.source === 'own') {
    return <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-text-subtle">own date</span>;
  }
  if (endpoint.source === 'children') {
    return (
      <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs text-brand">
        from {endpoint.fromIssueKey ?? 'children'}
      </span>
    );
  }
  return null;
}
