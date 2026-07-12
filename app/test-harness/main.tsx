import React from 'react';
import { createRoot } from 'react-dom/client';
import { IssuePanel } from '@ui/surfaces/IssuePanel.js';
import { Settings } from '@ui/surfaces/Settings.js';
import { Timeline } from '@ui/surfaces/Timeline.js';
import '@ui/styles.css';

/**
 * Harness entry — renders a Custom UI surface in a plain browser tab.
 * Pick a surface with ?surface=issue|settings|timeline (&issueId=… for issue).
 */
const params = new URLSearchParams(location.search);
const surface = params.get('surface') ?? 'issue';
const issueId = params.get('issueId') ?? '10048';

const surfaces: Record<string, React.ReactNode> = {
  issue: <IssuePanel issueId={issueId} />,
  settings: <Settings />,
  timeline: <Timeline />,
};

const el = document.getElementById('root')!;
createRoot(el).render(
  <React.StrictMode>
    {surfaces[surface] ?? <div style={{ padding: 16 }}>Unknown surface: {surface}</div>}
  </React.StrictMode>,
);
