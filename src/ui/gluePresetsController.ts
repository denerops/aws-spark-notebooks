import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';
import { DEFAULT_GLUE_WORKSPACE_PRESETS_FILE } from '../glue/presets';
import { getGlueDefaultArgumentSuggestionsForEditor } from '../glue/glueArgumentSuggestions';
import { escapeHtml, renderWebviewPage } from './webviewDesignSystem';
import {
  PresetEditorController,
  type PresetEditorControllerOptions,
  type PresetPanelMessage as PresetPanelMessageImported,
} from '../presets/presetEditorShell';
import { createVscodePresetEditorUi } from '../presets/presetEditorPanel';
import {
  PYTHON_PACKAGE_SPEC_PATTERN_SOURCE,
  SPARK_PACKAGE_SPEC_PATTERN_SOURCE,
  formSharedScript,
  packageSectionsHtml,
  saveDeleteActionsHtml,
  saveDeleteHandlersScript,
} from '../presets/formShared';

export type GluePresetPanelMessage = PresetPanelMessageImported<GlueSessionPreset>;
export type GluePresetsControllerOptions = PresetEditorControllerOptions<GlueSessionPreset>;

const WORKER_TYPES = ['G.1X', 'G.2X', 'G.4X', 'G.8X', 'G.025X', 'Standard', 'Z.2X'];
const GLUE_VERSIONS = ['5.0', '4.0', '3.0'];

export class GluePresetsController extends PresetEditorController<GlueSessionPreset> {
  constructor(
    store: GlueSessionPresetStore,
    getWebview: () => import('vscode').Webview | undefined,
    options: GluePresetsControllerOptions = {}
  ) {
    super({
      store,
      getWebview,
      options,
      renderHtml: renderGluePresetEditorHtml,
      prepareForSave: (preset) => ({
        ...preset,
        connections: (preset.connections ?? []).filter(Boolean),
        tags: { ...(preset.tags ?? {}) },
      }),
      savedMessage: (preset, scopeLabel) =>
        `Saved ${scopeLabel} Glue preset "${preset.name}".`,
      deleteConfirmMessage: (name) => `Delete Glue preset "${name}"?`,
      deletedMessage: (name) => `Deleted Glue preset "${name}".`,
      emptyStateTitle: 'Glue Session Preset',
      ui: createVscodePresetEditorUi(),
    });
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
  const pythonPatternJson = JSON.stringify(PYTHON_PACKAGE_SPEC_PATTERN_SOURCE);
  const sparkPatternJson = JSON.stringify(SPARK_PACKAGE_SPEC_PATTERN_SOURCE);
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

  ${packageSectionsHtml({
    sparkHint: 'Maven coordinates added to spark.jars.packages at session start.',
    pythonHint: 'Installed with pip when the session starts.',
  })}

  ${saveDeleteActionsHtml()}`,
    script: `
    const vscode = acquireVsCodeApi();
    let current = ${presetJson};
    const sparkConfSuggestions = ${sparkConfSuggestionsJson};
    const PYTHON_PACKAGE_SPEC_PATTERN = new RegExp(${pythonPatternJson});
    const SPARK_PACKAGE_SPEC_PATTERN = new RegExp(${sparkPatternJson});

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

    ${formSharedScript()}

    function addDefaultArgRow(key = '', value = '', focusKey = false) {
      addKvRow(els.defaultArgRows, {
        key, value, focusKey,
        keyPlaceholder: 'spark.conf.key',
        suggestions: sparkConfSuggestions,
        getUsedKeys: (except) => getUsedKeysInContainer(els.defaultArgRows, except),
      });
    }

    function addTagRow(key = '', value = '', focusKey = false) {
      addKvRow(els.tagRows, {
        key, value, focusKey,
        keyPlaceholder: 'e.g. team',
        valuePlaceholder: 'e.g. data-platform',
      });
    }

    function addConnectionRow(name = '', focus = false) {
      addPackageRow(els.connectionRows, 'connection-name', 'e.g. my-glue-connection', name, focus);
    }

    function renderConnectionRows(connections) {
      els.connectionRows.innerHTML = '';
      for (const name of (Array.isArray(connections) ? connections.filter(Boolean) : [])) {
        addConnectionRow(name, false);
      }
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
      addPackageRow(els.sparkPackageRows, 'spark-package-spec',
        'e.g. org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0', spec, focus);
    }

    function addPythonPackageRow(spec = '', focus = false) {
      addPackageRow(els.pythonPackageRows, 'package-spec',
        'e.g. pandas or scikit-learn==1.3.0', spec, focus);
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
      els.tagRows.innerHTML = '';
      for (const [key, value] of Object.entries(current.tags || {}).sort(([a], [b]) => a.localeCompare(b))) {
        addTagRow(key, value, false);
      }
      renderKvRows(els.defaultArgRows, current.defaultArguments || {}, addDefaultArgRow);
      renderPackageRows(els.sparkPackageRows, current.sparkPackages || [], addSparkPackageRow);
      renderPackageRows(els.pythonPackageRows, current.pythonPackages || [], addPythonPackageRow);
    }

    function readForm() {
      const defaultArguments = readKvMap(els.defaultArgRows, 'default argument keys');
      if (defaultArguments === null) return null;
      const tags = readKvMap(els.tagRows, 'tag keys');
      if (tags === null) return null;
      const sparkPackages = readPackageSpecs(els.sparkPackageRows, 'spark-package-spec', SPARK_PACKAGE_SPEC_PATTERN, 'Spark package spec(s)');
      if (sparkPackages === null) return null;
      const pythonPackages = readPackageSpecs(els.pythonPackageRows, 'package-spec', PYTHON_PACKAGE_SPEC_PATTERN, 'Python package spec(s)');
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
    ${saveDeleteHandlersScript()}
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
