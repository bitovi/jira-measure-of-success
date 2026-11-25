import { useEffect, useMemo, useId, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import AddIcon from '@atlaskit/icon/core/add';
import { usePanelData, type UsePanel } from '@ui/data/usePanelData/index.js';
import { getSiteUrl, openIssue, openKpiTimeline } from '@ui/bridge.js';
import { RecordModal } from '@ui/plot/modals.js';
import { KpiView } from '@ui/surfaces/KpiView/index.js';
import { AccessRefusal } from '@ui/components/AccessRefusal/index.js';
import { useKpiAccess } from '@ui/data/useKpiAccess/index.js';
import { cachedKpiPickerApi, type KpiPickerApi } from '@ui/data/useKpiPicker/index.js';
import { kpiActionBlockedReason, NO_KPIS_MESSAGE, projectKeyOfIssueKey } from '@domain/index.js';
import type { Assignment, CatalogEntryDto, KpiOptionDto, KpiSuggestionsDto, PanelRowDto } from '@domain/index.js';
import { TargetCard } from './components/TargetCard/index.js';
import { TargetEditor } from './components/TargetEditor/index.js';
import { KpiPicker, type CurrentValueState } from './components/KpiPicker/index.js';
import { useMenuRoom } from './useMenuRoom.js';
import {
  DEFAULT_DUE,
  cleanDue,
  isValidDraft,
  isWrongWay,
  parseTarget,
  previewRow,
  type TargetDraft,
} from '@ui/targetText.js';

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
 * `TargetEditor` and previews the card it will create; its KPI field is the
 * two-pane KPI browser (spec 11 · 07, `KpiPicker`). Everything sizes to the
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
  onOpenIssue = openIssue,
  loadSiteUrl = getSiteUrl,
}: {
  issueId?: string;
  usePanel?: UsePanel;
  /** opens a KPI's Jira issue (the target cards' KPI-name links) */
  onOpenIssue?: (issueKey: string) => void | Promise<void>;
  loadSiteUrl?: () => Promise<string>;
}) {
  const {
    data,
    pending,
    error,
    busy,
    actionError,
    dismissActionError,
    valuesError,
    retryValues,
    save,
    remove,
    record,
    getKpiAccess,
    pickerApi,
  } = usePanel(issueId);
  // Spec 11 · 06: a target's KPI space access is looked up when "Record a value"
  // is first used, and remembered per space for the page session.
  const kpiAccess = useKpiAccess(getKpiAccess);
  const [siteUrl, setSiteUrl] = useState('');
  useEffect(() => {
    let cancelled = false;
    void loadSiteUrl().then((u) => {
      if (!cancelled) setSiteUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [loadSiteUrl]);
  const [recordFor, setRecordFor] = useState<PanelRowDto | null>(null);
  // "+ Track this" pre-selects the KPI in the form; `n` re-triggers a repeat click.
  const [trackRequest, setTrackRequest] = useState<TrackRequest | null>(null);
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

  const actionBanner = actionError && <ActionErrorBanner message={actionError} onDismiss={dismissActionError} />;

  // This issue IS a KPI (of the KPI work type, Feature 04): render ONLY the
  // single-KPI chart — no group list, no "Set a KPI target" form. Authoring
  // nested KPIs happens on the Timeline's add-child, not here. Its space's
  // access comes with the load.
  if (data.kpiView) {
    const { node } = data.kpiView;
    return (
      <>
        {actionBanner && <div className="px-4 pt-4">{actionBanner}</div>}
        <KpiView
          node={node}
          today={data.kpiView.today}
          onRecord={record}
          recordBlocked={kpiActionBlockedReason('record', data.access, node.space?.name, node.issueKey)}
          parentLinks={data.kpiView.parentLinks ?? null}
        />
      </>
    );
  }

  const tracked = data.rows.filter((r) => r.relationship !== 'onParentNotTracked');
  const isEmpty = tracked.length === 0;
  // Spec 11 · 06 Q4 / 07: without a KPI work type there are no KPIs to pick from.
  const noKpis = !data.picker;
  const currentValueOf = (kpiId: string) => data.kpis.find((c) => c.id === kpiId)?.currentValue ?? null;
  /** A target's KPI space: from its definition, else its key's prefix. */
  const spaceOfRow = (row: PanelRowDto) => {
    const space = data.kpis.find((c) => c.id === row.kpiId)?.space;
    const key = space?.key ?? projectKeyOfIssueKey(row.kpiKey);
    return { key, label: space?.name ?? key };
  };
  const recordBlockedFor = (row: PanelRowDto) => {
    const space = spaceOfRow(row);
    return kpiActionBlockedReason('record', kpiAccess.accessOf(space.key), space.label, row.kpiKey);
  };
  const recordOn = (row: PanelRowDto) => {
    const space = spaceOfRow(row);
    kpiAccess.guard(
      `record:${row.kpiId}`,
      space.key,
      (a) => kpiActionBlockedReason('record', a, space.label, row.kpiKey),
      () => setRecordFor(row),
    );
  };
  const today = localToday();

  return (
    <div ref={menuRoomRef} className="p-4 text-text [container-type:inline-size]">
      {busy && <div className="mb-3 text-xs text-text-subtle">saving…</div>}

      {actionBanner}

      {kpiAccess.refusal && (
        <div className="mb-3">
          <AccessRefusal message={kpiAccess.refusal} onDismiss={kpiAccess.dismissRefusal} />
        </div>
      )}

      {valuesError && <ValuesErrorBanner message={valuesError} onRetry={retryValues} />}

      {isEmpty && !noKpis && (
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
                <TrackThisRow
                  key={row.kpiId}
                  row={row}
                  onTrack={() => setTrackRequest((prev) => ({ kpiId: row.kpiId, n: (prev?.n ?? 0) + 1 }))}
                />
              ) : (
                <TargetCard
                  key={row.kpiId}
                  row={row}
                  currentValue={currentValueOf(row.kpiId)}
                  busy={busy}
                  onSave={(draft) => save(buildAssignment(row.kpiId, draft, row.start))}
                  onRemove={() => remove(row.kpiId)}
                  onRecord={() => recordOn(row)}
                  recordBlocked={recordBlockedFor(row)}
                  recordBusy={kpiAccess.pendingAction === `record:${row.kpiId}`}
                  kpiHref={siteUrl ? `${siteUrl}/browse/${row.kpiKey}` : `/browse/${row.kpiKey}`}
                  onOpenKpi={() => void onOpenIssue(row.kpiKey)}
                />
              ),
            )}
          </div>
        </section>
      ))}

      {!data.picker ? (
        <div
          role="status"
          className="flex flex-col items-start gap-2 rounded border border-dashed border-border p-3 text-sm text-text-subtle"
        >
          <span>{NO_KPIS_MESSAGE}</span>
          <Button appearance="default" spacing="compact" iconBefore={AddIcon} onClick={() => void openKpiTimeline()}>
            Add KPI
          </Button>
        </div>
      ) : (
        <AssociateForm
          issueKey={data.issueKey}
          suggestions={data.picker}
          kpis={data.kpis}
          pickerApi={pickerApi}
          existing={data.rows}
          issueDueDate={data.issueDueDate}
          issueDueRolledUp={data.issueDueRolledUp}
          resolving={data.resolving === true}
          trackRequest={trackRequest}
          onSave={save}
        />
      )}

      {recordFor && (
        <RecordModal
          node={recordFor}
          defaultDate={today}
          today={today}
          onCancel={() => setRecordFor(null)}
          onRecord={async (date, value) => {
            await record(recordFor.kpiId, date, value);
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

/** A save / remove failed: the panel still shows its previous data. */
function ActionErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="mb-3 rounded-md border border-danger px-3 py-2 text-sm">
      <p className="font-semibold text-danger">Couldn’t save your change</p>
      <p className="mt-0.5 text-text-subtle">{message}</p>
      <div className="mt-2">
        <Button appearance="subtle" spacing="compact" onClick={onDismiss}>
          Dismiss
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

type TrackRequest = { kpiId: string; n: number };

/**
 * A KPI on the parent but not here. "+ Track this" doesn't save anything: it
 * picks the KPI in the "Set a KPI target" form and focuses its value, so the
 * user sets a real target (v1 targets are independent — nothing to inherit).
 */
function TrackThisRow({ row, onTrack }: { row: PanelRowDto; onTrack: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
      <span className="text-sm text-text-subtle">{row.name}</span>
      <div className="ml-auto">
        <Button appearance="subtle" spacing="compact" iconBefore={AddIcon} onClick={onTrack}>
          Track this
        </Button>
      </div>
    </div>
  );
}

const EMPTY_DRAFT: TargetDraft = { targetType: 'percent', value: '', due: DEFAULT_DUE };

/** A targeted KPI's option for the picker: from the browser's lists (with its icon), else its definition. */
function optionFor(kpiId: string, suggestions: KpiSuggestionsDto, kpis: CatalogEntryDto[]): KpiOptionDto | null {
  const listed = [
    ...suggestions.trackedByParents.flatMap((b) => b.targets.flatMap((t) => [t.option, ...t.subKpis])),
    ...suggestions.inThisSpace,
  ].find((o) => o.id === kpiId);
  if (listed) return { ...listed, parentId: null, hasChildren: false };
  const def = kpis.find((k) => k.id === kpiId);
  if (!def) return null;
  const spaceKey = def.space?.key ?? projectKeyOfIssueKey(def.key);
  return {
    id: def.id,
    key: def.key,
    name: def.name,
    typeIconUrl: null,
    unit: def.unit,
    direction: def.direction,
    space: { key: spaceKey, name: def.space?.name ?? spaceKey },
    parentId: null,
    hasChildren: false,
  };
}

function AssociateForm({
  issueKey,
  suggestions,
  kpis,
  pickerApi,
  existing,
  issueDueDate,
  issueDueRolledUp,
  resolving,
  trackRequest,
  onSave,
}: {
  issueKey: string;
  suggestions: KpiSuggestionsDto;
  /** the targeted KPIs' definitions (for "+ Track this") */
  kpis: CatalogEntryDto[];
  pickerApi?: KpiPickerApi;
  existing: PanelRowDto[];
  issueDueDate: string | null;
  issueDueRolledUp: boolean;
  /** the issue's due date is still loading */
  resolving: boolean;
  /** a "+ Track this" click: pick this KPI and focus the target value */
  trackRequest: TrackRequest | null;
  onSave: (a: Assignment) => void;
}) {
  const trackedIds = useMemo(
    () => new Set(existing.filter((r) => r.relationship !== 'onParentNotTracked').map((r) => r.kpiId)),
    [existing],
  );
  const loads = useMemo(() => (pickerApi ? cachedKpiPickerApi(pickerApi) : undefined), [pickerApi]);
  const [picked, setPicked] = useState<KpiOptionDto | null>(null);
  const [current, setCurrent] = useState<{ kpiId: string; value: number | null } | null>(null);
  const [draft, setDraft] = useState<TargetDraft>(EMPTY_DRAFT);
  const kpiInputId = useId();
  const titleId = useId();
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!trackRequest) return;
    setPicked(optionFor(trackRequest.kpiId, suggestions, kpis));
    amountRef.current?.focus();
    // Only a new "+ Track this" click picks a KPI.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackRequest]);

  // The picked KPI's current value (its readings): fetched for that KPI only.
  useEffect(() => {
    if (!picked || !loads) return;
    let alive = true;
    loads.getKpiCurrentValue(picked.id).then(
      (v) => alive && setCurrent({ kpiId: picked.id, value: v.value }),
      () => alive && setCurrent({ kpiId: picked.id, value: null }),
    );
    return () => {
      alive = false;
    };
  }, [picked, loads]);

  const currentValue = picked && current?.kpiId === picked.id ? current.value : null;
  const currentState: CurrentValueState = !picked || !loads ? null : current?.kpiId === picked.id ? { pending: false, value: current.value } : { pending: true };
  const kpi: CatalogEntryDto | null = picked
    ? { id: picked.id, key: picked.key, name: picked.name, unit: picked.unit.trim(), direction: picked.direction, currentValue }
    : null;
  const valueResolving = resolving || currentState?.pending === true;
  const preview = kpi ? { ...previewRow(kpi, draft, issueDueDate, issueDueRolledUp), resolving: valueResolving || undefined } : null;

  const canSubmit = picked !== null && isValidDraft(draft);
  const submit = () => {
    if (!picked || !canSubmit) return;
    onSave(buildAssignment(picked.id, draft, null));
    setPicked(null);
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
          <KpiPicker
            inputId={kpiInputId}
            suggestions={suggestions}
            issueKey={issueKey}
            trackedIds={trackedIds}
            value={picked}
            onChange={setPicked}
            api={loads}
            currentValue={currentState}
          />
        </div>

        <TargetEditor draft={draft} onChange={setDraft} amountRef={amountRef} />

        {kpi && preview && (
          <div>
            <div className="mb-1 text-xs font-medium leading-4 text-text-subtle">Preview</div>
            <TargetCard row={preview} currentValue={currentValue} preview />
            {!valueResolving && isWrongWay(preview, currentValue) && (
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
