import * as vscode from 'vscode';
import type { NotebookConnection } from '../platform/notebookConnection';
import { isEmrSparkNotebook } from '../notebook/types';

export class ConnectionStatusBar {
  private readonly sparkUiItem: vscode.StatusBarItem;
  private readonly connectionSub: { dispose(): void };

  constructor(private readonly connection: NotebookConnection) {
    this.sparkUiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.sparkUiItem.command = 'emrServerless.openSparkUi';
    this.sparkUiItem.text = '$(globe) Spark UI';
    this.sparkUiItem.tooltip = 'Open Spark UI in browser';
    this.connectionSub = connection.onDidChangeConnection((notebook) => {
      this.update(notebook as vscode.NotebookDocument);
    });
  }

  show(): void {
    this.update();
  }

  dispose(): void {
    this.connectionSub.dispose();
    this.sparkUiItem.dispose();
  }

  update(notebook?: vscode.NotebookDocument): void {
    const activeNotebook = notebook ?? this.getActiveSparknb();
    const live = Boolean(
      activeNotebook &&
        isEmrSparkNotebook(activeNotebook) &&
        this.connection.isConnected(activeNotebook)
    );

    if (live) {
      this.sparkUiItem.show();
      return;
    }

    this.sparkUiItem.hide();
  }

  private getActiveSparknb(): vscode.NotebookDocument | undefined {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || !isEmrSparkNotebook(editor.notebook)) {
      return undefined;
    }
    return editor.notebook;
  }
}
