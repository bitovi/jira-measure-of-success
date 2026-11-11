import { configureFeatureFlags } from './featureFlags';
import { setGlobalTheme } from '@atlaskit/tokens/set-global-theme';
import light from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-light';
import dark from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-dark';
import spacing from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-spacing';
import typography from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-typography';
import shape from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-shape';
import motion from '@atlaskit/tokens/dist/esm/artifacts/themes/atlassian-motion';

configureFeatureFlags();

export type ColorMode = 'light' | 'dark' | 'auto';

/**
 * Theme CSS is statically imported (a string per theme) and injected as inline
 * `<style data-theme>` tags by our own loader. `setGlobalTheme`'s default
 * loader instead lazy-loads ~25 theme chunks via dynamic `import()`, which
 * flashes unthemed content and adds requests inside the Forge iframe.
 */
const THEME_CSS: Record<string, string> = {
  light,
  dark,
  spacing,
  typography,
  shape,
  motion,
};

function appendThemeCss(id: string): void {
  const css = THEME_CSS[id];
  if (css === undefined || document.head.querySelector(`style[data-theme="${id}"]`)) return;
  const style = document.createElement('style');
  style.textContent = css;
  style.dataset.theme = id;
  document.head.appendChild(style);
}

/**
 * Local-only (test harness + Storybook). In Jira the Forge entries call
 * `view.theme.enable()` instead, so tokens follow the host's theme.
 *
 * Applies the Atlaskit design-token themes (sets `data-theme` and
 * `data-color-mode` on `<html>`), following the OS light/dark preference by
 * default. Safe to call repeatedly (e.g. a Storybook theme toggle).
 */
export function enableTheme(colorMode: ColorMode = 'auto'): Promise<unknown> {
  return setGlobalTheme({ colorMode }, appendThemeCss);
}
