import * as vscode from 'vscode';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import { buildCreateSessionBody } from '../session/buildSessionBody';
import type { SessionPreset } from '../session/presets';
import { getDefaultRegion } from '../aws/credentials';
import { installPresetPythonPackages } from '../livy/installPythonPackages';
import { LivySession } from '../livy/session';
import type { SparkNotebookMetadata } from '../notebook/types';
import { isEmrSparkNotebook } from '../notebook/types';

export interface NotebookBinding {
  applicationId: string;
  region: string;
  session: LivySession;
}

export class ConnectionManager {
  private readonly bindings = new Map<string, NotebookBinding>();
  private readonly connecting = new Map<string, Promise<NotebookBinding>>();
  private readonly creatingSessionByApp = new Map<string, Promise<LivySession>>();

  isCreatingSession(applicationId: string): boolean {
    return this.creatingSessionByApp.has(applicationId);
  }

  getBinding(notebook: vscode.NotebookDocument): NotebookBinding | undefined {
    return this.bindings.get(notebook.uri.toString());
  }

  getSession(notebook: vscode.NotebookDocument): LivySession | undefined {
    return this.getBinding(notebook)?.session;
  }

  /**
   * Refresh the bound session. Returns the binding if still ready; otherwise clears the
   * notebook session (keeping applicationId) and returns undefined.
   */
  async getLiveBinding(notebook: vscode.NotebookDocument): Promise<NotebookBinding | undefined> {
    const binding = this.getBinding(notebook);
    if (!binding) {
      return undefined;
    }

    try {
      await binding.session.refreshState();
    } catch {
      // Application stopped or session gone — treat as dead.
      binding.session.state = 'dead';
    }

    if (binding.session.isReady) {
      return binding;
    }

    await this.clearNotebookSession(notebook, { keepApplicationId: true });
    return undefined;
  }

  listBindings(): NotebookBinding[] {
    return [...this.bindings.values()];
  }

  getActiveSession(): LivySession | undefined {
    const active = vscode.window.activeNotebookEditor?.notebook;
    if (active && isEmrSparkNotebook(active)) {
      const session = this.getSession(active);
      if (session) {
        return session;
      }
    }
    const bindings = this.listBindings();
    return bindings[0]?.session;
  }

  resolveNotebookMetadata(notebook: vscode.NotebookDocument): SparkNotebookMetadata {
    return (notebook.metadata?.emrServerless ?? {}) as SparkNotebookMetadata;
  }

  async ensureConnected(notebook: vscode.NotebookDocument): Promise<LivySession> {
    const key = notebook.uri.toString();
    const live = await this.getLiveBinding(notebook);
    if (live) {
      if (!live.session.dashboardUrl) {
        await this.refreshDashboard(live.session);
      }
      return live.session;
    }

    const inFlight = this.connecting.get(key);
    if (inFlight) {
      return (await inFlight).session;
    }

    const meta = this.resolveNotebookMetadata(notebook);
    if (!meta.applicationId || meta.sessionId === undefined) {
      throw new Error('Notebook is not connected. Run "EMR Serverless: Connect to Session".');
    }

    const connectPromise = this.attachToSession(notebook, meta.applicationId, meta.sessionId).catch(
      async (error) => {
        await this.clearNotebookSession(notebook, { keepApplicationId: true });
        throw error;
      }
    );
    this.connecting.set(key, connectPromise);

    try {
      const binding = await connectPromise;
      return binding.session;
    } finally {
      this.connecting.delete(key);
    }
  }

  async attachToSession(
    notebook: vscode.NotebookDocument,
    applicationId: string,
    sessionId: number
  ): Promise<NotebookBinding> {
    const region = await getDefaultRegion();
    const session = await LivySession.attach(applicationId, region, sessionId);
    await this.refreshDashboard(session);

    const binding: NotebookBinding = { applicationId, region, session };
    this.bindings.set(notebook.uri.toString(), binding);
    await this.setNotebookConnectionMetadata(notebook, { applicationId, sessionId });
    return binding;
  }

  async createSession(
    notebook: vscode.NotebookDocument,
    applicationId: string,
    preset?: SessionPreset,
    sessionName?: string
  ): Promise<NotebookBinding> {
    const liveBinding = await this.getLiveBinding(notebook);
    if (liveBinding?.applicationId === applicationId) {
      return liveBinding;
    }

    const session = await this.withSessionCreationLock(applicationId, () =>
      this.createLivySession(applicationId, preset, sessionName)
    );

    const binding: NotebookBinding = {
      applicationId,
      region: session.region,
      session,
    };
    this.bindings.set(notebook.uri.toString(), binding);
    await this.setNotebookConnectionMetadata(notebook, {
      applicationId,
      sessionId: session.sessionId,
    });
    return binding;
  }

  async createStandaloneSession(
    applicationId: string,
    preset?: SessionPreset,
    sessionName?: string
  ): Promise<LivySession> {
    return this.withSessionCreationLock(applicationId, () =>
      this.createLivySession(applicationId, preset, sessionName)
    );
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

  private async createLivySession(
    applicationId: string,
    preset?: SessionPreset,
    sessionName?: string
  ): Promise<LivySession> {
    const region = await getDefaultRegion();
    const body = buildCreateSessionBody(preset, { sessionName });
    const session = await LivySession.create(applicationId, region, body);
    await installPresetPythonPackages(session, preset?.pythonPackages);
    await this.refreshDashboard(session);
    return session;
  }

  async refreshDashboard(session: LivySession): Promise<string | undefined> {
    await session.refreshState().catch(() => undefined);
    const service = getEmrServerlessService();
    const result = await service.getSparkDashboardUrl(
      session.applicationId,
      session.sessionId,
      { sparkAppId: session.sparkAppId }
    );
    session.setDashboardUrl(result.url);
    session.setDashboardError(result.error);
    return result.url;
  }

  /** Resolve application + Livy session id for Spark UI from binding or notebook metadata. */
  resolveSparkUiTarget(notebook?: vscode.NotebookDocument): {
    applicationId: string;
    sessionId: number;
    session?: LivySession;
  } | undefined {
    const candidates: (vscode.NotebookDocument | undefined)[] = [
      notebook,
      vscode.window.activeNotebookEditor?.notebook &&
      isEmrSparkNotebook(vscode.window.activeNotebookEditor.notebook)
        ? vscode.window.activeNotebookEditor.notebook
        : undefined,
      ...vscode.workspace.notebookDocuments.filter((n) => isEmrSparkNotebook(n)),
    ];

    for (const nb of candidates) {
      if (!nb) {
        continue;
      }
      const bound = this.getSession(nb);
      if (bound) {
        return {
          applicationId: bound.applicationId,
          sessionId: bound.sessionId,
          session: bound,
        };
      }
      const meta = this.resolveNotebookMetadata(nb);
      if (meta.applicationId && meta.sessionId !== undefined) {
        return {
          applicationId: meta.applicationId,
          sessionId: meta.sessionId,
          session: bound,
        };
      }
    }

    const binding = this.listBindings()[0];
    if (binding) {
      return {
        applicationId: binding.applicationId,
        sessionId: binding.session.sessionId,
        session: binding.session,
      };
    }

    return undefined;
  }

  async openSparkUi(notebook?: vscode.NotebookDocument): Promise<string | undefined> {
    const target = this.resolveSparkUiTarget(notebook);
    if (!target) {
      return undefined;
    }

    if (target.session) {
      const cached = target.session.dashboardUrl;
      if (cached) {
        return cached;
      }
      return this.refreshDashboard(target.session);
    }

    const service = getEmrServerlessService();
    const result = await service.getSparkDashboardUrl(
      target.applicationId,
      target.sessionId
    );
    return result.url;
  }

  async disconnectNotebook(notebook: vscode.NotebookDocument): Promise<void> {
    await this.clearNotebookSession(notebook, { keepApplicationId: true });
  }

  /** Drop in-memory session binding without editing the notebook document. */
  releaseNotebookBinding(notebook: vscode.NotebookDocument): void {
    const key = notebook.uri.toString();
    this.bindings.delete(key);
    this.connecting.delete(key);
  }

  async disconnectAll(): Promise<void> {
    this.bindings.clear();
    this.connecting.clear();
  }

  /** Drop binding + session id for notebooks tied to a stopped Livy session. */
  async detachNotebooksForSession(
    applicationId: string,
    sessionId: number
  ): Promise<vscode.NotebookDocument[]> {
    const affected: vscode.NotebookDocument[] = [];

    for (const notebook of vscode.workspace.notebookDocuments) {
      if (!isEmrSparkNotebook(notebook)) {
        continue;
      }

      const binding = this.getBinding(notebook);
      const meta = this.resolveNotebookMetadata(notebook);
      const matches =
        (binding?.applicationId === applicationId && binding.session.sessionId === sessionId) ||
        (meta.applicationId === applicationId && meta.sessionId === sessionId);

      if (matches) {
        await this.clearNotebookSession(notebook, { keepApplicationId: true });
        affected.push(notebook);
      }
    }

    return affected;
  }

  /** Drop bindings for all notebooks tied to an application (e.g. after stop/restart). */
  async detachNotebooksForApplication(
    applicationId: string
  ): Promise<vscode.NotebookDocument[]> {
    const affected: vscode.NotebookDocument[] = [];

    for (const notebook of vscode.workspace.notebookDocuments) {
      if (!isEmrSparkNotebook(notebook)) {
        continue;
      }

      const binding = this.getBinding(notebook);
      const meta = this.resolveNotebookMetadata(notebook);
      const matches =
        binding?.applicationId === applicationId ||
        (meta.applicationId === applicationId && meta.sessionId !== undefined);

      if (matches) {
        await this.clearNotebookSession(notebook, { keepApplicationId: true });
        affected.push(notebook);
      }
    }

    return affected;
  }

  async clearNotebookSession(
    notebook: vscode.NotebookDocument,
    options?: { keepApplicationId?: boolean }
  ): Promise<void> {
    const key = notebook.uri.toString();
    this.bindings.delete(key);
    this.connecting.delete(key);

    const previous = this.resolveNotebookMetadata(notebook);
    const emrServerless: SparkNotebookMetadata = {};
    if (options?.keepApplicationId !== false && previous.applicationId) {
      emrServerless.applicationId = previous.applicationId;
    }

    const edit = new vscode.WorkspaceEdit();
    const metadata = {
      ...notebook.metadata,
      emrServerless,
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
    await vscode.workspace.applyEdit(edit);
  }

  async updateNotebookMetadata(
    notebook: vscode.NotebookDocument,
    emrServerless: SparkNotebookMetadata
  ): Promise<void> {
    await this.setNotebookConnectionMetadata(notebook, emrServerless);
  }

  async getApplicationName(applicationId: string): Promise<string> {
    const service = getEmrServerlessService();
    const app = await service.getApplication(applicationId);
    return app?.name ?? applicationId;
  }

  private async setNotebookConnectionMetadata(
    notebook: vscode.NotebookDocument,
    emrServerless: SparkNotebookMetadata
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const metadata = {
      ...notebook.metadata,
      emrServerless: {
        ...((notebook.metadata?.emrServerless ?? {}) as SparkNotebookMetadata),
        ...emrServerless,
      },
      glueInteractive: {},
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
    await vscode.workspace.applyEdit(edit);
  }
}
