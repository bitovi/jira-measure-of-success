import type { KpiSetupStatus, KpiSpaceStep } from '@domain/index.js';

export interface GuideStep {
  step: KpiSpaceStep | null;
  who: 'Jira admin' | 'Space admin';
  text: string;
  note?: string;
}

/** The guide's steps, naming the site's real work type and fields. */
export function guideSteps(setup: KpiSetupStatus): GuideStep[] {
  const wt = setup.workType.name ?? 'KPI';
  const unit = setup.fields.unit?.name ?? 'KPI Unit';
  const dir = setup.fields.direction?.name ?? 'KPI Direction';
  return [
    {
      step: 'workType',
      who: 'Jira admin',
      text: `Add the ${wt} work type to the space's work type scheme.`,
      note: `If other spaces share that scheme, they'll be offered “${wt}” too. To avoid that, give the space its own copy first.`,
    },
    {
      step: 'fields',
      who: 'Jira admin',
      text: `Add ${unit} and ${dir} to the space's field scheme, for the ${wt} work type only.`,
      note: 'Other work types in spaces that share the scheme don’t get them. KPI Reading is already in every field scheme.',
    },
    {
      step: 'screens',
      who: 'Jira admin',
      text: `Optional: add ${unit} and ${dir} to the screens the space uses for ${wt}, so they show in a KPI's Details.`,
    },
    {
      step: null,
      who: 'Space admin',
      text: `Optional: keep KPIs off boards by adding AND issuetype != "${wt}" to the board filter.`,
    },
  ];
}

/** The guide as plain text, for "Copy instructions" (and the README). */
export function guideText(setup: KpiSetupStatus): string {
  const lines = ['To let a team keep KPIs in their own space (company-managed spaces only):'];
  guideSteps(setup).forEach((s, i) => {
    lines.push(`${i + 1}. [${s.who}] ${s.text}`);
    if (s.note) lines.push(`   ${s.note}`);
  });
  lines.push("Team-managed spaces can't hold KPIs: their work types are private to the space.");
  return lines.join('\n');
}

