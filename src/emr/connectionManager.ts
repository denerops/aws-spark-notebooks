import { getEmrServerlessService, type LivyApplication } from '../aws/emrServerlessClient';
import { buildCreateSessionBody } from '../session/buildSessionBody';
import { getDefaultRegion } from '../aws/credentials';
import { installPresetPythonPackages } from '../livy/installPythonPackages';
import { LivySession } from '../livy/session';
import { LivySigV4Client } from '../livy/sigV4Client';
import type {
  EmrCreateParams,
  EmrSparkBackendAdapter,
  SparkSessionHandle,
} from '../platform/sparkBackend';
import type { LivySessionInfo, LivyStatement, StatementKind } from '../livy/types';

/**
 * EMR Serverless Spark Backend adapter: list/standalone-create/stop and AWS
 * session work. Does not write notebook metadata.
 */
export class EmrSparkBackend implements EmrSparkBackendAdapter {
  private readonly creatingSessionByApp = new Map<string, Promise<LivySession>>();
  private readonly sessions = new WeakMap<SparkSessionHandle, LivySession>();

  isCreatingSession(applicationId: string): boolean {
    return this.creatingSessionByApp.has(applicationId);
  }

  async listApplications(): Promise<{ region: string; applications: LivyApplication[] }> {
    const service = getEmrServerlessService();
    const region = await service.getRegion();
    const applications = await service.listLivyApplications();
    return { region, applications };
  }

  async listSessions(applicationId: string): Promise<LivySessionInfo[]> {
    const region = await getDefaultRegion();
    const client = new LivySigV4Client(applicationId, region);
    return client.listSessions();
  }

  async attach(applicationId: string, sessionId: number): Promise<SparkSessionHandle> {
    const region = await getDefaultRegion();
    const session = await LivySession.attach(applicationId, region, sessionId);
    const handle = this.wrap(session);
    await this.refreshDashboard(handle);
    return handle;
  }

  async create(params: EmrCreateParams): Promise<SparkSessionHandle> {
    const session = await this.withSessionCreationLock(params.applicationId, () =>
      this.createLivySession(params)
    );
    return this.wrap(session);
  }

  async createStandalone(params: EmrCreateParams): Promise<SparkSessionHandle> {
    return this.create(params);
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    const livy = this.unwrap(session);
    await livy.refreshState().catch(() => undefined);
    const service = getEmrServerlessService();
    const result = await service.getSparkDashboardUrl(livy.applicationId, livy.sessionId, {
      sparkAppId: livy.sparkAppId,
    });
    livy.setDashboardUrl(result.url);
    livy.setDashboardError(result.error);
    return result.url;
  }

  async resolveDashboardUrl(
    applicationId: string,
    sessionId: number,
    sparkAppId?: string
  ): Promise<{ url?: string; error?: string }> {
    const service = getEmrServerlessService();
    return service.getSparkDashboardUrl(applicationId, sessionId, { sparkAppId });
  }

  async getApplicationName(applicationId: string): Promise<string> {
    const service = getEmrServerlessService();
    const app = await service.getApplication(applicationId);
    return app?.name ?? applicationId;
  }

  private wrap(session: LivySession): SparkSessionHandle {
    const handle: SparkSessionHandle = {
      backend: 'emr',
      sessionId: session.sessionId,
      applicationId: session.applicationId,
      get state() {
        return session.state;
      },
      get isReady() {
        return session.isReady;
      },
      get name() {
        return session.name;
      },
      get dashboardUrl() {
        return session.dashboardUrl;
      },
      get dashboardError() {
        return session.dashboardError;
      },
      get dashboardAnnounced() {
        return session.dashboardAnnounced;
      },
      markDashboardAnnounced: () => session.markDashboardAnnounced(),
      executeStatement: (
        code: string,
        kind: StatementKind,
        options?: {
          signal?: AbortSignal;
          skipDisplayWrap?: boolean;
          onStatement?: (stmt: LivyStatement) => void;
        }
      ) => session.executeStatement(code, kind, options),
      refreshState: async () => {
        await session.refreshState();
      },
    };
    this.sessions.set(handle, session);
    return handle;
  }

  private unwrap(handle: SparkSessionHandle): LivySession {
    const session = this.sessions.get(handle);
    if (!session) {
      throw new Error('EMR session handle is not owned by this adapter.');
    }
    return session;
  }

  private async withSessionCreationLock(
    applicationId: string,
    factory: () => Promise<LivySession>
  ): Promise<LivySession> {
    const inFlight = this.creatingSessionByApp.get(applicationId);
    if (inFlight) {
      throw new Error(
        'A Livy session is already being created for this application. Please wait for it to finish.'
      );
    }

    const createPromise = factory();
    this.creatingSessionByApp.set(applicationId, createPromise);

    try {
      return await createPromise;
    } finally {
      this.creatingSessionByApp.delete(applicationId);
    }
  }

  private async createLivySession(params: EmrCreateParams): Promise<LivySession> {
    const region = await getDefaultRegion();
    const body = buildCreateSessionBody(params.preset, { sessionName: params.sessionName });
    const session = await LivySession.create(
      params.applicationId,
      region,
      body,
      params.onProgress
    );
    await installPresetPythonPackages(session, params.preset?.pythonPackages);
    const handle = this.wrap(session);
    await this.refreshDashboard(handle);
    return session;
  }
}

/** @deprecated Use EmrSparkBackend */
export { EmrSparkBackend as ConnectionManager };
