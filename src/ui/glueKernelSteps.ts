import { formatGlueSessionLabel } from '../glue/types';
import type { GlueSessionPreset, GlueSessionPresetStore } from '../glue/presets';
import type {
  CreateForNotebookParams,
  CreatingSessionQuery,
  GlueSparkBackendAdapter,
} from '../platform/sparkBackend';
import type { KernelSelectionSteps, ListAttachTargetsResult } from './kernelSelectionSteps';
import type { WizardUi } from './wizardUi';

export interface GlueKernelStepsDeps {
  pickPreset: (
    store: GlueSessionPresetStore
  ) => Promise<GlueSessionPreset | undefined>;
  promptName: (options?: {
    defaultValue?: string;
    title?: string;
    optional?: boolean;
  }) => Promise<string | null | undefined>;
}

export class GlueKernelSteps implements KernelSelectionSteps {
  readonly alreadyCreatingMessage = 'Glue session creation already in progress.';
  readonly createPickLabel = '$(add) Create new Glue session';
  readonly createPickDescription = 'Start a new Glue Livy session';
  readonly createPickDetail = 'Choose a Glue session preset';
  readonly sparkUiCommand = 'glueInteractive.openSparkUi';

  constructor(
    private readonly glue: GlueSparkBackendAdapter,
    private readonly presetStore: GlueSessionPresetStore,
    private readonly ui: WizardUi,
    private readonly deps: GlueKernelStepsDeps
  ) {}

  creatingQuery(): CreatingSessionQuery {
    return { backend: 'glue' };
  }

  async listAttachTargets(): Promise<ListAttachTargetsResult> {
    let region: string;
    let sessions;
    try {
      const listed = await this.ui.withProgress('Loading Glue sessions…', () =>
        this.glue.listSessions()
      );
      region = listed.region;
      sessions = listed.sessions;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { status: 'error', message };
    }

    const activeSessions = sessions.filter((s) => s.status === 'READY');

    return {
      status: 'ready',
      title: `Select Glue session (${region})`,
      placeHolder: 'Attach to a session or create a new one',
      targets: activeSessions.map((s) => {
        const sessionLabel = formatGlueSessionLabel(s);
        return {
          label: sessionLabel,
          description: `${s.id} · ${s.status}`,
          detail: `${s.workerType ?? '?'} · ${s.numberOfWorkers ?? '?'} workers`,
          attach: {
            backend: 'glue' as const,
            sessionId: s.id,
          },
        };
      }),
    };
  }

  async pickCreateParams(): Promise<CreateForNotebookParams | undefined> {
    const preset = await this.deps.pickPreset(this.presetStore);
    if (!preset) {
      return undefined;
    }
    const sessionName = await this.deps.promptName({
      defaultValue: preset.sessionDescription,
      title: 'Glue session description',
      optional: true,
    });
    if (sessionName === undefined) {
      return undefined;
    }

    return {
      backend: 'glue',
      preset,
      sessionName: sessionName ?? undefined,
    };
  }

  formatCreateProgressTitle(params: CreateForNotebookParams): string {
    if (params.backend !== 'glue') {
      throw new Error('Expected Glue create params');
    }
    return `Creating Glue session (${params.preset?.name})…`;
  }

  formatCreateSuccessMessage(
    params: CreateForNotebookParams,
    sessionId: string | number | undefined
  ): string {
    if (params.backend !== 'glue') {
      throw new Error('Expected Glue create params');
    }
    return `Connected to Glue session ${sessionId} using preset "${params.preset?.name}".`;
  }
}
