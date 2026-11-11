import React from 'react';
import { createRoot } from 'react-dom/client';
import { view } from '@forge/bridge';
import { Settings } from '@ui/surfaces/Settings/index.js';
import { configureFeatureFlags } from '@ui/featureFlags.js';
import '@ui/styles.css';

configureFeatureFlags();

/** Forge Custom UI entry for the KPI Settings project page. */
void view.theme.enable().then(() => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Settings />
    </React.StrictMode>,
  );
});
