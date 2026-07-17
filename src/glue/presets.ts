import * as vscode from 'vscode';
import { getGlueExtensionConfig } from '../aws/glueConfig';
import { createPresetStore, type PresetStore } from '../presets/createPresetStore';
import { createWorkspacePresetFileIO } from '../presets/workspaceFile';
import { assertValidPythonPackageSpecs } from '../session/pythonPackages';
import { assertValidSparkPackageSpecs } from '../session/sparkPackages';
import {
  buildDefaultGluePreset,
  createGluePresetId,
  normalizeGluePreset,
  stripGlueRuntimeFields,
  type GluePresetSource,
  type GlueSessionPreset,
} from './presetModel';

export type { GlueSessionPreset, GluePresetSource } from './presetModel';
export {
  createGluePresetId,
  buildDefaultGluePreset,
  buildDefaultGlueArguments,
  buildDefaultGlueTags,
  normalizeGluePreset,
} from './presetModel';

const STORAGE_KEY = 'glueInteractive.sessionPresets';
export const DEFAULT_GLUE_WORKSPACE_PRESETS_FILE = '.vscode/glue-interactive-presets.json';

export function getGlueWorkspacePresetsRelativePath(): string {
  return getGlueExtensionConfig().get<string>(
    'sessionPresets.workspaceFile',
    DEFAULT_GLUE_WORKSPACE_PRESETS_FILE
  );
}

const glueWorkspaceFile = createWorkspacePresetFileIO<GlueSessionPreset>({
  getRelativePath: getGlueWorkspacePresetsRelativePath,
  normalize: normalizeGluePreset,
  stripRuntime: stripGlueRuntimeFields,
  label: 'Glue session presets',
});

export const getGlueWorkspacePresetsUri = glueWorkspaceFile.getUri;
export const glueWorkspacePresetsFileExists = glueWorkspaceFile.fileExists;
export const readGlueWorkspacePresets = glueWorkspaceFile.read;
export const writeGlueWorkspacePresets = glueWorkspaceFile.write;
export const watchGlueWorkspacePresets = glueWorkspaceFile.watch;

export type GlueSessionPresetStore = PresetStore<GlueSessionPreset>;

function assertGluePresetPackages(preset: GlueSessionPreset): void {
  assertValidPythonPackageSpecs(preset.pythonPackages ?? []);
  assertValidSparkPackageSpecs(preset.sparkPackages ?? []);
}

export function createGlueSessionPresetStore(
  context: vscode.ExtensionContext
): GlueSessionPresetStore {
  return createPresetStore<GlueSessionPreset>({
    userStorage: {
      get: () => context.globalState.get<GlueSessionPreset[]>(STORAGE_KEY) ?? [],
      set: async (presets) => {
        await context.globalState.update(STORAGE_KEY, presets);
      },
    },
    getPreferWorkspace: () =>
      getGlueExtensionConfig().get<boolean>('sessionPresets.preferWorkspace', true),
    workspace: glueWorkspaceFile,
    normalize: normalizeGluePreset,
    buildDefault: buildDefaultGluePreset,
    assertOnSave: assertGluePresetPackages,
    lastDeleteError: 'Cannot delete the last Glue session preset.',
    emptyExportError: 'No personal Glue presets to export.',
    onWorkspaceReadError: (message) => {
      void vscode.window.showErrorMessage(message);
    },
    addSubscription: (disposable) => {
      context.subscriptions.push(disposable);
    },
  });
}

let glueStoreInstance: GlueSessionPresetStore | undefined;

export function getGlueSessionPresetStore(
  context: vscode.ExtensionContext
): GlueSessionPresetStore {
  if (!glueStoreInstance) {
    glueStoreInstance = createGlueSessionPresetStore(context);
  }
  return glueStoreInstance;
}
