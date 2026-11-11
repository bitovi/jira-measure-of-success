import { useMemo, useId, useState } from 'react';
import Button from '@atlaskit/button/new';
import AddIcon from '@atlaskit/icon/core/add';
import Select from '@atlaskit/select';
import { usePanelData, type UsePanel } from '@ui/data/usePanelData/index.js';
import { openKpiTimeline } from '@ui/bridge.js';
import { RecordModal } from '@ui/plot/modals.js';
import { KpiView } from '@ui/surfaces/KpiView/index.js';
import type { Assignment, CatalogEntryDto, PanelRowDto } from '@domain/index.js';
import { TargetCard } from './components/TargetCard/index.js';
import { TargetEditor } from './components/TargetEditor/index.js';
import { panelMenuProps, useMenuRoom } from './useMenuRoom.js';
import {
  DEFAULT_DUE,
  cleanDue,
  isValidDraft,
  isWrongWay,
  parseTarget,
  previewRow,
  type TargetDraft,
} from './targetText.js';

/**
 * Issue panel (Custom UI) — on-issue KPI editor. KPIs are grouped by their
 * relationship to the parent (shared / only here / on parent, not tracked).
 * v1 authors INDEPENDENT targets (no value inheritance, Q11).
 *
 * Feature 03, mock v3 (specs/03-relative-dates-and-values/issue-panel-v3.html):
 * each saved target is a `TargetCard` whose headline is the bet as typed
 * (`+2% · 3 months after due date`), editable in place (Atlaskit InlineEdit,
 * IP-8/Q10). Below it, the estimate line says whether the number is a locked
 * `Target` or an `Estimated target`. The "Set a KPI target" form uses the same
 * `TargetEditor` and previews the card it will create. Everything sizes to the
 * panel's width (container queries), not the viewport.
 */
const GROUP_META: Record<PanelRowDto['relationship'], { title: string; order: number }> = {
  shared: { title: 'Shared with parent', order: 0 },
  onlyHere: { title: 'Only on this issue', order: 1 },
  onParentNotTracked: { title: 'On parent, not tracked here', order: 2 },
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function IssuePanel({
  issueId = '10048',
  usePanel = usePanelData,
}: {
  issueId?: string;
  usePanel?: UsePanel;
}) {
  const { data, pending, error, busy, valuesError, retryValues, save, remove, record } = usePanel(issueId);
  const [recordFor, setRecordFor] = useState<PanelRowDto | null>(null);
  const menuRoomRef = useMenuRoom();

  const groups = useMemo(() => {
    if (!data) return [];
    const byRel = new Map<PanelRowDto['relationship'], PanelRowDto[]>();
    for (const row of data.rows) {
      const list = byRel.get(row.relationship) ?? [];
      list.push(row);
      byRel.set(row.relationship, list);
    }
    return [...byRel.entries()].sort((a, b) => GROUP_META[a[0]].order - GROUP_META[b[0]].order);
  }, [data]);

  if (error) return <div className="p-4 text-danger">Failed to load KPIs: {error}</div>;
  if (pending || !data) return <div className="p-4 text-text-subtle">Loading KPIs…</div>;

  // This issue IS a KPI (it lives in the KPI space, Feature 04): render ONLY the
  // single-KPI chart — no group list, no "Set a KPI target" form. Authoring
  // nested KPIs happens on the Timeline's add-child, not here.
  if (data.kpiView) {
    return <KpiView node={data.kpiView.node} today={data.kpiView.today} onRecord={record} />;
  }

  const tracked = data.rows.filter((r) => r.relationship !== 'onParentNotTracked');
  const isEmpty = tracked.length === 0;
  const noCatalog = data.catalog.length === 0;
  const currentValueOf = (kpiId: string) => data.catalog.find((c) => c.id === kpiId)?.currentValue ?? null;
  const today = localToday();

  return (
    <div ref={menuRoomRef} className="p-4 text-text [container-type:inline-size]">
      {busy && <div className="mb-3 text-xs text-text-subtle">saving…</div>}

      {valuesError && <ValuesErrorBanner message={valuesError} onRetry={retryValues} />}

      {isEmpty && !noCatalog && (
        <p className="mb-3 rounded border border-dashed border-border p-3 text-sm text-text-subtle">
          No KPIs tracked on this issue yet. Set one below.
        </p>
      )}

      {groups.map(([rel, rows]) => (
        <section key={rel} className="mb-4" aria-label={GROUP_META[rel].title}>
          <h3 className="mb-1 text-xs font-medium leading-4 text-text-subtle">{GROUP_META[rel].title}</h3>
          <div className="flex flex-col gap-2">
            {rows.map((row) =>
              row.relationship === 'onParentNotTracked' ? (
                <TrackThisRow key={row.kpiId} row={row} onTrack={save} />
              ) : (
                <TargetCard
                  key={row.kpiId}
                  row={row}
                  currentValue={currentValueOf(row.kpiId)}
                  busy={busy}
                  onSave={(draft) => save(buildAssignment(row.kpiId, draft, row.start))}
                  onRemove={() => remove(row.kpiId)}
                  onRecord={() => setRecordFor(row)}
                />
              ),
            )}
          </div>
        </section>
      ))}

      {noCatalog ? (
        <p className="rounded border border-dashed border-border p-3 text-sm text-text-subtle">
          KPIs are not defined yet. You must first{' '}
          <Button appearance="default" spacing="compact" onClick={() => void openKpiTimeline()}>
            define a KPI
          </Button>
          .
        </p>
      ) : (
        <AssociateForm
          catalog={data.catalog}
          existing={data.rows}
          issueDueDate={data.issueDueDate}
          issueDueRolledUp={data.issueDueRolledUp}
          resolving={data.resolving === true}
          onSave={save}
        />
      )}

      {recordFor && (
        <RecordModal
          node={recordFor}
          defaultDate={today}
          today={today}
          onCancel={() => setRecordFor(null)}
          onRecord={(date, value) => {
            record(recordFor.kpiId, date, value);
            setRecordFor(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Phase 2 (readings + rolled-up dates) failed: the targets and the form are
 * still usable, so this is an inline, retryable banner, not the full error.
 */
function ValuesErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-3 rounded-md border border-danger px-3 py-2 text-sm">
      <p className="font-semibold text-danger">Couldn’t load estimates</p>
      <p className="mt-0.5 text-text-subtle">Your targets are shown, but their estimated values and dates are missing. {message}</p>
      <div className="mt-2">
        <Button appearance="primary" spacing="compact" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </div>
  );
}

/** Build an assignment from a target draft. */
function buildAssignment(kpiId: string, draft: TargetDraft, start: string | null): Assignment {
  return {
    kpiId,
    inheritFromParent: false,
    target: parseTarget(draft.value),
    targetType: draft.targetType,
    timing: { start, due: cleanDue(draft.due) },
    updatedBy: 'me',
    updatedAt: Date.now(),
  };
}

function TrackThisRow({ row, onTrack }: { row: PanelRowDto; onTrack: (a: Assignment) => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
      <span className="text-sm text-text-subtle">{row.name}</span>
      <div className="ml-auto">
        <Button
          appearance="subtle"
          spacing="compact"
          iconBefore={AddIcon}
          onClick={() => onTrack(buildAssignment(row.kpiId, { targetType: 'absolute', value: '', due: DEFAULT_DUE }, null))}
        >
          Track this
        </Button>
      </div>
    </div>
  );
}

type KpiOption = { label: string; value: string; depth: number };

const EMPTY_DRAFT: TargetDraft = { targetType: 'percent', value: '', due: DEFAULT_DUE };

function AssociateForm({
  catalog,
  existing,
  issueDueDate,
  issueDueRolledUp,
  resolving,
  onSave,
}: {
  catalog: CatalogEntryDto[];
  existing: PanelRowDto[];
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  /** the issue's due date and the KPIs' current values are still loading */
  resolving: boolean;
  onSave: (a: Assignment) => void;
}) {
  const trackedIds = new Set(existing.filter((r) => r.relationship !== 'onParentNotTracked').map((r) => r.kpiId));
  const [kpiId, setKpiId] = useState('');
  const [draft, setDraft] = useState<TargetDraft>(EMPTY_DRAFT);
  const kpiInputId = useId();
  const titleId = useId();

  const options: KpiOption[] = catalog
    .filter((c) => !trackedIds.has(c.id))
    .map((c) => ({ label: c.name, value: c.id, depth: c.depth ?? 0 }));
  const kpi = catalog.find((c) => c.id === kpiId);
  const current = kpi?.currentValue ?? null;
  const preview = kpi ? { ...previewRow(kpi, draft, issueDueDate, issueDueRolledUp), resolving: resolving || undefined } : null;

  const canSubmit = kpiId !== '' && isValidDraft(draft);
  const submit = () => {
    if (!canSubmit) return;
    onSave(buildAssignment(kpiId, draft, null));
    setKpiId('');
    setDraft(EMPTY_DRAFT);
  };

  return (
    <section aria-labelledby={titleId} className="rounded-md border border-dashed border-border p-3">
      <h3 id={titleId} className="mb-2 text-sm font-medium text-text-subtle">
        Set a KPI target
      </h3>
      <div className="flex flex-col gap-2">
        <div>
          <label htmlFor={kpiInputId} className="mb-0.5 block text-xs leading-4 text-text-subtle">
            KPI
          </label>
          <Select<KpiOption>
            inputId={kpiInputId}
            spacing="compact"
            {...panelMenuProps}
            options={options}
            value={options.find((o) => o.value === kpiId) ?? null}
            placeholder="Choose KPI…"
            // Indent by KPI-tree depth in the menu so parent/child nesting reads.
            formatOptionLabel={(o, { context }) =>
              context === 'menu' ? <span style={{ paddingLeft: o.depth * 12 }}>{o.label}</span> : o.label
            }
            onChange={(o) => setKpiId(o?.value ?? '')}
          />
        </div>

        <TargetEditor draft={draft} onChange={setDraft} />

        {kpi && preview && (
          <div>
            <div className="mb-1 text-xs font-medium leading-4 text-text-subtle">Preview</div>
            <TargetCard row={preview} currentValue={current} preview />
            {!resolving && isWrongWay(preview, current) && (
              <p className="mt-1.5 rounded bg-[var(--ds-background-warning,#fff7d6)] px-2 py-1.5 text-xs font-medium leading-4 text-warning">
                This {preview.direction === 'increase' ? 'lowers' : 'raises'} {kpi.name}, where{' '}
                {preview.direction === 'increase' ? 'higher' : 'lower'} is better. Double-check the sign.
              </p>
            )}
          </div>
        )}

        <div>
          <Button appearance="primary" isDisabled={!canSubmit} onClick={submit}>
            Set KPI target
          </Button>
        </div>
      </div>
    </section>
  );
}
