import type { LivyApplication } from '../../aws/emrServerlessClient';
import type { GlueSessionSummary } from '../../glue/types';
import type { LivySessionInfo } from '../../livy/types';
import type {
  EmrCreateParams,
  EmrSparkBackendAdapter,
  GlueCreateParams,
  GlueSparkBackendAdapter,
  SparkSessionHandle,
} from '../sparkBackend';

export function createHandle(
  init: {
    backend: 'emr' | 'glue';
    sessionId: string | number;
    applicationId?: string;
    state?: string;
    isReady?: boolean;
    name?: string;
    dashboardUrl?: string;
    dashboardError?: string;
  }
): SparkSessionHandle {
  const state = {
    value: init.state ?? 'idle',
    ready: init.isReady ?? true,
    dashboardUrl: init.dashboardUrl,
    dashboardError: init.dashboardError,
    dashboardAnnounced: false,
  };

  return {
    backend: init.backend,
    sessionId: init.sessionId,
    applicationId: init.applicationId,
    name: init.name,
    get state() {
      return state.value;
    },
    set state(value: string) {
      state.value = value;
    },
    get isReady() {
      return state.ready;
    },
    set isReady(value: boolean) {
      state.ready = value;
    },
    get dashboardUrl() {
      return state.dashboardUrl;
    },
    set dashboardUrl(value: string | undefined) {
      state.dashboardUrl = value;
    },
    get dashboardError() {
      return state.dashboardError;
    },
    set dashboardError(value: string | undefined) {
      state.dashboardError = value;
    },
    get dashboardAnnounced() {
      return state.dashboardAnnounced;
    },
    markDashboardAnnounced() {
      state.dashboardAnnounced = true;
    },
    async executeStatement() {
      throw new Error('not implemented');
    },
    async refreshState() {
      /* keep current state */
    },
  };
}

export class FakeEmrAdapter implements EmrSparkBackendAdapter {
  creating = new Set<string>();
  attachCalls: Array<{ applicationId: string; sessionId: number }> = [];
  createCalls: EmrCreateParams[] = [];
  dashboardUrls = new Map<string, string>();
  region = 'us-east-1';
  applications: LivyApplication[] = [];
  sessionsByApp = new Map<string, LivySessionInfo[]>();

  isCreatingSession(applicationId: string): boolean {
    return this.creating.has(applicationId);
  }

  async listApplications(): Promise<{ region: string; applications: LivyApplication[] }> {
    return { region: this.region, applications: this.applications };
  }

  async listSessions(applicationId: string): Promise<LivySessionInfo[]> {
    return this.sessionsByApp.get(applicationId) ?? [];
  }

  async attach(applicationId: string, sessionId: number): Promise<SparkSessionHandle> {
    this.attachCalls.push({ applicationId, sessionId });
    const key = `${applicationId}:${sessionId}`;
    return createHandle({
      backend: 'emr',
      sessionId,
      applicationId,
      name: `emr-${sessionId}`,
      dashboardUrl: this.dashboardUrls.get(key),
    });
  }

  async create(params: EmrCreateParams): Promise<SparkSessionHandle> {
    this.createCalls.push(params);
    const sessionId = 100 + this.createCalls.length;
    const key = `${params.applicationId}:${sessionId}`;
    return createHandle({
      backend: 'emr',
      sessionId,
      applicationId: params.applicationId,
      name: params.sessionName ?? `created-${sessionId}`,
      dashboardUrl: this.dashboardUrls.get(key) ?? `https://emr.example/${sessionId}`,
    });
  }

  async createStandalone(params: EmrCreateParams): Promise<SparkSessionHandle> {
    return this.create(params);
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    const url =
      session.dashboardUrl ??
      `https://emr.example/${session.applicationId}/${session.sessionId}`;
    session.dashboardUrl = url;
    return url;
  }

  async resolveDashboardUrl(
    applicationId: string,
    sessionId: number
  ): Promise<{ url?: string; error?: string }> {
    const key = `${applicationId}:${sessionId}`;
    const url = this.dashboardUrls.get(key);
    return url ? { url } : { error: 'not found' };
  }
}

export class FakeGlueAdapter implements GlueSparkBackendAdapter {
  creating = false;
  attachCalls: string[] = [];
  createCalls: GlueCreateParams[] = [];
  dashboardUrls = new Map<string, string>();
  region = 'us-east-1';
  sessions: GlueSessionSummary[] = [];

  isCreatingSession(): boolean {
    return this.creating;
  }

  async listSessions(): Promise<{ region: string; sessions: GlueSessionSummary[] }> {
    return { region: this.region, sessions: this.sessions };
  }

  async attach(sessionId: string): Promise<SparkSessionHandle> {
    this.attachCalls.push(sessionId);
    return createHandle({
      backend: 'glue',
      sessionId,
      name: `glue-${sessionId}`,
      dashboardUrl: this.dashboardUrls.get(sessionId),
    });
  }

  async create(params: GlueCreateParams): Promise<SparkSessionHandle> {
    this.createCalls.push(params);
    const sessionId = `glue-created-${this.createCalls.length}`;
    return createHandle({
      backend: 'glue',
      sessionId,
      name: params.sessionName ?? sessionId,
      dashboardUrl: this.dashboardUrls.get(sessionId) ?? `https://glue.example/${sessionId}`,
    });
  }

  async createStandalone(params: GlueCreateParams): Promise<SparkSessionHandle> {
    return this.create(params);
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    const url = session.dashboardUrl ?? `https://glue.example/${session.sessionId}`;
    session.dashboardUrl = url;
    return url;
  }

  async resolveDashboardUrl(sessionId: string): Promise<string | undefined> {
    return this.dashboardUrls.get(sessionId);
  }
}
