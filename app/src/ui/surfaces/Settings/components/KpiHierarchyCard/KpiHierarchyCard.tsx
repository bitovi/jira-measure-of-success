import { useState } from 'react';
import Button from '@atlaskit/button/new';
import Lozenge from '@atlaskit/lozenge';
import Select from '@atlaskit/select';
import {
  DEFAULT_KPI_LINK_TYPE,
  defaultParentEnd,
  findAppLinkType,
  isDirectionalLinkType,
  linkLabelsForParentEnd,
  type IssueLinkTypeInfo,
  type KpiHierarchyStatus,
  type KpiParentEnd,
  type SaveKpiHierarchyInput,
} from '@domain/index.js';

export interface KpiHierarchyCardProps {
  hierarchy: KpiHierarchyStatus;
  onSave: (input: SaveKpiHierarchyInput) => Promise<KpiHierarchyStatus>;
  onCreate: () => Promise<KpiHierarchyStatus>;
}

const BADGE: Record<
  KpiHierarchyStatus['state'],
  { label: string; appearance: 'default' | 'removed' | 'moved' | 'success' }
> = {
  unset: { label: 'Not set', appearance: 'default' },
  missing: { label: 'Link type deleted', appearance: 'removed' },
  unavailable: { label: 'Unavailable', appearance: 'removed' },
  ready: { label: 'Connected', appearance: 'success' },
};

type TypeOption = { label: string; value: string; type: IssueLinkTypeInfo };
type EndOption = { label: string; value: KpiParentEnd };

// Each option names the label the parent KPI's end of the link carries. Spelling
// the choice as a sentence ("Parent blocks child") reads as nonsense for types
// whose labels are themselves "Parent" / "Child".
const endOptions = (type: IssueLinkTypeInfo): EndOption[] => [
  { label: `“${linkLabelsForParentEnd(type, 'inward').parent}”`, value: 'inward' },
  { label: `“${linkLabelsForParentEnd(type, 'outward').parent}”`, value: 'outward' },
];

/** How Jira's "Linked issues" panel will show the nesting, e.g. children under “blocks”, parent under “is blocked by”. */
function JiraListing({ type, parentEnd }: { type: IssueLinkTypeInfo; parentEnd: KpiParentEnd }) {
  const labels = linkLabelsForParentEnd(type, parentEnd);
  return (
    <>
      In Jira, a KPI lists its children under <strong className="text-text">“{labels.parent}”</strong> and its
      parent under <strong className="text-text">“{labels.child}”</strong>.
    </>
  );
}

const isAppType = (type: IssueLinkTypeInfo) => type.name.toLowerCase() === DEFAULT_KPI_LINK_TYPE.name.toLowerCase();

/**
 * KPI Hierarchy (Settings). KPIs nest via a Jira issue LINK type, and link types
 * are global to the site — so, like the KPI space, an admin either has the app
 * create its own `KPI Hierarchy` type or picks an existing directional one and
 * says which end is the parent.
 */
export function KpiHierarchyCard({ hierarchy, onSave, onCreate }: KpiHierarchyCardProps) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'create' | 'save' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const directional = hierarchy.available.filter(isDirectionalLinkType);
  const initialType = directional.find((t) => t.id === hierarchy.linkTypeId) ?? null;
  const [type, setType] = useState<IssueLinkTypeInfo | null>(initialType);
  const [parentEnd, setParentEnd] = useState<KpiParentEnd>(hierarchy.parentEnd);
  const badge = BADGE[hierarchy.state];
  const appType = findAppLinkType(hierarchy.available);
  const appTypeExists = appType !== null;

  const run = async (which: 'create' | 'save') => {
    setBusy(which);
    setErr(null);
    try {
      const next =
        which === 'create' ? await onCreate() : await onSave({ linkTypeId: type!.id, parentEnd });
      setEditing(false);
      setType(next.linkType);
      setParentEnd(next.parentEnd);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    setEditing(false);
    setType(initialType);
    setParentEnd(hierarchy.parentEnd);
    setErr(null);
  };

  const showEditor = hierarchy.state !== 'ready' || editing;
  const flippedOnly = type?.id === hierarchy.linkTypeId && parentEnd !== hierarchy.parentEnd;
  const typeOptions: TypeOption[] = directional.map((t) => ({ label: t.name, value: t.id, type: t }));
  const unchanged =
    hierarchy.state === 'ready' && type?.id === hierarchy.linkTypeId && parentEnd === hierarchy.parentEnd;

  // What the "Use / Create KPI Hierarchy" button applies (the resolver's
  // provisionDefaultHierarchy): the app type, with the direction its labels imply.
  const defaultEnd = defaultParentEnd(appType);
  const defaultIsCurrent =
    hierarchy.state === 'ready' && appType !== null && appType.id === hierarchy.linkTypeId && defaultEnd === hierarchy.parentEnd;
  const defaultWarning =
    hierarchy.state !== 'ready' || defaultIsCurrent
      ? null
      : appType !== null && appType.id === hierarchy.linkTypeId
        ? `This button also resets the direction: KPIs already nested will be read the other way round — parents become children.`
        : `Switching to “${DEFAULT_KPI_LINK_TYPE.name}”: KPIs already nested with ${hierarchy.linkType?.name} links will lose their nesting.`;

  return (
    <section className="mt-6 rounded-lg border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3">
        <h2 className="text-base font-semibold">KPI Hierarchy</h2>
        <Lozenge appearance={badge.appearance}>{badge.label}</Lozenge>
      </header>
      <div className="px-5 py-4">
        {hierarchy.state === 'ready' && hierarchy.linkType && !editing && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-text-subtle">
              KPIs nest with <strong className="text-text">{hierarchy.linkType.name}</strong> links.{' '}
              <JiraListing type={hierarchy.linkType} parentEnd={hierarchy.parentEnd} />
            </span>
            <Button spacing="compact" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        )}

        {hierarchy.state === 'unavailable' && (
          <p className="text-sm text-text-subtle">
            Couldn’t read this site’s issue link types{hierarchy.message ? `: ${hierarchy.message}` : ''}. KPIs nest
            with issue links — check that issue linking is turned on in Jira settings (Issues → Issue linking).
          </p>
        )}

        {hierarchy.state !== 'unavailable' && showEditor && (
          <>
            <p className="mb-4 text-sm text-text-subtle">
              KPIs nest under each other with a Jira issue link. Link types are shared by the whole site, so
              use a dedicated one, or reuse an existing type.
            </p>
            {hierarchy.state === 'missing' && (
              <p className="mb-4 text-sm text-danger">
                The link type KPIs were nested with was deleted from Jira. Until you pick another, every KPI
                shows as top-level.
              </p>
            )}

            <div className="flex flex-col gap-1">
              <div>
                <Button
                  appearance="primary"
                  onClick={() => run('create')}
                  isDisabled={busy !== null || defaultIsCurrent}
                  isLoading={busy === 'create'}
                >
                  {appTypeExists
                    ? `Use “${DEFAULT_KPI_LINK_TYPE.name}” link type`
                    : `Create “${DEFAULT_KPI_LINK_TYPE.name}” link type`}
                </Button>
              </div>
              <span className="text-xs text-text-subtle">
                Reads “Revenue {DEFAULT_KPI_LINK_TYPE.outward} New Bookings” in Jira. Recommended.
                {defaultIsCurrent && ' Already in use.'}
              </span>
              {defaultWarning && <p className="mt-1 text-xs text-warning">{defaultWarning}</p>}
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <h3 className="text-sm font-medium">Or use an existing link type</h3>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label className="flex w-56 flex-col gap-1 text-sm">
                  <span className="font-medium">Link type</span>
                  <Select<TypeOption>
                    inputId="kpi-hierarchy-type"
                    aria-label="Link type"
                    placeholder="Choose a link type"
                    options={typeOptions}
                    value={typeOptions.find((o) => o.value === type?.id) ?? null}
                    isDisabled={busy !== null}
                    onChange={(o) => {
                      setType(o?.type ?? null);
                      setErr(null);
                    }}
                  />
                </label>
                <label className="flex w-64 flex-col gap-1 text-sm">
                  <span className="font-medium">Parent KPI’s side</span>
                  <Select<EndOption>
                    inputId="kpi-hierarchy-end"
                    aria-label="Parent KPI’s side"
                    isSearchable={false}
                    options={type ? endOptions(type) : []}
                    value={type ? endOptions(type).find((o) => o.value === parentEnd) : null}
                    isDisabled={!type || busy !== null}
                    placeholder="Pick a link type first"
                    onChange={(o) => o && setParentEnd(o.value)}
                  />
                </label>
                <Button
                  onClick={() => run('save')}
                  isDisabled={!type || unchanged || busy !== null}
                  isLoading={busy === 'save'}
                >
                  Use this link type
                </Button>
                {hierarchy.state === 'ready' && (
                  <Button appearance="subtle" onClick={cancel} isDisabled={busy !== null}>
                    Cancel
                  </Button>
                )}
              </div>
              {type && (
                <p className="mt-2 text-xs text-text-subtle">
                  {!isAppType(type) && (
                    <>
                      Every <strong className="text-text">{type.name}</strong> link between two KPIs will be read as
                      nesting.{' '}
                    </>
                  )}
                  <JiraListing type={type} parentEnd={parentEnd} />
                </p>
              )}
              {hierarchy.state === 'ready' && !unchanged && type && (
                <p className="mt-2 text-xs text-warning">
                  {flippedOnly
                    ? 'KPIs already nested will be read the other way round — parents become children.'
                    : `KPIs already nested with ${hierarchy.linkType?.name} links will lose their nesting after this change.`}
                </p>
              )}
            </div>
          </>
        )}
        {err && <p className="mt-2 text-xs text-danger">{err}</p>}
      </div>
    </section>
  );
}
