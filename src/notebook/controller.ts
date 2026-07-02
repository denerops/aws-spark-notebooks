import * as vscode from 'vscode';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import { getExtensionConfig, getMaxRows } from '../aws/config';
import {
  cellConfiguresSparkCatalog,
  SPARK_CATALOG_CELL_WARNING,
} from '../aws/icebergConfig';
import { wrapLastExpressionForDisplay, isTabularSql, sqlToDisplayPySpark } from '../livy/codeTransform';
import {
  isPipOnlyCell,
  transformJupyterPipMagics,
} from '../livy/jupyterMagics';
import { CONTROLLER_ID, NOTEBOOK_TYPE } from './types';
import { prepareCellCode } from './ipynbCompat';
import { mapStatementToOutputs } from '../output/resultMapper';
import { mapCancelledOutput, mapErrorToOutputs } from '../output/errorMapper';
import { buildDashboardHtml } from '../output/htmlError';
import { CellExecutionProgress } from './executionProgress';
import type { LivyStatement } from '../livy/types';

export class SparknbController implements vscode.Disposable {
  readonly controllerId = CONTROLLER_ID;
  readonly notebookType = NOTEBOOK_TYPE;
  readonly label = 'EMR Serverless PySpark';
  readonly supportedLanguages = ['python', 'sql'];

  private _executionOrder = 0;
  private readonly catalogWarningShown = new Set<string>();

  constructor(private readonly connectionHub: NotebookConnectionHub) {}

  dispose(): void {
    // Execution is owned by EmrKernelManager controllers.
  }

  async executeCells(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController
  ): Promise<void> {
    for (const cell of cells) {
      const succeeded = await this.executeCell(cell, notebook, controller);
      if (!succeeded) {
        break;
      }
    }
  }

  async failCells(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController,
    message: string
  ): Promise<void> {
    for (const cell of cells) {
      if (cell.kind !== vscode.NotebookCellKind.Code) {
        continue;
      }
      const execution = controller.createNotebookCellExecution(cell);
      execution.start(Date.now());
      execution.replaceOutput(mapErrorToOutputs(new Error(message), 0));
      execution.end(false, Date.now());
    }
  }

  private async executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController
  ): Promise<boolean> {
    if (cell.kind !== vscode.NotebookCellKind.Code) {
      return true;
    }

    const lang = cell.document.languageId;
    const prepared = prepareCellCode(cell.document.getText(), lang);
    if (prepared.language !== 'python' && prepared.language !== 'sql') {
      return true;
    }

    const code = prepared.code;
    const rawCode = cell.document.getText();
    const execution = controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;

    if (!code) {
      execution.start(Date.now());
      execution.replaceOutput([]);
      execution.end(true, Date.now());
      return true;
    }

    const startedAt = Date.now();
    execution.start(startedAt);

    const abortController = new AbortController();
    const cancellationListener = execution.token.onCancellationRequested(() => {
      abortController.abort();
    });

    const maxRows = getMaxRows();
    const progress = new CellExecutionProgress(execution, startedAt);
    progress.updatePhase('Starting');

    try {
      progress.updatePhase('Connecting to Spark session');
      const session = await this.connectionHub.ensureConnected(notebook);
      if (!session.dashboardUrl) {
        await this.connectionHub.refreshDashboard(session).catch(() => undefined);
      }
      progress.setSparkUiUrl(session.dashboardUrl);
      progress.updatePhase('Submitting statement');

      const onStatement = (statement: LivyStatement) => {
        progress.updateStatement(statement);
      };

      let stmt;

      if (prepared.language === 'python') {
        const pipMagicCode = transformJupyterPipMagics(code);
        const transformed = isPipOnlyCell(code)
          ? pipMagicCode
          : wrapLastExpressionForDisplay(pipMagicCode);
        stmt = await session.executeStatement(transformed, 'pyspark', {
          signal: abortController.signal,
          onStatement,
        });
      } else if (isTabularSql(code)) {
        const pyCode = sqlToDisplayPySpark(code, maxRows);
        stmt = await session.executeStatement(pyCode, 'pyspark', {
          signal: abortController.signal,
          onStatement,
        });
      } else {
        stmt = await session.executeStatement(code, 'sql', {
          signal: abortController.signal,
          onStatement,
        });
      }

      const executionTimeMs = Date.now() - startedAt;
      const outputs = mapStatementToOutputs(stmt, executionTimeMs, maxRows);

      if (
        prepared.language === 'python' &&
        cellConfiguresSparkCatalog(rawCode) &&
        !this.catalogWarningShown.has(notebook.uri.toString())
      ) {
        this.catalogWarningShown.add(notebook.uri.toString());
        outputs.unshift(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stdout(`${SPARK_CATALOG_CELL_WARNING}\n`),
          ])
        );
      }

      if (session.dashboardUrl && !session.dashboardAnnounced) {
        const hintMinutes = getExtensionConfig().get<number>('dashboardRefreshHintMinutes', 55);
        const dashboardHtml = buildDashboardHtml(session.dashboardUrl, hintMinutes);
        outputs.unshift(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(dashboardHtml, 'text/html'),
          ])
        );
        session.markDashboardAnnounced();
      }

      execution.replaceOutput(outputs);
      execution.end(true, Date.now());
      return true;
    } catch (error) {
      if (abortController.signal.aborted) {
        execution.replaceOutput(mapCancelledOutput());
        execution.end(false, Date.now());
      } else {
        const executionTimeMs = Date.now() - startedAt;
        execution.replaceOutput(mapErrorToOutputs(error, executionTimeMs));
        execution.end(false, Date.now());
      }
      return false;
    } finally {
      cancellationListener.dispose();
    }
  }
}
