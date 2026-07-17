import * as vscode from 'vscode';
import type { SessionPresetStore } from '../session/presets';
import type { GlueSessionPresetStore } from '../glue/presets';
import type { NotebookConnection } from '../platform/notebookConnection';
import { selectEmrKernel } from '../ui/kernelSelection';
import { pickSparkBackend, selectGlueKernel } from '../ui/glueKernelSelection';
import { SparknbController } from './controller';
import { CONTROLLER_ID, NOTEBOOK_TYPE, isEmrSparkNotebook } from './types';

export class EmrKernelManager implements vscode.Disposable {
  private readonly mainController: vscode.NotebookController;
  private readonly sparkController: SparknbController;

  constructor(
    private readonly connection: NotebookConnection,
    private readonly emrPresetStore: SessionPresetStore,
    private readonly gluePresetStore: GlueSessionPresetStore,
    private readonly context: vscode.ExtensionContext
  ) {
    this.sparkController = new SparknbController(connection);

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

  /** Prefer a live binding; otherwise try metadata reattach, then the session picker. */
  private async ensureSessionOrPrompt(
    notebook: vscode.NotebookDocument,
    backend?: 'emr' | 'glue'
  ): Promise<boolean> {
    if (!backend && this.connection.isConnected(notebook)) {
      return true;
    }

    if (!backend && this.connection.hasSessionBinding(notebook)) {
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Reconnecting to Spark session…',
          },
          () => this.connection.ensureConnected(notebook)
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
        ? await selectGlueKernel(this.connection, this.gluePresetStore, notebook)
        : await selectEmrKernel(this.connection, this.emrPresetStore, notebook);

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

    const view = this.connection.getConnectionView(notebook);
    this.mainController.label = view.label;
    this.mainController.description = view.description;
    this.mainController.detail = view.detail;
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
  connection: NotebookConnection,
  emrPresetStore: SessionPresetStore,
  gluePresetStore: GlueSessionPresetStore
): EmrKernelManager {
  const manager = new EmrKernelManager(
    connection,
    emrPresetStore,
    gluePresetStore,
    context
  );
  context.subscriptions.push(manager);
  return manager;
}
