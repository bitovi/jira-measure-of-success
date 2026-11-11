import { describe, expect, it } from 'vitest';
import { isValidProjectKey, normalizeProjectKey, projectKeyOfIssueKey } from './projectKey.js';

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

describe('projectKeyOfIssueKey', () => {
  it('extracts the project key prefix from an issue key', () => {
    expect(projectKeyOfIssueKey('INIT-48')).toBe('INIT');
    expect(projectKeyOfIssueKey('OUT-12')).toBe('OUT');
    expect(projectKeyOfIssueKey('ECOM-1029')).toBe('ECOM');
  });

  it('falls back to the whole string when there is no hyphen', () => {
    expect(projectKeyOfIssueKey('WEIRD')).toBe('WEIRD');
  });
});
