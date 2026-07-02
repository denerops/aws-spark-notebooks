import * as vscode from 'vscode';
import { getDefaultRegion } from '../aws/credentials';
import { getGlueSessionService } from './glueSessionService';
import { buildCreateGlueSessionInput } from './buildCreateSessionRequest';
import type { GlueSessionPreset } from './presets';
import { installPresetPythonPackagesForGlue } from './installPythonPackages';
import { GlueLivySession } from './glueSession';
import type { GlueNotebookMetadata } from '../notebook/types';
import { isEmrSparkNotebook } from '../notebook/types';

export interface GlueNotebookBinding {
  region: string;
  session: GlueLivySession;
}

const DEAD_STATES = new Set(['dead', 'error', 'killed', 'shutting_down']);

export class GlueConnectionManager {
  private readonly bindings = new Map<string, GlueNotebookBinding>();
  private readonly connecting = new Map<string, Promise<GlueNotebookBinding>>();
  private creatingSession = false;

  isCreatingSession(): boolean {
    return this.creatingSession;
  }

  getBinding(notebook: vscode.NotebookDocument): GlueNotebookBinding | undefined {
    return this.bindings.get(notebook.uri.toString());
  }

  getSession(notebook: vscode.NotebookDocument): GlueLivySession | undefined {
    return this.getBinding(notebook)?.session;
  }

  listBindings(): GlueNotebookBinding[] {
    return [...this.bindings.values()];
  }

  resolveNotebookMetadata(notebook: vscode.NotebookDocument): GlueNotebookMetadata {
    return (notebook.metadata?.glueInteractive ?? {}) as GlueNotebookMetadata;
  }

  async ensureConnected(notebook: vscode.NotebookDocument): Promise<GlueLivySession> {
    const key = notebook.uri.toString();
    const existing = this.getBinding(notebook);
    if (existing) {
      await existing.session.refreshState().catch(() => undefined);
      if (existing.session.isReady) {
        if (!existing.session.dashboardUrl) {
          await this.refreshDashboard(existing.session);
        }
        return existing.session;
      }
      if (DEAD_STATES.has(existing.session.state)) {
        await this.clearNotebookSession(notebook);
      } else {
        return existing.session;
      }
    }

    const inFlight = this.connecting.get(key);
    if (inFlight) {
      return (await inFlight).session;
    }

    const meta = this.resolveNotebookMetadata(notebook);
    if (!meta.sessionId) {
      throw new Error('Notebook is not connected. Run "Glue Interactive: Connect to Session".');
    }

    const connectPromise = this.attachToSession(notebook, meta.sessionId).catch(async (error) => {
      await this.clearNotebookSession(notebook);
      throw error;
    });
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
    sessionId: string
  ): Promise<GlueNotebookBinding> {
    const region = await getDefaultRegion();
    const session = await GlueLivySession.attach(region, sessionId);

    const binding: GlueNotebookBinding = { region, session };
    this.bindings.set(notebook.uri.toString(), binding);
    await this.setNotebookConnectionMetadata(notebook, { sessionId });
    void this.refreshDashboard(session).catch(() => undefined);
    return binding;
  }

  async createSession(
    notebook: vscode.NotebookDocument,
    preset?: GlueSessionPreset,
    sessionName?: string
  ): Promise<GlueNotebookBinding> {
    const existingBinding = this.getBinding(notebook);
    if (existingBinding?.session.isReady) {
      return existingBinding;
    }

    if (existingBinding && !existingBinding.session.isReady) {
      this.bindings.delete(notebook.uri.toString());
    }

    const session = await this.withSessionCreationLock(() =>
      this.createGlueSession(preset, sessionName)
    );

    const binding: GlueNotebookBinding = {
      region: session.region,
      session,
    };
    this.bindings.set(notebook.uri.toString(), binding);
    await this.setNotebookConnectionMetadata(notebook, {
      sessionId: session.sessionId,
    });
    return binding;
  }

  async createStandaloneSession(
    preset?: GlueSessionPreset,
    sessionName?: string
  ): Promise<GlueLivySession> {
    return this.withSessionCreationLock(() => this.createGlueSession(preset, sessionName));
  }

  private async withSessionCreationLock(
    factory: () => Promise<GlueLivySession>
  ): Promise<GlueLivySession> {
    if (this.creatingSession) {
      throw new Error('A Glue session is already being created. Please wait for it to finish.');
    }

    this.creatingSession = true;
    try {
      return await factory();
    } finally {
      this.creatingSession = false;
    }
  }

  private async createGlueSession(
    preset?: GlueSessionPreset,
    sessionName?: string
  ): Promise<GlueLivySession> {
    const region = await getDefaultRegion();
    const input = buildCreateGlueSessionInput(preset, { sessionName });
    const session = await GlueLivySession.create(region, input);
    void this.finishSessionSetup(session, preset?.pythonPackages);
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
    await this.refreshDashboard(session).catch(() => undefined);
  }

  async refreshDashboard(session: GlueLivySession): Promise<string | undefined> {
    await session.refreshState().catch(() => undefined);
    const service = getGlueSessionService();
    const url = await service.getDashboardUrl(session.sessionId);
    session.setDashboardUrl(url);
    if (!url) {
      session.setDashboardError('Spark UI URL not available for this Glue session.');
    }
    return url;
  }

  resolveSparkUiTarget(notebook?: vscode.NotebookDocument): {
    sessionId: string;
    session?: GlueLivySession;
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
        return { sessionId: bound.sessionId, session: bound };
      }
      const meta = this.resolveNotebookMetadata(nb);
      if (meta.sessionId) {
        return { sessionId: meta.sessionId, session: bound };
      }
    }

    const binding = this.listBindings()[0];
    if (binding) {
      return {
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

    const service = getGlueSessionService();
    return service.getDashboardUrl(target.sessionId);
  }

  async disconnectNotebook(notebook: vscode.NotebookDocument): Promise<void> {
    await this.clearNotebookSession(notebook);
  }

  releaseNotebookBinding(notebook: vscode.NotebookDocument): void {
    const key = notebook.uri.toString();
    this.bindings.delete(key);
    this.connecting.delete(key);
  }

  async disconnectAll(): Promise<void> {
    this.bindings.clear();
    this.connecting.clear();
  }

  async detachNotebooksForSession(sessionId: string): Promise<vscode.NotebookDocument[]> {
    const affected: vscode.NotebookDocument[] = [];

    for (const notebook of vscode.workspace.notebookDocuments) {
      if (!isEmrSparkNotebook(notebook)) {
        continue;
      }

      const binding = this.getBinding(notebook);
      const meta = this.resolveNotebookMetadata(notebook);
      const matches =
        binding?.session.sessionId === sessionId || meta.sessionId === sessionId;

      if (matches) {
        await this.clearNotebookSession(notebook);
        affected.push(notebook);
      }
    }

    return affected;
  }

  async clearNotebookSession(notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    this.bindings.delete(key);
    this.connecting.delete(key);

    const edit = new vscode.WorkspaceEdit();
    const metadata = {
      ...notebook.metadata,
      glueInteractive: {},
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
    await vscode.workspace.applyEdit(edit);
  }

  async updateNotebookMetadata(
    notebook: vscode.NotebookDocument,
    glueInteractive: GlueNotebookMetadata
  ): Promise<void> {
    await this.setNotebookConnectionMetadata(notebook, glueInteractive);
  }

  private async setNotebookConnectionMetadata(
    notebook: vscode.NotebookDocument,
    glueInteractive: GlueNotebookMetadata
  ): Promise<void> {
    const edit = new vscode.WorkspaceEdit();
    const metadata = {
      ...notebook.metadata,
      glueInteractive: {
        ...((notebook.metadata?.glueInteractive ?? {}) as GlueNotebookMetadata),
        ...glueInteractive,
      },
      emrServerless: {},
    };
    edit.set(notebook.uri, [vscode.NotebookEdit.updateNotebookMetadata(metadata)]);
    await vscode.workspace.applyEdit(edit);
  }
}
