import * as vscode from 'vscode';
import { isEmrSparkNotebook } from '../notebook/types';
import type { NotebookWorkspace } from './notebookWorkspace';

export const vscodeNotebookWorkspace: NotebookWorkspace = {
  async applyMetadata(notebook, metadata) {
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri as vscode.Uri, [
      vscode.NotebookEdit.updateNotebookMetadata(metadata),
    ]);
    await vscode.workspace.applyEdit(edit);
  },

  listSparkNotebooks() {
    return vscode.workspace.notebookDocuments.filter((n) => isEmrSparkNotebook(n));
  },

  getActiveSparkNotebook() {
    const active = vscode.window.activeNotebookEditor?.notebook;
    if (active && isEmrSparkNotebook(active)) {
      return active;
    }
    return undefined;
  },
};
