import Button from '@atlaskit/button/new';
import CrossIcon from '@atlaskit/icon/core/cross';
import type { TimelineActionError } from '@ui/data/useTimelineData/index.js';

/** Errors a Jira admin fixes in Settings: shown with an "Open Settings" button instead of the raw message. */
export const SETUP_ERRORS = {
  'type-not-set-up': {
    title: 'No KPI work type configured yet',
    body: 'Choose the work type KPIs use in Settings (KPI building blocks), then try again.',
  },
  'hierarchy-not-set-up': {
    title: 'KPI nesting isn’t set up',
    body: 'Choose the Jira issue link type that nests KPIs in Settings, then try again — or leave the parent empty.',
  },
} as const;

/** A save that failed, inside its dialog (setup errors offer Open Settings). */
export function ActionErrorBanner({
  error,
  onDismiss,
  onOpenSettings,
}: {
  error: TimelineActionError;
  onDismiss: () => void;
  onOpenSettings: () => void | Promise<void>;
}) {
  const setup = error.kind === 'generic' ? null : SETUP_ERRORS[error.kind];
  return (
    <div role="alert" className="mt-4 flex items-start gap-3 rounded-lg border border-danger bg-surface px-4 py-3 text-sm">
      <div className="flex-1">
        <p className="font-semibold text-danger">{setup ? setup.title : 'Couldn’t save your change'}</p>
        <p className="mt-0.5 text-text-subtle">{setup ? setup.body : error.message}</p>
        {setup && (
          <div className="mt-2">
            <Button appearance="primary" onClick={() => void onOpenSettings()}>
              Open Settings
            </Button>
          </div>
        )}
      </div>
      <Button appearance="subtle" spacing="compact" aria-label="Dismiss" onClick={onDismiss}>
        <CrossIcon label="" size="small" />
      </Button>
    </div>
  );
}
