import type { LivyApplication } from '../aws/emrServerlessClient';
import { formatLivySessionLabel, type LivySessionInfo } from '../livy/types';
import type { SessionPreset, SessionPresetStore } from '../session/presets';
import type {
  CreateForNotebookParams,
  CreatingSessionQuery,
  EmrSparkBackendAdapter,
} from '../platform/sparkBackend';
import type { KernelSelectionSteps, ListAttachTargetsResult } from './kernelSelectionSteps';
import type { WizardUi } from './wizardUi';

export interface EmrKernelStepsDeps {
  pickPreset: (store: SessionPresetStore) => Promise<SessionPreset | undefined>;
  promptName: (options?: {
    defaultValue?: string;
  }) => Promise<string | null | undefined>;
}

export class EmrKernelSteps implements KernelSelectionSteps {
  readonly alreadyCreatingMessage =
    'Session creation already in progress for this application.';
  readonly createPickLabel = '$(add) Create new session';
  readonly createPickDescription = 'Start a new Livy session';
  readonly createPickDetail = 'Choose a session preset';
  readonly sparkUiCommand = 'emrServerless.openSparkUi';

  private selectedApp: LivyApplication | undefined;

  constructor(
    private readonly emr: EmrSparkBackendAdapter,
    private readonly presetStore: SessionPresetStore,
    private readonly ui: WizardUi,
    private readonly deps: EmrKernelStepsDeps
  ) {}

  creatingQuery(): CreatingSessionQuery {
    if (!this.selectedApp) {
      throw new Error('EMR application not selected yet.');
    }
    return { backend: 'emr', applicationId: this.selectedApp.id };
  }

  async listAttachTargets(): Promise<ListAttachTargetsResult> {
    this.selectedApp = undefined;

    let region: string;
    let applications: LivyApplication[];
    try {
      const listed = await this.ui.withProgress('Loading EMR applications…', () =>
        this.emr.listApplications()
      );
      region = listed.region;
      applications = listed.applications;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }

    const startedApps = applications.filter((a) => a.state === 'STARTED');
    if (startedApps.length === 0) {
      return {
        status: 'empty',
        message:
          'No running Livy-enabled applications. Start one from the EMR Serverless sidebar.',
      };
    }

    const appPick = await this.ui.showQuickPick(
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
      return { status: 'cancelled' };
    }

    this.selectedApp = appPick.app;

    let sessions: LivySessionInfo[] = [];
    try {
      sessions = await this.emr.listSessions(appPick.app.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.ui.showWarningMessage(`Could not list sessions: ${message}`);
    }

    return {
      status: 'ready',
      title: `Select session — ${appPick.app.name}`,
      placeHolder: 'Attach to a session or create a new one',
      targets: sessions.map((s) => {
        const sessionLabel = formatLivySessionLabel(s);
        return {
          label: sessionLabel,
          description: `#${s.id} · ${s.state}`,
          detail: s.kind ?? 'pyspark',
          attach: {
            backend: 'emr' as const,
            applicationId: appPick.app.id,
            sessionId: s.id,
          },
        };
      }),
    };
  }

  async pickCreateParams(): Promise<CreateForNotebookParams | undefined> {
    if (!this.selectedApp) {
      throw new Error('EMR application not selected yet.');
    }
    const applicationId = this.selectedApp.id;

    const preset = await this.deps.pickPreset(this.presetStore);
    if (!preset) {
      return undefined;
    }
    const sessionName = await this.deps.promptName({
      defaultValue: preset.livySessionName,
    });
    if (!sessionName) {
      return undefined;
    }

    void this.ui.executeCommand('emrServerless.markSessionCreating', applicationId, sessionName);

    return {
      backend: 'emr',
      applicationId,
      preset,
      sessionName,
      onProgress: (info) => {
        void this.ui.executeCommand('emrServerless.patchSessionProgress', applicationId, info);
      },
    };
  }

  formatCreateProgressTitle(params: CreateForNotebookParams): string {
    if (params.backend !== 'emr') {
      throw new Error('Expected EMR create params');
    }
    return `Creating session "${params.sessionName}" (${params.preset?.name})…`;
  }

  formatCreateSuccessMessage(
    params: CreateForNotebookParams,
    sessionId: string | number | undefined
  ): string {
    if (params.backend !== 'emr') {
      throw new Error('Expected EMR create params');
    }
    return `Connected to session "${params.sessionName}" (${sessionId}) using preset "${params.preset?.name}".`;
  }

  afterCreateAttempt(_succeeded: boolean): void {
    void this.ui.executeCommand('emrServerless.refreshApplications');
  }
}
