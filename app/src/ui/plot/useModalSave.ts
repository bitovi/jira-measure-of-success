import { useState } from 'react';

/**
 * Save state for a modal whose primary action round-trips to Jira (seconds, not
 * milliseconds). Like Jira's own dialogs, the modal stays open while saving —
 * its button spinning, fields and Cancel disabled — and a failure is shown in
 * place so nothing the user typed is lost. On success the caller unmounts the
 * modal, so no state is touched after `save` resolves.
 */
export function useModalSave() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (save: () => void | Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await save();
    } catch (e) {
      setError(e ?? new Error('Save failed'));
      setSaving(false);
    }
  };
  return { saving, error, clearError: () => setError(null), run };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
