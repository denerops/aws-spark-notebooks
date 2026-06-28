const EXPRESSION_LINE =
  /^(?!\s*(?:def|class|import|from|for|while|if|elif|else|try|except|finally|with|return|raise|pass|break|continue|#|\s*$))/;

function indentOf(line: string): number {
  return line.match(/^(\s*)/)?.[1].length ?? 0;
}

type PythonScanState = {
  stringQuote: "'" | '"' | null;
  tripleQuote: "'''" | '"""' | null;
};

function advancePythonScan(line: string, i: number, state: PythonScanState): number {
  if (state.tripleQuote) {
    if (line.startsWith(state.tripleQuote, i)) {
      state.tripleQuote = null;
      return i + 3;
    }
    return i + 1;
  }

  if (state.stringQuote) {
    const ch = line[i];
    if (ch === '\\') {
      return i + 2;
    }
    if (ch === state.stringQuote) {
      state.stringQuote = null;
    }
    return i + 1;
  }

  if (line.startsWith("'''", i) || line.startsWith('"""', i)) {
    state.tripleQuote = line.startsWith("'''", i) ? "'''" : '"""';
    return i + 3;
  }

  const ch = line[i];
  if (ch === "'" || ch === '"') {
    state.stringQuote = ch;
    return i + 1;
  }

  return i + 1;
}

function isOutsidePythonStrings(line: string, index: number): boolean {
  const state: PythonScanState = { stringQuote: null, tripleQuote: null };
  for (let i = 0; i < index; ) {
    i = advancePythonScan(line, i, state);
  }
  return !state.stringQuote && !state.tripleQuote;
}

function lineHasBackslashContinuation(line: string): boolean {
  const { expr } = splitTrailingComment(line);
  let end = expr.length;
  while (end > 0 && /\s/.test(expr[end - 1])) {
    end--;
  }
  if (end === 0 || expr[end - 1] !== '\\') {
    return false;
  }
  return isOutsidePythonStrings(expr, end - 1);
}

function stripLineContinuationBackslash(expr: string): string {
  let end = expr.length;
  while (end > 0 && /\s/.test(expr[end - 1])) {
    end--;
  }
  if (end === 0 || expr[end - 1] !== '\\') {
    return expr.trimEnd();
  }
  if (!isOutsidePythonStrings(expr, end - 1)) {
    return expr.trimEnd();
  }
  return expr.slice(0, end - 1).trimEnd();
}

function lineExprForFlatten(line: string): string {
  const { expr } = splitTrailingComment(line.trim());
  return stripLineContinuationBackslash(expr);
}

function isContinuationLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('.') ||
    trimmed.startsWith(',') ||
    trimmed === ')' ||
    trimmed === ']' ||
    trimmed === '}'
  );
}

function lineHasAssignment(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
    return false;
  }
  return /(?:^|[^=!<>])=(?!=)/.test(trimmed);
}

function statementLineIndices(lines: string[], lastIndex: number): number[] {
  const indices: number[] = [];
  const lastIndent = indentOf(lines[lastIndex]);
  for (let i = lastIndex; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const ind = indentOf(lines[i]);
    if (i < lastIndex && ind < lastIndent) {
      const nextLine = lines[i + 1]?.trim() ?? '';
      if (!lineHasBackslashContinuation(lines[i]) && !isContinuationLine(nextLine)) {
        break;
      }
    }
    indices.unshift(i);
  }
  return indices;
}

function shouldSkipAutoDisplay(lines: string[], lastIndex: number): boolean {
  const lastLine = lines[lastIndex].trim();
  if (isContinuationLine(lastLine)) {
    return true;
  }

  const statementLines = statementLineIndices(lines, lastIndex);
  if (statementLines.some((i) => lineHasAssignment(lines[i]))) {
    return true;
  }

  if (statementLines.length > 1) {
    const prevIndex = statementLines[statementLines.length - 2];
    const prev = lines[prevIndex].trimEnd();
    if (/[(\[,{\\]\s*$/.test(prev)) {
      return true;
    }
  }

  return false;
}

function isContinuationShow(line: string): boolean {
  return /^\.show\s*\(/.test(line.trim());
}

function stripTrailingShow(line: string): string | undefined {
  const { expr } = splitTrailingComment(line.trim());
  const match = expr.match(/^(.+)\.show\s*\([^)]*\)\s*$/);
  return match?.[1].trim();
}

function parseShowLimit(line: string): number | undefined {
  const { expr } = splitTrailingComment(line.trim());
  const match = expr.match(/\.show\s*\(\s*(\d+)/);
  return match ? Number(match[1]) : undefined;
}

function flattenStatementExpr(lines: string[], indices: number[]): string {
  return indices
    .map((i) => lineExprForFlatten(lines[i]))
    .join(' ')
    .replace(/\s+/g, ' ');
}

function replaceStatementWithEmrShow(
  lines: string[],
  statementLines: number[],
  dataExpr: string,
  limit?: number
): string {
  const lastStmtLine = lines[statementLines[statementLines.length - 1]];
  const { commentSuffix } = splitTrailingComment(lastStmtLine.trimEnd());
  const indent = lines[statementLines[0]].match(/^(\s*)/)?.[1] ?? '';
  const next = [...lines];
  next.splice(
    statementLines[0],
    statementLines.length,
    `${indent}${emrShowCall(dataExpr, dataExpr, limit)}${commentSuffix}`
  );
  return next.join('\n');
}

function shouldSkipAutoDisplayLine(lastLine: string): boolean {
  return (
    lastLine.startsWith('emr_display(') ||
    lastLine.startsWith('emr_show(') ||
    lastLine.startsWith('__emr_run_pip(') ||
    lastLine.startsWith('print(')
  );
}

function tryWrapStatementExpression(lines: string[], lastIndex: number): string | undefined {
  const statementLines = statementLineIndices(lines, lastIndex);
  if (statementLines.length < 2) {
    return undefined;
  }
  if (statementLines.some((i) => lineHasAssignment(lines[i]))) {
    return undefined;
  }

  const lastLine = splitTrailingComment(lines[lastIndex].trim()).expr;
  if (!EXPRESSION_LINE.test(lastLine) || lastLine.includes('=')) {
    return undefined;
  }
  if (shouldSkipAutoDisplayLine(lastLine.trim())) {
    return undefined;
  }

  const fullExpr = flattenStatementExpr(lines, statementLines);
  if (fullExpr.includes('=')) {
    return undefined;
  }

  return replaceStatementWithEmrShow(lines, statementLines, fullExpr);
}

/** Encode arbitrary text as a valid Python string literal for embedding in generated code. */
function pythonStringLiteral(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\');
  if (/[\r\n]/.test(value)) {
    if (!value.includes("'''")) {
      return `'''${escaped}'''`;
    }
    if (!value.includes('"""')) {
      return `"""${escaped}"""`;
    }
    return `"${escaped.replace(/"/g, '\\"')}"`;
  }
  if (!value.includes("'")) {
    return `'${escaped}'`;
  }
  if (!value.includes('"')) {
    return `"${escaped}"`;
  }
  if (!value.includes("'''")) {
    return `'''${escaped}'''`;
  }
  if (!value.includes('"""')) {
    return `"""${escaped}"""`;
  }
  return `"${escaped.replace(/"/g, '\\"')}"`;
}

/** Split a Python line into code and a trailing `#` comment (respecting string literals). */
export function splitTrailingComment(line: string): { expr: string; commentSuffix: string } {
  let i = 0;
  let stringQuote: "'" | '"' | null = null;
  let tripleQuote: "'''" | '"""' | null = null;

  while (i < line.length) {
    if (tripleQuote) {
      if (line.startsWith(tripleQuote, i)) {
        tripleQuote = null;
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    if (stringQuote) {
      const ch = line[i];
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        stringQuote = null;
      }
      i += 1;
      continue;
    }

    if (line.startsWith("'''", i) || line.startsWith('"""', i)) {
      tripleQuote = line.startsWith("'''", i) ? "'''" : '"""';
      i += 3;
      continue;
    }

    const ch = line[i];
    if (ch === "'" || ch === '"') {
      stringQuote = ch;
      i += 1;
      continue;
    }

    if (ch === '#') {
      return {
        expr: line.slice(0, i).trimEnd(),
        commentSuffix: line.slice(i),
      };
    }

    i += 1;
  }

  return { expr: line.trimEnd(), commentSuffix: '' };
}

function emrShowCall(dataExpr: string, countExpr: string, limit?: number): string {
  const limitArg = limit !== undefined ? `, limit=${limit}` : '';
  return `emr_show(${dataExpr}${limitArg}, _count_expr=${pythonStringLiteral(countExpr)})`;
}

function wrapLineWithEmrShow(line: string, limit?: number): string {
  const indent = line.match(/^(\s*)/)?.[1] ?? '';
  const { expr, commentSuffix } = splitTrailingComment(line.trimEnd());
  return `${indent}${emrShowCall(expr, expr, limit)}${commentSuffix}`;
}

function rewriteShowCall(lines: string[], lastIndex: number): string | undefined {
  const lastLine = lines[lastIndex];
  const limit = parseShowLimit(lastLine);
  const continuationShow = isContinuationShow(lastLine);
  const inlineShow = stripTrailingShow(lastLine.trim());

  if (!continuationShow && !inlineShow) {
    return undefined;
  }

  const statementLines = statementLineIndices(lines, lastIndex);
  if (continuationShow && statementLines.length < 2) {
    return undefined;
  }

  let fullExpr: string;
  if (continuationShow) {
    fullExpr = flattenStatementExpr(lines, statementLines.slice(0, -1));
  } else {
    fullExpr = stripTrailingShow(flattenStatementExpr(lines, statementLines)) ?? inlineShow!;
  }

  return replaceStatementWithEmrShow(lines, statementLines, fullExpr, limit);
}

export function wrapLastExpressionForDisplay(code: string): string {
  const lines = code.split('\n');
  let lastIndex = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    lastIndex = i;
    break;
  }

  if (lastIndex < 0) {
    return code;
  }

  const showRewrite = rewriteShowCall([...lines], lastIndex);
  if (showRewrite) {
    return showRewrite;
  }

  const lastLine = lines[lastIndex].trim();
  if (!EXPRESSION_LINE.test(lastLine) || lastLine.includes('=')) {
    return code;
  }

  if (lastLine.startsWith('emr_display(') || lastLine.startsWith('emr_show(')) {
    return code;
  }

  if (lastLine.startsWith('__emr_run_pip(')) {
    return code;
  }

  if (lastLine.startsWith('print(')) {
    return code;
  }

  if (shouldSkipAutoDisplay(lines, lastIndex)) {
    return tryWrapStatementExpression(lines, lastIndex) ?? code;
  }

  lines[lastIndex] = wrapLineWithEmrShow(lines[lastIndex]);
  return lines.join('\n');
}

const SELECT_ONLY = /^\s*(?:--.*\n\s*)*select\b[\s\S]*$/i;

/** SQL that returns a rowset and should render as an interactive table. */
const TABULAR_SQL =
  /^\s*(?:--.*\n\s*)*(?:select|show|describe|desc|explain)\b[\s\S]*$/i;

/** Normalize common Spark SQL variants (e.g. SHOW DATABASES FROM → IN). */
export function normalizeSparkSql(sql: string): string {
  return sql
    .trim()
    .replace(/;+\s*$/g, '')
    .replace(/\bshow\s+databases\s+from\b/gi, 'SHOW DATABASES IN')
    .replace(/\bshow\s+schemas\s+from\b/gi, 'SHOW SCHEMAS IN')
    .replace(/\bshow\s+tables\s+from\b/gi, 'SHOW TABLES IN')
    .replace(/\bshow\s+namespaces\s+from\b/gi, 'SHOW NAMESPACES IN');
}

export function isSelectOnlySql(sql: string): boolean {
  const trimmed = normalizeSparkSql(sql);
  return SELECT_ONLY.test(trimmed);
}

export function isTabularSql(sql: string): boolean {
  const trimmed = normalizeSparkSql(sql);
  return TABULAR_SQL.test(trimmed);
}

export function sqlToDisplayPySpark(sql: string, maxRows: number): string {
  const normalized = normalizeSparkSql(sql);
  const escaped = normalized.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const dataExpr = `spark.sql("""${escaped}""")`;
  return emrShowCall(dataExpr, dataExpr, maxRows);
}
