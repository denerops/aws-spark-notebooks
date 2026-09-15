export type StartupFailureCategory =
  | 'unresolved_spark_package'
  | 'repo_unreachable'
  | 'unknown';

export interface SessionStartupFailure {
  category: StartupFailureCategory;
  summary: string;
  detail: string;
  logLines: string[];
  sessionId?: number | string;
}

const UNRESOLVED_DEPENDENCY =
  /unresolved dependency:\s*([^#\s]+)#([^;]+);([^\s:\]]+)/i;
const MODULE_NOT_FOUND = /module not found:\s*([^#\s]+)#([^;]+);([^\s:]+)/i;
const IVY_NOT_FOUND = /::\s*([^#\s]+)#([^;]+);([^\s:]+):\s*not found/i;
const REPO_UNREACHABLE =
  /unknownhostexception|connection timed out|connectexception|server access error|failed to connect|download failed|connection refused|sockettimeout/i;
const MAIN_EXCEPTION = /exception in thread\s+"[^"]+"\s+(.+)/i;
const CAUSED_BY = /^caused by:\s*(.+)/i;

export class SessionStartupFailureError extends Error {
  readonly failure: SessionStartupFailure;

  constructor(failure: SessionStartupFailure) {
    super(failure.summary);
    this.name = 'SessionStartupFailureError';
    this.failure = failure;
  }
}

export function diagnoseLivyStartupFailure(input: {
  state: string;
  logLines?: string[];
  sessionId?: number | string;
}): SessionStartupFailure {
  const logLines = normalizeLogLines(input.logLines);
  const parsed = parseLogLines(logLines);
  return {
    category: parsed.category,
    summary: formatLivySummary(input.state, parsed),
    detail: parsed.detail,
    logLines,
    sessionId: input.sessionId,
  };
}

export function diagnoseGlueStartupFailure(input: {
  status: string;
  errorMessage?: string;
  sessionId?: number | string;
}): SessionStartupFailure {
  const logLines = normalizeLogLines(
    input.errorMessage ? input.errorMessage.split(/\r?\n/) : []
  );
  const parsed = parseLogLines(logLines);
  return {
    category: parsed.category,
    summary: formatGlueSummary(input.status, parsed, input.errorMessage),
    detail: parsed.detail || input.errorMessage?.trim() || '',
    logLines,
    sessionId: input.sessionId,
  };
}

interface ParsedLog {
  category: StartupFailureCategory;
  packageCoord?: string;
  exceptionLine?: string;
  detail: string;
}

function parseLogLines(logLines: string[]): ParsedLog {
  const joined = logLines.join('\n');

  const unresolved =
    joined.match(UNRESOLVED_DEPENDENCY) ??
    joined.match(MODULE_NOT_FOUND) ??
    joined.match(IVY_NOT_FOUND);
  if (unresolved) {
    const coord = ivyToMaven(unresolved[1], unresolved[2], unresolved[3]);
    return {
      category: 'unresolved_spark_package',
      packageCoord: coord,
      detail: extractDetail(logLines, unresolved[0]),
    };
  }

  if (REPO_UNREACHABLE.test(joined)) {
    return {
      category: 'repo_unreachable',
      detail: extractDetail(logLines, joined.match(REPO_UNREACHABLE)?.[0]),
    };
  }

  const exceptionLine = findExceptionLine(logLines);
  return {
    category: 'unknown',
    exceptionLine,
    detail: exceptionLine ? extractDetail(logLines, exceptionLine) : tailDetail(logLines),
  };
}

function formatLivySummary(state: string, parsed: ParsedLog): string {
  const prefix = `Session failed to start (state: ${state})`;
  return formatSummary(prefix, parsed);
}

function formatGlueSummary(
  status: string,
  parsed: ParsedLog,
  errorMessage?: string
): string {
  const prefix = `Glue session failed to start (status: ${status})`;
  if (parsed.category !== 'unknown') {
    return formatSummary(prefix, parsed);
  }
  const trimmed = errorMessage?.trim();
  if (trimmed) {
    return `${prefix}: ${firstLine(trimmed)}`;
  }
  return formatSummary(prefix, parsed);
}

function formatSummary(prefix: string, parsed: ParsedLog): string {
  if (parsed.category === 'unresolved_spark_package' && parsed.packageCoord) {
    return `${prefix}: Spark package not found: ${parsed.packageCoord}`;
  }
  if (parsed.category === 'repo_unreachable') {
    return `${prefix}: could not reach Maven repositories (network/timeout). Check spark.jars.packages and whether the application has internet access.`;
  }
  if (parsed.exceptionLine) {
    return `${prefix}: ${firstLine(parsed.exceptionLine)}`;
  }
  return prefix;
}

function ivyToMaven(group?: string, artifact?: string, version?: string): string | undefined {
  if (!group || !artifact || !version) {
    return undefined;
  }
  return `${group}:${artifact}:${version.replace(/]$/, '')}`;
}

function findExceptionLine(logLines: string[]): string | undefined {
  for (const line of logLines) {
    const main = line.match(MAIN_EXCEPTION);
    if (main?.[1]) {
      return main[1].trim();
    }
  }
  for (const line of logLines) {
    const caused = line.trim().match(CAUSED_BY);
    if (caused?.[1]) {
      return caused[1].trim();
    }
  }
  return undefined;
}

function extractDetail(logLines: string[], match?: string): string {
  if (!match) {
    return tailDetail(logLines);
  }
  const index = logLines.findIndex((line) => line.includes(match));
  if (index < 0) {
    return tailDetail(logLines);
  }
  const start = Math.max(0, index - 8);
  const end = Math.min(logLines.length, index + 12);
  return logLines.slice(start, end).join('\n').trim();
}

function tailDetail(logLines: string[]): string {
  const nonempty = logLines.map((line) => line.trim()).filter(Boolean);
  return nonempty.slice(-30).join('\n');
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? text;
}

function normalizeLogLines(lines?: string[]): string[] {
  if (!lines?.length) {
    return [];
  }
  return lines.map((line) => String(line).replace(/\r$/, ''));
}
