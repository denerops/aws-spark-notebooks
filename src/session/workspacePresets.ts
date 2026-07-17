import { getExtensionConfig } from '../aws/config';
import { createWorkspacePresetFileIO } from '../presets/workspaceFile';
import {
  normalizePreset,
  stripRuntimeFields,
  type SessionPreset,
} from './presetModel';

export const DEFAULT_WORKSPACE_PRESETS_FILE = '.vscode/emr-serverless-presets.json';

export function getWorkspacePresetsRelativePath(): string {
  return getExtensionConfig().get<string>(
    'sessionPresets.workspaceFile',
    DEFAULT_WORKSPACE_PRESETS_FILE
  );
}

const emrWorkspaceFile = createWorkspacePresetFileIO<SessionPreset>({
  getRelativePath: getWorkspacePresetsRelativePath,
  normalize: normalizePreset,
  stripRuntime: stripRuntimeFields,
  label: 'session presets',
});

export const getWorkspaceFolderForPresets = emrWorkspaceFile.getFolder;
export const getWorkspacePresetsUri = emrWorkspaceFile.getUri;
export const workspacePresetsFileExists = emrWorkspaceFile.fileExists;
export const readWorkspacePresets = emrWorkspaceFile.read;
export const writeWorkspacePresets = emrWorkspaceFile.write;
export const watchWorkspacePresets = emrWorkspaceFile.watch;

export { emrWorkspaceFile };
