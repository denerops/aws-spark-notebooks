import * as vscode from 'vscode';
import { createPresetId, buildDefaultPreset } from '../session/presets';
import type { SessionPresetStore } from '../session/presets';
import {
  ConfigTreeItem,
  CONFIG_VIEW_ID,
  type ConfigTreeProvider,
} from './configTreeProvider';
import { SessionPresetsPanel } from '../ui/sessionPresetsPanel';
import { pickPresetSource } from '../ui/pickPresetSource';
import { getWorkspacePresetsUri } from '../session/workspacePresets';
import { registerPresetActions } from '../presets/registerPresetActions';

function resolvePresetId(
  presetId: string | undefined,
  item?: ConfigTreeItem
): string | undefined {
  if (presetId) {
    return presetId;
  }
  if (item?.emrPreset?.id) {
    return item.emrPreset.id;
  }
  return undefined;
}

export function registerSessionPresetsActions(
  context: vscode.ExtensionContext,
  store: SessionPresetStore,
  tree: ConfigTreeProvider
): void {
  registerPresetActions(context, {
    store,
    commands: {
      edit: 'emrServerless.editSessionPreset',
      new: 'emrServerless.newSessionPreset',
      open: 'emrServerless.openSessionPresets',
      openWorkspaceFile: 'emrServerless.openWorkspacePresetsFile',
      export: 'emrServerless.exportPresetsToWorkspace',
      refresh: 'emrServerless.refreshSessionPresets',
    },
    resolvePresetId: (presetId, item) => resolvePresetId(presetId, item as ConfigTreeItem | undefined),
    openEditor: (presetId) => {
      SessionPresetsPanel.show(context, store, {
        presetId,
        onMutated: () => void tree.refreshPresets(),
      });
    },
    refreshTree: () => void tree.refreshPresets(),
    focusConfigViewCommand: `${CONFIG_VIEW_ID}.focus`,
    buildDefault: buildDefaultPreset,
    createId: createPresetId,
    newPresetName: (n) => `Preset ${n}`,
    pickSource: () => pickPresetSource(store),
    getWorkspaceFileUri: getWorkspacePresetsUri,
    workspaceFileCreatePrompt:
      'No workspace presets file yet. Create .vscode/emr-serverless-presets.json?',
    noWorkspaceFolderMessage: 'Open a workspace folder to edit team session presets.',
    exportEmptyMessage: 'All personal presets already exist in the workspace file.',
    exportSuccessMessage: (added) =>
      `Exported ${added} personal preset(s) to the workspace file.`,
    openWorkspaceFileChooser: [
      {
        label: 'EMR Serverless',
        description: '.vscode/emr-serverless-presets.json',
        backend: 'emr',
      },
      {
        label: 'Glue Interactive',
        description: '.vscode/glue-interactive-presets.json',
        backend: 'glue',
      },
    ],
    onWorkspaceFileBackendChosen: async (backend) => {
      if (backend === 'glue') {
        await vscode.commands.executeCommand('glueInteractive.openWorkspacePresetsFile');
        return true;
      }
      return false;
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshConfig', () => {
      void tree.refreshAll();
    })
  );
}
