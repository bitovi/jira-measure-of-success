import CheckCircleIcon from '@atlaskit/icon/core/check-circle';
import CrossIcon from '@atlaskit/icon/core/cross';

/**
 * Jira's success flag after Add KPI (spec 11 · 08): names the new KPI by key
 * and name (overview Q7) and its space. When the page's filters hide it, says
 * so and offers **Show it**.
 */
export function CreatedFlag({
  kpiKey,
  name,
  spaceLabel,
  hidden,
  onShow,
  onOpen,
  onDismiss,
}: {
  kpiKey: string;
  name: string;
  /** `{space name} ({KEY})` */
  spaceLabel: string | null;
  /** the KPI space filter (or Work from) hides the new KPI */
  hidden: boolean;
  onShow: () => void;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="fixed bottom-6 left-6 z-[800] grid w-[400px] max-w-[calc(100vw-48px)] grid-cols-[20px_1fr_24px] gap-x-3 gap-y-1 rounded-md bg-[var(--ds-surface-overlay,#ffffff)] px-4 py-3.5 text-sm text-text shadow-[0_8px_12px_#1e1f2126,0_0_1px_#1e1f214f]"
    >
      <span className="text-success">
        <CheckCircleIcon label="" />
      </span>
      <span className="font-semibold">
        <span className="font-normal text-[var(--ds-link,#1868db)]">{kpiKey}</span> {name} created
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="grid h-6 w-6 place-items-center rounded text-text-subtle hover:bg-[var(--ds-background-neutral-subtle-hovered,#0515240f)]"
      >
        <CrossIcon label="" size="small" />
      </button>
      <span className="col-start-2 text-text-subtle">
        {spaceLabel ? `In ${spaceLabel}.` : ''}
        {hidden ? ' It’s hidden by the filters.' : ''}
      </span>
      <span className="col-start-2 mt-1 flex gap-3">
        {hidden && (
          <button type="button" onClick={onShow} className="font-medium text-[var(--ds-link,#1868db)] hover:underline">
            Show it
          </button>
        )}
        <button type="button" onClick={onOpen} className="font-medium text-[var(--ds-link,#1868db)] hover:underline">
          Open KPI
        </button>
      </span>
    </div>
  );
}
