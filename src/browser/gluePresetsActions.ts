import * as vscode from 'vscode';
import { createGluePresetId, buildDefaultGluePreset } from '../glue/presetModel';
import type { GlueSessionPresetStore } from '../glue/presets';
import { pickGluePresetSource } from '../ui/pickGluePresetSource';
import {
  getGlueWorkspacePresetsUri,
  glueWorkspacePresetsFileExists,
} from '../glue/presets';
import {
  ConfigTreeItem,
  CONFIG_VIEW_ID,
  type ConfigTreeProvider,
} from './configTreeProvider';
import { GluePresetsPanel } from '../ui/gluePresetsPanel';

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
  const openEditor = (presetId?: string) => {
    GluePresetsPanel.show(context, store, {
      presetId,
      onMutated: () => void tree.refreshGluePresets(),
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'glueInteractive.editSessionPreset',
      (presetId?: string, item?: ConfigTreeItem) => {
        openEditor(resolveGluePresetId(presetId, item));
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.newSessionPreset', async () => {
      const source = await pickGluePresetSource(store);
      if (!source) {
        return;
      }

      const presets = await store.list();
      const defaults = buildDefaultGluePreset();
      const preset = {
        ...defaults,
        id: createGluePresetId(),
        name: `Glue Preset ${presets.length + 1}`,
        source,
      };
      await store.save(preset, source);
      void tree.refreshGluePresets();
      openEditor(preset.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.openSessionPresets', async () => {
      await vscode.commands.executeCommand(`${CONFIG_VIEW_ID}.focus`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.openWorkspacePresetsFile', async () => {
      const uri = getGlueWorkspacePresetsUri();
      if (!uri) {
        vscode.window.showWarningMessage('Open a workspace folder to edit team Glue session presets.');
        return;
      }

      const exists = await glueWorkspacePresetsFileExists();
      if (!exists) {
        const create = await vscode.window.showInformationMessage(
          'No workspace Glue presets file yet. Create .vscode/glue-interactive-presets.json?',
          'Create',
          'Cancel'
        );
        if (create !== 'Create') {
          return;
        }
        await store.ensureWorkspacePresetsFile(true);
        void tree.refreshGluePresets();
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.exportPresetsToWorkspace', async () => {
      try {
        const added = await store.exportUserPresetsToWorkspace();
        void tree.refreshGluePresets();
        if (added === 0) {
          vscode.window.showInformationMessage(
            'All personal Glue presets already exist in the workspace file.'
          );
        } else {
          vscode.window.showInformationMessage(
            `Exported ${added} personal Glue preset(s) to the workspace file.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );
}
