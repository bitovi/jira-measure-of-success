/** The central space reads as "Global KPIs" (07). */
export function kpiSpaceName(space: { key: string; name: string }, centralSpaceKey: string | null | undefined): string {
  return centralSpaceKey && space.key === centralSpaceKey ? 'Global KPIs' : space.name;
}
