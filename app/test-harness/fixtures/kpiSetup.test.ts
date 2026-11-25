import { describe, expect, it } from 'vitest';
import { createKpiSetupSim, kpiSetupScenario } from './kpiSetup.js';

describe('harness KPI building blocks (spec 11 · 04)', () => {
  it('reads ?setup= and defaults to an upgraded install', () => {
    expect(kpiSetupScenario('?setup=fresh')).toBe('fresh');
    expect(kpiSetupScenario('?setup=broken')).toBe('broken');
    expect(kpiSetupScenario('?setup=bogus')).toBe('upgraded');
    expect(kpiSetupScenario('')).toBe('upgraded');
  });

  it.each([
    ['fresh', { saved: false, workType: 'unset', fields: 'unset', centralSpace: 'unset' }],
    ['upgraded', { saved: false, workType: 'ready', fields: 'unset', centralSpace: 'ready' }],
    ['blocks', { saved: true, workType: 'ready', fields: 'ready', centralSpace: 'unset' }],
    ['configured', { saved: true, workType: 'ready', fields: 'ready', centralSpace: 'ready' }],
    ['broken', { saved: true, workType: 'ready', fields: 'broken', centralSpace: 'ready' }],
  ] as const)('%s', async (scenario, expected) => {
    const s = await createKpiSetupSim(scenario).getKpiSetup();
    expect({ saved: s.saved, workType: s.workType.state, fields: s.fields.state, centralSpace: s.centralSpace.state }).toEqual(expected);
  });

  it('set up everything on a fresh site, then each guide step for another space', async () => {
    let nested = 0;
    const sim = createKpiSetupSim('fresh', { onCentralSpace: () => (nested += 1) });
    const status = await sim.setUpEverything();
    expect([status.workType.state, status.fields.state, status.centralSpace.state]).toEqual(['ready', 'ready', 'ready']);
    expect(nested).toBe(1);
    const [space] = (await sim.getKpiSpaceChoices()).filter((p) => p.key === 'MOBILE');
    expect(await sim.getKpiSpaceSetup(space.id)).toMatchObject({ workType: false, fields: false, screens: false });
    for (const step of ['workType', 'fields', 'screens'] as const) await sim.setUpKpiSpaceStep({ projectId: space.id, step });
    expect(await sim.getKpiSpaceSetup(space.id)).toMatchObject({ workType: true, fields: true, screens: true });
  });
});
