import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import type { SessionPresetStore } from '../session/presets';
import { selectEmrKernel } from './kernelSelection';
import { isEmrSparkNotebook } from '../notebook/types';

export async function promptEmrConnection(
  connectionManager: ConnectionManager,
  presetStore: SessionPresetStore,
  notebook?: vscode.NotebookDocument,
  onConnected?: (notebook: vscode.NotebookDocument) => void
): Promise<boolean> {
  const targetNotebook =
    notebook ??
    (vscode.window.activeNotebookEditor?.notebook &&
    isEmrSparkNotebook(vscode.window.activeNotebookEditor.notebook)
      ? vscode.window.activeNotebookEditor.notebook
      : undefined);

  if (!targetNotebook) {
    vscode.window.showWarningMessage('Open a .sparknb or .ipynb notebook with EMR Serverless to connect.');
    return false;
  }

  const connected = await selectEmrKernel(connectionManager, presetStore, targetNotebook);
  if (connected) {
    onConnected?.(targetNotebook);
  }
  return connected;
}
