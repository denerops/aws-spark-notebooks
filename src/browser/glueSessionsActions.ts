import * as vscode from 'vscode';
import { getGlueSessionService } from '../glue/glueSessionService';
import type { GlueSparkBackend } from '../glue/connectionManager';
import type { NotebookConnection } from '../platform/notebookConnection';
import { GlueLivySession } from '../glue/glueSession';
import { getGlueSessionPresetStore } from '../glue/presets';
import { pickGlueSessionPreset } from '../ui/pickGlueSessionPreset';
import { promptSessionName } from '../ui/promptSessionName';
import { openEmrSparkNotebook } from '../notebook/openNotebook';
import { isEmrSparkNotebook } from '../notebook/types';
import { createBlankSparknbDocument } from '../notebook/defaultDocument';
import type { GlueSessionsTreeProvider } from './glueSessionsTreeProvider';
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

const ACTIVE_GLUE_SESSION_STATUSES = new Set(['READY', 'PROVISIONING']);

async function deleteGlueSession(sessionId: string): Promise<void> {
  const service = getGlueSessionService();
  try {
    const summary = await service.getSession(sessionId);
    if (ACTIVE_GLUE_SESSION_STATUSES.has(summary.status)) {
      await service.stopSession(sessionId).catch(() => undefined);
    }
  } catch {
    // Session may already be stopped or removed; still attempt delete.
  }
  await service.deleteSession(sessionId);
}

async function resolveNotebookForAttach(sessionId: string): Promise<vscode.NotebookDocument> {
  const active = getActiveSparknb();
  if (active) {
    return active;
  }

  const existing = vscode.workspace.notebookDocuments.find(
    (nb) =>
      isEmrSparkNotebook(nb) &&
      (nb.metadata?.glueInteractive as { sessionId?: string } | undefined)?.sessionId === sessionId
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

export function registerGlueSessionsActions(
  context: vscode.ExtensionContext,
  glueBackend: GlueSparkBackend,
  tree: GlueSessionsTreeProvider,
  kernelManager: EmrKernelManager,
  connection: NotebookConnection
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.refreshSessions', () => {
      tree.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.attachSession', async (item) => {
      const sessionId = item?.context?.sessionId as string | undefined;
      if (!sessionId) {
        return;
      }
      try {
        const notebook = await resolveNotebookForAttach(sessionId);
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Attaching to Glue session ${sessionId}…`,
          },
          () =>
            connection.attach(notebook, {
              backend: 'glue',
              sessionId,
            })
        );
        kernelManager.updateKernelAppearance(notebook);
        vscode.window.showInformationMessage(`Attached to Glue session ${sessionId}.`);
        void vscode.commands.executeCommand('glueInteractive.refreshSessions');
        void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.stopSession', async (item) => {
      const sessionId = item?.context?.sessionId as string | undefined;
      if (!sessionId) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Stop Glue session ${sessionId}?`,
        { modal: true },
        'Stop'
      );
      if (confirm !== 'Stop') {
        return;
      }
      try {
        const region = item.context.region as string;
        try {
          const session = await GlueLivySession.attach(region, sessionId);
          await session.stop();
        } catch {
          await getGlueSessionService().stopSession(sessionId).catch(() => undefined);
        }

        const notebooks = await connection.detachForGlueSession(sessionId);
        for (const notebook of notebooks) {
          kernelManager.updateKernelAppearance(notebook as vscode.NotebookDocument);
        }

        vscode.window.showInformationMessage(`Glue session ${sessionId} stopped.`);
        tree.refresh();
        void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.deleteSession', async (item) => {
      const sessionId = item?.context?.sessionId as string | undefined;
      if (!sessionId) {
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        `Delete Glue session ${sessionId}? This permanently removes the session and cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') {
        return;
      }
      try {
        await deleteGlueSession(sessionId);

        const notebooks = await connection.detachForGlueSession(sessionId);
        for (const notebook of notebooks) {
          kernelManager.updateKernelAppearance(notebook as vscode.NotebookDocument);
        }

        vscode.window.showInformationMessage(`Glue session ${sessionId} deleted.`);
        tree.refresh();
        void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.newSession', async () => {
      if (glueBackend.isCreatingSession()) {
        vscode.window.showInformationMessage('Glue session creation already in progress.');
        return;
      }

      tree.refresh();

      const targetNotebook = findOpenSparknb();

      try {
        const preset = await pickGlueSessionPreset(getGlueSessionPresetStore(context));
        if (!preset) {
          return;
        }

        const sessionName = await promptSessionName({
          defaultValue: preset.sessionDescription,
          title: 'Glue session description',
          placeholder: 'Optional description shown in the sidebar',
          optional: true,
        });
        if (sessionName === undefined) {
          return;
        }

        const session = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Creating Glue Livy session (${preset.name})…`,
            cancellable: false,
          },
          async () => {
            if (targetNotebook) {
              return connection.createForNotebook(targetNotebook, {
                backend: 'glue',
                preset,
                sessionName: sessionName || undefined,
              });
            }
            return glueBackend.createStandalone({
              preset,
              sessionName: sessionName || undefined,
            });
          }
        );

        if (targetNotebook) {
          kernelManager.updateKernelAppearance(targetNotebook);
          void vscode.commands.executeCommand('emrServerless.refreshSidebarState');
        }

        const attachedNote = targetNotebook ? ' and attached to the open notebook' : '';
        vscode.window.showInformationMessage(
          `Created Glue session "${session.name ?? session.sessionId}" (${session.sessionId}) using preset "${preset.name}"${attachedNote}.`,
          'Open Spark UI'
        ).then((choice) => {
          if (choice === 'Open Spark UI') {
            void vscode.commands.executeCommand('glueInteractive.openSparkUi');
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.openSparkUi', async (item) => {
      if (item?.context?.sessionId) {
        const url = await getGlueSessionService().getDashboardUrl(item.context.sessionId);
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
          return;
        }
      }

      const notebook = getActiveSparknb();
      const url = await connection.openSparkUi(notebook);
      if (!url) {
        const target = connection.resolveSparkUiTarget(notebook);
        const detail = target?.session?.dashboardError;
        vscode.window.showWarningMessage(
          detail
            ? `Could not open Spark UI: ${detail}`
            : 'No Spark UI URL available. Connect to a Glue session first.'
        );
        return;
      }

      await vscode.env.openExternal(vscode.Uri.parse(url));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('glueInteractive.connect', async () => {
      const notebook = getActiveSparknb();
      if (!notebook) {
        vscode.window.showWarningMessage('Open a notebook first.');
        return;
      }
      await kernelManager.promptKernelSelection(notebook, 'glue');
    })
  );
}
