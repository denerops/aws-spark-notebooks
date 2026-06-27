import * as vscode from 'vscode';
import type { LivyStatement } from '../livy/types';
import { formatElapsed, formatStatementProgress } from '../livy/statementStatus';
import { buildProgressOutput } from '../output/htmlProgress';

const MIN_UPDATE_MS = 300;

export class CellExecutionProgress {
  private lastKey = '';
  private lastUpdateAt = 0;
  private sparkUiUrl: string | undefined;

  constructor(
    private readonly execution: vscode.NotebookCellExecution,
    private readonly startedAt: number,
    sparkUiUrl?: string
  ) {
    this.sparkUiUrl = sparkUiUrl;
  }

  setSparkUiUrl(url: string | undefined): void {
    this.sparkUiUrl = url;
  }

  updatePhase(phase: string): void {
    const elapsed = Date.now() - this.startedAt;
    this.publish(`${phase} · ${formatElapsed(elapsed)}`, `phase:${phase}`);
  }

  updateStatement(stmt: LivyStatement): void {
    const elapsed = Date.now() - this.startedAt;
    const message = formatStatementProgress(stmt, elapsed);
    this.publish(message, `stmt:${stmt.state}:${stmt.progress ?? ''}:${stmt.id}`);
  }

  private publish(message: string, key: string): void {
    const now = Date.now();
    if (key === this.lastKey && now - this.lastUpdateAt < MIN_UPDATE_MS) {
      return;
    }
    this.lastKey = key;
    this.lastUpdateAt = now;
    void this.execution.replaceOutput([buildProgressOutput(message, this.sparkUiUrl)]);
  }
}
