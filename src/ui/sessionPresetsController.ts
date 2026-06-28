import * as vscode from 'vscode';
import type { SessionPreset, SessionPresetStore } from '../session/presets';
import { getSparkConfSuggestionsForEditor } from '../session/sparkConfSuggestions';
import { assertValidPythonPackageSpecs, normalizePythonPackages } from '../session/pythonPackages';
import { assertValidSparkPackageSpecs, normalizeSparkPackages } from '../session/sparkPackages';

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
        const normalizedPackages = normalizePythonPackages(preset.pythonPackages);
        assertValidPythonPackageSpecs(normalizedPackages);
        const normalizedSparkPackages = normalizeSparkPackages(preset.sparkPackages);
        assertValidSparkPackageSpecs(normalizedSparkPackages);
        await this.store.save(
          {
            ...preset,
            pythonPackages: normalizedPackages,
            sparkPackages: normalizedSparkPackages,
          },
          source
        );
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
  const sparkConfSuggestionsJson = JSON.stringify(getSparkConfSuggestionsForEditor());
  const packageSpecPatternJson = JSON.stringify('^[^\\s;&|`$()]+$');

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
    .kv-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
    .kv-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      align-items: start;
    }
    .kv-key-wrap { position: relative; min-width: 0; }
    .kv-suggestions {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 20;
      max-height: 220px;
      overflow-y: auto;
      background: var(--vscode-dropdown-background, var(--input-bg));
      color: var(--vscode-dropdown-foreground, var(--input-fg));
      border: 1px solid var(--border);
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .kv-suggestions[hidden] { display: none; }
    .kv-suggestion {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      text-align: left;
      background: transparent;
      color: inherit;
      border: none;
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      cursor: pointer;
      font: inherit;
    }
    .kv-suggestion:last-child { border-bottom: none; }
    .kv-suggestion:hover,
    .kv-suggestion.active {
      background: var(--vscode-list-hoverBackground);
    }
    .kv-suggestion-key {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.85rem;
      word-break: break-all;
    }
    .kv-suggestion-value {
      font-size: 0.75rem;
      color: var(--muted);
      word-break: break-all;
    }
    .kv-suggestion-desc {
      font-size: 0.72rem;
      color: var(--muted);
    }
    .package-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
    .package-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
    }
    @media (max-width: 600px) {
      .kv-row { grid-template-columns: 1fr; }
      .kv-row .btn-icon { justify-self: start; }
    }
    .btn-icon {
      background: transparent;
      color: var(--vscode-foreground);
      border: 1px solid var(--border);
      border-radius: 4px;
      width: 32px;
      height: 32px;
      cursor: pointer;
      font: inherit;
      line-height: 1;
      padding: 0;
    }
    .btn-icon:hover { background: var(--vscode-toolbar-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      cursor: pointer;
      font: inherit;
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
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
      <h2>Driver</h2>
      <div class="grid">
        <label>Memory <input id="driverMemory" type="text" placeholder="4G" /></label>
        <label>Cores (optional) <input id="driverCores" type="number" min="1" step="1" /></label>
      </div>
    </div>

    <div class="section">
      <h2>Executors</h2>
      <div class="grid">
        <label>Count <input id="numExecutors" type="number" min="1" step="1" /></label>
        <label>Cores <input id="executorCores" type="number" min="1" step="1" /></label>
        <label>Memory <input id="executorMemory" type="text" placeholder="16G" /></label>
      </div>
    </div>

    <div class="section">
      <h2>Session</h2>
      <div class="grid">
        <label>Heartbeat timeout (sec) <input id="heartbeatTimeoutInSecond" type="number" min="30" step="1" /></label>
        <label>TTL (optional) <input id="ttl" type="text" placeholder="e.g. 8h" /></label>
      </div>
      <p class="hint">Heartbeat timeout is how long Livy waits between client pings before stopping the session. TTL is the maximum session lifetime.</p>
    </div>

    <div class="section">
      <h2>Spark conf</h2>
      <div id="sparkConfRows" class="kv-list"></div>
      <button type="button" class="secondary" id="addSparkConfRow">Add entry</button>
      <p class="hint">Spark configuration passed to Livy when the session starts. Click a key field or type to pick from common options.</p>
    </div>

    <div class="section">
      <h2>Spark packages</h2>
      <div id="sparkPackageRows" class="package-list"></div>
      <button type="button" class="secondary" id="addSparkPackageRow">Add package</button>
      <p class="hint">Resolved from Maven and added to spark.jars.packages when the session starts. Use one Maven coordinate per row (e.g. org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0).</p>
    </div>

    <div class="section">
      <h2>Python packages</h2>
      <div id="pythonPackageRows" class="package-list"></div>
      <button type="button" class="secondary" id="addPythonPackageRow">Add package</button>
      <p class="hint">Installed with pip when the session starts. Use one PyPI spec per row (e.g. pandas, scikit-learn==1.3.0). For native deps, use spark.archives in Spark conf.</p>
    </div>

    <div class="actions">
      <button class="primary" id="saveBtn">Save preset</button>
      <button class="danger" id="deleteBtn">Delete preset</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let current = ${presetJson};
    const sparkConfSuggestions = ${sparkConfSuggestionsJson};

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
      sparkConfRows: document.getElementById('sparkConfRows'),
      sparkPackageRows: document.getElementById('sparkPackageRows'),
      pythonPackageRows: document.getElementById('pythonPackageRows'),
    };

    const PACKAGE_SPEC_PATTERN = new RegExp(${packageSpecPatternJson});

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function getUsedSparkConfKeys(exceptInput) {
      const used = new Set();
      els.sparkConfRows.querySelectorAll('.kv-key').forEach((input) => {
        if (input !== exceptInput) {
          const key = input.value.trim();
          if (key) {
            used.add(key);
          }
        }
      });
      return used;
    }

    function attachKeyAutocomplete(keyInput, valueInput, keyWrap) {
      const list = document.createElement('div');
      list.className = 'kv-suggestions';
      list.hidden = true;
      keyWrap.appendChild(list);

      let activeIndex = -1;

      function hideSuggestions() {
        list.hidden = true;
        list.innerHTML = '';
        activeIndex = -1;
      }

      function getMatches() {
        const query = keyInput.value.trim().toLowerCase();
        const usedKeys = getUsedSparkConfKeys(keyInput);
        return sparkConfSuggestions.filter((suggestion) => {
          if (usedKeys.has(suggestion.key)) {
            return false;
          }
          if (!query) {
            return true;
          }
          return suggestion.key.toLowerCase().includes(query);
        }).slice(0, 12);
      }

      function setActiveIndex(index) {
        const buttons = list.querySelectorAll('.kv-suggestion');
        buttons.forEach((button, i) => {
          button.classList.toggle('active', i === index);
        });
        activeIndex = index;
        const active = buttons[index];
        if (active) {
          active.scrollIntoView({ block: 'nearest' });
        }
      }

      function selectSuggestion(suggestion) {
        keyInput.value = suggestion.key;
        if (suggestion.value && !valueInput.value.trim()) {
          valueInput.value = suggestion.value;
        }
        hideSuggestions();
        valueInput.focus();
      }

      function renderSuggestions() {
        const matches = getMatches();
        if (matches.length === 0) {
          hideSuggestions();
          return;
        }

        list.innerHTML = '';
        matches.forEach((suggestion, index) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'kv-suggestion';
          button.innerHTML =
            '<span class="kv-suggestion-key">' + escapeHtml(suggestion.key) + '</span>' +
            (suggestion.value
              ? '<span class="kv-suggestion-value">' + escapeHtml(suggestion.value) + '</span>'
              : '') +
            (suggestion.description
              ? '<span class="kv-suggestion-desc">' + escapeHtml(suggestion.description) + '</span>'
              : '');
          button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            selectSuggestion(suggestion);
          });
          button.addEventListener('mouseenter', () => setActiveIndex(index));
          list.appendChild(button);
        });
        list.hidden = false;
        activeIndex = -1;
      }

      keyInput.addEventListener('focus', renderSuggestions);
      keyInput.addEventListener('input', renderSuggestions);
      keyInput.addEventListener('keydown', (event) => {
        if (list.hidden) {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            renderSuggestions();
          }
          return;
        }

        const buttons = list.querySelectorAll('.kv-suggestion');
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveIndex(Math.min(activeIndex + 1, buttons.length - 1));
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveIndex(Math.max(activeIndex - 1, 0));
        } else if (event.key === 'Enter' && activeIndex >= 0) {
          event.preventDefault();
          const match = getMatches()[activeIndex];
          if (match) {
            selectSuggestion(match);
          }
        } else if (event.key === 'Escape') {
          hideSuggestions();
        }
      });
      keyInput.addEventListener('blur', () => {
        setTimeout(hideSuggestions, 120);
      });
    }

    function addSparkConfRow(key = '', value = '', focusKey = false) {
      const row = document.createElement('div');
      row.className = 'kv-row';

      const keyWrap = document.createElement('div');
      keyWrap.className = 'kv-key-wrap';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'kv-key';
      keyInput.placeholder = 'spark.conf.key';
      keyInput.value = key;
      keyWrap.appendChild(keyInput);

      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'kv-value';
      valueInput.placeholder = 'value';
      valueInput.value = value;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove entry';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();

      attachKeyAutocomplete(keyInput, valueInput, keyWrap);

      row.appendChild(keyWrap);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      els.sparkConfRows.appendChild(row);

      if (focusKey) {
        keyInput.focus();
      }
    }

    function renderSparkConfRows(sparkConf) {
      els.sparkConfRows.innerHTML = '';
      const entries = Object.entries(sparkConf || {}).sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) {
        addSparkConfRow('', '', false);
        return;
      }
      for (const [key, value] of entries) {
        addSparkConfRow(key, value, false);
      }
    }

    function readSparkConf() {
      const rows = els.sparkConfRows.querySelectorAll('.kv-row');
      const conf = {};
      const duplicates = new Set();
      for (const row of rows) {
        const key = row.querySelector('.kv-key').value.trim();
        const value = row.querySelector('.kv-value').value.trim();
        if (!key) {
          continue;
        }
        if (Object.prototype.hasOwnProperty.call(conf, key)) {
          duplicates.add(key);
        }
        conf[key] = value;
      }
      if (duplicates.size > 0) {
        alert('Duplicate Spark conf keys: ' + Array.from(duplicates).join(', '));
        return null;
      }
      return conf;
    }

    function addSparkPackageRow(spec = '', focus = false) {
      const row = document.createElement('div');
      row.className = 'package-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'spark-package-spec';
      input.placeholder = 'e.g. org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0';
      input.value = spec;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove package';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();

      row.appendChild(input);
      row.appendChild(removeBtn);
      els.sparkPackageRows.appendChild(row);

      if (focus) {
        input.focus();
      }
    }

    function renderSparkPackageRows(packages) {
      els.sparkPackageRows.innerHTML = '';
      const specs = Array.isArray(packages) ? packages.filter(Boolean) : [];
      if (specs.length === 0) {
        return;
      }
      for (const spec of specs) {
        addSparkPackageRow(spec, false);
      }
    }

    function readSparkPackages() {
      const rows = els.sparkPackageRows.querySelectorAll('.package-row');
      const packages = [];
      const seen = new Set();
      const invalid = [];

      for (const row of rows) {
        const spec = row.querySelector('.spark-package-spec').value.trim();
        if (!spec) {
          continue;
        }
        if (!PACKAGE_SPEC_PATTERN.test(spec)) {
          invalid.push(spec);
          continue;
        }
        if (seen.has(spec)) {
          continue;
        }
        seen.add(spec);
        packages.push(spec);
      }

      if (invalid.length > 0) {
        alert('Invalid Spark package spec(s): ' + invalid.join(', '));
        return null;
      }

      return packages;
    }

    function addPythonPackageRow(spec = '', focus = false) {
      const row = document.createElement('div');
      row.className = 'package-row';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'package-spec';
      input.placeholder = 'e.g. pandas or scikit-learn==1.3.0';
      input.value = spec;

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove package';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();

      row.appendChild(input);
      row.appendChild(removeBtn);
      els.pythonPackageRows.appendChild(row);

      if (focus) {
        input.focus();
      }
    }

    function renderPythonPackageRows(packages) {
      els.pythonPackageRows.innerHTML = '';
      const specs = Array.isArray(packages) ? packages.filter(Boolean) : [];
      if (specs.length === 0) {
        return;
      }
      for (const spec of specs) {
        addPythonPackageRow(spec, false);
      }
    }

    function readPythonPackages() {
      const rows = els.pythonPackageRows.querySelectorAll('.package-row');
      const packages = [];
      const seen = new Set();
      const invalid = [];

      for (const row of rows) {
        const spec = row.querySelector('.package-spec').value.trim();
        if (!spec) {
          continue;
        }
        if (!PACKAGE_SPEC_PATTERN.test(spec)) {
          invalid.push(spec);
          continue;
        }
        if (seen.has(spec)) {
          continue;
        }
        seen.add(spec);
        packages.push(spec);
      }

      if (invalid.length > 0) {
        alert('Invalid Python package spec(s): ' + invalid.join(', '));
        return null;
      }

      return packages;
    }

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
      renderSparkConfRows(current.sparkConf || {});
      renderSparkPackageRows(current.sparkPackages || []);
      renderPythonPackageRows(current.pythonPackages || []);
    }

    function readForm() {
      const sparkConf = readSparkConf();
      if (sparkConf === null) {
        return null;
      }
      const sparkPackages = readSparkPackages();
      if (sparkPackages === null) {
        return null;
      }
      const pythonPackages = readPythonPackages();
      if (pythonPackages === null) {
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
        sparkPackages,
        pythonPackages,
      };
    }

    document.getElementById('addSparkConfRow').onclick = () => addSparkConfRow('', '', true);
    document.getElementById('addSparkPackageRow').onclick = () => addSparkPackageRow('', true);
    document.getElementById('addPythonPackageRow').onclick = () => addPythonPackageRow('', true);

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
  const base = 'Executor sizing, memory, IAM role, Spark conf, Spark packages, and Python packages for new Livy sessions.';
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
