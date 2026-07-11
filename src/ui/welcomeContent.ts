import * as vscode from 'vscode';

export function renderWelcomePageHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const iconUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'icon.png')
  );
  const cspSource = webview.cspSource;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https:; style-src 'unsafe-inline'; script-src 'nonce-welcome';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AWS Spark Notebooks</title>
  <style>
    :root {
      --section-gap: 2rem;
      --card-radius: 8px;
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      line-height: 1.55;
      max-width: 920px;
      margin: 0 auto;
      padding: 1.5rem 2rem 3rem;
    }
    header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1.5rem;
      padding-bottom: 1.25rem;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    header img {
      width: 64px;
      height: 64px;
      border-radius: 12px;
    }
    h1 {
      font-size: 1.65rem;
      font-weight: 600;
      margin: 0 0 0.25rem;
    }
    .subtitle {
      color: var(--vscode-descriptionForeground);
      margin: 0;
    }
    nav.toc {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--card-radius);
      padding: 1rem 1.25rem;
      margin-bottom: var(--section-gap);
    }
    nav.toc strong { display: block; margin-bottom: 0.5rem; }
    nav.toc ol {
      margin: 0;
      padding-left: 1.25rem;
      columns: 2;
      column-gap: 2rem;
    }
    nav.toc a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    nav.toc a:hover { text-decoration: underline; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-bottom: var(--section-gap);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 0.45rem 0.85rem;
      font-size: inherit;
      font-family: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    section {
      margin-bottom: var(--section-gap);
      scroll-margin-top: 1rem;
    }
    h2 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 0.75rem;
      padding-bottom: 0.35rem;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    h3 {
      font-size: 1.05rem;
      font-weight: 600;
      margin: 1rem 0 0.5rem;
    }
    p { margin: 0.5rem 0; }
    ul, ol { margin: 0.5rem 0; padding-left: 1.35rem; }
    li { margin: 0.25rem 0; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.92em;
      margin: 0.75rem 0;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 0.45rem 0.65rem;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--vscode-editor-inactiveSelectionBackground);
      font-weight: 600;
    }
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 0.1rem 0.35rem;
      border-radius: 3px;
      font-size: 0.92em;
    }
    pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: var(--card-radius);
      padding: 0.75rem 1rem;
      overflow-x: auto;
      font-size: 0.88em;
    }
    .tip {
      background: var(--vscode-textBlockQuote-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding: 0.65rem 1rem;
      margin: 0.75rem 0;
      border-radius: 0 var(--card-radius) var(--card-radius) 0;
    }
    kbd {
      background: var(--vscode-keybindingLabel-background);
      border: 1px solid var(--vscode-keybindingLabel-border);
      border-radius: 3px;
      padding: 0.1rem 0.35rem;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <header>
    <img src="${iconUri}" alt="AWS Spark Notebooks" />
    <div>
      <h1>AWS Spark Notebooks</h1>
      <p class="subtitle">Run PySpark and Spark SQL on EMR Serverless and Glue Interactive Sessions</p>
    </div>
  </header>

  <div class="actions">
    <button data-command="emrServerless.newNotebook">New notebook</button>
    <button data-command="emrServerlessApplications.focus" class="secondary">Open sidebar</button>
    <button data-command="emrServerless.selectAwsProfile" class="secondary">Select AWS profile</button>
    <button data-command="emrServerless.connect" class="secondary">Connect to session</button>
  </div>

  <nav class="toc">
    <strong>Contents</strong>
    <ol>
      <li><a href="#overview">Overview</a></li>
      <li><a href="#prerequisites">Prerequisites</a></li>
      <li><a href="#quick-start">Quick start</a></li>
      <li><a href="#sidebar-emr">EMR Applications</a></li>
      <li><a href="#sidebar-glue">Glue Sessions</a></li>
      <li><a href="#sidebar-config">Config</a></li>
      <li><a href="#notebooks">Notebooks</a></li>
      <li><a href="#kernel">Kernel &amp; sessions</a></li>
      <li><a href="#cells">Running cells</a></li>
      <li><a href="#outputs">DataFrame outputs</a></li>
      <li><a href="#spark-ui">Spark UI</a></li>
      <li><a href="#status-bar">Status bar</a></li>
      <li><a href="#commands">Commands</a></li>
      <li><a href="#settings">Settings</a></li>
    </ol>
  </nav>

  <section id="overview">
    <h2>Overview</h2>
    <p>This extension gives you a native notebook experience in VS Code / Cursor for running <strong>PySpark</strong> and <strong>Spark SQL</strong> on AWS-managed Spark backends:</p>
    <ul>
      <li><strong>EMR Serverless</strong> — Livy on EMR Serverless Spark applications</li>
      <li><strong>Glue Interactive Sessions</strong> — Livy on AWS Glue interactive sessions</li>
    </ul>
    <p>Cells execute remotely; results appear inline, including interactive DataFrame tables.</p>
    <p>Supported file formats:</p>
    <ul>
      <li><code>.ipynb</code> — Jupyter-compatible notebooks (default editor for this extension)</li>
      <li><code>.sparknb</code> — same nbformat 4 JSON, dedicated Spark notebook extension</li>
    </ul>
  </section>

  <section id="prerequisites">
    <h2>Prerequisites</h2>
    <ul>
      <li>AWS credentials in <code>~/.aws/credentials</code> and a default <strong>region</strong> in <code>~/.aws/config</code></li>
      <li>IAM permissions for the backend you use (<code>emr-serverless:*</code> and/or <code>glue:*</code> session APIs) plus <code>iam:PassRole</code></li>
      <li>A job execution role ARN (configure in settings or session presets)</li>
    </ul>
    <h3>EMR Serverless</h3>
    <ul>
      <li>An EMR Serverless <strong>Spark</strong> application with Livy enabled (<code>interactiveConfiguration.livyEndpointEnabled: true</code>, EMR 6.14+)</li>
    </ul>
    <h3>Glue Interactive Sessions</h3>
    <ul>
      <li>An IAM role that Glue can assume for interactive sessions</li>
    </ul>
    <div class="tip">Use the <strong>Config</strong> sidebar view to set <strong>AWS Profile</strong> and <strong>AWS Region</strong> before connecting.</div>
  </section>

  <section id="quick-start">
    <h2>Quick start</h2>
    <ol>
      <li>Open the <strong>AWS Spark</strong> activity bar (cloud + spark icon).</li>
      <li>Set <strong>AWS Profile</strong> and <strong>AWS Region</strong> in the <strong>Config</strong> view.</li>
      <li>Run <strong>EMR Serverless: New EMR Serverless Notebook</strong> or open an existing <code>.ipynb</code> file.</li>
      <li>Use the <strong>kernel picker</strong> or run a cell — choose <strong>EMR Serverless</strong> or <strong>Glue Interactive Sessions</strong>.</li>
      <li>For EMR: refresh <strong>Applications</strong>, start a stopped app, then attach or create a Livy session.</li>
      <li>For Glue: refresh <strong>Glue Sessions</strong>, then attach to an existing session or create a new one.</li>
      <li>Run Python or SQL cells. DataFrames render as sortable, filterable tables.</li>
    </ol>
  </section>

  <section id="sidebar-emr">
    <h2>EMR Applications</h2>
    <p>Browse Livy-enabled EMR Serverless applications and their sessions.</p>
    <p>Tree: <strong>application</strong> → <strong>Livy sessions</strong>.</p>
    <table>
      <thead><tr><th>Action</th><th>How</th></tr></thead>
      <tbody>
        <tr><td>Refresh list</td><td>Toolbar refresh on Applications view</td></tr>
        <tr><td>Start application</td><td>Play icon on a stopped application</td></tr>
        <tr><td>Stop application</td><td>Stop icon on a running application</td></tr>
        <tr><td>Restart application</td><td>Context menu on a running application</td></tr>
        <tr><td>New Livy session</td><td>Context menu on running app → pick an EMR session preset</td></tr>
        <tr><td>Attach to session</td><td>Link icon on a session row</td></tr>
        <tr><td>Open Spark UI</td><td>Globe icon on a session row</td></tr>
        <tr><td>Stop session</td><td>Context menu on a session row</td></tr>
      </tbody>
    </table>
  </section>

  <section id="sidebar-glue">
    <h2>Glue Sessions</h2>
    <p>Lists Livy-type Glue interactive sessions in the selected region.</p>
    <table>
      <thead><tr><th>Action</th><th>How</th></tr></thead>
      <tbody>
        <tr><td>Refresh list</td><td>Toolbar refresh on Glue Sessions view</td></tr>
        <tr><td>New Glue session</td><td>Toolbar <strong>+</strong> → pick a Glue session preset</td></tr>
        <tr><td>Attach to session</td><td>Link icon on a ready session row</td></tr>
        <tr><td>Stop session</td><td>Context menu on a session row</td></tr>
      </tbody>
    </table>
  </section>

  <section id="sidebar-config">
    <h2>Config</h2>
    <p>AWS credentials and session presets for both backends:</p>
    <table>
      <thead><tr><th>Level</th><th>Item</th><th>Action</th></tr></thead>
      <tbody>
        <tr><td>1</td><td><strong>AWS Profile</strong></td><td>Click to pick a profile or use auto (environment)</td></tr>
        <tr><td>1</td><td><strong>AWS Region</strong></td><td>Click to pick the region for AWS API calls</td></tr>
        <tr><td>1</td><td><strong>Session Presets</strong></td><td>Expand to browse EMR and Glue presets</td></tr>
        <tr><td>2</td><td><em>preset name</em></td><td>Click to edit — scope shown in description; repo/account icon</td></tr>
      </tbody>
    </table>
    <p>Changing profile or region disconnects open notebook sessions. Toolbar: refresh, open workspace presets file. Use <strong>+</strong> on <strong>EMR Session Presets</strong> or <strong>Glue Session Presets</strong> to create a new preset.</p>
    <p>Team preset files: <code>.vscode/emr-serverless-presets.json</code> (EMR) and <code>.vscode/glue-interactive-presets.json</code> (Glue).</p>
  </section>

  <section id="notebooks">
    <h2>Notebooks</h2>
    <h3>Open or create</h3>
    <ul>
      <li><strong>New EMR Serverless Notebook</strong> — creates <code>.ipynb</code> or <code>.sparknb</code></li>
      <li>Double-click <code>.ipynb</code> in the explorer (opens with this extension by default)</li>
      <li>Right-click <code>.ipynb</code> → <strong>Open with EMR Serverless PySpark</strong></li>
    </ul>
    <h3>Cell languages</h3>
    <ul>
      <li><code>python</code> — PySpark code</li>
      <li><code>sql</code> — Spark SQL (set cell language to SQL, or prefix with <code>%%sql</code>)</li>
    </ul>
    <p>Notebook metadata stores session binding info for reconnecting:</p>
    <ul>
      <li><code>metadata.emrServerless.applicationId</code> and <code>sessionId</code> (EMR)</li>
      <li><code>metadata.glueInteractive.sessionId</code> (Glue)</li>
    </ul>
  </section>

  <section id="kernel">
    <h2>Kernel &amp; sessions</h2>
    <p>Each notebook uses the <strong>AWS Spark PySpark</strong> controller. When no session is bound, running a cell opens the Spark backend picker directly.</p>
    <p>Connect via:</p>
    <ul>
      <li>Run a cell while disconnected (prompts for backend and session)</li>
      <li><strong>Select Kernel</strong> / <strong>Connect to EMR Serverless Session</strong> / <strong>Connect to Glue Session</strong></li>
      <li>Attach from the Applications or Glue Sessions sidebar</li>
    </ul>
    <p><strong>Disconnect Notebook Session</strong> unbinds the notebook but leaves the remote session running.</p>
  </section>

  <section id="cells">
    <h2>Running cells</h2>
    <ul>
      <li>Run cells with the notebook run controls or <kbd>Shift+Enter</kbd></li>
      <li>Python: last expression is auto-displayed (DataFrames become tables)</li>
      <li>SQL: <code>SELECT</code>, <code>SHOW</code>, <code>DESCRIBE</code>, <code>EXPLAIN</code> render as tables</li>
      <li>Progress and errors appear inline below each cell</li>
      <li><code>%pip install</code> and <code>!pip install</code> work on the session driver</li>
    </ul>
  </section>

  <section id="outputs">
    <h2>DataFrame outputs</h2>
    <ul>
      <li>Interactive tables with sort, column filter, and CSV export</li>
      <li>Row limit controlled by <code>emrServerless.maxRows</code> (default 1000)</li>
      <li>Only <code>limit + 1</code> rows are fetched for display</li>
    </ul>
  </section>

  <section id="spark-ui">
    <h2>Spark UI</h2>
    <ul>
      <li>Spark UI links appear in cell output and the status bar when a session is connected</li>
      <li><strong>Open Spark UI</strong> opens the dashboard in your browser</li>
      <li>Globe icon on session rows in the Applications sidebar</li>
      <li>URLs expire after about one hour — refresh from the sidebar or use <strong>Refresh Spark UI Link</strong> (EMR)</li>
    </ul>
  </section>

  <section id="status-bar">
    <h2>Status bar</h2>
    <table>
      <thead><tr><th>Item</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td><code>$(globe) Spark UI</code></td><td>Open Spark UI (when a notebook is connected)</td></tr>
      </tbody>
    </table>
    <p>AWS profile and region are in the <strong>Config</strong> sidebar view.</p>
  </section>

  <section id="commands">
    <h2>Commands</h2>
    <p>Open the Command Palette (<kbd>Cmd/Ctrl+Shift+P</kbd>) and search for <strong>EMR Serverless</strong> or <strong>Glue Interactive</strong>:</p>
    <h3>EMR Serverless</h3>
    <table>
      <thead><tr><th>Command</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td>New EMR Serverless Notebook</td><td>Create <code>.ipynb</code> or <code>.sparknb</code></td></tr>
        <tr><td>Connect to EMR Serverless Session</td><td>Backend picker → EMR session wizard</td></tr>
        <tr><td>Start / Stop / Restart Application</td><td>Manage EMR Serverless apps</td></tr>
        <tr><td>New Session / Attach / Stop Session</td><td>Manage EMR Livy sessions</td></tr>
        <tr><td>New / Edit Session Preset</td><td>Manage EMR session presets</td></tr>
      </tbody>
    </table>
    <h3>Glue Interactive</h3>
    <table>
      <thead><tr><th>Command</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td>Connect to Glue Session</td><td>Backend picker → Glue session wizard</td></tr>
        <tr><td>New Glue Session</td><td>Create a Glue interactive session</td></tr>
        <tr><td>Attach / Stop Glue Session</td><td>Manage Glue sessions</td></tr>
        <tr><td>New / Edit Glue Session Preset</td><td>Manage Glue session presets</td></tr>
      </tbody>
    </table>
    <h3>Shared</h3>
    <table>
      <thead><tr><th>Command</th><th>Description</th></tr></thead>
      <tbody>
        <tr><td>Disconnect Notebook Session</td><td>Unbind notebook from session</td></tr>
        <tr><td>Select AWS Profile / Region</td><td>Change credentials or region</td></tr>
        <tr><td>Open Spark UI</td><td>Open dashboard for connected session</td></tr>
        <tr><td>Help</td><td>Open this page</td></tr>
      </tbody>
    </table>
  </section>

  <section id="settings">
    <h2>Settings</h2>
    <p>Search <strong>EMR Serverless</strong> or <strong>Glue Interactive</strong> in Settings (<kbd>Cmd/Ctrl+,</kbd>):</p>
    <h3>EMR Serverless</h3>
    <table>
      <thead><tr><th>Setting</th><th>Purpose</th></tr></thead>
      <tbody>
        <tr><td><code>emrServerless.awsProfile</code></td><td>Named AWS profile (empty = default chain)</td></tr>
        <tr><td><code>emrServerless.awsRegion</code></td><td>AWS region for API calls</td></tr>
        <tr><td><code>emrServerless.defaultExecutionRoleArn</code></td><td>IAM role for new Livy sessions</td></tr>
        <tr><td><code>emrServerless.maxRows</code></td><td>Max rows in DataFrame tables</td></tr>
        <tr><td><code>emrServerless.icebergCatalog.*</code></td><td>Iceberg + Glue catalog Spark conf</td></tr>
        <tr><td><code>emrServerless.sessionPresets.workspaceFile</code></td><td>Path to team EMR presets JSON</td></tr>
      </tbody>
    </table>
    <h3>Glue Interactive</h3>
    <table>
      <thead><tr><th>Setting</th><th>Purpose</th></tr></thead>
      <tbody>
        <tr><td><code>glueInteractive.defaultRoleArn</code></td><td>IAM role for new Glue sessions</td></tr>
        <tr><td><code>glueInteractive.sessionDefaults</code></td><td>Default CreateSession fields</td></tr>
        <tr><td><code>glueInteractive.sessionPresets.workspaceFile</code></td><td>Path to team Glue presets JSON</td></tr>
      </tbody>
    </table>
  </section>

  <script nonce="welcome">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('button[data-command]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const command = btn.getAttribute('data-command');
        if (command) {
          vscode.postMessage({ type: 'runCommand', command });
        }
      });
    });
  </script>
</body>
</html>`;
}
