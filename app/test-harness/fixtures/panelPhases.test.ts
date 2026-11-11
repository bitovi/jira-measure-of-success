import { describe, it, expect } from 'vitest';
import { assemblePanel } from '@domain/index.js';
import { ISSUES } from './hierarchy.js';
import { getPanelData, getPanelList, getPanelValues } from './mock-resolvers.js';

/**
 * The progressive panel (spec 07) must show exactly what the one-shot panel
 * shows once both phases have arrived. The harness `getPanelData` builds rows
 * on its own, so this cross-checks the shared `assemblePanel` against it.
 */
describe('progressive issue panel matches the one-shot panel', () => {
  it.each(ISSUES.map((i) => [i.key, i.id]))('%s', (_key, id) => {
    const list = getPanelList(id);
    const merged = list.panel ?? assemblePanel(list.basis, getPanelValues(id));
    expect(merged).toEqual(getPanelData(id));
  });
});
