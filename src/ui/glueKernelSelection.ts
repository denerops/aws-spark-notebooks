import * as vscode from 'vscode';
import { getGlueSessionService } from '../glue/glueSessionService';
import { formatGlueSessionLabel, type GlueSessionSummary } from '../glue/types';
import { isEmrSparkNotebook } from '../notebook/types';
import type { GlueSessionPresetStore } from '../glue/presets';
import { pickGlueSessionPreset } from './pickGlueSessionPreset';
import { promptSessionName } from './promptSessionName';
import type { NotebookConnection } from '../platform/notebookConnection';

const promptingNotebooks = new Set<string>();

type SessionPickItem = vscode.QuickPickItem & (
  | {
      itemKind: 'session';
      sessionId: string;
      sessionLabel: string;
    }
  | {
      itemKind: 'new';
    }
);

export async function selectGlueKernel(
  connection: NotebookConnection,
  presetStore: GlueSessionPresetStore,
  notebook: vscode.NotebookDocument
): Promise<boolean> {
  if (!isEmrSparkNotebook(notebook)) {
    vscode.window.showWarningMessage('Open a .sparknb or .ipynb notebook first.');
    return false;
  }

  const key = notebook.uri.toString();
  if (promptingNotebooks.has(key)) {
    return false;
  }
  promptingNotebooks.add(key);

  try {
    const service = getGlueSessionService();
    const region = await service.getRegion();

    let sessions: GlueSessionSummary[] = [];
    try {
      sessions = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Loading Glue sessions…' },
        () => service.listLivySessions()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(message);
      return false;
    }

    const activeSessions = sessions.filter((s) => s.status === 'READY');

    const sessionItems: SessionPickItem[] = activeSessions.map((s) => {
      const sessionLabel = formatGlueSessionLabel(s);
      return {
        itemKind: 'session',
        label: sessionLabel,
        description: `${s.id} · ${s.status}`,
        detail: `${s.workerType ?? '?'} · ${s.numberOfWorkers ?? '?'} workers`,
        sessionId: s.id,
        sessionLabel,
      };
    });
    sessionItems.push({
      itemKind: 'new',
      label: '$(add) Create new Glue session',
      description: 'Start a new Glue Livy session',
      detail: 'Choose a Glue session preset',
    });

    const sessionPick = await vscode.window.showQuickPick(sessionItems, {
      title: `Select Glue session (${region})`,
      placeHolder: 'Attach to a session or create a new one',
    });
    if (!sessionPick) {
      return false;
    }

    if (sessionPick.itemKind === 'new') {
      if (connection.isCreatingSession({ backend: 'glue' })) {
        vscode.window.showInformationMessage('Glue session creation already in progress.');
        return false;
      }
      const preset = await pickGlueSessionPreset(presetStore);
      if (!preset) {
        return false;
      }
      const sessionName = await promptSessionName({
        defaultValue: preset.sessionDescription,
        title: 'Glue session description',
        optional: true,
      });
      if (sessionName === undefined) {
        return false;
      }
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Creating Glue session (${preset.name})…`,
        },
        () =>
          connection.createForNotebook(notebook, {
            backend: 'glue',
            preset,
            sessionName: sessionName ?? undefined,
          })
      );
      const session = connection.getSession(notebook);
      vscode.window
        .showInformationMessage(
          `Connected to Glue session ${session?.sessionId} using preset "${preset.name}".`,
          'Open Spark UI'
        )
        .then((choice) => {
          if (choice === 'Open Spark UI') {
            void vscode.commands.executeCommand('glueInteractive.openSparkUi');
          }
        });
      return true;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Attaching to ${sessionPick.sessionLabel}…`,
      },
      () =>
        connection.attach(notebook, {
          backend: 'glue',
          sessionId: sessionPick.sessionId,
        })
    );
    vscode.window.showInformationMessage(`Attached to ${sessionPick.sessionLabel}.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already being created')) {
      vscode.window.showInformationMessage(message);
    } else {
      vscode.window.showErrorMessage(message);
    }
    return false;
  } finally {
    promptingNotebooks.delete(key);
  }
}

export async function pickSparkBackend(): Promise<'emr' | 'glue' | undefined> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: '$(server-environment) EMR Serverless',
        description: 'Livy on EMR Serverless applications',
        backend: 'emr' as const,
      },
      {
        label: '$(cloud) Glue Interactive Sessions',
        description: 'Livy on AWS Glue interactive sessions',
        backend: 'glue' as const,
      },
    ],
    {
      title: 'Select Spark backend',
      placeHolder: 'Choose where to run this notebook',
    }
  );
  return pick?.backend;
}
