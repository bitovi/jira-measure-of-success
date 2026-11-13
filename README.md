# Measure of Success

A Jira [Forge](https://developer.atlassian.com/platform/forge/) app for tracking KPIs directly on your Jira issue hierarchy. It adds:

- **KPIs** issue panel — attach KPIs to an issue, set targets, and record readings.
- **KPI Timeline** global page — plots KPI targets and readings over time across the hierarchy.
- **KPI Settings** admin page — provisions the KPI space and configures hierarchy/date rollups.

Everything lives under [`app/`](./app): React Custom UI surfaces (`src/ui`), a pure TypeScript domain layer (`src/domain`), and the Forge resolver backend (`src/backend`).

## Prerequisites

- **Node 22** (pinned in [`.nvmrc`](./.nvmrc); Forge requires it): `nvm install && nvm use`
- To run inside Jira:
  - An Atlassian Cloud site where you're a **Jira admin** (a free developer site works: <https://go.atlassian.com/cloud-dev>)
  - The Forge CLI: `npm install -g @forge/cli`
  - An Atlassian API token: <https://id.atlassian.com/manage-profile/security/api-tokens>

## Quick start (no Jira required)

The test harness renders every surface in a normal browser tab against a mock `@forge/bridge` and local fixtures:

```bash
npm --prefix app install
npm --prefix app run dev        # http://localhost:5180/?surface=issue|timeline|settings
npm --prefix app run storybook  # http://localhost:6006
```

## Fork and install your own copy

The Forge app id is **not committed**. `app/manifest.yml` uses `ari:cloud:ecosystem::app/${APP_ID}`, and `APP_ID` comes from a gitignored `.env` at the repo root. Each fork registers its own Forge app; no manifest edits are needed.

What goes in `.env` (none of it is needed for the harness or Storybook):

| Variable | Needed for | Where to get it |
| --- | --- | --- |
| `FORGE_EMAIL` | All Forge CLI commands | The email of your Atlassian account |
| `FORGE_API_TOKEN` | All Forge CLI commands (`forge login`) | An **Atlassian API token** (not a GitHub PAT): <https://id.atlassian.com/manage-profile/security/api-tokens> → **Create API token** |
| `APP_ID` | `deploy`, `install`, `tunnel` | **Generated for you** by `npm run forge -- register` in step 3. Contributors on an existing app copy it from the [Developer console](https://developer.atlassian.com/console/myapps/) instead. |
| `JIRA_BASE_URL`, `E2E_PROJECT_KEY` | Only `npm run test:e2e` | Your site URL and a disposable project key (see `.env.example`) |

1. **Create `.env`** and fill in `FORGE_EMAIL` and `FORGE_API_TOKEN` (leave `APP_ID` as the placeholder for now):

   ```bash
   cp .env.example .env
   ```

2. **Log in to Forge:**

   ```bash
   set -a && source .env && set +a
   forge login --non-interactive -u "$FORGE_EMAIL" -t "$FORGE_API_TOKEN"
   ```

3. **Register your own app** (from `app/`):

   ```bash
   cd app
   npm install
   npm run forge -- register "Measure of Success"
   ```

   `register` creates a new Forge app in your Atlassian account and saves its id to `.env` as `APP_ID`. `manifest.yml` keeps the `${APP_ID}` placeholder, so you have nothing to commit. (Use the npm script, not bare `forge register`: Forge parses the manifest *after* creating the app, and fails partway through if `${APP_ID}` can't resolve.)

   **Already have an app** (e.g. you're a contributor on an existing one)? Skip registering and set `APP_ID` in `.env` yourself. Find it in the [Developer console](https://developer.atlassian.com/console/myapps/): open the app, and the id is the UUID in the page URL (and on **Overview**).

4. **Build and deploy** to the `development` environment:

   ```bash
   npm run deploy:dev
   ```

5. **Install on your Jira site:**

   ```bash
   npm run forge -- install --site <your-site>.atlassian.net --product Jira --environment development
   ```

6. **Set up the app in Jira.** Go to **Jira settings → Apps → KPI Settings (dev)**, enter a project key under **KPI Space**, and click **Create space**. This creates the project and the `KPI` issue type. Then configure the hierarchy and date rollups on the same page.

Then open any issue's **KPIs (dev)** panel, or **Apps → KPI Timeline (dev)**.

> Run Forge commands through the npm scripts (or `npm run forge -- <command>`). They go through [`app/scripts/forge.sh`](./app/scripts/forge.sh), which loads `.env` so the manifest can resolve `${APP_ID}`. A bare `forge deploy` without `APP_ID` in the environment fails with a generic validation error.

## Everyday commands

Run from `app/`:

| Command | What it does |
| --- | --- |
| `npm run dev` | Mock-bridge harness on :5180 |
| `npm run storybook` | Storybook on :6006 |
| `npm test` / `npm run test:all` | Unit tests / unit + story tests |
| `npm run typecheck` / `npm run lint` | Type check / lint |
| `npm run deploy:dev` | Build Custom UI and deploy to `development` (titles get ` (dev)`) |
| `npm run deploy:staging` / `deploy:prod` | Same for `staging` (` (staging)` suffix) / `production` (no suffix) |
| `npm run tunnel` | Live backend + logs against the `development` install (rerun `build:forge` after UI changes) |
| `npm run forge -- <args>` | Any other Forge CLI command with `.env` loaded |
| `npm run test:e2e` | ⚠️ Destructive API test against a live site; see `.env.example` |

After deploying a change that adds scopes, modules, or custom fields, upgrade the install:

```bash
npm run forge -- install --upgrade --site <your-site>.atlassian.net --product Jira --environment development
```
