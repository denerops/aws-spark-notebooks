import * as vscode from 'vscode';
import type { NotebookConnection } from '../platform/notebookConnection';
import { isEmrSparkNotebook } from '../notebook/types';

export function getActiveSparknb(): vscode.NotebookDocument | undefined {
  const editor = vscode.window.activeNotebookEditor;
  if (editor && isEmrSparkNotebook(editor.notebook)) {
    return editor.notebook;
  }
  return undefined;
}

export function findOpenSparknb(): vscode.NotebookDocument | undefined {
  const active = getActiveSparknb();
  if (active) {
    return active;
  }
  return vscode.workspace.notebookDocuments.find((nb) => isEmrSparkNotebook(nb));
}

function isBoundToOtherSession(
  connection: NotebookConnection,
  notebook: vscode.NotebookDocument,
  isThisSession: (notebook: vscode.NotebookDocument) => boolean
): boolean {
  if (isThisSession(notebook)) {
    return false;
  }
  return connection.hasSessionBinding(notebook);
}

export async function resolveNotebookForAttach(options: {
  connection: NotebookConnection;
  isThisSession: (notebook: vscode.NotebookDocument) => boolean;
  sessionLabel: string;
  createNotebook: () => Promise<vscode.NotebookDocument>;
}): Promise<vscode.NotebookDocument | undefined> {
  const active = getActiveSparknb();
  if (active) {
    if (isBoundToOtherSession(options.connection, active, options.isThisSession)) {
      const choice = await vscode.window.showWarningMessage(
        `This notebook is connected to a different session. Attach ${options.sessionLabel} anyway?`,
        { modal: true },
        'Attach'
      );
      if (choice !== 'Attach') {
        return undefined;
      }
    }
    return active;
  }

  const existing = vscode.workspace.notebookDocuments.find(
    (nb) => isEmrSparkNotebook(nb) && options.isThisSession(nb)
  );
  if (existing) {
    await vscode.window.showNotebookDocument(existing);
    return existing;
  }

  return options.createNotebook();
}
