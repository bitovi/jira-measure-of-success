---
name: redeploy-forge
description: Redeploy the "Measure of Success" Jira Forge app to a dev site after code or manifest changes. Use when asked to deploy, redeploy, push to Jira, install/upgrade the app, ship a new module/scope/custom field, or start a live tunnel. Covers Node 22, the Custom UI build, forge deploy/install --upgrade, and the tunnel.
---

# Redeploy Measure of Success (Jira Forge)

Ship local changes to the installed dev site (`bitovi-training.atlassian.net`, `development` environment) and optionally start a live tunnel. All commands run from the `app/` directory unless noted. The Forge CLI, login, and app registration are already set up. The app id is **not** committed: `app/manifest.yml` uses `ari:cloud:ecosystem::app/${APP_ID}`, and `APP_ID` comes from the repo-root `.env`.

## Preconditions (verify, don't assume)

1. **Node 22** — Forge requires it; the repo pins it in `.nvmrc`.
   ```bash
   source ~/.nvm/nvm.sh && nvm use 22 && node -v   # expect v22.x
   ```
   The default shell may be Node 20 — always switch first, in the same command chain as the forge call.
2. **Logged in** (only if a forge command reports auth failure):
   ```bash
   forge settings set usage-analytics false
   set -a && source ../.env && set +a
   forge login --non-interactive -u "$FORGE_EMAIL" -t "$FORGE_API_TOKEN"
   ```
   Never print the token. `.env` is gitignored (`FORGE_EMAIL`, `FORGE_API_TOKEN`, `APP_ID`).
3. **`APP_ID` set in `.env`** — every Forge command that reads the manifest needs it. The npm scripts (`deploy:*`, `tunnel`, and `npm run forge -- <args>`) go through `app/scripts/forge.sh`, which loads `../.env` and fails fast if `APP_ID` is missing. For other forge commands, use `npm run forge -- <command>` (e.g. `npm run forge -- install list`) or `source ../.env` first; bare `forge` without it fails with a vague "validation error".
4. **Docker running** — only needed for `forge tunnel` (NOT for deploy/install):
   ```bash
   docker info >/dev/null 2>&1 && echo "docker up" || open -a Docker
   ```

## Workflow

Create a todo list from these steps; mark each in-progress then completed.

### 1. Build + deploy
Forge serves the frontend from `static/<key>/build`; these are produced by the app's own Vite build, not by `forge deploy`. Use the per-environment npm scripts — each rebuilds the Custom UI and deploys:
```bash
npm run deploy:dev        # development → titles get " (dev)"
npm run deploy:staging    # staging     → titles get " (staging)"
npm run deploy:prod       # production  → no suffix
```
The scripts set the manifest variable `TITLE_SUFFIX`, which is appended to every module title and the KPI Reading field name so dev/staging installs on the same site are distinguishable (e.g. "KPIs (dev)" vs "KPIs (staging)" in the issue app menu). **Don't run bare `forge deploy`** — it falls back to an empty suffix and the environment's titles lose their label.

The deploy runs `forge lint` first. Fix any manifest/code errors and rerun until it prints `✔ Deployed`.

### 2. Install / upgrade the site
If the deploy output says **"new scopes or egress URLs"** (i.e. you added a module, scope, permission, or custom field), you must upgrade the existing install:
```bash
npm run forge -- install --upgrade --non-interactive --site bitovi-training.atlassian.net --product Jira --environment development
```
If nothing about scopes/modules changed, this step is optional — the deploy alone updates code. Confirm state with:
```bash
npm run forge -- install list
```

### 3. (Optional) Live tunnel
For live backend + logs while clicking through the surfaces in Jira:
```bash
npm run tunnel        # = forge tunnel with the " (dev)" title suffix; long-running; Ctrl+C to stop → Jira reverts to the deployed version
```
Run it via the **npm script** so `.env` (`APP_ID`) is loaded and it starts with the app dir as cwd. Backend/resolver edits are live and `console.log`s stream here. UI edits require re-running `npm run build:forge` (the tunnel serves the built static resources). The Node.js runtime tunnel does **not** require Docker.

## Verify (recommended before deploying)
```bash
npx tsc --noEmit && npx vitest run && npx vitest run -c vitest.stories.config.ts && npm run lint
```

## Gotchas / invariants (do NOT regress)

- **Bundler resolution:** Forge's webpack bundler resolves neither `.js` import extensions nor tsconfig path aliases (`@domain`, `@ui`). Everything reachable from `src/index.ts` (the whole `src/backend` + `src/domain` source graph) must use **extensionless, relative** imports (e.g. `../domain/index`, `./jira`). Test files (`*.test.ts`) are not bundled and may keep `.js`. UI surfaces are prebuilt (not forge-bundled) and keep `@ui`/`@domain` + `.js`.
- **`tsconfig.json` `noEmit` must stay `false`** — Forge's ts-loader needs emit. The `typecheck` script still passes `--noEmit` on the CLI, so typechecking is unaffected.
- **Manifest limits:** only one `jira:projectPage` is allowed (Timeline). Settings is a `jira:adminPage`. `jira:issuePanel` needs an `icon`. `jira:entityProperty` uses `propertyKey` + `values[{path,type,searchAlias}]`.
- **Custom fields propagate slowly:** after deploying a new `jira:customField`, allow a couple of minutes and hard-refresh Jira before expecting it on issues.
- Filter CLI noise with `2>&1 | grep -viE "punycode|trace-deprecation"`.
- Do not pipe long-running/interactive forge commands through `tail` — it hides prompts.

## Output
Report like:
```
✓ Redeployed to development (bitovi-training.atlassian.net)
- Deploy: <version>
- Install: <up-to-date | upgraded>
- Tunnel: <running | not started>
```
