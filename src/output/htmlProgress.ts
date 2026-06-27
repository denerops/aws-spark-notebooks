import * as vscode from 'vscode';
import tableStyles from '../../media/tableRenderer.css';
import { escapeHtml } from './tableModel';

export function buildProgressHtml(message: string, sparkUiUrl?: string): string {
  const sparkUi =
    sparkUiUrl !== undefined
      ? `<a class="emr-exec-spark-link" href="${escapeHtml(sparkUiUrl)}" target="_blank" rel="noopener">Spark UI</a>`
      : '';

  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="emr-exec-progress-card"><div class="emr-exec-progress-row"><span class="emr-exec-spinner" aria-hidden="true"></span><span class="emr-exec-message">${escapeHtml(message)}</span></div>${sparkUi ? `<div class="emr-exec-links">${sparkUi}</div>` : ''}</div></div>`;
}

export function buildProgressOutput(
  message: string,
  sparkUiUrl?: string
): vscode.NotebookCellOutput {
  return new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.text(buildProgressHtml(message, sparkUiUrl), 'text/html'),
    vscode.NotebookCellOutputItem.text(`${message}\n`, 'text/plain'),
  ]);
}
