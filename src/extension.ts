import * as vscode from 'vscode';
import { registerApplicationsTree } from './browser/applicationsTreeProvider';
import { registerConfigTree } from './browser/configTreeProvider';
import {
  createNewNotebook,
  registerApplicationsActions,
} from './browser/applicationsActions';
import { registerSessionPresetsActions } from './browser/sessionPresetsActions';
import { ConnectionManager } from './emr/connectionManager';
import { registerKernelManager, type EmrKernelManager } from './notebook/kernelManager';
import { registerSerializer } from './notebook/serializer';
import { openEmrSparkNotebook, revealEmrSparkNotebookIfOpen } from './notebook/openNotebook';
import { isEmrSparkNotebook } from './notebook/types';
import { ConnectionStatusBar } from './ui/statusBar';
import { promptEmrConnection } from './ui/connectWizard';
import { applyAwsProfileChange, promptAwsProfileSelection } from './aws/profile';
import { applyAwsRegionChange, promptAwsRegionSelection, syncRegionFromProfile } from './aws/region';
import { resetProxyConfig } from './aws/proxyConfig';
import { resetEmrServerlessService } from './aws/emrServerlessClient';
import { getSessionPresetStore } from './session/presets';
import { registerTableRendererMessaging } from './output/tableCountMessaging';
import { registerWelcomePage, showWelcomeOnFirstInstall } from './ui/welcomePage';

let connectionManager: ConnectionManager;
let statusBar: ConnectionStatusBar;
let configTree: ReturnType<typeof registerConfigTree>;
let applicationsTree: ReturnType<typeof registerApplicationsTree>;
let kernelManager: EmrKernelManager;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  connectionManager = new ConnectionManager();
  statusBar = new ConnectionStatusBar(connectionManager);
  const presetStore = getSessionPresetStore(context);
  configTree = registerConfigTree(context, presetStore);

  registerSerializer(context);
  kernelManager = registerKernelManager(context, connectionManager, presetStore);
  applicationsTree = registerApplicationsTree(context, connectionManager);
  registerApplicationsActions(context, connectionManager, applicationsTree, kernelManager);
  registerSessionPresetsActions(context, presetStore, configTree);
  registerTableRendererMessaging(context, connectionManager);
  registerWelcomePage(context);

  context.subscriptions.push(statusBar);

  const refreshSidebar = (notebook?: vscode.NotebookDocument): void => {
    statusBar.update(notebook);
  };

  const refreshAfterAwsContextChange = async (reason: 'profile' | 'region' | 'both'): Promise<void> => {
    if (connectionManager.listBindings().length > 0) {
      await connectionManager.disconnectAll();
      const message =
        reason === 'both'
          ? 'Disconnected notebook sessions because the AWS profile or region changed.'
          : reason === 'profile'
            ? 'Disconnected notebook sessions because the AWS profile changed.'
            : 'Disconnected notebook sessions because the AWS region changed.';
      void vscode.window.showWarningMessage(message);
      for (const notebook of vscode.workspace.notebookDocuments) {
        if (isEmrSparkNotebook(notebook)) {
          kernelManager.updateKernelAppearance(notebook);
        }
      }
    }
    await configTree.refreshAwsContext();
    refreshSidebar();
    applicationsTree.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        event.affectsConfiguration('http.proxy') ||
        event.affectsConfiguration('http.proxySupport') ||
        event.affectsConfiguration('http.proxyStrictSSL') ||
        event.affectsConfiguration('http.noProxy')
      ) {
        resetProxyConfig();
        resetEmrServerlessService();
        applicationsTree.refresh();
      }
    })
  );

  let handlingAwsContextChange = false;

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (handlingAwsContextChange) {
        return;
      }
      const profileChanged = event.affectsConfiguration('emrServerless.awsProfile');
      const regionChanged = event.affectsConfiguration('emrServerless.awsRegion');
      if (!profileChanged && !regionChanged) {
        return;
      }

      handlingAwsContextChange = true;
      try {
        if (profileChanged) {
          await applyAwsProfileChange(() =>
            refreshAfterAwsContextChange(regionChanged ? 'both' : 'profile')
          );
          return;
        }
        await applyAwsRegionChange(() => refreshAfterAwsContextChange('region'));
      } finally {
        handlingAwsContextChange = false;
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshSidebarState', () => {
      refreshSidebar();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.selectAwsProfile', async () => {
      await promptAwsProfileSelection();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.selectAwsRegion', async () => {
      await promptAwsRegionSelection();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.newNotebook', () =>
      createNewNotebook(context, kernelManager)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.openNotebook', async (uri?: vscode.Uri) => {
      let target = uri;
      if (!target) {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Open with EMR Serverless',
          filters: { Notebooks: ['ipynb', 'sparknb'] },
        });
        target = picked?.[0];
      }
      if (!target) {
        return;
      }
      if (await revealEmrSparkNotebookIfOpen(target)) {
        return;
      }
      await openEmrSparkNotebook(target);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.selectKernel', async () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      if (!notebook || !isEmrSparkNotebook(notebook)) {
        vscode.window.showWarningMessage('Open an EMR Serverless notebook first.');
        return;
      }
      await kernelManager.promptKernelSelection(notebook);
      refreshSidebar(notebook);
      applicationsTree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.connect', async () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      const connected = await promptEmrConnection(
        connectionManager,
        presetStore,
        notebook && isEmrSparkNotebook(notebook) ? notebook : undefined,
        (nb) => {
          kernelManager.updateKernelAppearance(nb);
          refreshSidebar(nb);
          applicationsTree.refresh();
          notifyDashboardAvailable(nb);
        }
      );
      if (connected && notebook && isEmrSparkNotebook(notebook)) {
        kernelManager.updateKernelAppearance(notebook);
        refreshSidebar(notebook);
        applicationsTree.refresh();
        notifyDashboardAvailable(notebook);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.disconnect', async () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      if (notebook && isEmrSparkNotebook(notebook)) {
        await connectionManager.disconnectNotebook(notebook);
        kernelManager.updateKernelAppearance(notebook);
      }
      refreshSidebar();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
      if (!isEmrSparkNotebook(notebook)) {
        return;
      }
      connectionManager.releaseNotebookBinding(notebook);
      refreshSidebar();
      applicationsTree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveNotebookEditor((editor) => {
      refreshSidebar(editor?.notebook);
      if (editor && isEmrSparkNotebook(editor.notebook)) {
        kernelManager.updateKernelAppearance(editor.notebook);
      }
    })
  );

  statusBar.show();
  void syncRegionFromProfile().then(() => configTree.refreshAwsContext());
  void showWelcomeOnFirstInstall(context);
}

function notifyDashboardAvailable(notebook?: vscode.NotebookDocument): void {
  const nb =
    notebook ??
    (vscode.window.activeNotebookEditor?.notebook &&
    isEmrSparkNotebook(vscode.window.activeNotebookEditor.notebook)
      ? vscode.window.activeNotebookEditor.notebook
      : undefined);
  if (!nb) {
    return;
  }
  const session = connectionManager.getSession(nb);
  if (!session?.dashboardUrl) {
    return;
  }
  void vscode.window
    .showInformationMessage(
      'Spark UI link is ready.',
      'Open Spark UI',
      'Refresh Link'
    )
    .then((choice) => {
      if (choice === 'Open Spark UI') {
        void vscode.commands.executeCommand('emrServerless.openSparkUi');
      } else if (choice === 'Refresh Link') {
        void vscode.commands.executeCommand('emrServerless.refreshDashboard');
      }
    });
}

export async function deactivate(): Promise<void> {
  await connectionManager?.disconnectAll().catch(() => undefined);
}
