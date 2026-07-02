import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import type { GlueConnectionManager } from '../glue/connectionManager';
import type { LivySession } from '../livy/session';
import type { GlueLivySession } from '../glue/glueSession';
import type { LivyStatement, StatementKind } from '../livy/types';
import { isEmrSparkNotebook } from '../notebook/types';

export type SparkBackend = 'emr' | 'glue';

export interface SparkSessionHandle {
  backend: SparkBackend;
  sessionId: string | number;
  state: string;
  isReady: boolean;
  name?: string;
  dashboardUrl?: string;
  dashboardError?: string;
  dashboardAnnounced: boolean;
  markDashboardAnnounced(): void;
  executeStatement(
    code: string,
    kind: StatementKind,
    options?: {
      signal?: AbortSignal;
      skipDisplayWrap?: boolean;
      onStatement?: (stmt: LivyStatement) => void;
    }
  ): Promise<LivyStatement>;
  refreshState(): Promise<void>;
}

function wrapEmrSession(session: LivySession): SparkSessionHandle {
  return {
    backend: 'emr',
    sessionId: session.sessionId,
    state: session.state,
    isReady: session.isReady,
    name: session.name,
    dashboardUrl: session.dashboardUrl,
    dashboardError: session.dashboardError,
    dashboardAnnounced: session.dashboardAnnounced,
    markDashboardAnnounced: () => session.markDashboardAnnounced(),
    executeStatement: (code, kind, options) => session.executeStatement(code, kind, options),
    refreshState: async () => {
      await session.refreshState();
    },
  };
}

function wrapGlueSession(session: GlueLivySession): SparkSessionHandle {
  return {
    backend: 'glue',
    sessionId: session.sessionId,
    state: session.state,
    isReady: session.isReady,
    name: session.name,
    dashboardUrl: session.dashboardUrl,
    dashboardError: session.dashboardError,
    dashboardAnnounced: session.dashboardAnnounced,
    markDashboardAnnounced: () => session.markDashboardAnnounced(),
    executeStatement: (code, kind, options) => session.executeStatement(code, kind, options),
    refreshState: async () => {
      await session.refreshState();
    },
  };
}

export class NotebookConnectionHub {
  constructor(
    private readonly emr: ConnectionManager,
    private readonly glue: GlueConnectionManager
  ) {}

  resolveBackend(notebook: vscode.NotebookDocument): SparkBackend | undefined {
    if (this.glue.getBinding(notebook)) {
      return 'glue';
    }
    if (this.emr.getBinding(notebook)) {
      return 'emr';
    }

    const glueMeta = notebook.metadata?.glueInteractive as { sessionId?: string } | undefined;
    if (glueMeta?.sessionId) {
      return 'glue';
    }

    const emrMeta = notebook.metadata?.emrServerless as { sessionId?: number } | undefined;
    if (emrMeta?.sessionId !== undefined) {
      return 'emr';
    }

    return undefined;
  }

  isConnected(notebook: vscode.NotebookDocument): boolean {
    const glueSession = this.glue.getSession(notebook);
    if (glueSession?.isReady) {
      return true;
    }
    const emrSession = this.emr.getSession(notebook);
    return Boolean(emrSession?.isReady);
  }

  async ensureConnected(notebook: vscode.NotebookDocument): Promise<SparkSessionHandle> {
    const backend = this.resolveBackend(notebook);
    if (backend === 'glue') {
      const session = await this.glue.ensureConnected(notebook);
      return wrapGlueSession(session);
    }
    if (backend === 'emr') {
      const session = await this.emr.ensureConnected(notebook);
      return wrapEmrSession(session);
    }
    throw new Error(
      'Notebook is not connected. Select an EMR Serverless or Glue Interactive session.'
    );
  }

  async refreshDashboard(session: SparkSessionHandle): Promise<string | undefined> {
    if (session.backend === 'glue') {
      const glueSession = this.findGlueSession(session.sessionId);
      if (!glueSession) {
        return undefined;
      }
      return this.glue.refreshDashboard(glueSession);
    }

    const emrSession = this.findEmrSession(session.sessionId);
    if (!emrSession) {
      return undefined;
    }
    return this.emr.refreshDashboard(emrSession);
  }

  async openSparkUi(notebook?: vscode.NotebookDocument): Promise<string | undefined> {
    if (notebook && isEmrSparkNotebook(notebook)) {
      const backend = this.resolveBackend(notebook);
      if (backend === 'glue') {
        return this.glue.openSparkUi(notebook);
      }
      if (backend === 'emr') {
        return this.emr.openSparkUi(notebook);
      }
    }

    const glueUrl = await this.glue.openSparkUi(notebook);
    if (glueUrl) {
      return glueUrl;
    }
    return this.emr.openSparkUi(notebook);
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([this.emr.disconnectAll(), this.glue.disconnectAll()]);
  }

  getEmrManager(): ConnectionManager {
    return this.emr;
  }

  getGlueManager(): GlueConnectionManager {
    return this.glue;
  }

  private findGlueSession(sessionId: string | number): GlueLivySession | undefined {
    for (const binding of this.glue.listBindings()) {
      if (binding.session.sessionId === sessionId) {
        return binding.session;
      }
    }
    return undefined;
  }

  private findEmrSession(sessionId: string | number): LivySession | undefined {
    for (const binding of this.emr.listBindings()) {
      if (binding.session.sessionId === sessionId) {
        return binding.session;
      }
    }
    return undefined;
  }
}
