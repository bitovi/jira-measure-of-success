import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { IssuePanel } from '@ui/surfaces/IssuePanel/index.js';
import '@ui/styles.css';

/**
 * Forge Custom UI entry for the Issue panel. Unlike the local harness (which
 * reads ?issueId=…), the real surface gets the issue id from the Forge bridge
 * context (`view.getContext()`).
 */
interface IssueContext {
  extension?: { issue?: { id?: string | number } };
}

function Root() {
  const [issueId, setIssueId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    view
      .getContext()
      .then((ctx) => {
        const id = (ctx as unknown as IssueContext).extension?.issue?.id;
        if (id == null) throw new Error('No issue in context');
        setIssueId(String(id));
      })
      .catch((e: unknown) => setError(String(e)));
  }, []);

  if (error) return <div className="p-4 text-danger">Failed to load: {error}</div>;
  if (issueId == null) return <div className="p-4 text-text-subtle">Loading…</div>;
  return <IssuePanel issueId={issueId} />;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
