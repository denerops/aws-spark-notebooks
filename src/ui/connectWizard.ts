import * as vscode from 'vscode';
import type { GlueSessionPresetStore } from '../glue/presets';
import { isEmrSparkNotebook } from '../notebook/types';
import type { NotebookConnection } from '../platform/notebookConnection';
import type {
  EmrSparkBackendAdapter,
  GlueSparkBackendAdapter,
} from '../platform/sparkBackend';
import type { EmrSessionCatalog, GlueSessionCatalog } from '../platform/sessionCatalog';
import type { SessionPresetStore } from '../session/presets';
import { isSessionGoneError } from '../session/sessionState';
import { createKernelSelectionSteps } from './createKernelSelectionSteps';
import { selectKernel } from './selectKernel';

export async function promptSparkConnection(
  connection: NotebookConnection,
  emr: EmrSparkBackendAdapter,
  glue: GlueSparkBackendAdapter,
  emrPresetStore: SessionPresetStore,
  gluePresetStore: GlueSessionPresetStore,
  notebook?: vscode.NotebookDocument,
  onConnected?: (notebook: vscode.NotebookDocument) => void,
  catalogs?: { emr?: EmrSessionCatalog; glue?: GlueSessionCatalog }
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

  if (connection.hasSessionBinding(targetNotebook)) {
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Reconnecting to Spark session…',
        },
        () => connection.ensureConnected(targetNotebook)
      );
      onConnected?.(targetNotebook);
      return true;
    } catch (error) {
      if (!isSessionGoneError(error) && connection.hasSessionBinding(targetNotebook)) {
        vscode.window.showErrorMessage(
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    }
  }

  const steps = createKernelSelectionSteps(emr, glue, emrPresetStore, gluePresetStore, {
    catalogs,
  });
  const connected = await selectKernel(connection, steps, targetNotebook);

  if (connected) {
    onConnected?.(targetNotebook);
  }
  return connected;
}
