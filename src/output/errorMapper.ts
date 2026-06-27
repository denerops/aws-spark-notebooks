import * as vscode from 'vscode';
import { buildCancelledHtml, buildErrorHtml } from './htmlError';
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
  const html = buildErrorHtml(message, executionTimeMs);

  return [
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(html, 'text/html'),
      vscode.NotebookCellOutputItem.text(message, 'text/plain'),
      vscode.NotebookCellOutputItem.json(payload, ERROR_MIME),
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
