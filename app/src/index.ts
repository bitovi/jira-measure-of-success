/** Forge function entry point. Manifest `function.handler: index.handler`. */
export { handler } from './backend/resolver';
// TEMPORARY (spec 11 · 01 spikes): removed in 01 Step 5.
export { spikeTriggerAll, spikeTriggerFiltered } from './backend/spike';
