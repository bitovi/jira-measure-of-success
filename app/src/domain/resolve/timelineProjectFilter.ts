import type { TimelineNodeDto, TimelineTargetDto } from '../contracts';
import { projectKeyOfIssueKey } from './projectKey';

/**
 * Timeline project filter (contributing issues can live in ANY Jira project —
 * unlike the single dedicated KPI space project). Purely derived from the
 * already-loaded `TimelineData`: a contributing issue's project key comes from
 * its issue key (`{PROJECTKEY}-{number}`), so no extra Jira REST field is
 * needed. See specs/bug-fixes and domain/resolve/projectKey.ts for the KPI
 * space's own (unrelated) project key concept.
 */

function projectKeysOfTargets(targets: TimelineTargetDto[]): string[] {
  return targets.map((t) => projectKeyOfIssueKey(t.source.issue));
}

/**
 * Every distinct project key contributing a target (dated or undated) to any
 * KPI in the tree — own targets AND descendants'. Used to populate the
 * filter's option list.
 */
export function collectContributingProjects(roots: TimelineNodeDto[]): string[] {
  const found = new Set<string>();
  const walk = (nodes: TimelineNodeDto[]) => {
    for (const node of nodes) {
      for (const key of projectKeysOfTargets(node.targets)) found.add(key);
      for (const key of projectKeysOfTargets(node.undated)) found.add(key);
      walk(node.children);
    }
  };
  walk(roots);
  return [...found].sort();
}

/** Only the targets whose contributing project is in `selected`. */
function matchingTargets(
  targets: TimelineTargetDto[],
  selected: ReadonlySet<string>,
): TimelineTargetDto[] {
  return targets.filter((t) => selected.has(projectKeyOfIssueKey(t.source.issue)));
}

/**
 * Filter the KPI tree by contributing-issue project key(s). Subtree match: a
 * node is kept if IT or ANY descendant has a matching target; non-matching
 * nodes are removed entirely (not just hidden) and the tree is re-nested from
 * the surviving nodes. Within a kept node, its OWN `targets`/`undated` are
 * also narrowed down to just the matching ones — so a KPI kept for ancestor
 * context (or that has a mix of matching and non-matching targets) only shows
 * markers from the selected project(s). `selected` of `null` or empty means
 * "All" — the tree is returned unchanged.
 */
export function filterTimelineByProjects(
  roots: TimelineNodeDto[],
  selected: ReadonlySet<string> | null,
): TimelineNodeDto[] {
  if (!selected || selected.size === 0) return roots;

  const filterNodes = (nodes: TimelineNodeDto[]): TimelineNodeDto[] => {
    const kept: TimelineNodeDto[] = [];
    for (const node of nodes) {
      const filteredChildren = filterNodes(node.children);
      const targets = matchingTargets(node.targets, selected);
      const undated = matchingTargets(node.undated, selected);
      const matches = targets.length > 0 || undated.length > 0 || filteredChildren.length > 0;
      if (matches) kept.push({ ...node, targets, undated, children: filteredChildren });
    }
    return kept;
  };

  return filterNodes(roots);
}
