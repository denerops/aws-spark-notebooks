import tableStyles from '../../media/tableRenderer.css';
import { escapeHtml } from './tableModel';

export function buildErrorHtml(message: string, executionTimeMs?: number): string {
  const timing =
    executionTimeMs !== undefined
      ? `<div class="duckdb-error-footer">${executionTimeMs} ms</div>`
      : '';

  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-error-card"><div class="duckdb-error-header"><span class="duckdb-error-icon" aria-hidden="true">!</span><span class="duckdb-error-title">Execution failed</span></div><div class="duckdb-error-message">${escapeHtml(message)}</div>${timing}</div></div>`;
}

export function buildCancelledHtml(): string {
  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-error-card duckdb-cancelled-card"><div class="duckdb-error-message">Execution cancelled.</div></div></div>`;
}

export function buildDashboardHtml(url: string, hintMinutes: number): string {
  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-dashboard-card"><strong>Spark UI</strong> · <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open Spark UI</a><br/><span class="duckdb-footer-warn">Driver logs: Spark UI → Executors → driver → Logs. Link expires in ~${hintMinutes} min — use Refresh Spark UI Link command.</span></div></div>`;
}
