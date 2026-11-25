import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import type { KpiWorkTypeChoice, KpiWorkTypeStatus, SetUpKpiWorkTypeInput } from '@domain/index.js';
import type { KpiSetupController } from '@ui/data/useKpiSetupData/index.js';
import { ChangeWarning, StepCard } from './StepCard.js';
import { errorText } from './errorText.js';

type Option = { label: string; value: string };

/** KPI work type: create the app's `KPI` type, or use one the site has. */
export function WorkTypeStep({ status, api, apply }: { status: KpiWorkTypeStatus } & Pick<KpiSetupController, 'api' | 'apply'>) {
  const [changing, setChanging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<KpiWorkTypeChoice[] | null>(null);
  const [picked, setPicked] = useState<Option | null>(null);
  const [busy, setBusy] = useState<'create' | 'existing' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const openPicker = async () => {
    setPicking(true);
    setErr(null);
    if (!choices) {
      try {
        setChoices(await api.getKpiWorkTypeChoices());
      } catch (e) {
        setErr(errorText(e));
      }
    }
  };

  const run = async (input: SetUpKpiWorkTypeInput) => {
    setBusy(input.mode);
    setErr(null);
    try {
      await apply((a) => a.setUpKpiWorkType(input));
      setChanging(false);
      setPicking(false);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const ready = status.state === 'ready';
  const showActions = !ready || changing;
  const options: Option[] = (choices ?? []).filter((t) => t.id !== status.id).map((t) => ({ label: t.name, value: t.id }));
  return (
    <StepCard
      title="KPI work type"
      state={ready ? 'done' : status.state === 'broken' ? 'broken' : 'todo'}
      badge={ready ? 'In use' : status.state === 'broken' ? 'Deleted' : 'To do'}
      what="The work type a KPI is created as, in any space. The app treats every work item of this type as a KPI."
      why="Only Jira admins can create work types. Spaces that hold KPIs then offer it through their work type scheme."
      error={err}
    >
      {ready && (
        <p className="mt-2 flex items-center gap-2 text-sm">
          {status.iconUrl && <img src={status.iconUrl} alt="" className="h-4 w-4" />}
          <span>
            Using <strong>{status.name}</strong>.
          </span>
        </p>
      )}
      {status.state === 'broken' && (
        <p className="mt-2 text-sm text-danger">
          The work type {status.name} ({status.id}) no longer exists. Choose another.
        </p>
      )}
      {changing && (
        <ChangeWarning>
          Existing KPIs stay work items of {status.name}; they aren’t moved. Only KPIs created from now on use the new type.
        </ChangeWarning>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!showActions && (
          <Button appearance="subtle" onClick={() => setChanging(true)}>
            Change…
          </Button>
        )}
        {showActions && !picking && (
          <>
            <Button appearance="primary" onClick={() => void run({ mode: 'create' })} isLoading={busy === 'create'} isDisabled={busy !== null}>
              Create “KPI” work type
            </Button>
            <Button onClick={() => void openPicker()} isDisabled={busy !== null}>
              Use existing…
            </Button>
            {changing && (
              <Button appearance="subtle" onClick={() => setChanging(false)}>
                Cancel
              </Button>
            )}
          </>
        )}
        {picking && (
          <div className="flex w-full flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <Select<Option>
                inputId="kpi-work-type-picker"
                aria-label="Existing work type"
                options={options}
                isLoading={choices === null}
                value={picked}
                onChange={(o) => setPicked(o)}
                placeholder="Choose a work type"
              />
            </div>
            <Button
              appearance="primary"
              onClick={() => picked && void run({ mode: 'existing', id: picked.value })}
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
    </StepCard>
  );
}
