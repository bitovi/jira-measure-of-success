import { useEffect, useRef, useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import { migrationRowState, type MigrationDto, type MigrationRowState } from '@domain/index.js';
import { useMigrationsData, type UseMigrations } from '@ui/data/useMigrationsData/index.js';

export interface UpgradeDataCardProps {
  useMigrations?: UseMigrations;
  /** change it to re-read the list (Settings bumps it after a KPI building block changes) */
  refreshKey?: number;
}

type Appearance = 'default' | 'inprogress' | 'success' | 'removed' | 'moved';
const BADGE: Record<MigrationRowState | 'paused', { label: string; appearance: Appearance }> = {
  pending: { label: 'To do', appearance: 'default' },
  running: { label: 'Running', appearance: 'inprogress' },
  paused: { label: 'Paused', appearance: 'moved' },
  done: { label: 'Done', appearance: 'success' },
  failed: { label: 'Failed', appearance: 'removed' },
  blocked: { label: 'Waiting', appearance: 'default' },
  notApplicable: { label: 'Not yet', appearance: 'default' },
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

function countsLine(m: MigrationDto): string | null {
  const { migrated, alreadyDone, skipped, failed } = m.record.counts;
  const parts: string[] = [];
  if (migrated > 0) parts.push(`${migrated.toLocaleString()} upgraded`);
  if (alreadyDone > 0) parts.push(`${alreadyDone.toLocaleString()} already up to date`);
  if (skipped > 0) parts.push(`${skipped.toLocaleString()} skipped`);
  if (failed > 0) parts.push(`${failed.toLocaleString()} failed`);
  const left = m.status?.pending;
  if (m.record.state !== 'done' && typeof left === 'number') parts.push(`${plural(left, 'work item')} left`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function MigrationRow({
  m,
  all,
  active,
  busy,
  onRetry,
}: {
  m: MigrationDto;
  all: MigrationDto[];
  active: boolean;
  busy: boolean;
  onRetry: (id: string) => void;
}) {
  const row = migrationRowState(m);
  const badge = BADGE[row === 'running' && !active ? 'paused' : row];
  const titleOf = (id: string) => all.find((x) => x.id === id)?.title ?? id;
  const counts = countsLine(m);
  return (
    <li className="flex flex-col gap-1 border-b border-border px-5 py-3 last:border-b-0" aria-label={m.title}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{m.title}</span>
        <Lozenge appearance={badge.appearance}>{badge.label}</Lozenge>
        {active && <span className="text-xs text-text-subtle">Upgrading…</span>}
      </div>
      <p className="text-sm text-text-subtle">{m.description}</p>
      {counts && <p className="text-xs text-text-subtle">{counts}</p>}
      {row === 'blocked' && <p className="text-xs text-text-subtle">Runs after {m.blockedBy.map(titleOf).join(', ')}.</p>}
      {row === 'notApplicable' && (
        <p className="text-xs text-text-subtle">{m.status?.reason ?? 'Doesn’t apply to this site yet.'}</p>
      )}
      {m.statusError && <p className="text-xs text-warning">Couldn’t count what’s left: {m.statusError}</p>}
      {row === 'failed' && (
        <div className="mt-1 flex flex-col gap-2">
          {m.record.failures.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-danger">
              {m.record.failures.slice(0, 5).map((f) => (
                <li key={`${f.issueId}:${f.message}`}>
                  <strong>{f.issueKey}</strong>: {f.message}
                </li>
              ))}
              {m.record.failures.length > 5 && <li>…and {m.record.failures.length - 5} more</li>}
            </ul>
          )}
          <div>
            <Button onClick={() => onRetry(m.id)} isDisabled={busy}>
              Retry failed
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Settings → Upgrade data (spec 11 · 04 Step 6): the first thing an admin sees
 * after upgrading. Expanded while any migration isn't done; otherwise one
 * collapsed line. One **Upgrade** button runs every pending migration in
 * order, batch by batch, with **Pause**.
 */
export function UpgradeDataCard({ useMigrations = useMigrationsData, refreshKey = 0 }: UpgradeDataCardProps) {
  const { migrations, error, runError, phase, current, upgrade, pause, retry, refresh } = useMigrations();
  const [showDone, setShowDone] = useState(false);
  const seenKey = useRef(refreshKey);
  useEffect(() => {
    if (seenKey.current === refreshKey) return;
    seenKey.current = refreshKey;
    refresh();
  }, [refreshKey, refresh]);

  if (error) {
    return (
      <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-3 text-sm text-danger" aria-label="Upgrade data">
        Couldn’t check whether KPI data needs upgrading: {error}
      </section>
    );
  }
  if (!migrations || migrations.length === 0) return null;

  const rows = migrations.map((m) => migrationRowState(m));
  const allDone = rows.every((r) => r === 'done');
  const busy = phase !== 'idle';

  if (allDone && !showDone) {
    return (
      <section
        className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-surface px-5 py-2 text-sm"
        aria-label="Upgrade data"
      >
        <span className="text-success" aria-hidden>
          ✓
        </span>
        <span>All data is up to date.</span>
        <Button appearance="subtle" spacing="compact" onClick={() => setShowDone(true)}>
          Details
        </Button>
      </section>
    );
  }

  const runnable = rows.some((r) => r === 'pending' || r === 'running');
  const resumable = rows.includes('running');
  const left = rows.filter((r) => r !== 'done').length;
  return (
    <section className="mt-6 rounded-lg border border-border bg-surface" aria-label="Upgrade data">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">Upgrade data</h2>
        {allDone ? (
          <Lozenge appearance="success">Up to date</Lozenge>
        ) : (
          <Lozenge appearance="moved">{`${plural(left, 'upgrade')} to run`}</Lozenge>
        )}
        <span className="flex-1" />
        {allDone ? (
          <Button appearance="subtle" onClick={() => setShowDone(false)}>
            Hide
          </Button>
        ) : busy ? (
          <Button onClick={pause} isDisabled={phase === 'pausing'}>
            {phase === 'pausing' ? 'Pausing…' : 'Pause'}
          </Button>
        ) : (
          <Button appearance="primary" onClick={upgrade} isDisabled={!runnable}>
            {resumable ? 'Resume' : 'Upgrade'}
          </Button>
        )}
      </header>
      {!allDone && (
        <p className="px-5 pt-3 text-sm text-text-subtle">
          This version stores KPI data in a new way. Until these upgrades run, some KPI data may show as incomplete. They
          run in order, a few work items at a time; you can pause and come back later.
        </p>
      )}
      {runError && (
        <p className="px-5 pt-2 text-sm text-danger" role="alert">
          {runError}
        </p>
      )}
      <ul className="mt-1">
        {migrations.map((m) => (
          <MigrationRow
            key={m.id}
            m={m}
            all={migrations}
            active={current === m.id}
            busy={busy}
            onRetry={(id) => void retry(id)}
          />
        ))}
      </ul>
    </section>
  );
}
