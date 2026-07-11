import * as vscode from 'vscode';
import type { SessionPresetStore } from '../session/presets';
import type { GlueSessionPresetStore } from '../glue/presets';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import { selectEmrKernel } from '../ui/kernelSelection';
import { pickSparkBackend, selectGlueKernel } from '../ui/glueKernelSelection';
import { SparknbController } from './controller';
import { CONTROLLER_ID, NOTEBOOK_TYPE, isEmrSparkNotebook } from './types';
import { formatLivySessionLabel } from '../livy/types';
import { formatGlueSessionLabel } from '../glue/types';

export class EmrKernelManager implements vscode.Disposable {
  private readonly mainController: vscode.NotebookController;
  private readonly sparkController: SparknbController;

  constructor(
    private readonly connectionHub: NotebookConnectionHub,
    private readonly emrPresetStore: SessionPresetStore,
    private readonly gluePresetStore: GlueSessionPresetStore,
    private readonly context: vscode.ExtensionContext
  ) {
    this.sparkController = new SparknbController(connectionHub);

    this.mainController = vscode.notebooks.createNotebookController(
      CONTROLLER_ID,
      NOTEBOOK_TYPE,
      'AWS Spark PySpark'
    );
    this.mainController.supportedLanguages = ['python', 'sql'];
    this.mainController.supportsExecutionOrder = true;
    this.mainController.executeHandler = (cells, notebook) =>
      this.handleExecute(cells, notebook);

    context.subscriptions.push(
      this.mainController,
      this.sparkController,
      vscode.workspace.onDidOpenNotebookDocument((notebook) => {
        if (!isEmrSparkNotebook(notebook)) {
          return;
        }
        this.updateKernelAppearance(notebook);
      })
    );

    for (const notebook of vscode.workspace.notebookDocuments) {
      if (isEmrSparkNotebook(notebook)) {
        this.updateKernelAppearance(notebook);
      }
    }
  }

  dispose(): void {
    // Controllers disposed via context.subscriptions
  }

  private isNotebookConnected(notebook: vscode.NotebookDocument): boolean {
    return this.connectionHub.isConnected(notebook);
  }

  /** Prefer a live binding; otherwise try metadata reattach, then the session picker. */
  private async ensureSessionOrPrompt(
    notebook: vscode.NotebookDocument,
    backend?: 'emr' | 'glue'
  ): Promise<boolean> {
    if (
      !backend &&
      (this.isNotebookConnected(notebook) || this.connectionHub.resolveBackend(notebook))
    ) {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Reconnecting to Spark session…',
          },
          () => this.connectionHub.ensureConnected(notebook)
        );
        this.updateKernelAppearance(notebook);
        return true;
      } catch {
        // Stale binding/metadata or dead session — fall through to picker.
      }
    }

    return this.promptKernelSelection(notebook, backend);
  }

  async promptKernelSelection(
    notebook: vscode.NotebookDocument,
    backend?: 'emr' | 'glue'
  ): Promise<boolean> {
    const selectedBackend = backend ?? (await pickSparkBackend());
    if (!selectedBackend) {
      return false;
    }

    const connected =
      selectedBackend === 'glue'
        ? await selectGlueKernel(
            this.connectionHub.getGlueManager(),
            this.gluePresetStore,
            notebook
          )
        : await selectEmrKernel(
            this.connectionHub.getEmrManager(),
            this.emrPresetStore,
            notebook
          );

    if (connected) {
      this.updateKernelAppearance(notebook);
      void vscode.commands.executeCommand('emrServerless.refreshApplications');
      void vscode.commands.executeCommand('glueInteractive.refreshSessions');
      void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
    } else {
      this.updateKernelAppearance(notebook);
    }
    return connected;
  }

  updateKernelAppearance(notebook: vscode.NotebookDocument): void {
    if (!isEmrSparkNotebook(notebook)) {
      return;
    }

    const glueBinding = this.connectionHub.getGlueManager().getBinding(notebook);
    if (glueBinding?.session.isReady) {
      const sessionLabel = formatGlueSessionLabel({
        id: glueBinding.session.sessionId,
        description: glueBinding.session.name,
      });
      this.mainController.label = 'Glue Interactive PySpark';
      this.mainController.description = sessionLabel;
      this.mainController.detail = glueBinding.session.state;
      this.mainController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Preferred
      );
      return;
    }

    const glueMeta = (notebook.metadata?.glueInteractive ?? {}) as { sessionId?: string };
    if (glueMeta.sessionId) {
      const sessionLabel = formatGlueSessionLabel({ id: glueMeta.sessionId });
      this.mainController.label = 'Glue Interactive PySpark';
      this.mainController.description = sessionLabel;
      this.mainController.detail = 'attached';
      this.mainController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Preferred
      );
      return;
    }

    const emrBinding = this.connectionHub.getEmrManager().getBinding(notebook);
    if (emrBinding?.session.isReady) {
      const shortApp =
        emrBinding.applicationId.length > 16
          ? `${emrBinding.applicationId.slice(0, 12)}…`
          : emrBinding.applicationId;
      const sessionLabel = formatLivySessionLabel({
        id: emrBinding.session.sessionId,
        name: emrBinding.session.name,
      });
      this.mainController.label = 'EMR Serverless PySpark';
      this.mainController.description = `${shortApp} · ${sessionLabel}`;
      this.mainController.detail = emrBinding.session.state;
      this.mainController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Preferred
      );
      return;
    }

    const emrMeta = (notebook.metadata?.emrServerless ?? {}) as {
      applicationId?: string;
      sessionId?: number;
    };
    if (emrMeta.applicationId && emrMeta.sessionId !== undefined) {
      const shortApp =
        emrMeta.applicationId.length > 16
          ? `${emrMeta.applicationId.slice(0, 12)}…`
          : emrMeta.applicationId;
      const sessionLabel = formatLivySessionLabel({ id: emrMeta.sessionId });
      this.mainController.label = 'EMR Serverless PySpark';
      this.mainController.description = `${shortApp} · ${sessionLabel}`;
      this.mainController.detail = 'attached';
      this.mainController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Preferred
      );
      return;
    }

    this.mainController.label = 'AWS Spark PySpark';
    this.mainController.description = 'No session selected';
    this.mainController.detail = 'Select an EMR or Glue session to run cells';
    // Preferred affinity auto-selects this controller so Run Cell skips VS Code's
    // kernel-source / kernel-list pickers and goes straight to our backend prompt.
    this.mainController.updateNotebookAffinity(
      notebook,
      vscode.NotebookControllerAffinity.Preferred
    );
  }

  private async handleExecute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    if (!(await this.ensureSessionOrPrompt(notebook))) {
      await this.sparkController.failCells(
        cells,
        notebook,
        this.mainController,
        'No Spark session selected. Use Select Kernel or run a cell to choose an EMR Serverless or Glue Interactive session.'
      );
      return;
    }
    this.updateKernelAppearance(notebook);

    await this.sparkController.executeCells(cells, notebook, this.mainController);
    this.updateKernelAppearance(notebook);
  }
}

export function registerKernelManager(
  context: vscode.ExtensionContext,
  connectionHub: NotebookConnectionHub,
  emrPresetStore: SessionPresetStore,
  gluePresetStore: GlueSessionPresetStore
): EmrKernelManager {
  const manager = new EmrKernelManager(
    connectionHub,
    emrPresetStore,
    gluePresetStore,
    context
  );
  context.subscriptions.push(manager);
  return manager;
}
