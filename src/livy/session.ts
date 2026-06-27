import {
  getSessionStartupTimeoutSeconds,
  getStatementPollIntervalMs,
} from '../aws/config';
import { LivySigV4Client } from './sigV4Client';
import type { LivySessionInfo, LivyStatement, StatementKind } from './types';
import { EMR_DISPLAY_BOOTSTRAP } from './types';

const READY_STATES = new Set(['idle', 'busy']);
const DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);

export class LivySession {
  private client: LivySigV4Client;
  private bootstrapped = false;
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
    applicationId: string,
    region: string,
    body: Record<string, unknown>
  ): Promise<LivySession> {
    const client = new LivySigV4Client(applicationId, region);
    const info = await client.createSession(body);
    const requestedName = typeof body.name === 'string' ? body.name.trim() : undefined;
    const session = new LivySession(
      applicationId,
      region,
      info.id,
      info.state,
      info.appId,
      info.name ?? requestedName
    );
    await session.waitUntilReady();
    await session.bootstrap();
    return session;
  }

  static async attach(
    applicationId: string,
    region: string,
    sessionId: number
  ): Promise<LivySession> {
    const client = new LivySigV4Client(applicationId, region);
    const info = await client.getSession(sessionId);
    if (DEAD_STATES.has(info.state)) {
      throw new Error(`Session ${sessionId} is not active (state: ${info.state})`);
    }
    const session = new LivySession(
      applicationId,
      region,
      sessionId,
      info.state,
      info.appId,
      info.name
    );
    if (!READY_STATES.has(info.state)) {
      await session.waitUntilReady();
    }
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
    return info;
  }

  async waitUntilReady(): Promise<void> {
    const timeoutMs = getSessionStartupTimeoutSeconds() * 1000;
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
      const info = await this.refreshState();
      if (READY_STATES.has(info.state)) {
        return;
      }
      if (DEAD_STATES.has(info.state)) {
        throw new Error(`Session failed to start (state: ${info.state})`);
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
    await this.client.deleteSession(this.sessionId);
    this.state = 'dead';
  }

  getClient(): LivySigV4Client {
    return this.client;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
