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

/**
 * The label Jira's "Linked issues" panel groups a link under on each end, for a
 * parentEnd choice: the parent KPI lists its children under `parent`, a child
 * KPI lists its parent under `child`. With Blocks / `'inward'` that's
 * `{ parent: 'blocks', child: 'is blocked by' }`.
 */
export function linkLabelsForParentEnd(
  type: Pick<IssueLinkTypeInfo, 'inward' | 'outward'>,
  parentEnd: KpiParentEnd,
): { parent: string; child: string } {
  return parentEnd === 'inward'
    ? { parent: type.outward, child: type.inward }
    : { parent: type.inward, child: type.outward };
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

/** The issue at one end of a link, as `issuelinks` returns it (Jira includes the linked issue's type). */
export interface IssueLinkEnd {
  id?: string;
  key?: string;
  fields?: { issuetype?: { id?: string } };
}

/** Minimal shape of a Jira issue link as returned in an issue's `issuelinks`. */
export interface IssueLinkRef {
  /** the link's own id (for `DELETE /rest/api/3/issueLink/{id}`) */
  id?: string;
  type?: { id?: string; name?: string; inward?: string; outward?: string };
  inwardIssue?: IssueLinkEnd;
  outwardIssue?: IssueLinkEnd;
}

/** A hierarchy link on which another issue is the parent: the link id (to remove it) and the parent. */
export interface HierarchyParentLink {
  linkId: string;
  parentId: string;
  parentKey: string | null;
  /** the parent's work type id, when Jira included it */
  parentTypeId: string | null;
}

/** Order link ids numerically (Jira's ids are numbers, possibly longer than 2^53 one day). */
export function compareLinkIds(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every link of the hierarchy type on which another issue is this one's parent,
 * **lowest link id first** (the oldest link: the one-parent rule, spec 11 · 06).
 * Not filtered by project or type: Jira's search lags behind recent changes, so
 * a caller that's about to write looks each parent up to check it's a KPI
 * rather than trusting a search snapshot. Normally at most one.
 */
export function hierarchyParentLinks(
  links: IssueLinkRef[] | undefined,
  hierarchy: KpiHierarchyLink | null,
): HierarchyParentLink[] {
  return parentLinksOf(links, hierarchy).filter((l) => l.linkId !== '');
}

/** Hierarchy parent links, lowest id first; a link without an id (only in hand-built data) sorts last. */
function parentLinksOf(links: IssueLinkRef[] | undefined, hierarchy: KpiHierarchyLink | null): HierarchyParentLink[] {
  if (!hierarchy) return [];
  const out: HierarchyParentLink[] = [];
  for (const link of links ?? []) {
    if (String(link.type?.id ?? '') !== hierarchy.linkTypeId) continue;
    const parent = hierarchy.parentEnd === 'outward' ? link.outwardIssue : link.inwardIssue;
    if (parent?.id) {
      out.push({
        linkId: link.id ? String(link.id) : '',
        parentId: String(parent.id),
        parentKey: parent.key ?? null,
        parentTypeId: parent.fields?.issuetype?.id ? String(parent.fields.issuetype.id) : null,
      });
    }
  }
  return out.sort((a, b) => (a.linkId === '' ? (b.linkId === '' ? 0 : 1) : b.linkId === '' ? -1 : compareLinkIds(a.linkId, b.linkId)));
}

/**
 * Would nesting `kpiId` under `newParentId` make a loop? True when the new
 * parent is the KPI itself or one of its descendants. Walks up from the new
 * parent one level at a time through EVERY parent each KPI has (a reused link
 * type can give a KPI several), asking `parentsOf` for each level in parallel.
 * Throws once the walk passes `maxIssues` KPIs rather than guessing.
 */
export async function wouldCreateKpiCycle(
  kpiId: string,
  newParentId: string,
  parentsOf: (id: string) => Promise<readonly string[]>,
  maxIssues = 500,
): Promise<boolean> {
  const seen = new Set<string>([newParentId]);
  let level = [newParentId];
  while (level.length > 0) {
    if (level.includes(kpiId)) return true;
    const next = (await Promise.all(level.map(parentsOf))).flat().filter((id) => !seen.has(id));
    for (const id of next) seen.add(id);
    if (seen.size > maxIssues) throw new Error(`the KPI hierarchy above ${newParentId} is too deep to check`);
    level = [...new Set(next)];
  }
  return false;
}

/**
 * A KPI's parent KPIs from its `issuelinks` (spec 11 · 06, one-parent rule):
 * hierarchy links whose parent is a KPI, lowest link id first. A parent counts
 * as a KPI when it's in `loadedIds` (the KPIs the caller loaded), or when Jira
 * says its work type is `workTypeId`. Foreign links (other types, the child end,
 * a parent that's no KPI) are ignored, which keeps a reused generic type like
 * "Blocks" safe. A parent the user can't browse never shows up: Jira leaves
 * the link out (01 C2), so the KPI reads as top-level.
 */
export function kpiParentLinks(
  links: IssueLinkRef[] | undefined,
  hierarchy: KpiHierarchyLink | null,
  isKpi: { loadedIds?: ReadonlySet<string>; workTypeId?: string | null },
): HierarchyParentLink[] {
  return parentLinksOf(links, hierarchy).filter(
    (l) =>
      (isKpi.loadedIds?.has(l.parentId) ?? false) ||
      (!!isKpi.workTypeId && l.parentTypeId === isKpi.workTypeId),
  );
}

/**
 * A KPI's sub-KPIs from its `issuelinks` (spec 11 · 07): hierarchy links on
 * which another issue is this one's CHILD, kept when Jira says the child is of
 * the KPI work type (or doesn't say). Ids in link-id order, deduplicated.
 */
export function kpiChildLinks(
  links: IssueLinkRef[] | undefined,
  hierarchy: KpiHierarchyLink | null,
  workTypeId: string | null,
): Array<{ id: string; key: string | null }> {
  if (!hierarchy) return [];
  const out: Array<{ id: string; key: string | null; linkId: string }> = [];
  for (const link of links ?? []) {
    if (String(link.type?.id ?? '') !== hierarchy.linkTypeId) continue;
    const child = hierarchy.parentEnd === 'outward' ? link.inwardIssue : link.outwardIssue;
    if (!child?.id) continue;
    const typeId = child.fields?.issuetype?.id ? String(child.fields.issuetype.id) : null;
    if (workTypeId && typeId && typeId !== workTypeId) continue;
    out.push({ id: String(child.id), key: child.key ?? null, linkId: link.id ? String(link.id) : '' });
  }
  out.sort((a, b) => compareLinkIds(a.linkId, b.linkId));
  const seen = new Set<string>();
  return out.filter((c) => !seen.has(c.id) && seen.add(c.id)).map(({ id, key }) => ({ id, key }));
}

/**
 * Resolve a KPI's parent id from its `issuelinks`: the **lowest-id** hierarchy
 * link whose parent is another loaded KPI (`inSetIds`), so every surface agrees
 * whatever order Jira lists the links in. Returns null for a root KPI (no
 * qualifying link, or its parent wasn't loaded), or when no hierarchy link is
 * configured.
 */
export function parentFromIssueLinks(
  links: IssueLinkRef[] | undefined,
  inSetIds: ReadonlySet<string>,
  hierarchy: KpiHierarchyLink | null,
): string | null {
  return kpiParentLinks(links, hierarchy, { loadedIds: inSetIds })[0]?.parentId ?? null;
}

/** An issue in a link request: by id (digits) or by key. */
export type IssueLinkRequestEnd = { id: string } | { key: string };

const linkEnd = (idOrKey: string): IssueLinkRequestEnd => (/^\d+$/.test(idOrKey) ? { id: idOrKey } : { key: idOrKey });

/** The `POST /rest/api/3/issueLink` body that nests `child` under `parent` (each an issue id or key). */
export function kpiParentLinkBody(
  hierarchy: KpiHierarchyLink,
  parent: string,
  child: string,
): { type: { id: string }; inwardIssue: IssueLinkRequestEnd; outwardIssue: IssueLinkRequestEnd } {
  return hierarchy.parentEnd === 'outward'
    ? { type: { id: hierarchy.linkTypeId }, inwardIssue: linkEnd(child), outwardIssue: linkEnd(parent) }
    : { type: { id: hierarchy.linkTypeId }, inwardIssue: linkEnd(parent), outwardIssue: linkEnd(child) };
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
