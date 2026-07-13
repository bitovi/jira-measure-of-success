import { describe, expect, it } from 'vitest';
import { isValidProjectKey, normalizeProjectKey } from './projectKey.js';

/**
 * KPI space provisioning uses a Jira project key (storage-model.md). Keys are
 * uppercase, start with a letter, 2–10 chars of letters/digits.
 */
describe('normalizeProjectKey', () => {
  it('uppercases and trims', () => {
    expect(normalizeProjectKey('  kpi ')).toBe('KPI');
    expect(normalizeProjectKey('Kpi')).toBe('KPI');
  });

  it('strips characters Jira keys disallow', () => {
    expect(normalizeProjectKey('kpi-metrics')).toBe('KPIMETRICS');
    expect(normalizeProjectKey('k p i')).toBe('KPI');
  });
});

describe('isValidProjectKey', () => {
  it('accepts valid keys', () => {
    expect(isValidProjectKey('KPI')).toBe(true);
    expect(isValidProjectKey('AB')).toBe(true);
    expect(isValidProjectKey('KPI2')).toBe(true);
    expect(isValidProjectKey('ABCDEFGHIJ')).toBe(true); // 10 chars
  });

  it('rejects invalid keys', () => {
    expect(isValidProjectKey('K')).toBe(false); // too short
    expect(isValidProjectKey('ABCDEFGHIJK')).toBe(false); // 11 chars
    expect(isValidProjectKey('2KPI')).toBe(false); // starts with digit
    expect(isValidProjectKey('kpi')).toBe(false); // lowercase
    expect(isValidProjectKey('KP-I')).toBe(false); // hyphen
    expect(isValidProjectKey('')).toBe(false);
  });
});
