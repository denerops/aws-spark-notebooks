import {
  getSessionStartupTimeoutSeconds,
  getStatementPollIntervalMs,
} from '../aws/config';
import {
  diagnoseLivyStartupFailure,
  SessionStartupFailureError,
} from '../session/diagnoseStartupFailure';
import {
  DEAD_SESSION_STATES,
  READY_SESSION_STATES,
  isSessionGoneError,
} from '../session/sessionState';
import { LivySigV4Client } from './sigV4Client';
import type { LivySessionInfo, LivyStatement, StatementKind } from './types';
import { EMR_DISPLAY_BOOTSTRAP } from './types';
import {
  DEFAULT_HEARTBEAT_TIMEOUT_SECONDS,
  keepAliveIntervalMs,
} from './keepAlive';

export class LivySession {
  private client: LivySigV4Client;
  private bootstrapped = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  private _dashboardUrl: string | undefined;
  private _dashboardFetchedAt: number | undefined;
  private _dashboardAnnounced = false;
  private _dashboardError: string | undefined;

  constructor(
    readonly applicationId: string,
    readonly region: string,
    public sessionId: number,
    public state: string = 'starting',
    public sparkAppId?: string,
    public name?: string
  ) {
    this.client = new LivySigV4Client(applicationId, region);
  }

  get isReady(): boolean {
    return READY_SESSION_STATES.has(this.state);
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
    applicationId: string,
    region: string,
    body: Record<string, unknown>,
    onProgress?: (info: LivySessionInfo) => void
  ): Promise<LivySession> {
    const client = new LivySigV4Client(applicationId, region);
    const info = await client.createSession(body);
    const requestedName = typeof body.name === 'string' ? body.name.trim() : undefined;
    onProgress?.({
      ...info,
      name: info.name ?? requestedName,
    });
    const session = new LivySession(
      applicationId,
      region,
      info.id,
      info.state,
      info.appId,
      info.name ?? requestedName
    );
    await session.waitUntilReady(onProgress);
    await session.bootstrap();
    const heartbeatTimeout =
      typeof body.heartbeatTimeoutInSecond === 'number'
        ? body.heartbeatTimeoutInSecond
        : DEFAULT_HEARTBEAT_TIMEOUT_SECONDS;
    session.startKeepAlive(keepAliveIntervalMs(heartbeatTimeout));
    return session;
  }

  static async attach(
    applicationId: string,
    region: string,
    sessionId: number
  ): Promise<LivySession> {
    const client = new LivySigV4Client(applicationId, region);
    const info = await client.getSession(sessionId);
    if (DEAD_SESSION_STATES.has(info.state)) {
      throw await errorForDeadLivySession(client, info);
    }
    const session = new LivySession(
      applicationId,
      region,
      sessionId,
      info.state,
      info.appId,
      info.name
    );
    if (!READY_SESSION_STATES.has(info.state)) {
      await session.waitUntilReady();
    }
    session.startKeepAlive(keepAliveIntervalMs(DEFAULT_HEARTBEAT_TIMEOUT_SECONDS));
    return session;
  }

  async refreshState(): Promise<LivySessionInfo> {
    const info = await this.client.getSession(this.sessionId);
    this.state = info.state;
    if (info.appId) {
      this.sparkAppId = info.appId;
    }
    if (info.name) {
      this.name = info.name;
    }
    if (DEAD_SESSION_STATES.has(this.state)) {
      this.stopKeepAlive();
    }
    return info;
  }

  async waitUntilReady(onProgress?: (info: LivySessionInfo) => void): Promise<void> {
    const timeoutMs = getSessionStartupTimeoutSeconds() * 1000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const info = await this.refreshState();
      onProgress?.(info);
      if (READY_SESSION_STATES.has(info.state)) {
        return;
      }
      if (DEAD_SESSION_STATES.has(info.state)) {
        throw await errorForDeadLivySession(this.client, info);
      }
      await sleep(2000);
    }

    throw new Error(`Timed out waiting for session ${this.sessionId} to become ready`);
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

    const submitted = await this.client.submitStatement(this.sessionId, code, kind);
    const pollInterval = getStatementPollIntervalMs();

    try {
      return await this.client.pollStatementUntilDone(this.sessionId, submitted.id, {
        pollIntervalMs: pollInterval,
        signal: options?.signal,
        onStatement: options?.onStatement,
      });
    } catch (error) {
      if (options?.signal?.aborted) {
        try {
          await this.client.cancelStatement(this.sessionId, submitted.id);
        } catch {
          // ignore cancel errors
        }
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopKeepAlive();
    await this.client.deleteSession(this.sessionId);
    this.state = 'dead';
  }

  startKeepAlive(intervalMs: number): void {
    this.stopKeepAlive();
    if (intervalMs <= 0) {
      return;
    }
    this.keepAliveTimer = setInterval(() => {
      void this.heartbeat();
    }, intervalMs);
  }

  stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = undefined;
    }
  }

  private async heartbeat(): Promise<void> {
    try {
      await this.client.sendHeartbeat(this.sessionId);
    } catch (error) {
      if (isSessionGoneError(error) || DEAD_SESSION_STATES.has(this.state)) {
        this.stopKeepAlive();
      }
    }
  }

  getClient(): LivySigV4Client {
    return this.client;
  }
}

async function errorForDeadLivySession(
  client: LivySigV4Client,
  info: LivySessionInfo
): Promise<SessionStartupFailureError> {
  let logLines = info.log ?? [];
  const first = diagnoseLivyStartupFailure({
    state: info.state,
    logLines,
    sessionId: info.id,
  });
  if (first.category === 'unknown' || logLines.length === 0) {
    try {
      const extra = await client.getSessionLog(info.id);
      if (extra.length > 0) {
        logLines = extra;
      }
    } catch {
      // Livy log endpoint is optional; keep whatever GET /sessions returned.
    }
  }
  return new SessionStartupFailureError(
    diagnoseLivyStartupFailure({
      state: info.state,
      logLines,
      sessionId: info.id,
    })
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
