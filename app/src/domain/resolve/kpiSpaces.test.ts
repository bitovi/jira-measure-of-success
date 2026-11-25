import { describe, it, expect } from 'vitest';
import { defaultKpiCreateSpace, kpiSpacesOf } from './kpiSpaces';
import type { KpiSpaceRef, TimelineNodeDto } from '../contracts';

const KPI: KpiSpaceRef = { id: '10000', key: 'KPI', name: 'KPIs' };
const PORT: KpiSpaceRef = { id: '10400', key: 'PORT', name: 'Portfolio' };

const node = (id: string, space: KpiSpaceRef | undefined, children: TimelineNodeDto[] = []): TimelineNodeDto => ({
  id,
  kpiId: id,
  issueKey: `${space?.key ?? 'X'}-${id}`,
  name: id,
  unit: '',
  direction: null,
  depth: 0,
  targets: [],
  undated: [],
  readings: [],
  children,
  ...(space ? { space } : {}),
});

describe('kpiSpacesOf', () => {
  it('lists each space once, in tree order, nested KPIs included', () => {
    const roots = [node('1', KPI, [node('2', PORT), node('3', KPI)]), node('4', PORT)];
    expect(kpiSpacesOf(roots)).toEqual([KPI, PORT]);
    expect(kpiSpacesOf([node('9', undefined)])).toEqual([]);
  });
});

describe('defaultKpiCreateSpace', () => {
  it('uses the central space when one is set up', () => {
    expect(defaultKpiCreateSpace([node('1', PORT)], KPI)).toEqual({ space: KPI });
  });

  it('else the one space every loaded KPI is in', () => {
    expect(defaultKpiCreateSpace([node('1', PORT, [node('2', PORT)])], null)).toEqual({ space: PORT });
  });

  it('else asks the user to choose a space', () => {
    const many = defaultKpiCreateSpace([node('1', PORT), node('2', KPI)], null);
    expect(many).toEqual({ error: expect.stringMatching(/^Choose a space for the new KPI: .*more than one space\.$/) });
    expect(defaultKpiCreateSpace([], undefined)).toEqual({ error: expect.stringMatching(/^Choose a space for the new KPI/) });
  });
});
