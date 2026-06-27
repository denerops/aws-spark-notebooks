import * as vscode from 'vscode';
import type { SessionPresetSource, SessionPresetStore } from '../session/presets';

export async function pickPresetSource(
  store: SessionPresetStore
): Promise<SessionPresetSource | undefined> {
  if (!(await store.hasWorkspaceScope())) {
    return 'user';
  }

  const hasWorkspaceFile = await store.hasWorkspacePresetsFile();
  const items: Array<{
    label: string;
    description: string;
    detail: string;
    source: SessionPresetSource;
  }> = [
    {
      label: '$(repo) Team preset (workspace)',
      description: '.vscode/emr-serverless-presets.json',
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
    title: 'Preset scope',
    placeHolder: hasWorkspaceFile
      ? 'Choose where to store the new preset'
      : 'Create a workspace presets file for team sharing',
  });

  return pick?.source;
}
