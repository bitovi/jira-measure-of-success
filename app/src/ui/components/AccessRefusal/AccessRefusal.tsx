import Button from '@atlaskit/button/new';

/**
 * A KPI action the user's permissions in that KPI's space don't allow (spec
 * 11 · 06): shown instead of the action's dialog, once the space's access has
 * been looked up. `message` names the permission and the space.
 */
export function AccessRefusal({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-md border border-warning px-3 py-2 text-sm">
      <div className="flex-1">
        <p className="font-semibold text-text">You can’t do that in this KPI’s space</p>
        <p className="mt-0.5 text-text-subtle">{message}</p>
      </div>
      <Button appearance="subtle" spacing="compact" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}
