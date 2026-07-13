import React from 'react';
import { createRoot } from 'react-dom/client';
import { Settings } from '@ui/surfaces/Settings/index.js';
import '@ui/styles.css';

/** Forge Custom UI entry for the KPI Settings project page. */
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Settings />
  </React.StrictMode>,
);
