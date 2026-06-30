import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import { isEmrSparkNotebook } from '../notebook/types';

export class ConnectionStatusBar {
  private readonly sparkUiItem: vscode.StatusBarItem;
  private readonly helpItem: vscode.StatusBarItem;

  constructor(private readonly connectionManager: ConnectionManager) {
    this.sparkUiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.sparkUiItem.command = 'emrServerless.openSparkUi';
    this.sparkUiItem.text = '$(globe) Spark UI';
    this.sparkUiItem.tooltip = 'Open Spark UI in browser';

    this.helpItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.helpItem.command = 'emrServerless.openWelcome';
    this.helpItem.text = '$(question) EMR Help';
    this.helpItem.tooltip = 'Open EMR Serverless PySpark documentation';
  }

  show(): void {
    this.helpItem.show();
    this.update();
  }

  dispose(): void {
    this.sparkUiItem.dispose();
    this.helpItem.dispose();
  }

  update(notebook?: vscode.NotebookDocument): void {
    const activeNotebook = notebook ?? this.getActiveSparknb();
    const session =
      (activeNotebook ? this.connectionManager.getSession(activeNotebook) : undefined) ??
      this.connectionManager.getActiveSession();

    if (session) {
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
