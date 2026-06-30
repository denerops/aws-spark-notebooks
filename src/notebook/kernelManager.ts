import * as vscode from 'vscode';
import type { ConnectionManager } from '../emr/connectionManager';
import type { SessionPresetStore } from '../session/presets';
import {
  isNotebookConnected,
  selectEmrKernel,
} from '../ui/kernelSelection';
import { SparknbController } from './controller';
import {
  CONTROLLER_ID,
  KERNEL_SELECT_CONTROLLER_ID,
  NOTEBOOK_TYPE,
  isEmrSparkNotebook,
} from './types';
import { formatLivySessionLabel } from '../livy/types';

export class EmrKernelManager implements vscode.Disposable {
  private readonly mainController: vscode.NotebookController;
  private readonly selectController: vscode.NotebookController;
  private readonly sparkController: SparknbController;
  /** Skip the first controller selection after open (implicit preferred kernel). */
  private readonly skipKernelPromptOnSelect = new Set<string>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly presetStore: SessionPresetStore,
    private readonly context: vscode.ExtensionContext
  ) {
    this.sparkController = new SparknbController(connectionManager);

    this.mainController = vscode.notebooks.createNotebookController(
      CONTROLLER_ID,
      NOTEBOOK_TYPE,
      'EMR Serverless PySpark'
    );
    this.mainController.supportedLanguages = ['python', 'sql'];
    this.mainController.supportsExecutionOrder = true;
    this.mainController.executeHandler = (cells, notebook) =>
      this.handleExecute(cells, notebook);

    this.selectController = vscode.notebooks.createNotebookController(
      KERNEL_SELECT_CONTROLLER_ID,
      NOTEBOOK_TYPE,
      'Select EMR Session…'
    );
    this.selectController.supportedLanguages = ['python', 'sql'];
    this.selectController.supportsExecutionOrder = true;
    this.selectController.description = 'Choose application and Livy session';
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

      if (!isNotebookConnected(this.connectionManager, event.notebook)) {
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
        if (!isNotebookConnected(connectionManager, notebook)) {
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

  async promptKernelSelection(notebook: vscode.NotebookDocument): Promise<boolean> {
    const connected = await selectEmrKernel(
      this.connectionManager,
      this.presetStore,
      notebook
    );
    if (connected) {
      this.updateKernelAppearance(notebook);
      void vscode.commands.executeCommand('emrServerless.refreshApplications');
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

    const binding = this.connectionManager.getBinding(notebook);

    if (binding?.session.isReady) {
      const shortApp =
        binding.applicationId.length > 16
          ? `${binding.applicationId.slice(0, 12)}…`
          : binding.applicationId;
      const sessionLabel = formatLivySessionLabel({
        id: binding.session.sessionId,
        name: binding.session.name,
      });
      this.mainController.label = 'EMR Serverless PySpark';
      this.mainController.description = `${shortApp} · ${sessionLabel}`;
      this.mainController.detail = binding.session.state;
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

    this.mainController.label = 'EMR Serverless PySpark';
    this.mainController.description = 'No session selected';
    this.mainController.detail = 'Select a Livy session to run cells';
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
    if (connected && cells.length > 0) {
      await this.sparkController.executeCells(cells, notebook, this.mainController);
    } else if (cells.length > 0) {
      await this.sparkController.failCells(
        cells,
        notebook,
        this.selectController,
        'No EMR Serverless session selected. Use the kernel picker to select an application and session.'
      );
    }
  }

  private async handleExecute(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument
  ): Promise<void> {
    if (!isNotebookConnected(this.connectionManager, notebook)) {
      const connected = await this.promptKernelSelection(notebook);
      if (!connected) {
        await this.sparkController.failCells(
          cells,
          notebook,
          this.mainController,
          'No EMR Serverless session selected. Use the kernel picker to select an application and session.'
        );
        return;
      }
    }

    await this.sparkController.executeCells(cells, notebook, this.mainController);
    this.updateKernelAppearance(notebook);
  }
}

export function registerKernelManager(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  presetStore: SessionPresetStore
): EmrKernelManager {
  const manager = new EmrKernelManager(connectionManager, presetStore, context);
  context.subscriptions.push(manager);
  return manager;
}
