import * as vscode from 'vscode';
import {
  SessionStartupFailureError,
  type SessionStartupFailure,
} from '../session/diagnoseStartupFailure';

const OUTPUT_CHANNEL = 'Spark session startup';
const VIEW_LOGS_ACTION = 'View logs';

let channel: vscode.OutputChannel | undefined;

export function showSessionStartupLogs(failure: SessionStartupFailure): void {
  if (!channel) {
    channel = vscode.window.createOutputChannel(OUTPUT_CHANNEL);
  }
  channel.clear();
  channel.appendLine(failure.summary);
  if (failure.detail && failure.detail !== failure.summary) {
    channel.appendLine('');
    channel.appendLine(failure.detail);
  }
  if (failure.logLines.length > 0) {
    channel.appendLine('');
    channel.appendLine('--- session log ---');
    for (const line of failure.logLines) {
      channel.appendLine(line);
    }
  }
  channel.show(true);
}

export async function reportSessionStartupFailure(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('already being created')) {
    void vscode.window.showInformationMessage(message);
    return;
  }

  const failure = error instanceof SessionStartupFailureError ? error.failure : undefined;
  const actions = failure && failure.logLines.length > 0 ? [VIEW_LOGS_ACTION] : [];
  const choice = await vscode.window.showErrorMessage(message, ...actions);
  if (choice === VIEW_LOGS_ACTION && failure) {
    showSessionStartupLogs(failure);
  }
}
