import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@atlaskit/button/new';
import CrossIcon from '@atlaskit/icon/core/cross';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@atlaskit/modal-dialog';
import Textfield from '@atlaskit/textfield';
import type { TimelineNodeDto, TimelineReadingDto, TimelineTargetDto } from '@domain/index.js';
import { fmtVal } from './scale.js';

/**
 * The record / edit / projection modals shared by the KPI Timeline and the KPI
 * View. Behavior is identical on both surfaces (record a value, edit/delete a
 * reading, inspect an undated projection), so they live here rather than being
 * duplicated per surface. Built on `@atlaskit/modal-dialog` (portal, focus trap,
 * Escape/blanket close); each modal is mounted by its parent only while open.
 */

/** Small caption under a modal title — the KPI the modal acts on. */
export function ModalSubtitle({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-xs text-text-subtle">{children}</p>;
}

/** A labelled form row inside a modal body (Atlaskit controls take no className). */
export function ModalField({
  label,
  htmlFor,
  children,
}: {
  label: ReactNode;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs text-text-subtle">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

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
    <Modal onClose={onClose} width={380}>
      <ModalHeader>
        <ModalTitle>Projected target</ModalTitle>
        <Button appearance="subtle" spacing="compact" aria-label="Close" onClick={onClose}>
          <CrossIcon label="" size="small" />
        </Button>
      </ModalHeader>
      <ModalBody>
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
      </ModalBody>
    </Modal>
  );
}

export function RecordModal({
  node,
  defaultDate,
  today,
  onCancel,
  onRecord,
}: {
  node: Pick<TimelineNodeDto, 'name' | 'unit'>;
  defaultDate: string;
  today: string;
  onCancel: () => void;
  onRecord: (date: string, value: number) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [value, setValue] = useState('');
  const valueRef = useRef<HTMLInputElement>(null);
  const isFutureDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > today;

  const submit = () => {
    const num = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || Number.isNaN(num)) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    onRecord(date, num);
  };

  return (
    <Modal onClose={onCancel} width={380} autoFocus={valueRef}>
      <ModalHeader>
        <ModalTitle>Record a value</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalSubtitle>
          {node.name} · {node.unit}
        </ModalSubtitle>
        <div className="flex flex-col gap-3">
          <ModalField label="Date" htmlFor="record-date">
            <Textfield
              id="record-date"
              type="date"
              value={date}
              onChange={(e: FormEvent<HTMLInputElement>) => setDate(e.currentTarget.value)}
            />
          </ModalField>
          {isFutureDate && (
            <p role="alert" className="-mt-1 text-xs text-warning">
              This date is in the future. You can still record it, but the value
              hasn’t happened yet.
            </p>
          )}
          <ModalField label="Value" htmlFor="record-value">
            <Textfield
              id="record-value"
              ref={valueRef}
              value={value}
              placeholder="e.g. 1,300,000"
              onChange={(e: FormEvent<HTMLInputElement>) => setValue(e.currentTarget.value)}
            />
          </ModalField>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit}>
          Record
        </Button>
      </ModalFooter>
    </Modal>
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
  const valueRef = useRef<HTMLInputElement>(null);

  const submit = () => {
    const num = Number(value.replace(/,/g, ''));
    if (value.trim() === '' || Number.isNaN(num)) return;
    onSave(num);
  };

  return (
    <Modal onClose={onCancel} width={380} autoFocus={valueRef}>
      <ModalHeader>
        <ModalTitle>Edit value</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <ModalSubtitle>
          {node.name} · {node.unit} · {reading.date}
        </ModalSubtitle>
        <ModalField label="Value" htmlFor="edit-reading-value">
          <Textfield
            id="edit-reading-value"
            ref={valueRef}
            value={value}
            placeholder="e.g. 1,300,000"
            onChange={(e: FormEvent<HTMLInputElement>) => setValue(e.currentTarget.value)}
          />
        </ModalField>
      </ModalBody>
      <ModalFooter>
        <div className="mr-auto">
          <Button appearance="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
        <Button appearance="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button appearance="primary" onClick={submit}>
          Save
        </Button>
      </ModalFooter>
    </Modal>
  );
}
