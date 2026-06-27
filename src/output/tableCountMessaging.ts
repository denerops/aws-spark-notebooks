import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import { TABLE_COUNT_MARKER } from '../livy/types';
import { isEmrSparkNotebook } from '../notebook/types';
import { extractLivyPlainText } from '../output/livyText';

const RENDERER_ID = 'emr-spark-table-renderer';

export interface TableCountRequestMessage {
  type: 'countRows';
  countCode: string;
  outputItemId: string;
}

export interface TableCountResultMessage {
  type: 'countResult';
  outputItemId: string;
  rowCount?: number;
  error?: string;
}

export function registerTableRendererMessaging(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager
): void {
  const messaging = vscode.notebooks.createRendererMessaging(RENDERER_ID);

  context.subscriptions.push(
    messaging.onDidReceiveMessage(async ({ editor, message }) => {
      const request = message as TableCountRequestMessage;
      if (request?.type !== 'countRows' || !request.countCode?.trim()) {
        return;
      }

      const notebook = editor.notebook;
      if (!isEmrSparkNotebook(notebook)) {
        return;
      }

      const reply = (result: Omit<TableCountResultMessage, 'type' | 'outputItemId'>) => {
        void messaging.postMessage(
          {
            type: 'countResult',
            outputItemId: request.outputItemId,
            ...result,
          } satisfies TableCountResultMessage,
          editor
        );
      };

      try {
        const session = await connectionManager.ensureConnected(notebook);
        const code = buildCountStatement(request.countCode);
        const stmt = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Counting rows…',
            cancellable: false,
          },
          () => session.executeStatement(code, 'pyspark')
        );

        const data = (stmt.output?.data ?? {}) as Record<string, unknown>;
        const rawText = extractLivyPlainText(data);
        const markerIndex = rawText.indexOf(TABLE_COUNT_MARKER);
        if (markerIndex < 0) {
          throw new Error('Count statement did not return a result.');
        }

        const countText = rawText.slice(markerIndex + TABLE_COUNT_MARKER.length).trim();
        const rowCount = Number.parseInt(countText, 10);
        if (!Number.isFinite(rowCount) || rowCount < 0) {
          throw new Error(`Unexpected count result: ${countText}`);
        }

        reply({ rowCount });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        reply({ error: errorMessage });
        void vscode.window.showErrorMessage(`Row count failed: ${errorMessage}`);
      }
    })
  );
}

function buildCountStatement(countCode: string): string {
  const escaped = countCode.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `print("${TABLE_COUNT_MARKER}" + str(int((${escaped}).count())))`;
}
