import * as vscode from 'vscode';
import type { PresetStore, PresetWithSource } from './createPresetStore';
import {
  PresetEditorController,
  type PresetEditorControllerOptions,
  type PresetEditorUi,
} from './presetEditorShell';

export interface PresetEditorPanelOptions {
  presetId?: string;
  onMutated?: () => void;
}

export function createVscodePresetEditorUi(): PresetEditorUi {
  return {
    showErrorMessage: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    showInformationMessage: (message) => {
      void vscode.window.showInformationMessage(message);
    },
    showDeleteConfirm: async (message) => {
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, 'Delete');
      return choice === 'Delete' ? 'Delete' : undefined;
    },
  };
}

export interface PresetEditorPanelConfig<T extends PresetWithSource & { name: string; id: string }> {
  viewType: string;
  defaultTitle: string;
  titleForPreset: (preset: T) => string;
  emptyTitle: string;
  createController: (
    store: PresetStore<T>,
    getWebview: () => vscode.Webview | undefined,
    options: PresetEditorControllerOptions<T>
  ) => PresetEditorController<T>;
}

/** Factory for singleton webview panel hosts (EMR / Glue). */
export function createPresetEditorPanelHost<T extends PresetWithSource & { name: string; id: string }>(
  panelConfig: PresetEditorPanelConfig<T>
) {
  let current:
    | {
        panel: vscode.WebviewPanel;
        controller: PresetEditorController<T>;
      }
    | undefined;

  function show(
    _context: vscode.ExtensionContext,
    store: PresetStore<T>,
    options?: PresetEditorPanelOptions
  ): void {
    if (current) {
      if (options?.presetId) {
        current.controller.setSelectedId(options.presetId);
      }
      current.panel.reveal();
      void current.controller.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      panelConfig.viewType,
      panelConfig.defaultTitle,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const controller = panelConfig.createController(store, () => panel.webview, {
      onMutated: options?.onMutated,
      onPresetLoaded: (preset) => {
        panel.title = preset
          ? panelConfig.titleForPreset(preset)
          : panelConfig.emptyTitle;
      },
      onDeleted: () => {
        panel.dispose();
      },
    });

    if (options?.presetId) {
      controller.setSelectedId(options.presetId);
    }
    controller.bind(panel.webview);
    panel.onDidDispose(() => {
      current = undefined;
    });
    current = { panel, controller };
    void controller.refresh();
  }

  return {
    show,
    getCurrentController: () => current?.controller,
  };
}
