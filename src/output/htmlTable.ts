import tableStyles from '../../media/tableRenderer.css';
import { styleForInferredKind } from './columnTypeStyle';
import {
  classifyColumn,
  escapeHtml,
  type QueryResultPayload,
  renderCellHtml,
} from './tableModel';

export function buildHtmlTable(payload: QueryResultPayload): string {
  if (!payload.columns.length) {
    return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-result-card"><div class="duckdb-ok">Completed in ${payload.executionTimeMs} ms</div></div></div>`;
  }

  const colKinds = payload.columns.map((_, i) => classifyColumn(payload.rows, i));
  const colStyles = payload.columns.map((_, i) => styleForInferredKind(colKinds[i]));

  const headerCells = payload.columns
    .map(
      (col, i) =>
        `<th class="duckdb-sortable"><span class="duckdb-th-inner"><span class="duckdb-col-name">${escapeHtml(col)}</span><span class="${colStyles[i].className}">${escapeHtml(colStyles[i].label)}</span></span></th>`
    )
    .join('');

  const bodyRows = payload.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => `<td>${renderCellHtml(cell, colKinds[colIndex])}</td>`)
        .join('');
      return `<tr><td class="duckdb-row-num">${rowIndex + 1}</td>${cells}</tr>`;
    })
    .join('');

  const rowLabel = formatStaticRowLabel(payload);

  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-result-card"><div class="duckdb-table-scroll"><table class="duckdb-table"><thead><tr><th class="duckdb-row-num">#</th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div><div class="duckdb-footer"><span>${rowLabel}</span><span class="duckdb-footer-time">${payload.executionTimeMs} ms</span></div></div></div>`;
}

function formatStaticRowLabel(payload: QueryResultPayload): string {
  if (payload.truncated) {
    return `Showing ${payload.rowCount.toLocaleString()}+ rows`;
  }
  return `${payload.rowCount.toLocaleString()} row(s)`;
}
