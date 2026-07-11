# AWS Spark Notebooks

A VS Code / Cursor extension for running **PySpark** and **Spark SQL** in `.sparknb` and `.ipynb` notebooks on **Amazon EMR Serverless** and **AWS Glue Interactive Sessions**, both backed by **Apache Livy**.

## Features

- Native notebook experience with Python and SQL cell languages
- **Two Spark backends:** EMR Serverless (Livy on managed applications) and Glue Interactive Sessions (Livy on Glue)
- Sidebar to manage EMR applications, Glue sessions, AWS credentials, and session presets
- Attach to existing sessions or create new ones with configurable **Session Presets** (per backend)
- Interactive DataFrame tables with sort, filter, and CSV export
- Spark UI links for both backends
- Iceberg + Glue Data Catalog configuration merged into new sessions
- Jupyter-compatible `.ipynb` support alongside `.sparknb`
- Status bar Spark UI shortcut when connected; AWS profile and region in the sidebar

## Prerequisites

- VS Code 1.88+ or Cursor
- Node.js 18+ (for building from source)
- AWS CLI credentials configured locally (`~/.aws/credentials` and `~/.aws/config` with a default **region**)
- IAM permissions for the backend(s) you use (see [IAM permissions](#iam-permissions))
- A job **execution role** ARN with `iam:PassRole`

**For EMR Serverless:**

- An existing EMR Serverless **Spark** application with `interactiveConfiguration.livyEndpointEnabled: true` (EMR **6.14+**)

**For Glue Interactive Sessions:**

- An IAM role that Glue can assume for interactive sessions (configure in settings or Glue session presets)

## Installation (development)

1. Open this folder as the workspace root (`File → Open Folder…` → `aws-spark-notebooks` or `emr-serverless-pyspark`). **F5** only works when this folder is the workspace root.
2. Install dependencies and build:

```bash
npm install
npm run build
```

3. Press **F5** (or **Run → Start Debugging**) and choose **Run Extension**. This opens an **Extension Development Host** window with the extension loaded.
4. Optional: run `npm run watch` in a terminal for automatic rebuilds while developing.

## Quick start

1. Open the **AWS Spark** activity bar (cloud + spark icon).
2. In **Config**, set **AWS Profile** and **AWS Region**.
3. Choose a backend when connecting:
   - **EMR Serverless** — refresh **Applications**, start a stopped app, then connect.
   - **Glue Interactive Sessions** — refresh **Glue Sessions**, create or attach to a session.
4. Run **EMR Serverless: New EMR Serverless Notebook** (or open an existing `.ipynb` / `.sparknb`).
5. Use the **kernel picker** (top-right) or run a cell — pick **EMR Serverless** or **Glue Interactive Sessions**, then select or create a session.
6. Run Python / SQL cells. DataFrames render as interactive tables; **Spark UI** links appear when available.

## Sidebar

The **AWS Spark** activity bar has three views.

### EMR Applications

Tree structure: **application** → **Livy sessions**. Only applications with `interactiveConfiguration.livyEndpointEnabled: true` are listed.

| Action | How |
|--------|-----|
| Refresh | Toolbar refresh button |
| Start application | Play icon on a stopped application |
| Stop application | Stop icon on a running application |
| Restart application | Context menu on a running application |
| New session | Context menu on a running application (prompts for an EMR Session Preset) |
| Attach to session | Link icon on a session row — binds the active notebook |
| Open Spark UI | Globe icon on a session row or in the view title |
| Stop session | Context menu on a session row |

### Glue Sessions

Lists Livy-type Glue interactive sessions in the selected region.

| Action | How |
|--------|-----|
| Refresh | Toolbar refresh button |
| New Glue Session | Toolbar **+** button (prompts for a Glue Session Preset) |
| Attach to session | Link icon on a ready session row |
| Open Spark UI | Globe icon on a session row or in the view title |
| Stop session | Context menu on a session row |

### Config

AWS credentials and session presets for both backends:

| Level | Item | Action |
|-------|------|--------|
| 1 | **AWS Profile** | Click to pick a profile or use auto (environment) |
| 1 | **AWS Region** | Click to pick the region for AWS API calls |
| 1 | **Session Presets** | Expand to browse EMR and Glue presets |
| 2 | *preset name* | Click to edit — `workspace` or `personal` shown in description |

Toolbar: **Refresh**, **New Session Preset** (EMR), **New Glue Session Preset**, **Open Workspace Presets File** (EMR and Glue).

Connect notebooks via the **kernel picker**, sidebar attach actions, or **Connect to EMR Serverless Session** / **Connect to Glue Session**.

## Session presets

Saved session configurations for each backend. When creating a session, you pick a preset; Iceberg/Glue catalog conf from settings is merged on top for **new** sessions.

### EMR Serverless presets

Saved Livy `POST /sessions` configurations (driver/executor sizing, execution role, Spark conf).

- **Team presets** live in `.vscode/emr-serverless-presets.json` and are shared via version control.
- **Personal presets** are stored locally in extension global state.
- Configure the file path with `emrServerless.sessionPresets.workspaceFile`.

Example workspace file:

```json
{
  "version": 1,
  "presets": [
    {
      "id": "small-dev",
      "name": "Small dev",
      "executionRoleArn": "arn:aws:iam::123456789012:role/EMRServerlessExecutionRole",
      "driverMemory": "4G",
      "executorMemory": "8G",
      "executorCores": 2,
      "numExecutors": 1,
      "heartbeatTimeoutInSecond": 60,
      "sparkConf": {
        "spark.dynamicAllocation.enabled": "false"
      }
    }
  ]
}
```

Preset fields: name, execution role ARN, driver/executor memory and cores, executor count, heartbeat timeout, optional TTL, and free-form `sparkConf` key/value pairs.

### Glue Interactive presets

Saved Glue `CreateSession` configurations (Glue version, worker type/count, role, default arguments, tags, connections).

- **Team presets** live in `.vscode/glue-interactive-presets.json`.
- **Personal presets** are stored locally.
- Configure the file path with `glueInteractive.sessionPresets.workspaceFile`.

Preset fields: name, role ARN, Glue version, worker type and count, idle timeout, Python version, `defaultArguments` (Spark conf and Glue job args), tags, connections, and optional Python/Spark package lists.

## Status bar

When a notebook is connected, **Spark UI** appears on the left. **Spark Help** (right) opens the in-editor documentation.

## Kernel picker

Each notebook uses one of two controllers:

| Controller | When |
|------------|------|
| **Select Spark Session…** | Notebook is not connected |
| **AWS Spark PySpark** / **EMR Serverless PySpark** / **Glue Interactive PySpark** | Notebook is bound to a session (label reflects backend) |

Connecting prompts you to choose **EMR Serverless** or **Glue Interactive Sessions**, then pick or create a session. Running cells while disconnected opens the same flow.

**Disconnect Notebook Session** clears the notebook binding but leaves the remote session running.

## Commands

### Shared / EMR Serverless

| Command | Description |
|---------|-------------|
| New EMR Serverless Notebook | Create `.ipynb` or `.sparknb` |
| Open with EMR Serverless PySpark | Open `.ipynb` / `.sparknb` with this extension |
| Connect to EMR Serverless Session | Backend picker → EMR session selection |
| Select EMR Serverless Session | Same as Connect, for the active notebook |
| Disconnect Notebook Session | Unbind notebook (session keeps running) |
| Select AWS Profile | Pick a profile from `~/.aws/credentials` / `~/.aws/config` |
| Select AWS Region | Pick region for AWS API calls |
| Verify AWS Credentials | Run credential diagnostics |
| Refresh | Reload EMR applications list |
| Start / Stop / Restart Application | Manage EMR Serverless apps |
| New Session / Attach / Stop Session | Manage EMR Livy sessions |
| Open Spark UI / Refresh Spark UI Link | Dashboard access (EMR) |
| Focus Config | Open the Config sidebar view |
| Edit / New Session Preset | Manage EMR session presets |
| Open Workspace Presets File | Open `.vscode/emr-serverless-presets.json` |
| Export Personal Presets to Workspace | Copy personal EMR presets into the workspace file |
| Help | Open in-editor documentation |

### Glue Interactive

| Command | Description |
|---------|-------------|
| Connect to Glue Session | Backend picker → Glue session selection |
| Refresh | Reload Glue sessions list |
| New Glue Session | Create a Glue interactive session |
| Attach to Glue Session | Bind notebook to an existing session |
| Stop Glue Session | Stop a Glue session |
| Open Spark UI | Open Glue session dashboard |
| Edit / New Glue Session Preset | Manage Glue session presets |
| Open Glue Workspace Presets File | Open `.vscode/glue-interactive-presets.json` |
| Export Personal Glue Presets to Workspace | Copy personal Glue presets into the workspace file |

## Settings

Search **EMR Serverless** or **Glue Interactive** in Settings (`Cmd/Ctrl+,`).

### EMR Serverless

| Setting | Default | Description |
|---------|---------|-------------|
| `emrServerless.awsProfile` | *(empty)* | Named AWS profile; empty uses `AWS_PROFILE` / default chain |
| `emrServerless.awsRegion` | *(empty)* | AWS region; empty uses profile or `AWS_REGION` |
| `emrServerless.defaultExecutionRoleArn` | *(account-specific)* | IAM role ARN for new Livy sessions |
| `emrServerless.sessionConfigsDefaults` | see `package.json` | Default `POST /sessions` body |
| `emrServerless.statementPollIntervalMs` | `500` | Livy statement poll interval |
| `emrServerless.sessionStartupTimeoutSeconds` | `600` | Timeout waiting for a new session to become ready |
| `emrServerless.maxRows` | `1000` | Max DataFrame rows in table output |
| `emrServerless.dashboardRefreshHintMinutes` | `55` | Spark UI link expiry hint |
| `emrServerless.icebergCatalog.*` | see `package.json` | Iceberg + Glue catalog Spark conf for new sessions |
| `emrServerless.sessionPresets.workspaceFile` | `.vscode/emr-serverless-presets.json` | Team-shared EMR presets file |
| `emrServerless.sessionPresets.preferWorkspace` | `true` | Default new presets to the workspace file |

### Glue Interactive Sessions

| Setting | Default | Description |
|---------|---------|-------------|
| `glueInteractive.defaultRoleArn` | *(empty)* | IAM role for new Glue sessions |
| `glueInteractive.sessionDefaults` | see `package.json` | Default `CreateSession` fields |
| `glueInteractive.statementPollIntervalMs` | `500` | Glue statement poll interval |
| `glueInteractive.sessionStartupTimeoutSeconds` | `600` | Timeout waiting for session `READY` |
| `glueInteractive.sessionPresets.workspaceFile` | `.vscode/glue-interactive-presets.json` | Team-shared Glue presets file |
| `glueInteractive.sessionPresets.preferWorkspace` | `true` | Default new presets to the workspace file |

Click **AWS Profile** or **AWS Region** in the **Config** sidebar to change credentials or region. Changing profile or region disconnects open notebook sessions.

## Notebook format (`.sparknb` / `.ipynb`)

Standard **nbformat 4** JSON (Jupyter-compatible). Open `.ipynb` files via **Open with EMR Serverless PySpark** if the Jupyter extension is installed.

Metadata:

- `metadata.emrServerless.applicationId` — bound EMR application (no secrets)
- `metadata.emrServerless.sessionId` — EMR Livy session id
- `metadata.glueInteractive.sessionId` — Glue session id

Cell languages:

- `python` — PySpark
- `sql` — Spark SQL

SQL in plain `.ipynb` files: set the cell language to **SQL**, or start the cell with `%%sql`.

### Cell output behavior

- `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` SQL cells render as interactive tables.
- `SHOW DATABASES FROM catalog` is normalized to `SHOW DATABASES IN catalog` (Spark syntax).
- Python cells auto-display the last expression: DataFrames become interactive tables; other values use `repr()`.
- Trailing `.show()` / `.show(n)` on a DataFrame is rewritten to the interactive table renderer.
- DataFrame display fetches only `limit + 1` rows by default — **no automatic full `count()`**.
- When results are truncated, the table shows a warning and a **Count all rows** button.
- Use `print(...)` for side-effect output.
- While a cell runs, live status shows statement state, elapsed time, optional Spark job progress, and a **Spark UI** link when available.
- Call `emr_show(df)` or `emr_display(df)` explicitly in multi-statement cells.

### Jupyter magics (`.ipynb`)

| Magic | Supported |
|-------|-----------|
| `%%sql` | Yes — set cell language to SQL or use `%%sql` at the top of a Python cell |
| `%pip install …` | Yes — runs `python -m pip …` on the session driver |
| `!pip install …` | Yes — same as `%pip` |

**Limitations on EMR Serverless** (unlike classic EMR Notebooks):

- Packages with **native binaries** may install on the driver but fail on executors — use a [venv archive on S3](https://docs.aws.amazon.com/emr/latest/EMR-Serverless-UserGuide/using-python-libraries.html) in session presets for production deps.
- Run `%pip install` in one cell, then `import` in the **next** cell.

**Do not** rely on `SparkSession.builder` in notebook cells for catalog setup — the remote session already created `spark` with session conf; builder `.config()` for catalogs is ignored. The extension warns when a cell attempts this.

### Iceberg catalogs (`spark_catalog` + `glue_catalog`)

Spark registers Iceberg catalogs **at session creation only**. The extension merges catalog conf into new session bodies (settings + presets):

| Catalog | Typical use | Config source |
|---------|-------------|---------------|
| `spark_catalog` | EMR/Glue default (SparkSessionCatalog on Glue) | `emrServerless.icebergCatalog.sessionConf` |
| `glue_catalog` | Explicit GlueCatalog + warehouse | `emrServerless.icebergCatalog.glueCatalog` or preset Spark conf |

Then **create a new session** (attached sessions keep their original conf).

## IAM permissions

Replace `ACCOUNT_ID` and role ARNs with your values. You only need the section for backends you use.

### EMR Serverless

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "emr-serverless:ListApplications",
        "emr-serverless:GetApplication",
        "emr-serverless:StartApplication",
        "emr-serverless:StopApplication",
        "emr-serverless:AccessLivyEndpoints",
        "emr-serverless:GetResourceDashboard",
        "emr-serverless:GetDashboardForJobRun"
      ],
      "Resource": "arn:aws:emr-serverless:*:ACCOUNT_ID:/applications/*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::ACCOUNT_ID:role/EMRServerlessExecutionRole",
      "Condition": {
        "StringLike": {
          "iam:PassedToService": "emr-serverless.amazonaws.com"
        }
      }
    }
  ]
}
```

### Glue Interactive Sessions

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "glue:CreateSession",
        "glue:GetSession",
        "glue:ListSessions",
        "glue:StopSession",
        "glue:DeleteSession",
        "glue:RunStatement",
        "glue:GetStatement",
        "glue:CancelStatement",
        "glue:GetDashboardUrl"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::ACCOUNT_ID:role/GlueInteractiveSessionRole",
      "Condition": {
        "StringLike": {
          "iam:PassedToService": "glue.amazonaws.com"
        }
      }
    }
  ]
}
```

## Spark UI and driver logs

After connecting, the extension fetches a Spark UI URL from the active backend. Links appear in cell output, the status bar, and sidebar session rows. URLs expire after about **one hour** — use **Refresh Spark UI Link** (EMR) or re-open from the sidebar.

**Driver logs:** Spark UI → **Executors** tab → driver row → **Logs**.

## Session isolation

AWS enforces session isolation per **IAM principal**. You can only attach to sessions created by the same credentials.

## Development

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Bundle extension (`dist/extension.js`) and table renderer (`dist/tableRenderer.js`) |
| `npm run watch` | Rebuild on file changes |
| `npm run typecheck` | TypeScript check without emit |
| `npm run package` | Build and create a `.vsix` in `releases/` |
| `npm run vscode:prepublish` | Pre-publish build hook |

Build uses **esbuild** (Node 18 target for the extension host, ESM for the notebook renderer webview).

### Package for sharing (`.vsix`)

```bash
npm install
npm run package
```

This builds the extension and writes `releases/emr-serverless-pyspark-<version>.vsix`.

Options:

```bash
npm run package -- --out ./releases
npm run package -- --skip-build
npm run package -- --pre-release
```

**Install the `.vsix`:**

- VS Code: `code --install-extension releases/emr-serverless-pyspark-0.1.0.vsix`
- Cursor: `cursor --install-extension releases/emr-serverless-pyspark-0.1.0.vsix`
- Or: Extensions sidebar → **⋯** → **Install from VSIX…**

### CI and merge requirements

Pull requests to `main` run:

| Check | Workflow job |
|-------|----------------|
| `verify` | CI — typecheck, build, package smoke test |
| `semantic-pull-request` | PR Title — Conventional Commits PR title |

**Block merge until checks pass** — branch protection must be enabled on GitHub (not enforced by workflow files alone). After merging the repo-settings changes, run once:

```bash
./scripts/apply-github-settings.sh
```

Or add a repository secret `GH_ADMIN_PAT` (admin + Actions scope) and run the **Apply Repo Settings** workflow from the Actions tab.

This configures:

- Required status checks on `main` (`verify`, `semantic-pull-request`) via repository ruleset
- Repository **Admin** role bypass so release automation (via `GH_ADMIN_PAT`) can push version/changelog commits to `main`
- Legacy branch protection removed to avoid duplicate required checks
- The least restrictive workflow approval policy available via API (`first_time_contributors_new_to_github`)

The **Release** workflow needs repository secret `GH_ADMIN_PAT` (admin user PAT with `contents` write). The default `GITHUB_TOKEN` cannot bypass rulesets on personal repositories.

**Workflow approval prompts:** GitHub may still ask you to click **Approve and run** when a PR modifies files under `.github/workflows/`. That is a platform security control and cannot be fully disabled. Same-repo PRs from contributors who already have merged work should otherwise run automatically.

### Releases (CI/CD)

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) on every push to `main`.

1. Create a feature branch from `main`.
2. Open a PR with a [Conventional Commits](https://www.conventionalcommits.org/) **title**.
3. CI runs typecheck, build, and a packaging smoke test.
4. Merge to `main` — the release workflow bumps the version, updates `CHANGELOG.md`, builds a `.vsix`, publishes a [GitHub Release](https://github.com/denerops/aws-spark-notebooks/releases), and publishes to the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=denerops.emr-serverless-pyspark).

Install from the marketplace:

```bash
code --install-extension denerops.emr-serverless-pyspark
```

### Project layout

```
src/
  extension.ts              # Activation, command registration
  platform/connectionHub.ts # Routes notebooks to EMR or Glue managers
  aws/                      # EMR Serverless SDK client, config, Iceberg helpers
  livy/                     # SigV4 Livy HTTP client, session, code transforms
  glue/                     # Glue Interactive Sessions SDK client and presets
  emr/connectionManager.ts  # Notebook ↔ EMR Livy session bindings
  notebook/                 # Serializer, controller, kernel manager, ipynb compat
  browser/                  # Sidebar tree providers and context-menu actions
  session/                  # EMR session presets and Livy body builder
  ui/                       # Status bar, kernel picker, connect wizard, preset editors
  output/                   # Result → notebook output mappers
  renderer/                 # DataFrame table webview renderer
media/                      # Icons and renderer CSS
scripts/spike.mjs           # Standalone AWS / Livy connectivity test
```

### Validate AWS connectivity (spike)

```bash
node scripts/spike.mjs
EMR_APPLICATION_ID=00fxxxxxxxx EMR_EXECUTION_ROLE_ARN=arn:aws:iam::...:role/... node scripts/spike.mjs
```

The spike lists Livy-enabled EMR applications, optionally starts a test session, and prints dashboard URLs.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code / Cursor UI                                             │
│  ┌──────────────┐  ┌─────────────┐  ┌────────────────────────┐ │
│  │ Sidebar      │  │ Notebook    │  │ Status bar               │ │
│  │ EMR + Glue   │  │ controller  │  │                          │ │
│  └──────┬───────┘  └──────┬──────┘  └────────────────────────┘ │
└─────────┼─────────────────┼────────────────────────────────────┘
          │                 │
          ▼                 ▼
   NotebookConnectionHub ──► SparknbController
          │
     ┌────┴────┐
     ▼         ▼
 EMR Manager  Glue Manager
     │         │
     ▼         ▼
 LivySession  GlueSession
 (SigV4 HTTP) (Glue SDK + Livy)
     │         │
     ▼         ▼
 EMR Serverless API    AWS Glue Interactive Sessions API
 per-app Livy endpoint per-session Livy endpoint
```

- **EMR control plane:** `@aws-sdk/client-emr-serverless` — list/start/stop applications, dashboard URLs
- **EMR data plane:** SigV4-signed HTTP to the per-application Livy endpoint
- **Glue:** `@aws-sdk/client-glue` — CreateSession, RunStatement, GetDashboardUrl, etc.
- **Credentials:** `@aws-sdk/credential-providers` — default chain or explicit profile via `emrServerless.awsProfile`
- **Table renderer:** custom MIME type `application/vnd.emr-spark.table+json` rendered in a notebook webview

## License

MIT
