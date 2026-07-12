import { describe, it, expect } from 'vitest';
import { Assignment, KpiDefinition, RollupConfig } from '@domain/index.js';
import { CATALOG, ISSUES, ROLLUP_CONFIG } from './hierarchy.js';

/**
 * Fixtures must satisfy the SAME zod schemas the app uses, so the mock bridge
 * can never silently diverge from production data shapes.
 */
describe('harness fixtures validate against domain schemas', () => {
  it('every catalog entry is a valid KpiDefinition', () => {
    for (const def of CATALOG) {
      expect(() => KpiDefinition.parse(def)).not.toThrow();
    }
  });

  it('every issue assignment is a valid Assignment', () => {
    for (const issue of ISSUES) {
      for (const a of issue.assignments) {
        expect(() => Assignment.parse(a)).not.toThrow();
      }
    }
  });

  it('rollup config is a valid RollupConfig', () => {
    expect(() => RollupConfig.parse(ROLLUP_CONFIG)).not.toThrow();
  });
});
