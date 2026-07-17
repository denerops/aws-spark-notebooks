import type {
  AttachParams,
  CreateForNotebookParams,
  CreatingSessionQuery,
} from '../platform/sparkBackend';

export interface AttachTarget {
  label: string;
  description: string;
  detail?: string;
  attach: AttachParams;
}

export type ListAttachTargetsResult =
  | {
      status: 'ready';
      title: string;
      placeHolder: string;
      targets: AttachTarget[];
    }
  | { status: 'empty'; message: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

/** Per-backend Kernel Selection steps: discovery DTOs + create-param UI. */
export interface KernelSelectionSteps {
  listAttachTargets(): Promise<ListAttachTargetsResult>;
  pickCreateParams(): Promise<CreateForNotebookParams | undefined>;
  /** Valid after a successful `listAttachTargets` (`ready`). */
  creatingQuery(): CreatingSessionQuery;
  alreadyCreatingMessage: string;
  createPickLabel: string;
  createPickDescription: string;
  createPickDetail: string;
  sparkUiCommand: string;
  formatCreateProgressTitle(params: CreateForNotebookParams): string;
  formatCreateSuccessMessage(
    params: CreateForNotebookParams,
    sessionId: string | number | undefined
  ): string;
  afterCreateAttempt?(succeeded: boolean): void;
}
