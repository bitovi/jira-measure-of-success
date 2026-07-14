/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './test-harness/**/*.{html,ts,tsx}',
    './src/ui/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      // Custom parts (page layout + the bespoke timeline) consume Atlaskit
      // design tokens via CSS variables so they stay visually consistent with
      // the native Atlaskit components and are theme/dark-mode aware.
      colors: {
        surface: 'var(--ds-surface, #ffffff)',
        'surface-sunken': 'var(--ds-surface-sunken, #f7f8f9)',
        border: 'var(--ds-border, #091e4224)',
        text: 'var(--ds-text, #172b4d)',
        'text-subtle': 'var(--ds-text-subtle, #626f86)',
        brand: 'var(--ds-background-brand-bold, #1868db)',
        success: 'var(--ds-text-success, #216e4e)',
        warning: 'var(--ds-text-warning, #a54800)',
        danger: 'var(--ds-text-danger, #ae2e24)',
      },
    },
  },
  plugins: [],
};
