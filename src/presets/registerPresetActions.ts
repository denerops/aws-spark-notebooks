import * as vscode from 'vscode';
import type { PresetSource, PresetStore, PresetWithSource } from './createPresetStore';

export interface PresetActionsConfig<T extends PresetWithSource & { name: string }> {
  store: PresetStore<T>;
  commands: {
    edit: string;
    new: string;
    open: string;
    openWorkspaceFile: string;
    export: string;
    refresh?: string;
  };
  resolvePresetId: (presetId: string | undefined, item?: unknown) => string | undefined;
  openEditor: (presetId?: string) => void;
  refreshTree: () => void;
  /** VS Code command to focus the Config view, e.g. `emrServerlessConfig.focus`. */
  focusConfigViewCommand: string;
  buildDefault: () => T;
  createId: () => string;
  newPresetName: (count: number) => string;
  pickSource: () => Promise<PresetSource | undefined>;
  getWorkspaceFileUri: () => vscode.Uri | undefined;
  workspaceFileCreatePrompt: string;
  noWorkspaceFolderMessage: string;
  exportEmptyMessage: string;
  exportSuccessMessage: (added: number) => string;
  /** When set, openWorkspaceFile shows a backend chooser first (EMR dual-open). */
  openWorkspaceFileChooser?: Array<{
    label: string;
    description: string;
    backend: string;
  }>;
  onWorkspaceFileBackendChosen?: (backend: string) => Promise<boolean>;
}

export function registerPresetActions<T extends PresetWithSource & { name: string }>(
  context: vscode.ExtensionContext,
  config: PresetActionsConfig<T>
): void {
  const {
    store,
    commands,
    resolvePresetId,
    openEditor,
    refreshTree,
    focusConfigViewCommand,
    buildDefault,
    createId,
    newPresetName,
    pickSource,
    getWorkspaceFileUri,
    workspaceFileCreatePrompt,
    noWorkspaceFolderMessage,
    exportEmptyMessage,
    exportSuccessMessage,
  } = config;

  context.subscriptions.push(
    vscode.commands.registerCommand(commands.edit, (presetId?: string, item?: unknown) => {
      openEditor(resolvePresetId(presetId, item));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(commands.new, async () => {
      const source = await pickSource();
      if (!source) {
        return;
      }

      const presets = await store.list();
      const defaults = buildDefault();
      const preset = {
        ...defaults,
        id: createId(),
        name: newPresetName(presets.length + 1),
        source,
      };
      await store.save(preset, source);
      refreshTree();
      openEditor(preset.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(commands.open, async () => {
      await vscode.commands.executeCommand(focusConfigViewCommand);
    })
  );

  if (commands.refresh) {
    context.subscriptions.push(
      vscode.commands.registerCommand(commands.refresh, () => {
        refreshTree();
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(commands.openWorkspaceFile, async () => {
      if (config.openWorkspaceFileChooser?.length) {
        const pick = await vscode.window.showQuickPick(config.openWorkspaceFileChooser, {
          title: 'Open workspace presets file',
          placeHolder: 'Choose which presets file to open',
        });
        if (!pick) {
          return;
        }
        if (config.onWorkspaceFileBackendChosen) {
          const handled = await config.onWorkspaceFileBackendChosen(pick.backend);
          if (handled) {
            return;
          }
        }
      }

      const uri = getWorkspaceFileUri();
      if (!uri) {
        vscode.window.showWarningMessage(noWorkspaceFolderMessage);
        return;
      }

      const exists = await store.hasWorkspacePresetsFile();
      if (!exists) {
        const create = await vscode.window.showInformationMessage(
          workspaceFileCreatePrompt,
          'Create',
          'Cancel'
        );
        if (create !== 'Create') {
          return;
        }
        await store.ensureWorkspacePresetsFile(true);
        refreshTree();
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(commands.export, async () => {
      try {
        const added = await store.exportUserPresetsToWorkspace();
        refreshTree();
        if (added === 0) {
          vscode.window.showInformationMessage(exportEmptyMessage);
        } else {
          vscode.window.showInformationMessage(exportSuccessMessage(added));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );
}
