import type { LivyApplication } from '../aws/emrServerlessClient';
import type { GlueSessionSummary } from '../glue/types';
import type { LivySessionInfo } from '../livy/types';
import {
  diagnoseLivyStartupFailure,
  type SessionStartupFailure,
} from '../session/diagnoseStartupFailure';
import { STARTING_SESSION_STATES } from '../session/sessionState';
import type {
  EmrSparkBackendAdapter,
  GlueSparkBackendAdapter,
} from './sparkBackend';

export const CATALOG_POLL_INTERVAL_MS = 8_000;
export const CATALOG_STALE_MS = 15_000;

const SESSION_DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);
const APP_TRANSITION_STATES = new Set(['STARTING', 'STOPPING']);
const GLUE_TRANSITION_STATUSES = new Set(['PROVISIONING', 'STOPPING']);

function defaultFormatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sessionFailureKey(applicationId: string, sessionId: number): string {
  return `${applicationId}:${sessionId}`;
}

type CatalogListener = () => void;

function createEmitter(): {
  onDidChange(listener: CatalogListener): { dispose(): void };
  emit(): void;
} {
  const listeners = new Set<CatalogListener>();
  return {
    onDidChange(listener) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    emit() {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

/**
 * Shared EMR application/session catalog for the sidebar and Kernel Selection.
 * Refresh is serialized and swapped atomically so the tree never flashes empty.
 */
export class EmrSessionCatalog {
  private readonly emitter = createEmitter();
  private inFlight: Promise<void> | undefined;
  private lastLoadedAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private viewVisible = false;
  private pollIntervalMs: number;
  private formatError: (error: unknown) => string;

  private _region = '';
  private _applications: LivyApplication[] = [];
  private _sessionsByApp = new Map<string, LivySessionInfo[]>();
  private readonly _pendingSessionCreate = new Map<string, string | undefined>();
  private readonly _sessionFailures = new Map<string, SessionStartupFailure>();
  private _loadError: string | undefined;
  private _loading = false;

  constructor(
    private readonly emr: EmrSparkBackendAdapter,
    options?: { pollIntervalMs?: number; formatError?: (error: unknown) => string }
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? CATALOG_POLL_INTERVAL_MS;
    this.formatError = options?.formatError ?? defaultFormatError;
  }

  get region(): string {
    return this._region;
  }

  get applications(): LivyApplication[] {
    return this._applications;
  }

  get sessionsByApp(): Map<string, LivySessionInfo[]> {
    return this._sessionsByApp;
  }

  get pendingSessionCreate(): Map<string, string | undefined> {
    return this._pendingSessionCreate;
  }

  get loadError(): string | undefined {
    return this._loadError;
  }

  get loading(): boolean {
    return this._loading;
  }

  onDidChange(listener: CatalogListener): { dispose(): void } {
    return this.emitter.onDidChange(listener);
  }

  sessionsFor(applicationId: string): LivySessionInfo[] {
    return this._sessionsByApp.get(applicationId) ?? [];
  }

  getApplication(applicationId: string): LivyApplication | undefined {
    return this._applications.find((app) => app.id === applicationId);
  }

  getSessionFailure(
    applicationId: string,
    sessionId: number
  ): SessionStartupFailure | undefined {
    return this._sessionFailures.get(sessionFailureKey(applicationId, sessionId));
  }

  isCreatingSession(applicationId: string): boolean {
    return (
      this._pendingSessionCreate.has(applicationId) || this.emr.isCreatingSession(applicationId)
    );
  }

  setViewVisible(visible: boolean): void {
    this.viewVisible = visible;
    this.syncPolling();
  }

  async refreshIfStale(maxAgeMs = CATALOG_STALE_MS): Promise<void> {
    if (this.lastLoadedAt && Date.now() - this.lastLoadedAt < maxAgeMs && !this._loadError) {
      return;
    }
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.load().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  patchApplicationState(applicationId: string, state: string): void {
    const index = this._applications.findIndex((app) => app.id === applicationId);
    if (index < 0) {
      return;
    }
    this._applications = this._applications.map((app, i) =>
      i === index ? { ...app, state } : app
    );
    if (state !== 'STARTED') {
      const next = new Map(this._sessionsByApp);
      next.delete(applicationId);
      this._sessionsByApp = next;
    }
    this.emitter.emit();
    this.syncPolling();
  }

  markSessionCreating(applicationId: string, sessionName?: string): void {
    this._pendingSessionCreate.set(applicationId, sessionName);
    this.emitter.emit();
    this.syncPolling();
  }

  upsertSession(applicationId: string, session: LivySessionInfo): void {
    this._pendingSessionCreate.delete(applicationId);
    const existing = this._sessionsByApp.get(applicationId) ?? [];
    const index = existing.findIndex((s) => s.id === session.id);
    const next = [...existing];
    if (index >= 0) {
      next[index] = { ...next[index], ...session };
    } else {
      next.push(session);
    }
    const nextMap = new Map(this._sessionsByApp);
    nextMap.set(applicationId, next);
    this._sessionsByApp = nextMap;
    this.maybeRecordFailureFromSession(applicationId, next[index >= 0 ? index : next.length - 1]!);
    this.emitter.emit();
    this.syncPolling();
  }

  recordStartupFailure(applicationId: string, failure: SessionStartupFailure): void {
    const sessionId = failure.sessionId;
    if (typeof sessionId !== 'number') {
      return;
    }
    this._sessionFailures.set(sessionFailureKey(applicationId, sessionId), failure);
    this.emitter.emit();
  }

  clearSessionCreating(applicationId: string): void {
    this._pendingSessionCreate.delete(applicationId);
    this.emitter.emit();
    this.syncPolling();
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async load(): Promise<void> {
    const showLoading = this._applications.length === 0 && !this._loadError;
    if (showLoading) {
      this._loading = true;
      this.emitter.emit();
    }
    try {
      const { region, applications } = await this.emr.listApplications({ force: true });
      const sessionsByApp = new Map<string, LivySessionInfo[]>();
      const started = applications.filter((app) => app.state === 'STARTED');
      const listed = await Promise.all(
        started.map(async (app) => {
          try {
            const sessions = await this.emr.listSessions(app.id);
            return [app.id, sessions] as const;
          } catch {
            return [app.id, [] as LivySessionInfo[]] as const;
          }
        })
      );
      for (const [appId, sessions] of listed) {
        sessionsByApp.set(appId, sessions);
        for (const session of sessions) {
          this.maybeRecordFailureFromSession(appId, session);
        }
      }

      this._region = region;
      this._applications = applications;
      this._sessionsByApp = sessionsByApp;
      this._loadError = undefined;
      this.lastLoadedAt = Date.now();
      this.pruneSessionFailures();
    } catch (error) {
      this._loadError = this.formatError(error);
      this._applications = [];
      this._sessionsByApp = new Map();
    } finally {
      this._loading = false;
      this.emitter.emit();
      this.syncPolling();
    }
  }

  private maybeRecordFailureFromSession(applicationId: string, session: LivySessionInfo): void {
    if (!SESSION_DEAD_STATES.has(session.state)) {
      return;
    }
    const key = sessionFailureKey(applicationId, session.id);
    const existing = this._sessionFailures.get(key);
    if (existing && existing.logLines.length > 0) {
      return;
    }
    if (!session.log?.length && existing) {
      return;
    }
    this._sessionFailures.set(
      key,
      diagnoseLivyStartupFailure({
        state: session.state,
        logLines: session.log,
        sessionId: session.id,
      })
    );
  }

  private pruneSessionFailures(): void {
    const alive = new Set<string>();
    for (const [appId, sessions] of this._sessionsByApp) {
      for (const session of sessions) {
        alive.add(sessionFailureKey(appId, session.id));
      }
    }
    for (const key of [...this._sessionFailures.keys()]) {
      if (!alive.has(key)) {
        this._sessionFailures.delete(key);
      }
    }
  }

  private needsTransitionPoll(): boolean {
    if (this._pendingSessionCreate.size > 0) {
      return true;
    }
    if (this._applications.some((app) => APP_TRANSITION_STATES.has(app.state))) {
      return true;
    }
    for (const sessions of this._sessionsByApp.values()) {
      if (sessions.some((session) => STARTING_SESSION_STATES.has(session.state))) {
        return true;
      }
    }
    return false;
  }

  private syncPolling(): void {
    const shouldPoll = this.viewVisible || this.needsTransitionPoll();
    if (shouldPoll && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.refresh();
      }, this.pollIntervalMs);
    } else if (!shouldPoll && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}

/**
 * Shared Glue session catalog for the sidebar and Kernel Selection.
 */
export class GlueSessionCatalog {
  private readonly emitter = createEmitter();
  private inFlight: Promise<void> | undefined;
  private lastLoadedAt = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private viewVisible = false;
  private pollIntervalMs: number;
  private formatError: (error: unknown) => string;

  private _region = '';
  private _sessions: GlueSessionSummary[] = [];
  private _loadError: string | undefined;
  private _loading = false;

  constructor(
    private readonly glue: GlueSparkBackendAdapter,
    options?: { pollIntervalMs?: number; formatError?: (error: unknown) => string }
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? CATALOG_POLL_INTERVAL_MS;
    this.formatError = options?.formatError ?? defaultFormatError;
  }

  get region(): string {
    return this._region;
  }

  get sessions(): GlueSessionSummary[] {
    return this._sessions;
  }

  get loadError(): string | undefined {
    return this._loadError;
  }

  get loading(): boolean {
    return this._loading;
  }

  onDidChange(listener: CatalogListener): { dispose(): void } {
    return this.emitter.onDidChange(listener);
  }

  isCreatingSession(): boolean {
    return this.glue.isCreatingSession();
  }

  setViewVisible(visible: boolean): void {
    this.viewVisible = visible;
    this.syncPolling();
  }

  async refreshIfStale(maxAgeMs = CATALOG_STALE_MS): Promise<void> {
    if (this.lastLoadedAt && Date.now() - this.lastLoadedAt < maxAgeMs && !this._loadError) {
      return;
    }
    await this.refresh();
  }

  refresh(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.inFlight = this.load().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async load(): Promise<void> {
    const showLoading = this._sessions.length === 0 && !this._loadError;
    if (showLoading) {
      this._loading = true;
      this.emitter.emit();
    }
    try {
      const { region, sessions } = await this.glue.listSessions();
      this._region = region;
      this._sessions = sessions;
      this._loadError = undefined;
      this.lastLoadedAt = Date.now();
    } catch (error) {
      this._loadError = this.formatError(error);
      this._sessions = [];
    } finally {
      this._loading = false;
      this.emitter.emit();
      this.syncPolling();
    }
  }

  private needsTransitionPoll(): boolean {
    return (
      this.glue.isCreatingSession() ||
      this._sessions.some((session) => GLUE_TRANSITION_STATUSES.has(session.status))
    );
  }

  private syncPolling(): void {
    const shouldPoll = this.viewVisible || this.needsTransitionPoll();
    if (shouldPoll && !this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.refresh();
      }, this.pollIntervalMs);
    } else if (!shouldPoll && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}
