import * as vscode from 'vscode';
import { getDefaultRegion } from '../aws/credentials';
import { getGlueSessionService } from './glueSessionService';
import { buildCreateGlueSessionInput } from './buildCreateSessionRequest';
import { installPresetPythonPackagesForGlue } from './installPythonPackages';
import { GlueLivySession } from './glueSession';
import type {
  GlueCreateParams,
  GlueSparkBackendAdapter,
  SparkSessionHandle,
} from '../platform/sparkBackend';
import type { GlueSessionSummary } from './types';
import type { LivyStatement, StatementKind } from '../livy/types';

/**
 * Glue Interactive Sessions Spark Backend adapter: list/standalone-create/stop
 * and AWS session work. Does not write notebook metadata.
 */
export class GlueSparkBackend implements GlueSparkBackendAdapter {
  private creatingSession: Promise<GlueLivySession> | undefined;
  private readonly sessions = new WeakMap<SparkSessionHandle, GlueLivySession>();

  isCreatingSession(): boolean {
    return Boolean(this.creatingSession);
  }

  async listSessions(): Promise<{ region: string; sessions: GlueSessionSummary[] }> {
    const service = getGlueSessionService();
    const region = await service.getRegion();
    const sessions = await service.listLivySessions();
    return { region, sessions };
  }

  async attach(sessionId: string): Promise<SparkSessionHandle> {
    const region = await getDefaultRegion();
    const session = await GlueLivySession.attach(region, sessionId);
    const handle = this.wrap(session);
    await this.refreshDashboard(handle).catch(() => undefined);
    return handle;
  }

  async create(params: GlueCreateParams): Promise<SparkSessionHandle> {
    const session = await this.withSessionCreationLock(() => this.createGlueSession(params));
    return this.wrap(session);
  }

  async createStandalone(params: GlueCreateParams): Promise<SparkSessionHandle> {
    return this.create(params);
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    const glue = this.unwrap(session);
    await glue.refreshState().catch(() => undefined);
    const service = getGlueSessionService();
    const url = await service.getDashboardUrl(glue.sessionId);
    glue.setDashboardUrl(url);
    if (!url) {
      glue.setDashboardError('Spark UI URL not available for this Glue session.');
    }
    return url;
  }

  async resolveDashboardUrl(sessionId: string): Promise<string | undefined> {
    const service = getGlueSessionService();
    return service.getDashboardUrl(sessionId);
  }

  private wrap(session: GlueLivySession): SparkSessionHandle {
    const handle: SparkSessionHandle = {
      backend: 'glue',
      sessionId: session.sessionId,
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
      waitUntilReady: () => session.waitUntilReady(),
    };
    this.sessions.set(handle, session);
    return handle;
  }

  private unwrap(handle: SparkSessionHandle): GlueLivySession {
    const session = this.sessions.get(handle);
    if (!session) {
      throw new Error('Glue session handle is not owned by this adapter.');
    }
    return session;
  }

  private async withSessionCreationLock(
    factory: () => Promise<GlueLivySession>
  ): Promise<GlueLivySession> {
    if (this.creatingSession) {
      return this.creatingSession;
    }

    const createPromise = factory();
    this.creatingSession = createPromise;
    try {
      return await createPromise;
    } finally {
      this.creatingSession = undefined;
    }
  }

  private async createGlueSession(params: GlueCreateParams): Promise<GlueLivySession> {
    const region = await getDefaultRegion();
    const input = buildCreateGlueSessionInput(params.preset, {
      sessionName: params.sessionName,
    });
    const session = await GlueLivySession.create(region, input);
    await this.finishSessionSetup(session, params.preset?.pythonPackages);
    return session;
  }

  private async finishSessionSetup(
    session: GlueLivySession,
    pythonPackages?: string[]
  ): Promise<void> {
    try {
      await installPresetPythonPackagesForGlue(session, pythonPackages);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(
        `Glue session ${session.sessionId}: failed to install Python packages. ${message}`
      );
    }
    await this.refreshDashboard(this.wrap(session)).catch(() => undefined);
  }
}
