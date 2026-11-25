import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import type { KpiSetupStatus } from '@domain/index.js';
import type { KpiSetupController } from '@ui/data/useKpiSetupData/index.js';
import { FieldsStep } from './FieldsStep.js';
import { errorText } from './errorText.js';
import { WorkTypeStep } from './WorkTypeStep.js';

export interface KpiBuildingBlocksProps extends Pick<KpiSetupController, 'api' | 'apply'> {
  setup: KpiSetupStatus;
  /** after "Set up everything" (it also sets up the central space and KPI nesting) */
  onSetUpEverything?: () => void;
}

/** What "Set up everything" would still do, in order. */
function remainingSteps(setup: KpiSetupStatus): string[] {
  const steps: string[] = [];
  if (setup.workType.state === 'unset') steps.push('Create a work type named KPI (with a target icon).');
  if (setup.fields.state === 'unset') {
    steps.push('Create the fields KPI Unit (short text) and KPI Direction (dropdown: Increase, Decrease).');
  }
  if (setup.centralSpace.state === 'unset') steps.push('Create the central space “KPIs (KPI)”, offering the KPI work type.');
  if (setup.fields.state === 'unset' || setup.centralSpace.state === 'unset') {
    steps.push("Add KPI Unit and KPI Direction to the central space's field scheme and screens, for the KPI work type only.");
  }
  if (steps.length > 0) steps.push('Set up how KPIs nest (the “KPI Hierarchy” link type), if it isn’t yet.');
  return steps;
}

/**
 * Settings → KPI building blocks (spec 11 · 04): the site-wide pieces only a
 * Jira admin can create, which every space that holds KPIs uses. Each can be
 * created by the app or pointed at something the site has; "Set up
 * everything" creates whatever isn't chosen yet with the app's defaults.
 */
export function KpiBuildingBlocks({ setup, api, apply, onSetUpEverything }: KpiBuildingBlocksProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const remaining = remainingSteps(setup);
  const states = [setup.workType.state, setup.fields.state];
  const badge = states.includes('broken')
    ? { label: 'Needs attention', appearance: 'removed' as const }
    : states.every((s) => s === 'ready')
      ? { label: 'Ready', appearance: 'success' as const }
      : { label: 'Not set up', appearance: 'default' as const };

  const setUpEverything = async () => {
    setBusy(true);
    setErr(null);
    try {
      await apply((a) => a.setUpEverything({ key: 'KPI' }));
      setConfirming(false);
      onSetUpEverything?.();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface" aria-labelledby="kpi-building-blocks">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h2 id="kpi-building-blocks" className="text-base font-semibold">
          KPI building blocks
        </h2>
        <Lozenge appearance={badge.appearance}>{badge.label}</Lozenge>
      </header>
      <div className="flex flex-col gap-3 px-5 py-4">
        <p className="text-sm text-text-subtle">
          Site-wide pieces only a Jira admin can create. Every space that holds KPIs uses them. Create each one, or point
          the app at one you already have.
        </p>
        {setup.warnings && setup.warnings.length > 0 && (
          <ul className="list-disc rounded border border-border bg-surface-sunken py-2 pl-8 pr-3 text-xs text-warning" role="status">
            {setup.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {remaining.length > 0 && (
          <div className="flex flex-wrap items-start gap-3 rounded border border-border bg-surface-sunken px-4 py-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">Set up everything with defaults</h3>
              <p className="text-xs text-text-subtle">
                Does every remaining step in one go{setup.saved ? ', keeping what you’ve already chosen' : ''}. Other
                spaces’ work types aren’t affected.
              </p>
              {confirming && (
                <ol className="mt-2 list-decimal pl-5 text-sm">
                  {remaining.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
              )}
              {err && (
                <p className="mt-2 text-sm text-danger" role="alert">
                  {err}
                </p>
              )}
            </div>
            {confirming ? (
              <div className="flex gap-2">
                <Button appearance="primary" onClick={() => void setUpEverything()} isLoading={busy}>
                  Set it up
                </Button>
                <Button appearance="subtle" onClick={() => setConfirming(false)} isDisabled={busy}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button appearance="primary" onClick={() => setConfirming(true)}>
                Set up everything…
              </Button>
            )}
          </div>
        )}
        <WorkTypeStep status={setup.workType} api={api} apply={apply} />
        <FieldsStep status={setup.fields} api={api} apply={apply} />
      </div>
    </section>
  );
}
