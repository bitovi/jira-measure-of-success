import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import Textfield from '@atlaskit/textfield';
import {
  isValidProjectKey,
  normalizeProjectKey,
  type KpiSetupStatus,
  type KpiSpaceChoice,
  type SetUpCentralSpaceInput,
} from '@domain/index.js';
import type { KpiSetupController } from '@ui/data/useKpiSetupData/index.js';
import { ChangeWarning, errorText } from '../KpiBuildingBlocks/index.js';

type Option = { label: string; value: string };

export interface CentralSpaceCardProps extends Pick<KpiSetupController, 'api' | 'apply'> {
  setup: KpiSetupStatus;
  /** after the space is set up (a new install also gets KPI nesting) */
  onChanged?: () => void;
}

/**
 * Settings → Central KPI space (spec 11 · 04): an optional dedicated space for
 * company-wide KPIs. Create one (with the KPI work type, and the KPI fields in
 * its field scheme and screens) or use an existing company-managed space.
 */
export function CentralSpaceCard({ setup, api, apply, onChanged }: CentralSpaceCardProps) {
  const space = setup.centralSpace;
  const [changing, setChanging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [key, setKey] = useState('KPI');
  const [choices, setChoices] = useState<KpiSpaceChoice[] | null>(null);
  const [picked, setPicked] = useState<Option | null>(null);
  const [busy, setBusy] = useState<'create' | 'existing' | 'fix' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const needsWorkType = setup.workType.state !== 'ready';
  const valid = isValidProjectKey(key);

  const run = async (input: SetUpCentralSpaceInput, which: 'create' | 'existing' | 'fix') => {
    setBusy(which);
    setErr(null);
    try {
      await apply((a) => a.setUpCentralSpace(input));
      setChanging(false);
      setPicking(false);
      onChanged?.();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const openPicker = async () => {
    setPicking(true);
    setErr(null);
    if (!choices) {
      try {
        setChoices(await api.getKpiSpaceChoices());
      } catch (e) {
        setErr(errorText(e));
      }
    }
  };

  const badge =
    space.state === 'ready'
      ? { label: space.name ?? space.key ?? 'Connected', appearance: 'success' as const }
      : space.state === 'misconfigured'
        ? { label: 'Needs setup', appearance: 'moved' as const }
        : space.state === 'broken'
          ? { label: 'Deleted', appearance: 'removed' as const }
          : { label: 'None', appearance: 'default' as const };
  const showActions = space.state === 'unset' || space.state === 'broken' || changing;
  const options: Option[] = (choices ?? [])
    .filter((p) => p.id !== space.projectId)
    .map((p) => ({ label: `${p.name} (${p.key})`, value: p.id }));

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface" aria-labelledby="kpi-central-space">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h2 id="kpi-central-space" className="text-base font-semibold">
          Central KPI space
        </h2>
        <span className="text-xs text-text-subtlest">optional</span>
        <Lozenge appearance={badge.appearance}>{badge.label}</Lozenge>
      </header>
      <div className="px-5 py-4 text-sm">
        <p className="text-text-subtle">
          A dedicated space for company-wide KPIs, such as revenue or NPS. You don’t need one if KPIs will only live in
          team spaces.
        </p>
        {space.state === 'ready' && (
          <p className="mt-3 flex flex-wrap items-center gap-2">
            <span className="grid h-6 w-6 flex-none place-items-center rounded bg-brand text-[11px] font-bold text-white">
              {(space.key ?? '?').charAt(0)}
            </span>
            <span>
              KPIs are created as work items in <strong>{space.name}</strong>{' '}
              <code className="rounded bg-surface-sunken px-1.5 py-0.5 text-xs">{space.key}</code>.
            </span>
          </p>
        )}
        {(space.state === 'misconfigured' || space.state === 'broken') && space.problem && (
          <p className="mt-3 text-danger">{space.problem}</p>
        )}
        {changing && (
          <ChangeWarning>
            KPIs already in {space.name} stay there; they aren’t moved. New KPIs in the central space go to the new one.
          </ChangeWarning>
        )}
        {needsWorkType && showActions ? (
          <p className="mt-3 text-xs text-text-subtle">First: choose the KPI work type above.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            {space.state === 'misconfigured' && !changing && (
              <Button
                appearance="primary"
                onClick={() => void run({ mode: 'existing', projectId: space.projectId! }, 'fix')}
                isLoading={busy === 'fix'}
                isDisabled={busy !== null}
              >
                {`Add ${setup.workType.name ?? 'the KPI work type'} to ${space.key}`}
              </Button>
            )}
            {!showActions && (
              <Button appearance="subtle" onClick={() => setChanging(true)}>
                Change…
              </Button>
            )}
            {showActions && !picking && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium">Space key</span>
                  <Textfield
                    width="small"
                    isCompact
                    value={key}
                    aria-label="Space key"
                    onChange={(e) => setKey(normalizeProjectKey(e.currentTarget.value))}
                  />
                </label>
                <Button
                  appearance="primary"
                  onClick={() => void run({ mode: 'create', key }, 'create')}
                  isDisabled={!valid || busy !== null}
                  isLoading={busy === 'create'}
                >
                  Create space
                </Button>
                <Button onClick={() => void openPicker()} isDisabled={busy !== null}>
                  Use existing…
                </Button>
                {changing && (
                  <Button appearance="subtle" onClick={() => setChanging(false)}>
                    Cancel
                  </Button>
                )}
                {!valid && <span className="text-xs text-danger">2–10 letters/digits, starts with a letter.</span>}
              </>
            )}
            {picking && (
              <div className="flex w-full flex-wrap items-end gap-2">
                <div className="min-w-[14rem] flex-1">
                  <Select<Option>
                    inputId="kpi-central-space-picker"
                    aria-label="Existing space"
                    options={options}
                    isLoading={choices === null}
                    value={picked}
                    onChange={(o) => setPicked(o)}
                    placeholder="Choose a company-managed space"
                  />
                </div>
                <Button
                  appearance="primary"
                  onClick={() => picked && void run({ mode: 'existing', projectId: picked.value }, 'existing')}
                  isDisabled={!picked || busy !== null}
                  isLoading={busy === 'existing'}
                >
                  Use this
                </Button>
                <Button appearance="subtle" onClick={() => setPicking(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
        )}
        {err && (
          <p className="mt-2 text-danger" role="alert">
            {err}
          </p>
        )}
        <details className="mt-3 text-xs text-text-subtle">
          <summary className="cursor-pointer">What does the app change?</summary>
          <p className="mt-1">
            It adds the KPI work type to the space’s work type scheme, and KPI Unit and KPI Direction to its field scheme
            and screens for the KPI work type only, so other work types in spaces that share them aren’t affected.
          </p>
        </details>
      </div>
    </section>
  );
}
