import * as vscode from 'vscode';
import { buildCancelledHtml } from './htmlError';
import { extractErrorMessage } from './errorMessage';

export const ERROR_MIME = 'application/vnd.emr-spark.error+json';

export interface ErrorPayload {
  message: string;
  executionTimeMs?: number;
}

export function mapErrorToOutputs(
  error: unknown,
  executionTimeMs?: number
): vscode.NotebookCellOutput[] {
  const message = extractErrorMessage(error);
  const payload: ErrorPayload = { message, executionTimeMs };

  return [
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.json(payload, ERROR_MIME),
      vscode.NotebookCellOutputItem.text(message, 'text/plain'),
    ]),
  ];
}

export function mapCancelledOutput(): vscode.NotebookCellOutput[] {
  return [
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(buildCancelledHtml(), 'text/html'),
      vscode.NotebookCellOutputItem.text('Execution cancelled.', 'text/plain'),
    ]),
  ];
}
