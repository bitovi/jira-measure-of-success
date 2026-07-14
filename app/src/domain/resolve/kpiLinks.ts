/**
 * KPI hierarchy over native Jira issue links.
 *
 * `KPI` is a standard issue type (hierarchy level 0), and Jira forbids a
 * standard issue from being the native `parent` of another standard issue
 * ("Please select valid parent issue"). So the KPI tree is expressed with the
 * built-in **`Parent`** issue-link type (outward "Parent" / inward "Child")
 * instead: a link whose OUTWARD end is the parent KPI and INWARD end is the
 * child KPI. Links are unconstrained by issue-type level, standard REST, and
 * visible in Jira's "Linked issues" panel.
 *
 * This module is pure so the (fiddly) link-direction logic is unit-tested
 * without a live site.
 */

/** Built-in link type used for KPI parent/child edges. */
export const KPI_PARENT_LINK_TYPE = 'Parent';

/** Minimal shape of a Jira issue link as returned in an issue's `issuelinks`. */
export interface IssueLinkRef {
  type?: { name?: string; inward?: string; outward?: string };
  inwardIssue?: { id?: string; key?: string };
  outwardIssue?: { id?: string; key?: string };
}

/**
 * Resolve a KPI issue's parent id from its `issuelinks`, considering only
 * `Parent`-typed links whose parent end is another issue in the KPI space.
 *
 * On a CHILD issue, the parent (the link's outward end) is returned by Jira as
 * `outwardIssue`, so that's what we read. Foreign links (other types, or a
 * parent outside the KPI project) are ignored, which keeps the built-in generic
 * `Parent` type safe to reuse. Returns null for a root KPI (no qualifying link).
 */
export function parentFromIssueLinks(
  links: IssueLinkRef[] | undefined,
  inProjectIds: ReadonlySet<string>,
  linkTypeName: string = KPI_PARENT_LINK_TYPE,
): string | null {
  for (const link of links ?? []) {
    if (link.type?.name !== linkTypeName) continue;
    const parentId = link.outwardIssue?.id;
    if (parentId && inProjectIds.has(String(parentId))) return String(parentId);
  }
  return null;
}
