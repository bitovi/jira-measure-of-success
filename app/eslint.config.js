import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

/**
 * Flat ESLint config for the app. Keeps the domain layer strict and pure while
 * allowing React/browser globals in the UI. Type-aware rules are intentionally
 * left off (fast, editor-friendly); `tsc --noEmit` remains the type gate.
 */
export default tseslint.config(
  { ignores: ['**/dist/**', 'storybook-static/**', 'coverage/**', 'node_modules/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  // UI (React) — browser globals + hooks rules
  {
    files: ['src/ui/**/*.{ts,tsx}', 'test-harness/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Backend + build/config files — node globals
  {
    files: ['src/backend/**/*.ts', '*.{js,ts}', '.storybook/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests + stories — vitest / storybook globals
  {
    files: ['**/*.test.{ts,tsx}', '**/*.stories.tsx', '**/*.setup.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // Mock bridge deliberately mirrors Forge's untyped invoke(key, payload) seam.
  {
    files: ['test-harness/mock-bridge.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Shared rules
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
