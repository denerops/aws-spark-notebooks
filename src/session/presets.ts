import * as vscode from 'vscode';
import { createPresetStore, type PresetStore } from '../presets/createPresetStore';
import { assertValidPythonPackageSpecs } from './pythonPackages';
import { assertValidSparkPackageSpecs } from './sparkPackages';
import {
  buildDefaultPreset,
  createPresetId,
  normalizePreset,
  type SessionPreset,
  type SessionPresetSource,
} from './presetModel';
import { emrWorkspaceFile } from './workspacePresets';

export type { SessionPreset, SessionPresetSource } from './presetModel';
export { createPresetId, buildDefaultPreset, buildDefaultSparkConf, normalizePreset } from './presetModel';

const STORAGE_KEY = 'emrServerless.sessionPresets';

export type SessionPresetStore = PresetStore<SessionPreset>;

function assertSessionPresetPackages(preset: SessionPreset): void {
  assertValidPythonPackageSpecs(preset.pythonPackages ?? []);
  assertValidSparkPackageSpecs(preset.sparkPackages ?? []);
}

export function createSessionPresetStore(context: vscode.ExtensionContext): SessionPresetStore {
  return createPresetStore<SessionPreset>({
    userStorage: {
      get: () => context.globalState.get<SessionPreset[]>(STORAGE_KEY) ?? [],
      set: async (presets) => {
        await context.globalState.update(STORAGE_KEY, presets);
      },
    },
    getPreferWorkspace: () =>
      vscode.workspace
        .getConfiguration('emrServerless')
        .get<boolean>('sessionPresets.preferWorkspace', true),
    workspace: emrWorkspaceFile,
    normalize: normalizePreset,
    buildDefault: buildDefaultPreset,
    assertOnSave: assertSessionPresetPackages,
    lastDeleteError: 'Cannot delete the last session preset.',
    emptyExportError: 'No personal presets to export.',
    onWorkspaceReadError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    addSubscription: (disposable) => {
      context.subscriptions.push(disposable);
    },
  });
}

let storeInstance: SessionPresetStore | undefined;

export function getSessionPresetStore(context: vscode.ExtensionContext): SessionPresetStore {
  if (!storeInstance) {
    storeInstance = createSessionPresetStore(context);
  }
  return storeInstance;
}
