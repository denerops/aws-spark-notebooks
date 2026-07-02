import * as vscode from 'vscode';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import { isEmrSparkNotebook } from '../notebook/types';

export class ConnectionStatusBar {
  private readonly sparkUiItem: vscode.StatusBarItem;
  private readonly helpItem: vscode.StatusBarItem;

  constructor(private readonly connectionHub: NotebookConnectionHub) {
    this.sparkUiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.sparkUiItem.command = 'emrServerless.openSparkUi';
    this.sparkUiItem.text = '$(globe) Spark UI';
    this.sparkUiItem.tooltip = 'Open Spark UI in browser';

    this.helpItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.helpItem.command = 'emrServerless.openWelcome';
    this.helpItem.text = '$(question) Spark Help';
    this.helpItem.tooltip = 'Open AWS Spark notebook documentation';
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
    const emrSession = activeNotebook
      ? this.connectionHub.getEmrManager().getSession(activeNotebook)
      : undefined;
    const glueSession = activeNotebook
      ? this.connectionHub.getGlueManager().getSession(activeNotebook)
      : undefined;
    const session =
      emrSession ??
      glueSession ??
      this.connectionHub.getEmrManager().getActiveSession() ??
      this.connectionHub.getGlueManager().listBindings()[0]?.session;

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
