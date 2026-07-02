import * as vscode from 'vscode';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import type { ConnectionManager } from '../emr/connectionManager';
import type { NotebookConnectionHub } from '../platform/connectionHub';
import { createBlankSparknbDocument, createStarterSparknbDocument } from '../notebook/defaultDocument';
import { LivySession } from '../livy/session';
import { getSessionPresetStore } from '../session/presets';
import { pickSessionPreset } from '../ui/pickSessionPreset';
import { promptSessionName } from '../ui/promptSessionName';
import { openEmrSparkNotebook } from '../notebook/openNotebook';
import { isEmrSparkNotebook } from '../notebook/types';
import {
  ApplicationsTreeItem,
  type ApplicationsTreeProvider,
} from './applicationsTreeProvider';
import type { EmrKernelManager } from '../notebook/kernelManager';

function getActiveSparknb(): vscode.NotebookDocument | undefined {
  const editor = vscode.window.activeNotebookEditor;
  if (editor && isEmrSparkNotebook(editor.notebook)) {
    return editor.notebook;
  }
  return undefined;
}

function findOpenSparknb(): vscode.NotebookDocument | undefined {
  const active = getActiveSparknb();
  if (active) {
    return active;
  }
  return vscode.workspace.notebookDocuments.find((nb) => isEmrSparkNotebook(nb));
}

async function resolveNotebookForAttach(
  applicationId: string,
  sessionId: number
): Promise<vscode.NotebookDocument> {
  const active = getActiveSparknb();
  if (active) {
    return active;
  }

  const existing = vscode.workspace.notebookDocuments.find(
    (nb) =>
      isEmrSparkNotebook(nb) &&
      (nb.metadata?.emrServerless as { applicationId?: string; sessionId?: number } | undefined)
        ?.applicationId === applicationId &&
      (nb.metadata?.emrServerless as { sessionId?: number } | undefined)?.sessionId === sessionId
  );

  if (existing) {
    await vscode.window.showNotebookDocument(existing);
    return existing;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = folder
    ? vscode.Uri.joinPath(folder, `spark-${Date.now()}.ipynb`)
    : vscode.Uri.parse(`untitled:spark-${Date.now()}.ipynb`);

  const doc = createBlankSparknbDocument();
  const bytes = new TextEncoder().encode(JSON.stringify(doc, null, 2));
  await vscode.workspace.fs.writeFile(target, bytes);
  const notebook = await openEmrSparkNotebook(target);
  if (!notebook) {
    throw new Error(`Failed to open notebook: ${target.fsPath}`);
  }
  return notebook;
}

export function registerApplicationsActions(
  context: vscode.ExtensionContext,
  connectionManager: ConnectionManager,
  tree: ApplicationsTreeProvider,
  kernelManager?: EmrKernelManager,
  connectionHub?: NotebookConnectionHub
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshApplications', () => {
      tree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.startApplication',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        if (!appId) {
          return;
        }
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Starting application ${appId}…`,
            },
            () => getEmrServerlessService().startApplication(appId)
          );
          vscode.window.showInformationMessage(`Application ${appId} started.`);
          tree.refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.stopApplication',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        if (!appId) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Stop application ${item?.label ?? appId}? All Livy sessions will be terminated.`,
          { modal: true },
          'Stop'
        );
        if (confirm !== 'Stop') {
          return;
        }
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Stopping application ${appId}…`,
            },
            () => getEmrServerlessService().stopApplication(appId)
          );
          vscode.window.showInformationMessage(`Application ${appId} stopped.`);
          tree.refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.restartApplication',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        if (!appId) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Restart application ${item?.label ?? appId}? All Livy sessions will be terminated.`,
          { modal: true },
          'Restart'
        );
        if (confirm !== 'Restart') {
          return;
        }
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Restarting application ${appId}…`,
            },
            () => getEmrServerlessService().restartApplication(appId)
          );
          vscode.window.showInformationMessage(`Application ${appId} restarted.`);
          tree.refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.attachSession',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        const sessionId = item?.context.sessionId;
        if (!appId || sessionId === undefined) {
          return;
        }
        try {
          const notebook = await resolveNotebookForAttach(appId, sessionId);
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Attaching to session ${sessionId}…`,
            },
            () => connectionManager.attachToSession(notebook, appId, sessionId)
          );
          kernelManager?.updateKernelAppearance(notebook);
          vscode.window.showInformationMessage(`Attached to session ${sessionId}.`);
          void vscode.commands.executeCommand('emrServerless.refreshApplications');
          void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.stopSession',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        const sessionId = item?.context.sessionId;
        if (!appId || sessionId === undefined) {
          return;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Stop session ${sessionId}?`,
          { modal: true },
          'Stop'
        );
        if (confirm !== 'Stop') {
          return;
        }
        try {
          const region = item.context.region!;
          try {
            const session = await LivySession.attach(appId, region, sessionId);
            await session.stop();
          } catch {
            // Session may already be stopped.
          }

          const notebooks = await connectionManager.detachNotebooksForSession(appId, sessionId);
          for (const notebook of notebooks) {
            kernelManager?.updateKernelAppearance(notebook);
          }

          vscode.window.showInformationMessage(`Session ${sessionId} stopped.`);
          tree.refresh();
          void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(message);
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.newSession',
      async (item?: ApplicationsTreeItem) => {
        const appId = item?.context.applicationId;
        if (!appId) {
          return;
        }

        if (connectionManager.isCreatingSession(appId)) {
          vscode.window.showInformationMessage(
            'Session creation already in progress for this application.'
          );
          return;
        }

        tree.refresh();

        const targetNotebook = findOpenSparknb();

        if (targetNotebook) {
          const existing = connectionManager.getSession(targetNotebook);
          if (existing?.applicationId === appId && existing.isReady) {
            const reuse = await vscode.window.showInformationMessage(
              `This notebook is already connected to session ${existing.sessionId}.`,
              'Open Spark UI',
              'Create Another Session'
            );
            if (reuse === 'Open Spark UI') {
              await vscode.commands.executeCommand('emrServerless.openSparkUi');
              return;
            }
            if (reuse !== 'Create Another Session') {
              return;
            }
          }
        }

        try {
          const preset = await pickSessionPreset(getSessionPresetStore(context));
          if (!preset) {
            return;
          }

          const sessionName = await promptSessionName({
            defaultValue: preset.livySessionName,
          });
          if (!sessionName) {
            return;
          }

          const session = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `Creating Livy session "${sessionName}" (${preset.name})…`,
              cancellable: false,
            },
            async () => {
              if (targetNotebook) {
                const binding = await connectionManager.createSession(
                  targetNotebook,
                  appId,
                  preset,
                  sessionName
                );
                return binding.session;
              }
              return connectionManager.createStandaloneSession(appId, preset, sessionName);
            }
          );

          if (targetNotebook) {
            kernelManager?.updateKernelAppearance(targetNotebook);
            void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
          }

          const attachedNote = targetNotebook ? ' and attached to the open notebook' : '';
          vscode.window.showInformationMessage(
            `Created session "${sessionName}" (${session.sessionId}) on ${appId} using preset "${preset.name}"${attachedNote}.`,
            'Open Spark UI'
          ).then((choice) => {
            if (choice === 'Open Spark UI') {
              void vscode.commands.executeCommand('emrServerless.openSparkUi');
            }
          });
          tree.refresh();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('already being created')) {
            vscode.window.showInformationMessage(message);
          } else {
            vscode.window.showErrorMessage(message);
          }
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('emrServerless.refreshDashboard', async () => {
      const notebook = getActiveSparknb();
      const url = connectionHub
        ? await connectionHub.openSparkUi(notebook)
        : await connectionManager.openSparkUi(notebook);
      if (url) {
        vscode.window.showInformationMessage('Spark UI link refreshed.');
      } else {
        const emrTarget = connectionManager.resolveSparkUiTarget(notebook);
        const glueTarget = connectionHub?.getGlueManager().resolveSparkUiTarget(notebook);
        const detail = emrTarget?.session?.dashboardError ?? glueTarget?.session?.dashboardError;
        vscode.window.showWarningMessage(
          detail
            ? `Could not fetch Spark UI URL: ${detail}`
            : 'Could not fetch Spark UI URL. Connect to a session first.'
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'emrServerless.openSparkUi',
      async (item?: ApplicationsTreeItem) => {
        if (item?.context.applicationId && item.context.sessionId !== undefined) {
          const service = getEmrServerlessService();
          const result = await service.getSparkDashboardUrl(
            item.context.applicationId,
            item.context.sessionId
          );
          if (result.url) {
            await vscode.env.openExternal(vscode.Uri.parse(result.url));
            return;
          }
          if (result.error) {
            vscode.window.showWarningMessage(`Could not open Spark UI: ${result.error}`);
            return;
          }
        }

        const notebook = getActiveSparknb();
        const url = connectionHub
          ? await connectionHub.openSparkUi(notebook)
          : await connectionManager.openSparkUi(notebook);
        if (!url) {
          const emrTarget = connectionManager.resolveSparkUiTarget(notebook);
          const glueTarget = connectionHub?.getGlueManager().resolveSparkUiTarget(notebook);
          const detail = emrTarget?.session?.dashboardError ?? glueTarget?.session?.dashboardError;
          vscode.window.showWarningMessage(
            detail
              ? `Could not open Spark UI: ${detail}`
              : 'No Spark UI URL available. Connect to a session first.'
          );
          return;
        }

        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    )
  );
}

export async function createNewNotebook(
  _context: vscode.ExtensionContext,
  _kernelManager?: { promptKernelSelection(notebook: vscode.NotebookDocument): Promise<boolean> }
): Promise<void> {
  const formatPick = await vscode.window.showQuickPick(
    [
      { label: 'Jupyter notebook (.ipynb)', extension: 'ipynb' },
      { label: 'Spark notebook (.sparknb)', extension: 'sparknb' },
    ],
    { title: 'Notebook format', placeHolder: 'Choose file format' }
  );
  if (!formatPick) {
    return;
  }

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = folder
    ? vscode.Uri.joinPath(folder, `spark-${Date.now()}.${formatPick.extension}`)
    : vscode.Uri.parse(`untitled:spark-${Date.now()}.${formatPick.extension}`);

  const initialContent = createStarterSparknbDocument();
  const bytes = new TextEncoder().encode(JSON.stringify(initialContent, null, 2));
  await vscode.workspace.fs.writeFile(target, bytes);
  await openEmrSparkNotebook(target);
}
