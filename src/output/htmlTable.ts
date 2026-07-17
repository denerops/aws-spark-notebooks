import tableStyles from '../../media/tableRenderer.css';
import {
  buildQueryResultView,
  escapeHtml,
  type QueryResultPayload,
  renderCellHtml,
} from './tableModel';

export function buildHtmlTable(payload: QueryResultPayload): string {
  const view = buildQueryResultView(payload);

  if (!view.hasTable) {
    return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-result-card"><div class="duckdb-ok">Completed in ${view.executionTimeMs} ms</div></div></div>`;
  }

  const headerCells = view.columns
    .map(
      (col) =>
        `<th class="duckdb-sortable"><span class="duckdb-th-inner"><span class="duckdb-col-name">${escapeHtml(col.name)}</span><span class="${col.typeBadge.className}">${escapeHtml(col.typeBadge.label)}</span></span></th>`
    )
    .join('');

  const bodyRows = payload.rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, colIndex) => `<td>${renderCellHtml(cell, view.columns[colIndex].kind)}</td>`)
        .join('');
      return `<tr><td class="duckdb-row-num">${rowIndex + 1}</td>${cells}</tr>`;
    })
    .join('');

  return `<div class="duckdb-table-output"><style>${tableStyles}</style><div class="duckdb-result-card"><div class="duckdb-table-scroll"><table class="duckdb-table"><thead><tr><th class="duckdb-row-num">#</th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div><div class="duckdb-footer"><span>${view.footerRowLabel}</span><span class="duckdb-footer-time">${view.executionTimeMs} ms</span></div></div></div>`;
}
