import type { GlueNotebookMetadata, SparkNotebookMetadata } from '../notebook/types';
import { formatGlueSessionLabel } from '../glue/types';
import { formatLivySessionLabel } from '../livy/types';
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
  private readonly connecting = new Map<string, Promise<SparkSessionHandle>>();

  constructor(
    private readonly emr: EmrSparkBackendAdapter,
    private readonly glue: GlueSparkBackendAdapter,
    private readonly workspace: NotebookWorkspace
  ) {}

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
    return this.bindings.size > 0;
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
    const key = this.key(notebook);
    const live = await this.getLiveBinding(notebook);
    if (live) {
      if (!live.session.dashboardUrl) {
        await this.refreshDashboard(live.session).catch(() => undefined);
      }
      return live.session;
    }

    const inFlight = this.connecting.get(key);
    if (inFlight) {
      return inFlight;
    }

    const backend = this.resolveBackendFromMetadata(notebook);
    if (!backend) {
      throw new Error(
        'Notebook is not connected. Select an EMR Serverless or Glue Interactive session.'
      );
    }

    const connectPromise = (async () => {
      if (backend === 'glue') {
        const sessionId = this.readGlueMeta(notebook).sessionId;
        if (!sessionId) {
          throw new Error('Notebook is not connected. Run "Glue Interactive: Connect to Session".');
        }
        return this.attach(notebook, { backend: 'glue', sessionId });
      }

      const meta = this.readEmrMeta(notebook);
      if (!meta.applicationId || meta.sessionId === undefined) {
        throw new Error('Notebook is not connected. Run "EMR Serverless: Connect to Session".');
      }
      return this.attach(notebook, {
        backend: 'emr',
        applicationId: meta.applicationId,
        sessionId: meta.sessionId,
      });
    })().catch(async (error) => {
      await this.clearSessionBinding(notebook, {
        keepEmrApplicationId: backend === 'emr',
      });
      throw error;
    });

    this.connecting.set(key, connectPromise);
    try {
      return await connectPromise;
    } finally {
      this.connecting.delete(key);
    }
  }

  async attach(notebook: NotebookRef, params: AttachParams): Promise<SparkSessionHandle> {
    const session =
      params.backend === 'emr'
        ? await this.emr.attach(params.applicationId, params.sessionId)
        : await this.glue.attach(params.sessionId);

    await this.bind(notebook, params.backend, session);
    return session;
  }

  async createForNotebook(
    notebook: NotebookRef,
    params: CreateForNotebookParams
  ): Promise<SparkSessionHandle> {
    const live = await this.getLiveBinding(notebook);
    if (live) {
      if (params.backend === 'emr' && live.backend === 'emr') {
        if (live.session.applicationId === params.applicationId) {
          return live.session;
        }
      } else if (params.backend === 'glue' && live.backend === 'glue') {
        return live.session;
      }
    }

    const session =
      params.backend === 'emr'
        ? await this.emr.create(params)
        : await this.glue.create(params);

    await this.bind(notebook, params.backend, session);
    return session;
  }

  async disconnect(notebook: NotebookRef): Promise<void> {
    const backend = this.resolveBackend(notebook);
    await this.clearSessionBinding(notebook, {
      keepEmrApplicationId: backend === 'emr',
    });
  }

  /** Drop in-memory binding without editing notebook metadata. */
  release(notebook: NotebookRef): void {
    const key = this.key(notebook);
    this.bindings.delete(key);
    this.connecting.delete(key);
  }

  async disconnectAll(): Promise<void> {
    this.bindings.clear();
    this.connecting.clear();
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

  private async getLiveBinding(notebook: NotebookRef): Promise<LiveBinding | undefined> {
    const binding = this.bindings.get(this.key(notebook));
    if (!binding) {
      return undefined;
    }

    try {
      await binding.session.refreshState();
    } catch {
      // Session gone — treat as dead below.
    }

    if (binding.session.isReady) {
      return binding;
    }

    await this.clearSessionBinding(notebook, {
      keepEmrApplicationId: binding.backend === 'emr',
    });
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
      return;
    }

    await this.workspace.applyMetadata(notebook, {
      ...notebook.metadata,
      glueInteractive: { sessionId: String(session.sessionId) },
      emrServerless: {},
    });
  }

  private async clearSessionBinding(
    notebook: NotebookRef,
    options?: { keepEmrApplicationId?: boolean }
  ): Promise<void> {
    const key = this.key(notebook);
    this.bindings.delete(key);
    this.connecting.delete(key);

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

/** @deprecated Use NotebookConnection */
export { NotebookConnection as NotebookConnectionHub };
