import type { Statement } from '@aws-sdk/client-glue';
import {
  getGlueSessionStartupTimeoutSeconds,
  getGlueStatementPollIntervalMs,
} from '../aws/glueConfig';
import { getGlueSessionService } from './glueSessionService';
import {
  isGlueStatementTerminal,
  mapGlueStatusToLivyState,
  resolveGlueStatementStatus,
} from './types';
import type { LivyStatement, StatementKind } from '../livy/types';
import { EMR_DISPLAY_BOOTSTRAP } from '../livy/types';

const READY_STATES = new Set(['idle', 'busy']);
const DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);

export class GlueLivySession {
  private bootstrapped = false;
  private _dashboardUrl: string | undefined;
  private _dashboardFetchedAt: number | undefined;
  private _dashboardAnnounced = false;
  private _dashboardError: string | undefined;

  constructor(
    readonly region: string,
    public sessionId: string,
    public state: string = 'starting',
    public name?: string
  ) {}

  get isReady(): boolean {
    return READY_STATES.has(this.state);
  }

  get dashboardUrl(): string | undefined {
    return this._dashboardUrl;
  }

  get dashboardFetchedAt(): number | undefined {
    return this._dashboardFetchedAt;
  }

  setDashboardUrl(url: string | undefined): void {
    this._dashboardUrl = url;
    this._dashboardFetchedAt = url ? Date.now() : undefined;
    this._dashboardAnnounced = false;
    if (url) {
      this._dashboardError = undefined;
    }
  }

  setDashboardError(error: string | undefined): void {
    this._dashboardError = error;
  }

  get dashboardError(): string | undefined {
    return this._dashboardError;
  }

  get dashboardAnnounced(): boolean {
    return this._dashboardAnnounced;
  }

  markDashboardAnnounced(): void {
    this._dashboardAnnounced = true;
  }

  static async create(
    region: string,
    input: import('./glueSessionService').CreateGlueSessionInput
  ): Promise<GlueLivySession> {
    const service = getGlueSessionService();
    const summary = await service.createSession(input);
    const session = new GlueLivySession(
      region,
      summary.id,
      mapGlueStatusToLivyState(summary.status),
      summary.description
    );
    await session.waitUntilReady();
    return session;
  }

  static async attach(region: string, sessionId: string): Promise<GlueLivySession> {
    const service = getGlueSessionService();
    const summary = await service.getSession(sessionId);
    const state = mapGlueStatusToLivyState(summary.status);
    if (DEAD_STATES.has(state)) {
      throw new Error(`Glue session ${sessionId} is not active (status: ${summary.status})`);
    }
    const session = new GlueLivySession(region, sessionId, state, summary.description);
    if (!READY_STATES.has(state)) {
      await session.waitUntilReady();
    }
    return session;
  }

  async refreshState(): Promise<void> {
    const service = getGlueSessionService();
    const summary = await service.getSession(this.sessionId);
    this.state = mapGlueStatusToLivyState(summary.status);
    if (summary.description) {
      this.name = summary.description;
    }
  }

  async waitUntilReady(): Promise<void> {
    const timeoutMs = getGlueSessionStartupTimeoutSeconds() * 1000;
    const service = getGlueSessionService();
    await service.waitForSessionReady(this.sessionId, timeoutMs);
    await this.refreshState();
  }

  async bootstrap(): Promise<void> {
    if (this.bootstrapped) {
      return;
    }
    await this.executeStatement(EMR_DISPLAY_BOOTSTRAP, 'pyspark', { skipDisplayWrap: true });
    this.bootstrapped = true;
  }

  async executeStatement(
    code: string,
    kind: StatementKind,
    options?: {
      signal?: AbortSignal;
      skipDisplayWrap?: boolean;
      onStatement?: (stmt: LivyStatement) => void;
    }
  ): Promise<LivyStatement> {
    if (!options?.skipDisplayWrap && !this.bootstrapped) {
      await this.bootstrap();
    }

    const service = getGlueSessionService();
    const executable = kind === 'sql' ? wrapSqlAsPySpark(code) : code;
    const statementId = await service.runStatement(this.sessionId, executable);
    const pollInterval = getGlueStatementPollIntervalMs();

    try {
      return await this.pollStatementUntilDone(statementId, {
        pollIntervalMs: pollInterval,
        signal: options?.signal,
        onStatement: options?.onStatement,
        code: executable,
      });
    } catch (error) {
      if (options?.signal?.aborted) {
        try {
          await service.cancelStatement(this.sessionId, statementId);
        } catch {
          // ignore cancel errors
        }
      }
      throw error;
    }
  }

  private async pollStatementUntilDone(
    statementId: number,
    options: {
      pollIntervalMs: number;
      signal?: AbortSignal;
      onStatement?: (stmt: LivyStatement) => void;
      code: string;
    }
  ): Promise<LivyStatement> {
    const service = getGlueSessionService();
    const timeoutMs = getGlueSessionStartupTimeoutSeconds() * 1000;
    const started = Date.now();

    while (true) {
      if (options.signal?.aborted) {
        throw new Error('Execution cancelled');
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error(
          `Timed out waiting for Glue statement ${statementId} after ${timeoutMs / 1000}s`
        );
      }

      const raw = await service.getStatement(this.sessionId, statementId);
      const stmt = mapGlueStatementToLivy(raw, options.code);
      options.onStatement?.(stmt);

      if (isGlueStatementTerminal(raw)) {
        return stmt;
      }

      await sleep(options.pollIntervalMs, options.signal);
    }
  }

  async stop(): Promise<void> {
    const service = getGlueSessionService();
    try {
      await service.stopSession(this.sessionId);
    } catch {
      await service.deleteSession(this.sessionId).catch(() => undefined);
    }
    this.state = 'dead';
  }
}

function wrapSqlAsPySpark(code: string): string {
  const escaped = code.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  return `spark.sql("""${escaped}""")`;
}

function mapGlueStatementToLivy(raw: Statement, fallbackCode: string): LivyStatement {
  const output = raw.Output;
  const data = normalizeGlueOutputData(output?.Data);
  const status = resolveGlueStatementStatus(raw);

  return {
    id: raw.Id ?? 0,
    code: raw.Code ?? fallbackCode,
    state: status,
    progress: raw.Progress,
    output: output
      ? {
          status,
          execution_count: output.ExecutionCount,
          data,
          ename: output.ErrorName,
          evalue: output.ErrorValue,
          traceback: output.Traceback,
        }
      : undefined,
  };
}

function normalizeGlueOutputData(data: unknown): Record<string, string> | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const record = data as Record<string, unknown>;
  const result: Record<string, string> = {};

  const textPlain =
    typeof record.TextPlain === 'string'
      ? record.TextPlain
      : typeof record.textPlain === 'string'
        ? record.textPlain
        : typeof record['text/plain'] === 'string'
          ? record['text/plain']
          : undefined;

  if (textPlain !== undefined) {
    result['text/plain'] = textPlain;
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'TextPlain' ||
      key === 'textPlain' ||
      key === 'text/plain' ||
      value === undefined ||
      value === null
    ) {
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value;
    } else {
      result[key] = JSON.stringify(value);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Execution cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Execution cancelled'));
      },
      { once: true }
    );
  });
}
