import * as vscode from 'vscode';
import { createGluePresetId, buildDefaultGluePreset } from '../glue/presetModel';
import type { GlueSessionPresetStore } from '../glue/presets';
import { getGlueWorkspacePresetsUri } from '../glue/presets';
import { pickGluePresetSource } from '../ui/pickGluePresetSource';
import {
  ConfigTreeItem,
  CONFIG_VIEW_ID,
  type ConfigTreeProvider,
} from './configTreeProvider';
import { GluePresetsPanel } from '../ui/gluePresetsPanel';
import { registerPresetActions } from '../presets/registerPresetActions';

function resolveGluePresetId(
  presetId: string | undefined,
  item?: ConfigTreeItem
): string | undefined {
  if (presetId) {
    return presetId;
  }
  if (item?.gluePreset?.id) {
    return item.gluePreset.id;
  }
  return undefined;
}

export function registerGluePresetsActions(
  context: vscode.ExtensionContext,
  store: GlueSessionPresetStore,
  tree: ConfigTreeProvider
): void {
  registerPresetActions(context, {
    store,
    commands: {
      edit: 'glueInteractive.editSessionPreset',
      new: 'glueInteractive.newSessionPreset',
      open: 'glueInteractive.openSessionPresets',
      openWorkspaceFile: 'glueInteractive.openWorkspacePresetsFile',
      export: 'glueInteractive.exportPresetsToWorkspace',
    },
    resolvePresetId: (presetId, item) =>
      resolveGluePresetId(presetId, item as ConfigTreeItem | undefined),
    openEditor: (presetId) => {
      GluePresetsPanel.show(context, store, {
        presetId,
        onMutated: () => void tree.refreshGluePresets(),
      });
    },
    refreshTree: () => void tree.refreshGluePresets(),
    focusConfigViewCommand: `${CONFIG_VIEW_ID}.focus`,
    buildDefault: buildDefaultGluePreset,
    createId: createGluePresetId,
    newPresetName: (n) => `Glue Preset ${n}`,
    pickSource: () => pickGluePresetSource(store),
    getWorkspaceFileUri: getGlueWorkspacePresetsUri,
    workspaceFileCreatePrompt:
      'No workspace Glue presets file yet. Create .vscode/glue-interactive-presets.json?',
    noWorkspaceFolderMessage: 'Open a workspace folder to edit team Glue session presets.',
    exportEmptyMessage: 'All personal Glue presets already exist in the workspace file.',
    exportSuccessMessage: (added) =>
      `Exported ${added} personal Glue preset(s) to the workspace file.`,
  });
}
