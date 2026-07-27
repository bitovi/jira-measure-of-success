import { useEffect, useState } from 'react';
import type { TimelineNodeDto, TimelineReadingDto, TimelineTargetDto } from '@domain/index.js';
import { fmtVal } from './scale.js';

/**
 * The record / edit / projection modals shared by the KPI Timeline and the KPI
 * View. Behavior is identical on both surfaces (record a value, edit/delete a
 * reading, inspect an undated projection), so they live here rather than being
 * duplicated per surface.
 */

/** Projection details for one undated (or estimated) target — §6.3. */
export function ProjectionModal({
  node,
  target,
  siteUrl,
  onClose,
  onOpenIssueNewTab,
}: {
  node: TimelineNodeDto;
  target: TimelineTargetDto;
  siteUrl: string;
  onClose: () => void;
  onOpenIssueNewTab: (issueKey: string) => void | Promise<void>;
}) {
  const issueKey = target.source.issue;
  const href = siteUrl ? `${siteUrl}/browse/${issueKey}` : `/browse/${issueKey}`;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-surface p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">Projected target</h2>
          <button className="ml-auto text-text-subtle hover:text-text" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="text-sm text-text">
          <b>{node.name}</b> — projected{' '}
          <b>
            {target.provisional ? '≈ ' : ''}
            {fmtVal(target.value)} {node.unit}
          </b>
        </p>
        <p className="mt-1 text-[12px] text-text-subtle">
          {target.date ? `Target date ~${target.date}` : 'Due date TBD — no resolvable date yet.'}
        </p>
        {target.provisional && (
          <p className="mt-1 text-[12px] text-text-subtle">
            Provisional estimate — the baseline is carried from the latest reading and isn’t baselined yet.
          </p>
        )}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-block text-xs font-medium text-brand hover:underline"
          onClick={(e) => {
            e.preventDefault();
            void onOpenIssueNewTab(issueKey);
          }}
        >
          Open {target.source.type} {issueKey} in Jira ↗
        </a>
      </div>
    </div>
  );
}

export function RecordModal({
  node,
  defaultDate,
  today,
  onCancel,
  onRecord,
}: {
  node: TimelineNodeDto;
  defaultDate: string;
  today: string;
  onCancel: () => void;
  onRecord: (date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const isFutureDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const num = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || Number.isNaN(num)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onRecord(date, num);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">Record a value</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Date
            <input
              type="date"
              className="mt-0.5 h-9 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {isFutureDate && (
            <p role="alert" className="-mt-1 text-xs text-warning">
              This date is in the future. You can still record it, but the value
              hasn’t happened yet.
            </p>
          )}
          <label className="text-xs text-text-subtle">
            Value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              autoFocus
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-3">
          <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            onClick={submit}
          >
            Record
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Edit or delete a recorded value. Readings are last-write-wins per date
 * (storage-model.md), so saving overwrites the value at this date and deleting
 * tombstones it — both keep a changelog entry rather than mutating history.
 */
export function EditReadingModal({
  node,
  reading,
  onCancel,
  onSave,
  onDelete,
}: {
  node: TimelineNodeDto;
  reading: TimelineReadingDto;
  onCancel: () => void;
  onSave: (value: number) => void;
  onDelete: () => void;
}) {
  const [value, setValue] = useState(String(reading.value));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = () => {
    const num = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || Number.isNaN(num)) return;
    onSave(num);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(9,30,66,0.54)]"
      onClick={onCancel}
    >
      <div
        className="w-[380px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pb-1 pt-4">
          <h2 className="text-base font-semibold">Edit value</h2>
          <p className="mt-1 text-xs text-text-subtle">
            {node.name} · {node.unit} · {reading.date}
          </p>
        </div>
        <div className="flex flex-col gap-3 px-5 py-3">
          <label className="text-xs text-text-subtle">
            Value
            <input
              className="mt-0.5 w-full rounded border border-border px-2 py-1.5 text-sm"
              value={value}
              placeholder="e.g. 1,300,000"
              autoFocus
              aria-label="Value"
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        </div>
        <div className="flex items-center justify-between px-5 pb-4 pt-3">
          <button
            className="rounded border border-danger px-3 py-1.5 text-sm font-medium text-danger hover:bg-surface-sunken"
            onClick={onDelete}
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button className="rounded border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
              Cancel
            </button>
            <button
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
              onClick={submit}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
