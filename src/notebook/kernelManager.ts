import * as vscode from 'vscode';
import type { SessionPresetStore } from '../session/presets';
import type { GlueSessionPresetStore } from '../glue/presets';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import { selectEmrKernel } from '../ui/kernelSelection';
import { pickSparkBackend, selectGlueKernel } from '../ui/glueKernelSelection';
import { SparknbController } from './controller';
import {
  CONTROLLER_ID,
  KERNEL_SELECT_CONTROLLER_ID,
  NOTEBOOK_TYPE,
  isEmrSparkNotebook,
} from './types';
import { formatLivySessionLabel } from '../livy/types';
import { formatGlueSessionLabel } from '../glue/types';

export class EmrKernelManager implements vscode.Disposable {
  private readonly mainController: vscode.NotebookController;
  private readonly selectController: vscode.NotebookController;
  private readonly sparkController: SparknbController;
  private readonly skipKernelPromptOnSelect = new Set<string>();

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

    this.selectController = vscode.notebooks.createNotebookController(
      KERNEL_SELECT_CONTROLLER_ID,
      NOTEBOOK_TYPE,
      'Select Spark Session…'
    );
    this.selectController.supportedLanguages = ['python', 'sql'];
    this.selectController.supportsExecutionOrder = true;
    this.selectController.description = 'Choose EMR Serverless or Glue Interactive session';
    this.selectController.executeHandler = (cells, notebook) =>
      this.handleSelectKernelExecute(cells, notebook);

    this.selectController.onDidChangeSelectedNotebooks((event) => {
      if (!event.selected || !isEmrSparkNotebook(event.notebook)) {
        return;
      }

      const key = event.notebook.uri.toString();
      if (this.skipKernelPromptOnSelect.delete(key)) {
        return;
      }

      if (!this.isNotebookConnected(event.notebook)) {
        void this.promptKernelSelection(event.notebook);
      }
    });

    context.subscriptions.push(
      this.mainController,
      this.selectController,
      this.sparkController,
      vscode.workspace.onDidOpenNotebookDocument((notebook) => {
        if (!isEmrSparkNotebook(notebook)) {
          return;
        }
        if (!this.isNotebookConnected(notebook)) {
          this.skipKernelPromptOnSelect.add(notebook.uri.toString());
        }
        this.updateKernelAppearance(notebook);
      }),
      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        this.skipKernelPromptOnSelect.delete(notebook.uri.toString());
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
      this.selectController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Default
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
      this.selectController.updateNotebookAffinity(
        notebook,
        vscode.NotebookControllerAffinity.Default
      );
      return;
    }

    this.mainController.label = 'AWS Spark PySpark';
    this.mainController.description = 'No session selected';
    this.mainController.detail = 'Select an EMR or Glue session to run cells';
    this.selectController.updateNotebookAffinity(
      notebook,
      vscode.NotebookControllerAffinity.Preferred
    );
    this.mainController.updateNotebookAffinity(
      notebook,
      vscode.NotebookControllerAffinity.Default
    );
  }

  private async handleSelectKernelExecute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    const connected = await this.promptKernelSelection(notebook);
    if (!connected) {
      if (cells.length > 0) {
        await this.sparkController.failCells(
          cells,
          notebook,
          this.selectController,
          'No Spark session selected. Use the kernel picker to select an EMR Serverless or Glue Interactive session.'
        );
      }
      return;
    }

    this.updateKernelAppearance(notebook);

    if (cells.length > 0) {
      // Must execute with the controller that received the run request (selectController).
      await this.sparkController.executeCells(cells, notebook, this.selectController);
    }
  }

  private async handleExecute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    if (!this.isNotebookConnected(notebook)) {
      const connected = await this.promptKernelSelection(notebook);
      if (!connected) {
        await this.sparkController.failCells(
          cells,
          notebook,
          this.mainController,
          'No Spark session selected. Use the kernel picker to select an EMR Serverless or Glue Interactive session.'
        );
        return;
      }
      this.updateKernelAppearance(notebook);
    }

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
