import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Select from '@atlaskit/select';
import type { KpiFieldChoice, KpiFieldOption, KpiFieldsStatus, SetUpKpiFieldsInput } from '@domain/index.js';
import type { KpiSetupController } from '@ui/data/useKpiSetupData/index.js';
import { ChangeWarning, StepCard } from './StepCard.js';
import { errorText } from './errorText.js';

type Option = { label: string; value: string; kind?: 'text' | 'select' };

const CREATE = 'create';
const KIND_LABEL = { text: 'short text', select: 'dropdown' } as const;
const INCREASE_HINT = /increase|up|higher|more|rise/i;
const DECREASE_HINT = /decrease|down|lower|less|fall/i;

/** The two fields' names, as the step shows them once chosen. */
function ChosenFields({ status }: { status: KpiFieldsStatus }) {
  const { unit, direction } = status;
  if (!unit || !direction) return null;
  const missing = <em className="text-danger">deleted</em>;
  return (
    <dl aria-label="Chosen fields" className="mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-text-subtle">Unit</dt>
      <dd>{unit.name ? <strong>{unit.name}</strong> : missing}</dd>
      <dt className="text-text-subtle">Direction</dt>
      <dd>
        {direction.name ? <strong>{direction.name}</strong> : missing}{' '}
        {direction.kind === 'select' ? (
          <span className="text-text-subtle">
            (“{direction.increase ?? '?'}” = higher is better, “{direction.decrease ?? '?'}” = lower is better)
          </span>
        ) : (
          <span className="text-text-subtle">(text: increase / decrease)</span>
        )}
      </dd>
    </dl>
  );
}

/** KPI fields: create KPI Unit + KPI Direction, or pick existing ones (saved together). */
export function FieldsStep({ status, api, apply }: { status: KpiFieldsStatus } & Pick<KpiSetupController, 'api' | 'apply'>) {
  const [changing, setChanging] = useState(false);
  const [picking, setPicking] = useState(false);
  const [choices, setChoices] = useState<KpiFieldChoice[] | null>(null);
  const [unit, setUnit] = useState<Option | null>(null);
  const [direction, setDirection] = useState<Option | null>(null);
  const [options, setOptions] = useState<KpiFieldOption[] | null>(null);
  const [increase, setIncrease] = useState<Option | null>(null);
  const [decrease, setDecrease] = useState<Option | null>(null);
  const [busy, setBusy] = useState<'create' | 'existing' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const createUnit: Option = { label: 'Create “KPI Unit”', value: CREATE };
  const createDirection: Option = { label: 'Create “KPI Direction”', value: CREATE };

  const openPicker = async () => {
    setPicking(true);
    setErr(null);
    setUnit((u) => u ?? createUnit);
    setDirection((d) => d ?? createDirection);
    if (!choices) {
      try {
        setChoices(await api.getKpiFieldChoices());
      } catch (e) {
        setErr(errorText(e));
      }
    }
  };

  const pickDirection = async (o: Option | null) => {
    setDirection(o);
    setOptions(null);
    setIncrease(null);
    setDecrease(null);
    if (!o || o.kind !== 'select') return;
    try {
      const opts = await api.getKpiFieldOptions(o.value);
      setOptions(opts);
      const toOption = (x?: KpiFieldOption) => (x ? { label: x.value, value: x.id } : null);
      setIncrease(toOption(opts.find((x) => INCREASE_HINT.test(x.value))));
      setDecrease(toOption(opts.find((x) => DECREASE_HINT.test(x.value))));
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const run = async (input: SetUpKpiFieldsInput, which: 'create' | 'existing') => {
    setBusy(which);
    setErr(null);
    try {
      await apply((a) => a.setUpKpiFields(input));
      setChanging(false);
      setPicking(false);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const picks = (): SetUpKpiFieldsInput | null => {
    if (!unit || !direction) return null;
    const unitInput: SetUpKpiFieldsInput['unit'] = unit.value === CREATE ? { mode: 'create' } : { mode: 'existing', fieldId: unit.value };
    if (direction.value === CREATE) return { unit: unitInput, direction: { mode: 'create' } };
    if (direction.kind === 'text') return { unit: unitInput, direction: { mode: 'existing', fieldId: direction.value, kind: 'text' } };
    if (!increase || !decrease || increase.value === decrease.value) return null;
    return {
      unit: unitInput,
      direction: { mode: 'existing', fieldId: direction.value, kind: 'select', optionIds: { increase: increase.value, decrease: decrease.value } },
    };
  };

  const ready = status.state === 'ready';
  const showActions = !ready || changing;
  const fieldOption = (f: KpiFieldChoice): Option => ({ label: `${f.name} (${KIND_LABEL[f.kind]})`, value: f.id, kind: f.kind });
  const unitOptions = [createUnit, ...(choices ?? []).filter((f) => f.kind === 'text').map(fieldOption)];
  const directionOptions = [createDirection, ...(choices ?? []).map(fieldOption)];
  const optionChoices: Option[] = (options ?? []).map((o) => ({ label: o.value, value: o.id }));
  const sameField = unit && direction && unit.value !== CREATE && unit.value === direction.value;
  const input = picks();

  return (
    <StepCard
      title="KPI fields"
      state={ready ? 'done' : status.state === 'broken' ? 'broken' : 'todo'}
      badge={ready ? 'In use' : status.state === 'broken' ? 'Field deleted' : 'To do'}
      what={
        <>
          The fields that hold each KPI’s unit and direction: <strong>KPI Unit</strong> (short text) and{' '}
          <strong>KPI Direction</strong> (dropdown: Increase / Decrease), or fields you already have.
        </>
      }
      why="The app reads and writes these fields, so KPIs show their unit and direction anywhere in Jira. Space admins can add existing fields to their spaces but can't create new ones, so a Jira admin makes them once here."
      error={err}
    >
      <ChosenFields status={status} />
      {status.state === 'broken' && status.problem && <p className="mt-2 text-sm text-danger">{status.problem}</p>}
      {changing && (
        <ChangeWarning>
          Existing KPIs keep their unit and direction in the old fields; they aren’t moved. Only what’s saved from now on
          uses the new ones.
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
            <Button
              appearance="primary"
              onClick={() => void run({ unit: { mode: 'create' }, direction: { mode: 'create' } }, 'create')}
              isLoading={busy === 'create'}
              isDisabled={busy !== null}
            >
              Create fields
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
      </div>
      {picking && (
        <div className="mt-3 flex flex-col gap-3 rounded border border-border p-3">
          <p className="text-sm text-text-subtle">Pick fields you already have, or let the app create either one.</p>
          <label className="flex flex-col gap-1 text-sm" htmlFor="kpi-unit-field">
            <span className="font-medium">Unit (a short text field)</span>
            <Select<Option>
              inputId="kpi-unit-field"
              options={unitOptions}
              isLoading={choices === null}
              value={unit}
              onChange={(o) => setUnit(o)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm" htmlFor="kpi-direction-field">
            <span className="font-medium">Direction (a dropdown, or a short text field holding “increase” / “decrease”)</span>
            <Select<Option>
              inputId="kpi-direction-field"
              options={directionOptions}
              isLoading={choices === null}
              value={direction}
              onChange={(o) => void pickDirection(o)}
            />
          </label>
          {direction?.kind === 'select' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm" htmlFor="kpi-direction-increase">
                <span className="font-medium">Higher is better</span>
                <Select<Option>
                  inputId="kpi-direction-increase"
                  options={optionChoices}
                  isLoading={options === null}
                  value={increase}
                  onChange={(o) => setIncrease(o)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm" htmlFor="kpi-direction-decrease">
                <span className="font-medium">Lower is better</span>
                <Select<Option>
                  inputId="kpi-direction-decrease"
                  options={optionChoices}
                  isLoading={options === null}
                  value={decrease}
                  onChange={(o) => setDecrease(o)}
                />
              </label>
              {options && options.length < 2 && (
                <p className="text-xs text-danger sm:col-span-2">This dropdown needs at least two options.</p>
              )}
            </div>
          )}
          {sameField && <p className="text-xs text-danger">Unit and direction need two different fields.</p>}
          <div className="flex gap-2">
            <Button
              appearance="primary"
              onClick={() => input && void run(input, 'existing')}
              isDisabled={!input || !!sameField || busy !== null}
              isLoading={busy === 'existing'}
            >
              Use these
            </Button>
            <Button appearance="subtle" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </StepCard>
  );
}
