import * as vscode from 'vscode';
import type { GlueSessionPresetStore } from '../glue/presets';
import { isEmrSparkNotebook } from '../notebook/types';
import type { NotebookConnection } from '../platform/notebookConnection';
import type {
  EmrSparkBackendAdapter,
  GlueSparkBackendAdapter,
} from '../platform/sparkBackend';
import type { SessionPresetStore } from '../session/presets';
import { createKernelSelectionSteps } from './createKernelSelectionSteps';
import { selectKernel } from './selectKernel';

export async function promptSparkConnection(
  connection: NotebookConnection,
  emr: EmrSparkBackendAdapter,
  glue: GlueSparkBackendAdapter,
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

  const steps = createKernelSelectionSteps(emr, glue, emrPresetStore, gluePresetStore);
  const connected = await selectKernel(connection, steps, targetNotebook);

  if (connected) {
    onConnected?.(targetNotebook);
  }
  return connected;
}

/** @deprecated Use promptSparkConnection */
export const promptEmrConnection = promptSparkConnection;
