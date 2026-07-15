import * as vscode from 'vscode';
import { buildHtmlTable } from './htmlTable';
import { extractLivyPlainText } from './livyText';
import type { QueryResultPayload } from './tableModel';
import { TABLE_JSON_MARKER } from '../livy/types';
import type { LivyStatement } from '../livy/types';

export const TABLE_MIME = 'application/vnd.emr-spark.table+json';

export type { QueryResultPayload };

export function mapTablePayloadToOutputs(
  payload: QueryResultPayload
): vscode.NotebookCellOutput[] {
  const html = buildHtmlTable(payload);
  return [
    new vscode.NotebookCellOutput([
      vscode.NotebookCellOutputItem.text(html, 'text/html'),
      vscode.NotebookCellOutputItem.json(payload, TABLE_MIME),
    ]),
  ];
}

export function parseTableFromStatementOutput(
  stmt: LivyStatement,
  executionTimeMs: number,
  maxRows: number
): { table?: QueryResultPayload; plainText: string } {
  const data = (stmt.output?.data ?? {}) as Record<string, unknown>;
  const rawText = extractLivyPlainText(data);
  let plainText = rawText;

  if (stmt.output?.traceback?.length || stmt.output?.ename || stmt.output?.evalue) {
    const trace =
      stmt.output.traceback?.join('\n') ??
      [stmt.output.ename, stmt.output.evalue].filter(Boolean).join(': ') ??
      'Statement failed';
    throw new Error(trace);
  }

  const markerIndex = rawText.indexOf(TABLE_JSON_MARKER);
  if (markerIndex >= 0) {
    const before = rawText.slice(0, markerIndex).trim();
    const jsonPart = rawText.slice(markerIndex + TABLE_JSON_MARKER.length);
    plainText = before;

    try {
      const meta = JSON.parse(jsonPart) as {
        columns: string[];
        rows: unknown[][];
        rowCount: number;
        truncated?: boolean;
        countExact?: boolean;
        displayLimit?: number;
        countCode?: string;
      };
      const truncated = meta.truncated ?? meta.rows.length > maxRows;
      const countExact = meta.countExact ?? !truncated;
      const rows = meta.rows.slice(0, maxRows);
      return {
        table: {
          columns: meta.columns,
          rows,
          rowCount: meta.rowCount,
          executionTimeMs,
          truncated,
          countExact,
          displayLimit: meta.displayLimit,
          countCode: meta.countCode,
        },
        plainText,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid JSON';
      throw new Error(`Failed to parse table output (${detail}). Output may have been truncated.`);
    }
  }

  if (stmt.output?.status === 'error') {
    const trace = stmt.output.traceback?.join('\n') ?? stmt.output.evalue ?? 'Statement failed';
    throw new Error(trace);
  }

  const jsonTable = tryParseJsonAsTable(rawText, executionTimeMs, maxRows);
  if (jsonTable) {
    return { table: jsonTable, plainText: '' };
  }

  return { plainText: plainText.trim() };
}

function tryParseJsonAsTable(
  rawText: string,
  executionTimeMs: number,
  maxRows: number
): QueryResultPayload | undefined {
  const trimmed = rawText.trim();
  if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      const columns = Object.keys(parsed[0] as Record<string, unknown>);
      const rows = (parsed as Record<string, unknown>[]).map((row) =>
        columns.map((col) => row[col])
      );
      const truncated = rows.length > maxRows;
      return {
        columns,
        rows: truncated ? rows.slice(0, maxRows) : rows,
        rowCount: rows.length,
        executionTimeMs,
        truncated,
      };
    }

    if (parsed && typeof parsed === 'object' && 'data' in parsed && 'schema' in parsed) {
      const payload = parsed as {
        schema?: { fields?: Array<{ name: string }> };
        data?: unknown[][];
      };
      const columns = payload.schema?.fields?.map((f) => f.name) ?? [];
      const rows = payload.data ?? [];
      if (columns.length > 0 && rows.length > 0) {
        const truncated = rows.length > maxRows;
        return {
          columns,
          rows: truncated ? rows.slice(0, maxRows) : rows,
          rowCount: rows.length,
          executionTimeMs,
          truncated,
        };
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function mapStatementToOutputs(
  stmt: LivyStatement,
  executionTimeMs: number,
  maxRows: number
): vscode.NotebookCellOutput[] {
  const { table, plainText } = parseTableFromStatementOutput(stmt, executionTimeMs, maxRows);
  const outputs: vscode.NotebookCellOutput[] = [];

  if (plainText) {
    outputs.push(
      new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(plainText, 'text/plain'),
      ])
    );
  }

  if (table) {
    outputs.push(...mapTablePayloadToOutputs(table));
  }

  if (outputs.length === 0) {
    outputs.push(
      new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.text(`Completed in ${executionTimeMs} ms`, 'text/plain'),
      ])
    );
  }

  return outputs;
}
