import * as vscode from 'vscode';
import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';
import { DEFAULT_GLUE_WORKSPACE_PRESETS_FILE } from '../glue/presets';
import { getGlueDefaultArgumentSuggestionsForEditor } from '../glue/glueArgumentSuggestions';
import { assertValidPythonPackageSpecs, normalizePythonPackages } from '../session/pythonPackages';
import { assertValidSparkPackageSpecs, normalizeSparkPackages } from '../session/sparkPackages';
import { escapeHtml, renderWebviewPage } from './webviewDesignSystem';

export type GluePresetPanelMessage =
  | { type: 'save'; preset: GlueSessionPreset }
  | { type: 'delete'; id: string };

export interface GluePresetsControllerOptions {
  onMutated?: () => void;
  onPresetLoaded?: (preset: GlueSessionPreset | undefined) => void;
  onDeleted?: () => void;
}

const WORKER_TYPES = ['G.1X', 'G.2X', 'G.4X', 'G.8X', 'G.025X', 'Standard', 'Z.2X'];
const GLUE_VERSIONS = ['5.0', '4.0', '3.0'];

export class GluePresetsController {
  private selectedId: string | undefined;

  constructor(
    private readonly store: GlueSessionPresetStore,
    private readonly getWebview: () => vscode.Webview | undefined,
    private readonly options: GluePresetsControllerOptions = {}
  ) {}

  bind(webview: vscode.Webview): void {
    webview.onDidReceiveMessage((msg: GluePresetPanelMessage) => {
      void this.handleMessage(msg);
    });
  }

  setSelectedId(id: string | undefined): void {
    this.selectedId = id;
  }

  getSelectedId(): string | undefined {
    return this.selectedId;
  }

  async handleMessage(msg: GluePresetPanelMessage): Promise<void> {
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
            connections: (preset.connections ?? []).filter(Boolean),
            tags: { ...(preset.tags ?? {}) },
          },
          source
        );
        this.selectedId = preset.id;
        this.options.onMutated?.();
        const scopeLabel = source === 'workspace' ? 'workspace' : 'personal';
        vscode.window.showInformationMessage(`Saved ${scopeLabel} Glue preset "${preset.name}".`);
        await this.refresh();
        break;
      }
      case 'delete': {
        const preset = await this.store.get(msg.id);
        const name = preset?.name ?? 'this preset';
        const choice = await vscode.window.showWarningMessage(
          `Delete Glue preset "${name}"?`,
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
          vscode.window.showInformationMessage(`Deleted Glue preset "${name}".`);
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

    let preset: GlueSessionPreset | undefined;
    if (this.selectedId) {
      preset = await this.store.get(this.selectedId);
      if (!preset) {
        this.selectedId = undefined;
      }
    }

    this.options.onPresetLoaded?.(preset);
    webview.html = renderGluePresetEditorHtml(preset);
  }
}

export function renderGluePresetEditorHtml(preset: GlueSessionPreset | undefined): string {
  if (!preset) {
    return renderWebviewPage({
      title: 'Glue Session Preset',
      body: `<p class="empty-state">Select a Glue preset from the <strong>Config</strong> panel in the sidebar to edit it.</p>`,
    });
  }

  const presetJson = JSON.stringify(preset);
  const sparkConfSuggestionsJson = JSON.stringify(getGlueDefaultArgumentSuggestionsForEditor());
  const packageSpecPatternJson = JSON.stringify('^[^\\s;&|`$()]+$');
  const workerTypeOptions = WORKER_TYPES.map(
    (type) =>
      `<option value="${type}"${preset.workerType === type ? ' selected' : ''}>${type}</option>`
  ).join('');
  const glueVersionOptions = GLUE_VERSIONS.map(
    (version) =>
      `<option value="${version}"${preset.glueVersion === version ? ' selected' : ''}>${version}</option>`
  ).join('');

  return renderWebviewPage({
    title: preset.name,
    body: `
  <header class="page-header">
    <h1>${escapeHtml(preset.name)}</h1>
    <p class="page-description">${gluePresetSourceSubtitle(preset)}</p>
  </header>

  <section class="settings-group">
    <h2>General</h2>
    <label class="field">
      <span class="field-label">Name</span>
      <input id="name" type="text" placeholder="e.g. Glue dev cluster" />
    </label>
    <label class="field">
      <span class="field-label">Session description (optional)</span>
      <input id="sessionDescription" type="text" placeholder="e.g. notebook_dev" />
    </label>
    <p class="hint">Shown in the Glue Sessions sidebar when creating a session from this preset.</p>
  </section>

  <section class="settings-group">
    <h2>IAM</h2>
    <label class="field">
      <span class="field-label">Execution role ARN</span>
      <input id="roleArn" type="text" placeholder="arn:aws:iam::123456789012:role/GlueInteractiveSessionRole" />
    </label>
    <p class="hint">Passed to Glue CreateSession. Your user needs iam:PassRole on this role.</p>
  </section>

  <section class="settings-group">
    <h2>Glue session</h2>
    <div class="grid">
      <label class="field">
        <span class="field-label">Glue version</span>
        <select id="glueVersion">${glueVersionOptions}</select>
      </label>
      <label class="field">
        <span class="field-label">Worker type</span>
        <select id="workerType">${workerTypeOptions}</select>
      </label>
      <label class="field">
        <span class="field-label">Number of workers</span>
        <input id="numberOfWorkers" type="number" min="1" step="1" />
      </label>
      <label class="field">
        <span class="field-label">Python version</span>
        <input id="pythonVersion" type="text" placeholder="3" />
      </label>
      <label class="field">
        <span class="field-label">Idle timeout (minutes)</span>
        <input id="idleTimeout" type="number" min="1" step="1" />
      </label>
      <label class="field">
        <span class="field-label">Max timeout (minutes, optional)</span>
        <input id="timeout" type="number" min="1" step="1" />
      </label>
    </div>
    <p class="hint">Idle timeout stops the session after inactivity. Max timeout is the hard session limit.</p>
  </section>

  <section class="settings-group">
    <h2>Glue connections</h2>
    <div id="connectionRows" class="package-list"></div>
    <button type="button" class="secondary" id="addConnectionRow">Add connection</button>
    <p class="hint">Optional Glue connection names passed to CreateSession.</p>
  </section>

  <section class="settings-group">
    <h2>Session tags</h2>
    <div id="tagRows" class="kv-list"></div>
    <button type="button" class="secondary" id="addTagRow">Add tag</button>
    <p class="hint">Key-value tags passed to Glue CreateSession (for cost allocation, ownership, etc.).</p>
  </section>

  <section class="settings-group">
    <h2>Default arguments</h2>
    <div id="defaultArgRows" class="kv-list"></div>
    <button type="button" class="secondary" id="addDefaultArgRow">Add entry</button>
    <p class="hint">Glue DefaultArguments: Spark conf keys and Glue job args such as <code>--enable-glue-datacatalog</code>.</p>
  </section>

  <section class="settings-group">
    <h2>Spark packages</h2>
    <div id="sparkPackageRows" class="package-list"></div>
    <button type="button" class="secondary" id="addSparkPackageRow">Add package</button>
    <p class="hint">Maven coordinates added to spark.jars.packages at session start.</p>
  </section>

  <section class="settings-group">
    <h2>Python packages</h2>
    <div id="pythonPackageRows" class="package-list"></div>
    <button type="button" class="secondary" id="addPythonPackageRow">Add package</button>
    <p class="hint">Installed with pip when the session starts.</p>
  </section>

  <div class="actions">
    <button type="button" id="saveBtn">Save preset</button>
    <button type="button" class="danger" id="deleteBtn">Delete preset</button>
  </div>`,
    script: `
    const vscode = acquireVsCodeApi();
    let current = ${presetJson};
    const sparkConfSuggestions = ${sparkConfSuggestionsJson};

    const els = {
      name: document.getElementById('name'),
      sessionDescription: document.getElementById('sessionDescription'),
      roleArn: document.getElementById('roleArn'),
      glueVersion: document.getElementById('glueVersion'),
      workerType: document.getElementById('workerType'),
      numberOfWorkers: document.getElementById('numberOfWorkers'),
      pythonVersion: document.getElementById('pythonVersion'),
      idleTimeout: document.getElementById('idleTimeout'),
      timeout: document.getElementById('timeout'),
      connectionRows: document.getElementById('connectionRows'),
      tagRows: document.getElementById('tagRows'),
      defaultArgRows: document.getElementById('defaultArgRows'),
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

    function getUsedArgKeys(exceptInput) {
      const used = new Set();
      els.defaultArgRows.querySelectorAll('.kv-key').forEach((input) => {
        if (input !== exceptInput) {
          const key = input.value.trim();
          if (key) used.add(key);
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
        const usedKeys = getUsedArgKeys(keyInput);
        return sparkConfSuggestions.filter((suggestion) => {
          if (usedKeys.has(suggestion.key)) return false;
          if (!query) return true;
          return suggestion.key.toLowerCase().includes(query);
        }).slice(0, 12);
      }

      function setActiveIndex(index) {
        const buttons = list.querySelectorAll('.kv-suggestion');
        buttons.forEach((button, i) => button.classList.toggle('active', i === index));
        activeIndex = index;
        const active = buttons[index];
        if (active) active.scrollIntoView({ block: 'nearest' });
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
            (suggestion.value ? '<span class="kv-suggestion-value">' + escapeHtml(suggestion.value) + '</span>' : '') +
            (suggestion.description ? '<span class="kv-suggestion-desc">' + escapeHtml(suggestion.description) + '</span>' : '');
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
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') renderSuggestions();
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
          if (match) selectSuggestion(match);
        } else if (event.key === 'Escape') {
          hideSuggestions();
        }
      });
      keyInput.addEventListener('blur', () => setTimeout(hideSuggestions, 120));
    }

    function addDefaultArgRow(key = '', value = '', focusKey = false) {
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
      els.defaultArgRows.appendChild(row);
      if (focusKey) keyInput.focus();
    }

    function renderDefaultArgRows(defaultArguments) {
      els.defaultArgRows.innerHTML = '';
      const entries = Object.entries(defaultArguments || {}).sort(([a], [b]) => a.localeCompare(b));
      if (entries.length === 0) {
        addDefaultArgRow('', '', false);
        return;
      }
      for (const [key, value] of entries) addDefaultArgRow(key, value, false);
    }

    function readTags() {
      const rows = els.tagRows.querySelectorAll('.kv-row');
      const tags = {};
      const duplicates = new Set();
      for (const row of rows) {
        const key = row.querySelector('.kv-key').value.trim();
        const value = row.querySelector('.kv-value').value.trim();
        if (!key) continue;
        if (Object.prototype.hasOwnProperty.call(tags, key)) duplicates.add(key);
        tags[key] = value;
      }
      if (duplicates.size > 0) {
        alert('Duplicate tag keys: ' + Array.from(duplicates).join(', '));
        return null;
      }
      return tags;
    }

    function addTagRow(key = '', value = '', focusKey = false) {
      const row = document.createElement('div');
      row.className = 'kv-row';
      const keyWrap = document.createElement('div');
      keyWrap.className = 'kv-key-wrap';
      const keyInput = document.createElement('input');
      keyInput.type = 'text';
      keyInput.className = 'kv-key';
      keyInput.placeholder = 'e.g. team';
      keyInput.value = key;
      keyWrap.appendChild(keyInput);
      const valueInput = document.createElement('input');
      valueInput.type = 'text';
      valueInput.className = 'kv-value';
      valueInput.placeholder = 'e.g. data-platform';
      valueInput.value = value;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove tag';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();
      row.appendChild(keyWrap);
      row.appendChild(valueInput);
      row.appendChild(removeBtn);
      els.tagRows.appendChild(row);
      if (focusKey) keyInput.focus();
    }

    function renderTagRows(tags) {
      els.tagRows.innerHTML = '';
      const entries = Object.entries(tags || {}).sort(([a], [b]) => a.localeCompare(b));
      for (const [key, value] of entries) addTagRow(key, value, false);
    }

    function readDefaultArguments() {
      const rows = els.defaultArgRows.querySelectorAll('.kv-row');
      const conf = {};
      const duplicates = new Set();
      for (const row of rows) {
        const key = row.querySelector('.kv-key').value.trim();
        const value = row.querySelector('.kv-value').value.trim();
        if (!key) continue;
        if (Object.prototype.hasOwnProperty.call(conf, key)) duplicates.add(key);
        conf[key] = value;
      }
      if (duplicates.size > 0) {
        alert('Duplicate default argument keys: ' + Array.from(duplicates).join(', '));
        return null;
      }
      return conf;
    }

    function addConnectionRow(name = '', focus = false) {
      const row = document.createElement('div');
      row.className = 'package-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'connection-name';
      input.placeholder = 'e.g. my-glue-connection';
      input.value = name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-icon remove-row';
      removeBtn.title = 'Remove connection';
      removeBtn.textContent = '✕';
      removeBtn.onclick = () => row.remove();
      row.appendChild(input);
      row.appendChild(removeBtn);
      els.connectionRows.appendChild(row);
      if (focus) input.focus();
    }

    function renderConnectionRows(connections) {
      els.connectionRows.innerHTML = '';
      const names = Array.isArray(connections) ? connections.filter(Boolean) : [];
      for (const name of names) addConnectionRow(name, false);
    }

    function readConnections() {
      const rows = els.connectionRows.querySelectorAll('.package-row');
      const connections = [];
      const seen = new Set();
      for (const row of rows) {
        const name = row.querySelector('.connection-name').value.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        connections.push(name);
      }
      return connections;
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
      if (focus) input.focus();
    }

    function renderSparkPackageRows(packages) {
      els.sparkPackageRows.innerHTML = '';
      for (const spec of (Array.isArray(packages) ? packages.filter(Boolean) : [])) {
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
        if (!spec) continue;
        if (!PACKAGE_SPEC_PATTERN.test(spec)) { invalid.push(spec); continue; }
        if (seen.has(spec)) continue;
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
      if (focus) input.focus();
    }

    function renderPythonPackageRows(packages) {
      els.pythonPackageRows.innerHTML = '';
      for (const spec of (Array.isArray(packages) ? packages.filter(Boolean) : [])) {
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
        if (!spec) continue;
        if (!PACKAGE_SPEC_PATTERN.test(spec)) { invalid.push(spec); continue; }
        if (seen.has(spec)) continue;
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
      els.sessionDescription.value = current.sessionDescription || '';
      els.roleArn.value = current.roleArn || '';
      els.glueVersion.value = current.glueVersion || '4.0';
      els.workerType.value = current.workerType || 'G.1X';
      els.numberOfWorkers.value = current.numberOfWorkers ?? 2;
      els.pythonVersion.value = current.pythonVersion || '3';
      els.idleTimeout.value = current.idleTimeout ?? 30;
      els.timeout.value = current.timeout ?? '';
      renderConnectionRows(current.connections || []);
      renderTagRows(current.tags || {});
      renderDefaultArgRows(current.defaultArguments || {});
      renderSparkPackageRows(current.sparkPackages || []);
      renderPythonPackageRows(current.pythonPackages || []);
    }

    function readForm() {
      const defaultArguments = readDefaultArguments();
      if (defaultArguments === null) return null;
      const tags = readTags();
      if (tags === null) return null;
      const sparkPackages = readSparkPackages();
      if (sparkPackages === null) return null;
      const pythonPackages = readPythonPackages();
      if (pythonPackages === null) return null;
      const timeoutVal = els.timeout.value.trim();
      return {
        ...current,
        name: els.name.value.trim(),
        sessionDescription: els.sessionDescription.value.trim() || undefined,
        roleArn: els.roleArn.value.trim(),
        glueVersion: els.glueVersion.value,
        workerType: els.workerType.value,
        numberOfWorkers: Number(els.numberOfWorkers.value) || 2,
        pythonVersion: els.pythonVersion.value.trim() || '3',
        idleTimeout: Number(els.idleTimeout.value) || 30,
        timeout: timeoutVal ? Number(timeoutVal) : undefined,
        connections: readConnections(),
        tags,
        defaultArguments,
        sparkPackages,
        pythonPackages,
      };
    }

    document.getElementById('addTagRow').onclick = () => addTagRow('', '', true);
    document.getElementById('addDefaultArgRow').onclick = () => addDefaultArgRow('', '', true);
    document.getElementById('addConnectionRow').onclick = () => addConnectionRow('', true);
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
`,
  });
}

function gluePresetSourceSubtitle(preset: GlueSessionPreset): string {
  const base =
    'Glue workers, IAM role, default arguments, tags, connections, Spark packages, and Python packages for new Livy sessions.';
  if (preset.source === 'workspace') {
    return `Team preset — stored in ${DEFAULT_GLUE_WORKSPACE_PRESETS_FILE} (committed with the repo). ${base}`;
  }
  if (preset.source === 'user') {
    return `Personal preset — stored in your local extension settings. ${base}`;
  }
  return base;
}
