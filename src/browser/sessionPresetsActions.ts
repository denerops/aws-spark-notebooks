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
  const openEditor = (presetId?: string) => {
    SessionPresetsPanel.show(context, store, {
      presetId,
      onMutated: () => void tree.refreshPresets(),
    });
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.editSessionPreset',
      (presetId?: string, item?: ConfigTreeItem) => {
        openEditor(resolvePresetId(presetId, item));
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.newSessionPreset', async () => {
      const source = await pickPresetSource(store);
      if (!source) {
        return;
      }

      const presets = await store.list();
      const defaults = buildDefaultPreset();
      const preset = {
        ...defaults,
        id: createPresetId(),
        name: `Preset ${presets.length + 1}`,
        source,
      };
      await store.save(preset, source);
      void tree.refreshPresets();
      openEditor(preset.id);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshSessionPresets', () => {
      void tree.refreshPresets();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshConfig', () => {
      void tree.refreshAll();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.openSessionPresets', async () => {
      await vscode.commands.executeCommand(`${CONFIG_VIEW_ID}.focus`);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.openWorkspacePresetsFile', async () => {
      const uri = getWorkspacePresetsUri();
      if (!uri) {
        vscode.window.showWarningMessage('Open a workspace folder to edit team session presets.');
        return;
      }

      const exists = await store.hasWorkspacePresetsFile();
      if (!exists) {
        const create = await vscode.window.showInformationMessage(
          'No workspace presets file yet. Create .vscode/emr-serverless-presets.json?',
          'Create',
          'Cancel'
        );
        if (create !== 'Create') {
          return;
        }
        await store.ensureWorkspacePresetsFile(true);
        void tree.refreshPresets();
      }

      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.exportPresetsToWorkspace', async () => {
      try {
        const added = await store.exportUserPresetsToWorkspace();
        void tree.refreshPresets();
        if (added === 0) {
          vscode.window.showInformationMessage(
            'All personal presets already exist in the workspace file.'
          );
        } else {
          vscode.window.showInformationMessage(
            `Exported ${added} personal preset(s) to the workspace file.`
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );
}
