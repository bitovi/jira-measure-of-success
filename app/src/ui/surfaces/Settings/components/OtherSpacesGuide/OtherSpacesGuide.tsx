import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import type { KpiSetupStatus, KpiSpaceChoice, KpiSpaceSetupStatus, KpiSpaceStep } from '@domain/index.js';
import type { KpiSetupApi } from '@ui/data/useKpiSetupData/index.js';
import { errorText } from '../KpiBuildingBlocks/index.js';
import { guideSteps, guideText, type GuideStep } from './guideText.js';

type Option = { label: string; value: string };

export interface OtherSpacesGuideProps {
  setup: KpiSetupStatus;
  api: KpiSetupApi;
}

/**
 * Settings → Using KPIs in other spaces (spec 11 · 04): generated steps naming
 * the real work type and fields, and — for a Jira admin — each step done for a
 * chosen space ("Do it for {space}").
 */
export function OtherSpacesGuide({ setup, api }: OtherSpacesGuideProps) {
  const ready = setup.workType.state === 'ready' && setup.fields.state === 'ready';
  const steps = guideSteps(setup);
  const [copied, setCopied] = useState(false);
  const [choices, setChoices] = useState<KpiSpaceChoice[] | null>(null);
  const [picked, setPicked] = useState<Option | null>(null);
  const [space, setSpace] = useState<KpiSpaceSetupStatus | null>(null);
  const [busy, setBusy] = useState<KpiSpaceStep | 'load' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(guideText(setup));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const loadChoices = async () => {
    if (choices) return;
    try {
      setChoices(await api.getKpiSpaceChoices());
    } catch (e) {
      setErr(errorText(e));
    }
  };

  const pick = async (o: Option | null) => {
    setPicked(o);
    setSpace(null);
    setErr(null);
    if (!o) return;
    setBusy('load');
    try {
      setSpace(await api.getKpiSpaceSetup(o.value));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const doStep = async (step: KpiSpaceStep) => {
    if (!space) return;
    setBusy(step);
    setErr(null);
    try {
      setSpace(await api.setUpKpiSpaceStep({ projectId: space.projectId, step }));
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface" aria-labelledby="kpi-other-spaces">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h2 id="kpi-other-spaces" className="text-base font-semibold">
          Using KPIs in other spaces
        </h2>
        <Lozenge>Guide</Lozenge>
        <span className="flex-1" />
        <Button appearance="subtle" onClick={() => void copy()} isDisabled={!ready}>
          {copied ? 'Copied' : 'Copy instructions'}
        </Button>
      </header>
      <div className="px-5 py-4 text-sm">
        {!ready && (
          <p className="mb-2 text-warning">Finish the KPI work type and KPI fields first. These steps refer to them.</p>
        )}
        <div className={ready ? '' : 'opacity-50'}>
          <p className="text-text-subtle">To let a team keep KPIs in their own space (company-managed spaces only):</p>
          <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5">
            {steps.map((s) => (
              <li key={s.text}>
                <span
                  className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                    s.who === 'Jira admin' ? 'bg-surface-sunken text-danger' : 'bg-surface-sunken text-success'
                  }`}
                >
                  {s.who}
                </span>
                {s.text}
                {s.note && <div className="text-xs text-text-subtle">{s.note}</div>}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-text-subtle">
            Team-managed spaces can’t hold KPIs: their work types are private to the space.
          </p>
        </div>

        {ready && (
          <div className="mt-4 rounded border border-border p-3">
            <h3 className="text-sm font-semibold">Do it for a space</h3>
            <p className="text-xs text-text-subtle">As a Jira admin, the app can do the steps above for you.</p>
            <div className="mt-2 max-w-md">
              <Select<Option>
                inputId="kpi-guide-space"
                aria-label="Space"
                options={(choices ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.id }))}
                isLoading={choices === null}
                onMenuOpen={() => void loadChoices()}
                onFocus={() => void loadChoices()}
                value={picked}
                onChange={(o) => void pick(o)}
                placeholder="Choose a space"
              />
            </div>
            {busy === 'load' && <p className="mt-2 text-xs text-text-subtle">Checking the space…</p>}
            {space && (
              <ul className="mt-3 flex flex-col gap-2" aria-label={`Steps for ${space.key}`}>
                {steps
                  .filter((s): s is GuideStep & { step: KpiSpaceStep } => s.step !== null)
                  .map((s, i) => {
                    const done = space[s.step];
                    return (
                      <li key={s.step} className="flex flex-wrap items-center gap-2">
                        <span className="w-4 text-text-subtle">{i + 1}.</span>
                        <span className="min-w-0 flex-1">{s.text}</span>
                        {done === true ? (
                          <Lozenge appearance="success">Done</Lozenge>
                        ) : done === false ? (
                          <Button
                            spacing="compact"
                            onClick={() => void doStep(s.step)}
                            isLoading={busy === s.step}
                            isDisabled={busy !== null}
                          >
                            {`Do it for ${space.key}`}
                          </Button>
                        ) : (
                          <Lozenge>Can’t check</Lozenge>
                        )}
                      </li>
                    );
                  })}
              </ul>
            )}
            {space?.problem && <p className="mt-2 text-xs text-warning">{space.problem}</p>}
          </div>
        )}
        {err && (
          <p className="mt-2 text-danger" role="alert">
            {err}
          </p>
        )}
      </div>
    </section>
  );
}
