import type { GlueNotebookMetadata, SparkNotebookMetadata } from '../notebook/types';
import { formatGlueSessionLabel } from '../glue/types';
import { formatLivySessionLabel } from '../livy/types';
import {
  isDeadSessionState,
  isSessionGoneError,
  isStartingSessionState,
} from '../session/sessionState';
import type {
  AttachParams,
  ConnectionView,
  CreateForNotebookParams,
  CreatingSessionQuery,
  EmrSparkBackendAdapter,
  GlueSparkBackendAdapter,
  SparkBackend,
  SparkSessionHandle,
  SparkUiTarget,
} from './sparkBackend';
import {
  type NotebookRef,
  type NotebookWorkspace,
} from './notebookWorkspace';

interface LiveBinding {
  backend: SparkBackend;
  session: SparkSessionHandle;
}

/**
 * Deep Notebook Connection module: owns the notebook↔session lifecycle,
 * Session Binding mutex (one Spark Backend per notebook), Connection View,
 * and Spark UI target resolution. Callers must not reach concrete adapters
 * through this module.
 */
export class NotebookConnection {
  private readonly bindings = new Map<string, LiveBinding>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly connectionListeners = new Set<(notebook: NotebookRef) => void>();

  constructor(
    private readonly emr: EmrSparkBackendAdapter,
    private readonly glue: GlueSparkBackendAdapter,
    private readonly workspace: NotebookWorkspace
  ) {}

  onDidChangeConnection(listener: (notebook: NotebookRef) => void): { dispose(): void } {
    this.connectionListeners.add(listener);
    return {
      dispose: () => {
        this.connectionListeners.delete(listener);
      },
    };
  }

  /** Live + ready Spark session available for cell execution. */
  isConnected(notebook: NotebookRef): boolean {
    const binding = this.bindings.get(this.key(notebook));
    return Boolean(binding?.session.isReady);
  }

  /** Session Binding present (metadata and/or live map) — reconnectable, not necessarily Connected. */
  hasSessionBinding(notebook: NotebookRef): boolean {
    if (this.bindings.has(this.key(notebook))) {
      return true;
    }
    return this.resolveBackendFromMetadata(notebook) !== undefined;
  }

  hasAnyBindings(): boolean {
    return this.bindings.size > 0 || this.workspace.listSparkNotebooks().some((nb) =>
      this.resolveBackendFromMetadata(nb) !== undefined
    );
  }

  resolveBackend(notebook: NotebookRef): SparkBackend | undefined {
    const live = this.bindings.get(this.key(notebook));
    if (live) {
      return live.backend;
    }
    return this.resolveBackendFromMetadata(notebook);
  }

  getSession(notebook: NotebookRef): SparkSessionHandle | undefined {
    return this.bindings.get(this.key(notebook))?.session;
  }

  getConnectionView(notebook: NotebookRef): ConnectionView {
    const live = this.bindings.get(this.key(notebook));

    if (live?.backend === 'glue' && live.session.isReady) {
      return {
        backend: 'glue',
        label: 'Glue Interactive PySpark',
        description: formatGlueSessionLabel({
          id: String(live.session.sessionId),
          description: live.session.name,
        }),
        detail: live.session.state,
        connected: true,
      };
    }

    const glueMeta = this.readGlueMeta(notebook);
    if (glueMeta.sessionId) {
      return {
        backend: 'glue',
        label: 'Glue Interactive PySpark',
        description: formatGlueSessionLabel({ id: glueMeta.sessionId }),
        detail: live?.backend === 'glue' ? live.session.state : 'attached',
        connected: false,
      };
    }

    if (live?.backend === 'emr' && live.session.isReady) {
      const applicationId = live.session.applicationId ?? '';
      const shortApp =
        applicationId.length > 16 ? `${applicationId.slice(0, 12)}…` : applicationId;
      const sessionLabel = formatLivySessionLabel({
        id: Number(live.session.sessionId),
        name: live.session.name,
      });
      return {
        backend: 'emr',
        label: 'EMR Serverless PySpark',
        description: `${shortApp} · ${sessionLabel}`,
        detail: live.session.state,
        connected: true,
      };
    }

    const emrMeta = this.readEmrMeta(notebook);
    if (emrMeta.applicationId && emrMeta.sessionId !== undefined) {
      const shortApp =
        emrMeta.applicationId.length > 16
          ? `${emrMeta.applicationId.slice(0, 12)}…`
          : emrMeta.applicationId;
      const sessionLabel = formatLivySessionLabel({ id: emrMeta.sessionId });
      return {
        backend: 'emr',
        label: 'EMR Serverless PySpark',
        description: `${shortApp} · ${sessionLabel}`,
        detail: live?.backend === 'emr' ? live.session.state : 'attached',
        connected: false,
      };
    }

    return {
      label: 'AWS Spark PySpark',
      description: 'No session selected',
      detail: 'Select an EMR or Glue session to run cells',
      connected: false,
    };
  }

  isCreatingSession(query: CreatingSessionQuery): boolean {
    if (query.backend === 'emr') {
      return this.emr.isCreatingSession(query.applicationId);
    }
    return this.glue.isCreatingSession();
  }

  async ensureConnected(notebook: NotebookRef): Promise<SparkSessionHandle> {
    return this.withLock(notebook, async () => {
      const live = await this.getLiveBinding(notebook);
      if (live) {
        if (!live.session.dashboardUrl) {
          await this.refreshDashboard(live.session).catch(() => undefined);
        }
        return live.session;
      }

      const backend = this.resolveBackendFromMetadata(notebook);
      if (!backend) {
        throw new Error(
          'Notebook is not connected. Select an EMR Serverless or Glue Interactive session.'
        );
      }

      try {
        if (backend === 'glue') {
          const sessionId = this.readGlueMeta(notebook).sessionId;
          if (!sessionId) {
            throw new Error(
              'Notebook is not connected. Run "Glue Interactive: Connect to Session".'
            );
          }
          return await this.attachUnlocked(notebook, { backend: 'glue', sessionId });
        }

        const meta = this.readEmrMeta(notebook);
        if (!meta.applicationId || meta.sessionId === undefined) {
          throw new Error(
            'Notebook is not connected. Run "EMR Serverless: Connect to Session".'
          );
        }
        return await this.attachUnlocked(notebook, {
          backend: 'emr',
          applicationId: meta.applicationId,
          sessionId: meta.sessionId,
        });
      } catch (error) {
        if (isSessionGoneError(error)) {
          await this.clearSessionBinding(notebook, {
            keepEmrApplicationId: backend === 'emr',
          });
        }
        throw error;
      }
    });
  }

  async attach(notebook: NotebookRef, params: AttachParams): Promise<SparkSessionHandle> {
    return this.withLock(notebook, () => this.attachUnlocked(notebook, params));
  }

  async createForNotebook(
    notebook: NotebookRef,
    params: CreateForNotebookParams
  ): Promise<SparkSessionHandle> {
    return this.withLock(notebook, async () => {
      await this.releasePreviousRemoteSession(notebook);
      const session =
        params.backend === 'emr'
          ? await this.emr.create(params)
          : await this.glue.create(params);

      await this.bind(notebook, params.backend, session);
      return session;
    });
  }

  /** Drop this notebook's previous Livy/Glue session so a replacement does not inherit a dead driver. */
  private async releasePreviousRemoteSession(notebook: NotebookRef): Promise<void> {
    const live = this.bindings.get(this.key(notebook));
    const emrMeta = this.readEmrMeta(notebook);
    const glueMeta = this.readGlueMeta(notebook);
    this.bindings.delete(this.key(notebook));

    if (live?.backend === 'emr' && live.session.applicationId) {
      await this.deleteEmrSessionIfUnshared(
        notebook,
        live.session.applicationId,
        Number(live.session.sessionId)
      );
      return;
    }
    if (live?.backend === 'glue') {
      await this.deleteGlueSessionIfUnshared(notebook, String(live.session.sessionId));
      return;
    }
    if (emrMeta.applicationId && emrMeta.sessionId !== undefined) {
      await this.deleteEmrSessionIfUnshared(
        notebook,
        emrMeta.applicationId,
        emrMeta.sessionId
      );
      return;
    }
    if (glueMeta.sessionId) {
      await this.deleteGlueSessionIfUnshared(notebook, glueMeta.sessionId);
    }
  }

  private async deleteEmrSessionIfUnshared(
    notebook: NotebookRef,
    applicationId: string,
    sessionId: number
  ): Promise<void> {
    if (this.isSharedEmrSession(notebook, applicationId, sessionId)) {
      return;
    }
    await this.emr.deleteSession(applicationId, sessionId).catch(() => undefined);
  }

  private async deleteGlueSessionIfUnshared(
    notebook: NotebookRef,
    sessionId: string
  ): Promise<void> {
    if (this.isSharedGlueSession(notebook, sessionId)) {
      return;
    }
    await this.glue.deleteSession(sessionId).catch(() => undefined);
  }

  private isSharedEmrSession(
    except: NotebookRef,
    applicationId: string,
    sessionId: number
  ): boolean {
    for (const notebook of this.workspace.listSparkNotebooks()) {
      if (this.key(notebook) === this.key(except)) {
        continue;
      }
      const live = this.bindings.get(this.key(notebook));
      if (
        live?.backend === 'emr' &&
        live.session.applicationId === applicationId &&
        Number(live.session.sessionId) === sessionId
      ) {
        return true;
      }
      const meta = this.readEmrMeta(notebook);
      if (meta.applicationId === applicationId && meta.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  private isSharedGlueSession(except: NotebookRef, sessionId: string): boolean {
    for (const notebook of this.workspace.listSparkNotebooks()) {
      if (this.key(notebook) === this.key(except)) {
        continue;
      }
      const live = this.bindings.get(this.key(notebook));
      if (live?.backend === 'glue' && String(live.session.sessionId) === sessionId) {
        return true;
      }
      if (this.readGlueMeta(notebook).sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  async disconnect(notebook: NotebookRef): Promise<void> {
    await this.withLock(notebook, async () => {
      const backend = this.resolveBackend(notebook);
      await this.clearSessionBinding(notebook, {
        keepEmrApplicationId: backend === 'emr',
      });
    });
  }

  /** Drop in-memory binding without editing notebook metadata. */
  release(notebook: NotebookRef): void {
    const key = this.key(notebook);
    this.bindings.delete(key);
    this.emitConnectionChange(notebook);
  }

  async disconnectAll(): Promise<void> {
    const notebooks = this.workspace.listSparkNotebooks();
    for (const notebook of notebooks) {
      await this.clearSessionBinding(notebook);
    }
    this.bindings.clear();
    this.locks.clear();
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    if (session.backend === 'glue') {
      return this.glue.refreshDashboard(session);
    }
    return this.emr.refreshDashboard(session);
  }

  resolveSparkUiTarget(notebook?: NotebookRef): SparkUiTarget | undefined {
    const candidates: (NotebookRef | undefined)[] = [
      notebook,
      this.workspace.getActiveSparkNotebook(),
      ...this.workspace.listSparkNotebooks(),
    ];

    for (const nb of candidates) {
      if (!nb) {
        continue;
      }
      const live = this.bindings.get(this.key(nb));
      if (live?.backend === 'glue') {
        return {
          backend: 'glue',
          sessionId: String(live.session.sessionId),
          session: live.session,
        };
      }
      if (live?.backend === 'emr' && live.session.applicationId) {
        return {
          backend: 'emr',
          applicationId: live.session.applicationId,
          sessionId: Number(live.session.sessionId),
          session: live.session,
        };
      }

      const glueMeta = this.readGlueMeta(nb);
      if (glueMeta.sessionId) {
        return { backend: 'glue', sessionId: glueMeta.sessionId, session: live?.session };
      }

      const emrMeta = this.readEmrMeta(nb);
      if (emrMeta.applicationId && emrMeta.sessionId !== undefined) {
        return {
          backend: 'emr',
          applicationId: emrMeta.applicationId,
          sessionId: emrMeta.sessionId,
          session: live?.session,
        };
      }
    }

    const first = this.bindings.values().next().value as LiveBinding | undefined;
    if (first?.backend === 'glue') {
      return {
        backend: 'glue',
        sessionId: String(first.session.sessionId),
        session: first.session,
      };
    }
    if (first?.backend === 'emr' && first.session.applicationId) {
      return {
        backend: 'emr',
        applicationId: first.session.applicationId,
        sessionId: Number(first.session.sessionId),
        session: first.session,
      };
    }

    return undefined;
  }

  async openSparkUi(notebook?: NotebookRef): Promise<string | undefined> {
    const target = this.resolveSparkUiTarget(notebook);
    if (!target) {
      return undefined;
    }

    if (target.session?.dashboardUrl) {
      return target.session.dashboardUrl;
    }
    if (target.session) {
      return this.refreshDashboard(target.session);
    }

    if (target.backend === 'glue') {
      return this.glue.resolveDashboardUrl(target.sessionId);
    }

    const result = await this.emr.resolveDashboardUrl(
      target.applicationId,
      target.sessionId
    );
    return result.url;
  }

  async detachForEmrSession(
    applicationId: string,
    sessionId: number
  ): Promise<NotebookRef[]> {
    const affected: NotebookRef[] = [];
    for (const notebook of this.workspace.listSparkNotebooks()) {
      const live = this.bindings.get(this.key(notebook));
      const meta = this.readEmrMeta(notebook);
      const matches =
        (live?.backend === 'emr' &&
          live.session.applicationId === applicationId &&
          Number(live.session.sessionId) === sessionId) ||
        (meta.applicationId === applicationId && meta.sessionId === sessionId);
      if (matches) {
        await this.clearSessionBinding(notebook, { keepEmrApplicationId: true });
        affected.push(notebook);
      }
    }
    return affected;
  }

  async detachForEmrApplication(applicationId: string): Promise<NotebookRef[]> {
    const affected: NotebookRef[] = [];
    for (const notebook of this.workspace.listSparkNotebooks()) {
      const live = this.bindings.get(this.key(notebook));
      const meta = this.readEmrMeta(notebook);
      const matches =
        (live?.backend === 'emr' && live.session.applicationId === applicationId) ||
        (meta.applicationId === applicationId && meta.sessionId !== undefined);
      if (matches) {
        await this.clearSessionBinding(notebook, { keepEmrApplicationId: true });
        affected.push(notebook);
      }
    }
    return affected;
  }

  async detachForGlueSession(sessionId: string): Promise<NotebookRef[]> {
    const affected: NotebookRef[] = [];
    for (const notebook of this.workspace.listSparkNotebooks()) {
      const live = this.bindings.get(this.key(notebook));
      const meta = this.readGlueMeta(notebook);
      const matches =
        (live?.backend === 'glue' && String(live.session.sessionId) === sessionId) ||
        meta.sessionId === sessionId;
      if (matches) {
        await this.clearSessionBinding(notebook);
        affected.push(notebook);
      }
    }
    return affected;
  }

  private async attachUnlocked(
    notebook: NotebookRef,
    params: AttachParams
  ): Promise<SparkSessionHandle> {
    const session =
      params.backend === 'emr'
        ? await this.emr.attach(params.applicationId, params.sessionId)
        : await this.glue.attach(params.sessionId);

    await this.bind(notebook, params.backend, session);
    return session;
  }

  private async getLiveBinding(notebook: NotebookRef): Promise<LiveBinding | undefined> {
    const binding = this.bindings.get(this.key(notebook));
    if (!binding) {
      return undefined;
    }

    try {
      await binding.session.refreshState();
    } catch (error) {
      if (isSessionGoneError(error)) {
        await this.clearSessionBinding(notebook, {
          keepEmrApplicationId: binding.backend === 'emr',
        });
        return undefined;
      }
      if (binding.session.isReady) {
        return binding;
      }
      return undefined;
    }

    if (binding.session.isReady) {
      return binding;
    }

    if (isStartingSessionState(binding.session.state)) {
      try {
        await binding.session.waitUntilReady();
      } catch (error) {
        if (isSessionGoneError(error) || isDeadSessionState(binding.session.state)) {
          await this.clearSessionBinding(notebook, {
            keepEmrApplicationId: binding.backend === 'emr',
          });
          return undefined;
        }
        throw error;
      }
      if (binding.session.isReady) {
        return binding;
      }
    }

    if (isDeadSessionState(binding.session.state)) {
      await this.clearSessionBinding(notebook, {
        keepEmrApplicationId: binding.backend === 'emr',
      });
      return undefined;
    }

    return undefined;
  }

  /** One-backend-per-notebook Session Binding mutex: writing one backend clears the other. */
  private async bind(
    notebook: NotebookRef,
    backend: SparkBackend,
    session: SparkSessionHandle
  ): Promise<void> {
    const key = this.key(notebook);
    this.bindings.set(key, { backend, session });

    if (backend === 'emr') {
      const applicationId = session.applicationId;
      if (!applicationId) {
        throw new Error('EMR session handle is missing applicationId.');
      }
      await this.workspace.applyMetadata(notebook, {
        ...notebook.metadata,
        emrServerless: {
          applicationId,
          sessionId: Number(session.sessionId),
        },
        glueInteractive: {},
      });
      this.emitConnectionChange(notebook);
      return;
    }

    await this.workspace.applyMetadata(notebook, {
      ...notebook.metadata,
      glueInteractive: { sessionId: String(session.sessionId) },
      emrServerless: {},
    });
    this.emitConnectionChange(notebook);
  }

  private async clearSessionBinding(
    notebook: NotebookRef,
    options?: { keepEmrApplicationId?: boolean }
  ): Promise<void> {
    const key = this.key(notebook);
    this.bindings.delete(key);

    const previous = this.readEmrMeta(notebook);
    const emrServerless: SparkNotebookMetadata = {};
    if (options?.keepEmrApplicationId && previous.applicationId) {
      emrServerless.applicationId = previous.applicationId;
    }

    await this.workspace.applyMetadata(notebook, {
      ...notebook.metadata,
      emrServerless,
      glueInteractive: {},
    });
    this.emitConnectionChange(notebook);
  }

  private async withLock<T>(notebook: NotebookRef, fn: () => Promise<T>): Promise<T> {
    const key = this.key(notebook);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(
      () => gate,
      () => gate
    );
    this.locks.set(key, chained);
    try {
      await previous.catch(() => undefined);
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) {
        this.locks.delete(key);
      }
    }
  }

  private emitConnectionChange(notebook: NotebookRef): void {
    for (const listener of this.connectionListeners) {
      listener(notebook);
    }
  }

  private resolveBackendFromMetadata(notebook: NotebookRef): SparkBackend | undefined {
    const glueMeta = this.readGlueMeta(notebook);
    if (glueMeta.sessionId) {
      return 'glue';
    }
    const emrMeta = this.readEmrMeta(notebook);
    if (emrMeta.sessionId !== undefined) {
      return 'emr';
    }
    return undefined;
  }

  private readEmrMeta(notebook: NotebookRef): SparkNotebookMetadata {
    return (notebook.metadata?.emrServerless ?? {}) as SparkNotebookMetadata;
  }

  private readGlueMeta(notebook: NotebookRef): GlueNotebookMetadata {
    return (notebook.metadata?.glueInteractive ?? {}) as GlueNotebookMetadata;
  }

  private key(notebook: NotebookRef): string {
    return notebook.uri.toString();
  }
}
