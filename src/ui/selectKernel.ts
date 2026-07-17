import { isEmrSparkNotebook } from '../notebook/types';
import type { NotebookConnection } from '../platform/notebookConnection';
import type { NotebookRef } from '../platform/notebookWorkspace';
import type { SparkBackend } from '../platform/sparkBackend';
import type { AttachTarget, KernelSelectionSteps } from './kernelSelectionSteps';
import type { WizardQuickPickItem, WizardUi } from './wizardUi';

const promptingNotebooks = new Set<string>();

type SessionPickItem = WizardQuickPickItem & (
  | { itemKind: 'session'; target: AttachTarget }
  | { itemKind: 'new' }
);

export interface SelectKernelOptions {
  /** When set, skips the Spark Backend picker. */
  backend?: SparkBackend;
  ui?: WizardUi;
}

export async function selectKernel(
  connection: NotebookConnection,
  stepsByBackend: Record<SparkBackend, KernelSelectionSteps>,
  notebook: NotebookRef,
  options: SelectKernelOptions = {}
): Promise<boolean> {
  const ui =
    options.ui ??
    (await import('./vscodeWizardUi')).createVscodeWizardUi();

  if (!isEmrSparkNotebook(notebook)) {
    ui.showWarningMessage('Open a .sparknb or .ipynb notebook first.');
    return false;
  }

  const key = notebook.uri.toString();
  if (promptingNotebooks.has(key)) {
    return false;
  }
  promptingNotebooks.add(key);

  try {
    const backend = options.backend ?? (await pickSparkBackend(ui));
    if (!backend) {
      return false;
    }

    const steps = stepsByBackend[backend];
    const listed = await steps.listAttachTargets();
    if (listed.status === 'cancelled') {
      return false;
    }
    if (listed.status === 'empty') {
      ui.showWarningMessage(listed.message);
      return false;
    }
    if (listed.status === 'error') {
      ui.showErrorMessage(listed.message);
      return false;
    }

    const sessionItems: SessionPickItem[] = listed.targets.map((target) => ({
      itemKind: 'session' as const,
      label: target.label,
      description: target.description,
      detail: target.detail,
      target,
    }));
    sessionItems.push({
      itemKind: 'new',
      label: steps.createPickLabel,
      description: steps.createPickDescription,
      detail: steps.createPickDetail,
    });

    const sessionPick = await ui.showQuickPick(sessionItems, {
      title: listed.title,
      placeHolder: listed.placeHolder,
    });
    if (!sessionPick) {
      return false;
    }

    if (sessionPick.itemKind === 'new') {
      if (connection.isCreatingSession(steps.creatingQuery())) {
        ui.showInformationMessage(steps.alreadyCreatingMessage);
        return false;
      }

      const params = await steps.pickCreateParams();
      if (!params) {
        return false;
      }

      try {
        await ui.withProgress(steps.formatCreateProgressTitle(params), () =>
          connection.createForNotebook(notebook, params)
        );
      } catch (error) {
        steps.afterCreateAttempt?.(false);
        throw error;
      }
      steps.afterCreateAttempt?.(true);

      const session = connection.getSession(notebook);
      void ui
        .showInformationMessage(
          steps.formatCreateSuccessMessage(params, session?.sessionId),
          'Open Spark UI'
        )
        .then((choice) => {
          if (choice === 'Open Spark UI') {
            void ui.executeCommand(steps.sparkUiCommand);
          }
        });
      return true;
    }

    await ui.withProgress(`Attaching to ${sessionPick.target.label}…`, () =>
      connection.attach(notebook, sessionPick.target.attach)
    );
    ui.showInformationMessage(`Attached to ${sessionPick.target.label}.`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('already being created')) {
      ui.showInformationMessage(message);
    } else {
      ui.showErrorMessage(message);
    }
    return false;
  } finally {
    promptingNotebooks.delete(key);
  }
}

/** Clear the prompt-lock (tests only). */
export function resetSelectKernelPromptLockForTests(): void {
  promptingNotebooks.clear();
}

export async function pickSparkBackend(ui: WizardUi): Promise<SparkBackend | undefined> {
  const pick = await ui.showQuickPick(
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
