import * as vscode from 'vscode';
import type { GluePresetSource, GlueSessionPresetStore } from '../glue/presets';
import { DEFAULT_GLUE_WORKSPACE_PRESETS_FILE } from '../glue/presets';

export async function pickGluePresetSource(
  store: GlueSessionPresetStore
): Promise<GluePresetSource | undefined> {
  if (!(await store.hasWorkspaceScope())) {
    return 'user';
  }

  const hasWorkspaceFile = await store.hasWorkspacePresetsFile();
  const items: Array<{
    label: string;
    description: string;
    detail: string;
    source: GluePresetSource;
  }> = [
    {
      label: '$(repo) Team preset (workspace)',
      description: DEFAULT_GLUE_WORKSPACE_PRESETS_FILE,
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
    title: 'Glue preset scope',
    placeHolder: hasWorkspaceFile
      ? 'Choose where to store the new Glue preset'
      : 'Create a workspace presets file for team sharing',
  });

  return pick?.source;
}
