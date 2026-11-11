import { describe, it, expect } from 'vitest';
import {
  buildAxis,
  initialScrollLeft,
  initialViewQuarterStart,
  QUARTER_PX,
  scrollShiftForAxisChange,
} from './axis';

const q = (year: number, month0: number) => Date.UTC(year, month0, 1);

describe('initialViewQuarterStart', () => {
  it('opens on the current quarter once it is a month old', () => {
    expect(initialViewQuarterStart('2026-08-01')).toBe(q(2026, 6)); // Q3 starts Jul 1
    expect(initialViewQuarterStart('2026-09-30')).toBe(q(2026, 6));
  });

  it('opens on the previous quarter during the first month of the current one', () => {
    expect(initialViewQuarterStart('2026-07-01')).toBe(q(2026, 3)); // Q2
    expect(initialViewQuarterStart('2026-07-31')).toBe(q(2026, 3));
  });

  it('crosses the year boundary', () => {
    expect(initialViewQuarterStart('2026-01-15')).toBe(q(2025, 9)); // Q4 2025
    expect(initialViewQuarterStart('2026-02-01')).toBe(q(2026, 0));
  });
});

describe('initialScrollLeft', () => {
  it('puts the chosen quarter at the left edge', () => {
    // data from 2025-01 to 2027-12 → axis starts at Q4 2024
    const axis = buildAxis(['2025-01-10', '2027-12-01'], '2026-08-15');
    const expected = axis.quarters.findIndex((x) => x.startMs === q(2026, 6)) * QUARTER_PX;
    expect(initialScrollLeft(axis, '2026-08-15')).toBeCloseTo(expected, 5);
  });

  it('never goes negative', () => {
    const axis = buildAxis([], '2026-07-10');
    expect(initialScrollLeft(axis, '2026-07-10')).toBeGreaterThanOrEqual(0);
  });
});

describe('extend-only axis (late data must not move what is on screen)', () => {
  const readings = ['2026-01-05', '2026-06-01'];
  const today = '2026-07-10';

  it('a later target only adds quarters on the right: positions are unchanged', () => {
    const before = buildAxis(readings, today);
    const after = buildAxis([...readings, '2028-03-01'], today);
    expect(after.domainStart).toBe(before.domainStart);
    expect(after.xOf('2026-06-01')).toBe(before.xOf('2026-06-01'));
    expect(after.xOf(today)).toBe(before.xOf(today));
    expect(scrollShiftForAxisChange(after, before.domainStart)).toBe(0);
    expect(after.plotWidth).toBeGreaterThan(before.plotWidth);
  });

  it('an earlier target adds quarters on the left: the scroll shift keeps content still', () => {
    const before = buildAxis(readings, today);
    const after = buildAxis([...readings, '2024-02-01'], today);
    expect(before.domainStart - after.domainStart).toBeGreaterThan(0);
    const shift = scrollShiftForAxisChange(after, before.domainStart);
    expect(shift).toBeCloseTo(
      (after.quarters.findIndex((x) => x.startMs === before.domainStart)) * QUARTER_PX,
      5,
    );
    // reading was at x in the old axis; at x + shift in the new one → after
    // scrolling by `shift` it is at the same viewport position.
    expect(after.xOf('2026-06-01') - shift).toBe(before.xOf('2026-06-01'));
  });
});

describe('axis geometry', () => {
  const axis = buildAxis(['2025-02-10', '2026-11-20'], '2026-07-10');

  it('every quarter column is exactly QUARTER_PX wide and gridlines sit on the columns', () => {
    axis.quarters.forEach((quarter, i) => {
      const iso = new Date(quarter.startMs).toISOString().slice(0, 10);
      expect(axis.xOf(iso)).toBeCloseTo(i * QUARTER_PX, 8);
    });
    expect(axis.plotWidth).toBe(axis.quarters.length * QUARTER_PX);
  });

  it('msAt inverts xOf', () => {
    for (const iso of ['2025-02-10', '2026-02-28', '2026-07-10', '2026-11-20']) {
      const back = new Date(axis.msAt(axis.xOf(iso))).toISOString().slice(0, 10);
      expect(back).toBe(iso);
    }
  });

  it('adding quarters to the end of a range leaves existing positions untouched', () => {
    const grown = buildAxis(['2025-02-10', '2026-11-20', '2029-05-01'], '2026-07-10');
    expect(grown.domainStart).toBe(axis.domainStart);
    expect(grown.xOf('2026-02-28')).toBe(axis.xOf('2026-02-28'));
  });
});
