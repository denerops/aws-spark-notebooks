import * as vscode from 'vscode';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import type { SessionPresetStore } from '../session/presets';
import type { GlueSessionPresetStore } from '../glue/presets';
import { selectEmrKernel } from './kernelSelection';
import { pickSparkBackend, selectGlueKernel } from './glueKernelSelection';
import { isEmrSparkNotebook } from '../notebook/types';

export async function promptSparkConnection(
  connectionHub: NotebookConnectionHub,
  emrPresetStore: SessionPresetStore,
  gluePresetStore: GlueSessionPresetStore,
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
    vscode.window.showWarningMessage('Open a .sparknb or .ipynb notebook to connect.');
    return false;
  }

  const backend = await pickSparkBackend();
  if (!backend) {
    return false;
  }

  const connected =
    backend === 'glue'
      ? await selectGlueKernel(
          connectionHub.getGlueManager(),
          gluePresetStore,
          targetNotebook
        )
      : await selectEmrKernel(
          connectionHub.getEmrManager(),
          emrPresetStore,
          targetNotebook
        );

  if (connected) {
    onConnected?.(targetNotebook);
  }
  return connected;
}

/** @deprecated Use promptSparkConnection */
export const promptEmrConnection = promptSparkConnection;
