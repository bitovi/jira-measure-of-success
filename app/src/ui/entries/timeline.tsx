import React from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { Timeline } from '@ui/surfaces/Timeline/index.js';
import { prefetchTimeline } from '@ui/data/useTimelineData/index.js';
import { configureFeatureFlags } from '@ui/featureFlags.js';
import '@ui/styles.css';

configureFeatureFlags();

/**
 * Forge Custom UI entry for the KPI Timeline project page. The data requests
 * start NOW, in parallel with enabling the theme and mounting React, instead of
 * after the first render (spec 06 P7).
 */
prefetchTimeline();
void view.theme.enable().then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Timeline />
    </React.StrictMode>,
  );
});
