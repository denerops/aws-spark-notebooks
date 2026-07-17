import type { LivySessionInfo, LivyStatement, StatementKind } from '../livy/types';
import type { SessionPreset } from '../session/presets';
import type { GlueSessionPreset } from '../glue/presets';

export type SparkBackend = 'emr' | 'glue';

export interface SparkSessionHandle {
  backend: SparkBackend;
  sessionId: string | number;
  state: string;
  isReady: boolean;
  name?: string;
  /** EMR Serverless application id when backend is `emr`. */
  applicationId?: string;
  dashboardUrl?: string;
  dashboardError?: string;
  dashboardAnnounced: boolean;
  markDashboardAnnounced(): void;
  executeStatement(
    code: string,
    kind: StatementKind,
    options?: {
      signal?: AbortSignal;
      skipDisplayWrap?: boolean;
      onStatement?: (stmt: LivyStatement) => void;
    }
  ): Promise<LivyStatement>;
  refreshState(): Promise<void>;
}

export interface EmrCreateParams {
  applicationId: string;
  preset?: SessionPreset;
  sessionName?: string;
  onProgress?: (info: LivySessionInfo) => void;
}

export interface GlueCreateParams {
  preset?: GlueSessionPreset;
  sessionName?: string;
}

export type CreateForNotebookParams =
  | ({ backend: 'emr' } & EmrCreateParams)
  | ({ backend: 'glue' } & GlueCreateParams);

export type AttachParams =
  | { backend: 'emr'; applicationId: string; sessionId: number }
  | { backend: 'glue'; sessionId: string };

export type CreatingSessionQuery =
  | { backend: 'emr'; applicationId: string }
  | { backend: 'glue' };

export interface ConnectionView {
  backend?: SparkBackend;
  label: string;
  description: string;
  detail: string;
  connected: boolean;
}

export type SparkUiTarget =
  | {
      backend: 'emr';
      applicationId: string;
      sessionId: number;
      session?: SparkSessionHandle;
    }
  | {
      backend: 'glue';
      sessionId: string;
      session?: SparkSessionHandle;
    };

/** Spark Backend adapter: AWS session work only — never writes notebook metadata. */
export interface EmrSparkBackendAdapter {
  attach(applicationId: string, sessionId: number): Promise<SparkSessionHandle>;
  create(params: EmrCreateParams): Promise<SparkSessionHandle>;
  createStandalone(params: EmrCreateParams): Promise<SparkSessionHandle>;
  refreshDashboard(session: SparkSessionHandle): Promise<string | undefined>;
  resolveDashboardUrl(
    applicationId: string,
    sessionId: number,
    sparkAppId?: string
  ): Promise<{ url?: string; error?: string }>;
  isCreatingSession(applicationId: string): boolean;
}

/** Spark Backend adapter: AWS session work only — never writes notebook metadata. */
export interface GlueSparkBackendAdapter {
  attach(sessionId: string): Promise<SparkSessionHandle>;
  create(params: GlueCreateParams): Promise<SparkSessionHandle>;
  createStandalone(params: GlueCreateParams): Promise<SparkSessionHandle>;
  refreshDashboard(session: SparkSessionHandle): Promise<string | undefined>;
  resolveDashboardUrl(sessionId: string): Promise<string | undefined>;
  isCreatingSession(): boolean;
}
