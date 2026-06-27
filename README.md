# EMR Serverless PySpark Notebook

A VS Code / Cursor extension for running **PySpark** and **Spark SQL** in `.sparknb` and `.ipynb` notebooks, backed by **Apache Livy** on **Amazon EMR Serverless**.

## Features

- Native notebook experience with Python and SQL cell languages
- Sidebar to list, start, stop, and restart Livy-enabled EMR Serverless applications
- Attach to existing Livy sessions or create new ones with configurable **Session Presets**
- Interactive DataFrame tables with sort, filter, and CSV export
- Spark UI links via `GetDashboardForJobRun` (with `GetResourceDashboard` fallback)
- Iceberg + Glue catalog configuration merged into new Livy sessions
- Jupyter-compatible `.ipynb` support alongside `.sparknb`
- Status bar showing region, application, session state, and Spark UI shortcut

## Prerequisites

- VS Code 1.88+ or Cursor
- Node.js 18+ (for building from source)
- AWS CLI credentials configured locally (`~/.aws/credentials` and `~/.aws/config` with a default **region**)
- An existing EMR Serverless **Spark** application with `interactiveConfiguration.livyEndpointEnabled: true` (EMR **6.14+**)
- IAM permissions (see [IAM permissions](#iam-permissions))
- A job **execution role** ARN with `iam:PassRole`

## Installation (development)

1. Open this folder as the workspace root (`File → Open Folder…` → `emr-serverless-pyspark`). **F5** only works when this folder is the workspace root.
2. Install dependencies and build:

```bash
npm install
npm run build
```

3. Press **F5** (or **Run → Start Debugging**) and choose **Run Extension**. This opens an **Extension Development Host** window with the extension loaded.
4. Optional: run `npm run watch` in a terminal for automatic rebuilds while developing.

## Quick start

1. Open the **EMR Serverless** activity bar (cloud + spark icon).
2. Under **Applications**, click **Refresh** — only Livy-enabled apps are listed.
3. **Start** a stopped application if needed (wait until state is `STARTED`).
4. Run **EMR Serverless: New EMR Serverless Notebook** — use the kernel picker or run a cell to connect to an EMR app and Livy session.
5. Use the **kernel picker** (top-right of the notebook) to change sessions: select application → attach to an existing session or create a new one.
6. Run Python / SQL cells. DataFrames render as interactive tables; the first cell output includes a **Spark UI** link when available.

## Sidebar

The **EMR Serverless** activity bar has two views.

### Applications

Tree structure: **region** → **application** → **Livy sessions**.

| Action | How |
|--------|-----|
| Refresh | Toolbar refresh button |
| Start application | Play icon on a stopped application |
| Stop application | Stop icon on a running application |
| Restart application | Context menu on a running application |
| New session | Context menu on a running application (prompts for a Session Preset) |
| Attach to session | Link icon on a session row — binds the active notebook (or creates a new `.ipynb`) |
| Open Spark UI | Globe icon on a session row or in the view title |
| Stop session | Context menu on a session row |

Only applications with `interactiveConfiguration.livyEndpointEnabled: true` appear in the list.

### Session Presets

Saved Livy `POST /sessions` configurations (driver/executor sizing, execution role, Spark conf).

- Click a preset to open the editor panel.
- Use **+** in the panel title to create a new preset (team **workspace** or **personal** scope).
- **Team presets** live in `.vscode/emr-serverless-presets.json` and are shared via version control.
- **Personal presets** are stored locally in extension global state.
- Open the workspace file with **EMR Serverless: Open Workspace Presets File** (toolbar on Session Presets view).
- Copy personal presets into the workspace file with **EMR Serverless: Export Personal Presets to Workspace**.
- When creating a session from the sidebar or kernel picker, you choose which preset to apply.
- Iceberg/Glue catalog conf from settings is always merged on top of preset `sparkConf` for **new** sessions.

Preset fields: name, execution role ARN, driver/executor memory and cores, executor count, heartbeat timeout, optional TTL, and free-form `sparkConf` key/value pairs.

#### Workspace presets file

Commit `.vscode/emr-serverless-presets.json` so the team shares the same Livy session sizing and Spark conf:

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

Configure the file path with `emrServerless.sessionPresets.workspaceFile`. The sidebar shows **workspace** vs **personal** presets with distinct icons.

## Status bar

Two items appear on the left when the extension is active:

| Item | Connected | Disconnected |
|------|-----------|--------------|
| Session | `region \| appId \| session N \| state` — click to connect | `EMR region — disconnected` — click to connect |
| Spark UI | `Spark UI` — opens dashboard URL | Hidden |

## Kernel picker

Each notebook uses one of two controllers:

| Controller | When |
|------------|------|
| **Select EMR Session…** | Notebook is not connected (no `applicationId` / `sessionId` in metadata) |
| **EMR Serverless PySpark** | Notebook is bound to a Livy session |

Use the kernel picker (**Select EMR Serverless Session**) or run a cell to connect. Running cells while disconnected opens session selection.

**Disconnect** (`EMR Serverless: Disconnect Notebook Session`) clears the notebook binding but leaves the Livy session running on EMR.

## Commands

| Command | Description |
|---------|-------------|
| New EMR Serverless Notebook | Create `.ipynb` or `.sparknb` |
| Open with EMR Serverless PySpark | Open `.ipynb` / `.sparknb` with this extension |
| Connect to EMR Serverless Session | Kernel selection flow (app → session) |
| Select EMR Serverless Session | Same as Connect, for the active notebook |
| Disconnect Notebook Session | Unbind notebook (session keeps running) |
| Select AWS Profile | Pick a profile from `~/.aws/credentials` / `~/.aws/config` |
| Refresh | Reload applications list (sidebar) |
| Start Application | Start a stopped EMR Serverless application |
| Stop Application | Stop a running application |
| Restart Application | Stop then start an application |
| New Session | Create a Livy session on a running application |
| Attach to Session | Bind notebook to an existing session |
| Stop Session | Terminate a Livy session |
| Open Spark UI | Open dashboard URL in browser |
| Refresh Spark UI Link | Regenerate URL (~1 h validity) |
| Focus Session Presets | Open the Session Presets sidebar view |
| Edit Session Preset | Open preset editor for the selected preset |
| New Session Preset | Create a new preset |
| Open Workspace Presets File | Open `.vscode/emr-serverless-presets.json` for team sharing |
| Export Personal Presets to Workspace | Copy personal presets into the workspace file |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `emrServerless.defaultExecutionRoleArn` | *(account-specific)* | IAM role ARN for new Livy sessions |
| `emrServerless.sessionConfigsDefaults` | see `package.json` | Default `POST /sessions` body (memory, cores, Spark conf) |
| `emrServerless.statementPollIntervalMs` | `500` | Livy statement poll interval |
| `emrServerless.sessionStartupTimeoutSeconds` | `600` | Timeout waiting for a new session to become ready |
| `emrServerless.maxRows` | `1000` | Max DataFrame rows in table output |
| `emrServerless.dashboardRefreshHintMinutes` | `55` | Spark UI link expiry hint |
| `emrServerless.icebergCatalog.enabled` | `true` | Merge Iceberg/Glue conf into new sessions |
| `emrServerless.icebergCatalog.catalogName` | `spark_catalog` | Primary Iceberg catalog name |
| `emrServerless.icebergCatalog.sessionConf` | SparkSessionCatalog on Glue | Primary catalog Spark conf |
| `emrServerless.icebergCatalog.additionalCatalogConf` | `{}` | Extra `spark.sql.catalog.*` keys |
| `emrServerless.icebergCatalog.glueCatalog` | disabled | Optional second catalog (`glue_catalog` + warehouse) |
| `emrServerless.sessionPresets.workspaceFile` | `.vscode/emr-serverless-presets.json` | Team-shared presets file (relative to workspace root) |
| `emrServerless.sessionPresets.preferWorkspace` | `true` | Default new presets to the workspace file when a folder is open |
| `emrServerless.awsProfile` | *(empty)* | Named AWS profile for API calls; empty uses `AWS_PROFILE` / default chain |

Click the **$(key)** item in the status bar to change profile. Region comes from the selected profile in `~/.aws/config`. Changing profile disconnects open notebook sessions.

## Notebook format (`.sparknb` / `.ipynb`)

Standard **nbformat 4** JSON (Jupyter-compatible). Open `.ipynb` files via **Open with EMR Serverless PySpark** if the Jupyter extension is installed.

Metadata:

- `metadata.emrServerless.applicationId` — bound application (no secrets)
- `metadata.emrServerless.sessionId` — Livy session id

Cell languages:

- `python` — PySpark
- `sql` — Spark SQL

SQL in plain `.ipynb` files: set the cell language to **SQL**, or start the cell with `%%sql`.

`.sparknb` uses the same format; `.ipynb` saves with `kernelspec` metadata for Jupyter tooling.

### Cell output behavior

- `SELECT`, `SHOW`, `DESCRIBE`, and `EXPLAIN` SQL cells render as interactive tables.
- `SHOW DATABASES FROM catalog` is normalized to `SHOW DATABASES IN catalog` (Spark syntax).
- Python cells auto-display the last expression: DataFrames become interactive tables; other values use `repr()`.
- Trailing `.show()` / `.show(n)` on a DataFrame is rewritten to the interactive table renderer.
- DataFrame display fetches only `limit + 1` rows by default — **no automatic full `count()`** (avoids expensive scans on large tables).
- When results are truncated, the table shows a warning and a **Count all rows** button to run an explicit count.
- Use `print(...)` for side-effect output.
- While a cell runs, live status shows Livy state (queued / running), elapsed time, optional Spark job progress, and a **Spark UI** link when available.
- Call `emr_show(df)` or `emr_display(df)` explicitly in multi-statement cells.

### Jupyter magics (`.ipynb`)

| Magic | Supported |
|-------|-----------|
| `%%sql` | Yes — set cell language to SQL or use `%%sql` at the top of a Python cell |
| `%pip install …` | Yes — runs `python -m pip …` on the Livy driver (same as Jupyter) |
| `!pip install …` | Yes — same as `%pip` |

Examples:

```python
%pip install pandas
```

```python
!pip install --quiet scikit-learn
```

Other `%pip` subcommands work too (`%pip list`, `%pip show numpy`, etc.). On `install`, packages go to a session directory on the driver, `sys.path` is updated immediately, and a zip is sent to executors via `addPyFile` (pure-Python packages only).

**Limitations on EMR Serverless** (unlike classic EMR Notebooks with `sc.install_pypi_package`):

- Packages with **native binaries** (e.g. some builds of `pandas`, `numpy`) may install but still fail on executors — use a [venv archive on S3](https://docs.aws.amazon.com/emr/latest/EMR-Serverless-UserGuide/using-python-libraries.html) in session presets for production deps.
- Run `%pip install` in one cell, then `import` in the **next** cell (or the same cell after the magic line).
- If an import was attempted **before** install in the same session, restart the Livy session or `importlib.reload` won't fix a failed first import — use a new session.

Browse tables with `SHOW TABLES IN spark_catalog.stage` or `spark.table(...)` in notebook cells.

**Do not** rely on `SparkSession.builder` in notebook cells for catalog setup — Livy already created `spark` with session conf; builder `.config()` for catalogs is ignored. The extension warns when a cell attempts this.

### Iceberg catalogs (`spark_catalog` + `glue_catalog`)

Spark registers Iceberg catalogs **at session creation only**. The extension merges catalog conf into the Livy session body (settings + session presets). Both catalogs can coexist:

| Catalog | Typical use | Config source |
|---------|-------------|---------------|
| `spark_catalog` | EMR default (SparkSessionCatalog on Glue) | `emrServerless.icebergCatalog.sessionConf` |
| `glue_catalog` | Notebooks with explicit GlueCatalog + warehouse | `emrServerless.icebergCatalog.glueCatalog` or preset `sparkConf` |

**Enable `glue_catalog` in settings** (replace warehouse):

```json
"emrServerless.icebergCatalog.glueCatalog": {
  "enabled": true,
  "name": "glue_catalog",
  "warehouse": "s3://your-stage-bucket/"
}
```

Or put full keys in a **session preset** under `sparkConf`, or in `emrServerless.icebergCatalog.additionalCatalogConf`. Then **create a new Livy session** (attached sessions keep their original conf).

Default Iceberg/Glue session conf:

```json
{
  "spark.sql.extensions": "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
  "spark.sql.catalog.spark_catalog": "org.apache.iceberg.spark.SparkSessionCatalog",
  "spark.sql.catalog.spark_catalog.type": "glue"
}
```

## IAM permissions

Your IAM user/role needs at minimum:

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

Replace `ACCOUNT_ID` and the execution role ARN with your values.

## Spark UI and driver logs

After connecting, the extension fetches a Spark UI URL via `GetDashboardForJobRun` (using the Livy session `appId` or session id), with `GetResourceDashboard` as fallback. The link appears in the first cell output and a notification offers **Open Spark UI** / **Refresh Link**. URLs expire after about **one hour** — use **Refresh Spark UI Link**.

**Driver logs:** Spark UI → **Executors** tab → driver row → **Logs**.

## Session isolation

AWS enforces Livy session isolation per **IAM principal**. You can only attach to sessions created by the same credentials.

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

Create an installable extension bundle for other machines:

```bash
npm install
npm run package
```

This builds the extension and writes `releases/emr-serverless-pyspark-<version>.vsix`.

Options:

```bash
npm run package -- --out ./releases          # output directory (default: releases/)
npm run package -- --skip-build              # package without rebuilding
npm run package -- --pre-release             # mark as pre-release in metadata
```

The script refreshes `media/icon.png` from `media/icon.svg` when `rsvg-convert` is available (macOS: `brew install librsvg`). `icon.png` is also committed so packaging works without it.

**Install the `.vsix` on another machine:**

- VS Code: `code --install-extension releases/emr-serverless-pyspark-0.1.0.vsix`
- Cursor: `cursor --install-extension releases/emr-serverless-pyspark-0.1.0.vsix`
- Or: Extensions sidebar → **⋯** → **Install from VSIX…**

For local builds, `package.json` version controls the `.vsix` filename. In CI, semantic-release bumps the version automatically on merge to `main`.

### Releases (CI/CD)

Releases are automated with [semantic-release](https://semantic-release.gitbook.io/) on every push to `main`.

**Workflow**

1. Create a feature branch from `main`.
2. Open a PR with a [Conventional Commits](https://www.conventionalcommits.org/) **title** (squash merge uses the PR title as the commit message).
3. CI runs typecheck, build, and a packaging smoke test.
4. Merge to `main` — the release workflow bumps the version, updates `CHANGELOG.md`, builds a `.vsix`, and publishes a [GitHub Release](https://github.com/denerops/aws-spark-notebooks/releases).

**Version bumps (from merged PR titles)**

| PR title prefix | Release | Example |
|-----------------|---------|---------|
| `fix:` | patch | `fix(livy): retry on 503` → `0.1.0` → `0.1.1` |
| `feat:` | minor | `feat(sidebar): session presets` → `0.1.0` → `0.2.0` |
| `feat!:` or `BREAKING CHANGE:` | minor while on `0.x` | `feat!: drop legacy kernel API` → `0.1.0` → `0.2.0` |
| `chore:`, `docs:`, `ci:` | none | No GitHub Release (CI still runs) |

**Install from a release**

Download the `.vsix` from the GitHub Release assets, then:

```bash
code --install-extension emr-serverless-pyspark-X.Y.Z.vsix
cursor --install-extension emr-serverless-pyspark-X.Y.Z.vsix
```

**Release baseline**

Baseline tag `v0.1.0` is set on `main`. Only releasable merges (`feat:`, `fix:`) produce new [GitHub Releases](https://github.com/denerops/aws-spark-notebooks/releases).

### Project layout

```
src/
  extension.ts              # Activation, command registration
  aws/                      # EMR Serverless SDK client, config, Iceberg helpers
  livy/                     # SigV4 Livy HTTP client, session, code transforms
  emr/connectionManager.ts  # Notebook ↔ Livy session bindings
  notebook/                 # Serializer, controller, kernel manager, ipynb compat
  browser/                  # Sidebar tree providers and context-menu actions
  session/                  # Session presets store and Livy body builder
  ui/                       # Status bar, kernel picker, connect wizard, preset editor
  output/                   # Livy result → notebook output mappers
  renderer/                 # DataFrame table webview renderer
media/                      # Icons (emr-serverless.svg, icon.svg) and renderer CSS
scripts/spike.mjs           # Standalone AWS / Livy connectivity test
```

### Validate AWS connectivity (spike)

```bash
node scripts/spike.mjs
EMR_APPLICATION_ID=00fxxxxxxxx EMR_EXECUTION_ROLE_ARN=arn:aws:iam::...:role/... node scripts/spike.mjs
```

The spike lists Livy-enabled applications, optionally starts a test session, and prints dashboard URLs — useful before debugging the extension.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  VS Code / Cursor UI                                        │
│  ┌──────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Sidebar tree │  │ Notebook    │  │ Status bar          │ │
│  │ + presets    │  │ controller  │  │                     │ │
│  └──────┬───────┘  └──────┬──────┘  └─────────────────────┘ │
└─────────┼─────────────────┼─────────────────────────────────┘
          │                 │
          ▼                 ▼
   ConnectionManager ──► LivySession
          │                 │
          ▼                 ▼
   EmrServerlessService   LivySigV4Client
   (AWS SDK)              (SigV4 HTTP)
          │                 │
          ▼                 ▼
   EMR Serverless API     https://{appId}.livy.emr-serverless-services.{region}.amazonaws.com
```

- **Control plane:** `@aws-sdk/client-emr-serverless` — list/start/stop applications, dashboard URLs
- **Data plane:** SigV4-signed HTTP to the per-application Livy endpoint
- **Credentials:** `@aws-sdk/credential-providers` — default chain or explicit profile via `emrServerless.awsProfile`
- **Region:** from the active profile in `~/.aws/config` (or `AWS_REGION` when profile is auto)
- **Table renderer:** custom MIME type `application/vnd.emr-spark.table+json` rendered in a notebook webview

## License

MIT
