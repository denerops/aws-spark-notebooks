import * as vscode from 'vscode';
import { getEmrServerlessService } from '../aws/emrServerlessClient';
import { LivySigV4Client } from '../livy/sigV4Client';
import { formatLivySessionLabel, type LivySessionInfo } from '../livy/types';
import { isEmrSparkNotebook } from '../notebook/types';
import type { SessionPresetStore } from '../session/presets';
import type { NotebookConnection } from '../platform/notebookConnection';
import { pickSessionPreset } from './pickSessionPreset';
import { promptSessionName } from './promptSessionName';

const promptingNotebooks = new Set<string>();

type SessionPickItem = vscode.QuickPickItem & (
  | {
      itemKind: 'session';
      sessionId: number;
      sessionLabel: string;
    }
  | {
      itemKind: 'new';
    }
);

export async function selectEmrKernel(
  connection: NotebookConnection,
  presetStore: SessionPresetStore,
  notebook: vscode.NotebookDocument
): Promise<boolean> {
  if (!isEmrSparkNotebook(notebook)) {
    vscode.window.showWarningMessage('Open a .sparknb or .ipynb notebook with EMR Serverless.');
    return false;
  }

  const key = notebook.uri.toString();
  if (promptingNotebooks.has(key)) {
    return false;
  }
  promptingNotebooks.add(key);

  try {
    const service = getEmrServerlessService();
    const region = await service.getRegion();

    let apps;
    try {
      apps = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Loading EMR applications…' },
        () => service.listLivyApplications()
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(message);
      return false;
    }

    const startedApps = apps.filter((a) => a.state === 'STARTED');
    if (startedApps.length === 0) {
      vscode.window.showWarningMessage(
        'No running Livy-enabled applications. Start one from the EMR Serverless sidebar.'
      );
      return false;
    }

    const appPick = await vscode.window.showQuickPick(
      startedApps.map((a) => ({
        label: a.name,
        description: a.id,
        detail: a.releaseLabel,
        app: a,
      })),
      {
        title: 'Select EMR Serverless application',
        placeHolder: `Running Livy-enabled application (${region})`,
      }
    );
    if (!appPick) {
      return false;
    }

    let sessions: LivySessionInfo[] = [];
    try {
      const client = new LivySigV4Client(appPick.app.id, region);
      sessions = await client.listSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(`Could not list sessions: ${message}`);
    }

    const sessionItems: SessionPickItem[] = sessions.map((s) => {
      const sessionLabel = formatLivySessionLabel(s);
      return {
        itemKind: 'session',
        label: sessionLabel,
        description: `#${s.id} · ${s.state}`,
        detail: s.kind ?? 'pyspark',
        sessionId: s.id,
        sessionLabel,
      };
    });
    sessionItems.push({
      itemKind: 'new',
      label: '$(add) Create new session',
      description: 'Start a new Livy session',
      detail: 'Choose a session preset',
    });

    const sessionPick = await vscode.window.showQuickPick(sessionItems, {
      title: `Select session — ${appPick.app.name}`,
      placeHolder: 'Attach to a session or create a new one',
    });
    if (!sessionPick) {
      return false;
    }

    if (sessionPick.itemKind === 'new') {
      if (connection.isCreatingSession({ backend: 'emr', applicationId: appPick.app.id })) {
        vscode.window.showInformationMessage(
          'Session creation already in progress for this application.'
        );
        return false;
      }
      const preset = await pickSessionPreset(presetStore);
      if (!preset) {
        return false;
      }
      const sessionName = await promptSessionName({
        defaultValue: preset.livySessionName,
      });
      if (!sessionName) {
        return false;
      }
      void vscode.commands.executeCommand(
        'emrServerless.markSessionCreating',
        appPick.app.id,
        sessionName
      );
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Creating session "${sessionName}" (${preset.name})…`,
          },
          () =>
            connection.createForNotebook(notebook, {
              backend: 'emr',
              applicationId: appPick.app.id,
              preset,
              sessionName,
              onProgress: (info) => {
                void vscode.commands.executeCommand(
                  'emrServerless.patchSessionProgress',
                  appPick.app.id,
                  info
                );
              },
            })
        );
      } catch (error) {
        void vscode.commands.executeCommand('emrServerless.refreshApplications');
        throw error;
      }
      void vscode.commands.executeCommand('emrServerless.refreshApplications');
      const session = connection.getSession(notebook);
      vscode.window
        .showInformationMessage(
          `Connected to session "${sessionName}" (${session?.sessionId}) using preset "${preset.name}".`,
          'Open Spark UI'
        )
        .then((choice) => {
          if (choice === 'Open Spark UI') {
            void vscode.commands.executeCommand('emrServerless.openSparkUi');
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
          backend: 'emr',
          applicationId: appPick.app.id,
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
