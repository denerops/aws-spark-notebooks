import * as vscode from 'vscode';
import type { PresetSource, PresetStore, PresetWithSource } from './createPresetStore';

export interface PickPresetSourceOptions {
  store: PresetStore<PresetWithSource>;
  workspaceFileDescription: string;
  title?: string;
  placeHolderWhenFileExists?: string;
  placeHolderWhenNoFile?: string;
}

export async function pickPresetSource(
  options: PickPresetSourceOptions
): Promise<PresetSource | undefined> {
  const {
    store,
    workspaceFileDescription,
    title = 'Preset scope',
    placeHolderWhenFileExists = 'Choose where to store the new preset',
    placeHolderWhenNoFile = 'Create a workspace presets file for team sharing',
  } = options;

  if (!(await store.hasWorkspaceScope())) {
    return 'user';
  }

  const hasWorkspaceFile = await store.hasWorkspacePresetsFile();
  const items: Array<{
    label: string;
    description: string;
    detail: string;
    source: PresetSource;
  }> = [
    {
      label: '$(repo) Team preset (workspace)',
      description: workspaceFileDescription,
      detail: 'Shared with the team via version control',
      source: 'workspace',
    },
    {
      label: '$(account) Personal preset',
      description: 'Local to this machine',
      detail: 'Not committed to the repository',
      source: 'user',
    },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: hasWorkspaceFile ? placeHolderWhenFileExists : placeHolderWhenNoFile,
  });

  return pick?.source;
}
