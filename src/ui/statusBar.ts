import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import { getConfiguredAwsProfile } from '../aws/config';
import { getProfileDisplayLabel } from '../aws/profile';
import { isEmrSparkNotebook } from '../notebook/types';
import { formatLivySessionLabel } from '../livy/types';

export class ConnectionStatusBar {
  private readonly profileItem: vscode.StatusBarItem;
  private readonly connectionItem: vscode.StatusBarItem;
  private readonly sparkUiItem: vscode.StatusBarItem;
  private readonly helpItem: vscode.StatusBarItem;
  private region = '';
  private profileLabel = '';

  constructor(private readonly connectionManager: ConnectionManager) {
    this.profileItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      101
    );
    this.profileItem.command = 'emrServerless.selectAwsProfile';
    this.profileItem.tooltip = 'AWS profile — click to change';

    this.connectionItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.connectionItem.command = 'emrServerless.connect';
    this.connectionItem.tooltip = 'EMR Serverless session — click to connect';

    this.sparkUiItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
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

    void this.refreshAwsContext();
  }

  async refreshAwsContext(): Promise<void> {
    try {
      this.region = await getEmrServerlessService().getRegion();
    } catch {
      this.region = '';
    }
    this.profileLabel = await getProfileDisplayLabel();
    this.updateProfileItem();
    this.update();
  }

  private updateProfileItem(): void {
    const configured = getConfiguredAwsProfile();
    const suffix = configured ? configured : this.profileLabel;
    this.profileItem.text = `$(key) ${suffix}`;
    this.profileItem.tooltip = configured
      ? `AWS profile: ${configured}${this.region ? ` (${this.region})` : ''} — click to change`
      : `AWS credentials: ${this.profileLabel}${this.region ? ` (${this.region})` : ''} — click to change`;
  }

  show(): void {
    this.profileItem.show();
    this.connectionItem.show();
    this.helpItem.show();
    this.update();
  }

  dispose(): void {
    this.profileItem.dispose();
    this.connectionItem.dispose();
    this.sparkUiItem.dispose();
    this.helpItem.dispose();
  }

  update(notebook?: vscode.NotebookDocument): void {
    this.updateProfileItem();

    const activeNotebook = notebook ?? this.getActiveSparknb();
    const session =
      (activeNotebook ? this.connectionManager.getSession(activeNotebook) : undefined) ??
      this.connectionManager.getActiveSession();

    if (session) {
      const appId = session.applicationId;
      const shortApp = appId.length > 12 ? `${appId.slice(0, 8)}…` : appId;
      const sessionLabel = formatLivySessionLabel({
        id: session.sessionId,
        name: session.name,
      });
      this.connectionItem.text = `$(cloud) ${this.region || '?'} | ${shortApp} | ${sessionLabel} | ${session.state}`;
      this.connectionItem.tooltip = `EMR Serverless: ${appId}, ${sessionLabel} (${session.state})`;
      this.sparkUiItem.show();
      return;
    }

    this.sparkUiItem.hide();
    this.connectionItem.text = this.region
      ? `$(debug-disconnect) EMR ${this.region} — disconnected`
      : '$(debug-disconnect) EMR Serverless — disconnected';
    this.connectionItem.tooltip = 'Not connected — click to connect';
  }

  private getActiveSparknb(): vscode.NotebookDocument | undefined {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || !isEmrSparkNotebook(editor.notebook)) {
      return undefined;
    }
    return editor.notebook;
  }
}
