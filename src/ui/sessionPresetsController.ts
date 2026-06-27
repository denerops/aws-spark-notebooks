import * as vscode from 'vscode';
import type { SessionPreset, SessionPresetStore } from '../session/presets';

export type PresetPanelMessage =
  | { type: 'save'; preset: SessionPreset }
  | { type: 'delete'; id: string };

export interface SessionPresetsControllerOptions {
  onMutated?: () => void;
  onPresetLoaded?: (preset: SessionPreset | undefined) => void;
  onDeleted?: () => void;
}

export class SessionPresetsController {
  private selectedId: string | undefined;

  constructor(
    private readonly store: SessionPresetStore,
    private readonly getWebview: () => vscode.Webview | undefined,
    private readonly options: SessionPresetsControllerOptions = {}
  ) {}

  bind(webview: vscode.Webview): void {
    webview.onDidReceiveMessage((msg: PresetPanelMessage) => {
      void this.handleMessage(msg);
    });
  }

  setSelectedId(id: string | undefined): void {
    this.selectedId = id;
  }

  getSelectedId(): string | undefined {
    return this.selectedId;
  }

  async handleMessage(msg: PresetPanelMessage): Promise<void> {
    switch (msg.type) {
      case 'save': {
        const preset = msg.preset;
        if (!preset.name.trim()) {
          vscode.window.showErrorMessage('Preset name is required.');
          return;
        }
        const existing = this.selectedId ? await this.store.get(this.selectedId) : undefined;
        const source = existing?.source ?? preset.source;
        await this.store.save(preset, source);
        this.selectedId = preset.id;
        this.options.onMutated?.();
        const scopeLabel = source === 'workspace' ? 'workspace' : 'personal';
        vscode.window.showInformationMessage(`Saved ${scopeLabel} preset "${preset.name}".`);
        await this.refresh();
        break;
      }
      case 'delete': {
        const preset = await this.store.get(msg.id);
        const name = preset?.name ?? 'this preset';
        const choice = await vscode.window.showWarningMessage(
          `Delete preset "${name}"?`,
          { modal: true },
          'Delete'
        );
        if (choice !== 'Delete') {
          return;
        }
        try {
          await this.store.delete(msg.id);
          this.selectedId = undefined;
          this.options.onMutated?.();
          vscode.window.showInformationMessage(`Deleted preset "${name}".`);
          this.options.onDeleted?.();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
        break;
      }
    }
  }

  async refresh(): Promise<void> {
    const webview = this.getWebview();
    if (!webview) {
      return;
    }

    let preset: SessionPreset | undefined;
    if (this.selectedId) {
      preset = await this.store.get(this.selectedId);
      if (!preset) {
        this.selectedId = undefined;
      }
    }

    this.options.onPresetLoaded?.(preset);
    webview.html = renderSessionPresetEditorHtml(preset);
  }
}

export function renderSessionPresetEditorHtml(preset: SessionPreset | undefined): string {
  if (!preset) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      padding: 24px;
    }
  </style>
</head>
<body>
  <p>Select a preset from the <strong>Session Presets</strong> panel in the sidebar to edit it.</p>
</body>
</html>`;
  }

  const presetJson = JSON.stringify(preset);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(preset.name)}</title>
  <style>
    :root {
      --gap: 12px;
      --border: var(--vscode-panel-border, #444);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --btn-bg: var(--vscode-button-background);
      --btn-fg: var(--vscode-button-foreground);
      --btn-hover: var(--vscode-button-hoverBackground);
      --muted: var(--vscode-descriptionForeground);
    }
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 16px;
      max-width: 720px;
    }
    h1 { font-size: 1.25rem; margin: 0 0 4px; font-weight: 600; }
    .subtitle { color: var(--muted); margin-bottom: 16px; font-size: 0.9rem; }
    .form-panel {
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 16px;
    }
    .section { margin-bottom: 20px; }
    .section h2 {
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
      margin: 0 0 10px;
      font-weight: 600;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    label { display: flex; flex-direction: column; gap: 4px; font-size: 0.85rem; }
    input, textarea {
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 6px 8px;
      font: inherit;
      width: 100%;
    }
    textarea { min-height: 100px; font-family: var(--vscode-editor-font-family); font-size: 0.85rem; }
    .hint { font-size: 0.75rem; color: var(--muted); margin-top: 4px; }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
    button.primary, button.danger {
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      cursor: pointer;
      font: inherit;
    }
    button.primary { background: var(--btn-bg); color: var(--btn-fg); }
    button.primary:hover { background: var(--btn-hover); }
    button.danger {
      background: transparent;
      color: var(--vscode-errorForeground);
      border: 1px solid var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(preset.name)}</h1>
  <p class="subtitle">${presetSourceSubtitle(preset)}</p>

  <div class="form-panel">
    <div class="section">
      <h2>General</h2>
      <label>
        Name
        <input id="name" type="text" placeholder="e.g. Small dev cluster" />
      </label>
      <label>
        Livy session name (optional)
        <input id="livySessionName" type="text" placeholder="e.g. notebook_dev" />
      </label>
      <p class="hint">When set, appears in the EMR Serverless sidebar instead of Session N.</p>
    </div>

    <div class="section">
      <h2>IAM</h2>
      <label>
        Execution role ARN
        <input id="executionRoleArn" type="text" placeholder="arn:aws:iam::123456789012:role/EMRServerlessRole" />
      </label>
      <p class="hint">Passed as emr-serverless.session.executionRoleArn. Your user needs iam:PassRole on this role.</p>
    </div>

    <div class="section">
      <h2>Cluster sizing</h2>
      <div class="grid">
        <label>Driver memory <input id="driverMemory" type="text" placeholder="4G" /></label>
        <label>Executor memory <input id="executorMemory" type="text" placeholder="16G" /></label>
        <label>Executor cores <input id="executorCores" type="number" min="1" step="1" /></label>
        <label>Number of executors <input id="numExecutors" type="number" min="1" step="1" /></label>
        <label>Driver cores (optional) <input id="driverCores" type="number" min="1" step="1" /></label>
        <label>Heartbeat timeout (sec) <input id="heartbeatTimeoutInSecond" type="number" min="30" step="1" /></label>
      </div>
      <label style="margin-top:12px">
        Session TTL (optional)
        <input id="ttl" type="text" placeholder="e.g. 8h" />
      </label>
    </div>

    <div class="section">
      <h2>Additional Spark conf</h2>
      <label>
        Key-value JSON
        <textarea id="sparkConf" placeholder='{"spark.dynamicAllocation.enabled": "false"}'></textarea>
      </label>
      <p class="hint">Iceberg catalog settings from extension settings are always merged when the session starts.</p>
    </div>

    <div class="actions">
      <button class="primary" id="saveBtn">Save preset</button>
      <button class="danger" id="deleteBtn">Delete preset</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let current = ${presetJson};

    const els = {
      name: document.getElementById('name'),
      livySessionName: document.getElementById('livySessionName'),
      executionRoleArn: document.getElementById('executionRoleArn'),
      driverMemory: document.getElementById('driverMemory'),
      executorMemory: document.getElementById('executorMemory'),
      executorCores: document.getElementById('executorCores'),
      numExecutors: document.getElementById('numExecutors'),
      driverCores: document.getElementById('driverCores'),
      heartbeatTimeoutInSecond: document.getElementById('heartbeatTimeoutInSecond'),
      ttl: document.getElementById('ttl'),
      sparkConf: document.getElementById('sparkConf'),
    };

    function fillForm() {
      els.name.value = current.name || '';
      els.livySessionName.value = current.livySessionName || '';
      els.executionRoleArn.value = current.executionRoleArn || '';
      els.driverMemory.value = current.driverMemory || '';
      els.executorMemory.value = current.executorMemory || '';
      els.executorCores.value = current.executorCores ?? 4;
      els.numExecutors.value = current.numExecutors ?? 1;
      els.driverCores.value = current.driverCores ?? '';
      els.heartbeatTimeoutInSecond.value = current.heartbeatTimeoutInSecond ?? 60;
      els.ttl.value = current.ttl || '';
      els.sparkConf.value = JSON.stringify(current.sparkConf || {}, null, 2);
    }

    function readForm() {
      let sparkConf = {};
      try {
        const raw = els.sparkConf.value.trim();
        sparkConf = raw ? JSON.parse(raw) : {};
        if (typeof sparkConf !== 'object' || Array.isArray(sparkConf)) {
          throw new Error('Spark conf must be a JSON object');
        }
      } catch (e) {
        alert('Invalid Spark conf JSON: ' + e.message);
        return null;
      }

      const driverCoresVal = els.driverCores.value.trim();
      return {
        ...current,
        name: els.name.value.trim(),
        livySessionName: els.livySessionName.value.trim() || undefined,
        executionRoleArn: els.executionRoleArn.value.trim(),
        driverMemory: els.driverMemory.value.trim(),
        executorMemory: els.executorMemory.value.trim(),
        executorCores: Number(els.executorCores.value) || 1,
        numExecutors: Number(els.numExecutors.value) || 1,
        driverCores: driverCoresVal ? Number(driverCoresVal) : undefined,
        heartbeatTimeoutInSecond: Number(els.heartbeatTimeoutInSecond.value) || 60,
        ttl: els.ttl.value.trim() || undefined,
        sparkConf,
      };
    }

    document.getElementById('saveBtn').onclick = () => {
      const preset = readForm();
      if (preset) vscode.postMessage({ type: 'save', preset });
    };

    document.getElementById('deleteBtn').onclick = () => {
      vscode.postMessage({ type: 'delete', id: current.id });
    };

    fillForm();
  </script>
</body>
</html>`;
}

function presetSourceSubtitle(preset: SessionPreset): string {
  const base = 'Executor sizing, memory, IAM role, and Spark settings for new Livy sessions.';
  if (preset.source === 'workspace') {
    return `Team preset — stored in .vscode/emr-serverless-presets.json (committed with the repo). ${base}`;
  }
  if (preset.source === 'user') {
    return `Personal preset — stored in your local extension settings. ${base}`;
  }
  return base;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
