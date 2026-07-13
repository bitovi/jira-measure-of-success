/**
 * Jira project-key helpers for the KPI space (storage-model.md). A Jira project
 * key is uppercase, starts with a letter, and is 2–10 letters/digits.
 */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;

/** Coerce free text toward a project key: trim, uppercase, drop invalid chars. */
export function normalizeProjectKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whether `key` is a valid Jira project key (already normalized/uppercase). */
export function isValidProjectKey(key: string): boolean {
  return PROJECT_KEY_RE.test(key);
}
