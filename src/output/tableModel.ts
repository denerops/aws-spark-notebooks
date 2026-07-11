export interface QueryResultPayload {
  columns: string[];
  columnTypes?: string[];
  rows: unknown[][];
  /** Rows shown or exact total when countExact is true. */
  rowCount: number;
  executionTimeMs: number;
  /** True when more rows exist beyond displayLimit. */
  truncated: boolean;
  /** False when rowCount is a lower bound (truncated display, no full scan). */
  countExact?: boolean;
  /** Max rows collected for display. */
  displayLimit?: number;
  /** Python expression evaluating to the DataFrame, used for optional exact count. */
  countCode?: string;
}

export function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type CellKind = 'null' | 'boolean' | 'number' | 'string' | 'json';

export function classifyCell(value: unknown): CellKind {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' || typeof value === 'bigint') return 'number';
  if (typeof value === 'object') return 'json';
  return 'string';
}

export function classifyColumn(rows: unknown[][], colIndex: number): CellKind {
  const kinds = new Set<CellKind>();
  for (const row of rows) {
    kinds.add(classifyCell(row[colIndex]));
    if (kinds.size > 2) break;
  }
  if (kinds.has('json')) return 'json';
  if (kinds.has('string') && kinds.has('number')) return 'string';
  if (kinds.size === 1) return [...kinds][0];
  if (kinds.has('number')) return 'number';
  if (kinds.has('boolean')) return 'boolean';
  return 'string';
}

export function renderCellHtml(value: unknown, kind: CellKind): string {
  if (value === null || value === undefined) {
    return '<span class="duckdb-null">null</span>';
  }
  if (typeof value === 'boolean') {
    const cls = value ? 'duckdb-badge-true' : 'duckdb-badge-false';
    return `<span class="duckdb-badge ${cls}">${value}</span>`;
  }
  if (typeof value === 'object') {
    const text = stringifyCell(value);
    const display = text.length > 80 ? `${text.slice(0, 77)}…` : text;
    return `<span class="duckdb-json" title="${escapeHtml(text)}">${escapeHtml(display)}</span>`;
  }
  const cls = kind === 'number' ? 'duckdb-cell-num' : '';
  return `<span class="duckdb-cell ${cls}">${escapeHtml(stringifyCell(value))}</span>`;
}
