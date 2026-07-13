import React from 'react';
import { createRoot } from 'react-dom/client';
import { Timeline } from '@ui/surfaces/Timeline/index.js';
import '@ui/styles.css';

/** Forge Custom UI entry for the KPI Timeline project page. */
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Timeline />
  </React.StrictMode>,
);
