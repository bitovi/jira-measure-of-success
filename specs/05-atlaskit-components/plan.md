# 05 — Adopt Atlaskit components for standard controls

## Why
[tech-choices.md](../01-initial-build/tech-choices.md) §2/§8 locked "Atlaskit components + design tokens (native Jira look)" with Tailwind (mapped to tokens) only for the custom canvas. The code never implemented it: every surface uses raw `<button>/<input>/<select>` + Tailwind, and `styles.css` carries hard-coded token *fallbacks*. This plan closes that gap.

## Scope
**In:** buttons, text/number/date inputs, selects, checkboxes, modals/dialogs, lozenges/badges, tooltips (`title=`), inline editing in the issue panel (requirements IP-8 / Q10), real `@atlaskit/tokens` theming.
**Out (stay custom + Tailwind-on-tokens):** timeline axis/gridlines/tracks/bars, sparkline, target markers, hover card geometry, page layout. Marker/bar *click targets* that are positioned canvas elements stay raw `<button>`s.
**Non-goals:** behavior changes, domain/backend changes, new features.

## Package set (React 18 compatible, verified `^18.2 || ^19`)
`@atlaskit/tokens`, `button`, `textfield`, `textarea`, `select`, `modal-dialog`, `lozenge`, `inline-edit`, `icon`, `checkbox`, `toggle`, `tooltip`. All installed once in Phase 0 so later parallel phases never touch `package.json`/lockfile.

## Rules for every phase
- Use `@ui/` / `@domain/` aliases; follow the modlet skill (`.claude/skills/create-react-modlet`).
- Keep component public props/behavior unchanged; update tests/stories to query by role/label (not raw element/class).
- Tailwind only for layout/spacing/custom canvas; colors come from `--ds-*` tokens.
- Don't touch files outside the phase's owned set (parallel safety).
- Done = `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:stories` green; surface verified in the mock-bridge harness (`npm run dev`, `?surface=…`) with a clean console, light **and** dark theme.
- Report: files changed, bundle-size delta (`npm run build:forge` output for the touched surface), anything blocked.

## Phases

### Phase 0 — Foundation (blocking; one agent)
Owns: `app/package.json`, lockfile, `app/src/ui/styles.css`, `app/tailwind.config.js`, `app/src/ui/theme.ts` (new), entries (`src/ui/entries/*`), `test-harness/main.tsx`, `.storybook/preview.ts`, `vitest.stories.setup.ts`, vite configs if required.
1. Install package set above.
2. Add `ui/theme.ts`: `enableTheme()` calling `setGlobalTheme({ colorMode: 'auto' })` from `@atlaskit/tokens`; call it from the 3 Forge entries, the harness, and Storybook preview (with a light/dark toolbar toggle).
3. Replace hard-coded `--ds-*` fallbacks in `styles.css` with the real token CSS (keep Tailwind color names; keep `var(--ds-…, fallback)` so jsdom/tests still work). Make sure dark mode applies to `body` background/text.
4. Verify the Forge build (`build:forge`) bundles tokens CSS correctly and is CSP-safe (no external fetches). Record baseline bundle sizes per surface.
5. Make jsdom story tests work with Atlaskit (portals/modals, CSS-in-JS) — fix setup, not tests.

### Phase 1 — Pilot: Settings surface (one agent; gate)
Owns: `src/ui/surfaces/Settings/**`.
Swap to Button, Textfield, Select, Lozenge (as applicable). **Gate:** report bundle delta + light/dark screenshots; lead/user reviews before Phase 2. Append a short "Patterns" section to this file (Select option mapping, Textfield `onChange` types, spacing wrappers) for later phases.

### Phase 2 — Surfaces (two agents in parallel, disjoint files)
- **2a IssuePanel** — owns `src/ui/surfaces/IssuePanel/**`. Buttons, Select, Textfield (number/date), and `InlineEdit` for existing assignment fields per IP-8 (readable by default, edit on click/focus; no row-level Edit mode; absolute/relative target-date control shown in edit mode, IP-7).
- **2b Plot + Timeline + KpiView** — owns `src/ui/plot/modals.tsx`, `src/ui/surfaces/Timeline/**`, `src/ui/surfaces/KpiView/**` (they share modals, so one owner). Replace hand-built `role="dialog"` modals with `@atlaskit/modal-dialog`; toolbar/row buttons → `Button`/`IconButton` (+ `Tooltip` instead of `title`); checkbox → `Checkbox`/`Toggle`; selects/inputs → Atlaskit. Leave bars/axis/sparkline/markers geometry untouched. Watch modal focus-trap vs. the timeline's scroll/hover handlers.

### Phase 3 — Review & cleanup (one agent + code-reviewer)
- Grep for leftover raw `<button|input|select|textarea>` outside allowed canvas elements and duplicated `rounded border …` classes; remove dead CSS.
- Run the `ready-to-push` flow (test, lint, build).
- Update `tech-choices.md` status note and the `styles.css` comment.
- Run `code-reviewer` on the branch diff; fix findings.

## Risks / watch-outs
- Bundle size growth in the Custom UI iframe — measure at Phase 0 baseline, Phase 1, Phase 3.
- Compiled/Emotion CSS vs Tailwind preflight (`@tailwind base`) fighting Atlaskit button/input styles — fix once in Phase 0/1, not per surface.
- Atlaskit modals render in a portal: tests must query `screen`/`document.body`, not the render container.
- `InlineEdit` fit for absolute/relative date + value fields — validate in 2a; if it can't express them, use an Atlaskit-styled inline form and document why.
- The working tree has unrelated uncommitted changes (manifest, backend, domain); agents must not revert or stage them.

## Patterns (from Phase 1 — Settings)
- **Imports:** `Button from '@atlaskit/button/new'` (`appearance="primary"`, `isDisabled`, `isLoading`; loading swaps in a built-in spinner, so drop hand-rolled spinners inside buttons), `Lozenge` (`appearance`: default/success/removed/moved/inprogress/new), `Textfield`, `Select from '@atlaskit/select'`.
- **Select option mapping:** options are `{ label, value }` objects and `value` is the option *object*, not a string. Map domain enums at the call site (`METHOD_ORDER.map(m => ({ label: labels[m], value: m }))`; keep a `type SelectOption = { label: string; value: string }` and pass it as the generic `<Select<SelectOption>>`). `onChange` receives `SelectOption | null` → guard with `o && …`, and cast `o.value` back to the domain type. For a "no value" choice use `value: ''` and map to `null` in the handler. Use `isSearchable={false}` for short lists. Label via `aria-label` or `inputId` + `<label htmlFor>`.
- **Textfield `onChange`:** `(e: FormEvent<HTMLInputElement>)` — read `e.currentTarget.value`. Useful props: `width` ('small'…), `isCompact` (matches 32px Button height in inline rows), `aria-label`, `placeholder`. It has no `className`, so size via `width`/a wrapper; CSS `uppercase` is gone — normalize in the handler.
- **Spacing wrappers:** Atlaskit controls take no `className`; put Tailwind layout (`flex`, `gap-*`, `sm:w-72`, `items-end`) on wrapper `div`s. Select fills its wrapper width.
- **Tests:** keep `role`/label queries. Select's input is visually hidden: in jsdom `userEvent.click(getByRole('combobox', { name }))` then `findByText(optionLabel)` works (menu renders inline unless `menuPortalTarget` is set). In real-browser Playwright use `click({ force: true })` on the visible value text.
- **Gotcha (`vite.forge.config.ts`):** `@atlaskit/button|portal|primitives` pull in `@atlaskit/app-provider`, which imports the *named* export `themeImportMap`; the Phase 0 `theme-import-map` stub must export it (`export const themeImportMap = {}; export default themeImportMap;`) or `build:forge` fails for the Settings surface.
- **Bundle:** Select is the big cost (react-select + top-layer + floating-ui + tag), paid once per surface that uses it; Settings went 396.0 → 661.2 kB JS (111.0 → 190.8 kB gzip).

## 2a notes (IssuePanel)
- **Redesigned to mock v3** ([issue-panel-v3.html](../03-relative-dates-and-values/issue-panel-v3.html), requirements 03 §5.9). Modlets: `IssuePanel/components/TargetCard` (saved card + form preview), `IssuePanel/components/TargetEditor` (value `[Textfield][Select % change|total]` + date `[Textfield][Select months after due date|on a date]`, shared by the form and the inline edit), and pure wording rules in `IssuePanel/targetText.ts` (+ unit tests).
- **One InlineEdit per card, on the bet.** `InlineEdit<TargetDraft>` is *controlled* (`isEditing` + `onEdit`/`onCancel`/`onConfirm`) so the ••• menu's **Edit** can open it. Controlled mode skips InlineEdit's own `editViewRef` focus, so the card focuses the input itself — the date input when the click landed on the date part of the bet (the read view's spans record which part before InlineEdit's read-view click handler runs), else the amount. `editButtonLabel` = `Edit target: <bet>`; no visible `label` (it would render above the read view).
- **Layout quirks:** the read view has a 2px transparent border and Field adds an 8px top margin — the wrapper cancels them (`-mx-1.5 -mt-2`, read view `px-1 py-0.5`) so the bet aligns with the KPI name. ✓/✕ float below the edit view, so the live estimate renders *inside* the edit view and the card adds bottom padding while editing (otherwise they cover the estimate/nudge or hang outside the card).
- **••• menu:** `@atlaskit/dropdown-menu` (added) with `shouldRenderToParent`. The menu returns focus to its trigger on close (even with `returnFocusRef`), which would blur — and auto-confirm — the just-opened inline edit; so Edit sets a flag and the trigger's `onFocus` bounces focus straight back to the amount input (InlineEdit only auto-confirms on a timeout if the edit view hasn't regained focus). Remove confirms in a `ModalDialog` (`appearance="danger"`).
- **Container queries in Tailwind:** use literal arbitrary variants (`[@container(min-width:460px)]:flex`, `[container-type:inline-size]`). Building them from a JS constant in a template string silently generates no CSS (Tailwind can't see the class).
- **Tests:** stories query the bet's inline edit by `/^Edit target/`, ••• by `Actions for <KPI>`, menu items by `menuitem`; estimate lines are split across spans, so match the `<p>`'s full `textContent`. Select menus stay inline (no `menuPortalTarget`) — InlineEdit's blur check is DOM-containment based.
- **Saves aren't optimistic**, so the card shows the confirmed bet (`pending` draft) until the row reloads, and drops it if the save ends without a new row. A relative date never saves a blank `absolute` (`cleanDue`).
- **Bundle (issue-panel):** 877 → 884 kB JS (dropdown-menu).

## 2b notes (Plot + Timeline + KpiView)
- Record/edit/target modals (`plot/modals.tsx`, Timeline) use `@atlaskit/modal-dialog`; inputs → `Textfield`, selects → `@atlaskit/select`, buttons → `Button`, checkbox → `Checkbox`.
- **Icons/glyphs keep their original shapes** (user requirement): row actions stay the text glyphs `+` / `●` / `◇` (now wrapped in a `RowAction` with an Atlaskit `Tooltip`), `✕` clear affordances and the collapse chevron SVG are unchanged. No `@atlaskit/icon` is used in the UI; only use one where it's the same shape.
- Intentionally still raw: collapse chevron button, `RowAction` glyph buttons, marker/bar click targets, and the project-filter listbox items in Timeline (custom dropdown; candidate for `@atlaskit/dropdown-menu`/`popup` later).
- Known harmless dev warning: `react-scrolllock` `defaultProps` warning from ModalDialog.

## Phase 3 results
- `build:forge` (JS / gzip): issue-panel 877 kB / 256 kB, timeline 778 kB / 228 kB, settings 661 kB / 191 kB (post-Phase-0 baseline: ~425 kB / ~118 kB for issue-panel and timeline, 396 kB / 111 kB for settings).
- typecheck, lint, unit (169) and story (50) tests green.

## Icons + project filter notes
- **Icons** (`@atlaskit/icon/core/*`, `label=""` when decorative): direction ▲/▼ → `arrow-up`/`arrow-down` (Timeline row, IssuePanel header: labelled "Higher/Lower is better"; KpiView: decorative next to the "increase/decrease" text); `✕` (Timeline picker clear, error-banner dismiss, `plot/modals.tsx` close) → `cross`; `⚠` → `warning`; `Met ✓`/`Missed ✗` pills → `check-mark`/`cross` + text ("Met"/"Missed"); Timeline collapse chevron svg → `chevron-down`/`chevron-right`; `+ Add KPI` and `+ Track this` → Button `iconBefore={AddIcon}` (labels now "Add KPI"/"Track this"); Settings spinner svg → `@atlaskit/spinner`.
- **Kept on purpose:** Timeline row actions `+` / `●` / `◇`; `↳` notes (no suitable Atlaskit icon); plot/markers.tsx SVG drawing; Jira issue-type `iconUrl`s; plain punctuation.
- **Project filter:** `CheckboxSelect` (`@atlaskit/select`; `@atlaskit/dropdown-menu` is not installed). Non-searchable, `controlShouldRenderValue={false}` with the old label ("Project: All" / "Project: A, B" / "+N more") as the placeholder; an "All" option (checked when nothing is selected) clears the filter (`onChange(null)`). The menu stays open while toggling; Esc/outside click close it. Stories query `getByRole('combobox', { name: 'Filter by Jira project' })` and options via `screen`.
- **Modal selects** (Direction, Parent KPI, Issue): `menuPosition="fixed"` alone was still covered by the modal footer, so they also use a body-level `menuPortalTarget` with `zIndex: 1000` (`MODAL_MENU_PROPS` in Timeline.tsx); verified the menu renders above the dialog.
