/**
 * KPI hierarchy over native Jira issue links.
 *
 * `KPI` is a standard issue type (hierarchy level 0), and Jira forbids a
 * standard issue from being the native `parent` of another standard issue
 * ("Please select valid parent issue"). So the KPI tree is expressed with an
 * issue LINK type instead. Link types are global to the site and admin-managed,
 * so which type (and which of its ends is the parent) is configurable in
 * Settings: the app can create its own `KPI Hierarchy` type, or reuse any
 * existing directional type (e.g. "Blocks"). Links are unconstrained by
 * issue-type level, standard REST, and visible in Jira's "Linked issues" panel.
 *
 * Direction model (Jira REST): a link POSTed as `{ inwardIssue: A, outwardIssue: B }`
 * reads "A <type.outward> B". On A's `issuelinks` it appears with
 * `outwardIssue: B`; on B's with `inwardIssue: A`. `parentEnd` names the end the
 * PARENT sits on:
 *  - `'outward'` → "child <outward> parent"; the child's link has `outwardIssue` = parent.
 *  - `'inward'`  → "parent <outward> child"; the child's link has `inwardIssue` = parent.
 *
 * This module is pure so the (fiddly) link-direction logic is unit-tested
 * without a live site.
 */

import type { KpiHierarchyLink, KpiParentEnd } from '../models/kpiHierarchy';

/**
 * Prefix of the error `createKpi` throws when asked to nest a KPI before a
 * hierarchy link type is configured; the UI matches on it to offer "Open Settings".
 */
export const KPI_HIERARCHY_NOT_SET_UP = 'KPI hierarchy is not set up';

/** An issue link type as Jira describes it (`GET /rest/api/3/issueLinkType`). */
export interface IssueLinkTypeInfo {
  id: string;
  name: string;
  /** e.g. "is blocked by" */
  inward: string;
  /** e.g. "blocks" */
  outward: string;
}

/** The link type the app creates when asked to (Settings → KPI hierarchy → Create). */
export const DEFAULT_KPI_LINK_TYPE = {
  name: 'KPI Hierarchy',
  outward: 'is the parent KPI of',
  inward: 'is a child KPI of',
  parentEnd: 'inward' as KpiParentEnd,
} as const;

/**
 * A type can carry the hierarchy only if its two ends read differently — with a
 * symmetric type like "Relates" ("relates to" both ways) nobody editing links in
 * Jira can tell which end is the parent.
 */
export function isDirectionalLinkType(type: Pick<IssueLinkTypeInfo, 'inward' | 'outward'>): boolean {
  return type.inward.trim().toLowerCase() !== type.outward.trim().toLowerCase();
}

/** "Parent blocks child" / "Child blocks parent" — how a parentEnd choice reads with a type's labels. */
export function describeParentEnd(type: Pick<IssueLinkTypeInfo, 'outward'>, parentEnd: KpiParentEnd): string {
  return parentEnd === 'inward' ? `Parent ${type.outward} child` : `Child ${type.outward} parent`;
}

/**
 * Which end is the parent when the app adopts (or creates) its `KPI Hierarchy`
 * type. A pre-existing same-named type may have its labels the other way round
 * ("is a child KPI of" as its outward label). Shared by the resolver, which
 * applies it, and Settings, which warns about what it would change.
 */
export function defaultParentEnd(type: Pick<IssueLinkTypeInfo, 'outward'> | null): KpiParentEnd {
  const reversed = type?.outward.trim().toLowerCase() === DEFAULT_KPI_LINK_TYPE.inward.toLowerCase();
  return reversed ? 'outward' : DEFAULT_KPI_LINK_TYPE.parentEnd;
}

/** The app's own `KPI Hierarchy` type among a site's link types (matched by name), if it exists. */
export function findAppLinkType<T extends Pick<IssueLinkTypeInfo, 'name'>>(types: readonly T[]): T | null {
  return types.find((t) => t.name.toLowerCase() === DEFAULT_KPI_LINK_TYPE.name.toLowerCase()) ?? null;
}

/** Minimal shape of a Jira issue link as returned in an issue's `issuelinks`. */
export interface IssueLinkRef {
  type?: { id?: string; name?: string; inward?: string; outward?: string };
  inwardIssue?: { id?: string; key?: string };
  outwardIssue?: { id?: string; key?: string };
}

/**
 * Resolve a KPI issue's parent id from its `issuelinks`, considering only links
 * of the configured hierarchy type whose parent end is another issue in the KPI
 * space. Foreign links (other types, the child end, or a parent outside the KPI
 * project) are ignored, which keeps a reused generic type like "Blocks" safe for
 * links that don't involve two KPIs. Returns null for a root KPI (no qualifying
 * link), or when no hierarchy link is configured.
 */
export function parentFromIssueLinks(
  links: IssueLinkRef[] | undefined,
  inProjectIds: ReadonlySet<string>,
  hierarchy: KpiHierarchyLink | null,
): string | null {
  if (!hierarchy) return null;
  for (const link of links ?? []) {
    if (String(link.type?.id ?? '') !== hierarchy.linkTypeId) continue;
    const parentId = (hierarchy.parentEnd === 'outward' ? link.outwardIssue : link.inwardIssue)?.id;
    if (parentId && inProjectIds.has(String(parentId))) return String(parentId);
  }
  return null;
}

/** The `POST /rest/api/3/issueLink` body that nests `childKey` under `parentKey`. */
export function kpiParentLinkBody(
  hierarchy: KpiHierarchyLink,
  parentKey: string,
  childKey: string,
): { type: { id: string }; inwardIssue: { key: string }; outwardIssue: { key: string } } {
  return hierarchy.parentEnd === 'outward'
    ? { type: { id: hierarchy.linkTypeId }, inwardIssue: { key: childKey }, outwardIssue: { key: parentKey } }
    : { type: { id: hierarchy.linkTypeId }, inwardIssue: { key: parentKey }, outwardIssue: { key: childKey } };
}

/**
 * Make the parent pointers a forest. A reused generic type (e.g. "Blocks") can
 * link KPIs in a loop (A → B → A); every member of a loop then has a parent, so
 * none would be a root and the whole loop would vanish from the tree. For each
 * loop, the first member (in input order) is promoted to a root. Parents outside
 * `items` are left alone (callers already treat them as roots).
 */
export function breakParentCycles<T extends { id: string; parentId: string | null }>(items: T[]): T[] {
  const parentOf = new Map(items.map((i) => [i.id, i.parentId]));
  const settled = new Set<string>();
  for (const item of items) {
    const path: string[] = [];
    const onPath = new Set<string>();
    let cur: string | null = item.id;
    while (cur !== null && parentOf.has(cur) && !settled.has(cur)) {
      if (onPath.has(cur)) {
        // `cur` closes a loop: promote the loop member that comes first in input order.
        const loop = path.slice(path.indexOf(cur));
        const first = items.find((i) => loop.includes(i.id))!;
        parentOf.set(first.id, null);
        break;
      }
      onPath.add(cur);
      path.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    for (const id of path) settled.add(id);
  }
  return items.map((i) => (parentOf.get(i.id) === i.parentId ? i : { ...i, parentId: null }));
}
