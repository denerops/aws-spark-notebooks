import type { SessionPreset, SessionPresetStore } from '../session/presets';
import { getSparkConfSuggestionsForEditor } from '../session/sparkConfSuggestions';
import { DEFAULT_WORKSPACE_PRESETS_FILE } from '../session/workspacePresets';
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

export type PresetPanelMessage = PresetPanelMessageImported<SessionPreset>;
export type SessionPresetsControllerOptions = PresetEditorControllerOptions<SessionPreset>;

export class SessionPresetsController extends PresetEditorController<SessionPreset> {
  constructor(
    store: SessionPresetStore,
    getWebview: () => import('vscode').Webview | undefined,
    options: SessionPresetsControllerOptions = {}
  ) {
    super({
      store,
      getWebview,
      options,
      renderHtml: renderSessionPresetEditorHtml,
      savedMessage: (preset, scopeLabel) => `Saved ${scopeLabel} preset "${preset.name}".`,
      deleteConfirmMessage: (name) => `Delete preset "${name}"?`,
      deletedMessage: (name) => `Deleted preset "${name}".`,
      emptyStateTitle: 'Session Preset',
      ui: createVscodePresetEditorUi(),
    });
  }
}

export function renderSessionPresetEditorHtml(preset: SessionPreset | undefined): string {
  if (!preset) {
    return renderWebviewPage({
      title: 'Session Preset',
      body: `<p class="empty-state">Select a preset from the <strong>Config</strong> panel in the sidebar to edit it.</p>`,
    });
  }

  const presetJson = JSON.stringify(preset);
  const sparkConfSuggestionsJson = JSON.stringify(getSparkConfSuggestionsForEditor());
  const pythonPatternJson = JSON.stringify(PYTHON_PACKAGE_SPEC_PATTERN_SOURCE);
  const sparkPatternJson = JSON.stringify(SPARK_PACKAGE_SPEC_PATTERN_SOURCE);

  return renderWebviewPage({
    title: preset.name,
    body: `
  <header class="page-header">
    <h1>${escapeHtml(preset.name)}</h1>
    <p class="page-description">${presetSourceSubtitle(preset)}</p>
  </header>

  <section class="settings-group">
    <h2>General</h2>
    <label class="field">
      <span class="field-label">Name</span>
      <input id="name" type="text" placeholder="e.g. Small dev cluster" />
    </label>
    <label class="field">
      <span class="field-label">Livy session name (optional)</span>
      <input id="livySessionName" type="text" placeholder="e.g. notebook_dev" />
    </label>
    <p class="hint">When set, appears in the EMR Serverless sidebar instead of Session N.</p>
  </section>

  <section class="settings-group">
    <h2>IAM</h2>
    <label class="field">
      <span class="field-label">Execution role ARN</span>
      <input id="executionRoleArn" type="text" placeholder="arn:aws:iam::123456789012:role/EMRServerlessRole" />
    </label>
    <p class="hint">Passed as emr-serverless.session.executionRoleArn. Your user needs iam:PassRole on this role.</p>
  </section>

  <section class="settings-group">
    <h2>Driver</h2>
    <div class="grid">
      <label class="field"><span class="field-label">Memory</span> <input id="driverMemory" type="text" placeholder="4G" /></label>
      <label class="field"><span class="field-label">Cores (optional)</span> <input id="driverCores" type="number" min="1" step="1" /></label>
    </div>
  </section>

  <section class="settings-group">
    <h2>Executors</h2>
    <div class="grid">
      <label class="field"><span class="field-label">Count</span> <input id="numExecutors" type="number" min="1" step="1" /></label>
      <label class="field"><span class="field-label">Cores</span> <input id="executorCores" type="number" min="1" step="1" /></label>
      <label class="field"><span class="field-label">Memory</span> <input id="executorMemory" type="text" placeholder="16G" /></label>
    </div>
  </section>

  <section class="settings-group">
    <h2>Session</h2>
    <div class="grid">
      <label class="field"><span class="field-label">Heartbeat timeout (sec)</span> <input id="heartbeatTimeoutInSecond" type="number" min="30" step="1" /></label>
      <label class="field"><span class="field-label">TTL (optional)</span> <input id="ttl" type="text" placeholder="e.g. 8h" /></label>
    </div>
    <p class="hint">Heartbeat timeout is how long Livy waits between client pings before stopping the session. TTL is the maximum session lifetime.</p>
  </section>

  <section class="settings-group">
    <h2>Spark conf</h2>
    <div id="sparkConfRows" class="kv-list"></div>
    <button type="button" class="secondary" id="addSparkConfRow">Add entry</button>
    <p class="hint">Spark configuration passed to Livy when the session starts. Click a key field or type to pick from common options.</p>
  </section>

  ${packageSectionsHtml({
    sparkHint:
      'Resolved from Maven and added to spark.jars.packages when the session starts. Use one Maven coordinate per row (e.g. org.apache.iceberg:iceberg-spark-runtime-3.5_2.12:1.5.0).',
    pythonHint:
      'Installed with pip when the session starts. Use one PyPI spec per row (e.g. pandas, scikit-learn==1.3.0). For native deps, use spark.archives in Spark conf.',
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

    ${formSharedScript()}

    function addSparkConfRow(key = '', value = '', focusKey = false) {
      addKvRow(els.sparkConfRows, {
        key, value, focusKey,
        keyPlaceholder: 'spark.conf.key',
        suggestions: sparkConfSuggestions,
        getUsedKeys: (except) => getUsedKeysInContainer(els.sparkConfRows, except),
      });
    }

    function renderSparkConfRows(sparkConf) {
      renderKvRows(els.sparkConfRows, sparkConf, addSparkConfRow);
    }

    function readSparkConf() {
      return readKvMap(els.sparkConfRows, 'Spark conf keys');
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
      renderPackageRows(els.sparkPackageRows, current.sparkPackages || [], addSparkPackageRow);
      renderPackageRows(els.pythonPackageRows, current.pythonPackages || [], addPythonPackageRow);
    }

    function readForm() {
      const sparkConf = readSparkConf();
      if (sparkConf === null) return null;
      const sparkPackages = readPackageSpecs(els.sparkPackageRows, 'spark-package-spec', SPARK_PACKAGE_SPEC_PATTERN, 'Spark package spec(s)');
      if (sparkPackages === null) return null;
      const pythonPackages = readPackageSpecs(els.pythonPackageRows, 'package-spec', PYTHON_PACKAGE_SPEC_PATTERN, 'Python package spec(s)');
      if (pythonPackages === null) return null;
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
    ${saveDeleteHandlersScript()}
    fillForm();
`,
  });
}

function presetSourceSubtitle(preset: SessionPreset): string {
  const base =
    'Executor sizing, memory, IAM role, Spark conf, Spark packages, and Python packages for new Livy sessions.';
  if (preset.source === 'workspace') {
    return `Team preset — stored in ${DEFAULT_WORKSPACE_PRESETS_FILE} (committed with the repo). ${base}`;
  }
  if (preset.source === 'user') {
    return `Personal preset — stored in your local extension settings. ${base}`;
  }
  return base;
}
